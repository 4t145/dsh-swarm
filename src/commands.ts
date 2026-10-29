/**
 * Narrow human-command front end for the Swarm control plane.
 *
 * The only entry point is the `/swarm` command. Input is parsed by a small,
 * non-shell tokenizer; every action is delegated to the public
 * `SwarmRuntime` methods with the owner taken from the real invocation agent.
 * This module never executes shell text, never mutates runtime internals and
 * never invents a worker identity supplied by the caller.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { CommandResult } from '@deepseek-ai/dsh-commands';
import type { Session } from '@deepseek-ai/dsh-session';

import { SwarmError, normalizeError } from './errors.ts';
import { loadRunSpecFile } from './spec-file.ts';
import type { RunStatus } from './runtime.ts';
import type { AddWorkerReceipt, AppendGoalInput, AppendGoalReceipt, GoalRecord, Run, RunSpec } from './types.ts';

/** Fixed usage line repeated by parse diagnostics. */
export const SWARM_USAGE =
  'usage: start --spec <path> | append <goal text> | append --json <object> | continue | worker add [--json] | status [--details] | pause | resume [--budget <30m|1h>] | stop | task release|cancel <id> --revision <n> --reason <text>';

/** Maximum characters returned to the human UI for one command. */
const MAX_RESULT_TEXT = 4000;

/** Maximum rows shown per details section. */
const DETAIL_ROW_LIMIT = 10;

/** Parsed subcommands; every variant is exhaustive for the fixed grammar. */
export type SwarmCommand =
  | { readonly kind: 'start'; readonly specPath: string }
  | { readonly kind: 'append'; readonly input: AppendGoalInput; readonly json: boolean }
  | { readonly kind: 'continue' }
  | { readonly kind: 'worker'; readonly action: 'add'; readonly json: boolean }
  | { readonly kind: 'status'; readonly details: boolean }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume'; readonly budgetMinutes?: number }
  | { readonly kind: 'stop' }
  | {
      readonly kind: 'task';
      readonly action: 'release' | 'cancel';
      readonly taskId: string;
      readonly revision: number;
      readonly reason: string;
    };

/** The real invocation agent surface this module consumes. */
export interface SwarmCommandAgent {
  readonly id: string;
  readonly session: Session;
}

/**
 * The invocation fields this module reads. The real `CommandInvocation` is
 * structurally assignable because its agent carries `id` and `session`.
 */
export interface SwarmCommandInvocation {
  readonly agent: SwarmCommandAgent;
  readonly rawInput: string;
  readonly signal: AbortSignal;
}

/** Narrow registration surface owned by the command registry. */
export interface SwarmCommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly input?: { readonly hint: string };
  readonly handler: (invocation: SwarmCommandInvocation) => CommandResult | Promise<CommandResult>;
}

/** A resolved filesystem target; only the display path is read here. */
export interface SwarmFsTarget {
  readonly displayPath: string;
}

/**
 * Host services consumed by the command module. The real Cordis `Context`
 * satisfies this shape; tests provide fakes without constructing one.
 */
export interface SwarmCommandContext {
  readonly commands: {
    register(definition: SwarmCommandDefinition): () => void;
  };
  readonly workingDirectory: {
    get(session: Session): string;
  };
  readonly fs: {
    resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<SwarmFsTarget>;
    readText(target: SwarmFsTarget, signal?: AbortSignal): Promise<string>;
  };
  readonly sandboxPolicy: {
    resolve(request: { session: Session }): { readonly mode: string };
  };
  readonly effect: (setup: () => () => void) => unknown;
}

/** A run record projected onto the fields a receipt needs. */
export interface SwarmRunView {
  readonly id: string;
  readonly phase: string;
  readonly reason: string | null;
  readonly deadline: number | null;
  readonly baseCommit: string;
  readonly acceptedHead: string;
  readonly resultRef: string;
  readonly allowDirtyBaseline: boolean;
}

