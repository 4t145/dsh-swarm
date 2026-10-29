import { clientSource as source, loadClient } from './client-fixture.ts';
import { describe, expect, it, vi } from 'vitest';

// These tests exercise pure UI derivation and stream ownership, not a browser or visual preview.
type Progress = Record<string, unknown> & {
  runId: string;
  phase: string;
  workers: Record<string, unknown>[];
  recentEvents?: Record<string, unknown>[];
};
interface State {
  sessionId: string;
  status: string;
  progress: Progress | null;
  hasSnapshot: boolean;
  receivedAt: number | null;
  stoppedAt: number | null;
  legacy: boolean;
  message: string | null;
}
interface Frame { seq: number; progress: Progress | null }
interface Stream extends AsyncIterable<Frame> { dispose(): void }
interface Options {
  sessionId: string;
  previous?: State;
  watchSession: (sessionId: string, signal: AbortSignal) => Stream;
  watch: (sessionId: string, signal: AbortSignal) => Stream;
  now?: () => number;
  onChange: (state: State) => void;
}
interface GraphItem {
  id: string;
  sha: string;
  parents: string[];
  subject: string;
  committedAt: number;
}
interface GraphRow {
  id: string;
  lane: number;
  incoming: number[];
  edges: Array<{ from: number; to: number }>;
}
interface Client {
  computeGraph(items: GraphItem[]): { rows: GraphRow[]; maxLanes: number };
  initialState(sessionId: string, available?: boolean): State;
  visibleState(state: State, sessionId: string, available: boolean): State;
  readFrame(item: unknown): Progress | null;
  subscribeProgress(options: Options): { done: Promise<void>; dispose(): void };
  deriveClock(state: State, now: number): { remainingMs: number; elapsedMs: number | null };
  deriveWorker(worker: Record<string, unknown>): { task: unknown; work: string; activity: string; activeTools: unknown[] };
  deriveWorkflow(progress: Progress): { id: string; state: string; counts: Record<string, number> }[];
  startClock(state: State, onTick: (now: number) => void): (() => void) | undefined;
  budgetKey(progress: Progress): string;
  describeEvent(progress: Progress, event: Record<string, unknown>): { subject: string | null; workerNumber: number };
  duration(ms: number): string;
  dictionaries: Record<'en' | 'zh', Record<string, string>>;
}
const client = loadClient<{ progressClient: Client }>().progressClient;

function worker(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'worker-long-id-1', nativeStatus: 'running', initializationState: 'ready',
    currentTask: { id: 'task-a', subject: 'Implement robust parser', status: 'claimed', revision: 2 },
    diagnostic: null, wait: null, currentProposal: null,
    activity: { status: 'running', turn: 2, step: 1, startedAt: 1_000, updatedAt: 2_000, activeTools: [], recentTools: [], diagnostic: null },
    ...overrides,
  };
}
function progress(overrides: Record<string, unknown> = {}): Progress {
  return {
    protocolVersion: 2, runId: 'run-1', phase: 'running', reason: null, quiesceTarget: null,
    goal: 'Deliver an accessible parser', createdAt: 1_000, deadline: 61_000, now: 11_000, updatedAt: 11_000,
    remainingMs: 50_000, budgetExpired: false,
    tasks: { total: 4, done: 1, open: 1, claimed: 1, proposed: 1, cancelled: 0, blocked: 0 },
    workers: [worker()], proposals: { queued: 1, integrating: 0, accepted: 1, rejected: 0 },
    verifications: { queued: 0, running: 1, passed: 2, failed: 1, interrupted: 0 },
    taskBoard: { items: [], total: 4, truncated: false }, recentEvents: [],
    finishRequest: null, acceptedHead: 'a'.repeat(40), baseCommit: 'b'.repeat(40), resultRef: 'refs/heads/swarm-result', detailError: null,
    ...overrides,
  };
}
function legacyProgress(): Progress {
  const p = progress();
  for (const key of ['protocolVersion', 'createdAt', 'goal', 'taskBoard', 'recentEvents']) delete p[key];
  p.workers = p.workers.map((w) => {
    const result = { ...w };
    for (const key of ['activity', 'wait', 'currentProposal']) delete result[key];
    return result;
  });
  return p;
}
function live(p = progress()): State {
  return { ...client.initialState('owner'), status: 'live', hasSnapshot: true, progress: p, receivedAt: 1_000_000 };
}
function controlledStream() {
  type Result = IteratorResult<Frame>;
  const queue: Array<Result | Error> = [];
  let pending: { resolve: (value: Result) => void; reject: (error: Error) => void } | undefined;
  let disposed = false;
  const deliver = (value: Result | Error) => {
    if (!pending) { queue.push(value); return; }
    const receiver = pending;
    pending = undefined;
    if (value instanceof Error) receiver.reject(value);
    else receiver.resolve(value);
  };
  const dispose = vi.fn(() => { disposed = true; deliver({ done: true, value: undefined }); });
  const stream: Stream = {
    dispose,
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          const queued = queue.shift();
          if (queued instanceof Error) return Promise.reject(queued);
          if (queued) return Promise.resolve(queued);
          if (disposed) return Promise.resolve({ done: true, value: undefined });
          return new Promise<Result>((resolve, reject) => { pending = { resolve, reject }; });
        },
      };
    },
  };
  return { stream, dispose, push: (p: Progress | null, seq = 1) => deliver({ done: false, value: { seq, progress: p } }), fail: (error: Error) => deliver(error), end: () => deliver({ done: true, value: undefined }) };
}
function observer() {
  let resolve!: () => void;
  let changed = new Promise<void>((done) => { resolve = done; });
  const states: State[] = [];
  return {
    states,
    onChange(state: State) { states.push(state); resolve(); },
    async next() { await changed; changed = new Promise<void>((done) => { resolve = done; }); },
  };
}

