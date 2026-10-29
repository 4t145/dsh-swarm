/**
 * 持久记录的 Zod 4 结构校验。
 *
 * 只在边界使用：`store.create` 的入参与后端读出的每条记录都必须通过 `parseRun`。
 * 同进程内已校验的 `Run` 不再重复解析。
 */

import { z } from 'zod';
import { publicEventSchema, publicStateShape, publicReferenceIssues } from './public-schema.ts';
import { defaultPublicState } from './public-types.ts';
import { SwarmError, type SwarmErrorCode } from './errors.ts';
import type { CommandSpec, Run, SwarmRuntimeConfig, VerificationConfig } from './types.ts';

/* --------------------------- 基础标量 --------------------------- */

const idSchema = z.string().min(1);
const millisSchema = z.number().int().min(0);
const seqSchema = z.number().int().min(0);
const countSchema = z.number().int().min(0);
const commitSchema = z.string().min(1);

/** 任意 JSON 值：持久记录里的自由字段（如幂等 receipt 结果）只允许这种形状。 */
export const jsonValueSchema = z.json();

/* --------------------------- 执行配置 --------------------------- */

export const commandSpecSchema = z.strictObject({
  argv: z.array(z.string().min(1)).min(1),
  timeoutMs: z.number().int().positive(),
});

/** setup 可为空；test 必须至少一条，否则 run 无法判定候选能否发布。 */
export const verificationConfigSchema = z.strictObject({
  setup: z.array(commandSpecSchema),
  test: z.array(commandSpecSchema).min(1),
});

export const DEFAULT_RUNTIME_CONFIG: SwarmRuntimeConfig = {
  workerCountMin: 2,
  workerCountMax: 4,
  defaultWorkerCount: 2,
  eventPageSize: 20,
};

export const runtimeConfigSchema = z.strictObject({
  workerCountMin: z.number().int().min(1),
  workerCountMax: z.number().int().min(1),
  defaultWorkerCount: z.number().int().min(1),
  eventPageSize: z.number().int().min(1).max(200),
});

/* --------------------------- 判别字段 --------------------------- */

const runPhaseSchema = z.enum([
  'preparing',
  'running',
  'draining',
  'quiescing',
  'paused',
  'completed',
  'stopped',
  'failed',
]);

const quiesceTargetSchema = z.enum(['completed', 'paused', 'stopped', 'failed']);
const taskKindSchema = z.enum(['code', 'research']);
const taskStatusSchema = z.enum(['open', 'claimed', 'proposed', 'done', 'blocked', 'cancelled']);
const findingKindSchema = z.enum(['observed', 'fact', 'fail', 'patch_summary']);
const proposalStatusSchema = z.enum(['queued', 'integrating', 'accepted', 'rejected']);
const attemptStatusSchema = z.enum([
  'merging',
  'merge_conflict',
  'verifying',
  'verified',
  'published',
  'rejected',
  'interrupted',
]);
const verificationPurposeSchema = z.enum(['proposal', 'finish']);
const verificationStatusSchema = z.enum(['queued', 'running', 'passed', 'failed', 'interrupted']);
const proposalRejectionReasonSchema = z.enum([
  'merge_conflict',
  'verification_failed',
  'interrupted_by_pause',
  'interrupted_by_stop',
  'interrupted_by_budget',
  'interrupted_before_publish',
]);

const audienceAllSchema = z.strictObject({ kind: z.literal('all') });
const audienceWorkersSchema = z.strictObject({
  kind: z.literal('workers'),
  workerIds: z.array(idSchema).min(1),
});

export const eventAudienceSchema = z.union([audienceAllSchema, audienceWorkersSchema]);

/* --------------------------- worker --------------------------- */

export const waitRegistrationSchema = z.strictObject({
  afterSeq: seqSchema,
  mode: z.enum(['any', 'selected']),
  taskIds: z.array(idSchema),
  proposalIds: z.array(idSchema),
});

export const workerRecordSchema = z.strictObject({
  id: idSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
  sessionId: z.string().min(1),
  branch: z.string().min(1),
  worktreePath: z.string().min(1).nullable(),
  initializationState: z.enum(['pending', 'initializing', 'ready', 'failed']),
  initializationError: z.string().nullable(),
  unavailableReason: z.string().nullable(),
  offeredSeq: seqSchema,
  observedSeq: seqSchema,
  shownSeq: seqSchema.optional(),
  notifiedSeq: seqSchema,
  wakeTargetSeq: seqSchema,
  waitRegistration: waitRegistrationSchema.nullable(),
  currentTaskId: idSchema.nullable(),
  createdAt: millisSchema,
});

/* --------------------------- 协作实体 --------------------------- */

