/**
 * `swarm_manage` owner tool tests.
 *
 * Narrow hand-written Host and runtime fakes only: no real Cordis Context,
 * workspace, sandbox or model. The tests pin the ownership rules (identity
 * from the agent session, no subagent recursion), explicit-spec handling and
 * bounded projections.
 */

import { describe, expect, it, vi } from 'vitest';

import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session';
import { assertObjectJsonSchema, type ToolDefinition, type ToolRuntime } from '@deepseek-ai/dsh-tools';

import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy';
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory';
import type { SwarmRuntime } from '../src/runtime.ts';

import type { SwarmRunStatusView, SwarmRunView } from '../src/commands.ts';
import {
  handleSwarmManage,
  parseManageInput,
  registerOwnerTools,
  SWARM_MANAGE_DESCRIPTION,
  type SwarmManageInput,
  type SwarmOwnerAgent,
  type SwarmOwnerInvocation,
  type SwarmOwnerRuntimePort,
  type SwarmOwnerToolContext,
} from '../src/owner-tools.ts';
import type { AddWorkerReceipt, AppendGoalInput, AppendGoalReceipt, RunPhase, RunSpec } from '../src/types.ts';
import { SwarmError } from '../src/errors.ts';

/** The real Host services must satisfy the narrow owner-tool context. */
interface RealOwnerServices {
  tools: ToolRuntime;
  workingDirectory: WorkingDirectoryService;
  fs: FileSystem;
  sandboxPolicy: SandboxPolicyService;
  effect: Context['effect'];
}
type RealOwnerServicesFit = RealOwnerServices extends SwarmOwnerToolContext ? true : never;
const realOwnerServicesFit: RealOwnerServicesFit = true;
void realOwnerServicesFit;

type RealRuntimeFit = SwarmRuntime extends SwarmOwnerRuntimePort ? true : never;
const realRuntimeFit: RealRuntimeFit = true;
void realRuntimeFit;

const OWNER_SESSION = Session.create(SessionId('owner-1'));
const OWNER_AGENT: SwarmOwnerAgent = { id: OWNER_SESSION.id, session: OWNER_SESSION };

/** A delegated child session: `swarm_manage` must refuse it. */
const SUBAGENT_SESSION = Session.create(SessionId('worker-1'), undefined, {
  version: SESSION_FORMAT_VERSION,
  id: SessionId('worker-1'),
  createdAt: 0,
  isSeeded: false,
  origin: 'subagent',
  delegationDepth: 1,
});
const SUBAGENT_AGENT: SwarmOwnerAgent = { id: SUBAGENT_SESSION.id, session: SUBAGENT_SESSION };

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

class FakeContext implements SwarmOwnerToolContext {
  cwd = '/tmp/work';
  mode = 'workspace-write';
  specText: string = JSON.stringify(SPEC_INPUT);
  readonly definitions: ToolDefinition[] = [];
  readonly registrationDisposers: Array<() => void> = [];
  readonly effectBodies: Array<() => () => void> = [];
  readonly resolveCalls: Array<{ path: string; cwd: string | undefined; signal: AbortSignal | undefined }> = [];
  readonly readTargets: string[] = [];
  readonly policySessions: Session[] = [];
  readonly workingSessionGets: Session[] = [];

