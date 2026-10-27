/**
 * Read-only swarm progress projection shared with the Web UI.
 *
 * This module owns a bounded public DTO derived from the runtime's existing
 * `status(ownerSessionId)` summary plus a small task/worker lookup used to name
 * a worker's current task. It never exposes chat messages, findings bodies,
 * artifacts, Git commands, or any other run-private text, and it never imports
 * React: the browser panel lives in `client.js` and reaches this service
 * through the Typert Gateway.
 *
 * The service extends {@link TypertRemoteService} and marks `snapshot`/`watch`
 * with the protocol's Remote markers. Standard decorator syntax is applied
 * manually because the package build uses esbuild, which cannot compile
 * standard decorators; the resulting markers are identical to `@Remote` /
 * `@Remote({ mode: 'stream' })`.
 *
 * @module @deepseek-ai/dsh-swarm/progress
 */

import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import {
  Remote,
  RemoteError,
  TypertRemoteService,
  remoteMethods,
  type RemoteMethodOptions,
} from '@deepseek-ai/dsh-typert-protocol';
import { isSwarmError } from './errors.ts';
import { isTerminalRunPhase } from './types.ts';
import type { Run, RunPhase, RunId, WorkerInitializationState } from './types.ts';
import type { NativeWorkerStatus, RunStatus, WorkerStatusSummary, TaskCounts } from './runtime.ts';

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requesting session does not own the run being read. */
    'swarm-progress/forbidden': {
      readonly sessionId: string;
      readonly runId: string;
    };
  }
}

/* ------------------------------------------------------------------ */
/* 公共只读 DTO                                                        */
/* ------------------------------------------------------------------ */

/** 单次进度输出的固定上限；保证一帧体积与重连成本有界。 */
export const PROGRESS_LIMITS = Object.freeze({
  sessionIdChars: 200,
  subjectChars: 120,
  diagnosticChars: 200,
  reasonChars: 200,
  refChars: 200,
  workers: 8,
});

/** 一个 worker 当前持有的 task；只含任务板公开字段，不含 acceptance 正文。 */
export interface ProgressTask {
  readonly id: string;
  readonly subject: string;
  readonly status: string;
  readonly revision: number;
}

/** 一个 worker 的原生运行状态；`unavailable` 是插件诊断标签，不是 DSH 状态。 */
export interface ProgressWorker {
  readonly id: string;
  readonly nativeStatus: NativeWorkerStatus;
  readonly initializationState: WorkerInitializationState;
  readonly currentTask: ProgressTask | null;
  /** 原生状态读取失败或初始化失败的有界诊断；成功时为 null。 */
  readonly diagnostic: string | null;
}

/** run 级任务计数，直接来自 runtime 的公开 status。 */
export interface ProgressTaskCounts {
  readonly open: number;
  readonly claimed: number;
  readonly proposed: number;
  readonly done: number;
  readonly blocked: number;
  readonly cancelled: number;
  readonly total: number;
}

export interface ProgressProposalCounts {
  readonly queued: number;
  readonly integrating: number;
  readonly accepted: number;
  readonly rejected: number;
}

export interface ProgressVerificationCounts {
  readonly queued: number;
  readonly running: number;
  readonly passed: number;
  readonly failed: number;
  readonly interrupted: number;
}

/** 面板渲染所需的全部公开事实；不含私信、finding 正文或完整事件日志。 */
export interface ProgressSnapshot {
  readonly runId: RunId;
  readonly phase: RunPhase;
  readonly reason: string | null;
  readonly quiesceTarget: RunStatus['quiesceTarget'];
  readonly budgetExpired: boolean;
  readonly deadline: number;
  readonly now: number;
  /** `max(0, deadline - now)`；不做百分比推算。 */
  readonly remainingMs: number;
  readonly tasks: ProgressTaskCounts;
  readonly workers: readonly ProgressWorker[];
  readonly proposals: ProgressProposalCounts;
  readonly verifications: ProgressVerificationCounts;
  readonly finishRequest: RunStatus['finishRequest'];
  readonly acceptedHead: string;
  readonly baseCommit: string;
  readonly resultRef: string;
  /** 任务板只读视图读取失败时的有界诊断；成功为 null。 */
  readonly detailError: string | null;
  readonly updatedAt: number;
}

