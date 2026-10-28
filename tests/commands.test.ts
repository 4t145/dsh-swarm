/**
 * `/swarm` command tests: pure grammar coverage plus handler behavior against
 * narrow, hand-written Host/runtime fakes. No real Host, Git workspace or
 * model is started.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Context } from '@deepseek-ai/cordis';
import type { CommandRuntime } from '@deepseek-ai/dsh-commands';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy';
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session';
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory';

import {
  parseSwarmCommand,
  parseBudgetDuration,
  registerSwarmCommand,
  type SwarmCommandContext,
  type SwarmCommandDefinition,
  type SwarmCommandInvocation,
  type SwarmFsTarget,
  type SwarmRunStatusView,
  type SwarmRunView,
  type SwarmRuntimePort,
  type SwarmWorkspacePort,
} from '../src/commands.ts';
import { SwarmError } from '../src/errors.ts';
import type { SwarmRuntime } from '../src/runtime.ts';
import type { AppendGoalInput, AppendGoalReceipt, Run, RunPhase, RunSpec } from '../src/types.ts';
import type { GitWorkspace } from '../src/workspace.ts';

/** Real Host services must satisfy the narrow command context. */
interface RealCommandServices {
  commands: CommandRuntime;
  workingDirectory: WorkingDirectoryService;
  fs: FileSystem;
  sandboxPolicy: SandboxPolicyService;
  effect: Context['effect'];
}
type RealCommandServicesFit = RealCommandServices extends SwarmCommandContext ? true : never;
const realCommandServicesFit: RealCommandServicesFit = true;
void realCommandServicesFit;

type RealRuntimeFit = SwarmRuntime extends SwarmRuntimePort ? true : never;
const realRuntimeFit: RealRuntimeFit = true;
void realRuntimeFit;

type RealWorkspaceFit = GitWorkspace extends SwarmWorkspacePort ? true : never;
const realWorkspaceFit: RealWorkspaceFit = true;
void realWorkspaceFit;

const SESSION = Session.create(SessionId('owner-1'));
const AGENT = { id: SESSION.id, session: SESSION };

const SPEC_INPUT = {
  repository: './repo',
  baseRef: 'main',
  goal: 'refactor the parser',
  acceptanceCriteria: ['tests pass'],
  workers: 2,
  budgetMinutes: 30,
  allowDirtyBaseline: false,
  verification: {
    setup: [],
    test: [{ argv: ['true'], timeoutMs: 1000 }],
  },
};

const BASE_RUN: SwarmRunView & { phase: RunPhase } = {
  id: 'run-1',
  phase: 'running',
  reason: null,
  deadline: 1_700_000_000_000,
  baseCommit: 'base-sha',
  acceptedHead: 'accepted-sha',
  resultRef: 'refs/heads/swarm-run-1-result',
  allowDirtyBaseline: false,
};

const BASE_STATUS: SwarmRunStatusView = {
  runId: 'run-1',
  ownerSessionId: 'owner-1',
  phase: 'running',
  reason: null,
  deadline: 1_700_000_000_000,
  now: 1_699_999_000_000,
  budgetExpired: false,
  baseCommit: 'base-sha',
  acceptedHead: 'accepted-sha',
  resultRef: 'refs/heads/swarm-run-1-result',
  tasks: { open: 1, claimed: 1, proposed: 0, done: 0, blocked: 0, cancelled: 0, total: 2 },
  workers: [
    {
      id: 'w1',
      sessionId: 's1',
      initializationState: 'ready',
      nativeStatus: 'running',
      currentTaskId: 'task-1',
    },
  ],
  proposals: { queued: 0, integrating: 0, accepted: 0, rejected: 0 },
  verifications: { queued: 0, running: 0, passed: 0, failed: 0, interrupted: 0 },
  admission: 'open',
  diagnostics: ['started'],
  details: {
    eventCount: 12,
    lastEventSeq: 12,
    inFlightOperations: 1,
    messageCount: 2,
    mutationReceiptCount: 1,
    integrationAttempts: [],
    proposals: [],
    verifications: [],
  },
};

