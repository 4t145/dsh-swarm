/**
 * DSH Swarm 领域类型。
 *
 * 约束：
 * - 本文件不导入任何 DSH/Cordis 类型，也不含宿主句柄、Promise 或 Date 对象；
 *   所有记录都必须是 JSON 可序列化的普通数据，可直接作为 storageDomain 记录保存。
 * - 时间一律为毫秒时间戳（number），范围为 `[0, Number.MAX_SAFE_INTEGER]`。
 * - 可空字段用 `null` 表示缺失，不用 `undefined`，以便 JSON 往返稳定。
 * - 有限状态使用带判别字段的 union；未知值必须在入口被拒绝。
 */

export type RunId = string;
export type WorkerId = string;
export type TaskId = string;
export type FindingId = string;
export type MessageId = string;
export type ProposalId = string;
export type AttemptId = string;
export type VerificationId = string;
export type FinishRequestId = string;
/** Git commit SHA（小写十六进制），或解析后的 ref 目标。 */
export type CommitSha = string;
/** run 内业务事件序号，从 1 开始递增；不是 DSH Session seq。 */
export type EventSeq = number;
/** 毫秒时间戳。 */
export type Millis = number;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/* ------------------------------------------------------------------ */
/* 执行配置（启动 spec 与运行时配置）                                     */
/* ------------------------------------------------------------------ */

/**
 * 一条可执行命令。argv 逐项传给执行器，不经 shell 拼接。
 * timeoutMs 为该命令的墙钟上限（正整数毫秒）。
 */
export interface CommandSpec {
  argv: string[];
  timeoutMs: number;
}

/** 验证配置：setup 在独立 checkout 准备环境，test 决定候选能否发布。 */
export interface VerificationConfig {
  setup: CommandSpec[];
  test: CommandSpec[];
}

/**
 * 已解析并校验过的启动 spec。
 *
 * `specPath` 与 `repository` 都是绝对路径；repository 相对 spec 文件所在目录解析。
 * 本类型只是启动输入，不是 run 的持久状态。
 */
export interface RunSpec {
  readonly specPath: string;
  readonly repository: string;
  readonly baseRef: string;
  readonly goal: string;
  readonly acceptanceCriteria: string[];
  readonly workers: number;
  /** 规范化后的显式时限；0（默认）表示不限时。 */
  readonly budgetMinutes: number;
  readonly allowDirtyBaseline: boolean;
  readonly verification: VerificationConfig;
}

/**
 * 运行时配置：不随 run 持久化、由 Host 插件配置项提供的可调值。
 * 协议不变量（如事件不可跳过）不放在这里。
 */
export interface SwarmRuntimeConfig {
  /** 允许的 worker 数量下限，架构固定为 2。 */
  workerCountMin: number;
  /** 允许的 worker 数量上限，架构固定为 4。 */
  workerCountMax: number;
  /** spec 未给出时的默认 worker 数量。 */
  defaultWorkerCount: number;
  /** 单次增量事件/列表返回的条目上限，默认 20。 */
  eventPageSize: number;
}

/* ------------------------------------------------------------------ */
/* run 生命周期                                                         */
/* ------------------------------------------------------------------ */

export type RunPhase =
  | 'preparing'
  | 'running'
  | 'draining'
  | 'quiescing'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'failed';

/** quiescing 期间的目标终态。completed 表示正常交付。 */
export type QuiesceTarget = 'completed' | 'paused' | 'stopped' | 'failed';

export const TERMINAL_RUN_PHASES: readonly RunPhase[] = ['completed', 'stopped', 'failed'];

/** 终态不可 resume；要继续工作只能以 acceptedHead 作为 baseRef 新建 run。 */
export function isTerminalRunPhase(phase: RunPhase): boolean {
  return phase === 'completed' || phase === 'stopped' || phase === 'failed';
}

/* ------------------------------------------------------------------ */
/* worker                                                              */
/* ------------------------------------------------------------------ */

export type WorkerInitializationState = 'pending' | 'initializing' | 'ready' | 'failed';

/**
 * 等待登记。mode=any 时忽略 id 列表；mode=selected 时只对列表内的
 * taskId/proposalId 匹配（直接消息与自己 proposal 的接受/拒绝恒匹配）。
 * scope 不参与投递过滤。
 */