/** Bounded status details used by `status --details`. */
export interface SwarmRunStatusDetailsView {
  readonly goalRecords?: readonly GoalRecord[];
  readonly eventCount: number;
  readonly lastEventSeq: number;
  readonly inFlightOperations: number;
  readonly messageCount: number;
  readonly mutationReceiptCount: number;
  readonly integrationAttempts: readonly {
    readonly id: string;
    readonly proposalId: string;
    readonly status: string;
    readonly candidateCommit: string | null;
  }[];
  readonly proposals: readonly {
    readonly id: string;
    readonly taskId: string;
    readonly status: string;
    readonly sourceCommit: string;
  }[];
  readonly verifications: readonly {
    readonly id: string;
    readonly purpose: string;
    readonly status: string;
    readonly commit: string;
  }[];
}

/** A run status projected onto the JSON-safe fields rendered as text. */
export interface SwarmRunStatusView {
  readonly goalRevision?: number;
  readonly goals?: { readonly total: number; readonly active: number; readonly deferred: number; readonly completed: number };
  readonly runId: string;
  readonly ownerSessionId: string;
  readonly phase: string;
  readonly reason: string | null;
  readonly deadline: number | null;
  readonly now: number;
  readonly budgetExpired: boolean;
  readonly baseCommit: string;
  readonly acceptedHead: string;
  readonly resultRef: string;
  readonly tasks: {
    readonly open: number;
    readonly claimed: number;
    readonly proposed: number;
    readonly done: number;
    readonly blocked: number;
    readonly cancelled: number;
    readonly total: number;
  };
  readonly workerControls?: NonNullable<RunStatus['workerControls']>;
  readonly workers: readonly {
    readonly id: string;
    readonly sessionId: string;
    readonly initializationState: string;
    readonly nativeStatus: string;
    readonly currentTaskId: string | null;
  }[];
  readonly proposals: {
    readonly queued: number;
    readonly integrating: number;
    readonly accepted: number;
    readonly rejected: number;
  };
  readonly verifications: {
    readonly queued: number;
    readonly running: number;
    readonly passed: number;
    readonly failed: number;
    readonly interrupted: number;
  };
  readonly admission: string;
  readonly diagnostics: readonly string[];
  readonly details?: SwarmRunStatusDetailsView;
}

/** The task record fields rendered after a control mutation. */
export interface SwarmTaskView {
  readonly id: string;
  readonly status: string;
  readonly revision: number;
}

/**
 * Public runtime calls used by the command module. The real `SwarmRuntime`
 * satisfies this shape; no private field is touched.
 */
export interface SwarmRuntimePort {
  start(ownerSessionId: string, spec: RunSpec): Promise<SwarmRunView>;
  appendGoal(ownerSessionId: string, input: AppendGoalInput, callId: string): Promise<AppendGoalReceipt>;
  continueGoals(ownerSessionId: string): Promise<SwarmRunView>;
  addWorker(ownerSessionId: string): Promise<AddWorkerReceipt>;
  status(ownerSessionId: string, details?: boolean): SwarmRunStatusView;
  runForOwner?(ownerSessionId: string): Run;
  pause(ownerSessionId: string): Promise<SwarmRunView>;
  resume(ownerSessionId: string, budgetMinutes?: number): Promise<SwarmRunView>;
  stop(ownerSessionId: string): Promise<SwarmRunView>;
  readonly collaboration: {
    controlTask(
      runId: string,
      ownerSessionId: string,
      input: {
        taskId: string;
        expectedRevision: number;
        action: 'release' | 'cancel';
        reason: string;
      },
    ): Promise<SwarmTaskView>;
  };
}

/** Async Git inspection used only by an owner's explicit status request. */
export interface SwarmWorkspacePort {
  resultHead(run: Run, signal?: AbortSignal): Promise<string>;
}

/**
 * Tokenize command input without invoking a shell.
 *
 * Single and double quotes group whitespace (paths and reasons may contain
 * spaces); adjacent quoted/unquoted text joins one token. No escapes.
 *
 * @throws SwarmError `SWARM_INVALID_INPUT` when a quote is never closed.
 */
export function tokenizeSwarmInput(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;

  const push = (): void => {
    if (started) {
      tokens.push(current);
      current = '';
      started = false;
    }
  };

  for (const char of input) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      push();
      continue;
    }
    current += char;
    started = true;
  }

  if (quote !== null) {
    throw invalidInput('unterminated quoted argument');
  }
  push();
  return tokens;
}

/**
 * Parse the exact `/swarm` grammar.
 *
 * @param input - text following the command name (leading whitespace allowed).
 * @returns the validated subcommand.
 * @throws SwarmError `SWARM_INVALID_INPUT` for unknown options, extra items,
 *   missing values, a missing reason or an invalid budget/revision.
 */
