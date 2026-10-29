/**
 * Headless driver tests.
 *
 * Boundaries: `MemoryStateStore` + in-memory `RunTable` for real persistence
 * and subscriptions, a narrow fake runtime for start/stop calls, and a
 * collected JSONL sink. No real Host, model, Git or child process is used.
 */

import { describe, expect, it, vi } from 'vitest';

import { SwarmError } from '../src/errors.ts';
import {
  DEFAULT_MAX_LINE_BYTES,
  DEFAULT_MAX_PROGRESS_EVENTS,
  runSwarmHeadless,
  terminalPhaseOf,
  type HeadlessRunObserver,
  type SwarmHeadlessRuntime,
} from '../src/headless.ts';
import { MemoryStateStore, type RunTable, type StateStore } from '../src/store.ts';
import type { SwarmRuntime } from '../src/runtime.ts';
import { createRun, type Run, type RunPhase, type RunSpec } from '../src/types.ts';

type RealRuntimeFit = SwarmRuntime extends SwarmHeadlessRuntime ? true : never;
const realRuntimeFit: RealRuntimeFit = true;
void realRuntimeFit;

type RealStoreFit = StateStore extends HeadlessRunObserver ? true : never;
const realStoreFit: RealStoreFit = true;
void realStoreFit;

const SPEC: RunSpec = {
  specPath: '/tmp/repo/swarm.json',
  repository: '/tmp/repo',
  baseRef: 'main',
  goal: 'add the progress panel',
  acceptanceCriteria: ['tests pass'],
  workers: 2,
  budgetMinutes: 30,
  allowDirtyBaseline: false,
  verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
};

/** Minimal in-memory backend; clone on read/write like a real storage adapter. */
class MemoryRunTable implements RunTable {
  private readonly records = new Map<string, Run>();

  get(id: string): Run | undefined {
    const record = this.records.get(id);
    return record === undefined ? undefined : structuredClone(record);
  }

  entries(): IterableIterator<[string, Run]> {
    return [...this.records.entries()].map(([id, run]) => [id, structuredClone(run)] as [string, Run]).values();
  }

  async put(id: string, run: Run): Promise<void> {
    this.records.set(id, structuredClone(run));
  }

  async update(id: string, fn: (run: Run) => Run): Promise<Run> {
    const current = this.records.get(id);
    if (current === undefined) {
      throw new Error(`run ${id} not found`);
    }
    const next = fn(structuredClone(current));
    this.records.set(id, structuredClone(next));
    return structuredClone(next);
  }
}

type RawLine = Record<string, unknown>;

function parseLines(lines: readonly string[]): RawLine[] {
  return lines.map((line) => JSON.parse(line) as RawLine);
}

/** True when the promise already settled on the current microtask queue. */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true, () => true),
    Promise.resolve(false),
  ]);
}

class FakeRuntime implements SwarmHeadlessRuntime {
  readonly store: MemoryStateStore;
  readonly table = new MemoryRunTable();
  readonly startCalls: Array<{ ownerSessionId: string; spec: RunSpec }> = [];
  readonly stopCalls: string[] = [];
  startFailure: unknown;
  stopFailure: unknown;
  /** Hook after the run is running and persisted but before `start` resolves. */
  onStart: ((run: Run) => Promise<void>) | null = null;
  private counter = 0;
  private readonly runIds = new Map<string, string>();
  /** Resolves once the first `start` persisted the running record. */
  readonly started: Promise<void>;
  private signalStarted: () => void = () => undefined;

  constructor() {
    this.store = new MemoryStateStore(this.table);
    this.started = new Promise<void>((resolve) => {
      this.signalStarted = resolve;
    });
  }

  async start(ownerSessionId: string, spec: RunSpec): Promise<Run> {
    this.startCalls.push({ ownerSessionId, spec });
    if (this.startFailure !== undefined) {
      throw this.startFailure;
    }
    this.counter += 1;
    const id = `run-${String(this.counter)}`;
    this.runIds.set(ownerSessionId, id);
    const created = createRun({
      id,
      ownerSessionId,
      repositoryRoot: '/tmp/repo',
      gitCommonDir: '/tmp/repo/.git',
      goal: spec.goal,
      acceptanceCriteria: spec.acceptanceCriteria,
      verification: spec.verification,
      baseCommit: 'base-sha',
      resultRef: `refs/heads/swarm-${id}-result`,
      deadline: 1_000_000,
      specPath: spec.specPath,
      budgetMinutes: spec.budgetMinutes,
      createdAt: 10,
    });
    await this.store.create(created);
    const running = await this.transition(id, 'running');
    this.signalStarted();
    if (this.onStart !== null) {
      await this.onStart(running);
    }
    return running;
  }