class FakeContext implements SwarmCommandContext {
  cwd = '/tmp/work';
  mode = 'workspace-write';
  specText: string = JSON.stringify(SPEC_INPUT);
  readonly definitions: SwarmCommandDefinition[] = [];
  readonly registrationDisposers: Array<() => void> = [];
  readonly effectBodies: Array<() => () => void> = [];
  readonly resolveCalls: Array<{ path: string; cwd: string | undefined; signal: AbortSignal | undefined }> = [];
  readonly readTargets: string[] = [];
  readonly policySessions: Session[] = [];
  readonly workingSessionGets: Session[] = [];

  readonly commands = {
    register: (definition: SwarmCommandDefinition): (() => void) => {
      this.definitions.push(definition);
      const disposer = vi.fn();
      this.registrationDisposers.push(disposer);
      return disposer;
    },
  };

  readonly workingDirectory = {
    get: (session: Session): string => {
      this.workingSessionGets.push(session);
      return this.cwd;
    },
  };

  readonly fs = {
    resolve: async (
      filePath: string,
      opts?: { cwd?: string; signal?: AbortSignal },
    ): Promise<SwarmFsTarget> => {
      this.resolveCalls.push({ path: filePath, cwd: opts?.cwd, signal: opts?.signal });
      return { displayPath: `${this.cwd}/${filePath}` };
    },
    readText: async (target: SwarmFsTarget, _signal?: AbortSignal): Promise<string> => {
      this.readTargets.push(target.displayPath);
      return this.specText;
    },
  };

  readonly sandboxPolicy = {
    resolve: (request: { session: Session }): { readonly mode: string } => {
      this.policySessions.push(request.session);
      return { mode: this.mode };
    },
  };

  readonly effect = (setup: () => () => void): unknown => {
    this.effectBodies.push(setup);
    return () => undefined;
  };
}

class FakeRuntime implements SwarmRuntimePort {
  readonly startCalls: Array<{ ownerSessionId: string; spec: RunSpec }> = [];
  readonly statusCalls: Array<{ ownerSessionId: string; details: boolean }> = [];
  readonly pauseCalls: string[] = [];
  readonly resumeCalls: Array<{ ownerSessionId: string; budgetMinutes: number | undefined }> = [];
  readonly stopCalls: string[] = [];
  readonly appendCalls: Array<{ ownerSessionId: string; input: AppendGoalInput; callId: string }> = [];
  readonly continueCalls: string[] = [];
  disposition: AppendGoalReceipt['disposition'] = 'executing';

  async appendGoal(ownerSessionId: string, input: AppendGoalInput, callId: string): Promise<AppendGoalReceipt> {
    this.appendCalls.push({ ownerSessionId, input, callId });
    if (this.failure !== undefined) throw this.failure;
    return {
      runId: 'run-1', phase: this.run.phase, goalRevision: 2, disposition: this.disposition,
      goal: { id: 'goal-2', seq: 2, text: input.text, acceptanceCriteria: input.acceptanceCriteria ?? [input.text],
        status: this.disposition === 'deferred' ? 'deferred' : 'active', createdAt: 1,
        completedAt: null, completedCommit: null, continuedInRunId: null },
    };
  }

  async continueGoals(ownerSessionId: string): Promise<SwarmRunView> {
    this.continueCalls.push(ownerSessionId);
    if (this.failure !== undefined) throw this.failure;
    return { ...this.run, id: 'run-2', phase: 'running' };
  }
  readonly controlCalls: Array<{
    runId: string;
    ownerSessionId: string;
    input: {
      taskId: string;
      expectedRevision: number;
      action: 'release' | 'cancel';
      reason: string;
    };
  }> = [];

  run: SwarmRunView & { phase: RunPhase } = { ...BASE_RUN };
  statusView: SwarmRunStatusView = structuredClone(BASE_STATUS);
  failure: unknown;

  readonly collaboration = {
    controlTask: async (
      runId: string,
      ownerSessionId: string,
      input: {
        taskId: string;
        expectedRevision: number;
        action: 'release' | 'cancel';
        reason: string;
      },
    ) => {
      this.controlCalls.push({ runId, ownerSessionId, input });
      return {
        id: input.taskId,
        status: input.action === 'cancel' ? 'cancelled' : 'open',
        revision: input.expectedRevision + 1,
      };
    },
  };

