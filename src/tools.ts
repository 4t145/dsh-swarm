/**
 * Worker-facing `swarm_*` tool surface.
 *
 * Only the worker preset entry (`worker.ts`) calls {@link registerWorkerTools};
 * the parent user session never receives these tools. Every call resolves its
 * identity from `exec.agent`, never from model-supplied ids, validates
 * snake_case model arguments with zod, and hands the camelCase kernel types the
 * already-typed values.
 */

import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { JsonSchemaNode, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { StoredArtifacts } from './artifacts.ts';
import { SwarmError } from './errors.ts';
import { toolReceiptMeta } from './notification-receipts.ts';
import { publicCommandSchema, publicQuerySchema } from './public-input.ts';
import type { SwarmRuntime } from './runtime.ts';
import type { JsonValue } from './types.ts';
import { FINDING_DETAILS_MAX_CHARS, FINDING_SUMMARY_LIMITS } from './schema.ts';

/* ------------------------------------------------------------------ */
/* 共享基础设施                                                        */
/* ------------------------------------------------------------------ */

/** `StoredArtifacts.save` 生成的 id 前缀；带该前缀的 id 走诊断文本读取。 */
const ARTIFACT_PREFIX = 'swarm-artifact-';
/** 诊断文本单次默认与最大字符数，与 `readForRun` 的上限一致。 */
const DEFAULT_ARTIFACT_CHARS = 12_000;
const MAX_ARTIFACT_CHARS = 24_000;

/**
 * 通用输出契约：每个工具都返回一个 JSON object，渲染为紧凑 JSON 文本。
 * 字段级的有界性由内核分页与 `limit` 参数保证，不在渲染处裁剪。
 */
const OUTPUT_SCHEMA: JsonSchemaNode = { type: 'object', additionalProperties: true };

/** 调用身份：真实 agent 即 session，不接受模型自报的 worker id。 */
interface CallerIdentity {
  readonly agent: Agent;
  readonly sessionId: string;
}

interface WorkerToolSpec<S extends z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly properties?: Record<string, JsonSchemaNode>;
  /** Generated JSON Schema for structured public protocol discriminated unions. */
  readonly parameters?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly input: S;
  readonly run: (
    input: z.output<S>,
    exec: ToolRunContext,
    caller: CallerIdentity,
  ) => Promise<unknown>;
}

/**
 * 把已经校验过的内核结果转成无损 JSON。
 *
 * @throws SWARM_INTERNAL 结果含 `undefined` 之外的非 JSON 值（函数、Symbol、非有限数）。
 */
function toJsonValue(value: unknown, path = 'result'): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SwarmError('SWARM_INTERNAL', `${path} is not a finite JSON number`, {
        details: { path, value: String(value) },
      });
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    const record: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      // `undefined` 与 JSON.stringify 一致：省略该键，不写入 null。
      if (item === undefined) continue;
      record[key] = toJsonValue(item, `${path}.${key}`);
    }
    return record;
  }
  throw new SwarmError('SWARM_INTERNAL', `${path} is not lossless JSON`, {
    details: { path, type: typeof value },
  });
}

/** 参数根的隐式 object 形状；`ToolSchema.parameters` 需要普通记录。 */
function parameterSchema(
  properties: Record<string, JsonSchemaNode>,
  required: readonly string[] | undefined,
): Record<string, unknown> {
  const node: JsonSchemaNode = {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required === undefined || required.length === 0 ? {} : { required: [...required] }),
  };
  return Object.fromEntries(Object.entries(node));
}

/** Zod attaches non-enumerable ~standard functions; project only JSON schema data for DSH's lossless schema gate. */
function generatedParameters(schema: z.ZodType): Record<string, JsonValue> {
  const value = toJsonValue(z.toJSONSchema(schema, { io: 'input' }));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SwarmError('SWARM_INTERNAL', 'Generated tool parameters must be an object');
  }
  return value;
}

