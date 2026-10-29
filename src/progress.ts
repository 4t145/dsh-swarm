/**
 * Read-only swarm progress projection shared with the Web UI.
 *
 * This module owns a bounded public DTO derived from the runtime's existing
 * `status(ownerSessionId)` summary, an owner-checked task/event view, and the
 * native session projection's tool/lifecycle facts. It never exposes chat,
 * findings, tool arguments/results, artifacts or Git commands, and it never
 * imports React: the browser panel lives in `client.js` and reaches this service
 * through the Typert Gateway.
 *
 * The service extends {@link TypertRemoteService} and marks `snapshot`/`watch`
 * with the protocol's Remote markers. Installing the markers explicitly keeps
 * the source-fallback method names stable without a Typert code-generation
 * step; the resulting markers are identical to `@Remote` /
 * `@Remote({ mode: 'stream' })`.
 *
 * @module @deepseek-ai/dsh-swarm/progress
 */

import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import {
  RemoteError,
  TypertRemoteService,
  remoteMethods,
} from '@deepseek-ai/dsh-typert-protocol';
import { isSwarmError } from './errors.ts';
import { markRemoteMethod } from './remote-marker.ts';
import { ConversationLog, type ConversationPage } from './conversation-log.ts';
import { PublicHistoryReader, type PublicReaderPort } from './public-remote.ts';
import type { PublicQuery } from './public-input.ts';
import type { PublicPage } from './public-query.ts';
import type { ChannelRecord, ThreadRecord, ResponseRequestRecord, AgreementRecord } from './public-types.ts';
import { WorktreeHistory, type WorktreeHistoryGitPort, type WorktreeHistoryPage } from './worktree-history.ts';
import { workerDisplayName } from './worker-names.ts';
import { isTerminalRunPhase } from './types.ts';
import type { Run, RunPhase, RunId, WorkerInitializationState, SwarmEvent, WaitRegistration, ProposalRecord } from './types.ts';
import { registerWorkerActivity, toWorkerActivity, type WorkerActivity, type WorkerActivitySource } from './worker-activity.ts';
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
  goalChars: 16000,
  goalBoard: 40,
  goalCriteria: 32,
  criterionChars: 2000,
  taskBoard: 40,
  recentEvents: 24,
  interactions: 80,
  waitIds: 16,
});

/** 一个 worker 当前持有的 task；只含任务板公开字段，不含 acceptance 正文。 */
export interface ProgressTask {
  readonly id: string;
  readonly subject: string;
  readonly status: string;
  readonly revision: number;
}

export interface ProgressBoardTask extends ProgressTask {
  readonly ownerWorkerId: string | null;
  readonly proposalId: string | null;
}

export interface ProgressEvent {
  readonly seq: number;
  readonly kind: 'task' | 'proposal' | 'head' | 'run';
  readonly objectId: string;
  readonly status: string;
  readonly authorWorkerId: string | null;
  readonly createdAt: number;
}

/**
 * Worker-to-worker and worker-to-result interaction metadata. Never carries message
 * bodies or finding text: a message is only "actor → peer at time".
 */
export interface ProgressInteraction {
  readonly seq: number;
  readonly kind: 'message' | 'finding' | 'task' | 'proposal' | 'head';
  /** Task/proposal status, finding kind, `sent` for messages, `accepted` for head. */
  readonly status: string;
  readonly actorWorkerId: string | null;
  /** Message target, proposal author or task owner; null when there is none. */
  readonly peerWorkerId: string | null;
  /** Task id, proposal id or accepted SHA; empty for messages and findings, whose ids stay private. */
  readonly objectId: string;
  readonly taskId: string | null;
  readonly createdAt: number;
}