  async start(ownerSessionId: string, spec: RunSpec): Promise<SwarmRunView> {
    this.startCalls.push({ ownerSessionId, spec });
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return { ...this.run };
  }

  status(ownerSessionId: string, details = false): SwarmRunStatusView {
    this.statusCalls.push({ ownerSessionId, details });
    return this.statusView;
  }

  async pause(ownerSessionId: string): Promise<SwarmRunView> {
    this.pauseCalls.push(ownerSessionId);
    return { ...this.run, phase: 'paused', reason: 'user_pause' };
  }

  async resume(ownerSessionId: string, budgetMinutes?: number): Promise<SwarmRunView> {
    this.resumeCalls.push({ ownerSessionId, budgetMinutes });
    return { ...this.run, phase: 'running', reason: null };
  }

  async stop(ownerSessionId: string): Promise<SwarmRunView> {
    this.stopCalls.push(ownerSessionId);
    return { ...this.run, phase: 'quiescing', reason: 'user_stop' };
  }
}

class FakeWorkspace implements SwarmWorkspacePort {
  async resultHead(_run: Run, _signal?: AbortSignal): Promise<string> {
    throw new Error('resultHead must not be called by the command layer yet');
  }
}

function invocation(rawInput: string, signal: AbortSignal = new AbortController().signal): SwarmCommandInvocation {
  return { agent: AGENT, rawInput, signal };
}

interface CommandHarness {
  ctx: FakeContext;
  runtime: FakeRuntime;
  result: Awaited<ReturnType<SwarmCommandDefinition['handler']>>;
}

async function runCommand(
  rawInput: string,
  options: { ctx?: FakeContext; runtime?: FakeRuntime; signal?: AbortSignal } = {},
): Promise<CommandHarness> {
  const ctx = options.ctx ?? new FakeContext();
  const runtime = options.runtime ?? new FakeRuntime();
  registerSwarmCommand(ctx, runtime, new FakeWorkspace());
  const definition = ctx.definitions[0];
  if (definition === undefined) {
    throw new Error('swarm command was not registered');
  }
  const result = await definition.handler(invocation(rawInput, options.signal));
  return { ctx, runtime, result };
}

function parseError(input: string): SwarmError {
  try {
    parseSwarmCommand(input);
  } catch (error) {
    expect(error).toBeInstanceOf(SwarmError);
    return error as SwarmError;
  }
  throw new Error(`expected parse failure for ${JSON.stringify(input)}`);
}

describe('parseSwarmCommand', () => {
  it('parses every fixed subcommand', () => {
    expect(parseSwarmCommand('start --spec "/tmp/with space/run.json"')).toEqual({
      kind: 'start',
      specPath: '/tmp/with space/run.json',
    });
    expect(parseSwarmCommand("start --spec '/tmp/run.json'")).toEqual({
      kind: 'start',
      specPath: '/tmp/run.json',
    });
    expect(parseSwarmCommand('status')).toEqual({ kind: 'status', details: false });
    expect(parseSwarmCommand('status --details')).toEqual({ kind: 'status', details: true });
    expect(parseSwarmCommand('pause')).toEqual({ kind: 'pause' });
    expect(parseSwarmCommand('resume')).toEqual({ kind: 'resume' });
    expect(parseSwarmCommand('resume --budget 30m')).toEqual({ kind: 'resume', budgetMinutes: 30 });
    expect(parseSwarmCommand('resume --budget 1h')).toEqual({ kind: 'resume', budgetMinutes: 60 });
    expect(parseSwarmCommand('stop')).toEqual({ kind: 'stop' });
    expect(
      parseSwarmCommand('task cancel task-7 --revision 2 --reason "duplicate work"'),
    ).toEqual({
      kind: 'task',
      action: 'cancel',
      taskId: 'task-7',
      revision: 2,
      reason: 'duplicate work',
    });
  });

  it('allows leading whitespace and quoted paths with spaces', () => {
    expect(parseSwarmCommand('   start --spec "a b/c d.json"  ')).toEqual({
      kind: 'start',
      specPath: 'a b/c d.json',
    });
  });

  it('rejects unknown options, extra items, missing values and invalid numbers', () => {
    const cases: Array<[string, string]> = [
      ['', 'missing subcommand'],
      ['bogus', 'unknown subcommand'],
      ['start', 'missing --spec'],
      ['start --spec', 'missing value for --spec'],
      ['start --repo x', 'expected --spec'],
      ['start --spec x --extra', 'unexpected argument'],
      ['status --detail', 'unexpected argument'],
      ['status --details extra', 'unexpected argument'],
      ['pause now', 'unexpected argument'],
      ['resume --budget', 'missing value for --budget'],
      ['resume --budget 0m', 'positive duration'],
      ['resume --budget 30', 'positive duration'],
      ['resume --budget 1d', 'positive duration'],
      ['task cancel t1 --revision 0 --reason x', 'positive integer'],
      ['task cancel t1 --reason x', 'requires --revision'],
      ['task cancel t1 --revision 1', 'requires --reason'],
      ['task cancel t1 --revision 1 --reason ""', 'non-empty --reason'],
      ['task cancel t1 --revision 1 --reason x --bogus y', 'unknown option'],
      ['task close t1 --revision 1 --reason x', 'release or cancel'],
      ['start --spec "unterminated', 'unterminated quoted argument'],
    ];
    for (const [input, fragment] of cases) {
      const error = parseError(input);
      expect(error.code).toBe('SWARM_INVALID_INPUT');
      expect(error.message).toContain(fragment);
    }
  });

  it('converts durations to whole minutes', () => {
    expect(parseBudgetDuration('45m')).toBe(45);
    expect(parseBudgetDuration('2H')).toBe(120);
  });
});