  readonly tools = {
    register: (definition: ToolDefinition): (() => void) => {
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
    ): Promise<{ displayPath: string }> => {
      this.resolveCalls.push({ path: filePath, cwd: opts?.cwd, signal: opts?.signal });
      return { displayPath: `${this.cwd}/${filePath}` };
    },
    readText: async (target: { displayPath: string }, _signal?: AbortSignal): Promise<string> => {
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

class FakeRuntime implements SwarmOwnerRuntimePort {
  readonly startCalls: Array<{ ownerSessionId: string; spec: RunSpec }> = [];
  readonly statusCalls: Array<{ ownerSessionId: string; details: boolean }> = [];
  readonly pauseCalls: string[] = [];
  readonly resumeCalls: Array<{ ownerSessionId: string; budgetMinutes: number | undefined }> = [];
  readonly stopCalls: string[] = [];
  readonly appendCalls: Array<{ ownerSessionId: string; input: AppendGoalInput; callId: string }> = [];
  readonly continueCalls: string[] = [];
  disposition: AppendGoalReceipt['disposition'] = 'executing';
  readonly addCalls: string[] = [];
  /** Fail the Nth addWorker call (1-based) with this error. */
  addFailure: { at: number; error: unknown } | undefined;

  async addWorker(ownerSessionId: string): Promise<AddWorkerReceipt> {
    this.addCalls.push(ownerSessionId);
    const n = this.addCalls.length;
    if (this.addFailure && n >= this.addFailure.at) throw this.addFailure.error;
    return { runId: 'run-1', workerId: 'w' + (n + 2), displayName: 'Worker ' + (n + 2), phase: 'running', disposition: 'started' };
  }

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

  run: SwarmRunView & { phase: RunPhase } = { ...BASE_RUN };
  statusView: SwarmRunStatusView = structuredClone(BASE_STATUS);
  failure: unknown;

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

function invocation(
  agent: SwarmOwnerAgent = OWNER_AGENT,
  signal: AbortSignal = new AbortController().signal,
): SwarmOwnerInvocation {
  return { agent, signal, callId: 'native-call-1' };
}

async function call(
  ctx: FakeContext,
  runtime: FakeRuntime,
  input: Record<string, unknown>,
  agent: SwarmOwnerAgent = OWNER_AGENT,
  signal: AbortSignal = new AbortController().signal,
): Promise<ReturnType<typeof handleSwarmManage>> {
  const parsed: SwarmManageInput = parseManageInput(input);
  return handleSwarmManage(ctx, runtime, invocation(agent, signal), parsed);
}

describe('parseManageInput', () => {
  it('accepts every action and rejects unknown actions or extra fields', () => {
    for (const action of ['start', 'status', 'pause', 'resume', 'stop', 'append', 'continue', 'add_workers'] as const) {
      expect(parseManageInput({ action }).action).toBe(action);
    }
    expect(parseManageInput({ action: 'resume', budget_minutes: 5 }).budget_minutes).toBe(5);
    expect(() => parseManageInput({ action: 'restart' })).toThrowError(/SWARM_INVALID_INPUT|invalid/);
    expect(() => parseManageInput({ action: 'status', ownerSessionId: 'forged' })).toThrow();
    expect(() => parseManageInput({})).toThrow();
  });
});

describe('registerOwnerTools', () => {
  it('registers one swarm_manage tool whose schema requires an explicit action', () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    const dispose = registerOwnerTools(ctx, runtime);

    expect(ctx.definitions).toHaveLength(1);
    const definition = ctx.definitions[0];
    expect(definition?.name).toBe('swarm_manage');
    expect(definition?.description).toBe(SWARM_MANAGE_DESCRIPTION);
    expect(definition?.parameters).toMatchObject({
      type: 'object',
      required: ['action'],
      additionalProperties: false,
    });
    const action = (definition?.parameters.properties as Record<string, { enum?: string[] }>)['action'];
    expect(action?.enum).toEqual(['start', 'status', 'pause', 'resume', 'stop', 'append', 'continue', 'add_workers']);
    // Agents should find the start path from the tool description alone.
    expect(definition?.description).toContain('action=start');
    expect(definition?.description).toContain('only way to start');
    const schemaText = JSON.stringify(definition?.parameters);
    expect(schemaText).not.toContain('2–4');
    expect(schemaText).toContain('current effective team limit');
    expect(schemaText).toContain('batch bound is not the team limit');
    // The Host accepts only its documented JSON Schema subset.
    expect(() => {
      if (definition !== undefined) assertObjectJsonSchema(definition.parameters);
    }).not.toThrow();
    expect(() => {
      if (definition !== undefined) assertObjectJsonSchema(definition.output.schema);
    }).not.toThrow();

    // The disposer is context-scoped as well as returned.
    expect(ctx.effectBodies).toHaveLength(1);
    const effectDisposer = ctx.effectBodies[0]?.();
    expect(effectDisposer).toBe(ctx.registrationDisposers[0]);
    dispose();
    expect(ctx.registrationDisposers[0]).toHaveBeenCalled();
  });

  it('renders a JSON text block for the canonical result', () => {
    const ctx = new FakeContext();
    registerOwnerTools(ctx, new FakeRuntime());
    const definition = ctx.definitions[0];
    const blocks = definition?.output.render({}, { action: 'status' });
    expect(blocks).toEqual([{ type: 'text', text: '{"action":"status"}' }]);
  });
});

describe('handleSwarmManage ownership', () => {
  it('takes the owner identity from the agent session', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    await call(ctx, runtime, { action: 'status' });
    expect(runtime.statusCalls).toEqual([{ ownerSessionId: 'owner-1', details: false }]);
  });

  it('refuses a subagent session before touching the runtime', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    await expect(
      call(ctx, runtime, { action: 'start', spec: SPEC_INPUT }, SUBAGENT_AGENT),
    ).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    await expect(
      call(ctx, runtime, { action: 'status' }, SUBAGENT_AGENT),
    ).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    expect(runtime.startCalls).toEqual([]);
    expect(runtime.statusCalls).toEqual([]);
  });

  it('refuses a status view owned by another session', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    runtime.statusView = { ...BASE_STATUS, ownerSessionId: 'someone-else' };
    await expect(call(ctx, runtime, { action: 'status' })).rejects.toMatchObject({
      code: 'SWARM_FORBIDDEN',
    });
  });
});

