/** Goal append lifecycle tests: real control/store/delivery/integration, fake effects only. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verificationFingerprint, type ArtifactPort, type WorkerHost, type WorkspacePort } from '../src/ports.ts';
import { SwarmRuntime } from '../src/runtime.ts';
import { parseRun } from '../src/schema.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import { createRun, type Run, type RunPhase, type WorkerRecord } from '../src/types.ts';

const OWNER = 'owner';
const RUN = 'goal-run';
const HEAD = 'a'.repeat(40);
const ORIGINAL = 'Original acceptance';
const ADDED = 'New acceptance';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

class Table implements RunTable {
  records = new Map<string, Run>();
  get(id: string) { return this.records.get(id); }
  entries() { return this.records.entries(); }
  async put(id: string, run: Run) { this.records.set(id, run); }
  async update(id: string, reducer: (run: Run) => Run) {
    const current = this.get(id);
    if (!current) throw new Error(`Missing run ${id}`);
    const next = reducer(current);
    this.records.set(id, next);
    return next;
  }
}

function worker(id: string): WorkerRecord {
  return {
    id, sessionId: `session-${id}`, branch: `swarm/${id}`, worktreePath: `/repo/${id}`,
    initializationState: 'ready', initializationError: null, unavailableReason: null,
    offeredSeq: 0, observedSeq: 0, notifiedSeq: 0, wakeTargetSeq: 0,
    waitRegistration: null, currentTaskId: null, createdAt: 1,
  };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(phase: RunPhase = 'running') {
  const table = new Table();
  const store = new MemoryStateStore(table);
  const initial = createRun({
    id: RUN, ownerSessionId: OWNER, repositoryRoot: '/repo', gitCommonDir: '/repo/.git',
    goal: 'Original goal', acceptanceCriteria: [ORIGINAL],
    verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
    baseCommit: HEAD, resultRef: 'refs/heads/swarm-goal-result', deadline: null, createdAt: 1,
  });
  initial.phase = phase;
  initial.integrationWorktree = '/repo/integration';
  initial.workers = { w1: worker('w1'), w2: worker('w2') };
  await store.create(initial);

  const verified = barrier();
  const verifyEntered = barrier();
  const stopped = barrier();
  const stopEntered = barrier();
  const inspected = barrier();
  const inspectEntered = barrier();
  let blockVerify = false;
  let blockStop = false;
  let blockInspect = false;
  const host: WorkerHost = {
    start: vi.fn(async ({ run, worker: record }) => {
      await store.update(run.id, (current) => ({
        ...current, integrationWorktree: '/repo/integration', workers: {
          ...current.workers,
          [record.id]: { ...current.workers[record.id]!, initializationState: 'ready', worktreePath: `/repo/${record.id}` },
        },
      }));
    }),
    notify: vi.fn(async () => {}),
    stop: vi.fn(async () => { stopEntered.release(); if (blockStop) await stopped.promise; }),
    isOwnerLive: () => true,
    isWorkerBusy: () => false,
    workerStatus: () => 'inactive',
    onSettled: () => () => {},
  };
  const workspace: WorkspacePort = {
    inspect: vi.fn(async (spec) => {
      inspectEntered.release();
      if (blockInspect) await inspected.promise;
      return { repositoryRoot: '/repo', gitCommonDir: '/repo/.git', baseCommit: spec.baseRef, dirty: false };
    }),
    initializeResult: vi.fn(async () => {}),
    validateSubmission: async (_run, _worker, commit) => commit,
    pinProposal: async () => {},
    buildCandidate: async () => ({ kind: 'candidate', commit: HEAD }),
    verify: vi.fn(async () => {
      verifyEntered.release();
      if (blockVerify) await verified.promise;
      return { passed: true, interrupted: false, exitCode: 0, timedOut: false, log: 'passed' };
    }),
    publish: async () => {},
    resultHead: async (run) => run.acceptedHead,
    diff: async () => '',
  };
  const artifacts: ArtifactPort = {
    save: async (_runId, name) => `artifact-${name}`,
    read: async () => 'passed',
  };
  let id = 0;
  const runtime = new SwarmRuntime(store, host, workspace, artifacts, {
    id: () => `generated-${++id}`,
    clock: { now: () => 100, setTimeout: () => { throw new Error('Unlimited runs must not arm a deadline'); } },
  });
  cleanups.push(async () => {
    verified.release(); stopped.release(); inspected.release();
    await runtime.dispose();
    await store.close();
  });
  return {
    table, store, runtime, host, workspace, initial,
    blockVerification: () => { blockVerify = true; },
    blockShutdown: () => { blockStop = true; },
    blockInspection: () => { blockInspect = true; },
    verified, verifyEntered, stopped, stopEntered, inspected, inspectEntered,
  };
}

/** Subscribe before releasing an effect barrier, rather than polling or sleeping. */
function whenPhase(store: MemoryStateStore, phase: RunPhase): Promise<Run> {
  if (store.get(RUN).phase === phase) return Promise.resolve(store.get(RUN));
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe((run) => {
      if (run.id === RUN && run.phase === phase) { unsubscribe(); resolve(run); }
    });
  });
}

