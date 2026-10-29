/**
 * DSH 宿主 worker 适配器：把 Swarm 的 `WorkerHost` 端口接到真实的 `ctx.agents`、
 * `ctx.subagents`、`ctx.worktrees`、`ctx.workingDirectory` 与 `ctx.jobs`。
 *
 * 边界（架构 §5.3 / notes/workspace-api.md §2.4、§3）：
 * - 不实现模型循环、不伪造 Agent：owner 必须是 `ctx.agents.get` 返回的真实 live 对象。
 * - `start` 只保证“已发布”（`startActivation` resolve），绝不等待 `activation.result`。
 * - 初始化在 `agent/created`（serial、被 await）里完成：首个 worker 先建集成 worktree，
 *   再建自己的 worktree；恢复时只核对已有路径，不重建同名分支。
 * - `swarm` 前缀只是命名文本；run.id 已带前缀时照旧拼接，不做裁剪或重写。
 */

import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';

import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type { JobId, JobView } from '@deepseek-ai/dsh-jobs';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { SubagentActivation, SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent';
import type { CreatedWorktree, CreateWorktreeRequest } from '@deepseek-ai/dsh-experimental-worktree';

import { SwarmError, normalizeError } from './errors.ts';
import { notificationReference } from './events.ts';
import type { WorkerHost, WorkerStartRequest } from './ports.ts';
import type { NotificationRecord } from './public-types.ts';
import { KeyedSerialQueue } from './serial.ts';
import type { StateStore } from './store.ts';
import type { Run, RunId, WorkerId, WorkerRecord } from './types.ts';
import { workerDisplayName } from './worker-names.ts';

/** worker 的专用 preset；preset 身份由 Runtime 持有，这里只按约定引用。 */
const DEFAULT_PRESET_ID = 'swarm-worker';
/** 本轮只接原生 in-process spawn 后端。 */
const DEFAULT_PROVIDER = 'spawn';
/** 停止时等待单个后台 job 真实结束的上限。 */
const JOB_DRAIN_TIMEOUT_MS = 30_000;

/** 已发布 activation 的宿主句柄；owner 下线时仍由本类负责释放。 */
interface HeldActivation {
  runId: RunId;
  activation: SubagentActivation;
}

interface HandlerOptions {
  /** worker Agent 挂载的 preset id；默认 `swarm-worker`。 */
  presetId?: string;
  /** 原生 subagent 后端名；默认 `spawn`。 */
  provider?: string;
}

/** `agent/created` 里本适配器消费的字段。 */
interface AgentCreatedPayload {
  readonly agent: Agent;
  readonly signal?: AbortSignal;
}

/** False while native creation may have produced an unrecorded worktree. */
interface InitializationAttempt {
  safeToRetry: boolean;
}

/** 一次 worker 启动请求；字段与原生 `SubagentActivationSpec` 对齐。 */
interface SubagentStartSpec {
  readonly provider: string;
  readonly label: string;
  readonly childId: SessionId;
  readonly request: {
    readonly parent: Agent;
    readonly cwd: string;
    readonly agentPreset: string;
    readonly maxDepth?: number;
    readonly prompt: ContentBlock[];
  };
  readonly signal: AbortSignal;
  readonly delivery: 'caller';
}

/**
 * 本适配器消费的最小 Host 服务面。
 *
 * 真实 Cordis `Context` 在运行时满足它；这里显式声明而不依赖 `@deepseek-ai/cordis`
 * 的模块增强，因为插件侧的 cordis 副本与被链接 Harness 包解析到的副本不是同一模块身份。
 */
export interface DshWorkerHostServices {
  readonly agents: { get(id: SessionId): Agent | undefined };
  readonly subagents: {
    getProvider(name: string): unknown;
    startActivation(spec: SubagentStartSpec): Promise<SubagentActivation>;
    sendMessage(
      sender: Agent,
      targetId: SessionId,
      content: ContentBlock[],
      options: { signal: AbortSignal },
    ): Promise<unknown>;
    drainChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void>;
  };
  readonly worktrees: {
    create(agent: Agent, request?: CreateWorktreeRequest, signal?: AbortSignal): Promise<CreatedWorktree>;
  };
  readonly workingDirectory: {
    set(agent: Agent, path: string, signal?: AbortSignal): Promise<string>;
  };
  readonly jobs: {
    list(caller?: SessionId): JobView[];
    kill(id: JobId, caller?: SessionId, reason?: string): 'requested' | 'already-finished';
    wait(id: JobId, timeoutMs: number, caller?: SessionId, signal?: AbortSignal): Promise<JobView>;
  };
}

/** 结构上读取真实运行时的 `status`；`Agent` 公共面只有 id。 */
interface AgentWithStatus {
  readonly status?: AgentStatus;
}

/** 把可等待的 effect disposer 折成同步 disposer；effect 本身在注册时已开始。 */
function effectDisposer(disposable: () => Promise<void>): () => void {
  return () => {
    void disposable();
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLiveJob(status: JobView['status']): boolean {
  return status === 'running' || status === 'stopping';
}

/**
 * 原生 worker 生命周期适配器。
 *
 * 句柄归本实例所有：`dispose()` 移除自己注册的监听器并释放仍持有的 activation，
 * 不触碰别的 owner 子树，也不创建额外的服务器或 profile。
 */
export class DshWorkerHost implements WorkerHost {
  private readonly ctx: Context;
  private readonly store: StateStore;
  private readonly presetId: string;
  private readonly provider: string;

  private readonly listeners = new Set<(sessionId: string, activationId: string, failed: boolean) => void>();
  private readonly activations = new Map<string, HeldActivation>();
  /** 已上报过的 activation runId，避免同一结算重复通知。 */
  private readonly reportedActivations = new Set<string>();
  /** 已知初始失败的 worker；只有这种确定失败才报告 unavailable。 */
  private readonly failedSessions = new Set<string>();
  /** 同一 run 的初始化串行，避免并发抢建集成树。 */
  private readonly initQueue = new KeyedSerialQueue();
  private readonly disposers: (() => void)[] = [];

  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  /**
   * @param ctx - 真实 Host 上下文；服务缺失时由具体方法尽早失败。
   * @param store - 已持久化 run 预约记录的状态仓库。
   * @param options - preset 与 subagent provider 覆盖。
   */
  constructor(ctx: Context, store: StateStore, options: HandlerOptions = {}) {
    this.ctx = ctx;
    this.store = store;
    this.presetId = options.presetId ?? DEFAULT_PRESET_ID;
    this.provider = options.provider ?? DEFAULT_PROVIDER;

    // 全局监听，按 store 中已预留的 worker sessionId 过滤；必须在 start 之前同步注册。
    // 监听器挂在插件 fiber 上：插件卸载与 dispose() 都会摘掉，不留给 EventsService 的 fiber。
    this.disposers.push(
      effectDisposer(
        this.ctx.effect(
          () =>
            this.ctx.events.on('agent/created', async (payload: AgentCreatedPayload) => {
              await this.onAgentCreated(payload.agent, payload.signal);
              return undefined;
            }),
          'dsh-swarm agent/created',
        ),
      ),
      effectDisposer(
        this.ctx.effect(
          () =>
            this.ctx.events.on('subagent/end', (info: SubagentRunEndInfo) => {
              this.onSubagentEnd(info);
            }),
          'dsh-swarm subagent/end',
        ),
      ),
    );
  }

  /* ------------------------------------------------------------------ */
  /* WorkerHost                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * 发布一个 worker。返回即表示 activation 已发布，不等结算。
   *
   * @throws SwarmError owner 离线、provider/preset 不可用或 agent 创建失败。
   */
  async start({ run, worker, signal }: WorkerStartRequest): Promise<void> {
    this.assertActive('start');
    if (this.activations.has(worker.sessionId)) {
      return;
    }
    const owner = this.requireOwner(run.ownerSessionId);
    if (this.requireService('subagents').getProvider(this.provider) === undefined) {
      throw new SwarmError('SWARM_INVALID_STATE', `subagent provider ${this.provider} is unavailable`, {
        details: { provider: this.provider, runId: run.id, workerId: worker.id },
      });
    }

    const prompt: ContentBlock[] = [
      {
        type: 'text',
        text:
          `You are worker ${worker.id} of Swarm run ${run.id}. ` +
          'Call swarm_sync first to load the goal, acceptance criteria and current state.',
      },
    ];

    let activation: SubagentActivation;
    try {
      activation = await this.requireService('subagents').startActivation({
        provider: this.provider,
        label: `${workerDisplayName(worker)} · swarm ${run.id}`,
        childId: SessionId(worker.sessionId),
        request: {
          parent: owner,
          cwd: run.repositoryRoot,
          agentPreset: this.presetId,
          maxDepth: 1,
          prompt,
        },
        signal,
        delivery: 'caller',
      });
    } catch (error) {
      if (!signal.aborted) {
        this.failedSessions.add(worker.sessionId);
      }
      throw normalizeError(error, 'SWARM_INTERNAL', `start worker ${worker.id}`);
    }

    // Publication must not wait for the model, but a rejected capture is visible.
    void activation.result.catch((error: unknown) => {
      console.error('[swarm] activation result failed', { sessionId: worker.sessionId }, error);
      for (const listener of [...this.listeners]) {
        try { listener(worker.sessionId, `result-error:${worker.sessionId}`, true); }
        catch (listenerError) { console.error('[swarm] failure listener failed', listenerError); }
      }
    });

    if (this.disposed) {
      await activation.dispose();
      return;
    }
    this.failedSessions.delete(worker.sessionId);
    this.activations.set(worker.sessionId, { runId: run.id, activation });
  }

  /**
   * 通过原 owner→worker 消息提示同步与自主续工；不在这里分派子任务。
   *
   * @throws SwarmError owner 离线或消息未被 inbox 接受。
   */
  async notify(run: Run, worker: WorkerRecord, throughSeq: number, signal: AbortSignal,
    notifications: readonly NotificationRecord[] = []): Promise<void> {
    this.assertActive('notify');
    const owner = this.requireOwner(run.ownerSessionId);
    const content: ContentBlock[] = [
      { type: 'text', text: `Swarm coordination checkpoint (event ${throughSeq}). Call swarm_sync to read current shared state. `
        + 'Choose the next useful contribution yourself: inspect a remaining gap, claim complementary work, '
        + 'review/help a peer, or resolve a dependency. No manager is assigning you a task. '
        + 'After an accepted contribution, share a patch summary and repeat the work cycle. '
        + 'If all original criteria have evidence, propose swarm_finish. If truly blocked on peers, '
        + 'use swarm_wait with a cursor returned by swarm_sync; do not just end with a completion report.' },
    ];
    const attention = notifications.filter((item) => item.workerId === worker.id).slice(0, 20);
    if (attention.length) content.push({ type: 'text', text: '[Swarm public attention]\n'
      + JSON.stringify(attention.map(notificationReference))
      + '\nRead priority attention and pending response requests, then fetch source messages as needed. '
      + 'These references are not full-message reads, response/consent confirmations, or global ACK cursors.' });
    try {
      await this.requireService('subagents').sendMessage(owner, SessionId(worker.sessionId), content, { signal });
    } catch (error) {
      throw normalizeError(error, 'SWARM_INTERNAL', `notify worker ${worker.id}`);
    }
  }

  /**
   * 停止本 run 的原生 worker 资源：只释放该 run 的 childIds 与它们名下的后台 job。
   *
   * owner 离线时无法走 subagents 的父 Agent 授权，仍会释放本类持有的 activation 并取消
   * job；不能确认静止的项会作为问题聚合抛出。
   */
  async stop(run: Run): Promise<void> {
    if (this.disposed) {
      return;
    }
    const childIds = Object.values(run.workers).map((worker) => worker.sessionId);
    const problems: string[] = [];

    const owner = this.ownerAgent(run.ownerSessionId);
    let drained = false;
    if (owner !== undefined) {
      try {
        await this.requireService('subagents').drainChildren(
          owner,
          childIds.map((sessionId) => SessionId(sessionId)),
        );
        drained = true;
      } catch (error) {
        problems.push(`drainChildren: ${describe(error)}`);
      }
    }

    for (const sessionId of childIds) {
      try {
        await this.settleJobs(sessionId);
      } catch (error) {
        problems.push(`jobs ${sessionId}: ${describe(error)}`);
      }
    }

    for (const sessionId of childIds) {
      const held = this.activations.get(sessionId);
      if (held === undefined || held.runId !== run.id) {
        if (!drained && this.ownerAgent(sessionId) !== undefined) {
          problems.push(`worker ${sessionId} is still live but no owner/activation handle can stop it`);
        }
        continue;
      }
      this.activations.delete(sessionId);
      // drainChildren 已释放了这些 activation；只有它不可用时才由本类兜底释放。
      if (drained) {
        continue;
      }
      try {
        await held.activation.dispose();
      } catch (error) {
        problems.push(`activation ${sessionId}: ${describe(error)}`);
      }
    }

    const [first, ...rest] = problems;
    if (first !== undefined) {
      throw new SwarmError('SWARM_INTERNAL', `stop did not release every worker of ${run.id}`, {
        details: { runId: run.id, problems, additional: rest.length },
      });
    }
  }

  /** owner 是否仍在注册表里；缺席不是“忙”，只是离线。 */
  isOwnerLive(ownerSessionId: string): boolean {
    return this.ownerAgent(ownerSessionId) !== undefined;
  }

  /** 只看后台 job 的真实状态；Agent 空闲但 job 在跑仍算忙。 */
  isWorkerBusy(sessionId: string): boolean {
    const jobs = this.jobRegistry();
    if (jobs === undefined) {
      return false;
    }
    try {
      return jobs.list(SessionId(sessionId)).some((job) => String(job.owner) === sessionId && isLiveJob(job.status));
    } catch {
      return false;
    }
  }

  /**
   * 原生状态以 `ctx.agents.get(...).status` 为准；未驻留返回 inactive。
   * 只有本类确认过的初始失败才返回 unavailable。
   */
  workerStatus(sessionId: string): 'running' | 'inactive' | 'unavailable' {
    if (this.failedSessions.has(sessionId)) {
      return 'unavailable';
    }
    const agent = this.ownerAgent(sessionId);
    if (agent === undefined) {
      return 'inactive';
    }
    const status: AgentStatus | undefined = (agent as AgentWithStatus).status;
    if (status === undefined) {
      return 'inactive';
    }
    return status === 'running' ? 'running' : 'inactive';
  }

  /** 订阅结算；返回的取消函数可重复调用。 */
  onSettled(listener: (sessionId: string, activationId: string, failed: boolean) => void): () => void {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.listeners.delete(listener);
    };
  }

  /**
   * 卸载：移除本类注册的监听器，释放仍持有的 activation 与队列。
   *
   * @throws SwarmError 聚合了释放失败的诊断。
   */
  dispose(): Promise<void> {
    if (this.disposePromise !== null) {
      return this.disposePromise;
    }
    this.disposed = true;
    this.disposePromise = (async () => {
      for (const disposer of this.disposers.splice(0)) {
        disposer();
      }
      const problems: string[] = [];
      try {
        await this.initQueue.idle();
      } catch (error) {
        problems.push(`initialization: ${describe(error)}`);
      }
      for (const [sessionId, held] of this.activations) {
        this.activations.delete(sessionId);
        try {
          await held.activation.dispose();
        } catch (error) {
          problems.push(`activation ${sessionId}: ${describe(error)}`);
        }
      }
      this.listeners.clear();
      this.reportedActivations.clear();
      this.failedSessions.clear();
      const [first] = problems;
      if (first !== undefined) {
        throw new SwarmError('SWARM_INTERNAL', 'worker host dispose did not release every activation', {
          details: { problems },
        });
      }
    })();
    return this.disposePromise;
  }

  /* ------------------------------------------------------------------ */
  /* 初始化                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * `agent/created` 的 serial 回调：只处理已在 store 中预留的 worker session。
   * 抛错会让 Agent 创建失败，因此初始化失败必须同时写入 worker 记录。
   */
  private async onAgentCreated(agent: Agent, signal: AbortSignal | undefined): Promise<void> {
    const sessionId = String(agent.id);
    const located = this.findWorker(sessionId);
    if (located === null) {
      return;
    }
    const { runId, workerId } = located;
    await this.initQueue.run(runId, async () => {
      if (this.disposed) {
        throw new SwarmError('SWARM_INVALID_STATE', 'worker host is disposed', {
          details: { runId, workerId, sessionId },
        });
      }
      const previous = this.store.get(runId).workers[workerId];
      if (previous?.initializationState === 'failed') {
        throw new SwarmError('SWARM_INVALID_STATE', `worker ${workerId} initialization failed; inspect its worktree before retrying`, {
          details: { runId, workerId, diagnostic: previous.initializationError },
        });
      }
      const attempt: InitializationAttempt = { safeToRetry: true };
      try {
        await this.initializeWorker(runId, workerId, agent, signal, attempt);
        this.failedSessions.delete(sessionId);
      } catch (error) {
        const retryable = signal?.aborted === true && attempt.safeToRetry;
        if (retryable) this.failedSessions.delete(sessionId);
        else this.failedSessions.add(sessionId);
        const message = describe(error);
        await this.persistWorker(runId, workerId, (worker) => ({
          ...worker,
          initializationState: retryable ? 'pending' : 'failed',
          initializationError: retryable ? `initialization interrupted: ${message}` : message,
          unavailableReason: retryable ? null : 'initialization_failed',
        })).catch((recordError: unknown) => {
          console.error('[swarm] could not persist worker initialization failure', recordError);
        });
        throw normalizeError(error, 'SWARM_INTERNAL', `initialize worker ${workerId}`);
      }
    });
  }

  /** 读最新记录 → 集成树（若缺）→ 自己的 worktree → ready。 */
  private async initializeWorker(
    runId: RunId,
    workerId: WorkerId,
    agent: Agent,
    signal: AbortSignal | undefined,
    attempt: InitializationAttempt,
  ): Promise<void> {
    signal?.throwIfAborted();
    const run = this.store.get(runId);
    const worker = run.workers[workerId];
    if (worker === undefined) {
      throw new SwarmError('SWARM_NOT_FOUND', `worker ${workerId} is not part of run ${runId}`, {
        details: { runId, workerId },
      });
    }

    await this.persistWorker(runId, workerId, (current) => ({
      ...current,
      initializationState: 'initializing',
      initializationError: null,
      unavailableReason: null,
    }));

    await this.ensureIntegrationWorktree(run, agent, signal, attempt);
    const worktreePath = await this.ensureWorkerWorktree(run, worker, agent, signal, attempt);
    signal?.throwIfAborted();
    if (this.disposed) {
      throw new SwarmError('SWARM_INVALID_STATE', 'worker host was disposed during initialization', {
        details: { runId, workerId },
      });
    }

    await this.persistWorker(runId, workerId, (current) => ({
      ...current,
      worktreePath,
      initializationState: 'ready',
      initializationError: null,
      unavailableReason: null,
    }));
  }

  /**
   * 集成 worktree 只建一次：`swarm-<runId>-build`。
   * 建完后把该 Agent 的 cwd 放回源仓库，后续自建树从源仓库出。
   */
  private async ensureIntegrationWorktree(
    run: Run,
    agent: Agent,
    signal: AbortSignal | undefined,
    attempt: InitializationAttempt,
  ): Promise<void> {
    if (run.integrationWorktree !== null) {
      await requireDirectory(run.integrationWorktree, 'integration worktree');
      return;
    }

    signal?.throwIfAborted();
    attempt.safeToRetry = false;
    const created = await this.requireService('worktrees').create(
      agent,
      { name: `swarm-${run.id}-build`, from: run.baseCommit },
      signal,
    );
    await assertSameRepository(created.repositoryRoot, run.repositoryRoot);
    const integrationPath = await requireDirectory(created.path, 'integration worktree');
    await this.persistRun(run.id, (current) =>
      current.integrationWorktree === null ? { ...current, integrationWorktree: integrationPath } : current,
    );
    attempt.safeToRetry = true; // The created tree is now owned by a persisted record.
    // 回到源仓库；worker 自己的 cwd 必须最终落在私有树。
    await this.requireService('workingDirectory').set(agent, run.repositoryRoot, signal);
  }

  /**
   * worker 私有树：已有记录只核对可访问并切过去；没有记录才按预设 branch 新建。
   *
   * @returns 规范化的 worktree 绝对路径。
   */
  private async ensureWorkerWorktree(
    run: Run,
    worker: WorkerRecord,
    agent: Agent,
    signal: AbortSignal | undefined,
    attempt: InitializationAttempt,
  ): Promise<string> {
    if (worker.worktreePath !== null) {
      const existing = await requireDirectory(worker.worktreePath, `worker ${worker.id} worktree`);
      await this.requireService('workingDirectory').set(agent, existing, signal);
      return existing;
    }

    signal?.throwIfAborted();
    attempt.safeToRetry = false;
    const created = await this.requireService('worktrees').create(
      agent,
      { name: worker.branch, from: run.acceptedHead },
      signal,
    );
    if (created.branch !== worker.branch) {
      throw new SwarmError('SWARM_INVALID_STATE', 'worktree service created a different branch', {
        details: { runId: run.id, workerId: worker.id, expected: worker.branch, actual: created.branch },
      });
    }
    await assertSameRepository(created.repositoryRoot, run.repositoryRoot);
    const worktreePath = await requireDirectory(created.path, `worker ${worker.id} worktree`);
    // Persist the verified location before a cancellable cwd switch. A resume reuses it.
    await this.persistWorker(run.id, worker.id, (current) => ({ ...current, worktreePath }));
    attempt.safeToRetry = true;
    await this.requireService('workingDirectory').set(agent, worktreePath, signal);
    return worktreePath;
  }

  /* ------------------------------------------------------------------ */
  /* 结算回调                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * `subagent/end`：按 child sessionId 匹配已知 worker，用 runId 作为 activationId。
   * 每次冷恢复都是新的 activation，因此每次 end 都可独立上报。
   */
  private onSubagentEnd(info: SubagentRunEndInfo): void {
    if (this.disposed) {
      return;
    }
    const sessionId = String(info.id);
    const held = this.activations.get(sessionId);
    if (held === undefined && this.findWorker(sessionId) === null) {
      return;
    }
    const activationId = String(info.runId);
    if (this.reportedActivations.has(activationId)) {
      return;
    }
    this.reportedActivations.add(activationId);

    const failed = stopReasonFailed(info.stopReason);
    for (const listener of [...this.listeners]) {
      try {
        listener(sessionId, activationId, failed);
      } catch (error) {
        console.error('[dsh-swarm] settled listener failed', { sessionId, activationId }, error);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 状态与持久化                                                        */
  /* ------------------------------------------------------------------ */

  private ownerAgent(sessionId: string): Agent | undefined {
    if (sessionId === '') {
      return undefined;
    }
    return this.optionalService('agents')?.get(SessionId(sessionId));
  }

  /** 读取 Host 服务；缺失或未提供时尽早失败，不静默降级。 */
  private requireService<K extends keyof DshWorkerHostServices>(name: K): DshWorkerHostServices[K] {
    const service = this.optionalService(name);
    if (service === undefined) {
      throw new SwarmError('SWARM_INTERNAL', `host service ${String(name)} is unavailable`, {
        details: { service: String(name) },
      });
    }
    return service;
  }

  private optionalService<K extends keyof DshWorkerHostServices>(
    name: K,
  ): DshWorkerHostServices[K] | undefined {
    return this.ctx.get(String(name)) as DshWorkerHostServices[K] | undefined;
  }

  private requireOwner(ownerSessionId: string): Agent {
    const owner = this.ownerAgent(ownerSessionId);
    if (owner === undefined) {
      // 冷恢复 owner 需要新建父 Agent，这里不做，也不伪造身份。
      throw new SwarmError('SWARM_INVALID_STATE', 'owner session is not live; cannot resume its workers', {
        details: { ownerSessionId },
      });
    }
    return owner;
  }

  private jobRegistry(): DshWorkerHostServices['jobs'] | undefined {
    return this.optionalService('jobs');
  }

  /** 取消该 worker 会话名下的 running/stopping job，并等到真正结束。 */
  private async settleJobs(workerSessionId: string): Promise<void> {
    const jobs = this.jobRegistry();
    if (jobs === undefined) {
      return;
    }
    const caller = SessionId(workerSessionId);
    const live: JobView[] = jobs.list(caller).filter((job) => job.owner === caller && isLiveJob(job.status));
    for (const job of live) {
      try {
        jobs.kill(job.id, caller, 'swarm run stopped');
      } catch (error) {
        throw new SwarmError('SWARM_INTERNAL', `could not cancel job ${job.id}`, {
          details: { workerSessionId, jobId: job.id },
          cause: error,
        });
      }
    }
    for (const job of live) {
      const settled = await jobs.wait(job.id, JOB_DRAIN_TIMEOUT_MS, caller);
      if (isLiveJob(settled.status)) {
        throw new SwarmError('SWARM_INTERNAL', `job ${job.id} did not stop in time`, {
          details: { workerSessionId, jobId: job.id, status: settled.status },
        });
      }
    }
  }

  /** 只更新允许宿主写的 worker 初始化字段；reducer 保持纯同步。 */
  private async persistWorker(
    runId: RunId,
    workerId: WorkerId,
    mutate: (worker: WorkerRecord) => WorkerRecord,
  ): Promise<void> {
    const exists = this.findRun(runId);
    if (exists === null || exists.workers[workerId] === undefined) {
      throw new SwarmError('SWARM_NOT_FOUND', `worker ${workerId} is not part of run ${runId}`, {
        details: { runId, workerId },
      });
    }
    await this.store.update(runId, (run) => {
      const worker = run.workers[workerId];
      if (worker === undefined) {
        return run;
      }
      return {
        ...run,
        workers: { ...run.workers, [workerId]: mutate(worker) },
        revision: run.revision + 1,
        updatedAt: Date.now(),
      };
    });
  }

  private async persistRun(runId: RunId, mutate: (run: Run) => Run): Promise<void> {
    await this.store.update(runId, (run) => {
      const next = mutate(run);
      if (next === run) {
        return run;
      }
      return { ...next, revision: run.revision + 1, updatedAt: Date.now() };
    });
  }

  private findRun(runId: RunId): Run | null {
    try {
      return this.store.get(runId);
    } catch {
      return null;
    }
  }

  /** 在已持久化记录里按 sessionId 定位 worker；不在任何 run 中返回 null。 */
  private findWorker(sessionId: string): { runId: RunId; workerId: WorkerId } | null {
    let runs: Run[];
    try {
      runs = this.store.list();
    } catch {
      return null;
    }
    for (const run of runs) {
      for (const [workerId, worker] of Object.entries(run.workers)) {
        if (worker.sessionId === sessionId) {
          return { runId: run.id, workerId };
        }
      }
    }
    return null;
  }

  private assertActive(operation: string): void {
    if (this.disposed) {
      throw new SwarmError('SWARM_INVALID_STATE', `worker host is disposed (${operation})`);
    }
  }
}

/** 未知 stopReason 不按成功处理；aborted/refusal 是明确非错误。 */
function stopReasonFailed(stopReason: SubagentRunEndInfo['stopReason']): boolean {
  switch (stopReason) {
    case 'completed':
    case 'aborted':
      return false;
    case 'refusal':
    case 'error':
    case 'max-tokens':
      return true;
    default:
      return true;
  }
}

/** 解析并核对目录存在且为目录，返回规范路径。 */
async function requireDirectory(pathname: string, label: string): Promise<string> {
  if (!isAbsolute(pathname)) {
    throw new SwarmError('SWARM_INVALID_STATE', `${label} path is not absolute`, {
      details: { path: pathname },
    });
  }
  let canonical: string;
  try {
    canonical = await realpath(resolvePath(pathname));
  } catch (error) {
    throw new SwarmError('SWARM_INVALID_STATE', `${label} path is not accessible`, {
      details: { path: pathname },
      cause: error,
    });
  }
  const info = await stat(canonical);
  if (!info.isDirectory()) {
    throw new SwarmError('SWARM_INVALID_STATE', `${label} path is not a directory`, {
      details: { path: pathname },
    });
  }
  return canonical;
}

/** worktree 服务报告的源仓库必须就是本次 run 的源仓库。 */
async function assertSameRepository(reported: string, expected: string): Promise<void> {
  const actualRoot = await requireDirectory(reported, 'worktree source repository');
  const expectedRoot = await requireDirectory(expected, 'run repository');
  if (actualRoot !== expectedRoot) {
    throw new SwarmError('SWARM_INVALID_STATE', 'worktree service resolved a different source repository', {
      details: { reported: actualRoot, expected: expectedRoot },
    });
  }
}