describe('registerSwarmCommand', () => {
  it('registers the human command and ties its disposer to the context effect', () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    const disposer = registerSwarmCommand(ctx, runtime, new FakeWorkspace());

    expect(ctx.definitions).toHaveLength(1);
    expect(ctx.definitions[0]?.name).toBe('swarm');
    expect(ctx.definitions[0]?.description.length).toBeGreaterThan(0);
    expect(ctx.effectBodies).toHaveLength(1);
    expect(ctx.effectBodies[0]?.()).toBe(disposer);
    expect(ctx.registrationDisposers).toContain(disposer);
  });
});

describe('start', () => {
  it('resolves a relative spec path against the session cwd and starts the run', async () => {
    const { ctx, runtime, result } = await runCommand('start --spec "specs/run spec.json"');

    expect(ctx.workingSessionGets).toEqual([SESSION]);
    expect(ctx.resolveCalls[0]).toEqual({
      path: 'specs/run spec.json',
      cwd: '/tmp/work',
      signal: expect.any(AbortSignal),
    });
    expect(runtime.startCalls).toHaveLength(1);
    expect(runtime.startCalls[0]?.ownerSessionId).toBe('owner-1');
    expect(runtime.startCalls[0]?.spec.specPath).toBe('/tmp/work/specs/run spec.json');
    expect(runtime.startCalls[0]?.spec.repository).toBe('/tmp/work/specs/repo');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.text).toContain('run id: run-1');
      expect(result.text).toContain('base sha: base-sha');
      expect(result.text).toContain('result branch: refs/heads/swarm-run-1-result');
      expect(result.text).toContain('deadline: 2023-11-14T');
      expect(result.text).not.toContain('uncommitted changes are not included');
    }
  });

  it('states explicitly that a dirty baseline is not included when allowed', async () => {
    const runtime = new FakeRuntime();
    runtime.run = { ...BASE_RUN, allowDirtyBaseline: true };
    const { result } = await runCommand('start --spec run.json', { runtime });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.text).toContain('uncommitted changes are not included in this run');
    }
  });

  it('rejects read-only sessions before reading the spec or starting a run', async () => {
    const ctx = new FakeContext();
    ctx.mode = 'read-only';
    const { runtime, result } = await runCommand('start --spec run.json', { ctx });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.text).toContain('SWARM_FORBIDDEN');
      expect(result.text).toContain('read-only');
    }
    expect(ctx.resolveCalls).toHaveLength(0);
    expect(runtime.startCalls).toHaveLength(0);
  });

  it('does not start a run when the command signal was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { runtime, result } = await runCommand('start --spec run.json', {
      signal: controller.signal,
    });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.text).toContain('no swarm run was started');
    }
    expect(runtime.startCalls).toHaveLength(0);
  });

  it('surfaces invalid JSON as a spec error', async () => {
    const ctx = new FakeContext();
    ctx.specText = '{ not json';
    const { result } = await runCommand('start --spec run.json', { ctx });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.text).toContain('SWARM_INVALID_SPEC');
      expect(result.text).toContain('/tmp/work/run.json');
    }
  });

  it('keeps SwarmError codes and surfaces unknown failures', async () => {
    const runtime = new FakeRuntime();
    runtime.failure = new SwarmError('SWARM_STALE_REVISION', 'task revision is 4');
    const stale = await runCommand('start --spec run.json', { runtime });
    expect(stale.result).toEqual({
      kind: 'error',
      text: 'SWARM_STALE_REVISION: task revision is 4',
    });

    const unknownRuntime = new FakeRuntime();
    unknownRuntime.failure = new Error('disk gone');
    const unknown = await runCommand('start --spec run.json', { runtime: unknownRuntime });
    expect(unknown.result.kind).toBe('error');
    if (unknown.result.kind === 'error') {
      expect(unknown.result.text).toContain('SWARM_INTERNAL');
      expect(unknown.result.text).toContain('disk gone');
    }
  });
});

