/**
 * Owner-facing `swarm_manage` tool.
 *
 * This is the explicit model/Agent entry point for controlling the user's own
 * swarm run: no ordinary chat message starts a run in the background, and the
 * tool does nothing unless the model calls it with an explicit action and
 * either an inline spec or a path to a configured spec file.
 *
 * Ownership is taken from the real `exec.agent` session id, never from model
 * arguments. Subagent and delegated sessions (worker children, debug probes)
 * are refused before any runtime call, so a worker cannot recursively start,
 * pause or stop the run that contains it. Starting still requires a writable
 * session and the runtime's own checks; this module never widens a sandbox or
 * permission preset.
 *
 * The tool shares the existing `SwarmRuntime`; it does not construct a second
 * runtime or a second process.
 */

import path from 'node:path';

import { z } from 'zod';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { Session } from '@deepseek-ai/dsh-session';
import type { JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools';

import type {
  SwarmCommandContext,
  SwarmFsTarget,
  SwarmRunStatusView,
  SwarmRunView,
  SwarmRuntimePort,
} from './commands.ts';
import { SwarmError, normalizeError } from './errors.ts';
import { parseRunSpec, runSpecSchema } from './spec.ts';
import type { RunSpec } from './types.ts';

/** Runtime calls the owner tool needs; the real `SwarmRuntime` satisfies this. */
export type SwarmOwnerRuntimePort = Pick<
  SwarmRuntimePort,
  'start' | 'status' | 'pause' | 'resume' | 'stop'
>;

/**
 * Host services the tool consumes. The real Cordis `Context` is structurally
 * assignable because `commands.ts` already verified the shared services; the
 * tool registry is the only extra member.
 */
export interface SwarmOwnerToolContext extends Omit<SwarmCommandContext, 'commands'> {
  readonly tools: {
    register(definition: ToolDefinition): () => void;
  };
}

/** The real invocation agent surface this module consumes. */
export interface SwarmOwnerAgent {
  readonly id: string;
  readonly session: Session;
}

/** Minimal tool invocation view; `ToolRunContext` is structurally assignable. */
export interface SwarmOwnerInvocation {
  readonly agent: SwarmOwnerAgent;
  readonly signal: AbortSignal;
}

/** Actions exposed to the model. `task` mutation stays on the `/swarm` command. */
export type SwarmManageAction = 'start' | 'status' | 'pause' | 'resume' | 'stop';

/** Validated `swarm_manage` input. */
export type SwarmManageInput = z.output<typeof manageInput>;

/** Inline spec shape: exactly the configured spec-file document. */
const inlineSpecSchema = runSpecSchema;

/** Wire schema: snake_case top level, spec file fields keep their file names. */
const manageInput = z.strictObject({
  action: z.enum(['start', 'status', 'pause', 'resume', 'stop']),
  spec_path: z.string().min(1).optional(),
  spec: inlineSpecSchema.optional(),
  details: z.boolean().optional(),
  budget_minutes: z.number().int().positive().optional(),
});

/** Bounded control receipt returned for every mutation. */
export interface SwarmManageReceipt {
  action: SwarmManageAction;
  runId: string;
  phase: string;
  reason: string | null;
  acceptedHead: string;
  resultRef: string;
  deadline: number;
  specPath?: string;
}

/** Bounded status projection returned by `action=status`; no message bodies. */
export type SwarmManageStatus = SwarmRunStatusView;

/**
 * Validate raw model arguments for `swarm_manage`.
 *
 * @throws SwarmError `SWARM_INVALID_INPUT` with per-field issues.
 */
export function parseManageInput(args: unknown): SwarmManageInput {
  const parsed = manageInput.safeParse(args);
  if (!parsed.success) {
    throw new SwarmError('SWARM_INVALID_INPUT', 'swarm_manage arguments are invalid', {
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map((segment) => String(segment)).join('.'),
          message: issue.message,
        })),
      },
    });
  }
  return parsed.data;
}

const OUTPUT_SCHEMA: JsonSchemaNode = { type: 'object', additionalProperties: true };

function toContent(value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }];
}

/** Reject subagent/delegated sessions so a worker cannot control its own run. */
function assertOwnerSession(agent: SwarmOwnerAgent): void {
  const header = agent.session.header;
  if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) {
    throw new SwarmError(
      'SWARM_FORBIDDEN',
      'swarm_manage is only available to a top-level owner session, not a subagent or worker',
      { details: { sessionId: agent.id } },
    );
  }
}

