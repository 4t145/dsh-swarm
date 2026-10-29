/**
 * Swarm run 控制面。
 *
 * 职责（架构 §8.4 / §10）：
 * - run 生命周期：preparing→running、pause/resume/stop、quiescing→终态、deadline 预算；
 * - 预留 worker 记录，创建 Collaboration / Delivery / IntegrationQueue 三件套；
 * - 每个 run 的 admission：登记在途操作、发放 AbortSignal，关闭后不再登记；
 * - publicationGate（KeyedSerialQueue）与 IntegrationQueue 共用同一把短门禁；
 * - submit / finish 的幂等受理，异步托管集成与最终收尾。
 *
 * 不负责：模型调用、Git 实现、通知编码（分别由 Host / workspace / Delivery 负责）。
 * 本模块所有 store reducer 都是纯同步函数；Git、命令和模型都在门禁之外可取消。
 */

import { randomUUID } from 'node:crypto';
import { Collaboration } from './collaboration.ts';
import { PublicCollaboration } from './public-collaboration.ts';
import { Delivery } from './delivery.ts';
import { SwarmError, isSwarmError, normalizeError } from './errors.ts';
import { appendEvent, type EventInput } from './events.ts';
import { IntegrationQueue } from './integration.ts';
import {
  systemClock,
  verificationFingerprint,
  type ArtifactPort,
  type Clock,
  type RepositoryInfo,
  type WorkerHost,
  type WorkspacePort,
} from './ports.ts';
import { DEFAULT_RUNTIME_CONFIG } from './schema.ts';
import { MIN_WORKERS } from './spec.ts';
import { assertWorkerLimit, positiveLimit, type WorkerLimit, type WorkerLimitResolver, type WorkerControls } from './worker-limit.ts';
import { randomWorkerName, workerDisplayName } from './worker-names.ts';
import { KeyedSerialQueue } from './serial.ts';
import type { StateStore } from './store.ts';
import {
  createRun,
  activeAcceptanceCriteria,
  isTerminalRunPhase,
  type GoalRecord,
  type AppendGoalInput,
  type AppendGoalReceipt,
  type AddWorkerReceipt,
  type AcceptanceNote,
  type CommitSha,
  type FinishRequest,
  type MutationReceipt,
  type ProposalRecord,
  type QuiesceTarget,
  type Run,
  type RunId,
  type RunPhase,
  type RunSpec,
  type TaskId,
  type VerificationRecord,
  type WorkerId,
  type WorkerInitializationState,
  type WorkerRecord,
} from './types.ts';

/* ------------------------------------------------------------------ */
/* 公开结果类型                                                         */
/* ------------------------------------------------------------------ */

/** `start` 等构造函数可注入的可调值；协议不变量不在这里。 */
export interface SwarmRuntimeOptions {
  clock?: Clock;
  id?: () => string;
  eventPageSize?: number;
  /** Required for admission; absence is a capability error, never a numeric fallback. */
  workerLimit?: WorkerLimitResolver;
}

/** `finish` 的两种受理结果；两种都不是“成功完成”。 */
export interface FinishAccepted {
  status: 'accepted';
  finishRequestId: string;
  verificationId: string | null;
}

export interface FinishAlreadyFinishing {
  status: 'already_finishing';
  finishRequestId: string;
  verificationId: string | null;
}

export type FinishDecision = FinishAccepted | FinishAlreadyFinishing;

/** 原生 worker 状态；`unavailable` 是插件诊断标签，不是伪造的 DSH 状态。 */
export type NativeWorkerStatus = 'running' | 'inactive' | 'unavailable';

export interface WorkerStatusSummary {
  id: WorkerId;
  displayName?: string;
  sessionId: string;
  initializationState: WorkerInitializationState;
  nativeStatus: NativeWorkerStatus;
  /** 读取原生状态失败时的诊断；为 null 表示读取成功。 */
  nativeStatusError: string | null;
  currentTaskId: TaskId | null;
  worktreePath: string | null;
  unavailableReason: string | null;
  initializationError: string | null;
}

export interface TaskCounts {
  open: number;
  claimed: number;
  proposed: number;
  done: number;
  blocked: number;
  cancelled: number;
  total: number;
}

export interface WorkerCursorDetail {
  id: WorkerId;
  offeredSeq: number;
  observedSeq: number;
  wakeTargetSeq: number;
  notifiedSeq: number;
  waitRegistration: WorkerRecord['waitRegistration'];
  inFlightOperations: number;
}

/** `--details` 的附加字段；每页最多 `eventPageSize` 项，不给完整日志。 */
export interface RunStatusDetails {
  workers: WorkerCursorDetail[];
  goalRecords: GoalRecord[];
  integrationAttempts: {
    id: string;
    proposalId: string;
    expectedHead: CommitSha;
    candidateCommit: CommitSha | null;
    status: string;
  }[];
  proposals: { id: string; taskId: string; status: string; sourceCommit: CommitSha }[];
  verifications: { id: string; purpose: string; status: string; commit: CommitSha }[];
  inFlightOperations: number;
  admission: 'open' | 'closed';
  eventCount: number;
  lastEventSeq: number;
  messageCount: number;
  mutationReceiptCount: number;
  /** 进程内同步 status 不读 Git；实际 resultRef 由 commands/Host 异步核对。 */
  resultRefConsistency: 'unverified';
}

/** status 的摘要输出：JSON 兼容、有界，不含消息正文。 */
export interface RunStatus {
  runId: RunId;
  ownerSessionId: string;
  phase: RunPhase;
  reason: string | null;
  quiesceTarget: QuiesceTarget | null;
  deadline: number | null;
  now: number;
  budgetExpired: boolean;
  baseCommit: CommitSha;
  acceptedHead: CommitSha;
  resultRef: string;
  integrationWorktree: string | null;
  tasks: TaskCounts;
  goalRevision: number;
  goals: { active: number; deferred: number; completed: number; total: number };
  workers: WorkerStatusSummary[];
  workerControls?: WorkerControls;
  proposals: { queued: number; integrating: number; accepted: number; rejected: number };
  verifications: { queued: number; running: number; passed: number; failed: number; interrupted: number };
  finishRequest: { id: string; acceptedHead: CommitSha; verificationId: string | null } | null;
  admission: 'open' | 'closed';
  diagnostics: string[];
  details?: RunStatusDetails;
}

/* ------------------------------------------------------------------ */
/* 内部记账                                                             */
/* ------------------------------------------------------------------ */

/** 在途操作种类；`create` / `notify` 由 Delivery 申请，其余属于控制面自身。 */
type OperationKind = 'start' | 'create' | 'notify' | 'submit' | 'finish';

/** 一次登记在途的操作；`finish` 幂等，`settled` 在 release 后结算。 */
interface ActiveOperation {
  readonly kind: OperationKind;
  readonly workerId: WorkerId | null;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  finish(): void;
}

interface RunControlState {
  /** admission 关闭后不得再登记新操作。 */
  admissionClosed: boolean;
  readonly operations: Set<ActiveOperation>;
  /** 订阅驱动的最终收尾是否已尝试过（失败也不自动重试，避免通知循环）。 */
  completionAttempted: boolean;
  timer: (() => void) | null;
}

const MAX_DIAGNOSTICS = 10;

/**
 * quiescing 目标优先级：用户 stop > 基础设施失败 > 预算耗尽 > 用户 pause > completed。
 * 数值只在同一 run 内比较，不对外暴露。
 */
const TARGET_RANK: Record<QuiesceTarget, number> = {
  completed: 0,
  paused: 1,
  stopped: 2,
  failed: 3,
};

function reasonRank(target: QuiesceTarget, reason: string | null): number {
  if (target === 'stopped' && reason === 'user_stop') {
    return 4;
  }
  return TARGET_RANK[target];
}

/** 把新的控制请求并入已有 quiescing 目标，取优先级更高者。 */
function mergeQuiesce(
  existing: { target: QuiesceTarget | null; reason: string | null },
  next: { target: QuiesceTarget; reason: string },
): { target: QuiesceTarget; reason: string } {
  if (existing.target === null) {
    return next;
  }
  const existingRank = reasonRank(existing.target, existing.reason);
  const nextRank = reasonRank(next.target, next.reason);
  if (nextRank <= existingRank) {
    return { target: existing.target, reason: existing.reason ?? next.reason };
  }
  return next;
}