export function parseSwarmCommand(input: string): SwarmCommand {
  // Goal prose and JSON are not shell tokens: retain apostrophes, quotes and
  // newlines exactly, including escaped JSON strings submitted by the panel.
  const append = /^\s*append(?:\s+([\s\S]*))?$/u.exec(input);
  if (append) return parseAppend(append[1] ?? '');
  const tokens = tokenizeSwarmInput(input);
  const subcommand = tokens[0];
  if (subcommand === undefined) {
    throw invalidInput(`missing subcommand; ${SWARM_USAGE}`);
  }
  const args = tokens.slice(1);

  switch (subcommand) {
    case 'start': {
      const specPath = singleOption(args, '--spec').trim();
      if (specPath === '') {
        throw invalidInput(`--spec must be a non-empty path; ${SWARM_USAGE}`);
      }
      return { kind: 'start', specPath };
    }
    case 'continue':
      expectNoArguments('continue', args);
      return { kind: 'continue' };
    case 'status':
      return parseStatus(args);
    case 'pause':
      expectNoArguments('pause', args);
      return { kind: 'pause' };
    case 'resume':
      return parseResume(args);
    case 'stop':
      expectNoArguments('stop', args);
      return { kind: 'stop' };
    case 'worker':
      if (args[0] !== 'add' || args.length > 2 || (args[1] !== undefined && args[1] !== '--json')) {
        throw invalidInput(`expected worker add [--json]; ${SWARM_USAGE}`);
      }
      return { kind: 'worker', action: 'add', json: args[1] === '--json' };
    case 'task':
      return parseTask(args);
    default:
      throw invalidInput(`unknown subcommand "${subcommand}"; ${SWARM_USAGE}`);
  }
}

/**
 * Parse a positive duration such as `30m` or `1h` into minutes.
 *
 * @throws SwarmError `SWARM_INVALID_INPUT` when the text is not a positive
 *   integer with an `m` or `h` unit.
 */
export function parseBudgetDuration(value: string): number {
  const match = /^([1-9]\d*)([mh])$/i.exec(value.trim());
  const amountText = match?.[1];
  const unit = match?.[2]?.toLowerCase();
  if (amountText === undefined || unit === undefined) {
    throw invalidInput('--budget must be a positive duration such as 30m or 1h');
  }
  const amount = Number(amountText);
  const minutes = unit === 'h' ? amount * 60 : amount;
  if (!Number.isSafeInteger(minutes)) {
    throw invalidInput('--budget is too large');
  }
  return minutes;
}

/**
 * Register the `/swarm` command and return its exact disposer.
 *
 * The disposer is also installed as a context effect, so plugin unload
 * unregisters the command even when the caller ignores the return value.
 *
 * @param ctx - Host services (real Cordis `Context` is structurally valid).
 * @param runtime - public Swarm control surface.
 * @param workspace - result-ref port; see {@link SwarmWorkspacePort} for the
 *   current `status --details` limitation.
 * @returns the registry disposer.
 */
export function registerSwarmCommand(
  ctx: SwarmCommandContext,
  runtime: SwarmRuntimePort,
  workspace: SwarmWorkspacePort,
): () => void {
  const disposable = ctx.commands.register({
    name: 'swarm',
    description: '◈ Swarm · 追加目标与协作 / Goals & collaboration',
    input: { hint: 'append <目标 / goal> · status · pause · resume · continue' },
    handler: (invocation) => handleSwarmCommand(ctx, runtime, invocation, workspace),
  });
  ctx.effect(() => disposable);
  return disposable;
}

/**
 * Execute one parsed `/swarm` invocation.
 *
 * @returns a success receipt or an explicit error result. Every thrown value is
 *   normalized: `SwarmError` keeps its code/message, unknown failures surface
 *   as `SWARM_INTERNAL` instead of disappearing.
 */