function notes(...criteria: string[]) {
  return criteria.map((criterion) => ({ criterion, evidence: ['tests/feature.test.ts'] }));
}

async function seedPassedVerification(store: MemoryStateStore) {
  await store.update(RUN, (run) => ({
    ...run,
    verifications: {
      historical: {
        id: 'historical', purpose: 'finish', commit: HEAD, expectedHead: HEAD,
        sourceCommit: null, proposalId: null, attemptId: null,
        configFingerprint: verificationFingerprint(run.verification), goalRevision: run.goalRevision,
        status: 'passed', receiptRef: 'artifact-old', diagnosticsRef: null,
        exitCode: 0, timedOut: false, createdAt: 1, startedAt: 1, finishedAt: 2,
      },
    },
  }));
}

describe('append-only owner goals', () => {
  it('keeps legacy records readable without replacing their original goal', async () => {
    const { initial } = await fixture();
    const legacy: Record<string, unknown> = { ...initial };
    delete legacy['goals'];
    delete legacy['goalRevision'];
    const restored = parseRun(legacy);
    expect(restored.goal).toBe('Original goal');
    expect(restored.acceptanceCriteria).toEqual([ORIGINAL]);
    expect(restored.goals).toEqual({});
    expect(typeof restored.goalRevision).toBe('number');
  });

  it('persists active additions, deduplicates retry receipts and exposes full worker context', async () => {
    const { runtime, store, table } = await fixture();
    const input = { text: 'Add a useful feature', acceptanceCriteria: [ADDED] };
    const result = await runtime.appendGoal(OWNER, input, 'append-1');
    expect(result).toMatchObject({ runId: RUN, disposition: 'executing', phase: 'running', goal: { text: input.text, status: 'active' } });
    const replay = await runtime.appendGoal(OWNER, input, 'append-1');
    expect(replay).toEqual(result);
    const run = store.get(RUN);
    expect(Object.keys(run.goals)).toEqual([result.goal.id]);
    expect(run.goal).toBe('Original goal');
    expect(run.acceptanceCriteria).toEqual([ORIGINAL]);
    const reloaded = new MemoryStateStore(table);
    expect(reloaded.get(RUN).goals[result.goal.id]).toEqual(result.goal);
    await reloaded.close();
    const sync = await runtime.collaboration.sync('session-w1');
    expect(sync.acceptanceCriteria).toEqual([ORIGINAL, ADDED]);
    expect(JSON.stringify(sync)).toContain(input.text);
    expect(sync.events.some(({ event }) => event.kind === 'goal')).toBe(true);
    const expanded = await runtime.collaboration.read('session-w1', { id: result.goal.id });
    expect(JSON.stringify(expanded)).toContain(input.text);
  });

  it('rejects other owners, workers and empty additions without mutation', async () => {
    const { runtime, store } = await fixture();
    const before = store.get(RUN);
    await expect(runtime.appendGoal('stranger', { text: 'unauthorized' }, 'wrong-owner')).rejects.toThrow();
    await expect(runtime.appendGoal('session-w1', { text: 'unauthorized' }, 'worker')).rejects.toThrow();
    await expect(runtime.appendGoal(OWNER, { text: '   ' }, 'blank')).rejects.toThrow();
    expect(store.get(RUN)).toEqual(before);
  });

  it('saves paused additions without waking workers; explicit resume keeps the same run', async () => {
    const { runtime, store, host } = await fixture('paused');
    const result = await runtime.appendGoal(OWNER, { text: 'Work after resume' }, 'paused-add');
    expect(result).toMatchObject({ disposition: 'paused', goal: { status: 'active' } });
    expect(store.get(RUN).phase).toBe('paused');
    expect(host.notify).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
    const resumed = await runtime.resume(OWNER);
    expect(resumed.id).toBe(RUN);
    expect(resumed.goals[result.goal.id]?.status).toBe('active');
    expect(resumed.deadline).toBeNull();
  });

  it('activates goals saved during pause shutdown only after an explicit resume', async () => {
    const { runtime, store, host, blockShutdown, stopEntered, stopped } = await fixture();
    blockShutdown();
    const pausing = runtime.pause(OWNER);
    await stopEntered.promise;
    expect(store.get(RUN)).toMatchObject({ phase: 'quiescing', quiesceTarget: 'paused' });
    const previousRevision = store.get(RUN).goalRevision;
    const added = await runtime.appendGoal(OWNER, { text: 'Arrived while pausing' }, 'during-pause');
    expect(added.disposition).toBe('deferred');
    expect(host.notify).not.toHaveBeenCalled();
    stopped.release();
    await pausing;
    expect(store.get(RUN).phase).toBe('paused');
    expect(store.get(RUN).goals[added.goal.id]?.status).toBe('deferred');
    const resumed = await runtime.resume(OWNER);
    expect(resumed.goals[added.goal.id]?.status).toBe('active');
    expect(resumed.goalRevision).toBeGreaterThan(previousRevision);
    const sync = await runtime.collaboration.sync('session-w1');
    expect(sync.acceptanceCriteria).toContain('Arrived while pausing');
  });

  it.each(['completed', 'stopped', 'failed'] as const)('leaves %s terminal and keeps appended goals deferred', async (phase) => {
    const { runtime, store, host } = await fixture(phase);
    const result = await runtime.appendGoal(OWNER, { text: `After ${phase}` }, `append-${phase}`);
    expect(result).toMatchObject({ disposition: 'deferred', phase, goal: { status: 'deferred', completedAt: null } });
    expect(store.get(RUN).phase).toBe(phase);
    expect(host.notify).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
    await expect(runtime.resume(OWNER)).rejects.toThrow();
  });

  it('explicitly continues deferred goals in a new run without reviving a stopped run', async () => {
    const { runtime, store, workspace } = await fixture('stopped');
    const appended = await runtime.appendGoal(OWNER, { text: 'Next round', acceptanceCriteria: [ADDED] }, 'next');
    const next = await runtime.continueGoals(OWNER);
    expect(next.id).not.toBe(RUN);
    expect(next.baseCommit).toBe(HEAD);
    expect(next.deadline).toBeNull();
    expect(next.goal).toContain('Next round');
    expect(next.acceptanceCriteria).toContain(ADDED);
    expect(workspace.inspect).toHaveBeenCalled();
    expect(store.get(RUN).phase).toBe('stopped');
    expect(store.get(RUN).goals[appended.goal.id]).toMatchObject({ status: 'deferred', continuedInRunId: next.id });
  });

  it('routes an append arriving during continuation to the newly started run', async () => {
    const { runtime, store, blockInspection, inspectEntered, inspected } = await fixture('completed');
    await runtime.appendGoal(OWNER, { text: 'First next-round goal' }, 'first-next');
    blockInspection();
    const continuing = runtime.continueGoals(OWNER);
    await inspectEntered.promise;
    const appending = runtime.appendGoal(OWNER, { text: 'Arrived while continuing' }, 'late-next');
    inspected.release();
    const next = await continuing;
    const late = await appending;
    expect(late.runId).toBe(next.id);
    expect(late.disposition).toBe('executing');
    expect(store.get(next.id).goals[late.goal.id]?.status).toBe('active');
    expect(Object.values(store.get(RUN).goals).every((goal) => goal.continuedInRunId === next.id)).toBe(true);
  });

  it('includes preparing additions without premature notification', async () => {
    const { runtime, store, host } = await fixture('preparing');
    const added = await runtime.appendGoal(OWNER, { text: 'Part of initial work' }, 'preparing-add');
    expect(added).toMatchObject({ disposition: 'executing', phase: 'preparing', goal: { status: 'active' } });
    expect(store.get(RUN).goals[added.goal.id]).toEqual(added.goal);
    expect(host.notify).not.toHaveBeenCalled();
  });

  it('makes owner goals match both general and selected worker waits', async () => {
    const { runtime, store } = await fixture();
    await runtime.collaboration.sync('session-w1');
    await runtime.collaboration.sync('session-w2');
    await runtime.collaboration.wait('session-w1', { afterSeq: 0 }, 'wait-any');
    await runtime.collaboration.wait('session-w2', { afterSeq: 0, taskIds: ['unrelated-task'] }, 'wait-selected');
    const added = await runtime.appendGoal(OWNER, { text: 'Owner changed the requirements' }, 'wake-goal');
    const run = store.get(RUN);
    expect(run.workers['w1']?.wakeTargetSeq).toBeGreaterThanOrEqual(added.goal.seq);
    expect(run.workers['w2']?.wakeTargetSeq).toBeGreaterThanOrEqual(added.goal.seq);
    const result = await runtime.collaboration.wait('session-w2', { afterSeq: 0, taskIds: ['unrelated-task'] }, 'check-selected');
    expect(result.waiting).toBe(false);
    expect(result.events.some(({ event }) => event.kind === 'goal')).toBe(true);
  });

  it('requires new active acceptance notes and refuses old-revision verification reuse', async () => {
    const { runtime, store, workspace, blockVerification, verifyEntered } = await fixture();
    await seedPassedVerification(store);
    const oldRevision = store.get(RUN).goalRevision;
    await runtime.appendGoal(OWNER, { text: 'A new acceptance', acceptanceCriteria: [ADDED] }, 'new-active');
    expect(store.get(RUN).goalRevision).toBeGreaterThan(oldRevision);
    await expect(runtime.finish('session-w1', { acceptedCommit: HEAD, notes: notes(ORIGINAL) }, 'stale-finish')).rejects.toThrow();
    expect(store.get(RUN).phase).toBe('running');
    blockVerification();
    const decision = await runtime.finish('session-w1', { acceptedCommit: HEAD, goalRevision: store.get(RUN).goalRevision, notes: notes(ORIGINAL, ADDED) }, 'fresh-finish');
    expect(decision.verificationId).not.toBe('historical');
    await verifyEntered.promise;
    expect(workspace.verify).toHaveBeenCalledOnce();
    expect(store.get(RUN).verifications['historical']?.status).toBe('passed');
  });

  it('rejects stale finish revisions even when an added criterion repeats original text', async () => {
    const { runtime, store } = await fixture();
    const previousRevision = store.get(RUN).goalRevision;
    await runtime.appendGoal(OWNER, { text: 'A different implementation requirement', acceptanceCriteria: [ORIGINAL] }, 'same-criterion');
    await expect(runtime.finish('session-w1', {
      acceptedCommit: HEAD, goalRevision: previousRevision, notes: notes(ORIGINAL),
    }, 'old-revision')).rejects.toThrow();
    await expect(runtime.finish('session-w1', {
      acceptedCommit: HEAD, notes: notes(ORIGINAL),
    }, 'omitted-revision')).rejects.toThrow();
    expect(store.get(RUN).phase).toBe('running');
  });

  it('preserves additions during final verification without applying old finish evidence to them', async () => {
    const { runtime, store, blockVerification, verifyEntered, verified } = await fixture();
    blockVerification();
    await runtime.finish('session-w1', { acceptedCommit: HEAD, notes: notes(ORIGINAL) }, 'finish');
    await verifyEntered.promise;
    const before = store.get(RUN);
    expect(before.phase).toBe('draining');
    const added = await runtime.appendGoal(OWNER, { text: 'Arrived during verification' }, 'during-drain');
    expect(added.disposition).toBe('deferred');
    expect(store.get(RUN).goalRevision).toBe(before.goalRevision);
    const completed = whenPhase(store, 'completed');
    verified.release();
    const result = await completed;
    expect(result.finishRequest?.notes).toEqual(notes(ORIGINAL));
    expect(Object.values(result.finishHistory)).toHaveLength(1);
    expect(Object.values(result.finishHistory)[0]?.notes).toEqual(notes(ORIGINAL));
    expect(result.goals[added.goal.id]).toMatchObject({ status: 'deferred', completedAt: null, completedCommit: null });
  });

  it('keeps goals appended during resource shutdown deferred after completion', async () => {
    const { runtime, store, blockShutdown, stopEntered, stopped } = await fixture();
    await seedPassedVerification(store);
    blockShutdown();
    await runtime.finish('session-w1', { acceptedCommit: HEAD, notes: notes(ORIGINAL) }, 'finish');
    await stopEntered.promise;
    expect(store.get(RUN).phase).toBe('quiescing');
    const added = await runtime.appendGoal(OWNER, { text: 'Arrived during shutdown' }, 'during-shutdown');
    expect(added.disposition).toBe('deferred');
    const completed = whenPhase(store, 'completed');
    stopped.release();
    const result = await completed;
    expect(result.goals[added.goal.id]?.status).toBe('deferred');
    expect(result.goals[added.goal.id]?.completedAt).toBeNull();
  });
});