/** watch 流的单帧：`progress` 为 null 表示该 owner 当前没有 run。 */
export interface ProgressWatchItem {
  /** 本流内单调递增的帧序号，从 1 开始。 */
  readonly seq: number;
  readonly progress: ProgressSnapshot | null;
}

/** 只读 runtime 端口；真实 `SwarmRuntime` 直接满足。 */
export interface ProgressRuntimePort {
  status(ownerSessionId: string, details?: boolean): RunStatus;
}

/** 任务板/worker 归属的最小只读视图；真实 `Run` 直接满足。 */
export interface ProgressRunDetail {
  readonly tasks: Readonly<Record<string, {
    readonly id: string;
    readonly subject: string;
    readonly status: string;
    readonly revision: number;
  }>>;
  readonly workers: Readonly<Record<string, {
    readonly currentTaskId: string | null;
  }>>;
}

/** 持久化变更通知；只暴露归属与 phase，不转发整条 run。 */
export interface ProgressChange {
  readonly runId: RunId;
  readonly ownerSessionId: string;
  readonly phase: RunPhase;
}

export interface ProgressFeedOptions {
  /** 订阅持久化后的 run 变更；返回取消订阅函数。 */
  readonly subscribe: (listener: (change: ProgressChange) => void) => () => void;
  /** 读取某个 run 的任务板视图；不可用时返回 undefined。 */
  readonly detail?: (runId: RunId) => ProgressRunDetail | undefined;
  /** 测试注入的时钟；默认 `Date.now`。 */
  readonly now?: () => number;
  /**
   * 原生 Agent 状态变更源；回调收到发生变化的 agent 会话 id。
   * 仅用于在 worker 变 idle/running 但尚未写业务记录时刷新面板，
   * feed 会先核对它是否属于当前 run 的 worker。
   */
  readonly agentEvents?: (listener: (agentSessionId: string) => void) => () => void;
}

/* ------------------------------------------------------------------ */
/* 有界化与校验                                                        */
/* ------------------------------------------------------------------ */

/** 截断到上限字符（按 UTF-16 码元），并去掉首尾空白。 */
function bounded(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (text === '') return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function assertSessionId(sessionId: unknown): asserts sessionId is string {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new RemoteError('gateway/bad-request', 'sessionId must be a non-empty string', {
      issues: [{ path: 'sessionId', message: 'must be a non-empty string' }],
    });
  }
  if (sessionId.length > PROGRESS_LIMITS.sessionIdChars) {
    throw new RemoteError('gateway/bad-request', 'sessionId is too long', {
      issues: [{ path: 'sessionId', message: `must be at most ${PROGRESS_LIMITS.sessionIdChars} characters` }],
    });
  }
}

function countTasks(counts: TaskCounts): ProgressTaskCounts {
  return {
    open: counts.open,
    claimed: counts.claimed,
    proposed: counts.proposed,
    done: counts.done,
    blocked: counts.blocked,
    cancelled: counts.cancelled,
    total: counts.total,
  };
}

function currentTask(
  worker: WorkerStatusSummary,
  detail: ProgressRunDetail | undefined,
): ProgressTask | null {
  if (worker.currentTaskId === null || detail === undefined) return null;
  const task = detail.tasks[worker.currentTaskId];
  if (task === undefined) return null;
  return {
    id: task.id,
    subject: bounded(task.subject, PROGRESS_LIMITS.subjectChars) ?? '',
    status: task.status,
    revision: task.revision,
  };
}

function diagnosticOf(worker: WorkerStatusSummary): string | null {
  return bounded(
    worker.nativeStatusError ?? worker.unavailableReason ?? worker.initializationError,
    PROGRESS_LIMITS.diagnosticChars,
  );
}