export async function handleSwarmCommand(
  ctx: SwarmCommandContext,
  runtime: SwarmRuntimePort,
  invocation: SwarmCommandInvocation,
  workspace?: SwarmWorkspacePort,
): Promise<CommandResult> {
  try {
    const header = invocation.agent.session.header;
    if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) {
      throw new SwarmError('SWARM_FORBIDDEN', '/swarm is only available to a top-level owner session, not a subagent or worker');
    }
    const command = parseSwarmCommand(invocation.rawInput);
    const ownerSessionId = String(invocation.agent.id);

    switch (command.kind) {
      case 'start':
        return await startRun(ctx, runtime, invocation, ownerSessionId, command.specPath);
      case 'append': {
        assertWritableGoalAction(ctx, invocation);
        const result = await runtime.appendGoal(ownerSessionId, command.input, randomUUID());
        return { kind: 'success', text: formatAppendReceipt(result, command.json) };
      }
      case 'continue': {
        assertWritableGoalAction(ctx, invocation);
        const run = await runtime.continueGoals(ownerSessionId);
        return { kind: 'success', text: formatStartReceipt(run) };
      }
      case 'worker': {
        assertWritableGoalAction(ctx, invocation);
        const receipt = await runtime.addWorker(ownerSessionId);
        return { kind: 'success', text: command.json ? JSON.stringify(receipt)
          : `${receipt.displayName} (${receipt.workerId}): ${receipt.disposition === 'paused' ? 'reserved; resume the run to start' : 'started'}` };
      }
      case 'status': {
        const status = runtime.status(ownerSessionId, command.details);
        let text = formatStatus(status, command.details);
        if (command.details && workspace && runtime.runForOwner) {
          const run = runtime.runForOwner(ownerSessionId);
          const actual = await workspace.resultHead(run, invocation.signal);
          text = `result check: ${actual === run.acceptedHead ? 'matches' : 'MISMATCH'}\nactual result SHA: ${actual}\n` +
            text.replace(/result check: unverified[^\n]*/u, '') +
            `\ninspect complete changes: git diff ${run.baseCommit} ${run.acceptedHead}`;
        }
        return { kind: 'success', text: limitText(text) };
      }
      case 'pause': {
        const run = await runtime.pause(ownerSessionId);
        return { kind: 'success', text: formatControlReceipt('pause', run) };
      }
      case 'resume': {
        const run =
          command.budgetMinutes === undefined
            ? await runtime.resume(ownerSessionId)
            : await runtime.resume(ownerSessionId, command.budgetMinutes);
        return { kind: 'success', text: formatControlReceipt('resume', run) };
      }
      case 'stop': {
        const run = await runtime.stop(ownerSessionId);
        return { kind: 'success', text: formatControlReceipt('stop', run) };
      }
      case 'task': {
        const status = runtime.status(ownerSessionId);
        if (status.ownerSessionId !== ownerSessionId) {
          throw new SwarmError(
            'SWARM_FORBIDDEN',
            `session ${ownerSessionId} does not own run ${status.runId}`,
            { details: { runId: status.runId, ownerSessionId } },
          );
        }
        const task = await runtime.collaboration.controlTask(status.runId, ownerSessionId, {
          taskId: command.taskId,
          expectedRevision: command.revision,
          action: command.action,
          reason: command.reason,
        });
        return {
          kind: 'success',
          text: `task ${task.id} ${command.action} applied: status=${task.status} revision=${task.revision}`,
        };
      }
      default:
        return { kind: 'error', text: 'SWARM_INTERNAL: unhandled swarm subcommand' };
    }
  } catch (error) {
    const failure = normalizeError(error, 'SWARM_INTERNAL', 'swarm command failed');
    return { kind: 'error', text: `${failure.code}: ${failure.message}` };
  }
}

/* ------------------------------------------------------------------ */
/* handlers                                                            */
/* ------------------------------------------------------------------ */

function assertWritableGoalAction(ctx: SwarmCommandContext, invocation: SwarmCommandInvocation): void {
  if (invocation.signal.aborted) {
    throw new SwarmError('SWARM_INVALID_STATE', 'command was cancelled; no control action was applied');
  }
  if (ctx.sandboxPolicy.resolve({ session: invocation.agent.session }).mode === 'read-only') {
    throw new SwarmError('SWARM_FORBIDDEN', 'session sandbox mode is read-only; changing swarm goals or members requires a writable session');
  }
}