export interface WaitRegistration {
  afterSeq: EventSeq;
  mode: 'any' | 'selected';
  taskIds: TaskId[];
  proposalIds: ProposalId[];
}

export interface WorkerRecord {
  id: WorkerId;
  /** Persisted random readable name; absent only in legacy records. */
  displayName?: string;
  sessionId: string;
  branch: string;
  /** 独立 worktree 绝对路径；初始化完成前为 null。 */
  worktreePath: string | null;
  initializationState: WorkerInitializationState;
  /** 初始化失败诊断，供 status 报告；不表示 DSH 原生 Agent 状态。 */
  initializationError: string | null;
  /** 插件诊断标签（provider 缺失、Session 缺失、最近恢复失败等），不是原生状态。 */
  unavailableReason: string | null;
  /** 已连续扫描到的位置：该前缀内对自己可见的事件都已提供。 */
  offeredSeq: EventSeq;
  /** 明确确认已读到的位置。 */
  observedSeq: EventSeq;
  /** 控制通知已被 inbox 接受的上界。 */
  notifiedSeq: EventSeq;
  /** 需要提醒的事件上界（持久 wakePending）。 */
  wakeTargetSeq: EventSeq;
  waitRegistration: WaitRegistration | null;
  currentTaskId: TaskId | null;
  createdAt: Millis;
}

/* ------------------------------------------------------------------ */
/* Task / Finding / Message                                            */
/* ------------------------------------------------------------------ */

export type GoalStatus = 'active' | 'deferred' | 'completed';

/** Append-only owner requirement; the original goal and its acceptance remain unchanged. */
export interface GoalRecord {
  id: string;
  seq: EventSeq;
  text: string;
  acceptanceCriteria: string[];
  status: GoalStatus;
  createdAt: Millis;
  completedAt: Millis | null;
  completedCommit: CommitSha | null;
  continuedInRunId: RunId | null;
}

export interface AddWorkerReceipt {
  runId: RunId;
  workerId: WorkerId;
  displayName: string;
  phase: RunPhase;
  disposition: 'started' | 'paused';
}

export interface AppendGoalInput {
  text: string;
  acceptanceCriteria?: string[];
}

export interface AppendGoalReceipt {
  runId: RunId;
  goal: GoalRecord;
  disposition: 'executing' | 'paused' | 'deferred';
  phase: RunPhase;
  goalRevision: number;
}

/** Effective criteria for this round, excluding the explicit next-round backlog. */
export function activeAcceptanceCriteria(run: Run): string[] {
  return [...new Set([...run.acceptanceCriteria, ...Object.values(run.goals)
    .filter((goal) => goal.status !== 'deferred').flatMap((goal) => goal.acceptanceCriteria)])];
}

export type TaskKind = 'code' | 'research';

/**
 * 任务状态机：
 * open --claim--> claimed --submit--> proposed --集成通过--> done
 * proposed --集成拒绝--> claimed；claimed --release--> open；
 * claimed --block--> blocked --unblock--> open；
 * open/claimed/blocked --cancel--> cancelled；research --research_complete--> done。
 */
export type TaskStatus = 'open' | 'claimed' | 'proposed' | 'done' | 'blocked' | 'cancelled';

export interface TaskRecord {
  id: TaskId;
  /** CAS 版本，每次业务变更 +1。与 Event.seq、Git SHA 无关。 */
  revision: number;
  createdByWorkerId: WorkerId | null;
  kind: TaskKind;
  subject: string;
  /** 可检查的验收说明，不是聊天内容。 */
  acceptance: string;
  /** 工作范围提示，不是文件锁。 */
  scope: string[];
  status: TaskStatus;
  ownerWorkerId: WorkerId | null;
  proposalId: ProposalId | null;
  resultFindingId: FindingId | null;
  blockReason: string | null;
  cancellationReason: string | null;
  createdAt: Millis;
  updatedAt: Millis;
}

/**
 * 发现类型。`fail` 表示已证伪路径或存在未修复缺陷；
 * 只有后者填写 blockingRepairTaskId。
 */