/**
 * 把 runtime 的公开摘要转成面板 DTO。
 *
 * @param status - `runtime.status(sessionId)` 的返回值（已不含私信正文）。
 * @param detail - 用于补全 worker 当前 task 的最小视图，可为空。
 * @param now - 生成时间（毫秒）。
 * @returns 有界的公开快照；不需要任何 DSH 状态。
 */
export function toProgressSnapshot(
  status: RunStatus,
  detail: ProgressRunDetail | undefined,
  now: number,
  detailError: string | null = null,
): ProgressSnapshot {
  return {
    runId: status.runId,
    phase: status.phase,
    reason: bounded(status.reason, PROGRESS_LIMITS.reasonChars),
    quiesceTarget: status.quiesceTarget,
    budgetExpired: status.budgetExpired,
    deadline: status.deadline,
    now,
    remainingMs: Math.max(0, status.deadline - now),
    tasks: countTasks(status.tasks),
    workers: status.workers.slice(0, PROGRESS_LIMITS.workers).map((worker) => ({
      id: worker.id,
      nativeStatus: worker.nativeStatus,
      initializationState: worker.initializationState,
      currentTask: currentTask(worker, detail),
      diagnostic: diagnosticOf(worker),
    })),
    proposals: {
      queued: status.proposals.queued,
      integrating: status.proposals.integrating,
      accepted: status.proposals.accepted,
      rejected: status.proposals.rejected,
    },
    verifications: {
      queued: status.verifications.queued,
      running: status.verifications.running,
      passed: status.verifications.passed,
      failed: status.verifications.failed,
      interrupted: status.verifications.interrupted,
    },
    finishRequest:
      status.finishRequest === null
        ? null
        : {
            id: status.finishRequest.id,
            acceptedHead: status.finishRequest.acceptedHead,
            verificationId: status.finishRequest.verificationId,
          },
    acceptedHead: bounded(status.acceptedHead, PROGRESS_LIMITS.refChars) ?? '',
    baseCommit: bounded(status.baseCommit, PROGRESS_LIMITS.refChars) ?? '',
    resultRef: bounded(status.resultRef, PROGRESS_LIMITS.refChars) ?? '',
    detailError,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* 可测试的 feed（无 Cordis 依赖）                                     */
/* ------------------------------------------------------------------ */

/**
 * 事件驱动的进度源。`watch` 只在持久化变更后重算快照，不轮询，也不触发
 * command/run 日志；run 进入终态后流自然结束。
 */
interface ProgressWatcher {
  readonly notify: () => void;
  readonly close: () => void;
}

export class ProgressFeed {
  private readonly runtime: ProgressRuntimePort;
  private readonly options: ProgressFeedOptions;
  private readonly now: () => number;
  /** owner 会话 id -> 该会话各 watch 的通知/关闭句柄。 */
  private readonly watchers = new Map<string, Set<ProgressWatcher>>();
  private readonly unsubscribeAgent: (() => void) | undefined;
  private disposed = false;

  constructor(runtime: ProgressRuntimePort, options: ProgressFeedOptions) {
    this.runtime = runtime;
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.unsubscribeAgent = options.agentEvents?.((agentSessionId) => this.onAgentEvent(agentSessionId));
  }

  /**
   * 原生 agent 状态变化：只有属于某个 watcher 的 run worker 才重算该 watcher，
   * 避免其他会话的模型的 idle/running 抖动影响本面板。
   */
  private onAgentEvent(agentSessionId: string): void {
    for (const [ownerSessionId, watchers] of [...this.watchers]) {
      let belongs = false;
      try {
        const status = this.runtime.status(ownerSessionId);
        belongs = status.workers.some((worker) => worker.sessionId === agentSessionId);
      } catch (error) {
        // 没有 run 只是无关事件；其他读取失败通过下一次快照显式暴露给订阅者。
        if (isSwarmError(error) && error.code === 'SWARM_NOT_FOUND') continue;
        for (const watcher of [...watchers]) watcher.notify();
        continue;
      }
      if (belongs) {
        for (const watcher of [...watchers]) watcher.notify();
      }
    }
  }

  /**
   * 读取 owner 当前（或最近一次）run 的公开进度。
   *
   * @returns 没有 run 时 null；runtime 报告归属不符时抛 `swarm-progress/forbidden`。
   */
  snapshot(sessionId: string): ProgressSnapshot | null {
    assertSessionId(sessionId);
    if (this.disposed) {
      throw new RemoteError('gateway/internal', 'swarm progress feed is disposed', {});
    }
    let status: RunStatus;
    try {
      status = this.runtime.status(sessionId);
    } catch (error) {
      if (isSwarmError(error) && error.code === 'SWARM_NOT_FOUND') return null;
      throw error;
    }
    if (status.ownerSessionId !== sessionId) {
      throw new RemoteError(
        'swarm-progress/forbidden',
        'session may not read another session\'s swarm run',
        { sessionId, runId: status.runId },
      );
    }
    let detail: ProgressRunDetail | undefined;
    let detailError: string | null = null;
    try {
      detail = this.options.detail?.(status.runId);
    } catch (error) {
      // NOT_FOUND 视为没有补全视图；其他失败保留可见诊断，不静默变成“没有任务”。
      if (!(isSwarmError(error) && error.code === 'SWARM_NOT_FOUND')) {
        detailError = bounded(error instanceof Error ? error.message : String(error), PROGRESS_LIMITS.diagnosticChars)
          ?? 'task detail unavailable';
      }
      detail = undefined;
    }
    return toProgressSnapshot(status, detail, this.now(), detailError);
  }

  /**
   * 先从当前快照开始，之后每个与 owner 相关的持久化变更后重算一帧；快照不变时
   * 不重复发送。终态 run 发送最后一帧后结束。`signal` 取消只结束本次读取。
   */
  async *watch(sessionId: string, signal?: AbortSignal): AsyncIterable<ProgressWatchItem> {
    assertSessionId(sessionId);
    if (this.disposed) {
      throw new RemoteError('gateway/internal', 'swarm progress feed is disposed', {});
    }
    if (signal?.aborted === true) return;

    let seq = 0;
    let pending = false;
    let closed = false;
    let last: string | null = null;
    let wake: (() => void) | null = null;
    const notify = (): void => {
      pending = true;
      wake?.();
    };
    const stop = (): void => {
      closed = true;
      wake?.();
    };
    const unsubscribe = this.options.subscribe((change) => {
      if (change.ownerSessionId === sessionId) notify();
    });
    const watcher: ProgressWatcher = { notify, close: stop };
    const watchers = this.watchers.get(sessionId) ?? new Set<ProgressWatcher>();
    watchers.add(watcher);
    this.watchers.set(sessionId, watchers);
    signal?.addEventListener('abort', stop, { once: true });
    try {
      while (!closed) {
        pending = false;
        const progress = this.snapshot(sessionId);
        // 变更通知可能由与本 run 无关的字段触发；内容不变时保持单帧，避免刷屏。
        const serialized = JSON.stringify(progress);
        if (serialized !== last) {
          last = serialized;
          yield { seq: ++seq, progress };
        }
        if (progress !== null && isTerminalRunPhase(progress.phase)) return;
        while (!closed && !pending) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
      }
    } finally {
      watchers.delete(watcher);
      if (watchers.size === 0) this.watchers.delete(sessionId);
      signal?.removeEventListener('abort', stop);
      unsubscribe();
    }
  }

  /** 结束全部 watch 并拒绝后续读取；可重复调用。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const watchers of [...this.watchers.values()]) {
      for (const watcher of [...watchers]) watcher.close();
    }
    this.watchers.clear();
    this.unsubscribeAgent?.();
  }
}

/* ------------------------------------------------------------------ */
/* Host Remote 服务                                                    */
/* ------------------------------------------------------------------ */

/**
 * 把 Remote 标记直接安装到原型上。
 *
 * `@Remote` 的标准装饰器语义被等价展开：先取标记，再以实例语义执行它注册的
 * initializer。这样源码保持 esbuild 可编译，同时 `remoteMethods()` 与 Gateway
 * 的 SRC 发现行为与生成装饰器一致。
 */
type RemoteMethod = (this: object, ...args: unknown[]) => unknown;

function markRemoteMethod(
  prototype: object,
  method: string,
  options?: Pick<RemoteMethodOptions<unknown[]>, 'mode' | 'name'>,
): void {
  const initializers: Array<(this: object) => void> = [];
  const context = {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    access: {
      has: (target: object): boolean => method in target,
      get: (target: object): RemoteMethod => Reflect.get(target, method) as RemoteMethod,
    },
    addInitializer: (initializer: (this: object) => void): void => {
      initializers.push(initializer);
    },
    metadata: undefined,
  } satisfies ClassMethodDecoratorContext<object, RemoteMethod>;
  const target = Reflect.get(prototype, method) as RemoteMethod;
  if (options?.mode === 'stream') {
    Remote({ mode: 'stream' })(target, context);
  } else if (options?.name !== undefined) {
    Remote(options.name)(target, context);
  } else {
    Remote(target, context);
  }
  const instance = Object.create(prototype) as object;
  for (const initializer of initializers) initializer.call(instance);
}

/** Host 侧只读进度服务；服务键与 Remote 命名空间均为 `swarmProgress`。 */
export class ProgressService extends TypertRemoteService<never> {
  private readonly feed: ProgressFeed;

  constructor(ctx: Context, runtime: ProgressRuntimePort, options: ProgressFeedOptions) {
    super(ctx, 'swarmProgress');
    this.feed = new ProgressFeed(runtime, options);
  }

  /** 当前快照；没有 run 时返回 null。 */
  snapshot(sessionId: string): ProgressSnapshot | null {
    return this.feed.snapshot(sessionId);
  }

  /** 事件驱动的进度流；取消只结束本次读取。 */
  watch(sessionId: string, signal?: AbortSignal): AsyncIterable<ProgressWatchItem> {
    return this.feed.watch(sessionId, signal);
  }

  /** 停止全部 watch；由 Host 卸载时调用。 */
  async dispose(): Promise<void> {
    await this.feed.dispose();
  }
}

// 模块加载时安装标记（幂等）。prototype 上的 SRC 方法名来自真实参数名，
// 因此 snapshot/watch 必须保持简单的具名参数。
markRemoteMethod(ProgressService.prototype, 'snapshot');
markRemoteMethod(ProgressService.prototype, 'watch', { mode: 'stream' });

/** 构造后即可用的进度服务；调用方负责在卸载时 `dispose()`。 */
export function registerProgress(
  ctx: Context,
  runtime: ProgressRuntimePort,
  store: {
    get(id: RunId): Run;
    subscribe(listener: (run: Run) => void): () => void;
  },
  options: { now?: () => number } = {},
): ProgressService {
  return new ProgressService(ctx, runtime, {
    subscribe: (listener) =>
      store.subscribe((run) => {
        listener({ runId: run.id, ownerSessionId: run.ownerSessionId, phase: run.phase });
      }),
    detail: (runId) => store.get(runId),
    agentEvents: (listener) => {
      const disposers = [
        ctx.on('agent/status', ({ agent }) => listener(agent.id)),
        ctx.on('agent/disposed', ({ agent }) => listener(agent.id)),
      ];
      return () => {
        for (const dispose of disposers) dispose();
      };
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

/** 供接线与测试核对：当前导出的 Remote 方法标记。 */
export function progressRemoteMethods(): readonly {
  readonly method: string;
  readonly mode?: 'stream';
}[] {
  const instance = Object.create(ProgressService.prototype) as object;
  return remoteMethods(instance).map((marker) => ({
    method: marker.method,
    ...(marker.mode === undefined ? {} : { mode: marker.mode }),
  }));
}

