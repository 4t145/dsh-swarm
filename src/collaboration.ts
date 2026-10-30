/**
 * 协作业务规则：任务、发现、私信、增量同步、等待登记与 owner 控制。
 *
 * 所有写入路径都把校验、变更、事件追加、revision 递增与幂等 receipt 放在
 * **同一个** StateStore.update 的同步 reducer 内完成；reducer 只操作 clone 副本，
 * 不 await 任何外部 IO。
 */

import { appendEvent, isEventVisible, matchesWait, pendingNotifications, shownEventSeq } from './events.ts';
import type { ShownReceipt } from './notification-receipts.ts';
import type { NotificationRecord } from './public-types.ts';
import { SwarmError } from './errors.ts';
import { isLiveFinding, liveClaims, withoutDetails } from './claims.ts';
import { DEFAULT_CLAIM_TTL_MS, FINDING_DETAILS_MAX_CHARS, FINDING_SUMMARY_LIMITS } from './schema.ts';
import { matchQuery, parseQuery, type QueryNode, type QuerySubject } from './query-expr.ts';
import { workerDisplayName } from './worker-names.ts';
import { activeAcceptanceCriteria, type GoalRecord } from './types.ts';
import type { StateStore } from './store.ts';
import type {
  EventSeq,
  FindingKind,
  FindingRecord,
  JsonValue,
  MessageRecord,
  Millis,
  MutationReceipt,
  ProposalRecord,
  Run,
  RunId,
  SwarmEvent,
  TaskKind,
  TaskRecord,
  TaskStatus,
  WaitRegistration,
  WorkerId,
  WorkerRecord,
} from './types.ts';

/* ------------------------------------------------------------------ */
/* 选项与结果类型                                                       */
/* ------------------------------------------------------------------ */

export interface CollaborationOptions {
  /** 当前时间（毫秒）；测试注入固定时钟。 */
  now?: () => number;
  /** `now` 的别名，兼容 Runtime 的 clock 选项。 */
  clock?: () => number;
  /** 生成业务实体 id；测试注入序列生成器。 */
  id?: () => string;
  /** 单页事件上限，默认 20。 */
  eventPageSize?: number;
  /** claim Finding 留在实时视图中的毫秒数，默认 1 小时。 */
  claimTtlMs?: number;
}

/** 一次 mutation 的身份：真实 session 与其在 run 内的 worker。 */
interface MutationIdentity {
  sessionId: string;
  workerId: WorkerId;
}

export interface CreateTaskInput {
  kind: TaskKind;
  subject: string;
  acceptance: string;
  scope: string[];
}

export type UpdateTaskAction =
  | 'claim'
  | 'release'
  | 'block'
  | 'unblock'
  | 'cancel'
  | 'research_complete';

export interface UpdateTaskInput {
  taskId: string;
  expectedRevision: number;
  action: UpdateTaskAction;
  reason?: string;
  findingId?: string;
}

export interface PublishInput {
  kind: FindingKind;
  summary: string;
  details?: string;
  scope?: string[];
  evidenceRefs?: string[];
  taskId?: string;
  supersedesId?: string;
  blockingRepairTaskId?: string;
}

export interface MessageInput {
  target: string;
  body: string;
}

export interface SyncInput {
  ackSeq?: number;
  limit?: number;
}

export interface ReadInput {
  id?: string;
  query?: string;
  cursor?: string;
  limit?: number;
}

export interface WaitInput {
  /** Omit to use the Host's durable display cursor. Explicit legacy ACK remains supported. */
  afterSeq?: number;
  taskIds?: string[];
  proposalIds?: string[];
}

export interface ControlTaskInput {
  taskId: string;
  expectedRevision: number;
  action: 'release' | 'cancel';
  reason: string;
}

export interface WorkerSummary {
  id: WorkerId;
  sessionId: string;
  branch: string;
  initializationState: WorkerRecord['initializationState'];
  currentTaskId: string | null;
  offeredSeq: EventSeq;
  observedSeq: EventSeq;
  wakeTargetSeq: EventSeq;
}

export interface TaskSummary {
  id: string;
  revision: number;
  kind: TaskKind;
  subject: string;
  status: TaskStatus;
  ownerWorkerId: WorkerId | null;
  createdByWorkerId: WorkerId | null;
  updatedAt: Millis;
}

/** 一条可见事件及其对应实体；不适用的实体一律为 null。 */
export interface SyncEventItem {
  event: SwarmEvent;
  task: TaskRecord | null;
  /** Pushed projection: `details` is omitted; `hasDetails` says whether swarm_read by id has more. */
  finding: (Omit<FindingRecord, 'details'> & { hasDetails: boolean }) | null;
  message: MessageRecord | null;
  proposal: ProposalRecord | null;
  goal: GoalRecord | null;
}

export interface AttentionSummary {
  /** References only. Preparing these is not proof of display or a full-message read. */
  attention: NotificationRecord[];
  attentionTotal: number;
  attentionHasMore: boolean;
}

export interface SyncResult extends AttentionSummary {
  fromSeq: EventSeq;
  runId: RunId;
  goal: string;
  acceptanceCriteria: string[];
  originalAcceptanceCriteria: string[];
  goalRevision: number;
  goals: GoalRecord[];
  goalsTotal: number;
  acceptedHead: string;
  worker: WorkerSummary;
  tasks: TaskSummary[];
  /** Live peer claims (unexpired, latest per author+task), newest last; announcements, not locks. */
  claims: LiveClaimSummary[];
  claimsTotal: number;
  events: SyncEventItem[];
  observedSeq: EventSeq;
  offeredSeq: EventSeq;
  throughSeq: EventSeq;
  hasMore: boolean;
}

export interface LiveClaimSummary {
  id: string;
  authorWorkerId: WorkerId;
  taskId: string | null;
  summary: string;
  scope: string[];
  createdAt: Millis;
  expiresAt: Millis;
}