describe('handleSwarmManage start', () => {
  it('loads a configured spec path relative to the session cwd', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    const signal = new AbortController().signal;

    const result = await call(ctx, runtime, { action: 'start', spec_path: 'swarm.json' }, OWNER_AGENT, signal);

    expect(ctx.resolveCalls).toEqual([{ path: 'swarm.json', cwd: '/tmp/work', signal }]);
    expect(runtime.startCalls).toHaveLength(1);
    const started = runtime.startCalls[0];
    expect(started?.ownerSessionId).toBe('owner-1');
    expect(started?.spec.repository).toBe('/tmp/work/repo');
    expect(started?.spec.specPath).toBe('/tmp/work/swarm.json');
    expect(started?.spec.verification.test).toEqual([{ argv: ['true'], timeoutMs: 1000 }]);
    expect(result).toMatchObject({ action: 'start', runId: 'run-1', specPath: '/tmp/work/swarm.json' });
  });

  it('accepts an inline spec and resolves its repository against the cwd', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();

    const result = await call(ctx, runtime, { action: 'start', spec: SPEC_INPUT });

    expect(ctx.resolveCalls).toEqual([]);
    const started = runtime.startCalls[0];
    expect(started?.spec.repository).toBe('/tmp/work/repo');
    expect(started?.spec.specPath).toBe('/tmp/work/swarm-inline.json');
    expect(started?.spec.workers).toBe(2);
    expect(result).toMatchObject({ action: 'start', phase: 'running' });
    expect(result).not.toHaveProperty('messages');
  });

  it('passes team counts above four to the authoritative Host for inline and file specs', async () => {
    for (const workers of [5, 8, 12]) {
      const ctx = new FakeContext();
      ctx.specText = JSON.stringify({ ...SPEC_INPUT, workers });
      const runtime = new FakeRuntime();
      await call(ctx, runtime, { action: 'start', spec: { ...SPEC_INPUT, workers } });
      await call(ctx, runtime, { action: 'start', spec_path: 'swarm.json' });
      expect(runtime.startCalls.map((entry) => entry.spec.workers)).toEqual([workers, workers]);
    }
  });

  it('requires exactly one spec source', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    await expect(
      call(ctx, runtime, { action: 'start' }),
    ).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });
    await expect(
      call(ctx, runtime, { action: 'start', spec_path: 'swarm.json', spec: SPEC_INPUT }),
    ).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });
    expect(runtime.startCalls).toEqual([]);
  });

  it('rejects a read-only session before reading the spec', async () => {
    const ctx = new FakeContext();
    ctx.mode = 'read-only';
    const runtime = new FakeRuntime();
    await expect(
      call(ctx, runtime, { action: 'start', spec_path: 'swarm.json' }),
    ).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    expect(ctx.resolveCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
  });

  it('rejects an invalid configured spec without starting a run', async () => {
    const ctx = new FakeContext();
    ctx.specText = JSON.stringify({ ...SPEC_INPUT, workers: 1 });
    const runtime = new FakeRuntime();
    await expect(
      call(ctx, runtime, { action: 'start', spec_path: 'swarm.json' }),
    ).rejects.toMatchObject({ code: 'SWARM_INVALID_SPEC' });
    expect(runtime.startCalls).toEqual([]);
  });

  it('rejects non-JSON spec files', async () => {
    const ctx = new FakeContext();
    ctx.specText = 'not json';
    const runtime = new FakeRuntime();
    await expect(
      call(ctx, runtime, { action: 'start', spec_path: 'swarm.json' }),
    ).rejects.toMatchObject({ code: 'SWARM_INVALID_SPEC' });
  });

  it('does not start when the call was cancelled', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    const controller = new AbortController();
    controller.abort();
    await expect(
      call(ctx, runtime, { action: 'start', spec: SPEC_INPUT }, OWNER_AGENT, controller.signal),
    ).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    expect(runtime.startCalls).toEqual([]);
  });
});