async function startRun(
  ctx: SwarmCommandContext,
  runtime: SwarmRuntimePort,
  invocation: SwarmCommandInvocation,
  ownerSessionId: string,
  specPath: string,
): Promise<CommandResult> {
  if (invocation.signal.aborted) {
    throw new SwarmError(
      'SWARM_INVALID_STATE',
      'command was cancelled before start; no swarm run was started',
    );
  }

  const cwd = ctx.workingDirectory.get(invocation.agent.session);
  // Read-only sessions must fail before any workspace or spec access; starting a
  // run requires writable worktrees, and this module never widens permissions.
  const policy = ctx.sandboxPolicy.resolve({ session: invocation.agent.session });
  if (policy.mode === 'read-only') {
    throw new SwarmError(
      'SWARM_FORBIDDEN',
      'session sandbox mode is read-only; a swarm run requires a writable workspace',
      { details: { mode: policy.mode } },
    );
  }

  const spec = await loadRunSpecFile(ctx.fs, cwd, specPath, invocation.signal, 'detail');
  const run = await runtime.start(ownerSessionId, spec);
  return { kind: 'success', text: formatStartReceipt(run) };
}

/* ------------------------------------------------------------------ */
/* parsing helpers                                                     */
/* ------------------------------------------------------------------ */

const appendInput = z.strictObject({
  goal: z.string().trim().min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1).optional(),
});

function parseAppend(raw: string): SwarmCommand {
  const text = raw.trim();
  const json = /^--json(?:\s|$)/u.test(text);
  let value: unknown = { goal: text };
  if (json) {
    try {
      value = JSON.parse(text.slice('--json'.length).trim());
    } catch {
      throw invalidInput('append --json requires a JSON object with goal and optional acceptanceCriteria');
    }
  }
  const parsed = appendInput.safeParse(value);
  if (!parsed.success) {
    throw invalidInput('append requires a non-empty goal and optional non-empty acceptanceCriteria array');
  }
  return {
    kind: 'append',
    input: {
      text: parsed.data.goal,
      ...(parsed.data.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: parsed.data.acceptanceCriteria }),
    },
    json,
  };
}

function parseStatus(args: readonly string[]): SwarmCommand {
  const first = args[0];
  if (first === undefined) {
    return { kind: 'status', details: false };
  }
  if (first !== '--details') {
    throw invalidInput(`unexpected argument "${first}"; ${SWARM_USAGE}`);
  }
  if (args.length > 1) {
    throw invalidInput(`unexpected argument "${args[1] ?? ''}"; ${SWARM_USAGE}`);
  }
  return { kind: 'status', details: true };
}

function parseResume(args: readonly string[]): SwarmCommand {
  const first = args[0];
  if (first === undefined) {
    return { kind: 'resume' };
  }
  if (first !== '--budget') {
    throw invalidInput(`unexpected argument "${first}"; ${SWARM_USAGE}`);
  }
  const value = args[1];
  if (value === undefined) {
    throw invalidInput(`missing value for --budget; ${SWARM_USAGE}`);
  }
  if (args.length > 2) {
    throw invalidInput(`unexpected argument "${args[2] ?? ''}"; ${SWARM_USAGE}`);
  }
  return { kind: 'resume', budgetMinutes: parseBudgetDuration(value) };
}

function parseTask(args: readonly string[]): SwarmCommand {
  const action = args[0];
  if (action !== 'release' && action !== 'cancel') {
    throw invalidInput(`task action must be release or cancel; ${SWARM_USAGE}`);
  }
  const taskId = args[1];
  if (taskId === undefined || taskId === '') {
    throw invalidInput(`task ${action} requires a task id; ${SWARM_USAGE}`);
  }
  if (taskId.startsWith('--')) {
    throw invalidInput(`task ${action} requires a task id before options; ${SWARM_USAGE}`);
  }

  let revision: number | undefined;
  let reason: string | undefined;
  let index = 2;
  while (index < args.length) {
    const flag = args[index];
    if (flag === undefined) {
      break;
    }
    if (!flag.startsWith('--')) {
      throw invalidInput(`unexpected argument "${flag}"; ${SWARM_USAGE}`);
    }
    const value = args[index + 1];
    if (value === undefined) {
      throw invalidInput(`missing value for ${flag}; ${SWARM_USAGE}`);
    }
    index += 2;
    switch (flag) {
      case '--revision':
        if (revision !== undefined) {
          throw invalidInput('--revision was provided more than once');
        }
        revision = parseRevision(value);
        break;
      case '--reason':
        if (reason !== undefined) {
          throw invalidInput('--reason was provided more than once');
        }
        if (value.trim() === '') {
          throw invalidInput(`task ${action} requires a non-empty --reason`);
        }
        reason = value;
        break;
      default:
        throw invalidInput(`unknown option "${flag}"; ${SWARM_USAGE}`);
    }
  }

  if (revision === undefined) {
    throw invalidInput(`task ${action} requires --revision <n>; ${SWARM_USAGE}`);
  }
  if (reason === undefined) {
    throw invalidInput(`task ${action} requires --reason <text>; ${SWARM_USAGE}`);
  }
  return { kind: 'task', action, taskId, revision, reason };
}