function errorMessage(error: unknown): string {
  if (isSwarmError(error)) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ */
/* 控制面                                                              */
/* ------------------------------------------------------------------ */

export class SwarmRuntime {
  private readonly store: StateStore;
  private readonly host: WorkerHost;
  private readonly workspace: WorkspacePort;
  private readonly artifacts: ArtifactPort;
  private readonly clock: Clock;
  private readonly makeId: () => string;
  private readonly eventPageSize: number;
  private readonly workerLimit: WorkerLimitResolver;
  /** Serialize owner goal intake with an explicit next-round transfer. */
  private readonly goalIntake = new KeyedSerialQueue();

  /** 发布临界区与控制临界区共用的短门禁；长测试必须在门禁之外。 */
  private readonly publicationGate: KeyedSerialQueue;
  /** Serialize only repository reservation, not long worker execution. */
  private readonly repositoryAdmissions = new KeyedSerialQueue();

  /** 协作业务规则入口；worker 工具与命令层共用同一个实例。 */
  readonly collaboration: Collaboration;
  /** Public discussion shares the exact same durable aggregate and lifecycle phase gate. */
  readonly publicCollaboration: PublicCollaboration;

  private readonly delivery: Delivery;
  private readonly integration: IntegrationQueue;

  private readonly controls = new Map<RunId, RunControlState>();
  private readonly diagnostics = new Map<RunId, string[]>();
  private readonly hosted = new Set<Promise<void>>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(
    store: StateStore,
    host: WorkerHost,
    workspace: WorkspacePort,
    artifacts: ArtifactPort,
    options: SwarmRuntimeOptions = {},
  ) {
    this.store = store;
    this.host = host;
    this.workspace = workspace;
    this.artifacts = artifacts;
    this.clock = options.clock ?? systemClock;
    this.makeId = options.id ?? (() => randomUUID());
    this.eventPageSize = options.eventPageSize ?? DEFAULT_RUNTIME_CONFIG.eventPageSize;
    this.workerLimit = options.workerLimit ?? (() => {
      throw new SwarmError('SWARM_CONFIG_UNAVAILABLE', 'no effective worker-limit resolver is available');
    });

    this.publicationGate = new KeyedSerialQueue();
    // Collaboration / IntegrationQueue 的选项都用 `now: () => Millis`，与 Runtime 的 Clock 适配。
    this.collaboration = new Collaboration(store, {
      now: () => this.clock.now(),
      id: this.makeId,
      eventPageSize: this.eventPageSize,
    });
    this.publicCollaboration = new PublicCollaboration(store, { now: () => this.clock.now(), id: this.makeId });
    this.delivery = new Delivery(store, host, {
      admitWorkerOperation: (runId, workerId, kind) => this.admitWorkerOperation(runId, workerId, kind),
      onError: (runId, error) => {
        const workerFailure = isSwarmError(error) &&
          (error.code === 'SWARM_WORKER_BUSY' || typeof error.details?.['activationId'] === 'string');
        if (workerFailure) {
          this.recordDiagnostic(runId, errorMessage(error));
          console.error('[swarm] worker activation failed:', errorMessage(error));
          this.trackGuarded(this.controlTransition(runId, 'paused', 'worker_activation_failed').then(() => undefined), runId, 'worker pause failed');
        } else {
          this.trackGuarded(this.failRun(runId, 'delivery_error', error), runId, 'delivery failure cleanup failed');
        }
      },
    });
    this.integration = new IntegrationQueue(store, workspace, artifacts, this.publicationGate, {
      now: () => this.clock.now(),
      id: this.makeId,
    });
    this.unsubscribe = store.subscribe((run) => this.observeRun(run));
  }

  /* ---------------------------------------------------------------- */
  /* 用户控制                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 启动一次 run。
   *
   * 顺序：owner 在线 → 核对仓库与基线 → 预留 worker 并持久化 → 通过 Delivery 启动第一个
   * worker（它负责创建 integration worktree 与自己 worktree 并写 ready）→ 置 running →
   * 其余 worker 异步初始化。任何初始化失败都会先把本 run 收尾为 failed 再抛错。
   *
   * @throws SwarmError 参数非法、owner 离线、仓库脏、同仓库已有非终态 run、初始化失败。
   */
  async start(ownerSessionId: string, spec: RunSpec): Promise<Run> {
    return this.startRun(ownerSessionId, spec);
  }

  private async startRun(ownerSessionId: string, spec: RunSpec, continuation?: { source: Run; goals: GoalRecord[] }): Promise<Run> {
    this.assertUsable('start');
    validateStartInput(ownerSessionId, spec);
    if (!this.host.isOwnerLive(ownerSessionId)) {
      throw new SwarmError('SWARM_FORBIDDEN', 'owner session is not live', {
        details: { ownerSessionId },
      });
    }

    assertWorkerLimit(spec.workers, this.resolveWorkerLimit(ownerSessionId));
    const runId = this.makeId();
    const operation = await this.admitOperation(runId, 'start', null);
    let persisted = false;
    try {
      const info = await this.workspace.inspect(spec, ownerSessionId, operation.controller.signal);
      this.assertCleanBaseline(spec, info);

      const now = this.clock.now();
      const run = createRun({
        id: runId,
        ownerSessionId,
        repositoryRoot: info.repositoryRoot,
        gitCommonDir: info.gitCommonDir,
        goal: spec.goal,
        acceptanceCriteria: spec.acceptanceCriteria,
        verification: spec.verification,
        baseCommit: info.baseCommit,
        resultRef: `refs/heads/swarm-${runId}-result`,
        deadline: spec.budgetMinutes === 0 ? null : now + spec.budgetMinutes * 60_000,
        specPath: spec.specPath,
        budgetMinutes: spec.budgetMinutes,
        allowDirtyBaseline: spec.allowDirtyBaseline,
        createdAt: now,
      });
      if (continuation) {
        run.continuedFromRunId = continuation.source.id;
        run.goalRevision = continuation.goals.length;
        for (const goal of continuation.goals) {
          run.goals[goal.id] = { ...goal, seq: run.nextSeq, status: 'active', continuedInRunId: null };
          appendEvent(run, { kind: 'goal', goalId: goal.id, status: 'active', authorWorkerId: null, audience: { kind: 'all' } }, now);
        }
      }
      await this.repositoryAdmissions.run(info.gitCommonDir, async () => {
        operation.controller.signal.throwIfAborted();
        this.assertRepositoryIdle(info.gitCommonDir);
        await this.store.create({ ...run, workers: reserveWorkers(run, spec.workers, now) });
        persisted = true;
        if (continuation) {
          await this.store.update(continuation.source.id, (source) => {
            const goals = { ...source.goals };
            for (const goal of continuation.goals) {
              const previous = goals[goal.id];
              if (previous) goals[goal.id] = { ...previous, continuedInRunId: run.id };
            }
            return this.finalizeChange({ ...source, goals }, [], now);
          });
        }
      });
      await this.workspace.initializeResult(this.store.get(runId), operation.controller.signal);
      this.armDeadline(this.store.get(runId));

      const workerIds = Object.keys(this.store.get(runId).workers);
      const first = workerIds[0];
      if (first === undefined) {
        throw new SwarmError('SWARM_INTERNAL', 'run was created without reserved workers', {
          details: { runId },
        });
      }
      await this.delivery.start(runId, first);
      const running = await this.markRunning(runId);
      for (const workerId of workerIds.slice(1)) {
        this.startWorker(runId, workerId);
      }
      return running;
    } catch (error) {
      const failure = normalizeError(error, 'SWARM_INTERNAL', `start run ${runId}`);
      operation.finish();
      if (persisted) {
        await this.failRun(runId, 'worker_initialization_failed', failure);
      } else {
        this.controls.delete(runId);
        this.diagnostics.delete(runId);
      }
      throw failure;
    } finally {
      operation.finish();
    }
  }

  /** Reserve one named member atomically; paused runs wait for explicit resume before creating it. */
  async addWorker(ownerSessionId: string): Promise<AddWorkerReceipt> {
    this.assertUsable('addWorker');
    if (!this.host.isOwnerLive(ownerSessionId)) throw new SwarmError('SWARM_FORBIDDEN', 'owner session is not live');
    const run = this.runForStatus(ownerSessionId);
    const reservation = await this.publicationGate.run(run.id, async () => {
      this.assertUsable('addWorker');
      const current = this.requireRun(run.id);
      if (current.phase !== 'running' && current.phase !== 'paused') {
        throw new SwarmError('SWARM_NOT_RUNNING', `cannot add a worker while run is ${current.phase}`);
      }
      if (current.phase === 'running' && this.control(run.id).admissionClosed) {
        throw new SwarmError('SWARM_NOT_RUNNING', 'run admission is closed');
      }
      if (current.phase === 'running' && current.deadline !== null && this.clock.now() >= current.deadline) {
        throw new SwarmError('SWARM_BUDGET_EXHAUSTED', 'run budget expired');
      }
      assertWorkerLimit(Object.keys(current.workers).length + 1, this.resolveWorkerLimit(ownerSessionId));
      const now = this.clock.now();
      const worker = reserveWorker(current, now);
      const updated = await this.store.update(run.id, (latest) => this.finalizeChange(
        { ...latest, workers: { ...latest.workers, [worker.id]: worker } },
        [{ kind: 'run', phase: latest.phase, target: null, reason: 'worker_added', authorWorkerId: null, audience: { kind: 'all' } }], now));
      return { worker, phase: updated.phase };
    });
    const { worker } = reservation;
    if (reservation.phase === 'paused') {
      return { runId: run.id, workerId: worker.id, displayName: workerDisplayName(worker), phase: 'paused', disposition: 'paused' };
    }
    try {
      await this.delivery.start(run.id, worker.id);
    } catch (error) {
      // A concurrent pause/stop owns cleanup; never turn its cancellation into a failed run.
      if (this.requireRun(run.id).phase === 'running') await this.failRun(run.id, 'worker_initialization_failed', error);
      throw normalizeError(error, 'SWARM_INTERNAL', `worker ${worker.id} was reserved but could not start; inspect members before retrying`);
    }
    const phase = this.requireRun(run.id).phase;
    if (phase !== 'running') throw new SwarmError('SWARM_NOT_RUNNING', `worker ${worker.id} was reserved; run is now ${phase}`);
    return { runId: run.id, workerId: worker.id, displayName: workerDisplayName(worker), phase, disposition: 'started' };
  }

  /** Persist an owner addition; closing/terminal rounds retain it as explicit next-round backlog. */
  async appendGoal(ownerSessionId: string, input: AppendGoalInput, callId: string): Promise<AppendGoalReceipt> {
    this.assertUsable('appendGoal');
    if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 16_000
      || typeof callId !== 'string' || !callId.trim()
      || (input.acceptanceCriteria !== undefined && (!Array.isArray(input.acceptanceCriteria)
        || input.acceptanceCriteria.length === 0 || input.acceptanceCriteria.length > 32
        || input.acceptanceCriteria.some((criterion) => typeof criterion !== 'string' || !criterion.trim() || criterion.length > 2_000)))) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'a goal needs non-empty text and optional non-empty acceptance criteria');
    }
    return this.goalIntake.run(ownerSessionId, async () => {
      this.assertUsable('appendGoal');
      if (!this.host.isOwnerLive(ownerSessionId)) throw new SwarmError('SWARM_FORBIDDEN', 'owner session is not live');
      const run = this.runForStatus(ownerSessionId);
      const key = receiptKeyFor(ownerSessionId, callId);
      // Lookup spans rounds so a retried tool call cannot duplicate an addition after continuation.
      for (const owned of this.store.list().filter((candidate) => candidate.ownerSessionId === ownerSessionId)) {
        const prior = owned.mutationReceipts[key];
        if (prior?.method === 'appendGoal' && typeof prior.result === 'string') return JSON.parse(prior.result) as AppendGoalReceipt;
      }
      let result: AppendGoalReceipt | null = null;
      await this.publicationGate.run(run.id, async () => {
        await this.store.update(run.id, (current) => {
          const active = current.phase === 'preparing' || current.phase === 'running' || current.phase === 'paused';
          const now = this.clock.now();
          const goal: GoalRecord = { id: this.makeId(), seq: current.nextSeq, text: input.text.trim(),
            acceptanceCriteria: (input.acceptanceCriteria ?? [input.text]).map((criterion) => criterion.trim()),
            status: active ? 'active' : 'deferred', createdAt: now, completedAt: null,
            completedCommit: null, continuedInRunId: null };
          const goalRevision = current.goalRevision + (active ? 1 : 0);
          result = { runId: current.id, goal, phase: current.phase, goalRevision,
            disposition: !active ? 'deferred' : current.phase === 'paused' ? 'paused' : 'executing' };
          return this.finalizeChange({ ...current, goals: { ...current.goals, [goal.id]: goal }, goalRevision,
            mutationReceipts: { ...current.mutationReceipts,
              [key]: this.receipt(key, ownerSessionId, callId, 'appendGoal', JSON.stringify(result)) } },
            [{ kind: 'goal', goalId: goal.id, status: goal.status, authorWorkerId: null, audience: { kind: 'all' } }], now);
        });
      });
      if (result === null) throw new SwarmError('SWARM_INTERNAL', 'goal intake produced no receipt');
      return result;
    });
  }

  /** Explicitly start a fresh round for pending additions; never resumes a stopped/failed run. */
  async continueGoals(ownerSessionId: string): Promise<Run> {
    this.assertUsable('continueGoals');
    return this.goalIntake.run(ownerSessionId, async () => {
      this.assertUsable('continueGoals');
      const source = this.runForStatus(ownerSessionId);
      if (!isTerminalRunPhase(source.phase)) {
        throw new SwarmError('SWARM_INVALID_STATE', 'continue requires a terminal run; use resume for a paused run');
      }
      const goals = Object.values(source.goals).filter((goal) => goal.status !== 'completed' && goal.continuedInRunId === null);
      if (goals.length === 0) throw new SwarmError('SWARM_INVALID_STATE', 'no pending goals to continue');
      return this.startRun(ownerSessionId, {
        specPath: source.specPath ?? source.repositoryRoot,
        repository: source.repositoryRoot, baseRef: source.acceptedHead,
        goal: goals.map((goal) => goal.text).join('\n\n'),
        acceptanceCriteria: [...new Set(goals.flatMap((goal) => goal.acceptanceCriteria))],
        workers: Object.keys(source.workers).length,
        budgetMinutes: 0, allowDirtyBaseline: source.allowDirtyBaseline, verification: source.verification,
      }, { source, goals });
    });
  }

  /**
   * 只读状态。摘要总是可用；`details` 追加 cursor、attempt 与诊断，不触发模型或测试。
   *
   * @throws SwarmError owner 名下没有任何 run 时 `SWARM_NOT_FOUND`。
   */
  /** Owner-scoped snapshot for asynchronous Git inspection by the command adapter. */
  runForOwner(ownerSessionId: string): Run {
    this.assertUsable('runForOwner');
    return this.runForStatus(ownerSessionId);
  }

  /** Shared fresh policy read for all admission and status paths. */
  private resolveWorkerLimit(ownerSessionId: string): WorkerLimit {
    const limit = this.workerLimit(ownerSessionId);
    positiveLimit(limit.maxWorkers, 'effective worker limit');
    if (limit.source !== 'host' && limit.source !== 'override') {
      throw new SwarmError('SWARM_CONFIG_UNAVAILABLE', 'effective worker limit has an unknown source');
    }
    return limit;
  }

  private workerControls(run: Run, control: RunControlState, now: number): WorkerControls {
    try {
      const limit = this.resolveWorkerLimit(run.ownerSessionId);
      return { ...limit, diagnostic: null,
        canAdd: (run.phase === 'paused' || (run.phase === 'running' && !control.admissionClosed
          && (run.deadline === null || now < run.deadline))) && Object.keys(run.workers).length < limit.maxWorkers };
    } catch (error) {
      return { canAdd: false, maxWorkers: null, source: null, diagnostic: errorMessage(error) };
    }
  }

  status(ownerSessionId: string, details = false): RunStatus {
    this.assertUsable('status');
    const run = this.runForStatus(ownerSessionId);
    const control = this.control(run.id);
    const now = this.clock.now();
    return {
      runId: run.id,
      ownerSessionId: run.ownerSessionId,
      phase: run.phase,
      reason: run.reason,
      quiesceTarget: run.quiesceTarget,
      deadline: run.deadline,
      now,
      budgetExpired: run.budgetExpiredAt !== null || (run.phase === 'paused' && (run.deadline !== null && now >= run.deadline)),
      baseCommit: run.baseCommit,
      acceptedHead: run.acceptedHead,
      resultRef: run.resultRef,
      integrationWorktree: run.integrationWorktree,
      tasks: countTasks(run),
      goalRevision: run.goalRevision,
      goals: { ...countByStatus(Object.values(run.goals), ['active', 'deferred', 'completed']), total: Object.keys(run.goals).length },
      workers: Object.values(run.workers).map((worker) => this.workerSummary(worker)),
      workerControls: this.workerControls(run, control, now),
      proposals: countByStatus(Object.values(run.proposals), ['queued', 'integrating', 'accepted', 'rejected']),
      verifications: countByStatus(
        Object.values(run.verifications),
        ['queued', 'running', 'passed', 'failed', 'interrupted'],
      ),
      finishRequest:
        run.finishRequest === null
          ? null
          : {
              id: run.finishRequest.id,
              acceptedHead: run.finishRequest.acceptedHead,
              verificationId: run.finishRequest.verificationId,
            },
      admission: control.admissionClosed ? 'closed' : 'open',
      diagnostics: [...(this.diagnostics.get(run.id) ?? [])],
      ...(details ? { details: this.statusDetails(run, control) } : {}),
    };
  }

  /**
   * 暂停：先持久化 quiescing，再取消本 run 在途工作并停止原生会话，最后置 paused。
   * 资源停止无法确认时保留 quiescing 并带诊断返回，不宣称已暂停。
   */
  async pause(ownerSessionId: string): Promise<Run> {
    this.assertUsable('pause');
    const run = this.uniqueRunForOwner(ownerSessionId);
    if (run.phase === 'paused') {
      return run;
    }
    return this.controlTransition(run.id, 'paused', 'user_pause');
  }

  /**
   * 恢复 paused run。`budgetMinutes` 是把 deadline 设为“现在 + 追加时长”；
   * 已过期而未追加预算时拒绝。终态 run 不能 resume。
   */
  async resume(ownerSessionId: string, budgetMinutes?: number): Promise<Run> {
    this.assertUsable('resume');
    if (budgetMinutes !== undefined) {
      assertPositiveMinutes(budgetMinutes);
    }
    const run = this.resumableRunForOwner(ownerSessionId);
    if (run.phase !== 'paused') {
      throw new SwarmError('SWARM_INVALID_STATE', `run is ${run.phase}, only paused runs can resume`, {
        details: { runId: run.id, phase: run.phase },
      });
    }
    if (!this.host.isOwnerLive(ownerSessionId)) {
      throw new SwarmError('SWARM_FORBIDDEN', 'owner session is not live', {
        details: { ownerSessionId, runId: run.id },
      });
    }

    const now = this.clock.now();
    if (budgetMinutes === undefined && (run.deadline !== null && now >= run.deadline)) {
      // paused 不跑截止 timer，所以“已过期”这个事实在用户尝试 resume 时才落盘；
      // run 保持 paused，明确追加预算才能恢复。
      if (run.budgetExpiredAt === null) {
        await this.store.update(run.id, (current) => {
          if (current.phase !== 'paused' || current.budgetExpiredAt !== null) {
            return current;
          }
          return this.finalizeChange(
            { ...current, budgetExpiredAt: now, reason: 'budget_expired' },
            [
              {
                kind: 'run',
                phase: 'paused',
                target: null,
                reason: 'budget_expired',
                authorWorkerId: null,
                audience: { kind: 'all' },
              },
            ],
            now,
          );
        });
      }
      throw new SwarmError(
        'SWARM_BUDGET_EXHAUSTED',
        'paused run budget expired; resume requires an explicit additional budget',
        { details: { runId: run.id, deadline: run.deadline, now } },
      );
    }

    const resumed = await this.publicationGate.run(run.id, async () => {
      const next = await this.store.update(run.id, (current) => {
        if (current.phase !== 'paused') {
          return current;
        }
        const stranded = Object.values(current.workers).filter((worker) =>
          worker.initializationState === 'failed' || worker.initializationState === 'initializing');
        if (stranded.length) {
          throw new SwarmError('SWARM_INVALID_STATE',
            'worker initialization is incomplete or failed; inspect member diagnostics and worktrees before stopping and starting a new run', {
              details: { runId: current.id, workers: stranded.map((worker) => ({
                workerId: worker.id, state: worker.initializationState, diagnostic: worker.initializationError,
              })) },
            });
        }
        const deadline =
          budgetMinutes === undefined ? current.deadline : now + budgetMinutes * 60_000;
        const pending = Object.values(current.goals).filter((goal) => goal.status === 'deferred' && goal.continuedInRunId === null);
        const goals = { ...current.goals };
        for (const goal of pending) goals[goal.id] = { ...goal, status: 'active' };
        return this.finalizeChange(
          {
            ...current,
            phase: 'running',
            reason: null,
            quiesceTarget: null,
            budgetExpiredAt: null,
            deadline,
            goals,
            goalRevision: current.goalRevision + pending.length,
          },
          [{ kind: 'run', phase: 'running', target: null, reason: null, authorWorkerId: null, audience: { kind: 'all' } },
            ...pending.map((goal): EventInput => ({ kind: 'goal', goalId: goal.id, status: 'active', authorWorkerId: null, audience: { kind: 'all' } }))],
          now,
        );
      });
      if (next.phase === 'running') {
        this.control(run.id).admissionClosed = false;
      }
      return next;
    });
    if (resumed.phase !== 'running') {
      throw new SwarmError('SWARM_INVALID_STATE', `run could not leave paused (now ${resumed.phase})`, {
        details: { runId: run.id, phase: resumed.phase },
      });
    }

    this.armDeadline(resumed);
    for (const worker of Object.values(resumed.workers)) {
      if (worker.initializationState === 'pending') {
        this.startWorker(resumed.id, worker.id);
      } else if (worker.initializationState === 'ready') {
        this.trackGuarded(this.delivery.resume(resumed.id, worker.id), resumed.id, 'worker resume failed');
      }
    }
    this.track(
      this.delivery.kick(resumed.id).catch(async (error: unknown) => {
        await this.onBackgroundError(resumed.id, error, 'delivery kick after resume failed');
      }),
    );
    return resumed;
  }

  /**
   * 停止：持久化 quiescing(stopped) 后取消在途操作、停止本 run 的原生会话、打断集成。
   * 请求到达但资源未确认静止时返回 quiescing，不假装已停止。
   */
  async stop(ownerSessionId: string): Promise<Run> {
    this.assertUsable('stop');
    const run = this.uniqueRunForOwner(ownerSessionId);
    return this.controlTransition(run.id, 'stopped', 'user_stop');
  }

  /* ---------------------------------------------------------------- */
  /* worker 工具入口                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * `swarm_submit`：把当前提交固定成一份 queued Proposal。
   *
   * 身份取自真实 worker Session；`(workerSessionId, callId)` 命中 receipt 时只回放已有结果。
   * Git 校验与 ref 固定都在 admission 门禁之外、可取消；store 内一次写入完成 task/proposal/
   * 事件/receipt 与 waitRegistration 清除，随后异步托管集成，不阻塞模型。
   */
  async submit(
    workerSessionId: string,
    input: { taskId: string; expectedRevision: number; sourceCommit: string },
    callId: string,
  ): Promise<ProposalRecord> {
    this.assertUsable('submit');
    validateSubmitInput(workerSessionId, input, callId);
    const { run, worker } = this.resolveWorker(workerSessionId);

    const receiptKey = receiptKeyFor(workerSessionId, callId);
    const receipt = run.mutationReceipts[receiptKey];
    if (receipt !== undefined) {
      return this.proposalFromReceipt(run, receipt);
    }

    this.assertSubmittable(run, worker, input);
    // 同一 task/sourceCommit 已有 queued/integrating/accepted Proposal 时直接返回它，
    // 不再重复 pin 同一个 SHA（重复投递不等于重复 mutation）。
    const existingLive = findLiveProposal(run, input.taskId, input.sourceCommit);
    if (existingLive !== null) {
      return existingLive;
    }
    const operation = await this.admitOperation(run.id, 'submit', worker.id);
    try {
      const pinned = await this.workspace.validateSubmission(
        run,
        worker,
        input.sourceCommit,
        operation.controller.signal,
      );
      const now = this.clock.now();
      const proposalId = this.makeId();
      const proposal: ProposalRecord = {
        id: proposalId,
        taskId: input.taskId,
        authorWorkerId: worker.id,
        sourceCommit: pinned,
        resultRefAtSubmission: run.acceptedHead,
        proposalRef: `refs/swarm/${run.id}/proposals/${proposalId}`,
        status: 'queued',
        acceptedCommit: null,
        diagnosticsRef: null,
        rejectionReason: null,
        attemptIds: [],
        createdAt: now,
        updatedAt: now,
      };
      await this.workspace.pinProposal(run, proposal, operation.controller.signal);

      let applied = false;
      const persisted = await this.store.update(run.id, (current) => {
        if (current.phase !== 'running') {
          return current;
        }
        const task = current.tasks[input.taskId];
        if (
          task === undefined ||
          task.status !== 'claimed' ||
          task.ownerWorkerId !== worker.id ||
          task.revision !== input.expectedRevision
        ) {
          return current;
        }
        if (findLiveProposal(current, input.taskId, pinned) !== null) {
          return current;
        }
        const owner = current.workers[worker.id];
        applied = true;
        return this.finalizeChange(
          {
            ...current,
            tasks: {
              ...current.tasks,
              [task.id]: {
                ...task,
                status: 'proposed',
                proposalId,
                revision: task.revision + 1,
                updatedAt: now,
              },
            },
            proposals: { ...current.proposals, [proposalId]: proposal },
            workers:
              owner === undefined
                ? current.workers
                : { ...current.workers, [owner.id]: { ...owner, waitRegistration: null } },
            mutationReceipts: {
              ...current.mutationReceipts,
              [receiptKey]: this.receipt(receiptKey, workerSessionId, callId, 'submit', {
                proposalId,
              }),
            },
          },
          [
            {
              kind: 'task',
              taskId: task.id,
              status: 'proposed',
              ownerWorkerId: worker.id,
              authorWorkerId: worker.id,
              audience: { kind: 'all' },
            },
            {
              kind: 'proposal',
              proposalId,
              taskId: task.id,
              status: 'queued',
              authorWorkerId: worker.id,
              audience: { kind: 'all' },
            },
          ],
          now,
        );
      });

      if (!applied) {
        const recycled = findLiveProposal(persisted, input.taskId, pinned);
        if (recycled !== null) {
          return recycled;
        }
        throw this.submitConflict(persisted, worker, input);
      }
      this.kickIntegration(run.id);
      const stored = persisted.proposals[proposalId];
      return stored ?? proposal;
    } finally {
      operation.finish();
    }
  }

  /**
   * `swarm_finish`：两阶段受理。
   *
   * running 时通过结构检查即原子进入 draining 并返回 `accepted`；draining 且同一 acceptedHead
   * 的重复请求返回 `already_finishing`。需要最终验证时创建 purpose=finish 的 Verification，
   * 已存在匹配 passed 记录则直接进入 completed 收尾。工具内不等待自己停止。
   */
  async finish(
    workerSessionId: string,
    input: { acceptedCommit: string; notes: AcceptanceNote[]; goalRevision?: number },
    callId: string,
  ): Promise<FinishDecision> {
    this.assertUsable('finish');
    validateFinishInput(workerSessionId, input, callId);
    const { run, worker } = this.resolveWorker(workerSessionId);

    const receiptKey = receiptKeyFor(workerSessionId, callId);
    const receipt = run.mutationReceipts[receiptKey];
    if (receipt !== undefined) {
      return decisionFromReceipt(receipt);
    }

    this.assertFinishCallerAllowed(run, worker, input);

    if (run.phase === 'draining') {
      const existing = run.finishRequest;
      if (existing === null) {
        throw new SwarmError('SWARM_INVALID_STATE', 'run is draining without a finish request', {
          details: { runId: run.id, phase: run.phase },
        });
      }
      return {
        status: 'already_finishing',
        finishRequestId: existing.id,
        verificationId: existing.verificationId,
      };
    }
    if (run.phase !== 'running') {
      throw new SwarmError('SWARM_NOT_RUNNING', `run is ${run.phase}; finish requires a running run`, {
        details: { runId: run.id, phase: run.phase },
      });
    }

    this.assertFinishStructure(run, input);

    const now = this.clock.now();
    const fingerprint = verificationFingerprint(run.verification);
    const reused = findReusableVerification(run, fingerprint);
    const finishRequestId = this.makeId();
    const verificationId = reused === null ? this.makeId() : reused.id;
    const finishRequest: FinishRequest = {
      id: finishRequestId,
      requestedByWorkerId: worker.id,
      acceptedHead: run.acceptedHead,
      goalRevision: run.goalRevision,
      notes: input.notes.map((note) => ({ criterion: note.criterion, evidence: [...note.evidence] })),
      verificationId,
      createdAt: now,
    };
    const verification: VerificationRecord | null =
      reused === null
        ? {
            id: verificationId,
            purpose: 'finish',
            commit: run.acceptedHead,
            expectedHead: run.acceptedHead,
            sourceCommit: null,
            proposalId: null,
            attemptId: null,
            configFingerprint: fingerprint,
            goalRevision: run.goalRevision,
            status: 'queued',
            receiptRef: null,
            diagnosticsRef: null,
            exitCode: null,
            timedOut: false,
            createdAt: now,
            startedAt: null,
            finishedAt: null,
          }
        : null;

    let applied = false;
    const inFlightSnapshot = this.control(run.id).operations.size;
    const persisted = await this.store.update(run.id, (current) => {
      if (current.phase !== 'running' || current.finishRequest !== null) {
        return current;
      }
      if (current.acceptedHead !== run.acceptedHead || current.goalRevision !== run.goalRevision) {
        return current;
      }
      // 结构条件必须在同一次写内复查：前置检查之后其它写入可能又开了任务/提交。
      if (finishGaps(current, input.notes, inFlightSnapshot).blocked) {
        return current;
      }
      applied = true;
      const requester = current.workers[worker.id];
      return this.finalizeChange(
        {
          ...current,
          phase: 'draining',
          quiesceTarget: null,
          finishRequest,
          finishHistory: [...current.finishHistory, finishRequest],
          verifications:
            verification === null
              ? current.verifications
              : { ...current.verifications, [verification.id]: verification },
          // 成功受理 finish 是明确的确认入口：清除提出者自己的等待登记。
          workers:
            requester === undefined
              ? current.workers
              : { ...current.workers, [requester.id]: { ...requester, waitRegistration: null } },
          mutationReceipts: {
            ...current.mutationReceipts,
            [receiptKey]: this.receipt(receiptKey, workerSessionId, callId, 'finish', {
              status: 'accepted',
              finishRequestId,
              verificationId,
            }),
          },
        },
        [
          {
            kind: 'run',
            phase: 'draining',
            target: null,
            reason: 'finish_accepted',
            authorWorkerId: worker.id,
            audience: { kind: 'all' },
          },
        ],
        now,
      );
    });

    if (!applied) {
      if (persisted.phase === 'draining' && persisted.finishRequest !== null) {
        return {
          status: 'already_finishing',
          finishRequestId: persisted.finishRequest.id,
          verificationId: persisted.finishRequest.verificationId,
        };
      }
      if (persisted.acceptedHead !== run.acceptedHead) {
        throw new SwarmError('SWARM_STALE_HEAD', 'acceptedHead changed before finish was accepted', {
          details: { runId: run.id, requested: run.acceptedHead, current: persisted.acceptedHead },
        });
      }
      if (persisted.phase === 'running') {
        // 受理期间状态又变了：用最新记录重新给出具体缺口；若缺口已消失则要求重试。
        this.assertFinishStructure(persisted, input);
        throw new SwarmError(
          'SWARM_INVALID_STATE',
          'finish acceptance raced with a concurrent change; retry the call',
          { details: { runId: run.id } },
        );
      }
      throw new SwarmError('SWARM_NOT_RUNNING', `run is ${persisted.phase}; finish not accepted`, {
        details: { runId: run.id, phase: persisted.phase },
      });
    }

    if (verification === null) {
      this.trackGuarded(this.enterQuiescingCompleted(run.id), run.id, 'enter completed failed');
    } else {
      this.kickIntegration(run.id);
    }
    return { status: 'accepted', finishRequestId, verificationId };
  }

  /* ---------------------------------------------------------------- */
  /* 恢复与卸载                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * 进程启动后的只读核对：先关闭 admission，再让 IntegrationQueue 只补 Git 事实，
   * 最后把未终止 run 默认置 paused（paused 也占仓库名额）。不调用模型、不改 ref、不跑测试。
   */
  async recover(): Promise<void> {
    this.assertUsable('recover');
    for (const run of this.store.list()) {
      if (isTerminalRunPhase(run.phase)) {
        continue;
      }
      const control = this.control(run.id);
      control.admissionClosed = true;
      this.clearDeadline(run.id);
      try {
        await this.integration.recover(run.id);
      } catch (error) {
        this.recordDiagnostic(run.id, `recover: ${errorMessage(error)}`);
      }
      const current = this.store.get(run.id);
      if (isTerminalRunPhase(current.phase)) {
        continue;
      }
      const now = this.clock.now();
      await this.store.update(run.id, (state) => {
        if (isTerminalRunPhase(state.phase)) {
          return state;
        }
        const ownerLive = this.host.isOwnerLive(state.ownerSessionId);
        const reason = ownerLive ? 'recovered' : 'owner_offline';
        const workers: Record<WorkerId, WorkerRecord> = {};
        for (const [workerId, worker] of Object.entries(state.workers)) {
          workers[workerId] =
            worker.initializationState === 'initializing'
              ? {
                  ...worker,
                  initializationState: 'pending',
                  initializationError: 'recovery_interrupted_initialization',
                }
              : worker;
        }
        return this.finalizeChange(
          {
            ...state,
            phase: 'paused',
            quiesceTarget: null,
            reason,
            budgetExpiredAt:
              state.budgetExpiredAt ?? (state.deadline !== null && now >= state.deadline ? now : null),
            workers,
          },
          [{ kind: 'run', phase: 'paused', target: null, reason, authorWorkerId: null, audience: { kind: 'all' } }],
          now,
        );
      });
      this.recordDiagnostic(run.id, 'recovered: no in-process resources from previous host');
    }
  }

  /**
   * 卸载：先关闭 admission，再取消本 run 在途操作并停止资源。
   * 清理继续执行完毕；有失败时抛出第一个错误，便于 Host 记录未静止的诊断。
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const failures: unknown[] = [];
    for (const runId of [...this.controls.keys()]) {
      this.control(runId).admissionClosed = true;
      this.clearDeadline(runId);
    }
    for (const runId of [...this.controls.keys()]) {
      try {
        await this.abortOperations(runId, 'dispose');
      } catch (error) {
        failures.push(error);
      }
      try {
        const run = this.store.get(runId);
        if (!isTerminalRunPhase(run.phase)) {
          await this.host.stop(run);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await this.delivery.dispose();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.integration.idle();
    } catch (error) {
      failures.push(error);
    }
    this.unsubscribe();
    await Promise.allSettled([...this.hosted]);
    const [first] = failures;
    if (first !== undefined) {
      throw normalizeError(first, 'SWARM_INTERNAL', 'runtime dispose did not stop all resources');
    }
  }

  /* ---------------------------------------------------------------- */
  /* admission 与在途操作                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Delivery 在 materialize / 通知前申请许可。检查 run 状态与预算后登记在途操作，
   * 返回取消信号；`release` 必须放在 finally 里调用。
   */
  private async admitWorkerOperation(
    runId: RunId,
    workerId: WorkerId,
    kind: 'create' | 'notify',
  ): Promise<{ signal: AbortSignal; release(): void }> {
    const operation = await this.publicationGate.run(runId, () =>
      this.registerWorkerOperation(runId, workerId, kind),
    );
    return { signal: operation.controller.signal, release: () => operation.finish() };
  }

  /** 门禁内同步执行的许可检查；任何拒绝都不产生登记。 */
  private registerWorkerOperation(
    runId: RunId,
    workerId: WorkerId,
    kind: 'create' | 'notify',
  ): ActiveOperation {
    this.assertUsable(kind);
    const state = this.control(runId);
    if (state.admissionClosed) {
      throw new SwarmError('SWARM_NOT_RUNNING', 'run admission is closed', {
        details: { runId, workerId },
      });
    }
    const run = this.requireRun(runId);
    if (
      isTerminalRunPhase(run.phase) ||
      run.phase === 'quiescing' ||
      run.phase === 'paused' ||
      run.phase === 'draining'
    ) {
      throw new SwarmError('SWARM_NOT_RUNNING', `run is ${run.phase}`, {
        details: { runId, workerId, phase: run.phase },
      });
    }
    if (kind === 'notify' && run.phase !== 'running') {
      throw new SwarmError('SWARM_NOT_RUNNING', 'notifications require a running run', {
        details: { runId, workerId, phase: run.phase },
      });
    }
    if ((run.deadline !== null && this.clock.now() >= run.deadline)) {
      throw new SwarmError('SWARM_BUDGET_EXHAUSTED', 'run budget expired', {
        details: { runId, workerId, deadline: run.deadline },
      });
    }
    const worker = run.workers[workerId];
    if (worker === undefined) {
      throw new SwarmError('SWARM_NOT_FOUND', `worker ${workerId} not found in run ${runId}`, {
        details: { runId, workerId },
      });
    }
    if (worker.initializationState === 'failed') {
      throw new SwarmError('SWARM_INVALID_STATE', 'worker initialization failed', {
        details: { runId, workerId },
      });
    }
    return this.beginOperation(runId, kind, workerId);
  }

  /** 控制面自身的在途操作；start 允许 run 尚未持久化。 */
  private async admitOperation(
    runId: RunId,
    kind: OperationKind,
    workerId: WorkerId | null,
  ): Promise<ActiveOperation> {
    return this.publicationGate.run(runId, () => {
      this.assertUsable(kind);
      const state = this.control(runId);
      if (state.admissionClosed) {
        throw new SwarmError('SWARM_NOT_RUNNING', 'run admission is closed', { details: { runId } });
      }
      if (kind !== 'start') {
        const run = this.requireRun(runId);
        if (
          isTerminalRunPhase(run.phase) ||
          run.phase === 'quiescing' ||
          run.phase === 'paused' ||
          run.phase === 'draining'
        ) {
          throw new SwarmError('SWARM_NOT_RUNNING', `run is ${run.phase}`, {
            details: { runId, phase: run.phase },
          });
        }
        if ((run.deadline !== null && this.clock.now() >= run.deadline)) {
          throw new SwarmError('SWARM_BUDGET_EXHAUSTED', 'run budget expired', {
            details: { runId, deadline: run.deadline },
          });
        }
      }
      return this.beginOperation(runId, kind, workerId);
    });
  }

  private beginOperation(
    runId: RunId,
    kind: OperationKind,
    workerId: WorkerId | null,
  ): ActiveOperation {
    const state = this.control(runId);
    const controller = new AbortController();
    let settle: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let finished = false;
    const operation: ActiveOperation = {
      kind,
      workerId,
      controller,
      settled,
      finish: () => {
        if (finished) {
          return;
        }
        finished = true;
        state.operations.delete(operation);
        settle();
      },
    };
    state.operations.add(operation);
    return operation;
  }

  /** 取消本 run 的全部在途操作并等待它们结算；不在这里等待模型或长测试以外的东西。 */
  private async abortOperations(runId: RunId, reason: string): Promise<void> {
    const state = this.controls.get(runId);
    if (state === undefined || state.operations.size === 0) {
      return;
    }
    const pending = [...state.operations];
    for (const operation of pending) {
      operation.controller.abort(
        new SwarmError('SWARM_INVALID_STATE', `operation aborted: ${reason}`, {
          details: { runId, kind: operation.kind },
        }),
      );
    }
    await Promise.all(pending.map((operation) => operation.settled));
  }

  /* ---------------------------------------------------------------- */
  /* 状态转换                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 控制临界区：短门禁内持久化 quiescing 并关闭 admission；门禁外取消在途操作、
   * 停止原生会话、打断并等待集成，最后在门禁内写入目标终态。
   */
  private async controlTransition(
    runId: RunId,
    target: QuiesceTarget,
    reason: string,
  ): Promise<Run> {
    const before = this.requireRun(runId);
    if (isTerminalRunPhase(before.phase)) {
      return before;
    }

    const requested = await this.publicationGate.run(runId, async () => {
      const next = await this.store.update(runId, (run) => {
        if (isTerminalRunPhase(run.phase)) {
          return run;
        }
        const now = this.clock.now();
        const merged = mergeQuiesce(
          { target: run.phase === 'quiescing' ? run.quiesceTarget : null, reason: run.reason },
          { target, reason },
        );
        return this.finalizeChange(
          { ...run, phase: 'quiescing', quiesceTarget: merged.target, reason: merged.reason },
          [
            {
              kind: 'run',
              phase: 'quiescing',
              target: merged.target,
              reason: merged.reason,
              authorWorkerId: null,
              audience: { kind: 'all' },
            },
          ],
          now,
        );
      });
      // 关闭 admission 与 quiescing 持久化同在短门禁内完成，之后不再接受新操作。
      if (!isTerminalRunPhase(next.phase)) {
        this.control(runId).admissionClosed = true;
      }
      return next;
    });
    this.clearDeadline(runId);
    if (isTerminalRunPhase(requested.phase)) {
      return requested;
    }
    if (requested.phase !== 'quiescing') {
      return requested;
    }

    const problems: string[] = [];
    await this.abortOperations(runId, reason);
    try {
      await this.delivery.idle();
    } catch (error) {
      problems.push(`delivery: ${errorMessage(error)}`);
    }
    try {
      const snapshot = this.store.get(runId);
      await this.host.stop(snapshot);
    } catch (error) {
      problems.push(`host.stop: ${errorMessage(error)}`);
    }
    try {
      await this.integration.interrupt(runId, interruptReason(reason));
    } catch (error) {
      problems.push(`integration.interrupt: ${errorMessage(error)}`);
    }
    try {
      await this.integration.idle(runId);
    } catch (error) {
      problems.push(`integration.idle: ${errorMessage(error)}`);
    }
    return this.finalizeQuiescence(runId, problems);
  }

  /** 在门禁内把 quiescing 落到目标终态；资源未确认静止时保留 quiescing 并写诊断。 */
  private async finalizeQuiescence(runId: RunId, problems: readonly string[]): Promise<Run> {
    const finalized = await this.publicationGate.run(runId, async () => {
      return this.store.update(runId, (run) => {
        if (isTerminalRunPhase(run.phase) || run.phase !== 'quiescing') {
          return run;
        }
        const now = this.clock.now();
        if (problems.length > 0) {
          const reason = `${run.reason ?? 'quiesce'}; quiescence_incomplete: ${problems.join('; ')}`;
          return this.finalizeChange(
            { ...run, reason },
            [{ kind: 'run', phase: 'quiescing', target: run.quiesceTarget, reason, authorWorkerId: null, audience: { kind: 'all' } }],
            now,
          );
        }
        const target = run.quiesceTarget ?? 'stopped';
        const budgetExpired =
          run.budgetExpiredAt ??
          (target === 'stopped' && run.reason === 'budget_exhausted' ? now : null) ??
          (target === 'paused' && (run.deadline !== null && now >= run.deadline) ? now : null);
        return this.finalizeChange(
          {
            ...run,
            phase: target,
            quiesceTarget: null,
            budgetExpiredAt: budgetExpired,
            goals: Object.fromEntries(Object.entries(run.goals).map(([id, goal]) => [id,
              target === 'completed' && goal.status === 'active'
                ? { ...goal, status: 'completed' as const, completedAt: now, completedCommit: run.acceptedHead }
                : goal])),
          },
          [
            {
              kind: 'run',
              phase: target,
              target,
              reason: run.reason,
              authorWorkerId: null,
              audience: { kind: 'all' },
            },
          ],
          now,
        );
      });
    });
    return finalized;
  }

  /** finish 的最终验证已通过 own record：进入 quiescing(completed)，由订阅驱动收尾。 */
  private async enterQuiescingCompleted(runId: RunId): Promise<void> {
    await this.publicationGate.run(runId, async () => {
      await this.store.update(runId, (run) => {
        if (run.phase !== 'draining' || run.finishRequest === null || (run.finishRequest.goalRevision ?? 0) !== run.goalRevision) {
          return run;
        }
        const now = this.clock.now();
        this.control(runId).admissionClosed = true;
        return this.finalizeChange(
          { ...run, phase: 'quiescing', quiesceTarget: 'completed', reason: 'finish_verified' },
          [
            {
              kind: 'run',
              phase: 'quiescing',
              target: 'completed',
              reason: 'finish_verified',
              authorWorkerId: null,
              audience: { kind: 'all' },
            },
          ],
          now,
        );
      });
    });
  }

  /**
   * 订阅驱动：integration 把 run 置于 quiescing(completed) 后，由控制面在独立流程里停资源
   * 并写 completed。worker 工具内不等待自己销毁；同一个 run 只尝试一次，避免通知循环。
   */
  private observeRun(run: Run): void {
    if (this.disposed) {
      return;
    }
    if (run.phase !== 'quiescing' || run.quiesceTarget !== 'completed') {
      return;
    }
    const state = this.control(run.id);
    if (state.completionAttempted) {
      return;
    }
    state.completionAttempted = true;
    this.track(this.completeRun(run.id));
  }

  private async completeRun(runId: RunId): Promise<void> {
    const run = this.requireRun(runId);
    if (run.phase !== 'quiescing' || run.quiesceTarget !== 'completed') {
      return;
    }
    this.clearDeadline(runId);
    this.control(runId).admissionClosed = true;
    const problems: string[] = [];
    await this.abortOperations(runId, 'completed');
    try {
      await this.delivery.idle();
    } catch (error) {
      problems.push(`delivery: ${errorMessage(error)}`);
    }
    try {
      await this.host.stop(this.store.get(runId));
    } catch (error) {
      problems.push(`host.stop: ${errorMessage(error)}`);
    }
    try {
      await this.integration.idle(runId);
    } catch (error) {
      problems.push(`integration.idle: ${errorMessage(error)}`);
    }
    await this.finalizeQuiescence(runId, problems);
  }

  /** preparing→running；若控制请求已抢先进入 quiescing，则不改写状态。 */
  private async markRunning(runId: RunId): Promise<Run> {
    return this.publicationGate.run(runId, async () => {
      return this.store.update(runId, (run) => {
        if (run.phase !== 'preparing') {
          return run;
        }
        const now = this.clock.now();
        return this.finalizeChange(
          { ...run, phase: 'running', reason: null, quiesceTarget: null },
          [{ kind: 'run', phase: 'running', target: null, reason: null, authorWorkerId: null, audience: { kind: 'all' } }],
          now,
        );
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* 预算                                                              */
  /* ---------------------------------------------------------------- */

  /** 活动 run 的 deadline timer；paused 不排 timer，但绝对 deadline 数值照常推进。 */
  private armDeadline(run: Run): void {
    this.clearDeadline(run.id);
    if (run.deadline === null) return;
    const delay = Math.max(0, run.deadline - this.clock.now());
    const cancel = this.clock.setTimeout(() => {
      this.control(run.id).timer = null;
      void this.onDeadline(run.id);
    }, delay);
    this.control(run.id).timer = cancel;
  }

  private clearDeadline(runId: RunId): void {
    const state = this.controls.get(runId);
    if (state === undefined || state.timer === null) {
      return;
    }
    const cancel = state.timer;
    state.timer = null;
    cancel();
  }

  /** 预算到期：活动 run 走 stopped(budget_exhausted)；paused 只记 budgetExpiredAt。 */
  private async onDeadline(runId: RunId): Promise<void> {
    if (this.disposed) {
      return;
    }
    let run: Run;
    try {
      run = this.requireRun(runId);
    } catch (error) {
      // run 不存在说明没有可结算的预算；其他读取错误必须上报，不能静默丢弃。
      if (!isSwarmError(error) || error.code !== 'SWARM_NOT_FOUND') {
        await this.onBackgroundError(runId, error, 'deadline read failed');
      }
      return;
    }
    if (isTerminalRunPhase(run.phase) || run.deadline === null) {
      return;
    }
    const now = this.clock.now();
    if (now < run.deadline) {
      if (run.phase !== 'paused') this.armDeadline(run);
      return;
    }
    try {
      if (run.phase === 'paused') {
        if ((run.deadline !== null && now >= run.deadline) && run.budgetExpiredAt === null) {
          await this.store.update(runId, (current) => {
            if (current.phase !== 'paused' || current.budgetExpiredAt !== null) {
              return current;
            }
            return this.finalizeChange(
              { ...current, budgetExpiredAt: now, reason: 'budget_expired' },
              [{ kind: 'run', phase: 'paused', target: null, reason: 'budget_expired', authorWorkerId: null, audience: { kind: 'all' } }],
              now,
            );
          });
        }
        return;
      }
      await this.controlTransition(runId, 'stopped', 'budget_exhausted');
    } catch (error) {
      await this.onBackgroundError(runId, error, 'deadline handling failed');
    }
  }

  /* ---------------------------------------------------------------- */
  /* 失败与诊断                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * 初始化或基础设施失败：收尾为 failed，诊断落到 artifact 与进程内状态。
   *
   * 已经有控制请求先取得临界区（quiescing/paused/终态或 admission 已关闭）时只保留诊断，
   * 不把 paused/stopped 改写成 failed；run 尚未持久化时同样只记录。
   */
  private async failRun(runId: RunId, reason: string, error: unknown): Promise<void> {
    const message = errorMessage(error);
    this.recordDiagnostic(runId, `${reason}: ${message}`);
    try {
      const reference = await this.artifacts.save(runId, reason, message);
      this.recordDiagnostic(runId, `diagnostics artifact: ${reference}`);
    } catch (artifactError) {
      this.recordDiagnostic(runId, `diagnostics artifact failed: ${errorMessage(artifactError)}`);
    }

    let run: Run;
    try {
      run = this.requireRun(runId);
    } catch (readError) {
      if (!isSwarmError(readError) || readError.code !== 'SWARM_NOT_FOUND') {
        this.recordDiagnostic(runId, `failed to read run: ${errorMessage(readError)}`);
      }
      return;
    }
    const state = this.control(runId);
    if (
      isTerminalRunPhase(run.phase) ||
      run.phase === 'quiescing' ||
      run.phase === 'paused' ||
      state.admissionClosed
    ) {
      return;
    }
    try {
      await this.controlTransition(runId, 'failed', reason);
    } catch (transitionError) {
      this.recordDiagnostic(
        runId,
        `failed to quiesce after ${reason}: ${errorMessage(transitionError)}`,
      );
    }
  }

  /** 后台错误：先记诊断；未进入控制收尾的 run 视为基础设施失败。 */
  private async onBackgroundError(runId: RunId, error: unknown, context: string): Promise<void> {
    this.recordDiagnostic(runId, `${context}: ${errorMessage(error)}`);
    let run: Run;
    try {
      run = this.requireRun(runId);
    } catch (readError) {
      if (!isSwarmError(readError) || readError.code !== 'SWARM_NOT_FOUND') {
        this.recordDiagnostic(runId, `failed to read run: ${errorMessage(readError)}`);
      }
      return;
    }
    const state = this.control(runId);
    if (isTerminalRunPhase(run.phase) || run.phase === 'quiescing' || state.admissionClosed) {
      return;
    }
    await this.failRun(runId, 'infrastructure_error', error);
  }

  private recordDiagnostic(runId: RunId, line: string): void {
    const lines = this.diagnostics.get(runId) ?? [];
    lines.push(line);
    if (lines.length > MAX_DIAGNOSTICS) {
      lines.splice(0, lines.length - MAX_DIAGNOSTICS);
    }
    this.diagnostics.set(runId, lines);
  }

  /* ---------------------------------------------------------------- */
  /* 异步托管                                                          */
  /* ---------------------------------------------------------------- */

  /** 托管一个后台 Promise：始终消费 rejection，dispose 时可等待。 */
  private track(promise: Promise<void>): void {
    this.hosted.add(promise);
    void promise.then(
      () => this.hosted.delete(promise),
      () => this.hosted.delete(promise),
    );
  }

  /** 托管并在失败时上报为诊断/基础设施错误；不允许静默丢弃后台拒绝。 */
  private trackGuarded(promise: Promise<void>, runId: RunId, context: string): void {
    this.track(
      promise.catch(async (error: unknown) => {
        await this.onBackgroundError(runId, error, context);
      }),
    );
  }

  private startWorker(runId: RunId, workerId: WorkerId): void {
    this.track(
      this.delivery.start(runId, workerId).catch(async (error: unknown) => {
        await this.failRun(runId, 'worker_initialization_failed', error);
      }),
    );
  }

  /** 触发集成；不 await，避免把候选构造与测试塞进模型工具调用。 */
  private kickIntegration(runId: RunId): void {
    this.track(
      this.integration.process(runId).catch(async (error: unknown) => {
        await this.onBackgroundError(runId, error, 'integration process failed');
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 查找与校验                                                        */
  /* ---------------------------------------------------------------- */

  private control(runId: RunId): RunControlState {
    let state = this.controls.get(runId);
    if (state === undefined) {
      state = {
        admissionClosed: false,
        operations: new Set<ActiveOperation>(),
        completionAttempted: false,
        timer: null,
      };
      this.controls.set(runId, state);
    }
    return state;
  }

  private requireRun(runId: RunId): Run {
    return this.store.get(runId);
  }

  private assertUsable(operation: string): void {
    if (this.disposed) {
      throw new SwarmError('SWARM_INVALID_STATE', `runtime is disposed (${operation})`);
    }
  }

  /** 有未提交修改时默认拒绝启动；`allowDirtyBaseline=true` 才接受“只从已提交基线运行”。 */
  private assertCleanBaseline(spec: RunSpec, info: RepositoryInfo): void {
    if (info.dirty && !spec.allowDirtyBaseline) {
      throw new SwarmError(
        'SWARM_INVALID_SPEC',
        'repository has staged, unstaged or untracked changes; commit them or start with allowDirtyBaseline=true',
        { details: { repository: spec.repository, dirty: true } },
      );
    }
  }

  /** 同一仓库（gitCommonDir）同时只允许一个非终态 run；paused 也占用名额。 */
  private assertRepositoryIdle(gitCommonDir: string): void {
    const active = this.store
      .list()
      .filter((run) => run.gitCommonDir === gitCommonDir && !isTerminalRunPhase(run.phase));
    if (active.length > 0) {
      throw new SwarmError(
        'SWARM_INVALID_STATE',
        'repository already has a non-terminal swarm run; stop it before starting a new one',
        {
          details: {
            gitCommonDir,
            runs: active.map((run) => ({ runId: run.id, phase: run.phase })),
          },
        },
      );
    }
  }

  /** owner 的当前非终态 run 必须唯一；终态 run 不参与控制入口。 */
  private uniqueRunForOwner(ownerSessionId: string): Run {
    const active = this.store
      .list()
      .filter((run) => run.ownerSessionId === ownerSessionId && !isTerminalRunPhase(run.phase));
    const [first, ...rest] = active;
    if (first === undefined) {
      throw new SwarmError('SWARM_NOT_FOUND', 'no active run for owner session', {
        details: { ownerSessionId },
      });
    }
    if (rest.length > 0) {
      throw new SwarmError('SWARM_INVALID_STATE', 'multiple active runs for owner session', {
        details: { ownerSessionId, runIds: active.map((run) => run.id) },
      });
    }
    return first;
  }

  /**
   * resume 的唯一入口：终态 run 也要给出明确拒绝，而不是笼统的“没有活动 run”。
   */
  private resumableRunForOwner(ownerSessionId: string): Run {
    const owned = this.store.list().filter((run) => run.ownerSessionId === ownerSessionId);
    const [first, ...rest] = owned.filter((run) => !isTerminalRunPhase(run.phase));
    if (first !== undefined) {
      if (rest.length > 0) {
        throw new SwarmError('SWARM_INVALID_STATE', 'multiple active runs for owner session', {
          details: { ownerSessionId, runIds: owned.map((run) => run.id) },
        });
      }
      return first;
    }
    let latest: Run | null = null;
    for (const run of owned) {
      if (latest === null || run.createdAt >= latest.createdAt) {
        latest = run;
      }
    }
    if (latest === null) {
      throw new SwarmError('SWARM_NOT_FOUND', 'no run for owner session', {
        details: { ownerSessionId },
      });
    }
    throw new SwarmError(
      'SWARM_INVALID_STATE',
      `run is ${latest.phase} (terminal); start a new run from acceptedHead instead`,
      { details: { ownerSessionId, runId: latest.id, phase: latest.phase } },
    );
  }

  /** status 读当前非终态 run；没有则取最近一次 run（终态也能看交付结果）。 */
  private runForStatus(ownerSessionId: string): Run {
    const owned = this.store.list().filter((run) => run.ownerSessionId === ownerSessionId);
    const active = owned.filter((run) => !isTerminalRunPhase(run.phase));
    const [only] = active;
    if (active.length === 1 && only !== undefined) {
      return only;
    }
    let latest: Run | null = null;
    for (const run of owned) {
      if (latest === null || run.createdAt >= latest.createdAt) {
        latest = run;
      }
    }
    if (latest === null) {
      throw new SwarmError('SWARM_NOT_FOUND', 'no run for owner session', {
        details: { ownerSessionId },
      });
    }
    return latest;
  }

  /** worker 身份来自真实 Session；不接受模型自报 workerId。 */
  private resolveWorker(workerSessionId: string): { run: Run; worker: WorkerRecord } {
    const matches: { run: Run; worker: WorkerRecord }[] = [];
    for (const run of this.store.list()) {
      for (const worker of Object.values(run.workers)) {
        if (worker.sessionId === workerSessionId) {
          matches.push({ run, worker });
        }
      }
    }
    const [first, ...rest] = matches;
    if (first === undefined) {
      throw new SwarmError('SWARM_NOT_FOUND', 'worker session is not part of any run', {
        details: { workerSessionId },
      });
    }
    if (rest.length > 1) {
      throw new SwarmError('SWARM_INVALID_STATE', 'worker session appears in multiple runs', {
        details: { workerSessionId, runIds: matches.map((match) => match.run.id) },
      });
    }
    return first;
  }

  /**
   * 原生状态读取失败时给出 `unavailable` 诊断标签，并把原因带进 status，
   * 不把它伪造成 DSH 的 running/inactive。
   */
  private workerSummary(worker: WorkerRecord): WorkerStatusSummary {
    let nativeStatus: NativeWorkerStatus;
    let nativeStatusError: string | null = null;
    try {
      nativeStatus = this.host.workerStatus(worker.sessionId);
    } catch (error) {
      nativeStatus = 'unavailable';
      nativeStatusError = errorMessage(error);
    }
    return {
      id: worker.id,
      displayName: workerDisplayName(worker),
      sessionId: worker.sessionId,
      initializationState: worker.initializationState,
      nativeStatus,
      nativeStatusError,
      currentTaskId: worker.currentTaskId,
      worktreePath: worker.worktreePath,
      unavailableReason: worker.unavailableReason,
      initializationError: worker.initializationError,
    };
  }

  private statusDetails(run: Run, control: RunControlState): RunStatusDetails {
    const page = this.eventPageSize;
    return {
      goalRecords: Object.values(run.goals).slice(-page),
      workers: Object.values(run.workers)
        .slice(0, page)
        .map((worker) => ({
          id: worker.id,
          offeredSeq: worker.offeredSeq,
          observedSeq: worker.observedSeq,
          wakeTargetSeq: worker.wakeTargetSeq,
          notifiedSeq: worker.notifiedSeq,
          waitRegistration: worker.waitRegistration,
          inFlightOperations: [...control.operations].filter(
            (operation) => operation.workerId === worker.id,
          ).length,
        })),
      integrationAttempts: Object.values(run.integrationAttempts)
        .slice(0, page)
        .map((attempt) => ({
          id: attempt.id,
          proposalId: attempt.proposalId,
          expectedHead: attempt.expectedHead,
          candidateCommit: attempt.candidateCommit,
          status: attempt.status,
        })),
      proposals: Object.values(run.proposals)
        .slice(0, page)
        .map((proposal) => ({
          id: proposal.id,
          taskId: proposal.taskId,
          status: proposal.status,
          sourceCommit: proposal.sourceCommit,
        })),
      verifications: Object.values(run.verifications)
        .slice(0, page)
        .map((verification) => ({
          id: verification.id,
          purpose: verification.purpose,
          status: verification.status,
          commit: verification.commit,
        })),
      inFlightOperations: control.operations.size,
      admission: control.admissionClosed ? 'closed' : 'open',
      eventCount: run.events.length,
      lastEventSeq: run.events.length === 0 ? 0 : (run.events[run.events.length - 1]?.seq ?? 0),
      messageCount: Object.keys(run.messages).length,
      mutationReceiptCount: Object.keys(run.mutationReceipts).length,
      resultRefConsistency: 'unverified',
    };
  }

  private assertSubmittable(
    run: Run,
    worker: WorkerRecord,
    input: { taskId: string; expectedRevision: number; sourceCommit: string },
  ): void {
    if (run.phase !== 'running') {
      throw new SwarmError('SWARM_NOT_RUNNING', `run is ${run.phase}; submit requires running`, {
        details: { runId: run.id, phase: run.phase },
      });
    }
    if ((run.deadline !== null && this.clock.now() >= run.deadline)) {
      throw new SwarmError('SWARM_BUDGET_EXHAUSTED', 'run budget expired', {
        details: { runId: run.id, deadline: run.deadline },
      });
    }
    const task = run.tasks[input.taskId];
    if (task === undefined) {
      throw new SwarmError('SWARM_NOT_FOUND', `task ${input.taskId} not found`, {
        details: { runId: run.id, taskId: input.taskId },
      });
    }
    if (task.ownerWorkerId !== worker.id) {
      throw new SwarmError('SWARM_FORBIDDEN', 'task is not owned by this worker', {
        details: { runId: run.id, taskId: task.id, ownerWorkerId: task.ownerWorkerId },
      });
    }
    if (task.revision !== input.expectedRevision) {
      throw new SwarmError('SWARM_STALE_REVISION', 'task revision does not match', {
        details: { runId: run.id, taskId: task.id, expected: input.expectedRevision, actual: task.revision },
      });
    }
    if (task.status !== 'claimed') {
      throw new SwarmError('SWARM_TASK_NOT_CLAIMABLE', `task is ${task.status}`, {
        details: { runId: run.id, taskId: task.id, status: task.status },
      });
    }
    const live = findLiveProposal(run, input.taskId, null);
    if (live !== null && live.sourceCommit !== input.sourceCommit) {
      throw new SwarmError('SWARM_INVALID_STATE', 'task already has a live proposal', {
        details: { runId: run.id, taskId: task.id, proposalId: live.id, status: live.status },
      });
    }
  }

  /** 与提交同时发生的写入竞争失败后，用已持久化状态给出确定错误。 */
  private submitConflict(
    persisted: Run,
    worker: WorkerRecord,
    input: { taskId: string; expectedRevision: number; sourceCommit: string },
  ): SwarmError {
    if (persisted.phase !== 'running') {
      return new SwarmError('SWARM_NOT_RUNNING', `run is ${persisted.phase}`, {
        details: { runId: persisted.id, phase: persisted.phase },
      });
    }
    const task = persisted.tasks[input.taskId];
    if (task === undefined) {
      return new SwarmError('SWARM_NOT_FOUND', `task ${input.taskId} not found`, {
        details: { runId: persisted.id, taskId: input.taskId },
      });
    }
    if (task.ownerWorkerId !== worker.id) {
      return new SwarmError('SWARM_FORBIDDEN', 'task is not owned by this worker', {
        details: { runId: persisted.id, taskId: task.id, ownerWorkerId: task.ownerWorkerId },
      });
    }
    if (task.revision !== input.expectedRevision) {
      return new SwarmError('SWARM_STALE_REVISION', 'task revision does not match', {
        details: {
          runId: persisted.id,
          taskId: task.id,
          expected: input.expectedRevision,
          actual: task.revision,
        },
      });
    }
    return new SwarmError('SWARM_TASK_NOT_CLAIMABLE', `task is ${task.status}`, {
      details: { runId: persisted.id, taskId: task.id, status: task.status },
    });
  }

  /** finish 只能由该 run 的 worker 提出；paused/quiescing/终态下的新 finish 一律拒绝。 */
  private assertFinishCallerAllowed(
    run: Run,
    worker: WorkerRecord,
    input: { acceptedCommit: string; notes: AcceptanceNote[]; goalRevision?: number },
  ): void {
    if (isTerminalRunPhase(run.phase)) {
      throw new SwarmError('SWARM_NOT_RUNNING', `run is ${run.phase}; it is terminal`, {
        details: { runId: run.id, phase: run.phase },
      });
    }
    if (run.phase === 'paused' || run.phase === 'quiescing') {
      throw new SwarmError('SWARM_NOT_RUNNING', `run is ${run.phase}`, {
        details: { runId: run.id, phase: run.phase },
      });
    }
    if (worker.initializationState !== 'ready') {
      throw new SwarmError('SWARM_INVALID_STATE', 'worker is not ready', {
        details: { runId: run.id, workerId: worker.id },
      });
    }
    if ((input.goalRevision ?? 0) !== run.goalRevision) {
      throw new SwarmError('SWARM_INVALID_STATE', 'goals changed; sync and finish with the current goalRevision', {
        details: { runId: run.id, requestedGoalRevision: input.goalRevision ?? 0, goalRevision: run.goalRevision },
      });
    }
    if (input.acceptedCommit !== run.acceptedHead) {
      throw new SwarmError('SWARM_STALE_HEAD', 'finish must reference the current acceptedHead', {
        details: { runId: run.id, requested: input.acceptedCommit, acceptedHead: run.acceptedHead },
      });
    }
  }

  /**
   * 结构条件检查（架构 §10.2）：逐条验收、全部 worker ready、任务收束、无在途 proposal/
   * attempt/启动。语义是否真的满足仍由 worker 与用户判断。
   *
   * 与 reducer 内使用的 `finishGaps` 是同一份纯判据，避免“检查通过后状态又变了”的窗口。
   */
  private assertFinishStructure(run: Run, input: { notes: AcceptanceNote[] }): void {
    if (run.finishRequest !== null) {
      throw new SwarmError('SWARM_INVALID_STATE', 'run already has a finish request', {
        details: { runId: run.id, finishRequestId: run.finishRequest.id },
      });
    }

    const gaps = finishGaps(run, input.notes, this.control(run.id).operations.size);
    if (gaps.missingCriteria.length > 0 || gaps.unknownCriteria.length > 0 || gaps.missingEvidence.length > 0) {
      throw new SwarmError(
        'SWARM_INVALID_STATE',
        'finish notes do not cover the acceptance criteria exactly',
        {
          details: {
            runId: run.id,
            missingCriteria: gaps.missingCriteria,
            unknownCriteria: gaps.unknownCriteria,
            missingEvidence: gaps.missingEvidence,
          },
        },
      );
    }
    if (gaps.notReady.length > 0) {
      throw new SwarmError('SWARM_INVALID_STATE', 'not all workers finished initialization', {
        details: { runId: run.id, notReady: gaps.notReady },
      });
    }
    if (gaps.unfinishedTasks.length > 0) {
      throw new SwarmError('SWARM_INVALID_STATE', 'tasks are not done or cancelled', {
        details: { runId: run.id, unfinishedTasks: gaps.unfinishedTasks },
      });
    }
    if (
      gaps.pendingProposals.length > 0 ||
      gaps.activeAttemptId !== null ||
      gaps.inFlightOperations > 0
    ) {
      throw new SwarmError('SWARM_INVALID_STATE', 'run still has in-flight integration work', {
        details: {
          runId: run.id,
          pendingProposals: gaps.pendingProposals,
          activeAttemptId: gaps.activeAttemptId,
          inFlightOperations: gaps.inFlightOperations,
        },
      });
    }
  }

  private proposalFromReceipt(run: Run, receipt: MutationReceipt): ProposalRecord {
    const result = receipt.result;
    const proposalId =
      typeof result === 'object' && result !== null && !Array.isArray(result)
        ? result['proposalId']
        : null;
    if (typeof proposalId !== 'string') {
      throw new SwarmError('SWARM_INTERNAL', 'submit receipt is missing proposalId', {
        details: { runId: run.id, receiptKey: receipt.key },
      });
    }
    const proposal = run.proposals[proposalId];
    if (proposal === undefined) {
      throw new SwarmError('SWARM_INTERNAL', 'submit receipt references a missing proposal', {
        details: { runId: run.id, proposalId },
      });
    }
    return proposal;
  }

  private receipt(
    key: string,
    workerSessionId: string,
    toolCallId: string,
    method: string,
    result: MutationReceipt['result'],
  ): MutationReceipt {
    return {
      key,
      workerSessionId,
      toolCallId,
      method,
      result,
      createdAt: this.clock.now(),
    };
  }

  /**
   * 一次业务变更的聚合收尾：先隔离出可安全改写的副本（appendEvent 会原地写 events 与
   * workers[*].wakeTargetSeq），按顺序追加事件，再把 revision/updatedAt 各推进一次。
   * 只做纯数据变换，调用点都在 store.update 的 reducer 内。
   */
  private finalizeChange(run: Run, events: readonly EventInput[], now: number): Run {
    const workers: Record<WorkerId, WorkerRecord> = {};
    for (const [workerId, worker] of Object.entries(run.workers)) {
      workers[workerId] = { ...worker };
    }
    const next: Run = { ...run, workers, events: [...run.events] };
    for (const event of events) {
      appendEvent(next, event, now);
    }
    return { ...next, revision: next.revision + 1, updatedAt: now };
  }
}

/* ------------------------------------------------------------------ */
/* 纯函数辅助                                                          */
/* ------------------------------------------------------------------ */

/** finish 结构缺口的纯快照；`blocked` 为真表示还不能受理。 */
interface FinishGaps {
  missingCriteria: string[];
  unknownCriteria: string[];
  missingEvidence: string[];
  notReady: { workerId: WorkerId; state: WorkerInitializationState }[];
  unfinishedTasks: { taskId: TaskId; status: string }[];
  pendingProposals: { proposalId: string; status: string }[];
  activeAttemptId: string | null;
  inFlightOperations: number;
  blocked: boolean;
}

/**
 * 计算 finish 的结构缺口（架构 §10.2）。纯函数：只读 run 与 notes，
 * 让“前置检查”和“原子受理时的复查”共用同一份判据。
 */
function finishGaps(
  run: Run,
  notes: readonly AcceptanceNote[],
  inFlightOperations: number,
): FinishGaps {
  const criteria = activeAcceptanceCriteria(run);
  const noteByCriterion = new Map<string, AcceptanceNote>();
  const unknownCriteria: string[] = [];
  for (const note of notes) {
    if (!criteria.includes(note.criterion)) {
      unknownCriteria.push(note.criterion);
      continue;
    }
    noteByCriterion.set(note.criterion, note);
  }
  const missingCriteria = criteria.filter((criterion) => !noteByCriterion.has(criterion));
  const missingEvidence = [...noteByCriterion.entries()]
    .filter(([, note]) => note.evidence.length === 0)
    .map(([criterion]) => criterion);
  const notReady = Object.values(run.workers)
    .filter((worker) => worker.initializationState !== 'ready')
    .map((worker) => ({ workerId: worker.id, state: worker.initializationState }));
  const unfinishedTasks = Object.values(run.tasks)
    .filter((task) => task.status !== 'done' && task.status !== 'cancelled')
    .map((task) => ({ taskId: task.id, status: task.status }));
  const pendingProposals = Object.values(run.proposals)
    .filter((proposal) => proposal.status === 'queued' || proposal.status === 'integrating')
    .map((proposal) => ({ proposalId: proposal.id, status: proposal.status }));

  const blocked =
    missingCriteria.length > 0 ||
    unknownCriteria.length > 0 ||
    missingEvidence.length > 0 ||
    notReady.length > 0 ||
    unfinishedTasks.length > 0 ||
    pendingProposals.length > 0 ||
    run.activeAttemptId !== null ||
    inFlightOperations > 0;

  return {
    missingCriteria,
    unknownCriteria,
    missingEvidence,
    notReady,
    unfinishedTasks,
    pendingProposals,
    activeAttemptId: run.activeAttemptId,
    inFlightOperations,
    blocked,
  };
}

function validateStartInput(ownerSessionId: string, spec: RunSpec): void {
  if (typeof ownerSessionId !== 'string' || ownerSessionId.trim() === '') {
    throw new SwarmError('SWARM_INVALID_INPUT', 'ownerSessionId must be a non-empty string');
  }
  if (spec === null || typeof spec !== 'object') {
    throw new SwarmError('SWARM_INVALID_SPEC', 'run spec must be an object');
  }
  const issues: { path: string; message: string }[] = [];
  if (typeof spec.goal !== 'string' || spec.goal.trim() === '') {
    issues.push({ path: 'goal', message: 'goal must be a non-empty string' });
  }
  if (!Array.isArray(spec.acceptanceCriteria) || spec.acceptanceCriteria.length === 0) {
    issues.push({ path: 'acceptanceCriteria', message: 'at least one criterion is required' });
  }
  if (!Number.isSafeInteger(spec.workers) || spec.workers < MIN_WORKERS) {
    issues.push({ path: 'workers', message: `workers must be a safe integer at least ${MIN_WORKERS}` });
  }
  if (!Number.isInteger(spec.budgetMinutes) || spec.budgetMinutes < 0) {
    issues.push({ path: 'budgetMinutes', message: 'budgetMinutes must be a non-negative integer (0 means no deadline)' });
  }
  if (typeof spec.repository !== 'string' || !spec.repository.startsWith('/')) {
    issues.push({ path: 'repository', message: 'repository must be an absolute path' });
  }
  if (
    spec.verification === null ||
    typeof spec.verification !== 'object' ||
    !Array.isArray(spec.verification.test) ||
    spec.verification.test.length === 0
  ) {
    issues.push({ path: 'verification.test', message: 'at least one test command is required' });
  }
  if (issues.length > 0) {
    throw new SwarmError('SWARM_INVALID_SPEC', 'run spec is not usable for start', {
      details: { issues },
    });
  }
}

function validateSubmitInput(
  workerSessionId: string,
  input: { taskId: string; expectedRevision: number; sourceCommit: string },
  callId: string,
): void {
  const issues: { path: string; message: string }[] = [];
  if (typeof workerSessionId !== 'string' || workerSessionId.trim() === '') {
    issues.push({ path: 'workerSessionId', message: 'workerSessionId must be a non-empty string' });
  }
  if (typeof callId !== 'string' || callId.trim() === '') {
    issues.push({ path: 'callId', message: 'callId must be a non-empty string' });
  }
  if (typeof input.taskId !== 'string' || input.taskId.trim() === '') {
    issues.push({ path: 'taskId', message: 'taskId must be a non-empty string' });
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    issues.push({ path: 'expectedRevision', message: 'expectedRevision must be a non-negative integer' });
  }
  if (typeof input.sourceCommit !== 'string' || input.sourceCommit.trim() === '') {
    issues.push({ path: 'sourceCommit', message: 'sourceCommit must be a non-empty string' });
  }
  if (issues.length > 0) {
    throw new SwarmError('SWARM_INVALID_INPUT', 'submit input is invalid', { details: { issues } });
  }
}

function validateFinishInput(
  workerSessionId: string,
  input: { acceptedCommit: string; notes: AcceptanceNote[]; goalRevision?: number },
  callId: string,
): void {
  const issues: { path: string; message: string }[] = [];
  if (typeof workerSessionId !== 'string' || workerSessionId.trim() === '') {
    issues.push({ path: 'workerSessionId', message: 'workerSessionId must be a non-empty string' });
  }
  if (typeof callId !== 'string' || callId.trim() === '') {
    issues.push({ path: 'callId', message: 'callId must be a non-empty string' });
  }
  if (typeof input.acceptedCommit !== 'string' || input.acceptedCommit.trim() === '') {
    issues.push({ path: 'acceptedCommit', message: 'acceptedCommit must be a non-empty string' });
  }
  if (input.goalRevision !== undefined && (!Number.isSafeInteger(input.goalRevision) || input.goalRevision < 0)) {
    issues.push({ path: 'goalRevision', message: 'goalRevision must be a non-negative integer' });
  }
  if (!Array.isArray(input.notes) || input.notes.length === 0) {
    issues.push({ path: 'notes', message: 'at least one acceptance note is required' });
  } else {
    for (const [index, note] of input.notes.entries()) {
      if (typeof note.criterion !== 'string' || note.criterion.trim() === '') {
        issues.push({ path: `notes[${index}].criterion`, message: 'criterion must be non-empty' });
      }
      if (!Array.isArray(note.evidence)) {
        issues.push({ path: `notes[${index}].evidence`, message: 'evidence must be an array' });
      } else if (note.evidence.some((item) => typeof item !== 'string' || item.trim() === '')) {
        issues.push({ path: `notes[${index}].evidence`, message: 'evidence entries must be non-empty' });
      }
    }
  }
  if (issues.length > 0) {
    throw new SwarmError('SWARM_INVALID_INPUT', 'finish input is invalid', { details: { issues } });
  }
}

function assertPositiveMinutes(budgetMinutes: number): void {
  if (!Number.isInteger(budgetMinutes) || budgetMinutes <= 0) {
    throw new SwarmError('SWARM_INVALID_INPUT', 'additional budget must be a positive integer of minutes', {
      details: { budgetMinutes },
    });
  }
}

function receiptKeyFor(workerSessionId: string, callId: string): string {
  return `${workerSessionId}:${callId}`;
}

function reserveWorker(run: Run, now: number): WorkerRecord {
  let index = Object.keys(run.workers).length + 1;
  while (run.workers[`${run.id}-w${index}`]) index += 1;
  const id = `${run.id}-w${index}`;
  return {
    id,
    displayName: randomWorkerName(Object.values(run.workers).map(workerDisplayName)),
    sessionId: `${id}-session`,
    branch: id,
    worktreePath: null,
    initializationState: 'pending',
    initializationError: null,
    unavailableReason: null,
    offeredSeq: 0,
    observedSeq: 0,
    notifiedSeq: 0,
    wakeTargetSeq: 0,
    waitRegistration: null,
    currentTaskId: null,
    createdAt: now,
  };
}

function reserveWorkers(run: Run, count: number, now: number): Record<WorkerId, WorkerRecord> {
  const workers: Record<WorkerId, WorkerRecord> = {};
  for (let index = 0; index < count; index += 1) {
    const worker = reserveWorker({ ...run, workers }, now);
    workers[worker.id] = worker;
  }
  return workers;
}

function findLiveProposal(
  run: Run,
  taskId: TaskId,
  sourceCommit: CommitSha | null,
): ProposalRecord | null {
  for (const proposal of Object.values(run.proposals)) {
    if (proposal.taskId !== taskId) {
      continue;
    }
    if (proposal.status !== 'queued' && proposal.status !== 'integrating' && proposal.status !== 'accepted') {
      continue;
    }
    if (sourceCommit !== null && proposal.sourceCommit !== sourceCommit) {
      continue;
    }
    return proposal;
  }
  return null;
}

function findReusableVerification(run: Run, fingerprint: string): VerificationRecord | null {
  for (const verification of Object.values(run.verifications)) {
    if (
      verification.status === 'passed' &&
      verification.commit === run.acceptedHead &&
      verification.configFingerprint === fingerprint &&
      (verification.goalRevision ?? 0) === run.goalRevision
    ) {
      return verification;
    }
  }
  return null;
}

function decisionFromReceipt(receipt: MutationReceipt): FinishDecision {
  const result = receipt.result;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new SwarmError('SWARM_INTERNAL', 'finish receipt is not an object', {
      details: { receiptKey: receipt.key },
    });
  }
  const finishRequestId = result['finishRequestId'];
  if (typeof finishRequestId !== 'string') {
    throw new SwarmError('SWARM_INTERNAL', 'finish receipt is missing finishRequestId', {
      details: { receiptKey: receipt.key },
    });
  }
  const verificationId = result['verificationId'];
  return {
    status: 'accepted',
    finishRequestId,
    verificationId: typeof verificationId === 'string' ? verificationId : null,
  };
}

function interruptReason(reason: string): 'pause' | 'stop' | 'budget' {
  if (reason === 'user_pause') {
    return 'pause';
  }
  if (reason === 'budget_exhausted') {
    return 'budget';
  }
  return 'stop';
}

function countTasks(run: Run): TaskCounts {
  const counts: TaskCounts = {
    open: 0,
    claimed: 0,
    proposed: 0,
    done: 0,
    blocked: 0,
    cancelled: 0,
    total: 0,
  };
  for (const task of Object.values(run.tasks)) {
    counts[task.status] += 1;
    counts.total += 1;
  }
  return counts;
}

function countByStatus<T extends string>(
  records: readonly { status: T }[],
  statuses: readonly T[],
): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const status of statuses) {
    counts[status] = 0;
  }
  for (const record of records) {
    counts[record.status] = (counts[record.status] ?? 0) + 1;
  }
  return counts;
}