  async stop(ownerSessionId: string): Promise<Run> {
    this.stopCalls.push(ownerSessionId);
    if (this.stopFailure !== undefined) {
      throw this.stopFailure;
    }
    const id = this.runIds.get(ownerSessionId);
    if (id === undefined) {
      throw new SwarmError('SWARM_NOT_FOUND', 'no run for owner');
    }
    return this.transition(id, 'stopped', 'user_stop');
  }

  /** Persist one phase change; each update publishes to subscribers. */
  transition(id: string, phase: RunPhase, reason: string | null = null): Promise<Run> {
    return this.store.update(id, (current) => ({
      ...current,
      phase,
      reason,
      revision: current.revision + 1,
      updatedAt: current.updatedAt + 1,
    }));
  }

  /** Append a task or message through a persisted update. */
  update(id: string, fn: (run: Run) => Run): Promise<Run> {
    return this.store.update(id, (current) => ({ ...fn(current), revision: current.revision + 1 }));
  }
}

describe('terminalPhaseOf', () => {
  it('treats only completed/stopped/failed as terminal', () => {
    expect(terminalPhaseOf('completed')).toBe('completed');
    expect(terminalPhaseOf('stopped')).toBe('stopped');
    expect(terminalPhaseOf('failed')).toBe('failed');
    for (const phase of ['preparing', 'running', 'draining', 'quiescing', 'paused'] as const) {
      expect(terminalPhaseOf(phase)).toBeNull();
    }
  });
});