describe('append and continue', () => {
  it('preserves arbitrary prose and accepts structured goals without shell tokenization', () => {
    const goal = `Don't remove "existing" goals\n也支持换行 \\ path`;
    expect(parseSwarmCommand(`append ${goal}`)).toEqual({ kind: 'append', input: { text: goal }, json: false });
    expect(parseSwarmCommand(`append --json ${JSON.stringify({ goal, acceptanceCriteria: ['保留历史'] })}`)).toEqual({
      kind: 'append', input: { text: goal, acceptanceCriteria: ['保留历史'] }, json: true,
    });
    expect(parseSwarmCommand('continue')).toEqual({ kind: 'continue' });
    for (const invalid of ['append', 'append   ', 'append --json', 'append --json {', 'append --json {"goal":" "}', 'append --json {"goal":"x","acceptanceCriteria":[]}', 'append --json {"goal":"x","ownerSessionId":"forged"}', 'continue now']) {
      expect(() => parseSwarmCommand(invalid)).toThrow();
    }
  });

  it('routes panel JSON to the same owner Host operation with a bounded receipt', async () => {
    const { runtime, ctx, result } = await runCommand('append --json {"goal":"new feature","acceptanceCriteria":["works"]}');
    expect(runtime.appendCalls).toEqual([{ ownerSessionId: 'owner-1', input: { text: 'new feature', acceptanceCriteria: ['works'] }, callId: expect.any(String) }]);
    expect(ctx.resolveCalls).toEqual([]);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') expect(JSON.parse(result.text ?? '')).toEqual({ runId: 'run-1', goalId: 'goal-2', phase: 'running', goalRevision: 2, disposition: 'executing' });
  });

  it.each(['paused', 'deferred'] as const)('shows %s without silently waking or continuing', async (disposition) => {
    const runtime = new FakeRuntime();
    runtime.disposition = disposition;
    const { result } = await runCommand('append next change', { runtime });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') expect(result.text).toContain(disposition === 'paused' ? 'still paused' : 'not executing');
    expect(runtime.resumeCalls).toEqual([]);
    expect(runtime.continueCalls).toEqual([]);
  });

  it.each(['append next', 'continue'])('refuses read-only, cancelled and delegated %s calls before the Host', async (command) => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    ctx.mode = 'read-only';
    expect((await runCommand(command, { ctx, runtime })).result.kind).toBe('error');
    ctx.mode = 'workspace-write';
    const controller = new AbortController();
    controller.abort();
    expect((await runCommand(command, { ctx, runtime, signal: controller.signal })).result.kind).toBe('error');
    const workerSession = Session.create(SessionId('worker'), undefined, {
      version: SESSION_FORMAT_VERSION, id: SessionId('worker'), createdAt: 0, isSeeded: false, origin: 'subagent', delegationDepth: 1,
    });
    const result = await ctx.definitions[0]?.handler({ ...invocation(command), agent: { id: workerSession.id, session: workerSession } });
    expect(result).toMatchObject({ kind: 'error', text: expect.stringContaining('SWARM_FORBIDDEN') });
    expect(runtime.appendCalls).toEqual([]);
    expect(runtime.continueCalls).toEqual([]);
  });

  it('continues explicitly and never turns Host rejection into success', async () => {
    const runtime = new FakeRuntime();
    const continued = await runCommand('continue', { runtime });
    expect(runtime.continueCalls).toEqual(['owner-1']);
    expect(continued.result).toMatchObject({ kind: 'success', text: expect.stringContaining('run id: run-2') });
    runtime.failure = new SwarmError('SWARM_INVALID_STATE', 'cleanup in progress');
    for (const command of ['continue', 'append next']) {
      expect((await runCommand(command, { runtime })).result).toEqual({ kind: 'error', text: 'SWARM_INVALID_STATE: cleanup in progress' });
    }
  });
});