function defineWorkerTool<S extends z.ZodType>(spec: WorkerToolSpec<S>): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters ?? parameterSchema(spec.properties ?? {}, spec.required),
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => toolReceiptMeta(spec.name, value),
    },
    execute: async (args, exec) => {
      const agent = exec.agent;
      if (agent === undefined) {
        throw new SwarmError('SWARM_FORBIDDEN', `${spec.name} requires an owning agent session`);
      }
      const parsed = spec.input.safeParse(args);
      if (!parsed.success) {
        throw new SwarmError('SWARM_INVALID_INPUT', `${spec.name} arguments are invalid`, {
          details: {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.map((segment) => String(segment)).join('.'),
              message: issue.message,
            })),
          },
        });
      }
      const value = await spec.run(parsed.data, exec, { agent, sessionId: agent.id });
      return toJsonValue(value);
    },
  };
}

/* ------------------------------------------------------------------ */
/* 参数 schema（snake_case → camelCase）                               */
/* ------------------------------------------------------------------ */

const syncInput = z.strictObject({
  ack_seq: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).optional(),
});

const readInput = z.strictObject({
  id: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
});

const taskCreateInput = z.strictObject({
  kind: z.enum(['code', 'research']),
  subject: z.string().min(1),
  acceptance: z.string().min(1),
  scope: z.array(z.string().min(1)).optional(),
});

const taskUpdateInput = z.strictObject({
  task_id: z.string().min(1),
  expected_revision: z.number().int().min(0),
  action: z.enum(['claim', 'release', 'block', 'unblock', 'cancel', 'research_complete']),
  reason: z.string().min(1).optional(),
  finding_id: z.string().min(1).optional(),
});

const FINDING_KINDS = ['observed', 'fact', 'fail', 'patch_summary', 'claim'] as const;
const SUMMARY_LIMIT_TEXT = `at most ${FINDING_SUMMARY_LIMITS.observed} characters for observed/fact/fail/claim, `
  + `${FINDING_SUMMARY_LIMITS.patch_summary} for patch_summary`;

const publishInput = z.strictObject({
  kind: z.enum(FINDING_KINDS),
  summary: z.string().min(1),
  details: z.string().min(1).max(FINDING_DETAILS_MAX_CHARS).optional(),
  scope: z.array(z.string().min(1)).optional(),
  evidence_refs: z.array(z.string().min(1)).optional(),
  task_id: z.string().min(1).optional(),
  supersedes_id: z.string().min(1).optional(),
  blocking_repair_task_id: z.string().min(1).optional(),
});

const messageInput = z.strictObject({
  target: z.string().min(1),
  body: z.string().min(1),
});

const submitInput = z.strictObject({
  task_id: z.string().min(1),
  expected_revision: z.number().int().min(0),
  source_commit: z.string().min(1),
});

const waitInput = z.strictObject({
  after_seq: z.number().int().min(0).optional(),
  task_ids: z.array(z.string().min(1)).optional(),
  proposal_ids: z.array(z.string().min(1)).optional(),
});

const finishInput = z.strictObject({
  accepted_commit: z.string().min(1),
  goal_revision: z.number().int().min(0).optional(),
  notes: z
    .array(
      z.strictObject({
        criterion: z.string().min(1),
        evidence: z.array(z.string().min(1)),
      }),
    )
    .min(1),
});

/* ------------------------------------------------------------------ */
/* 注册                                                                */
/* ------------------------------------------------------------------ */

/**
 * 在调用方 ctx 的 scope 内注册全部 worker 工具。
 *
 * @param ctx - preset 插件的 Context；注册层由该 ctx 的 scope 决定。
 * @param runtime - 已就绪的 Swarm 运行时（`ctx.swarm.ready`）。
 * @param artifacts - run 归属校验后的诊断存储。
 * @returns 注销全部工具的精确 disposer；并集由调用方 effect 持有。
 */