describe('runSwarmHeadless', () => {
  it('reports current policy and its source on events without persisting or polling it', async () => {
    const fake = new FakeRuntime();
    let maxWorkers = 12;
    let unavailable = false;
    const status = vi.fn((ownerSessionId: string) => {
      if (unavailable) throw new Error('native config unavailable');
      return { runId: 'run-1', ownerSessionId, workerControls: {
        canAdd: true, maxWorkers, source: 'host' as const, diagnostic: null,
      } };
    });
    const lines: string[] = [];
    const driver = runSwarmHeadless({ start: fake.start.bind(fake), stop: fake.stop.bind(fake), status }, 'owner-1', SPEC, {
      observe: fake.store, write: (line) => lines.push(line),
    });
    await fake.started;
    await fake.transition('run-1', 'paused');
    expect(parseLines(lines).at(-1)?.workerControls).toMatchObject({ maxWorkers: 12, source: 'host' });
    maxWorkers = 6;
    await fake.transition('run-1', 'running');
    expect(parseLines(lines).at(-1)?.workerControls).toMatchObject({ maxWorkers: 6, source: 'host' });
    unavailable = true;
    await fake.transition('run-1', 'completed');
    const result = await driver;
    expect(result.final.workerControls).toEqual({ canAdd: false, maxWorkers: null, source: null, diagnostic: 'native config unavailable' });
    expect(JSON.stringify(fake.store.get('run-1'))).not.toContain('maxWorkers');
    expect(status).toHaveBeenCalledWith('owner-1');
  });

  it('waits through non-terminal phases and settles on completed with bounded JSONL', async () => {
    const runtime = new FakeRuntime();
    const lines: string[] = [];
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: (line) => lines.push(line),
      now: () => 42,
    });

    // Let `start` finish and the initial projection land.
    await runtime.started;
    expect(runtime.startCalls).toHaveLength(1);
    expect(await hasSettled(driver)).toBe(false);

    // Worker readiness / idleness and ordinary phases are not completion.
    await runtime.transition('run-1', 'draining', 'workers_idle');
    await runtime.transition('run-1', 'quiescing', 'finishing');
    await runtime.transition('run-1', 'paused', 'user_pause');
    expect(await hasSettled(driver)).toBe(false);

    await runtime.transition('run-1', 'completed', null);
    const result = await driver;

    expect(result.phase).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.aborted).toBe(false);
    expect(result.final.ok).toBe(true);
    expect(result.final.progressEvents).toBe(result.progressEvents);

    const parsed = parseLines(lines);
    const progress = parsed.filter((line) => line['type'] === 'progress');
    const finals = parsed.filter((line) => line['type'] === 'final');
    expect(progress.length).toBeGreaterThanOrEqual(4);
    expect(finals).toHaveLength(1);
    expect(progress.map((line) => line['phase'])).toEqual([
      'running',
      'draining',
      'quiescing',
      'paused',
      'completed',
    ]);
    const lastProgress = progress.at(-1);
    expect(lastProgress?.['now']).toBe(42);
    expect(lastProgress?.['workerControls']).toMatchObject({ maxWorkers: null, source: null, canAdd: false });
    expect(lastProgress?.['tasks']).toEqual({
      open: 0,
      claimed: 0,
      proposed: 0,
      done: 0,
      blocked: 0,
      cancelled: 0,
      total: 0,
    });
    expect(lastProgress?.['resultRef']).toBe('refs/heads/swarm-run-1-result');
    expect(lastProgress?.['acceptedHead']).toBe('base-sha');
    for (const line of lines) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(DEFAULT_MAX_LINE_BYTES);
    }
  });

  it('never regresses revisions when startup publishes buffered states', async () => {
    const runtime = new FakeRuntime();
    const lines: string[] = [];
    runtime.onStart = async (run) => {
      await runtime.transition(run.id, 'draining');
      await runtime.transition(run.id, 'completed');
    };
    const result = await runSwarmHeadless(runtime, 'owner-1', SPEC, { observe: runtime.store, write: (line) => lines.push(line) });
    expect(result.phase).toBe('completed');
    const revisions = parseLines(lines).filter((line) => line['type'] === 'progress').map((line) => Number(line['revision']));
    expect(revisions.length).toBeGreaterThan(0);
    expect(revisions.every((revision, index) => index === 0 || revision > (revisions[index - 1] ?? -1))).toBe(true);
  });

  it('counts tasks and refuses to leak message bodies', async () => {
    const runtime = new FakeRuntime();
    const lines: string[] = [];
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: (line) => lines.push(line),
    });
    await runtime.started;

    await runtime.update('run-1', (run) => ({
      ...run,
      tasks: {
        ...run.tasks,
        'task-1': {
          id: 'task-1',
          revision: 1,
          createdByWorkerId: 'w1',
          kind: 'code',
          subject: 'progress panel',
          acceptance: 'renders',
          scope: ['client.js'],
          status: 'done',
          ownerWorkerId: 'w1',
          proposalId: null,
          resultFindingId: null,
          blockReason: null,
          cancellationReason: null,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      messages: {
        ...run.messages,
        'message-1': {
          id: 'message-1',
          seq: 1,
          authorWorkerId: 'w1',
          targetWorkerId: 'w2',
          body: 'SECRET-PRIVATE-BODY',
          createdAt: 1,
        },
      },
    }));
    await runtime.transition('run-1', 'completed', null);
    const result = await driver;

    expect(result.final.tasks.done).toBe(1);
    expect(result.final.tasks.total).toBe(1);
    expect(lines.join('\n')).not.toContain('SECRET-PRIVATE-BODY');
    expect(lines.join('\n')).not.toContain('acceptance');
  });

  it('caps progress lines and degrades oversized lines to a bounded marker', async () => {
    const runtime = new FakeRuntime();
    const lines: string[] = [];
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: (line) => lines.push(line),
      maxProgressEvents: 2,
      maxLineBytes: 220,
    });
    await runtime.started;
    for (const phase of ['draining', 'quiescing', 'paused', 'running'] as const) {
      await runtime.transition('run-1', phase);
    }
    await runtime.transition('run-1', 'completed', null);
    const result = await driver;

    expect(result.progressEvents).toBe(2);
    expect(result.suppressedProgressEvents).toBeGreaterThan(0);
    expect(result.final.suppressedProgressEvents).toBe(result.suppressedProgressEvents);
    const parsedLines = parseLines(lines);
    for (const line of lines) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(220);
    }
    const progressLines = parsedLines.filter((line) => line['type'] === 'progress');
    expect(progressLines).toHaveLength(2);
    for (const line of progressLines) {
      expect(line['truncated']).toBe(true);
    }
    const finalLine = parsedLines.at(-1);
    expect(finalLine?.['type']).toBe('final');
    expect(finalLine?.['truncated']).toBe(true);
    expect(DEFAULT_MAX_PROGRESS_EVENTS).toBeGreaterThan(2);
  });

  it('aborts by stopping only this run, then exits on the terminal phase', async () => {
    const runtime = new FakeRuntime();
    const lines: string[] = [];
    const controller = new AbortController();
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: (line) => lines.push(line),
      signal: controller.signal,
    });
    await runtime.started;
    expect(runtime.stopCalls).toEqual([]);

    controller.abort();
    const result = await driver;

    expect(runtime.stopCalls).toEqual(['owner-1']);
    expect(result.phase).toBe('stopped');
    expect(result.exitCode).toBe(130);
    expect(result.aborted).toBe(true);
    expect(result.final.ok).toBe(false);
    expect(result.final.reason).toBe('user_stop');
    // A second abort signal must not issue another stop or reopen the run.
    controller.abort();
    expect(runtime.stopCalls).toEqual(['owner-1']);
    expect(parseLines(lines).filter((line) => line['type'] === 'final')).toHaveLength(1);
  });

  it('rejects an already-aborted signal without starting a run', async () => {
    const runtime = new FakeRuntime();
    const controller = new AbortController();
    controller.abort();
    const lines: string[] = [];
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: (line) => lines.push(line),
      signal: controller.signal,
    });
    await expect(driver).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    expect(runtime.startCalls).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('rejects when the abort-triggered stop fails and reports it once', async () => {
    const runtime = new FakeRuntime();
    const lines: string[] = [];
    const controller = new AbortController();
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: (line) => lines.push(line),
      signal: controller.signal,
    });
    await runtime.started;

    runtime.stopFailure = new SwarmError('SWARM_INTERNAL', 'stop could not confirm quiescence');
    controller.abort();
    await expect(driver).rejects.toMatchObject({ code: 'SWARM_INTERNAL' });

    const finals = parseLines(lines).filter((line) => line['type'] === 'final');
    expect(finals).toHaveLength(1);
    expect(finals[0]?.['ok']).toBe(false);
    expect(finals[0]?.['aborted']).toBe(true);
    expect(finals[0]?.['error']).toMatchObject({ code: 'SWARM_INTERNAL' });
  });

  it('rejects with the start failure after emitting one failure record', async () => {
    const runtime = new FakeRuntime();
    runtime.startFailure = new SwarmError('SWARM_INVALID_SPEC', 'bad spec');
    const lines: string[] = [];
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: (line) => lines.push(line),
    });
    await expect(driver).rejects.toMatchObject({ code: 'SWARM_INVALID_SPEC' });

    const parsed = parseLines(lines);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      type: 'final',
      ok: false,
      runId: null,
      exitCode: 1,
      error: { code: 'SWARM_INVALID_SPEC' },
    });
  });

  it('does not miss a terminal update published while start is still resolving', async () => {
    const runtime = new FakeRuntime();
    const lines: string[] = [];
    runtime.onStart = async (run) => {
      await runtime.transition(run.id, 'completed', null);
    };
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: (line) => lines.push(line),
    });
    const result = await driver;

    expect(result.phase).toBe('completed');
    expect(result.exitCode).toBe(0);
    const parsed = parseLines(lines);
    expect(parsed.at(-1)?.['type']).toBe('final');
    expect(parsed.at(-1)?.['phase']).toBe('completed');
  });

  it('rejects a closed store instead of hanging', async () => {
    const runtime = new FakeRuntime();
    await runtime.store.close();
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: () => undefined,
    });
    await expect(driver).rejects.toMatchObject({ code: 'SWARM_STORE_CLOSED' });
    expect(runtime.startCalls).toEqual([]);
  });

  it('rejects a sink error without leaving the driver pending', async () => {
    const runtime = new FakeRuntime();
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: () => {
        throw new Error('stdout closed');
      },
    });
    await expect(driver).rejects.toMatchObject({ code: 'SWARM_INTERNAL' });
    // The run itself is untouched by an output failure.
    expect(runtime.stopCalls).toEqual([]);
  });

  it('honours the caller clock only for projections', async () => {
    const runtime = new FakeRuntime();
    const lines: string[] = [];
    const now = vi.fn(() => 777);
    const driver = runSwarmHeadless(runtime, 'owner-1', SPEC, {
      observe: runtime.store,
      write: (line) => lines.push(line),
      now,
    });
    await runtime.started;
    await runtime.transition('run-1', 'completed', null);
    await driver;
    expect(now).toHaveBeenCalled();
    const progress = parseLines(lines).filter((line) => line['type'] === 'progress');
    expect(progress.every((line) => line['now'] === 777)).toBe(true);
  });
});