/**
 * Read and parse one spec file through the Host fs/sandbox adapters.
 *
 * @throws SwarmError `SWARM_INVALID_INPUT` when the file cannot be read,
 *   `SWARM_INVALID_SPEC` when it is not JSON or fails schema validation.
 */
async function loadSpecFile(
  ctx: SwarmOwnerToolContext,
  cwd: string,
  specPath: string,
  signal: AbortSignal,
): Promise<RunSpec> {
  const absolute = path.resolve(cwd, specPath);
  let text: string;
  try {
    const target: SwarmFsTarget = await ctx.fs.resolve(specPath, { cwd, signal });
    text = await ctx.fs.readText(target, signal);
  } catch (error) {
    throw new SwarmError('SWARM_INVALID_INPUT', `failed to read swarm spec ${absolute}`, {
      details: { specPath: absolute },
      cause: error,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SwarmError('SWARM_INVALID_SPEC', `swarm spec ${absolute} is not valid JSON`, {
      details: { specPath: absolute },
      cause: error,
    });
  }
  return parseRunSpec(parsed, absolute);
}

/**
 * Resolve the requested spec to a `RunSpec`.
 *
 * Inline specs are validated by the same schema as the file format; their
 * `repository` resolves relative to the session cwd and `specPath` is a
 * diagnostic label only (`<cwd>/swarm-inline.json`). Exactly one of
 * `spec_path` / `spec` is required for `start`.
 */
async function resolveSpec(
  ctx: SwarmOwnerToolContext,
  cwd: string,
  input: SwarmManageInput,
  signal: AbortSignal,
): Promise<RunSpec> {
  const { spec_path: specPath, spec } = input;
  if (specPath !== undefined && spec !== undefined) {
    throw new SwarmError('SWARM_INVALID_INPUT', 'provide either spec_path or spec, not both');
  }
  if (specPath !== undefined) {
    return loadSpecFile(ctx, cwd, specPath, signal);
  }
  if (spec === undefined) {
    throw new SwarmError('SWARM_INVALID_INPUT', 'action=start requires spec_path or spec');
  }
  const label = path.resolve(cwd, 'swarm-inline.json');
  return parseRunSpec(spec, label);
}

/** Project a runtime run view onto the bounded control receipt. */
function receipt(action: SwarmManageAction, run: SwarmRunView, specPath?: string): SwarmManageReceipt {
  return {
    action,
    runId: run.id,
    phase: run.phase,
    reason: run.reason,
    acceptedHead: run.acceptedHead,
    resultRef: run.resultRef,
    deadline: run.deadline,
    ...(specPath === undefined ? {} : { specPath }),
  };
}

/**
 * Execute one `swarm_manage` call.
 *
 * @param ctx - fs, working directory, sandbox policy and effect adapters.
 * @param runtime - shared public runtime surface.
 * @param invocation - real agent identity plus cancellation signal.
 * @param input - already-validated tool input.
 * @returns a bounded receipt or status projection.
 * @throws SwarmError on invalid ownership, read-only sandbox, aborted call or
 *   any runtime rejection (normalized by the registration wrapper).
 */
export async function handleSwarmManage(
  ctx: SwarmOwnerToolContext,
  runtime: SwarmOwnerRuntimePort,
  invocation: SwarmOwnerInvocation,
  input: SwarmManageInput,
): Promise<SwarmManageReceipt | SwarmManageStatus> {
  assertOwnerSession(invocation.agent);
  const ownerSessionId = invocation.agent.id;

  switch (input.action) {
    case 'status': {
      const status = runtime.status(ownerSessionId, input.details ?? false);
      if (status.ownerSessionId !== ownerSessionId) {
        throw new SwarmError(
          'SWARM_FORBIDDEN',
          `session ${ownerSessionId} does not own run ${status.runId}`,
          { details: { runId: status.runId, ownerSessionId } },
        );
      }
      return status;
    }
    case 'pause':
    case 'stop': {
      const run = input.action === 'pause'
        ? await runtime.pause(ownerSessionId)
        : await runtime.stop(ownerSessionId);
      return receipt(input.action, run);
    }
    case 'resume': {
      const run = input.budget_minutes === undefined
        ? await runtime.resume(ownerSessionId)
        : await runtime.resume(ownerSessionId, input.budget_minutes);
      return receipt('resume', run);
    }
    case 'start': {
      if (invocation.signal.aborted) {
        throw new SwarmError('SWARM_INVALID_STATE', 'swarm_manage was cancelled before start');
      }
      const cwd = ctx.workingDirectory.get(invocation.agent.session);
      const policy = ctx.sandboxPolicy.resolve({ session: invocation.agent.session });
      if (policy.mode === 'read-only') {
        throw new SwarmError(
          'SWARM_FORBIDDEN',
          'session sandbox mode is read-only; a swarm run requires a writable workspace',
          { details: { mode: policy.mode } },
        );
      }
      const spec = await resolveSpec(ctx, cwd, input, invocation.signal);
      const run = await runtime.start(ownerSessionId, spec);
      return receipt('start', run, spec.specPath);
    }
  }
}

/**
 * Model-facing description of the tool's behavior and safety boundary.
 * Kept as a constant so USAGE and tests can quote the same text.
 */
export const SWARM_MANAGE_DESCRIPTION =
  'Start, inspect or control the caller\'s own swarm run. Requires an explicit action and either '
  + 'an inline `spec` object or `spec_path`. Ownership comes from the current Agent session; subagent '
  + 'and worker sessions are refused. Never starts a run from ordinary chat text.';

/** Tool properties mirroring {@link manageInput}. */
const COMMAND_PROPERTIES: Record<string, JsonSchemaNode> = {
  argv: { type: 'array', items: { type: 'string' }, description: 'Command argv; never shell-split.' },
  timeoutMs: { type: 'integer', description: 'Wall-clock timeout in milliseconds.' },
};

const INLINE_SPEC_PROPERTIES: Record<string, JsonSchemaNode> = {
  repository: {
    type: 'string',
    description: 'Repository path; relative paths resolve from the session working directory.',
  },
  baseRef: { type: 'string', description: 'Git ref or commit the run starts from.' },
  goal: { type: 'string', description: 'Goal statement shared with every worker.' },
  acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Checkable requirements.' },
  workers: { type: 'integer', description: 'Worker count, 2–4.' },
  budgetMinutes: { type: 'integer', description: 'Wall-clock budget in minutes.' },
  allowDirtyBaseline: { type: 'boolean', description: 'Allow an uncommitted source worktree.' },
  verification: {
    type: 'object',
    description: 'Setup and test commands; `test` must be non-empty.',
    properties: {
      setup: { type: 'array', items: { type: 'object', properties: COMMAND_PROPERTIES, additionalProperties: false } },
      test: { type: 'array', items: { type: 'object', properties: COMMAND_PROPERTIES, additionalProperties: false } },
    },
    additionalProperties: false,
  },
};

const MANAGE_PROPERTIES: Record<string, JsonSchemaNode> = {
  action: {
    type: 'string',
    enum: ['start', 'status', 'pause', 'resume', 'stop'],
    description: 'Control action. `start` requires spec or spec_path.',
  },
  spec_path: {
    type: 'string',
    description: 'Path to a configured JSON run spec, resolved from the session working directory.',
  },
  spec: {
    type: 'object',
    description:
      'Inline run spec (same fields as a spec file). `repository` resolves from the session working directory.',
    properties: INLINE_SPEC_PROPERTIES,
    additionalProperties: false,
  },
  details: { type: 'boolean', description: 'For status: include bounded cursor and attempt details.' },
  budget_minutes: {
    type: 'integer',
    description: 'For resume: additional minutes added to the deadline.',
  },
};

/**
 * Register `swarm_manage` in the calling context's scope.
 *
 * The Host entry calls this once after `runtime` is ready; the returned
 * disposer is also installed as a context effect so plugin unload removes the
 * tool. Workers never load this module, and the handler independently refuses
 * delegated sessions.
 *
 * @returns the tool registry disposer.
 */
export function registerOwnerTools(
  ctx: SwarmOwnerToolContext,
  runtime: SwarmOwnerRuntimePort,
): () => void {
  const definition: ToolDefinition = {
    name: 'swarm_manage',
    description: SWARM_MANAGE_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: MANAGE_PROPERTIES,
      additionalProperties: false,
      required: ['action'],
    },
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => toContent(value) },
    execute: async (args, exec) => {
      const agent = exec.agent;
      if (agent === undefined) {
        throw new SwarmError('SWARM_FORBIDDEN', 'swarm_manage requires an owning agent session');
      }
      const parsed = parseManageInput(args);
      try {
        return await handleSwarmManage(
          ctx,
          runtime,
          { agent, signal: exec.signal },
          parsed,
        );
      } catch (error) {
        throw normalizeError(error, 'SWARM_INTERNAL', 'swarm_manage failed');
      }
    },
  };

  const disposable = ctx.tools.register(definition);
  ctx.effect(() => disposable);
  return disposable;
}