export type FindingKind = 'observed' | 'fact' | 'fail' | 'patch_summary';

export interface FindingRecord {
  id: FindingId;
  seq: EventSeq;
  authorWorkerId: WorkerId;
  taskId: TaskId | null;
  kind: FindingKind;
  summary: string;
  scope: string[];
  evidenceRefs: string[];
  supersedesId: FindingId | null;
  /** 仅当 fail 描述了尚未修复的具体缺陷时指向修复任务。 */
  blockingRepairTaskId: TaskId | null;
  createdAt: Millis;
}

export interface MessageRecord {
  id: MessageId;
  seq: EventSeq;
  authorWorkerId: WorkerId;
  targetWorkerId: WorkerId;
  body: string;
  createdAt: Millis;
}

/* ------------------------------------------------------------------ */
/* Proposal / 集成 / 验证                                               */
/* ------------------------------------------------------------------ */

export type ProposalStatus = 'queued' | 'integrating' | 'accepted' | 'rejected';

export type ProposalRejectionReason =
  | 'merge_conflict'
  | 'verification_failed'
  | 'interrupted_by_pause'
  | 'interrupted_by_stop'
  | 'interrupted_by_budget'
  | 'interrupted_before_publish';

export interface ProposalRecord {
  id: ProposalId;
  taskId: TaskId;
  authorWorkerId: WorkerId;
  /** 不可变候选 SHA，提交后被固定到 proposalRef。 */
  sourceCommit: CommitSha;
  /** 提交时看到的公共结果 SHA，只作诊断；集成基线是 attempt.expectedHead。 */
  resultRefAtSubmission: CommitSha;
  /** 插件拥有的 ref，锁定候选提交，避免后续分支变动改变这次 Proposal。 */
  proposalRef: string;
  status: ProposalStatus;
  acceptedCommit: CommitSha | null;
  /** 失败日志 artifact 引用。 */
  diagnosticsRef: string | null;
  rejectionReason: ProposalRejectionReason | null;
  attemptIds: AttemptId[];
  createdAt: Millis;
  updatedAt: Millis;
}

export type AttemptStatus =
  | 'merging'
  | 'merge_conflict'
  | 'verifying'
  | 'verified'
  | 'published'
  | 'rejected'
  | 'interrupted';

/** 每次集成尝试独立保存；activeAttemptId 只是指针，不覆盖旧记录。 */
export interface IntegrationAttempt {
  id: AttemptId;
  proposalId: ProposalId;
  /** 本次开始集成时的 acceptedHead，即验证基线 H。 */
  expectedHead: CommitSha;
  sourceCommit: CommitSha;
  /** 由 H 与 sourceCommit 构造出的不可变候选提交 M；冲突时为 null。 */
  candidateCommit: CommitSha | null;
  status: AttemptStatus;
  diagnosticsRef: string | null;
  createdAt: Millis;
  updatedAt: Millis;
}

export type VerificationPurpose = 'proposal' | 'finish';

export type VerificationStatus = 'queued' | 'running' | 'passed' | 'failed' | 'interrupted';

/**
 * 验证记录。purpose=proposal 时 commit=M、expectedHead=H=开始集成时的 acceptedHead、
 * 带 sourceCommit/proposalId/attemptId；purpose=finish 时 commit=expectedHead=H 且无 proposalId。
 * passed 记录是唯一权威凭据，一旦写入不可改写。
 */
export interface VerificationRecord {
  id: VerificationId;
  purpose: VerificationPurpose;
  commit: CommitSha;
  expectedHead: CommitSha;
  sourceCommit: CommitSha | null;
  proposalId: ProposalId | null;
  attemptId: AttemptId | null;
  /** 验证配置指纹；只有指纹匹配的记录才能被复用。 */
  configFingerprint: string;
  /** Missing on legacy records means the original goal set (revision zero). */
  goalRevision?: number;
  status: VerificationStatus;
  /** 通过凭据 / 日志 artifact 引用。 */
  receiptRef: string | null;
  diagnosticsRef: string | null;
  exitCode: number | null;
  timedOut: boolean;
  createdAt: Millis;
  startedAt: Millis | null;
  finishedAt: Millis | null;
}