function singleOption(args: readonly string[], flag: string): string {
  const first = args[0];
  if (first === undefined) {
    throw invalidInput(`missing ${flag}; ${SWARM_USAGE}`);
  }
  if (first !== flag) {
    throw invalidInput(`expected ${flag}, got "${first}"; ${SWARM_USAGE}`);
  }
  const value = args[1];
  if (value === undefined) {
    throw invalidInput(`missing value for ${flag}; ${SWARM_USAGE}`);
  }
  if (args.length > 2) {
    throw invalidInput(`unexpected argument "${args[2] ?? ''}"; ${SWARM_USAGE}`);
  }
  return value;
}

function expectNoArguments(subcommand: string, args: readonly string[]): void {
  const first = args[0];
  if (first !== undefined) {
    throw invalidInput(`unexpected argument "${first}" after ${subcommand}; ${SWARM_USAGE}`);
  }
}

function parseRevision(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw invalidInput('--revision must be a positive integer');
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) {
    throw invalidInput('--revision is too large');
  }
  return revision;
}

/* ------------------------------------------------------------------ */
/* formatting                                                          */
/* ------------------------------------------------------------------ */

function formatAppendReceipt(result: AppendGoalReceipt, json: boolean): string {
  if (json) return JSON.stringify({
    runId: result.runId,
    goalId: result.goal.id,
    disposition: result.disposition,
    phase: result.phase,
    goalRevision: result.goalRevision,
  });
  const disposition = {
    executing: 'accepted into the current round; workers can act on it',
    paused: 'saved; still paused — use /swarm resume when ready',
    deferred: 'saved for the next round; not executing — use /swarm continue after this run ends',
  }[result.disposition];
  return limitText(`goal ${result.goal.id}: ${disposition}\nrun: ${result.runId} phase=${result.phase} revision=${result.goalRevision}`);
}

function formatStartReceipt(run: SwarmRunView): string {
  const lines = [
    'swarm run started',
    `run id: ${run.id}`,
    `base sha: ${run.baseCommit}`,
    `result branch: ${run.resultRef}`,
    `deadline: ${formatTime(run.deadline)}`,
  ];
  if (run.allowDirtyBaseline) {
    lines.push('baseline: uncommitted changes are not included in this run');
  }
  return limitText(lines.join('\n'));
}

function formatControlReceipt(action: 'pause' | 'resume' | 'stop', run: SwarmRunView): string {
  const reason = run.reason === null ? '-' : run.reason;
  return limitText(
    `${action} run ${run.id}: phase=${run.phase} reason=${reason} deadline=${formatTime(run.deadline)}`,
  );
}