export const goalRecordSchema = z.strictObject({
  id: idSchema,
  seq: seqSchema,
  text: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  status: z.enum(['active', 'deferred', 'completed']),
  createdAt: millisSchema,
  completedAt: millisSchema.nullable(),
  completedCommit: commitSchema.nullable(),
  continuedInRunId: idSchema.nullable(),
});

export const taskRecordSchema = z.strictObject({
  id: idSchema,
  revision: countSchema,
  createdByWorkerId: idSchema.nullable(),
  kind: taskKindSchema,
  subject: z.string().min(1),
  acceptance: z.string().min(1),
  scope: z.array(z.string()),
  status: taskStatusSchema,
  ownerWorkerId: idSchema.nullable(),
  proposalId: idSchema.nullable(),
  resultFindingId: idSchema.nullable(),
  blockReason: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  createdAt: millisSchema,
  updatedAt: millisSchema,
});

export const findingRecordSchema = z.strictObject({
  id: idSchema,
  seq: seqSchema,
  authorWorkerId: idSchema,
  taskId: idSchema.nullable(),
  kind: findingKindSchema,
  summary: z.string().min(1),
  scope: z.array(z.string()),
  evidenceRefs: z.array(z.string()),
  supersedesId: idSchema.nullable(),
  blockingRepairTaskId: idSchema.nullable(),
  createdAt: millisSchema,
});

export const messageRecordSchema = z.strictObject({
  id: idSchema,
  seq: seqSchema,
  authorWorkerId: idSchema,
  targetWorkerId: idSchema,
  body: z.string().min(1),
  createdAt: millisSchema,
});

/* --------------------------- 集成与验证 --------------------------- */

export const proposalRecordSchema = z.strictObject({
  id: idSchema,
  taskId: idSchema,
  authorWorkerId: idSchema,
  sourceCommit: commitSchema,
  resultRefAtSubmission: commitSchema,
  proposalRef: z.string().min(1),
  status: proposalStatusSchema,
  acceptedCommit: commitSchema.nullable(),
  diagnosticsRef: z.string().nullable(),
  rejectionReason: proposalRejectionReasonSchema.nullable(),
  attemptIds: z.array(idSchema),
  createdAt: millisSchema,
  updatedAt: millisSchema,
});

export const integrationAttemptSchema = z.strictObject({
  id: idSchema,
  proposalId: idSchema,
  expectedHead: commitSchema,
  sourceCommit: commitSchema,
  candidateCommit: commitSchema.nullable(),
  status: attemptStatusSchema,
  diagnosticsRef: z.string().nullable(),
  createdAt: millisSchema,
  updatedAt: millisSchema,
});

export const verificationRecordSchema = z.strictObject({
  id: idSchema,
  purpose: verificationPurposeSchema,
  commit: commitSchema,
  expectedHead: commitSchema,
  sourceCommit: commitSchema.nullable(),
  proposalId: idSchema.nullable(),
  attemptId: idSchema.nullable(),
  configFingerprint: z.string().min(1),
  goalRevision: countSchema.default(0),
  status: verificationStatusSchema,
  receiptRef: z.string().nullable(),
  diagnosticsRef: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  createdAt: millisSchema,
  startedAt: millisSchema.nullable(),
  finishedAt: millisSchema.nullable(),
});

/* --------------------------- finish --------------------------- */

export const acceptanceNoteSchema = z.strictObject({
  criterion: z.string().min(1),
  evidence: z.array(z.string().min(1)),
});

export const finishRequestSchema = z.strictObject({
  id: idSchema,
  requestedByWorkerId: idSchema,
  acceptedHead: commitSchema,
  notes: z.array(acceptanceNoteSchema).min(1),
  goalRevision: countSchema.default(0),
  verificationId: idSchema.nullable(),
  createdAt: millisSchema,
});

/* --------------------------- 事件 --------------------------- */

const taskEventSchema = z.strictObject({
  kind: z.literal('task'),
  seq: seqSchema,
  createdAt: millisSchema,
  authorWorkerId: idSchema.nullable(),
  taskId: idSchema,
  status: taskStatusSchema,
  ownerWorkerId: idSchema.nullable(),
  audience: audienceAllSchema,
});

const findingEventSchema = z.strictObject({
  kind: z.literal('finding'),
  seq: seqSchema,
  createdAt: millisSchema,
  authorWorkerId: idSchema.nullable(),
  findingId: idSchema,
  taskId: idSchema.nullable(),
  findingKind: findingKindSchema,
  audience: audienceAllSchema,
});

const messageEventSchema = z.strictObject({
  kind: z.literal('message'),
  seq: seqSchema,
  createdAt: millisSchema,
  authorWorkerId: idSchema.nullable(),
  messageId: idSchema,
  targetWorkerId: idSchema,
  audience: audienceWorkersSchema,
});