/* ------------------------------------------------------------------ */
/* finish                                                              */
/* ------------------------------------------------------------------ */

/** 一条原始验收项的证据说明。取消任务不减少需要回答的验收项。 */
export interface AcceptanceNote {
  criterion: string;
  evidence: string[];
}

export interface FinishRequest {
  id: FinishRequestId;
  requestedByWorkerId: WorkerId;
  acceptedHead: CommitSha;
  notes: AcceptanceNote[];
  goalRevision?: number;
  /** 负责本轮最终验证的 Verification；尚未创建时为 null。 */
  verificationId: VerificationId | null;
  createdAt: Millis;
}

/* ------------------------------------------------------------------ */
/* 事件与幂等 receipt                                                   */
/* ------------------------------------------------------------------ */

/** all 表示全员可读；workers 表示只对这些 worker 可见（消息正文）。 */
export type EventAudience = { kind: 'all' } | { kind: 'workers'; workerIds: WorkerId[] };

interface SwarmEventBase {
  seq: EventSeq;
  createdAt: Millis;
  authorWorkerId: WorkerId | null;
}

export interface TaskEvent extends SwarmEventBase {
  kind: 'task';
  taskId: TaskId;
  status: TaskStatus;
  ownerWorkerId: WorkerId | null;
  audience: { kind: 'all' };
}

export interface FindingEvent extends SwarmEventBase {
  kind: 'finding';
  findingId: FindingId;
  taskId: TaskId | null;
  findingKind: FindingKind;
  audience: { kind: 'all' };
}

export interface MessageEvent extends SwarmEventBase {
  kind: 'message';
  messageId: MessageId;
  targetWorkerId: WorkerId;
  /** 作者与目标两人可见。 */
  audience: { kind: 'workers'; workerIds: WorkerId[] };
}

export interface ProposalEvent extends SwarmEventBase {
  kind: 'proposal';
  proposalId: ProposalId;
  taskId: TaskId;
  status: ProposalStatus;
  audience: { kind: 'all' };
}

/** acceptedHead 推进。唤醒匹配看 proposalId 是否在等待列表中。 */
export interface HeadEvent extends SwarmEventBase {
  kind: 'head';
  acceptedHead: CommitSha;
  proposalId: ProposalId | null;
  audience: { kind: 'all' };
}

/** 控制状态变化：只用于审计与状态显示，不用于唤醒模型。 */
export interface RunEvent extends SwarmEventBase {
  kind: 'run';
  phase: RunPhase;
  target: QuiesceTarget | null;
  reason: string | null;
  audience: { kind: 'all' };
}

export interface GoalEvent extends SwarmEventBase {
  kind: 'goal';
  goalId: string;
  status: GoalStatus;
  audience: { kind: 'all' };
}

export type SwarmEvent = TaskEvent | FindingEvent | MessageEvent | ProposalEvent | HeadEvent | RunEvent | GoalEvent;

/**
 * 幂等 mutation 记录，键为 `${workerSessionId}:${toolCallId}`。
 * 命中时只返回已有结果，不产生写入。
 */
export interface MutationReceipt {
  key: string;
  workerSessionId: string;
  toolCallId: string;
  method: string;
  result: JsonValue;
  createdAt: Millis;
}

/* ------------------------------------------------------------------ */
/* run 聚合记录                                                        */
/* ------------------------------------------------------------------ */

/**
 * 一个 run 的全部协作业务数据。一次业务变更必须在一个 update 内完成：
 * 检查条件、改对象、加 revision、追加事件、加 nextSeq。
 */
export interface Run {
  id: RunId;
  ownerSessionId: string;
  /** 用户源仓库绝对路径（不是任何 worktree）。 */
  repositoryRoot: string;
  gitCommonDir: string;
  /** 解析 spec 时使用的绝对路径，供诊断显示。 */
  specPath: string | null;
  goal: string;
  acceptanceCriteria: string[];
  goals: Record<string, GoalRecord>;
  goalRevision: number;
  /** Continuation provenance, not an implicit resurrection of a terminal run. */
  continuedFromRunId: RunId | null;
  verification: VerificationConfig;
  /** 原始显式时限（分钟）；0 表示默认不限时，权威截止是 deadline。 */
  budgetMinutes: number;
  /** null 表示不限时；显式截止时间为毫秒时间戳，暂停期间照常推进。 */
  deadline: Millis | null;
  /** paused 且已过期时写入时间戳；resume 必须明确追加预算。 */
  budgetExpiredAt: Millis | null;
  allowDirtyBaseline: boolean;