function formatStatus(status: SwarmRunStatusView, details: boolean): string {
  const tasks = status.tasks;
  const lines = [
    `swarm run ${status.runId}: phase=${status.phase}${status.reason === null ? '' : ` reason=${status.reason}`}`,
    `owner: ${status.ownerSessionId}`,
    `deadline: ${formatTime(status.deadline)}${status.budgetExpired ? ' (budget expired)' : ''} now=${formatTime(status.now)}`,
    `base sha: ${status.baseCommit}`,
    `accepted head: ${status.acceptedHead}`,
    `result branch: ${status.resultRef}`,
    `tasks: total=${tasks.total} open=${tasks.open} claimed=${tasks.claimed} proposed=${tasks.proposed} done=${tasks.done} blocked=${tasks.blocked} cancelled=${tasks.cancelled}`,
    `proposals: queued=${status.proposals.queued} integrating=${status.proposals.integrating} accepted=${status.proposals.accepted} rejected=${status.proposals.rejected}`,
    `verifications: queued=${status.verifications.queued} running=${status.verifications.running} passed=${status.verifications.passed} failed=${status.verifications.failed} interrupted=${status.verifications.interrupted}`,
    `admission: ${status.admission}`,
  ];

  if (status.goals) {
    const goals = status.goals;
    lines.splice(2, 0, `goals: revision=${status.goalRevision ?? 0} total=${goals.total} active=${goals.active} deferred=${goals.deferred} completed=${goals.completed}`);
    if (goals.deferred > 0) lines.splice(3, 0, 'deferred goals: saved, not executing; /swarm continue after this run ends');
  }

  const controls = status.workerControls;
  lines.push(`team limit: ${controls?.maxWorkers ?? 'unavailable'} source=${controls?.source ?? 'unavailable'} canAdd=${controls?.canAdd ?? false} (not native free capacity)`);
  if (controls?.diagnostic) lines.push(`team limit diagnostic: ${controls.diagnostic.slice(0, 200)}`);

  if (status.workers.length > 0) {
    lines.push(`workers (${status.workers.length}):`);
    for (const worker of status.workers) {
      lines.push(
        `- ${worker.id} session=${worker.sessionId} init=${worker.initializationState} native=${worker.nativeStatus} task=${worker.currentTaskId ?? '-'}`,
      );
    }
  }

  if (status.diagnostics.length > 0) {
    lines.push(`diagnostics (${status.diagnostics.length}):`);
    for (const diagnostic of status.diagnostics.slice(0, 5)) {
      lines.push(`- ${diagnostic}`);
    }
    if (status.diagnostics.length > 5) {
      lines.push(`- ... ${status.diagnostics.length - 5} more`);
    }
  }

  if (details) {
    const extra = status.details;
    if (extra === undefined) {
      lines.push('details: unavailable');
    } else {
      lines.push(
        `details: events=${extra.eventCount} lastSeq=${extra.lastEventSeq} inflight=${extra.inFlightOperations} messages=${extra.messageCount} receipts=${extra.mutationReceiptCount}`,
      );
      appendBounded(lines, 'latest goals', (extra.goalRecords ?? []).map((goal) =>
        `${goal.id} status=${goal.status}${goal.continuedInRunId ? ` continuedIn=${goal.continuedInRunId}` : ''} ${goal.text.slice(0, 160)}`));
      appendBounded(
        lines,
        'integration attempts',
        extra.integrationAttempts.map(
          (attempt) =>
            `${attempt.id} proposal=${attempt.proposalId} status=${attempt.status} candidate=${attempt.candidateCommit ?? '-'}`,
        ),
      );
      appendBounded(
        lines,
        'proposals',
        extra.proposals.map(
          (proposal) =>
            `${proposal.id} task=${proposal.taskId} status=${proposal.status} source=${proposal.sourceCommit}`,
        ),
      );
      appendBounded(
        lines,
        'verifications',
        extra.verifications.map(
          (verification) =>
            `${verification.id} purpose=${verification.purpose} status=${verification.status} commit=${verification.commit}`,
        ),
      );
    }
    lines.push(
      'result check: unverified (runtime.status exposes no public Run accessor, so workspace.resultHead cannot compare the actual result SHA)',
    );
  }

  return limitText(lines.join('\n'));
}

function appendBounded(
  lines: string[],
  label: string,
  items: readonly string[],
  limit = DETAIL_ROW_LIMIT,
): void {
  if (items.length === 0) {
    return;
  }
  lines.push(`${label} (${items.length}):`);
  for (const item of items.slice(0, limit)) {
    lines.push(`- ${item}`);
  }
  if (items.length > limit) {
    lines.push(`- ... ${items.length - limit} more`);
  }
}

function formatTime(value: number | null): string {
  if (value === null) return 'none (no time limit)';
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return new Date(value).toISOString();
}

function limitText(text: string): string {
  if (text.length <= MAX_RESULT_TEXT) {
    return text;
  }
  return `${text.slice(0, MAX_RESULT_TEXT)}\n... (truncated)`;
}

function invalidInput(message: string): SwarmError {
  return new SwarmError('SWARM_INVALID_INPUT', message);
}