const proposalEventSchema = z.strictObject({
  kind: z.literal('proposal'),
  seq: seqSchema,
  createdAt: millisSchema,
  authorWorkerId: idSchema.nullable(),
  proposalId: idSchema,
  taskId: idSchema,
  status: proposalStatusSchema,
  audience: audienceAllSchema,
});

const headEventSchema = z.strictObject({
  kind: z.literal('head'),
  seq: seqSchema,
  createdAt: millisSchema,
  authorWorkerId: idSchema.nullable(),
  acceptedHead: commitSchema,
  proposalId: idSchema.nullable(),
  audience: audienceAllSchema,
});

const runEventSchema = z.strictObject({
  kind: z.literal('run'),
  seq: seqSchema,
  createdAt: millisSchema,
  authorWorkerId: idSchema.nullable(),
  phase: runPhaseSchema,
  target: quiesceTargetSchema.nullable(),
  reason: z.string().nullable(),
  audience: audienceAllSchema,
});

const goalEventSchema = z.strictObject({
  kind: z.literal('goal'),
  seq: seqSchema,
  createdAt: millisSchema,
  authorWorkerId: idSchema.nullable(),
  goalId: idSchema,
  status: z.enum(['active', 'deferred', 'completed']),
  audience: audienceAllSchema,
});

export const swarmEventSchema = z.discriminatedUnion('kind', [
  publicEventSchema,
  goalEventSchema,
  taskEventSchema,
  findingEventSchema,
  messageEventSchema,
  proposalEventSchema,
  headEventSchema,
  runEventSchema,
]);

export const mutationReceiptSchema = z.strictObject({
  key: z.string().min(1),
  workerSessionId: z.string().min(1),
  toolCallId: z.string().min(1),
  method: z.string().min(1),
  result: jsonValueSchema,
  createdAt: millisSchema,
});

/* --------------------------- run 聚合 --------------------------- */

const runShape = z.strictObject({
  ...publicStateShape,
  id: idSchema,
  ownerSessionId: z.string().min(1),
  repositoryRoot: z.string().min(1),
  gitCommonDir: z.string().min(1),
  specPath: z.string().min(1).nullable(),
  goal: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  goals: z.record(z.string(), goalRecordSchema).default({}),
  goalRevision: countSchema.default(0),
  continuedFromRunId: idSchema.nullable().default(null),
  verification: verificationConfigSchema,
  budgetMinutes: z.number().int().min(0),
  deadline: millisSchema.nullable(),
  budgetExpiredAt: millisSchema.nullable(),
  allowDirtyBaseline: z.boolean(),

  phase: runPhaseSchema,
  reason: z.string().nullable(),
  quiesceTarget: quiesceTargetSchema.nullable(),

  revision: countSchema,
  nextSeq: z.number().int().min(1),

  baseCommit: commitSchema,
  acceptedHead: commitSchema,
  resultRef: z.string().min(1),
  integrationWorktree: z.string().min(1).nullable(),

  workers: z.record(z.string(), workerRecordSchema),
  tasks: z.record(z.string(), taskRecordSchema),
  findings: z.record(z.string(), findingRecordSchema),
  messages: z.record(z.string(), messageRecordSchema),
  proposals: z.record(z.string(), proposalRecordSchema),
  integrationAttempts: z.record(z.string(), integrationAttemptSchema),
  activeAttemptId: idSchema.nullable(),
  verifications: z.record(z.string(), verificationRecordSchema),
  finishRequest: finishRequestSchema.nullable(),
  finishHistory: z.array(finishRequestSchema).default([]),

  events: z.array(swarmEventSchema),
  mutationReceipts: z.record(z.string(), mutationReceiptSchema),

  createdAt: millisSchema,
  updatedAt: millisSchema,
});

/**
 * run 聚合 schema。除结构校验外还检查两个跨字段不变量：
 * 每个 map 的键等于实体自身 id；事件 seq 严格递增且 nextSeq 大于最大 seq。
 */