describe('status', () => {
  it('reports status without starting a model or a run', async () => {
    const { runtime, result } = await runCommand('status --details');

    expect(runtime.startCalls).toHaveLength(0);
    expect(runtime.statusCalls).toEqual([{ ownerSessionId: 'owner-1', details: true }]);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.text).toContain('phase=running');
      expect(result.text).toContain('tasks: total=2');
      expect(result.text).toContain('events=12');
      expect(result.text).toContain('result check: unverified');
    }
  });

  it('shows active, completed and deferred goal counts in status', async () => {
    const runtime = new FakeRuntime();
    runtime.statusView = { ...BASE_STATUS, goalRevision: 2, goals: { total: 3, active: 1, completed: 1, deferred: 1 } };
    const { result } = await runCommand('status', { runtime });
    expect(result).toMatchObject({ kind: 'success', text: expect.stringContaining('active=1 deferred=1 completed=1') });
    expect(result).toMatchObject({ text: expect.stringContaining('saved, not executing') });
  });

  it('omits details for a plain status request', async () => {
    const { runtime, result } = await runCommand('status');

    expect(runtime.statusCalls).toEqual([{ ownerSessionId: 'owner-1', details: false }]);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.text).not.toContain('result check:');
    }
  });
});

describe('pause, resume and stop', () => {
  it('forwards the budget duration to resume', async () => {
    const { runtime, result } = await runCommand('resume --budget 1h');

    expect(runtime.resumeCalls).toEqual([{ ownerSessionId: 'owner-1', budgetMinutes: 60 }]);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.text).toContain('resume run run-1');
    }
  });

  it('resumes without a budget when none is given', async () => {
    const { runtime } = await runCommand('resume');

    expect(runtime.resumeCalls).toEqual([{ ownerSessionId: 'owner-1', budgetMinutes: undefined }]);
  });

  it('pauses and stops the owner run, reporting the real phase', async () => {
    const paused = await runCommand('pause');
    expect(paused.runtime.pauseCalls).toEqual(['owner-1']);
    expect(paused.result.kind).toBe('success');
    if (paused.result.kind === 'success') {
      expect(paused.result.text).toContain('phase=paused');
    }

    const stopped = await runCommand('stop');
    expect(stopped.runtime.stopCalls).toEqual(['owner-1']);
    expect(stopped.result.kind).toBe('success');
    if (stopped.result.kind === 'success') {
      expect(stopped.result.text).toContain('phase=quiescing');
    }
  });
});

describe('task control', () => {
  it('uses the status run id and the real owner id for a CAS release', async () => {
    const { runtime, result } = await runCommand(
      'task release task-3 --revision 2 --reason "handing back"',
    );

    expect(runtime.statusCalls).toEqual([{ ownerSessionId: 'owner-1', details: false }]);
    expect(runtime.controlCalls).toEqual([
      {
        runId: 'run-1',
        ownerSessionId: 'owner-1',
        input: {
          taskId: 'task-3',
          expectedRevision: 2,
          action: 'release',
          reason: 'handing back',
        },
      },
    ]);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.text).toContain('task task-3 release applied');
      expect(result.text).toContain('revision=3');
    }
  });
});