describe('handleSwarmManage append and continue', () => {
  it('passes the real owner and native call id without reading or rewriting a spec', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    const result = await call(ctx, runtime, { action: 'append', goal: '追加 "icon"', acceptance_criteria: ['中英主题可见'] });
    expect(runtime.appendCalls).toEqual([{ ownerSessionId: 'owner-1', input: { text: '追加 "icon"', acceptanceCriteria: ['中英主题可见'] }, callId: 'native-call-1' }]);
    expect(result).toMatchObject({ action: 'append', disposition: 'executing', goalRevision: 2, goal: { id: 'goal-2' } });
    expect(ctx.resolveCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
  });

  it.each(['paused', 'deferred'] as const)('preserves the %s receipt without implicitly resuming', async (disposition) => {
    const runtime = new FakeRuntime();
    runtime.disposition = disposition;
    expect(await call(new FakeContext(), runtime, { action: 'append', goal: 'next change' })).toMatchObject({ disposition });
    expect(runtime.resumeCalls).toEqual([]);
    expect(runtime.continueCalls).toEqual([]);
  });

  it('rejects missing goals, blank requirements and spoofed owner/call identity', async () => {
    const runtime = new FakeRuntime();
    await expect(call(new FakeContext(), runtime, { action: 'append' })).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });
    for (const extra of [{ goal: ' ' }, { goal: 'x', acceptance_criteria: [] }, { goal: 'x', acceptance_criteria: [' '] }, { goal: 'x', callId: 'forged' }, { goal: 'x', ownerSessionId: 'forged' }]) {
      expect(() => parseManageInput({ action: 'append', ...extra })).toThrow();
    }
    expect(runtime.appendCalls).toEqual([]);
  });

  it.each(['append', 'continue'] as const)('refuses worker, read-only and cancelled %s calls before mutation', async (action) => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    const input = { action, goal: 'next change' };
    await expect(call(ctx, runtime, input, SUBAGENT_AGENT)).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    ctx.mode = 'read-only';
    await expect(call(ctx, runtime, input)).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    ctx.mode = 'workspace-write';
    const controller = new AbortController();
    controller.abort();
    await expect(call(ctx, runtime, input, OWNER_AGENT, controller.signal)).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    expect(runtime.appendCalls).toEqual([]);
    expect(runtime.continueCalls).toEqual([]);
  });

  it('uses explicit continue for a new round and preserves Host rejections', async () => {
    const runtime = new FakeRuntime();
    expect(await call(new FakeContext(), runtime, { action: 'continue' })).toMatchObject({ action: 'continue', runId: 'run-2' });
    expect(runtime.continueCalls).toEqual(['owner-1']);
    runtime.failure = new SwarmError('SWARM_INVALID_STATE', 'wait for resource cleanup');
    await expect(call(new FakeContext(), runtime, { action: 'continue' })).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    await expect(call(new FakeContext(), runtime, { action: 'append', goal: 'next' })).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
  });
});