export const runSchema: z.ZodType<Run> = runShape.superRefine((run, ctx) => {
  for (const issue of publicReferenceIssues(run)) ctx.addIssue({ code: 'custom', ...issue });
  const checkKeys = (field: string, entries: [string, { id: string }][]): void => {
    for (const [key, value] of entries) {
      if (key !== value.id) {
        ctx.addIssue({
          code: 'custom',
          message: `map key "${key}" does not match ${field}[].id "${value.id}"`,
          path: [field, key],
        });
      }
    }
  };

  for (const field of ['channels', 'threads', 'publicMessages', 'notifications', 'subscriptions',
    'channelReads', 'responseRequests', 'agreements'] as const) checkKeys(field, Object.entries(run[field]));
  checkKeys('goals', Object.entries(run.goals));
  checkKeys('workers', Object.entries(run.workers));
  for (const [id, worker] of Object.entries(run.workers)) {
    if (worker.shownSeq !== undefined && worker.shownSeq >= run.nextSeq) {
      ctx.addIssue({ code: 'custom', path: ['workers', id, 'shownSeq'], message: 'shownSeq must be within the run event log' });
    }
  }
  checkKeys('tasks', Object.entries(run.tasks));
  checkKeys('findings', Object.entries(run.findings));
  checkKeys('messages', Object.entries(run.messages));
  checkKeys('proposals', Object.entries(run.proposals));
  checkKeys('integrationAttempts', Object.entries(run.integrationAttempts));
  checkKeys('verifications', Object.entries(run.verifications));

  for (const [key, receipt] of Object.entries(run.mutationReceipts)) {
    if (key !== receipt.key) {
      ctx.addIssue({
        code: 'custom',
        message: `map key "${key}" does not match mutationReceipts[].key "${receipt.key}"`,
        path: ['mutationReceipts', key],
      });
    }
  }

  let previousSeq = 0;
  for (const [index, event] of run.events.entries()) {
    if (event.seq <= previousSeq) {
      ctx.addIssue({
        code: 'custom',
        message: `event seq must strictly increase (${event.seq} after ${previousSeq})`,
        path: ['events', index, 'seq'],
      });
    }
    previousSeq = Math.max(previousSeq, event.seq);
  }

  if (run.nextSeq <= previousSeq) {
    ctx.addIssue({
      code: 'custom',
      message: `nextSeq must be greater than the last event seq (${previousSeq})`,
      path: ['nextSeq'],
    });
  }
}).transform((run) => {
  if (Object.keys(run.channels).length === 0) run.channels = defaultPublicState(run.id, run.createdAt).channels;
  return run;
});

/**
 * 校验并返回 run 记录。
 *
 * @param value 任意来源数据（调用方构造的对象或后端读出的 JSON）。
 * @param code 校验失败时使用的错误码：后端记录用默认值，调用方入参传 `SWARM_INVALID_INPUT`。
 * @throws SwarmError 带 `details.issues = [{ path, message }]`。
 */
export function parseRun(value: unknown, code: SwarmErrorCode = 'SWARM_STORE_CORRUPT'): Run {
  const result = runSchema.safeParse(value);
  if (!result.success) {
    throw new SwarmError(code, 'run record failed validation', {
      details: zodIssuesToDetails(result.error),
    });
  }
  return result.data;
}

/** 把 Zod 错误转成可序列化的 `{ issues: [{ path, message }] }` 诊断。 */
export function zodIssuesToDetails(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): { issues: { path: string; message: string }[] } {
  return {
    issues: error.issues.map((issue) => ({
      path: formatZodPath(issue.path),
      message: issue.message,
    })),
  };
}

/** 把 Zod issue path 渲染成 `a.b[0].c`；根路径为空串。 */
export function formatZodPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      out += out === '' ? String(segment) : `.${String(segment)}`;
    }
  }
  return out;
}

/** 校验运行时配置；失败抛 `SWARM_INVALID_INPUT`。 */
export function parseRuntimeConfig(value: unknown): SwarmRuntimeConfig {
  const result = runtimeConfigSchema.safeParse(value);
  if (!result.success) {
    throw new SwarmError('SWARM_INVALID_INPUT', 'runtime config failed validation', {
      details: zodIssuesToDetails(result.error),
    });
  }
  const config = result.data;
  if (
    config.defaultWorkerCount < config.workerCountMin ||
    config.defaultWorkerCount > config.workerCountMax
  ) {
    throw new SwarmError(
      'SWARM_INVALID_INPUT',
      'defaultWorkerCount must be within [workerCountMin, workerCountMax]',
      {
        details: {
          defaultWorkerCount: config.defaultWorkerCount,
          workerCountMin: config.workerCountMin,
          workerCountMax: config.workerCountMax,
        },
      },
    );
  }
  return config;
}

/** 单条命令的独立校验入口，供 spec 复用。 */
export function parseCommandSpec(value: unknown): CommandSpec {
  const result = commandSpecSchema.safeParse(value);
  if (!result.success) {
    throw new SwarmError('SWARM_INVALID_SPEC', 'command failed validation', {
      details: zodIssuesToDetails(result.error),
    });
  }
  return result.data;
}

/** 验证配置的独立校验入口，供 spec 复用。 */
export function parseVerificationConfig(value: unknown): VerificationConfig {
  const result = verificationConfigSchema.safeParse(value);
  if (!result.success) {
    throw new SwarmError('SWARM_INVALID_SPEC', 'verification config failed validation', {
      details: zodIssuesToDetails(result.error),
    });
  }
  return result.data;
}