export function registerWorkerTools(
  ctx: Context,
  runtime: SwarmRuntime,
  artifacts: StoredArtifacts,
): () => void {
  const collaboration = runtime.collaboration;
  const discussInput = z.strictObject({ command: publicCommandSchema });

  const specs: ToolDefinition[] = [
    defineWorkerTool({
      name: 'swarm_discuss',
      description: 'Manage public collaboration in this run. command.action creates/archives channels, creates/updates threads, '
        + 'posts/replies/revises messages, subscribes, requests/responds/withdraws responses, creates/revises/confirms versioned '
        + 'agreements, or links Findings. Host automatically records notification display and full-message display; '
        + 'do not call ack_notifications or mark_read for routine bookkeeping (retained only for legacy callers). '
        + 'Use public threads by default. Structured mentions and responseRequestedFrom use worker IDs; @text alone does not notify. '
        + 'Revision/version checks are mandatory where specified. Reading or ACK is never a response/agreement; public chat never changes owner requirements or Task CAS.',
      parameters: generatedParameters(discussInput),
      input: discussInput,
      run: (input, exec, caller) => runtime.publicCollaboration.execute(caller.sessionId, input.command, exec.callId),
    }),
    defineWorkerTool({
      name: 'swarm_public_read',
      description: 'Discover public channels, threads, full messages, response requests, current agreements, personal priority attention, '
        + 'thread activity, message revisions or agreement versions. Filter/search by channel/thread/task/Finding; use messageId to locate a message. '
        + 'Returns bounded pages and nextCursor. All members including later arrivals can read public history regardless of subscription. '
        + 'Host records only the exact full versions actually displayed; summaries never mark full messages read. '
        + 'No manual ACK or read-confirmation call is needed. Pending responses stay above ordinary chatter.',
      parameters: generatedParameters(publicQuerySchema),
      input: publicQuerySchema,
      run: (input, _exec, caller) => runtime.publicCollaboration.query(caller.sessionId, input),
    }),
    defineWorkerTool({
      name: 'swarm_sync',
      description:
        'Read the run goal, acceptance criteria, accepted commit, your worker identity, the task board, '
        + 'and new collaboration items. Returns one bounded page; Host automatically records display after logging. '
        + 'Read further pages without ack_seq; no acknowledgement-only calls or chat replies are needed.',
      properties: {
        ack_seq: {
          type: 'integer',
          description: 'Legacy explicit cursor only. Omit for normal use: technical display receipts are automatic.',
        },
        limit: { type: 'integer', description: 'Maximum items to return in this page.' },
      },
      input: syncInput,
      run: async (input, _exec, caller) =>
        collaboration.sync(caller.sessionId, { ackSeq: input.ack_seq, limit: input.limit }),
    }),

    defineWorkerTool({
      name: 'swarm_read',
      description:
        'Read one record by id, or search goals, tasks, findings, and your direct messages with a boolean query expression. Diagnostic artifact ids '
        + '(starting with swarm-artifact-) return bounded text slices instead.',
      properties: {
        id: { type: 'string', description: 'Task, finding, message, or diagnostic artifact id.' },
        query: { type: 'string', description: 'When no id is given: Search expression: terms (case-insensitive substring), \"quoted phrases\", AND via & or whitespace, OR via |, NOT via - or !, parentheses, field filters kind:, author: (worker id or display name), task:. Example: (build | test) -kind:claim author:w2. Invalid expressions fail with SWARM_INVALID_INPUT naming the position. Covers full history: goals, tasks, findings (summary, details, expired claims) and your own direct messages; results report total and truncated.' },
        cursor: { type: 'string', description: 'nextCursor from a previous read result.' },
        limit: {
          type: 'integer',
          description: 'Maximum records, or characters for a diagnostic artifact (default 12000, max 24000).',
        },
        offset: {
          type: 'integer',
          description: 'Character offset for a diagnostic artifact; only valid with an artifact id.',
        },
      },
      input: readInput,
      run: async (input, _exec, caller) => {
        const id = input.id;
        const isArtifact = id !== undefined && id.startsWith(ARTIFACT_PREFIX);
        if (input.offset !== undefined && !isArtifact) {
          throw new SwarmError('SWARM_INVALID_INPUT', 'offset is only supported for diagnostic artifacts', {
            details: { id: id ?? null },
          });
        }
        if (id === undefined || !isArtifact) {
          return collaboration.read(caller.sessionId, {
            id,
            query: input.query,
            cursor: input.cursor,
            limit: input.limit,
          });
        }
        const { run } = collaboration.resolveWorker(caller.sessionId);
        const limit = input.limit ?? DEFAULT_ARTIFACT_CHARS;
        if (limit > MAX_ARTIFACT_CHARS) {
          throw new SwarmError('SWARM_INVALID_INPUT', 'diagnostic limit exceeds 24000 characters', {
            details: { limit, max: MAX_ARTIFACT_CHARS },
          });
        }
        return artifacts.readForRun(run.id, id, input.offset ?? 0, limit);
      },
    }),

    defineWorkerTool({
      name: 'swarm_task_create',
      description:
        'Create an open coordination task with acceptance criteria and an advisory file scope. '
        + 'Returns the stored task at revision 1.',
      properties: {
        kind: { type: 'string', enum: ['code', 'research'], description: 'Task kind.' },
        subject: { type: 'string', description: 'One-line task subject.' },
        acceptance: { type: 'string', description: 'How completion will be judged.' },
        scope: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory paths or areas this task may touch.',
        },
      },
      required: ['kind', 'subject', 'acceptance'],
      input: taskCreateInput,
      run: async (input, exec, caller) =>
        collaboration.createTask(
          caller.sessionId,
          {
            kind: input.kind,
            subject: input.subject,
            acceptance: input.acceptance,
            scope: input.scope ?? [],
          },
          exec.callId,
        ),
    }),

    defineWorkerTool({
      name: 'swarm_task_update',
      description:
        'Change one task state at the revision you last saw. Claim before editing; block, unblock, release, '
        + 'or cancel with a reason; complete a research task through its evidence-backed finding. '
        + 'Returns the updated task and its new revision.',
      properties: {
        task_id: { type: 'string', description: 'Target task id.' },
        expected_revision: { type: 'integer', description: 'Revision the decision is based on.' },
        action: {
          type: 'string',
          enum: ['claim', 'release', 'block', 'unblock', 'cancel', 'research_complete'],
          description: 'State transition to apply.',
        },
        reason: { type: 'string', description: 'Required for block, unblock, and cancel.' },
        finding_id: { type: 'string', description: 'Required for research_complete; must carry evidence.' },
      },
      required: ['task_id', 'expected_revision', 'action'],
      input: taskUpdateInput,
      run: async (input, exec, caller) =>
        collaboration.updateTask(
          caller.sessionId,
          {
            taskId: input.task_id,
            expectedRevision: input.expected_revision,
            action: input.action,
            reason: input.reason,
            findingId: input.finding_id,
          },
          exec.callId,
        ),
    }),

    defineWorkerTool({
      name: 'swarm_publish',
      description:
        'Publish an immutable finding: an observed fact, a decision peers must build on, a failure that '
        + 'needs repair, or a claim announcing the scope you are about to work on (an announcement, not a lock; '
        + 'Task CAS stays the authority). Claims leave live views after a TTL and a newer claim on the same task '
        + 'replaces yours there; history and search keep all. Returns the stored finding with the event seq peers will see.',
      properties: {
        kind: { type: 'string', enum: [...FINDING_KINDS], description: 'Finding kind. Use claim when starting a scope.' },
        summary: { type: 'string', description: `Short gist pushed to peers: ${SUMMARY_LIMIT_TEXT}.` },
        details: {
          type: 'string',
          description: `Optional supporting detail (at most ${FINDING_DETAILS_MAX_CHARS} characters). Not pushed in notices; peers expand it with swarm_read by id.`,
        },
        scope: { type: 'array', items: { type: 'string' }, description: 'Affected paths or areas.' },
        evidence_refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Commit SHAs, file paths, or diagnostic artifact ids supporting the claim.',
        },
        task_id: { type: 'string', description: 'Task this finding belongs to.' },
        supersedes_id: { type: 'string', description: 'Earlier finding this one corrects.' },
        blocking_repair_task_id: {
          type: 'string',
          description: 'Repair task for a fail finding; only valid with kind=fail.',
        },
      },
      required: ['kind', 'summary'],
      input: publishInput,
      run: async (input, exec, caller) =>
        collaboration.publish(
          caller.sessionId,
          {
            kind: input.kind,
            summary: input.summary,
            details: input.details,
            scope: input.scope,
            evidenceRefs: input.evidence_refs,
            taskId: input.task_id,
            supersedesId: input.supersedes_id,
            blockingRepairTaskId: input.blocking_repair_task_id,
          },
          exec.callId,
        ),
    }),

    defineWorkerTool({
      name: 'swarm_message',
      description:
        'Send a short urgent private message to one peer worker, addressed by worker id or session id. '
        + 'Direct messages have higher priority than public traffic: a running recipient sees it at its next '
        + 'tool-result boundary and an idle or waiting recipient is woken. Use it only for targeted one-to-one '
        + 'coordination that needs prompt attention (an overlapping edit, a blocking dependency, a direct request); '
        + 'public threads stay the default for anything others may need. Never copy a private message into public '
        + 'history without authorization. Returns the stored message; only the sender and recipient can read it. '
        + 'Delivery is at-least-once to the boundary, not exactly-once.',
      properties: {
        target: { type: 'string', description: 'Recipient worker id or session id.' },
        body: { type: 'string', description: 'Message text.' },
      },
      required: ['target', 'body'],
      input: messageInput,
      run: async (input, exec, caller) =>
        collaboration.message(
          caller.sessionId,
          { target: input.target, body: input.body },
          exec.callId,
        ),
    }),

    defineWorkerTool({
      name: 'swarm_submit',
      description:
        'Submit the exact commit SHA of a claimed task as an integration candidate. Returns the queued '
        + 'proposal; submission is not acceptance, so keep the candidate yours until integration reports back.',
      properties: {
        task_id: { type: 'string', description: 'Claimed task id.' },
        expected_revision: { type: 'integer', description: 'Current task revision.' },
        source_commit: { type: 'string', description: 'Full commit SHA to integrate.' },
      },
      required: ['task_id', 'expected_revision', 'source_commit'],
      input: submitInput,
      run: async (input, exec, caller) =>
        runtime.submit(
          caller.sessionId,
          {
            taskId: input.task_id,
            expectedRevision: input.expected_revision,
            sourceCommit: input.source_commit,
          },
          exec.callId,
        ),
    }),

    defineWorkerTool({
      name: 'swarm_wait',
      description:
        'Wait for new collaboration using the Host-maintained display cursor, optionally limited to task or proposal ids. '
        + 'Already-pending events return immediately. No separate synchronization or ACK is needed just to wait.',
      properties: {
        after_seq: { type: 'integer', description: 'Optional legacy explicit cursor; normally omit to use automatic display receipts.' },
        task_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only wake for these tasks.',
        },
        proposal_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only wake for these proposals.',
        },
      },
      input: waitInput,
      run: async (input, exec, caller) => {
        const busy = ctx.jobs
          .list(caller.agent.id)
          .some((job) => job.status === 'running' || job.status === 'stopping');
        const result = await collaboration.wait(
          caller.sessionId,
          {
            afterSeq: input.after_seq,
            taskIds: input.task_ids,
            proposalIds: input.proposal_ids,
          },
          exec.callId,
          busy,
        );
        if (result.waiting) exec.concludeTurn();
        return result;
      },
    }),

    defineWorkerTool({
      name: 'swarm_finish',
      description:
        'Request run completion against the current accepted commit and goal revision, with one evidence note per active '
        + 'acceptance criterion. Returns the receipt decision; acceptance still requires host verification '
        + 'and resource shutdown.',
      properties: {
        accepted_commit: { type: 'string', description: 'Accepted commit the evidence applies to.' },
        goal_revision: { type: 'integer', description: 'Current goalRevision from swarm_sync. Required after owner additions; omitted means original revision zero.' },
        notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string', description: 'Active acceptance criterion from swarm_sync.' },
              evidence: {
                type: 'array',
                items: { type: 'string' },
                description: 'Commit SHAs, paths, or diagnostic ids showing the criterion is met.',
              },
            },
            required: ['criterion', 'evidence'],
            additionalProperties: false,
          },
          description: 'At least one note per active criterion, including owner additions.',
        },
      },
      required: ['accepted_commit', 'notes'],
      input: finishInput,
      run: async (input, exec, caller) => {
        const decision = await runtime.finish(
          caller.sessionId,
          {
            acceptedCommit: input.accepted_commit,
            ...(input.goal_revision === undefined ? {} : { goalRevision: input.goal_revision }),
            notes: input.notes.map((note) => ({
              criterion: note.criterion,
              evidence: [...note.evidence],
            })),
          },
          exec.callId,
        );
        switch (decision.status) {
          case 'already_finishing':
          case 'accepted':
            // 两种受理都必须结束本 turn，否则 worker 会等待一个由自己触发的收尾。
            exec.concludeTurn();
            break;
        }
        return decision;
      },
    }),
  ];

  const disposers = specs.map((definition) => ctx.tools.register(definition));
  return () => {
    for (const dispose of [...disposers].reverse()) dispose();
  };
}