describe('dashboard facts and compatibility', () => {
  it('accepts both current and legacy DTOs, rejects malformed replacements', () => {
    expect(client.readFrame({ seq: 1, progress: progress() })?.runId).toBe('run-1');
    expect(client.readFrame({ seq: 1, progress: legacyProgress() })?.runId).toBe('run-1');
    expect(client.readFrame({ seq: 1, progress: null })).toBeNull();
    expect(() => client.readFrame({ seq: 1, progress: progress({ workers: [{}] }) })).toThrow('snapshot');
    expect(() => client.readFrame({ seq: 1, progress: progress({ taskBoard: null }) })).toThrow('details');
    expect(() => client.readFrame({ progress: null })).toThrow('frame');
    for (const key of ['reason', 'detailError', 'acceptedHead', 'resultRef']) expect(() => client.readFrame({ seq: 1, progress: progress({ [key]: {} }) })).toThrow('snapshot');
    expect(() => client.readFrame({ seq: 1, progress: progress({ workers: [worker({ diagnostic: {} })] }) })).toThrow('snapshot');
    expect(() => client.readFrame({ seq: 1, progress: progress({ workers: [worker({ activity: { ...worker().activity as object, diagnostic: {} } })] }) })).toThrow('details');
  });

  it('validates inherited/override/unavailable worker limit DTOs without a fixed maximum', () => {
    const workers = Array.from({ length: 12 }, (_, index) => worker({ id: `w${index}` }));
    const valid = [
      { canAdd: true, maxWorkers: 16, source: 'host', diagnostic: null },
      { canAdd: false, maxWorkers: 3, source: 'override', diagnostic: null },
      { canAdd: false, maxWorkers: null, source: null, diagnostic: 'Native config unavailable' },
      { canAdd: true, maxWorkers: 16 }, // Legacy v2 keeps an explicitly unknown source.
    ];
    for (const workerControls of valid) {
      const frame = client.readFrame({ seq: 1, progress: progress({ workers, workerControls }) });
      expect(frame?.workerControls).toEqual(workerControls);
      expect(frame?.workers).toHaveLength(12);
    }
    for (const workerControls of [
      { canAdd: true, maxWorkers: null, source: null, diagnostic: 'unavailable' },
      { canAdd: false, maxWorkers: null, source: null, diagnostic: null },
      { canAdd: false, maxWorkers: 12, source: 'invented', diagnostic: null },
      { canAdd: false, maxWorkers: 12, source: 'host', diagnostic: {} },
      ...[0, -1, 1.5, NaN, Infinity, '12'].map((maxWorkers) => ({ canAdd: true, maxWorkers, source: 'host', diagnostic: null })),
    ]) expect(() => client.readFrame({ seq: 1, progress: progress({ workerControls }) })).toThrow('worker controls');
  });

  it('permits simultaneous collaboration and integration without a synthetic percentage', () => {
    const stages = client.deriveWorkflow(progress());
    expect(stages.map((stage) => [stage.id, stage.state])).toEqual([
      ['prepare', 'complete'], ['collaborate', 'active'], ['integrate', 'active'], ['deliver', 'pending'],
    ]);
    expect(stages[2]?.counts).toEqual({ accepted: 1, pending: 1 });
    expect(client.deriveWorkflow(progress({ phase: 'completed' }))[3]?.state).toBe('complete');
    expect(client.deriveWorkflow(progress({ phase: 'stopped' }))[3]?.state).not.toBe('complete');
    expect(source).not.toContain('role: "progressbar"');
  });

  it('renders every stage as completed after the run completes (regression: middle stages went dark)', () => {
    // Idle, finished run: no pending proposals, no running checks, no finish request left in the snapshot.
    const done = progress({
      phase: 'completed', finishRequest: null,
      proposals: { queued: 0, integrating: 0, accepted: 3, rejected: 0 },
      verifications: { queued: 0, running: 0, passed: 4, failed: 0, interrupted: 0 },
      workers: [worker({ initializationState: 'stopped' })],
    });
    expect(client.deriveWorkflow(done).map((stage) => stage.state)).toEqual(['complete', 'complete', 'complete', 'complete']);
    expect(client.deriveWorkflow(done)[2]?.counts).toEqual({ accepted: 3, pending: 0 });
    for (const phase of ['stopped', 'failed']) expect(client.deriveWorkflow(progress({ phase })).map((stage) => stage.state)).not.toEqual(['complete', 'complete', 'complete', 'complete']);
  });

  it('keeps the dashboard to key progress: no team roster, delivery details or activity feed', () => {
    const panel = source.slice(source.indexOf('function DashboardPanel('), source.indexOf('\n\t\t}', source.indexOf('function DashboardPanel(')));
    expect(panel).toContain('deriveWorkflow(p)');
    expect(panel).toContain('h(TaskBoard');
    for (const removed of ['TeamCard', 'DeliveryCard', 'h(Timeline']) expect(panel).not.toContain(removed);
    expect(source).not.toContain('function TeamCard(');
    expect(source).not.toContain('function DeliveryCard(');
  });

  it('keeps claimed ownership on inactive workers and hides obsolete done pointers', () => {
    const inactive = client.deriveWorker(worker({ nativeStatus: 'inactive' }));
    expect(inactive).toMatchObject({ work: 'assigned', activity: 'idle', activeTools: [] });
    expect(inactive.task).toMatchObject({ status: 'claimed' });
    expect(client.deriveWorker(worker({ currentTask: { id: 'old', subject: 'Old work', status: 'done', revision: 4 } })).task).toBeNull();
    expect(client.deriveWorker(worker({ wait: { mode: 'any', afterSeq: 3, taskIds: [], proposalIds: [] } })).work).toBe('waiting');
    expect(client.deriveWorker(worker({ currentProposal: { id: 'p1', status: 'queued' } })).work).toBe('integration');
    expect(client.deriveWorker(worker({ currentProposal: { id: 'p1', status: 'integrating' } })).work).toBe('integrating');
  });

  it('marks missing activity as legacy instead of inventing tool or completion state', () => {
    expect(client.deriveWorker(legacyProgress().workers[0]!)).toMatchObject({ activity: 'legacy', activeTools: [] });
  });

  it('uses local Host-relative countdown, clamps at zero, and freezes terminal timestamps', () => {
    expect(client.deriveClock(live(), 1_005_000)).toEqual({ remainingMs: 45_000, elapsedMs: 15_000 });
    expect(client.deriveClock(live(), 2_000_000).remainingMs).toBe(0);
    const terminal = live(progress({ phase: 'stopped', recentEvents: [{ kind: 'run', status: 'stopped', createdAt: 9_000 }] }));
    expect(client.deriveClock(terminal, 2_000_000)).toEqual({ remainingMs: 52_000, elapsedMs: 8_000 });
    expect(client.deriveClock(live(legacyProgress()), 1_005_000).elapsedMs).toBeNull();
    expect(client.deriveClock({ ...live(), status: 'error', stoppedAt: 1_002_000 }, 2_000_000)).toEqual({ remainingMs: 48_000, elapsedMs: 12_000 });
    expect(client.duration(-50)).toBe('0:00');
  });

  it('labels terminal legacy budget as snapshot time, not an invented end time', () => {
    expect(client.budgetKey({ ...legacyProgress(), phase: 'completed' })).toBe('budget.snapshot');
    expect(client.budgetKey(progress({ phase: 'completed', recentEvents: [{ kind: 'run', status: 'completed', createdAt: 10_000 }] }))).toBe('budget.ended');
    expect(client.deriveWorker(worker({ initializationState: 'failed' })).work).toBe('failed');
  });

  it('maps public events to human task names and actual author identity', () => {
    const p = progress({ taskBoard: { items: [{ id: 'task-a', subject: 'Parser implementation', proposalId: 'proposal-a' }], total: 1, truncated: false } });
    expect(client.describeEvent(p, { kind: 'task', objectId: 'task-a', authorWorkerId: 'worker-long-id-1' })).toEqual({ subject: 'Parser implementation', workerNumber: 1 });
    expect(client.describeEvent(p, { kind: 'proposal', objectId: 'proposal-a', authorWorkerId: null })).toEqual({ subject: 'Parser implementation', workerNumber: 0 });
    expect(client.describeEvent(p, { kind: 'run', objectId: 'uuid-run', authorWorkerId: null })).toEqual({ subject: null, workerNumber: 0 });
  });

  it('owns one drawing timer, disposes it, and does not schedule for terminal or stale data', () => {
    vi.useFakeTimers();
    try {
      const tick = vi.fn();
      const dispose = client.startClock(live(), tick);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(3_000);
      expect(tick).toHaveBeenCalledTimes(4);
      dispose?.();
      expect(vi.getTimerCount()).toBe(0);
      for (const phase of ['completed', 'stopped', 'failed']) expect(client.startClock(live(progress({ phase })), tick)).toBeUndefined();
      for (const status of ['error', 'ended', 'loading', 'unavailable']) expect(client.startClock({ ...live(), status }, tick)).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('masks a previous session synchronously, before stream effect cleanup', () => {
    expect(client.visibleState(live(), 'other-owner', true)).toMatchObject({ sessionId: 'other-owner', progress: null, status: 'loading', hasSnapshot: false });
    const previous = live();
    expect(client.visibleState(previous, 'owner', true)).toBe(previous);
  });

  it('has matching locale keys, theme-only colors and semantic/reduced-motion controls', () => {
    expect(Object.keys(client.dictionaries.en).sort()).toEqual(Object.keys(client.dictionaries.zh).sort());
    expect(source).toContain('@media(prefers-reduced-motion:reduce)');
    expect(source).toContain('h("details"');
    expect(source).toContain('"aria-label"');
    expect(source).toContain(':focus-visible');
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    const colorTokens = [...source.matchAll(/var\((--[^,)]+)/g)].map((match) => match[1]);
    expect(colorTokens.every((token) => token?.startsWith('--dsw-alias-'))).toBe(true);
  });
});

describe('progress stream ownership', () => {
  it('continues across terminal and next-run frames without reopening the stream', async () => {
    const feed = controlledStream();
    const seen = observer();
    const watchSession = vi.fn(() => feed.stream);
    const watch = vi.fn(() => feed.stream);
    const subscription = client.subscribeProgress({ sessionId: 'owner', watchSession, watch, onChange: seen.onChange, now: () => 1_000_000 });
    await seen.next();
    feed.push(progress({ phase: 'completed' }));
    await seen.next();
    feed.push(progress({ runId: 'run-2', phase: 'preparing' }), 2);
    await seen.next();
    expect(seen.states.at(-1)).toMatchObject({ status: 'live', progress: { runId: 'run-2' } });
    expect(watchSession).toHaveBeenCalledTimes(1);
    expect(watch).not.toHaveBeenCalled();
    subscription.dispose();
    await subscription.done;
    expect(feed.dispose).toHaveBeenCalledTimes(1);
  });

  it('falls back once only on the exact missing new endpoint and never busy-reconnects terminal legacy', async () => {
    const modern = controlledStream();
    const old = controlledStream();
    const seen = observer();
    const watchSession = vi.fn(() => modern.stream);
    const watch = vi.fn(() => old.stream);
    const subscription = client.subscribeProgress({ sessionId: 'owner', watchSession, watch, onChange: seen.onChange });
    await seen.next();
    modern.fail(Object.assign(new Error('no active Remote method exports this endpoint'), { code: 'gateway/invocation-unavailable', details: { endpoint: 'swarmProgress/watchSession' } }));
    await seen.next();
    old.push({ ...legacyProgress(), phase: 'completed' });
    await seen.next();
    old.end();
    await subscription.done;
    expect(seen.states.at(-1)).toMatchObject({ legacy: true, status: 'ended', progress: { phase: 'completed' } });
    expect(watchSession).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledTimes(1);
    expect(modern.dispose).toHaveBeenCalledTimes(1);
    expect(old.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(['gateway/internal', 'remote-access/denied', 'gateway/definition-unavailable'])('does not mislabel %s as an old Host', async (code) => {
    const feed = controlledStream();
    const watch = vi.fn(() => feed.stream);
    const seen = observer();
    const subscription = client.subscribeProgress({ sessionId: 'owner', watchSession: () => feed.stream, watch, onChange: seen.onChange });
    feed.fail(Object.assign(new Error('denied or disconnected'), { code, details: { endpoint: 'swarmProgress/watchSession' } }));
    await subscription.done;
    expect(watch).not.toHaveBeenCalled();
    expect(seen.states.at(-1)).toMatchObject({ status: 'error', legacy: false, message: 'denied or disconnected' });
    expect(feed.dispose).toHaveBeenCalledTimes(1);
  });

  it('preserves the last good snapshot on failure, then manually reconnects without clearing it', async () => {
    const feed = controlledStream();
    const seen = observer();
    const subscription = client.subscribeProgress({ sessionId: 'owner', watchSession: () => feed.stream, watch: () => feed.stream, onChange: seen.onChange });
    await seen.next();
    feed.push(progress());
    await seen.next();
    feed.fail(new Error('offline'));
    await subscription.done;
    const stale = seen.states.at(-1)!;
    expect(stale).toMatchObject({ status: 'error', hasSnapshot: true, progress: { runId: 'run-1' } });
    const refreshed = controlledStream();
    const next = observer();
    const reconnect = client.subscribeProgress({ sessionId: 'owner', previous: stale, watchSession: () => refreshed.stream, watch: () => refreshed.stream, onChange: next.onChange });
    expect(next.states[0]).toMatchObject({ status: 'loading', progress: { runId: 'run-1' } });
    reconnect.dispose();
    await reconnect.done;
  });

  it('retains the snapshot on malformed replacement and releases the failed handle', async () => {
    const feed = controlledStream();
    const seen = observer();
    const subscription = client.subscribeProgress({ sessionId: 'owner', watchSession: () => feed.stream, watch: () => feed.stream, onChange: seen.onChange });
    await seen.next();
    feed.push(progress());
    await seen.next();
    feed.push(progress({ tasks: { total: -1 } }), 2);
    await subscription.done;
    expect(seen.states.at(-1)).toMatchObject({ status: 'error', progress: { tasks: { total: 4 } } });
    expect(feed.dispose).toHaveBeenCalledTimes(1);
  });

  it('lays out branch and merge lanes for the commit graph', () => {
    const graph = client.computeGraph([
      { id: 'm', sha: 'm', parents: ['a', 'b'], subject: 'merge', committedAt: 1 },
      { id: 'a', sha: 'a', parents: ['c'], subject: 'a', committedAt: 1 },
      { id: 'b', sha: 'b', parents: ['c'], subject: 'b', committedAt: 1 },
      { id: 'c', sha: 'c', parents: [], subject: 'c', committedAt: 1 },
    ]);
    expect(graph.rows.map((row) => row.lane)).toEqual([0, 0, 1, 0]);
    expect(graph.rows[0]?.edges).toEqual([{ from: 0, to: 1 }]);
    expect(graph.rows[2]?.edges).toEqual([{ from: 1, to: 0 }]);
    expect(graph.maxLanes).toBe(2);
  });

  it('reuses a closed lane instead of growing the graph', () => {
    const graph = client.computeGraph([
      { id: 'a', sha: 'a', parents: ['base'], subject: 'a', committedAt: 2 },
      { id: 'base', sha: 'base', parents: [], subject: 'base', committedAt: 1 },
    ]);
    expect(graph.rows.map((row) => row.lane)).toEqual([0, 0]);
    expect(graph.maxLanes).toBe(1);
  });

  it('cleans abort/stream once and suppresses all late updates after session change/unmount', async () => {
    const feed = controlledStream();
    const seen = observer();
    let signal: AbortSignal | undefined;
    const subscription = client.subscribeProgress({ sessionId: 'owner', watchSession: (_id, value) => { signal = value; return feed.stream; }, watch: () => feed.stream, onChange: seen.onChange });
    const count = seen.states.length;
    subscription.dispose();
    subscription.dispose();
    feed.push(progress());
    await subscription.done;
    expect(signal?.aborted).toBe(true);
    expect(feed.dispose).toHaveBeenCalledTimes(1);
    expect(seen.states).toHaveLength(count);
  });
});