export interface ProgressProposal {
  readonly id: string;
  readonly taskId: string;
  readonly status: 'queued' | 'integrating';
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 一个 worker 的原生运行状态；`unavailable` 是插件诊断标签，不是 DSH 状态。 */
export interface ProgressWorker {
  readonly id: string;
  readonly displayName: string;
  readonly nativeStatus: NativeWorkerStatus;
  readonly initializationState: WorkerInitializationState;
  readonly currentTask: ProgressTask | null;
  readonly wait: WaitRegistration | null;
  readonly currentProposal: ProgressProposal | null;
  readonly activity: WorkerActivity;
  /** 原生状态读取失败或初始化失败的有界诊断；成功时为 null。 */
  readonly diagnostic: string | null;
  /** Host 隔离该 worker 的原因码（activation_failed / no_progress / initialization_failed）；可用时为 null。 */
  readonly unavailableReason: string | null;
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

/** Append-only owner goal facts; compatible with persisted GoalRecord. */
export interface ProgressGoal {
  readonly id: string;
  readonly seq: number;
  readonly text: string;
  readonly acceptanceCriteria: readonly string[];
  readonly status: 'active' | 'deferred' | 'completed';
  readonly createdAt: number;
  readonly completedAt: number | null;
  readonly completedCommit: string | null;
  readonly continuedInRunId: string | null;
}

export interface ProgressGoalBoard {
  readonly items: readonly (ProgressGoal & { readonly truncated: boolean })[];
  readonly total: number;
  readonly truncated: boolean;
  readonly revision: number;
  readonly counts: { readonly active: number; readonly deferred: number; readonly completed: number; readonly continued: number };
}

/** Public protocol capability and bounded invalidation metadata; bodies stay on demand. */
export interface PublicActivitySummary {
  readonly protocolVersion: 1;
  readonly latestSeq: number;
  readonly channels: number;
  readonly threads: number;
  readonly pendingRequests: number;
  readonly agreements: number;
}

/** 面板渲染所需的全部公开事实；不含私信、finding 正文或完整事件日志。 */
export interface ProgressSnapshot {
  readonly protocolVersion: 2;
  readonly publicActivity: PublicActivitySummary | null;
  readonly goal: string | null;
  readonly acceptanceCriteria: readonly string[];
  readonly originalGoalTruncated: boolean;
  /** Null means unavailable, not an empty goal list. Additive v2 extension. */
  readonly goalBoard: ProgressGoalBoard | null;
  readonly createdAt: number | null;
  readonly taskBoard: { readonly items: readonly ProgressBoardTask[]; readonly total: number; readonly truncated: boolean };
  readonly recentEvents: readonly ProgressEvent[];
  /** Additive v2 extension; newest last, bounded by `PROGRESS_LIMITS.interactions`. */
  readonly interactions: readonly ProgressInteraction[];
  readonly runId: RunId;
  readonly phase: RunPhase;
  readonly reason: string | null;
  readonly quiesceTarget: RunStatus['quiesceTarget'];
  readonly budgetExpired: boolean;
  readonly deadline: number | null;
  readonly now: number;
  /** 无截止时间时为 null，否则 `max(0, deadline - now)`。 */
  readonly remainingMs: number | null;
  readonly tasks: ProgressTaskCounts;
  readonly workers: readonly ProgressWorker[];
  readonly workerControls: NonNullable<RunStatus['workerControls']> | null;
  readonly proposals: ProgressProposalCounts;
  readonly verifications: ProgressVerificationCounts;
  readonly finishRequest: RunStatus['finishRequest'];
  readonly acceptedHead: string;
  readonly baseCommit: string;
  readonly resultRef: string;
  /** 任务板只读视图读取失败时的有界诊断；成功为 null。 */
  readonly detailError: string | null;
  /** Snapshot generation time, not the timestamp of a public business change. */
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
  readonly publicCollaboration?: PublicReaderPort;
}

/** 任务板/worker 归属的最小只读视图；真实 `Run` 直接满足。 */
export interface ProgressRunDetail {
  readonly ownerSessionId?: string;
  readonly channels?: Readonly<Record<string, ChannelRecord>>;
  readonly threads?: Readonly<Record<string, ThreadRecord>>;
  readonly responseRequests?: Readonly<Record<string, ResponseRequestRecord>>;
  readonly agreements?: Readonly<Record<string, AgreementRecord>>;
  readonly goal?: string;
  readonly acceptanceCriteria?: readonly string[];
  readonly goals?: Readonly<Record<string, ProgressGoal>>;
  readonly goalRevision?: number;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly tasks: Readonly<Record<string, ProgressTask & {
    readonly ownerWorkerId?: string | null;
    readonly proposalId?: string | null;
  }>>;
  readonly workers: Readonly<Record<string, {
    readonly currentTaskId: string | null;
    readonly waitRegistration?: WaitRegistration | null;
  }>>;
  readonly proposals?: Readonly<Record<string, Pick<ProposalRecord,
    'id' | 'taskId' | 'authorWorkerId' | 'status' | 'createdAt' | 'updatedAt'>>>;
  readonly events?: readonly SwarmEvent[];
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
  /** Plugin-owned activity source; feed teardown disposes it, including its registry unit. */
  readonly activity?: WorkerActivitySource;
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
  // Legacy completed runs may retain a stale pointer; never rewrite their durable history.
  if (task === undefined || (task.status !== 'claimed' && task.status !== 'proposed')) return null;
  if (task.ownerWorkerId != null && task.ownerWorkerId !== worker.id) return null;
  return {
    id: task.id,
    subject: bounded(task.subject, PROGRESS_LIMITS.subjectChars) ?? '',
    status: task.status,
    revision: task.revision,
  };
}

function taskBoard(detail: ProgressRunDetail | undefined): ProgressSnapshot['taskBoard'] {
  const tasks = Object.values(detail?.tasks ?? {});
  const rank = (task: ProgressTask): number => task.status === 'claimed' || task.status === 'proposed' ? 0
    : task.status === 'open' || task.status === 'blocked' ? 1 : 2;
  tasks.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  return {
    items: tasks.slice(0, PROGRESS_LIMITS.taskBoard).map((task) => ({
      id: task.id, subject: bounded(task.subject, PROGRESS_LIMITS.subjectChars) ?? '',
      status: task.status, revision: task.revision,
      ownerWorkerId: task.ownerWorkerId ?? null, proposalId: task.proposalId ?? null,
    })),
    total: tasks.length, truncated: tasks.length > PROGRESS_LIMITS.taskBoard,
  };
}

/** Keep the input's default criterion (the whole goal) without clipping it twice. */
function goalCriteria(criteria: readonly string[], text: string): string[] {
  return criteria.slice(0, PROGRESS_LIMITS.goalCriteria).map((criterion) =>
    bounded(criterion, criterion === text ? PROGRESS_LIMITS.goalChars : PROGRESS_LIMITS.criterionChars) ?? '');
}

function goalTruncated(text: string, criteria: readonly string[]): boolean {
  return text.length > PROGRESS_LIMITS.goalChars || criteria.length > PROGRESS_LIMITS.goalCriteria
    || criteria.some((criterion) => criterion.length > (criterion === text ? PROGRESS_LIMITS.goalChars : PROGRESS_LIMITS.criterionChars));
}

function goalBoard(detail: ProgressRunDetail | undefined): ProgressGoalBoard | null {
  if (!detail?.goals) return null;
  const goals = Object.values(detail.goals);
  const counts = { active: 0, deferred: 0, completed: 0, continued: 0 };
  for (const goal of goals) counts[goal.continuedInRunId ? 'continued' : goal.status]++;
  // Pending work stays visible even when completed history exceeds the bound.
  const rank = (goal: ProgressGoal): number => goal.continuedInRunId || goal.status === 'completed' ? 1 : 0;
  goals.sort((a, b) => rank(a) - rank(b) || b.seq - a.seq);
  return {
    items: goals.slice(0, PROGRESS_LIMITS.goalBoard).map((goal) => ({
      id: goal.id, seq: goal.seq, text: bounded(goal.text, PROGRESS_LIMITS.goalChars) ?? '',
      acceptanceCriteria: goalCriteria(goal.acceptanceCriteria, goal.text), status: goal.status,
      createdAt: goal.createdAt, completedAt: goal.completedAt, completedCommit: goal.completedCommit,
      continuedInRunId: goal.continuedInRunId, truncated: goalTruncated(goal.text, goal.acceptanceCriteria),
    })),
    total: goals.length, truncated: goals.length > PROGRESS_LIMITS.goalBoard,
    revision: detail.goalRevision ?? 0, counts,
  };
}

function recentEvents(detail: ProgressRunDetail | undefined, runId: string): ProgressEvent[] {
  const events = detail?.events ?? [];
  const result: ProgressEvent[] = [];
  for (let index = events.length - 1; index >= 0 && result.length < PROGRESS_LIMITS.recentEvents; index--) {
    const event = events[index];
    if (!event || event.audience.kind !== 'all') continue;
    let objectId: string;
    let status: string;
    switch (event.kind) {
      case 'task': objectId = event.taskId; status = event.status; break;
      case 'proposal': objectId = event.proposalId; status = event.status; break;
      case 'head': objectId = event.acceptedHead; status = 'accepted'; break;
      case 'run': objectId = runId; status = event.phase; break;
      default: continue; // Finding/message metadata is not public activity either.
    }
    result.push({ seq: event.seq, kind: event.kind, objectId, status,
      authorWorkerId: event.authorWorkerId, createdAt: event.createdAt });
  }
  return result.reverse();
}

function interactions(detail: ProgressRunDetail | undefined): ProgressInteraction[] {
  const events = detail?.events ?? [];
  const result: ProgressInteraction[] = [];
  for (let index = events.length - 1; index >= 0 && result.length < PROGRESS_LIMITS.interactions; index--) {
    const event = events[index];
    if (!event) continue;
    const base = { seq: event.seq, actorWorkerId: event.authorWorkerId, createdAt: event.createdAt };
    switch (event.kind) {
      case 'message':
        result.push({ ...base, kind: 'message', status: 'sent', peerWorkerId: event.targetWorkerId, objectId: '', taskId: null });
        break;
      case 'finding':
        result.push({ ...base, kind: 'finding', status: event.findingKind, peerWorkerId: null, objectId: '', taskId: event.taskId });
        break;
      case 'task':
        result.push({ ...base, kind: 'task', status: event.status, peerWorkerId: event.ownerWorkerId, objectId: event.taskId, taskId: event.taskId });
        break;
      case 'proposal':
        result.push({ ...base, kind: 'proposal', status: event.status, peerWorkerId: detail?.proposals?.[event.proposalId]?.authorWorkerId ?? null, objectId: event.proposalId, taskId: event.taskId });
        break;
      case 'head': {
        const author = event.proposalId ? detail?.proposals?.[event.proposalId]?.authorWorkerId ?? null : null;
        result.push({ ...base, kind: 'head', status: 'accepted', peerWorkerId: author, objectId: event.acceptedHead, taskId: null });
        break;
      }
      case 'public':
        break; // Public discussion bodies are queried on demand, not copied into progress.
      case 'run':
      case 'goal':
        break; // Control and goal changes are shown by the dashboard and goal board.
      default: {
        const unknown: never = event;
        void unknown;
      }
    }
  }
  return result.reverse();
}

function workerWait(workerId: string, detail: ProgressRunDetail | undefined): WaitRegistration | null {
  const wait = detail?.workers[workerId]?.waitRegistration;
  return wait ? { mode: wait.mode, afterSeq: wait.afterSeq,
    taskIds: wait.taskIds.slice(0, PROGRESS_LIMITS.waitIds),
    proposalIds: wait.proposalIds.slice(0, PROGRESS_LIMITS.waitIds) } : null;
}

function currentProposal(workerId: string, detail: ProgressRunDetail | undefined): ProgressProposal | null {
  const proposal = Object.values(detail?.proposals ?? {}).find((value) => value.authorWorkerId === workerId
    && (value.status === 'queued' || value.status === 'integrating'));
  if (!proposal || (proposal.status !== 'queued' && proposal.status !== 'integrating')) return null;
  return { id: proposal.id, taskId: proposal.taskId, status: proposal.status,
    createdAt: proposal.createdAt, updatedAt: proposal.updatedAt };
}

function diagnosticOf(worker: WorkerStatusSummary): string | null {
  const detail = (worker as { unavailableDetail?: { diagnostic?: unknown } | null }).unavailableDetail;
  const isolated = worker.unavailableReason && typeof detail?.diagnostic === 'string'
    ? `${worker.unavailableReason}: ${detail.diagnostic}` : null;
  return bounded(
    worker.nativeStatusError ?? isolated ?? worker.unavailableReason ?? worker.initializationError,
    PROGRESS_LIMITS.diagnosticChars,
  );
}

function readActivity(worker: WorkerStatusSummary, source: Pick<WorkerActivitySource, 'read'> | undefined): WorkerActivity {
  try {
    return toWorkerActivity(source?.read(worker.sessionId), worker.nativeStatus);
  } catch {
    // Projection failures can carry log/provider text; expose capability failure, not its contents.
    return toWorkerActivity(undefined, worker.nativeStatus, 'worker activity projection unavailable');
  }
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
  activity?: Pick<WorkerActivitySource, 'read'>,
): ProgressSnapshot {
  return {
    protocolVersion: 2,
    publicActivity: detail?.channels ? { protocolVersion: 1,
      latestSeq: detail.events?.findLast((event) => event.kind === 'public')?.seq ?? 0,
      channels: Object.keys(detail.channels).length, threads: Object.keys(detail.threads ?? {}).length,
      pendingRequests: Object.values(detail.responseRequests ?? {}).filter((request) => request.status === 'pending').length,
      agreements: Object.keys(detail.agreements ?? {}).length } : null,
    goal: bounded(detail?.goal, PROGRESS_LIMITS.goalChars),
    acceptanceCriteria: goalCriteria(detail?.acceptanceCriteria ?? [], detail?.goal ?? ''),
    originalGoalTruncated: goalTruncated(detail?.goal ?? '', detail?.acceptanceCriteria ?? []),
    goalBoard: goalBoard(detail),
    createdAt: detail?.createdAt ?? null,
    taskBoard: taskBoard(detail),
    recentEvents: recentEvents(detail, status.runId),
    interactions: interactions(detail),
    runId: status.runId,
    phase: status.phase,
    reason: bounded(status.reason, PROGRESS_LIMITS.reasonChars),
    quiesceTarget: status.quiesceTarget,
    budgetExpired: status.budgetExpired,
    deadline: status.deadline,
    now,
    remainingMs: status.deadline === null ? null : Math.max(0, status.deadline - now),
    tasks: countTasks(status.tasks),
    workerControls: status.workerControls ? { ...status.workerControls,
      diagnostic: bounded(status.workerControls.diagnostic, PROGRESS_LIMITS.diagnosticChars) } : null,
    // The Host owns team admission; never hide admitted members behind a UI cap.
    workers: status.workers.map((worker) => ({
      id: worker.id,
      displayName: workerDisplayName(worker),
      nativeStatus: worker.nativeStatus,
      initializationState: worker.initializationState,
      currentTask: currentTask(worker, detail),
      wait: workerWait(worker.id, detail),
      currentProposal: currentProposal(worker.id, detail),
      activity: readActivity(worker, activity),
      diagnostic: diagnosticOf(worker),
      unavailableReason: bounded(worker.unavailableReason, PROGRESS_LIMITS.reasonChars),
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
  private readonly unsubscribeActivity: (() => void) | undefined;
  private disposed = false;

  constructor(runtime: ProgressRuntimePort, options: ProgressFeedOptions) {
    this.runtime = runtime;
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.unsubscribeAgent = options.agentEvents?.((agentSessionId) => this.onAgentEvent(agentSessionId));
    try {
      this.unsubscribeActivity = options.activity?.subscribe((sessionId) => this.onAgentEvent(sessionId));
    } catch (error) {
      this.unsubscribeAgent?.();
      options.activity?.dispose();
      throw error;
    }
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
        // Membership inspection follows the same owner boundary as snapshots.
        if (status.ownerSessionId !== ownerSessionId) {
          for (const watcher of [...watchers]) watcher.notify();
          continue;
        }
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
    if (detail?.ownerSessionId !== undefined && detail.ownerSessionId !== sessionId) {
      throw new RemoteError('swarm-progress/forbidden', 'session may not read another session\'s swarm run',
        { sessionId, runId: status.runId });
    }
    return toProgressSnapshot(status, detail, this.now(), detailError, this.options.activity);
  }

  /**
   * 先从当前快照开始，之后每个与 owner 相关的持久化变更后重算一帧；快照不变时
   * 不重复发送。终态 run 发送最后一帧后结束。`signal` 取消只结束本次读取。
   */
  watch(sessionId: string, signal?: AbortSignal): AsyncIterable<ProgressWatchItem> {
    return this.stream(sessionId, signal, false);
  }

  /** Observe this owner across terminal runs and future starts; abort/dispose ends the stream. */
  watchSession(sessionId: string, signal?: AbortSignal): AsyncIterable<ProgressWatchItem> {
    return this.stream(sessionId, signal, true);
  }

  private async *stream(sessionId: string, signal: AbortSignal | undefined, continuous: boolean): AsyncIterable<ProgressWatchItem> {
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
      if (closed) return;
      pending = true;
      wake?.();
    };
    let unsubscribe: (() => void) | undefined;
    let cleaned = false;
    const watchers = this.watchers.get(sessionId) ?? new Set<ProgressWatcher>();
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      watchers.delete(watcher);
      if (watchers.size === 0 && this.watchers.get(sessionId) === watchers) this.watchers.delete(sessionId);
      signal?.removeEventListener('abort', stop);
      unsubscribe?.();
    };
    const stop = (): void => {
      closed = true;
      wake?.();
      cleanup(); // Also release subscriptions while the generator is suspended at yield.
    };
    const watcher: ProgressWatcher = { notify, close: stop };
    watchers.add(watcher);
    this.watchers.set(sessionId, watchers);
    try {
      unsubscribe = this.options.subscribe((change) => {
        if (change.ownerSessionId === sessionId) notify();
      });
      if (closed) { unsubscribe(); return; }
      signal?.addEventListener('abort', stop, { once: true });
      // Registration itself can synchronously cancel; no opening frame may escape that cancellation.
      if (signal?.aborted) stop();
      while (!closed) {
        pending = false;
        const progress = this.snapshot(sessionId);
        // 变更通知可能由与本 run 无关的字段触发；内容不变时保持单帧，避免刷屏。
        const serialized = progress === null ? 'null' : JSON.stringify({ ...progress,
          now: undefined, remainingMs: undefined, updatedAt: undefined });
        if (closed) return;
        if (serialized !== last) {
          last = serialized;
          yield { seq: ++seq, progress };
        }
        if (!continuous && progress !== null && isTerminalRunPhase(progress.phase)) return;
        while (!closed && !pending) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
      }
    } finally {
      cleanup();
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
    this.unsubscribeActivity?.();
    this.options.activity?.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Host Remote 服务                                                    */
/* ------------------------------------------------------------------ */

/** Preserve each read endpoint's input path while sharing its stable Remote error contract. */
function progressReadError(error: unknown, sessionId: string, inputPath: string): unknown {
  if (!isSwarmError(error)) return error;
  if (error.code === 'SWARM_FORBIDDEN') {
    return new RemoteError('swarm-progress/forbidden', error.message, { sessionId, runId: '' });
  }
  if (error.code === 'SWARM_INVALID_INPUT' || error.code === 'SWARM_INVALID_CURSOR' || error.code === 'SWARM_NOT_FOUND') {
    return new RemoteError('gateway/bad-request', error.message, { issues: [{ path: inputPath, message: error.message }] });
  }
  return new RemoteError('gateway/internal', error.message, {});
}

/**
 * Host 侧只读进度服务；服务键与 Remote 命名空间均为 `swarmProgress`。
 */
export class ProgressService extends TypertRemoteService<never> {
  private readonly feed: ProgressFeed;
  private readonly publicHistory: PublicHistoryReader | null;

  constructor(
    ctx: Context,
    runtime: ProgressRuntimePort,
    options: ProgressFeedOptions,
    private readonly history?: WorktreeHistory,
    private readonly conversations?: ConversationLog,
  ) {
    super(ctx, 'swarmProgress');
    this.feed = new ProgressFeed(runtime, options);
    this.publicHistory = runtime.publicCollaboration ? new PublicHistoryReader(runtime, runtime.publicCollaboration) : null;
  }

  /** 当前快照；没有 run 时返回 null。 */
  snapshot(sessionId: string): ProgressSnapshot | null {
    return this.feed.snapshot(sessionId);
  }

  /** 事件驱动的进度流；取消只结束本次读取。 */
  watch(sessionId: string, signal?: AbortSignal): AsyncIterable<ProgressWatchItem> {
    return this.feed.watch(sessionId, signal);
  }

  /** Continuous owner-session subscription, including future runs after a terminal frame. */
  watchSession(sessionId: string, signal?: AbortSignal): AsyncIterable<ProgressWatchItem> {
    return this.feed.watchSession(sessionId, signal);
  }

  /**
   * A bounded page of the merged worker/result Git DAG; a null cursor captures
   * fresh heads.
   *
   * SRC fallback: parameters must stay bare identifiers (no defaults or
   * destructuring), or the gateway rejects the endpoint at discovery.
   */
  async worktreeHistory(sessionId: string, cursor: string | null, signal?: AbortSignal): Promise<WorktreeHistoryPage | null> {
    assertSessionId(sessionId);
    if (!this.history) throw new RemoteError('gateway/internal', 'Worktree history is unavailable on this Host', {});
    try { return await this.history.page(sessionId, cursor, signal); }
    catch (error) { throw progressReadError(error, sessionId, 'cursor'); }
  }

  /**
   * Owner-only page of worker messages and findings with bodies, newest first.
   * SRC fallback: bare identifier parameters only.
   */
  async conversation(sessionId: string, beforeSeq: number | null): Promise<ConversationPage | null> {
    assertSessionId(sessionId);
    if (!this.conversations) throw new RemoteError('gateway/internal', 'Worker conversations are unavailable on this Host', {});
    try { return this.conversations.page(sessionId, beforeSeq); }
    catch (error) { throw progressReadError(error, sessionId, 'beforeSeq'); }
  }

  /** Owner-only public records, bounded and validated by the same domain query as worker tools. */
  async publicDiscussion(sessionId: string, runId: string, query: PublicQuery, signal?: AbortSignal): Promise<PublicPage> {
    assertSessionId(sessionId);
    signal?.throwIfAborted();
    if (!this.publicHistory) throw new RemoteError('gateway/internal', 'Public collaboration is unavailable on this Host', {});
    try { return this.publicHistory.page(sessionId, runId, query); }
    catch (error) { throw progressReadError(error, sessionId, 'query'); }
  }

  /** 停止全部 watch 和 Git 读取；由 Host 卸载时调用。 */
  async dispose(): Promise<void> {
    this.publicHistory?.dispose();
    await this.feed.dispose();
    await this.history?.dispose();
  }
}

// 模块加载时安装标记（幂等）。prototype 上的 SRC 方法名来自真实参数名，
// 因此 snapshot/watch 必须保持简单的具名参数。
markRemoteMethod(ProgressService.prototype, 'worktreeHistory');
markRemoteMethod(ProgressService.prototype, 'conversation');
markRemoteMethod(ProgressService.prototype, 'publicDiscussion');
markRemoteMethod(ProgressService.prototype, 'snapshot');
markRemoteMethod(ProgressService.prototype, 'watch', { mode: 'stream' });
markRemoteMethod(ProgressService.prototype, 'watchSession', { mode: 'stream' });

/** 构造后即可用的进度服务；调用方负责在卸载时 `dispose()`。 */
export function registerProgress(
  ctx: Context,
  runtime: ProgressRuntimePort,
  store: {
    get(id: RunId): Run;
    subscribe(listener: (run: Run) => void): () => void;
  },
  options: { now?: () => number; git?: WorktreeHistoryGitPort } = {},
): ProgressService {
  const activity = registerWorkerActivity(ctx);
  try {
    return new ProgressService(ctx, runtime, {
      activity,
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
    }, options.git ? new WorktreeHistory({ status: (sessionId) => runtime.status(sessionId), getRun: (runId) => store.get(runId), git: options.git }) : undefined,
    new ConversationLog({ status: (sessionId) => runtime.status(sessionId), getRun: (runId) => store.get(runId) }));
  } catch (error) {
    activity.dispose();
    throw error;
  }
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