export interface ReadItem {
  kind: 'task' | 'finding' | 'message' | 'goal';
  goal?: GoalRecord;
  task: TaskRecord | null;
  finding: FindingRecord | null;
  message: MessageRecord | null;
}

export interface ReadResult {
  runId: RunId;
  items: ReadItem[];
  total: number;
  hasMore: boolean;
  truncated: boolean;
  cursor: string | null;
  nextCursor: string | null;
}

export interface WaitResult extends AttentionSummary {
  fromSeq: EventSeq;
  runId: RunId;
  waiting: boolean;
  worker: WorkerSummary;
  events: SyncEventItem[];
  observedSeq: EventSeq;
  offeredSeq: EventSeq;
  throughSeq: EventSeq;
  hasMore: boolean;
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_EVENT_PAGE_SIZE = 20;
const MAX_READ_LIMIT = 20;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SwarmError('SWARM_INVALID_INPUT', `${field} must be a non-empty string`, {
      details: { field },
    });
  }
  return value;
}

function requireReason(reason: unknown, action: string): string {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new SwarmError('SWARM_INVALID_INPUT', `${action} requires a non-empty reason`, {
      details: { field: 'reason', action },
    });
  }
  return reason;
}

function decodeReceipt<T>(receipt: MutationReceipt): T {
  if (typeof receipt.result !== 'string') {
    throw new SwarmError('SWARM_STORE_CORRUPT', 'mutation receipt result is not encoded text', {
      details: { key: receipt.key },
    });
  }
  const parsed: T = JSON.parse(receipt.result);
  return parsed;
}

function encodeReceiptResult(value: unknown): JsonValue {
  return JSON.stringify(value);
}

function summarizeWorker(worker: WorkerRecord): WorkerSummary {
  return {
    id: worker.id,
    sessionId: worker.sessionId,
    branch: worker.branch,
    initializationState: worker.initializationState,
    currentTaskId: worker.currentTaskId,
    offeredSeq: worker.offeredSeq,
    observedSeq: worker.observedSeq,
    wakeTargetSeq: worker.wakeTargetSeq,
  };
}

function summarizeTask(task: TaskRecord): TaskSummary {
  return {
    id: task.id,
    revision: task.revision,
    kind: task.kind,
    subject: task.subject,
    status: task.status,
    ownerWorkerId: task.ownerWorkerId,
    createdByWorkerId: task.createdByWorkerId,
    updatedAt: task.updatedAt,
  };
}

function taskEventPayload(task: TaskRecord, authorWorkerId: WorkerId | null) {
  return {
    kind: 'task' as const,
    taskId: task.id,
    status: task.status,
    ownerWorkerId: task.ownerWorkerId,
    authorWorkerId,
    audience: { kind: 'all' as const },
  };
}

/* ------------------------------------------------------------------ */
/* Collaboration                                                       */
/* ------------------------------------------------------------------ */

/**
 * 协作业务入口。构造时只保存依赖，不读写 store。
 *
 * 公开的 mutation 方法都是 async：校验失败或 CAS 失败抛 SwarmError，
 * 成功返回持久化后的实体副本。相同 `(sessionId, callId)` 的重复调用
 * 只回放首次结果，不追加事件。
 */
export class Collaboration {
  private readonly store: StateStore;
  private readonly now: () => number;
  private readonly makeId: () => string;
  private readonly eventPageSize: number;
  private readonly claimTtlMs: number;

  /** Live-view TTL for claim Findings, shared with the passive notice projection. */
  get claimLiveTtlMs(): number {
    return this.claimTtlMs;
  }

  /** Clock used for claim expiry in live views. */
  currentTime(): number {
    return this.now();
  }