describe('handleSwarmManage status and controls', () => {
  it('forwards details for status and returns the bounded projection', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    const status = await call(ctx, runtime, { action: 'status', details: true });
    expect(runtime.statusCalls).toEqual([{ ownerSessionId: 'owner-1', details: true }]);
    expect(status).toMatchObject({
      runId: 'run-1',
      tasks: { total: 2 },
      workers: [{ id: 'w1', nativeStatus: 'running' }],
    });
    expect(JSON.stringify(status)).not.toContain('body');
  });

  it('pauses, resumes with an added budget, and stops', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();

    expect(await call(ctx, runtime, { action: 'pause' })).toMatchObject({ action: 'pause', phase: 'paused' });
    expect(await call(ctx, runtime, { action: 'resume', budget_minutes: 15 })).toMatchObject({
      action: 'resume',
      phase: 'running',
    });
    expect(await call(ctx, runtime, { action: 'stop' })).toMatchObject({ action: 'stop', phase: 'quiescing' });

    expect(runtime.pauseCalls).toEqual(['owner-1']);
    expect(runtime.resumeCalls).toEqual([{ ownerSessionId: 'owner-1', budgetMinutes: 15 }]);
    expect(runtime.stopCalls).toEqual(['owner-1']);
  });

  it('resumes without a budget when none is given', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    await call(ctx, runtime, { action: 'resume' });
    expect(runtime.resumeCalls).toEqual([{ ownerSessionId: 'owner-1', budgetMinutes: undefined }]);
  });
});

describe('swarm_manage add_workers', () => {
  it('adds the requested members sequentially under the real owner identity', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    const result = await call(ctx, runtime, { action: 'add_workers', count: 2 }, OWNER_AGENT);
    expect(runtime.addCalls).toEqual([OWNER_AGENT.id, OWNER_AGENT.id]);
    expect(result).toMatchObject({ action: 'add_workers', requested: 2, error: null });
    expect((result as { added: unknown[] }).added).toHaveLength(2);
  });

  it('defaults to one member and rejects out-of-range counts', () => {
    expect(parseManageInput({ action: 'add_workers' }).count).toBeUndefined();
    expect(() => parseManageInput({ action: 'add_workers', count: 0 })).toThrow();
    expect(() => parseManageInput({ action: 'add_workers', count: 5 })).toThrow();
  });

  it('reports partial success instead of hiding the limit error', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    runtime.addFailure = { at: 2, error: new SwarmError('SWARM_INVALID_STATE', 'a run supports at most 4 workers') };
    const result = await call(ctx, runtime, { action: 'add_workers', count: 3 }, OWNER_AGENT);
    expect(runtime.addCalls).toHaveLength(2);
    expect(result).toMatchObject({ requested: 3, error: { code: 'SWARM_INVALID_STATE' } });
    expect((result as { added: unknown[] }).added).toHaveLength(1);
  });

  it('throws when the first addition fails and refuses subagents before any call', async () => {
    const ctx = new FakeContext();
    const runtime = new FakeRuntime();
    runtime.addFailure = { at: 1, error: new SwarmError('SWARM_NOT_RUNNING', 'cannot add a worker while run is completed') };
    await expect(call(ctx, runtime, { action: 'add_workers' }, OWNER_AGENT)).rejects.toThrow('cannot add');
    const fresh = new FakeRuntime();
    await expect(call(ctx, fresh, { action: 'add_workers' }, SUBAGENT_AGENT)).rejects.toThrow();
    expect(fresh.addCalls).toEqual([]);
  });
});