  phase: RunPhase;
  /** 进入当前 phase 的原因（budget_exhausted、user_stop、infrastructure 等）。 */
  reason: string | null;
  quiesceTarget: QuiesceTarget | null;

  /** 聚合记录版本，每次 update +1。 */
  revision: number;
  /** 下一个可分配的业务事件 seq；事件 seq 单调递增不重排。 */
  nextSeq: number;

  baseCommit: CommitSha;
  acceptedHead: CommitSha;
  /** 指向 acceptedHead 的结果分支，如 refs/heads/swarm-r1-result。 */
  resultRef: string;
  /** 插件专用集成 worktree 绝对路径；尚未创建时为 null。 */
  integrationWorktree: string | null;

  workers: Record<WorkerId, WorkerRecord>;
  tasks: Record<TaskId, TaskRecord>;
  findings: Record<FindingId, FindingRecord>;
  messages: Record<MessageId, MessageRecord>;
  proposals: Record<ProposalId, ProposalRecord>;
  integrationAttempts: Record<AttemptId, IntegrationAttempt>;
  activeAttemptId: AttemptId | null;
  verifications: Record<VerificationId, VerificationRecord>;
  finishRequest: FinishRequest | null;
  /** Immutable acceptance attempts, including interrupted rounds. */
  finishHistory: FinishRequest[];

  /** 追加式事件索引；v0.1 不剪裁。 */
  events: SwarmEvent[];
  mutationReceipts: Record<string, MutationReceipt>;

  createdAt: Millis;
  updatedAt: Millis;
}

/** 新建 run 所需的最小输入。派生字段由 createRun 统一给出默认值。 */
export interface CreateRunInput {
  id: RunId;
  ownerSessionId: string;
  repositoryRoot: string;
  gitCommonDir: string;
  goal: string;
  acceptanceCriteria: string[];
  verification: VerificationConfig;
  baseCommit: CommitSha;
  resultRef: string;
  deadline: Millis | null;
  specPath?: string | null;
  budgetMinutes?: number;
  allowDirtyBaseline?: boolean;
  createdAt?: Millis;
}

/**
 * 构造一个空 run：phase=preparing、revision=0、nextSeq=1、acceptedHead=baseCommit。
 * 只做数据初始化，不做校验、不访问 Git；调用方负责持久化。
 */
export function createRun(input: CreateRunInput): Run {
  const createdAt = input.createdAt ?? Date.now();
  return {
    id: input.id,
    ownerSessionId: input.ownerSessionId,
    repositoryRoot: input.repositoryRoot,
    gitCommonDir: input.gitCommonDir,
    specPath: input.specPath ?? null,
    goal: input.goal,
    acceptanceCriteria: [...input.acceptanceCriteria],
    goals: {},
    goalRevision: 0,
    continuedFromRunId: null,
    verification: {
      setup: input.verification.setup.map((command) => ({ ...command, argv: [...command.argv] })),
      test: input.verification.test.map((command) => ({ ...command, argv: [...command.argv] })),
    },
    budgetMinutes: input.budgetMinutes ?? 0,
    deadline: input.deadline,
    budgetExpiredAt: null,
    allowDirtyBaseline: input.allowDirtyBaseline ?? false,
    phase: 'preparing',
    reason: null,
    quiesceTarget: null,
    revision: 0,
    nextSeq: 1,
    baseCommit: input.baseCommit,
    acceptedHead: input.baseCommit,
    resultRef: input.resultRef,
    integrationWorktree: null,
    workers: {},
    tasks: {},
    findings: {},
    messages: {},
    proposals: {},
    integrationAttempts: {},
    activeAttemptId: null,
    verifications: {},
    finishRequest: null,
    finishHistory: [],
    events: [],
    mutationReceipts: {},
    createdAt,
    updatedAt: createdAt,
  };
}