  constructor(store: StateStore, options: CollaborationOptions = {}) {
    this.store = store;
    this.now = options.now ?? options.clock ?? Date.now;
    this.makeId = options.id ?? (() => crypto.randomUUID());
    this.eventPageSize = options.eventPageSize ?? DEFAULT_EVENT_PAGE_SIZE;
    if (!Number.isInteger(this.eventPageSize) || this.eventPageSize < 1) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'eventPageSize must be a positive integer', {
        details: { eventPageSize: this.eventPageSize },
      });
    }
    this.claimTtlMs = options.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
    if (!Number.isInteger(this.claimTtlMs) || this.claimTtlMs < 1) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'claimTtlMs must be a positive integer', {
        details: { claimTtlMs: this.claimTtlMs },
      });
    }
  }

  /**
   * 按 sessionId 找到其 run 与 worker 记录。
   *
   * @throws SWARM_FORBIDDEN 该 session 不是任何 run 的 worker。
   */
  resolveWorker(sessionId: string): { run: Run; worker: WorkerRecord } {
    for (const run of this.store.list()) {
      for (const worker of Object.values(run.workers)) {
        if (worker.sessionId === sessionId) {
          return { run, worker };
        }
      }
    }
    throw new SwarmError('SWARM_FORBIDDEN', `session ${sessionId} is not a swarm worker`, {
      details: { sessionId },
    });
  }

  /* ------------------------------ task ---------------------------- */

  /** 创建 open 任务；revision=1、无 owner。 */
  async createTask(sessionId: string, input: CreateTaskInput, callId: string): Promise<TaskRecord> {
    const identity = this.identity(sessionId);
    const runId = this.resolveWorker(sessionId).run.id;
    const kind = input.kind;
    if (kind !== 'code' && kind !== 'research') {
      throw new SwarmError('SWARM_INVALID_INPUT', 'task kind must be code or research', {
        details: { kind },
      });
    }
    const subject = requireText(input.subject, 'subject');
    const acceptance = requireText(input.acceptance, 'acceptance');
    if (!Array.isArray(input.scope)) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'scope must be an array of strings', {
        details: { field: 'scope' },
      });
    }
    const scope = input.scope.map((entry, index) => requireText(entry, `scope[${index}]`));

    return this.mutate(runId, identity, callId, 'createTask', (draft, now, worker) => {
      const task: TaskRecord = {
        id: this.makeId(),
        revision: 1,
        createdByWorkerId: worker.id,
        kind,
        subject,
        acceptance,
        scope: [...scope],
        status: 'open',
        ownerWorkerId: null,
        proposalId: null,
        resultFindingId: null,
        blockReason: null,
        cancellationReason: null,
        createdAt: now,
        updatedAt: now,
      };
      draft.tasks[task.id] = task;
      appendEvent(draft, taskEventPayload(task, worker.id), now);
      return task;
    });
  }

  /** 任务状态机 mutation；每次成功变更 task.revision 与 run.revision 各 +1。 */
  async updateTask(sessionId: string, input: UpdateTaskInput, callId: string): Promise<TaskRecord> {
    const identity = this.identity(sessionId);
    const runId = this.resolveWorker(sessionId).run.id;
    const taskId = requireText(input.taskId, 'taskId');
    if (!isNonNegativeInteger(input.expectedRevision)) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'expectedRevision must be a zero-based integer', {
        details: { field: 'expectedRevision' },
      });
    }
    const expectedRevision = input.expectedRevision;

    return this.mutate(runId, identity, callId, 'updateTask', (draft, now, worker) => {
      const task = draft.tasks[taskId];
      if (task === undefined) {
        throw new SwarmError('SWARM_NOT_FOUND', `task ${taskId} not found`, {
          details: { taskId },
        });
      }
      if (task.revision !== expectedRevision) {
        throw new SwarmError('SWARM_STALE_REVISION', `task ${taskId} revision is ${task.revision}`, {
          details: { taskId, expectedRevision, actualRevision: task.revision },
        });
      }
      if (task.status === 'done' || task.status === 'cancelled') {
        throw new SwarmError('SWARM_INVALID_STATE', `task ${taskId} is ${task.status}`, {
          details: { taskId, status: task.status, action: input.action },
        });
      }

      switch (input.action) {
        case 'claim': {
          if (task.status === 'claimed') {
            throw new SwarmError('SWARM_TASK_ALREADY_CLAIMED', `task ${taskId} is already claimed`, {
              details: { taskId, ownerWorkerId: task.ownerWorkerId },
            });
          }
          if (task.status !== 'open') {
            throw new SwarmError('SWARM_TASK_NOT_CLAIMABLE', `task ${taskId} is ${task.status}`, {
              details: { taskId, status: task.status },
            });
          }
          for (const other of Object.values(draft.tasks)) {
            if (other.ownerWorkerId === worker.id && (other.status === 'claimed' || other.status === 'proposed')) {
              throw new SwarmError('SWARM_WORKER_BUSY', `worker ${worker.id} already owns task ${other.id}`, {
                details: { workerId: worker.id, taskId: other.id },
              });
            }
          }
          task.status = 'claimed';
          task.ownerWorkerId = worker.id;
          worker.currentTaskId = task.id;
          break;
        }
        case 'release': {
          this.assertOwnedClaimed(task, worker.id, 'release');
          task.status = 'open';
          task.ownerWorkerId = null;
          this.clearCurrentTask(worker, task.id);
          break;
        }
        case 'block': {
          this.assertOwnedClaimed(task, worker.id, 'block');
          task.blockReason = requireReason(input.reason, 'block');
          task.status = 'blocked';
          task.ownerWorkerId = null;
          this.clearCurrentTask(worker, task.id);
          break;
        }
        case 'unblock': {
          if (task.status !== 'blocked') {
            throw new SwarmError('SWARM_TASK_NOT_CLAIMABLE', `task ${taskId} is ${task.status}, not blocked`, {
              details: { taskId, status: task.status },
            });
          }
          requireReason(input.reason, 'unblock');
          task.status = 'open';
          task.blockReason = null;
          task.ownerWorkerId = null;
          break;
        }
        case 'cancel': {
          const isOwner = task.ownerWorkerId === worker.id && task.status === 'claimed';
          const isCreator = task.createdByWorkerId === worker.id && (task.status === 'open' || task.status === 'blocked');
          if (!isOwner && !isCreator) {
            throw new SwarmError('SWARM_FORBIDDEN', `worker ${worker.id} may not cancel task ${taskId}`, {
              details: { taskId, workerId: worker.id, status: task.status },
            });
          }
          task.cancellationReason = requireReason(input.reason, 'cancel');
          task.status = 'cancelled';
          task.ownerWorkerId = null;
          this.clearCurrentTask(worker, task.id);
          break;
        }
        case 'research_complete': {
          if (task.kind !== 'research') {
            throw new SwarmError('SWARM_INVALID_STATE', `task ${taskId} is not a research task`, {
              details: { taskId, kind: task.kind },
            });
          }
          this.assertOwnedClaimed(task, worker.id, 'research_complete');
          const findingId = requireText(input.findingId, 'findingId');
          const finding = draft.findings[findingId];
          if (finding === undefined) {
            throw new SwarmError('SWARM_NOT_FOUND', `finding ${findingId} not found`, {
              details: { findingId },
            });
          }
          if (finding.evidenceRefs.length === 0) {
            throw new SwarmError('SWARM_INVALID_INPUT', `finding ${findingId} has no evidence`, {
              details: { findingId },
            });
          }
          if (finding.taskId !== null && finding.taskId !== task.id) {
            throw new SwarmError('SWARM_INVALID_INPUT', `finding ${findingId} belongs to another task`, {
              details: { findingId, taskId: finding.taskId },
            });
          }
          task.status = 'done';
          task.resultFindingId = finding.id;
          task.ownerWorkerId = null;
          this.clearCurrentTask(worker, task.id);
          break;
        }
        default: {
          throw new SwarmError('SWARM_INVALID_INPUT', 'unknown task action', {
            details: { action: input.action },
          });
        }
      }

      task.revision += 1;
      task.updatedAt = now;
      appendEvent(draft, taskEventPayload(task, worker.id), now);
      return task;
    });
  }

  /* --------------------------- finding ---------------------------- */

  /** 发布不可变 Finding；seq 取自本条事件。 */
  async publish(sessionId: string, input: PublishInput, callId: string): Promise<FindingRecord> {
    const identity = this.identity(sessionId);
    const runId = this.resolveWorker(sessionId).run.id;
    const kind = input.kind;
    if (kind !== 'observed' && kind !== 'fact' && kind !== 'fail' && kind !== 'patch_summary' && kind !== 'claim') {
      throw new SwarmError('SWARM_INVALID_INPUT', 'unknown finding kind', { details: { kind } });
    }
    const summary = requireText(input.summary, 'summary').trim();
    const summaryLimit = FINDING_SUMMARY_LIMITS[kind];
    if (summary.length > summaryLimit) {
      throw new SwarmError('SWARM_INVALID_INPUT',
        `summary for ${kind} must be at most ${summaryLimit} characters (got ${summary.length}); put supporting detail in details`, {
          details: { field: 'summary', kind, limit: summaryLimit, length: summary.length },
        });
    }
    const details = input.details === undefined ? undefined : requireText(input.details, 'details');
    if (details !== undefined && details.length > FINDING_DETAILS_MAX_CHARS) {
      throw new SwarmError('SWARM_INVALID_INPUT', `details must be at most ${FINDING_DETAILS_MAX_CHARS} characters`, {
        details: { field: 'details', limit: FINDING_DETAILS_MAX_CHARS, length: details.length },
      });
    }
    const scope = (input.scope ?? []).map((entry, index) => requireText(entry, `scope[${index}]`));
    const evidenceRefs = (input.evidenceRefs ?? []).map((entry, index) =>
      requireText(entry, `evidenceRefs[${index}]`),
    );
    const taskId = input.taskId ?? null;
    const supersedesId = input.supersedesId ?? null;
    const blockingRepairTaskId = input.blockingRepairTaskId ?? null;
    if (kind !== 'fail' && blockingRepairTaskId !== null) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'blockingRepairTaskId is only valid for fail findings', {
        details: { kind },
      });
    }

    return this.mutate(runId, identity, callId, 'publish', (draft, now, worker) => {
      if (taskId !== null && draft.tasks[taskId] === undefined) {
        throw new SwarmError('SWARM_NOT_FOUND', `task ${taskId} not found`, { details: { taskId } });
      }
      if (supersedesId !== null && draft.findings[supersedesId] === undefined) {
        throw new SwarmError('SWARM_NOT_FOUND', `finding ${supersedesId} not found`, {
          details: { findingId: supersedesId },
        });
      }
      if (blockingRepairTaskId !== null && draft.tasks[blockingRepairTaskId] === undefined) {
        throw new SwarmError('SWARM_NOT_FOUND', `task ${blockingRepairTaskId} not found`, {
          details: { taskId: blockingRepairTaskId },
        });
      }

      const id = this.makeId();
      const event = appendEvent(
        draft,
        {
          kind: 'finding',
          findingId: id,
          taskId,
          findingKind: kind,
          authorWorkerId: worker.id,
          audience: { kind: 'all' },
        },
        now,
      );
      const finding: FindingRecord = {
        id,
        seq: event.seq,
        authorWorkerId: worker.id,
        taskId,
        kind,
        summary,
        ...(details === undefined ? {} : { details }),
        scope: [...scope],
        evidenceRefs: [...evidenceRefs],
        supersedesId,
        blockingRepairTaskId,
        createdAt: now,
      };
      draft.findings[id] = finding;
      return finding;
    });
  }

  /* --------------------------- message ---------------------------- */

  /** 发送私信；target 可以是 workerId 或 sessionId，禁止发给自己。 */
  async message(sessionId: string, input: MessageInput, callId: string): Promise<MessageRecord> {
    const identity = this.identity(sessionId);
    const runId = this.resolveWorker(sessionId).run.id;
    const target = requireText(input.target, 'target');
    const body = requireText(input.body, 'body');

    return this.mutate(runId, identity, callId, 'message', (draft, now, worker) => {
      const recipient = Object.values(draft.workers).find(
        (candidate) => candidate.id === target || candidate.sessionId === target,
      );
      if (recipient === undefined) {
        throw new SwarmError('SWARM_NOT_FOUND', `message target ${target} not found`, {
          details: { target },
        });
      }
      if (recipient.id === worker.id) {
        throw new SwarmError('SWARM_INVALID_INPUT', 'cannot message yourself', {
          details: { workerId: worker.id },
        });
      }

      const id = this.makeId();
      const event = appendEvent(
        draft,
        {
          kind: 'message',
          messageId: id,
          targetWorkerId: recipient.id,
          authorWorkerId: worker.id,
          audience: { kind: 'workers', workerIds: [worker.id, recipient.id] },
        },
        now,
      );
      const message: MessageRecord = {
        id,
        seq: event.seq,
        authorWorkerId: worker.id,
        targetWorkerId: recipient.id,
        body,
        createdAt: now,
      };
      draft.messages[id] = message;
      return message;
    });
  }

  /**
   * Host-only receipt after the exact model-facing Session content has been flushed.
   * Updates technical display evidence only; never answers a request, confirms an agreement,
   * clears a wait, emits an event, or wakes another worker. Replays and older versions are harmless.
   */
  async recordShown(sessionId: string, receipt: ShownReceipt): Promise<void> {
    const identity = this.identity(sessionId);
    const membership = this.resolveWorker(sessionId);
    if (receipt.runId !== membership.run.id) {
      throw new SwarmError('SWARM_FORBIDDEN', 'Display receipt belongs to another run');
    }
    await this.store.update(receipt.runId, (run) => {
      const draft = structuredClone(run);
      const worker = this.draftWorker(draft, identity);
      let changed = false;
      let shown = shownEventSeq(worker);
      for (const range of receipt.ranges) {
        if (range.through >= draft.nextSeq) throw new SwarmError('SWARM_INVALID_CURSOR', 'Display receipt is beyond the event log');
        // Never bridge an unprovided prefix; cumulative replay can later fill the gap.
        if (range.from <= shown && range.through > shown) { shown = range.through; changed = true; }
      }
      if (shown > (worker.shownSeq ?? 0)) { worker.shownSeq = shown; changed = true; }
      const now = this.now();
      for (const reference of receipt.notifications) {
        const notification = draft.notifications[reference.id];
        if (!notification || notification.workerId !== worker.id) {
          throw new SwarmError('SWARM_FORBIDDEN', 'Display receipt contains another worker notification');
        }
        // A coalesced newer notification has not been shown by this receipt.
        if (notification.seq === reference.seq && notification.acknowledgedAt === null) {
          notification.acknowledgedAt = now;
          changed = true;
        }
      }
      for (const reference of receipt.messages) {
        const message = draft.publicMessages[reference.id];
        if (!message || message.channelId !== reference.channelId || reference.revision > message.revision) {
          throw new SwarmError('SWARM_INVALID_INPUT', 'Display receipt contains an invalid public message version');
        }
        const key = JSON.stringify([worker.id, message.channelId]);
        const read = draft.channelReads[key] ??= { id: key, workerId: worker.id, channelId: message.channelId,
          offeredMessageRevisions: {}, readMessageRevisions: {} };
        if ((read.readMessageRevisions[message.id] ?? 0) < reference.revision) {
          read.offeredMessageRevisions[message.id] = Math.max(read.offeredMessageRevisions[message.id] ?? 0, reference.revision);
          read.readMessageRevisions[message.id] = reference.revision;
          changed = true;
        }
      }
      if (!changed) return run;
      draft.revision++;
      draft.updatedAt = Math.max(draft.updatedAt, now);
      return draft;
    });
  }

  /* ----------------------------- sync ----------------------------- */

  /** 增量同步：确认 ack、清除等待登记、返回可见事件与 run 摘要。 */
  async sync(sessionId: string, input: SyncInput = {}): Promise<SyncResult> {
    const identity = this.identity(sessionId);
    const runId = this.resolveWorker(sessionId).run.id;
    const limit = this.normalizeLimit(input.limit);
    let result: SyncResult | undefined;

    await this.store.update(runId, (run) => {
      const draft = structuredClone(run);
      const worker = this.draftWorker(draft, identity);
      this.assertRunning(draft);

      let start = shownEventSeq(worker);
      if (input.ackSeq !== undefined) {
        if (!isNonNegativeInteger(input.ackSeq)) {
          throw new SwarmError('SWARM_INVALID_INPUT', 'ackSeq must be a non-negative integer', {
            details: { field: 'ackSeq' },
          });
        }
        if (input.ackSeq < worker.observedSeq || input.ackSeq > worker.offeredSeq) {
          throw new SwarmError('SWARM_INVALID_INPUT', 'ackSeq outside [observedSeq, offeredSeq]', {
            details: {
              ackSeq: input.ackSeq,
              observedSeq: worker.observedSeq,
              offeredSeq: worker.offeredSeq,
            },
          });
        }
        worker.observedSeq = input.ackSeq;
        start = shownEventSeq(worker);
      }

      worker.waitRegistration = null;

      const page = this.collectEvents(draft, worker.id, start, limit);
      if (page.throughSeq > worker.offeredSeq) {
        worker.offeredSeq = page.throughSeq;
      }
      draft.revision += 1;
      draft.updatedAt = this.now();
      result = this.syncResult(draft, worker, page);
      return draft;
    });

    if (result === undefined) {
      throw new SwarmError('SWARM_INTERNAL', 'sync result was not produced', {
        details: { runId, sessionId },
      });
    }
    return result;
  }

  /* ----------------------------- read ----------------------------- */

  /** 按 id 或文本查询读取本人可见的任务/发现/私信，单页上限 20。 */
  async read(sessionId: string, input: ReadInput = {}): Promise<ReadResult> {
    const { run, worker } = this.resolveWorker(sessionId);
    const limit = this.normalizeReadLimit(input.limit);

    if (input.id !== undefined) {
      const id = requireText(input.id, 'id');
      const item = this.findReadable(run, worker.id, id);
      if (item === null) {
        throw new SwarmError('SWARM_NOT_FOUND', `record ${id} not found or not visible`, {
          details: { id },
        });
      }
      return {
        runId: run.id,
        items: [item],
        total: 1,
        hasMore: false,
        truncated: false,
        cursor: null,
        nextCursor: null,
      };
    }

    const query = input.query === undefined ? null : parseQuery(requireText(input.query, 'query'));
    const all = this.readableItems(run, worker.id, query);
    const offset = this.parseCursor(input.cursor);
    const page = all.slice(offset, offset + limit);
    const hasMore = offset + page.length < all.length;
    return {
      runId: run.id,
      items: page,
      total: all.length,
      hasMore,
      truncated: hasMore,
      cursor: input.cursor ?? null,
      nextCursor: hasMore ? String(offset + page.length) : null,
    };
  }

  /* ----------------------------- wait ----------------------------- */

  /**
   * 登记或立即完成一次等待。
   *
   * busy=true 直接拒绝。省略 afterSeq 时使用 Host 已持久展示位置；
   * 旧显式 afterSeq 仍检查 observedSeq <= afterSeq <= offeredSeq。
   * 若该前缀之后已有匹配事件，立即返回 waiting=false 与可见增量，否则登记等待。
   */
  async wait(
    sessionId: string,
    input: WaitInput,
    callId: string,
    busy = false,
  ): Promise<WaitResult> {
    const identity = this.identity(sessionId);
    void callId;
    const runId = this.resolveWorker(sessionId).run.id;
    if (busy) {
      throw new SwarmError('SWARM_WORKER_BUSY', 'worker already has an outstanding wait', {
        details: { workerId: identity.workerId },
      });
    }
    if (input.afterSeq !== undefined && !isNonNegativeInteger(input.afterSeq)) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'afterSeq must be a non-negative integer', {
        details: { field: 'afterSeq' },
      });
    }
    const taskIds = this.normalizeIds(input.taskIds, 'taskIds');
    const proposalIds = this.normalizeIds(input.proposalIds, 'proposalIds');
    let result: WaitResult | undefined;

    await this.store.update(runId, (run) => {
      const draft = structuredClone(run);
      const worker = this.draftWorker(draft, identity);
      this.assertRunning(draft);
      const afterSeq = input.afterSeq ?? shownEventSeq(worker);
      if (input.afterSeq !== undefined && (afterSeq < worker.observedSeq || afterSeq > worker.offeredSeq)) {
        throw new SwarmError('SWARM_INVALID_INPUT', 'afterSeq outside [observedSeq, offeredSeq]', {
          details: {
            afterSeq,
            observedSeq: worker.observedSeq,
            offeredSeq: worker.offeredSeq,
          },
        });
      }

      const registration: WaitRegistration = {
        afterSeq,
        mode: taskIds.length > 0 || proposalIds.length > 0 ? 'selected' : 'any',
        taskIds: [...taskIds],
        proposalIds: [...proposalIds],
      };
      if (input.afterSeq !== undefined) worker.observedSeq = afterSeq;
      worker.waitRegistration = registration;

      const attention = this.attentionSummary(draft, worker.id);
      const matched = attention.attentionTotal > 0 || draft.events.some(
        (event) => event.seq > afterSeq && matchesWait(draft, worker, event),
      );

      if (!matched) {
        draft.revision += 1;
        draft.updatedAt = this.now();
        result = {
          runId: draft.id,
          waiting: true,
          fromSeq: afterSeq,
          ...attention,
          worker: summarizeWorker(worker),
          events: [],
          observedSeq: worker.observedSeq,
          offeredSeq: worker.offeredSeq,
          throughSeq: afterSeq,
          hasMore: false,
        };
        return draft;
      }

      worker.waitRegistration = null;
      const page = this.collectEvents(draft, worker.id, afterSeq, this.eventPageSize);
      if (page.throughSeq > worker.offeredSeq) {
        worker.offeredSeq = page.throughSeq;
      }
      draft.revision += 1;
      draft.updatedAt = this.now();
      result = {
        runId: draft.id,
        waiting: false,
        fromSeq: afterSeq,
        ...attention,
        worker: summarizeWorker(worker),
        events: page.events,
        observedSeq: worker.observedSeq,
        offeredSeq: worker.offeredSeq,
        throughSeq: page.throughSeq,
        hasMore: page.hasMore,
      };
      return draft;
    });

    if (result === undefined) {
      throw new SwarmError('SWARM_INTERNAL', 'wait result was not produced', {
        details: { runId, sessionId },
      });
    }
    return result;
  }

  /* -------------------------- controlTask ------------------------- */

  /** owner 对暂停 run 中任务的 release/cancel；ownerSessionId 必须匹配 run.ownerSessionId。 */
  async controlTask(
    runId: string,
    ownerSessionId: string,
    input: ControlTaskInput,
  ): Promise<TaskRecord> {
    const taskId = requireText(input.taskId, 'taskId');
    if (!isNonNegativeInteger(input.expectedRevision)) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'expectedRevision must be a zero-based integer', {
        details: { field: 'expectedRevision' },
      });
    }
    if (input.action !== 'release' && input.action !== 'cancel') {
      throw new SwarmError('SWARM_INVALID_INPUT', 'controlTask action must be release or cancel', {
        details: { action: input.action },
      });
    }
    const reason = requireReason(input.reason, input.action);
    const expectedRevision = input.expectedRevision;
    let result: TaskRecord | undefined;

    await this.store.update(runId, (run) => {
      const draft = structuredClone(run);
      if (draft.ownerSessionId !== ownerSessionId) {
        throw new SwarmError('SWARM_FORBIDDEN', `session ${ownerSessionId} does not own run ${runId}`, {
          details: { runId, ownerSessionId },
        });
      }
      if (draft.phase !== 'paused') {
        throw new SwarmError('SWARM_NOT_RUNNING', `run ${runId} is ${draft.phase}, not paused`, {
          details: { runId, phase: draft.phase },
        });
      }
      const task = draft.tasks[taskId];
      if (task === undefined) {
        throw new SwarmError('SWARM_NOT_FOUND', `task ${taskId} not found`, { details: { taskId } });
      }
      if (task.revision !== expectedRevision) {
        throw new SwarmError('SWARM_STALE_REVISION', `task ${taskId} revision is ${task.revision}`, {
          details: { taskId, expectedRevision, actualRevision: task.revision },
        });
      }

      if (input.action === 'release') {
        if (task.status !== 'claimed') {
          throw new SwarmError('SWARM_TASK_NOT_CLAIMABLE', `task ${taskId} is ${task.status}, not claimed`, {
            details: { taskId, status: task.status },
          });
        }
        task.status = 'open';
        task.ownerWorkerId = null;
      } else {
        if (task.status !== 'open' && task.status !== 'claimed' && task.status !== 'blocked') {
          throw new SwarmError('SWARM_INVALID_STATE', `task ${taskId} is ${task.status}`, {
            details: { taskId, status: task.status },
          });
        }
        task.status = 'cancelled';
        task.cancellationReason = reason;
        task.ownerWorkerId = null;
      }

      task.revision += 1;
      task.updatedAt = this.now();
      for (const worker of Object.values(draft.workers)) {
        if (worker.currentTaskId === task.id && task.ownerWorkerId !== worker.id) {
          worker.currentTaskId = null;
        }
      }
      appendEvent(draft, taskEventPayload(task, null), this.now());
      draft.revision += 1;
      draft.updatedAt = this.now();
      result = task;
      return draft;
    });

    if (result === undefined) {
      throw new SwarmError('SWARM_INTERNAL', 'controlTask result was not produced', {
        details: { runId, taskId },
      });
    }
    return result;
  }

  /* --------------------------- internals -------------------------- */

  private identity(sessionId: string): MutationIdentity {
    const { worker } = this.resolveWorker(sessionId);
    return { sessionId, workerId: worker.id };
  }

  private draftWorker(draft: Run, identity: MutationIdentity): WorkerRecord {
    const worker = draft.workers[identity.workerId];
    if (worker === undefined || worker.sessionId !== identity.sessionId) {
      throw new SwarmError('SWARM_FORBIDDEN', `session ${identity.sessionId} is not a swarm worker`, {
        details: { sessionId: identity.sessionId },
      });
    }
    return worker;
  }

  private assertRunning(draft: Run): void {
    if (draft.phase !== 'running') {
      throw new SwarmError('SWARM_NOT_RUNNING', `run ${draft.id} is ${draft.phase}`, {
        details: { runId: draft.id, phase: draft.phase },
      });
    }
  }

  private assertOwnedClaimed(task: TaskRecord, workerId: WorkerId, action: string): void {
    if (task.status !== 'claimed' || task.ownerWorkerId !== workerId) {
      throw new SwarmError('SWARM_FORBIDDEN', `worker ${workerId} may not ${action} task ${task.id}`, {
        details: {
          taskId: task.id,
          workerId,
          status: task.status,
          ownerWorkerId: task.ownerWorkerId,
        },
      });
    }
  }

  private clearCurrentTask(worker: WorkerRecord, taskId: string): void {
    if (worker.currentTaskId === taskId) {
      worker.currentTaskId = null;
    }
  }

  private normalizeLimit(limit: number | undefined): number {
    if (limit === undefined) {
      return this.eventPageSize;
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'limit must be a positive integer', {
        details: { limit },
      });
    }
    return Math.min(limit, this.eventPageSize);
  }

  private normalizeReadLimit(limit: number | undefined): number {
    if (limit === undefined) {
      return MAX_READ_LIMIT;
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'limit must be a positive integer', {
        details: { limit },
      });
    }
    return Math.min(limit, MAX_READ_LIMIT);
  }

  private normalizeIds(ids: string[] | undefined, field: string): string[] {
    if (ids === undefined) return [];
    if (!Array.isArray(ids)) {
      throw new SwarmError('SWARM_INVALID_INPUT', `${field} must be an array of ids`, {
        details: { field },
      });
    }
    return ids.map((id, index) => requireText(id, `${field}[${index}]`));
  }

  private parseCursor(cursor: string | undefined): number {
    if (cursor === undefined) return 0;
    if (!/^\d+$/.test(cursor)) {
      throw new SwarmError('SWARM_INVALID_CURSOR', `invalid read cursor ${cursor}`, {
        details: { cursor },
      });
    }
    return Number.parseInt(cursor, 10);
  }

  private buildSyncEvent(run: Run, event: SwarmEvent): SyncEventItem {
    const item: SyncEventItem = {
      event,
      task: null,
      finding: null,
      message: null,
      proposal: null,
      goal: null,
    };
    switch (event.kind) {
      case 'goal':
        item.goal = run.goals[event.goalId] ?? null;
        break;
      case 'task':
        item.task = run.tasks[event.taskId] ?? null;
        break;
      case 'finding': {
        const finding = run.findings[event.findingId];
        item.finding = finding === undefined ? null : withoutDetails(finding);
        break;
      }
      case 'message':
        item.message = run.messages[event.messageId] ?? null;
        break;
      case 'proposal':
        item.proposal = run.proposals[event.proposalId] ?? null;
        break;
      case 'head':
      case 'run':
        break;
      default:
        break;
    }
    return item;
  }

  private collectEvents(
    run: Run,
    workerId: WorkerId,
    afterSeq: EventSeq,
    limit: number,
  ): { events: SyncEventItem[]; throughSeq: EventSeq; hasMore: boolean } {
    const events: SyncEventItem[] = [];
    let throughSeq = afterSeq;
    let hasMore = false;
    const now = this.now();
    for (const event of run.events) {
      if (event.seq <= afterSeq) continue;
      if (!isEventVisible(event, workerId) || this.isStaleClaimEvent(run, event, now)) {
        throughSeq = event.seq;
        continue;
      }
      if (events.length >= limit) {
        hasMore = true;
        break;
      }
      events.push(this.buildSyncEvent(run, event));
      throughSeq = event.seq;
    }
    return { events, throughSeq, hasMore };
  }

  /** Expired or replaced claims stay in history/search but leave live sync/wait pages. */
  private isStaleClaimEvent(run: Run, event: SwarmEvent, now: number): boolean {
    if (event.kind !== 'finding' || event.findingKind !== 'claim') return false;
    const finding = run.findings[event.findingId];
    return finding !== undefined && !isLiveFinding(run, finding, now, this.claimTtlMs);
  }

  private liveClaimSummaries(run: Run): { claims: LiveClaimSummary[]; claimsTotal: number } {
    const claims = liveClaims(run, this.now(), this.claimTtlMs);
    return {
      claims: claims.slice(-this.eventPageSize).map((finding) => ({
        id: finding.id,
        authorWorkerId: finding.authorWorkerId,
        taskId: finding.taskId,
        summary: finding.summary,
        scope: [...finding.scope],
        createdAt: finding.createdAt,
        expiresAt: finding.createdAt + this.claimTtlMs,
      })),
      claimsTotal: claims.length,
    };
  }

  private syncResult(
    run: Run,
    worker: WorkerRecord,
    page: { events: SyncEventItem[]; throughSeq: EventSeq; hasMore: boolean },
  ): SyncResult {
    return {
      runId: run.id,
      fromSeq: shownEventSeq(worker),
      goal: run.goal,
      acceptanceCriteria: activeAcceptanceCriteria(run),
      originalAcceptanceCriteria: [...run.acceptanceCriteria],
      goalRevision: run.goalRevision,
      goals: Object.values(run.goals).slice(-this.eventPageSize),
      goalsTotal: Object.keys(run.goals).length,
      ...this.attentionSummary(run, worker.id),
      acceptedHead: run.acceptedHead,
      worker: summarizeWorker(worker),
      tasks: Object.values(run.tasks)
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
        .map(summarizeTask),
      ...this.liveClaimSummaries(run),
      events: page.events,
      observedSeq: worker.observedSeq,
      offeredSeq: worker.offeredSeq,
      throughSeq: page.throughSeq,
      hasMore: page.hasMore,
    };
  }

  private attentionSummary(run: Run, workerId: WorkerId): AttentionSummary {
    const pending = pendingNotifications(run, workerId);
    return { attention: pending.slice(0, this.eventPageSize), attentionTotal: pending.length,
      attentionHasMore: pending.length > this.eventPageSize };
  }

  private findReadable(run: Run, workerId: WorkerId, id: string): ReadItem | null {
    const goal = run.goals[id];
    if (goal) return { kind: 'goal', goal, task: null, finding: null, message: null };
    const task = run.tasks[id];
    if (task !== undefined) {
      return { kind: 'task', task, finding: null, message: null };
    }
    const finding = run.findings[id];
    if (finding !== undefined) {
      return { kind: 'finding', task: null, finding, message: null };
    }
    const message = run.messages[id];
    if (message !== undefined) {
      if (message.authorWorkerId !== workerId && message.targetWorkerId !== workerId) {
        return null;
      }
      return { kind: 'message', task: null, finding: null, message };
    }
    return null;
  }

  private readableItems(run: Run, workerId: WorkerId, query: QueryNode | null): ReadItem[] {
    const items: ReadItem[] = [];
    // author: 同时匹配 worker id 与显示名；搜索覆盖完整历史（含已过期 claim 与 details）。
    const authors = (...ids: (WorkerId | null | undefined)[]): string[] =>
      ids.flatMap((id) => {
        if (!id) return [];
        const worker = run.workers[id];
        return worker ? [id, workerDisplayName(worker)] : [id];
      });
    const hit = (subject: QuerySubject): boolean => matchQuery(query, subject);
    for (const goal of Object.values(run.goals)) {
      if (!hit({ text: [goal.id, goal.text, ...goal.acceptanceCriteria].join('\n'), fields: { kind: ['goal'], author: ['owner'] } })) continue;
      items.push({ kind: 'goal', goal, task: null, finding: null, message: null });
    }
    for (const task of Object.values(run.tasks)) {
      const subject: QuerySubject = {
        text: [task.id, task.subject, task.acceptance, ...task.scope, task.blockReason ?? '', task.cancellationReason ?? ''].join('\n'),
        fields: { kind: ['task', task.kind], author: authors(task.createdByWorkerId, task.ownerWorkerId), task: [task.id] },
      };
      if (!hit(subject)) continue;
      items.push({ kind: 'task', task, finding: null, message: null });
    }
    items.sort((left, right) => {
      const a = left.task;
      const b = right.task;
      if (a === null || b === null) return 0;
      return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    });

    const findings: FindingRecord[] = [];
    for (const finding of Object.values(run.findings)) {
      const details = (finding as { details?: unknown }).details;
      const subject: QuerySubject = {
        text: [finding.id, finding.summary, typeof details === 'string' ? details : '', ...finding.scope, ...finding.evidenceRefs].join('\n'),
        fields: { kind: ['finding', finding.kind], author: authors(finding.authorWorkerId), task: [finding.taskId] },
      };
      if (!hit(subject)) continue;
      findings.push(finding);
    }
    findings.sort((left, right) => left.seq - right.seq);
    for (const finding of findings) {
      items.push({ kind: 'finding', task: null, finding, message: null });
    }

    const messages: MessageRecord[] = [];
    for (const message of Object.values(run.messages)) {
      if (message.authorWorkerId !== workerId && message.targetWorkerId !== workerId) continue;
      if (!hit({ text: message.body, fields: { kind: ['message'], author: authors(message.authorWorkerId) } })) continue;
      messages.push(message);
    }
    messages.sort((left, right) => left.seq - right.seq);
    for (const message of messages) {
      items.push({ kind: 'message', task: null, finding: null, message });
    }

    return items;
  }

  /**
   * 执行一次幂等 mutation。
   *
   * reducer 内先查 receipt：命中直接返回 clone（不增 revision、不追加事件）；
   * 否则校验身份与 phase、调用 `apply`、写 receipt 并递增 run.revision。
   */
  private async mutate<T>(
    runId: RunId,
    identity: MutationIdentity,
    callId: string,
    method: string,
    apply: (draft: Run, now: number, worker: WorkerRecord) => T,
  ): Promise<T> {
    const toolCallId = requireText(callId, 'callId');
    const key = `${identity.sessionId}:${toolCallId}`;

    await this.store.update(runId, (run) => {
      const draft = structuredClone(run);
      if (draft.mutationReceipts[key] !== undefined) {
        return draft;
      }
      this.assertRunning(draft);
      const worker = this.draftWorker(draft, identity);
      const now = this.now();
      const result = apply(draft, now, worker);
      draft.mutationReceipts[key] = {
        key,
        workerSessionId: identity.sessionId,
        toolCallId,
        method,
        result: encodeReceiptResult(result),
        createdAt: now,
      };
      draft.revision += 1;
      draft.updatedAt = now;
      return draft;
    });

    const persisted = this.store.get(runId);
    const receipt = persisted.mutationReceipts[key];
    if (receipt === undefined) {
      throw new SwarmError('SWARM_INTERNAL', `mutation receipt ${key} missing after update`, {
        details: { key },
      });
    }
    return decodeReceipt<T>(receipt);
  }
}