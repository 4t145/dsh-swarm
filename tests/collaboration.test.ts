/**
 * Collaboration 业务规则测试：真实 MemoryStateStore + 内存 RunTable，不依赖 DSH。
 * 时钟与 id 注入为确定性序列，不使用 sleep。
 */

import { describe, expect, it } from 'vitest';
import { Collaboration } from '../src/collaboration.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import { createRun, type Run, type RunId, type WorkerId, type WorkerRecord } from '../src/types.ts';

class InMemoryRunTable implements RunTable {
  private readonly records = new Map<RunId, Run>();

  get(id: RunId): Run | undefined {
    return this.records.get(id);
  }

  entries(): IterableIterator<[RunId, Run]> {
    return this.records.entries();
  }

  async put(id: RunId, run: Run): Promise<void> {
    this.records.set(id, run);
  }

  async update(id: RunId, fn: (run: Run) => Run): Promise<Run> {
    const current = this.records.get(id);
    if (current === undefined) {
      throw new Error(`missing run ${id}`);
    }
    const next = fn(current);
    this.records.set(id, next);
    return next;
  }
}

function makeWorker(id: WorkerId, sessionId: string): WorkerRecord {
  return {
    id,
    sessionId,
    branch: `swarm/${id}`,
    worktreePath: `/tmp/worktrees/${id}`,
    initializationState: 'ready',
    initializationError: null,
    unavailableReason: null,
    offeredSeq: 0,
    observedSeq: 0,
    notifiedSeq: 0,
    wakeTargetSeq: 0,
    waitRegistration: null,
    currentTaskId: null,
    createdAt: 0,
  };
}

interface Harness {
  store: MemoryStateStore;
  table: InMemoryRunTable;
  collaboration: Collaboration;
  runId: RunId;
}

function workerOf(store: MemoryStateStore, runId: RunId, workerId: WorkerId): WorkerRecord {
  const worker = store.get(runId).workers[workerId];
  if (worker === undefined) {
    throw new Error(`missing worker ${workerId}`);
  }
  return worker;
}

async function makeHarness(options: { pageSize?: number } = {}): Promise<Harness> {
  const table = new InMemoryRunTable();
  const store = new MemoryStateStore(table);
  const run = createRun({
    id: 'run-1',
    ownerSessionId: 'owner-session',
    repositoryRoot: '/tmp/repo',
    gitCommonDir: '/tmp/repo/.git',
    goal: 'ship feature',
    acceptanceCriteria: ['tests pass'],
    verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
    baseCommit: 'a'.repeat(40),
    resultRef: 'refs/heads/swarm-result',
    deadline: 1_000_000,
    createdAt: 0,
  });
  run.phase = 'running';
  run.workers = {
    w1: makeWorker('w1', 's1'),
    w2: makeWorker('w2', 's2'),
    w3: makeWorker('w3', 's3'),
  };
  await store.create(run);

  let tick = 1000;
  let nextId = 0;
  const collaboration = new Collaboration(store, {
    now: () => {
      tick += 1;
      return tick;
    },
    id: () => `id-${(nextId += 1)}`,
    eventPageSize: options.pageSize ?? 20,
  });
  return { store, table, collaboration, runId: 'run-1' };
}

const scope = ['src'];

describe('Collaboration', () => {
  it('creates an open task and replays the same callId without new events', async () => {
    const { store, collaboration, runId } = await makeHarness();
    const task = await collaboration.createTask(
      's1',
      { kind: 'code', subject: 'parse spec', acceptance: 'unit tests', scope },
      'call-1',
    );
    expect(task).toMatchObject({
      revision: 1,
      status: 'open',
      ownerWorkerId: null,
      createdByWorkerId: 'w1',
      proposalId: null,
      blockReason: null,
    });

    const replay = await collaboration.createTask(
      's1',
      { kind: 'code', subject: 'ignored', acceptance: 'ignored', scope },
      'call-1',
    );
    expect(replay.id).toBe(task.id);

    const run = store.get(runId);
    expect(run.events).toHaveLength(1);
    expect(run.events[0]).toMatchObject({ kind: 'task', taskId: task.id, status: 'open' });
    expect(run.revision).toBe(1);
    expect(workerOf(store, runId, 'w1').wakeTargetSeq).toBe(0);
  });

  it('claims with CAS and blocks when the worker already owns work', async () => {
    const { collaboration, store, runId } = await makeHarness();
    const task = await collaboration.createTask(
      's1',
      { kind: 'code', subject: 'a', acceptance: 'a', scope },
      'c1',
    );
    const claimed = await collaboration.updateTask(
      's1',
      { taskId: task.id, expectedRevision: 1, action: 'claim' },
      'c2',
    );
    expect(claimed).toMatchObject({ revision: 2, status: 'claimed', ownerWorkerId: 'w1' });
    expect(workerOf(store, runId, 'w1').currentTaskId).toBe(task.id);

    await expect(
      collaboration.updateTask('s2', { taskId: task.id, expectedRevision: 2, action: 'claim' }, 'c3'),
    ).rejects.toMatchObject({ code: 'SWARM_TASK_ALREADY_CLAIMED' });

    await expect(
      collaboration.updateTask('s1', { taskId: task.id, expectedRevision: 1, action: 'release' }, 'c4'),
    ).rejects.toMatchObject({ code: 'SWARM_STALE_REVISION' });

    const second = await collaboration.createTask(
      's1',
      { kind: 'code', subject: 'b', acceptance: 'b', scope },
      'c5',
    );
    await expect(
      collaboration.updateTask('s1', { taskId: second.id, expectedRevision: 1, action: 'claim' }, 'c6'),
    ).rejects.toMatchObject({ code: 'SWARM_WORKER_BUSY' });
  });

  it('runs release, block, unblock and cancel with their guards', async () => {
    const { collaboration } = await makeHarness();
    const task = await collaboration.createTask(
      's1',
      { kind: 'code', subject: 'a', acceptance: 'a', scope },
      'c1',
    );
    await expect(
      collaboration.updateTask('s1', { taskId: task.id, expectedRevision: 1, action: 'block', reason: 'x' }, 'c2'),
    ).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });

    await collaboration.updateTask('s1', { taskId: task.id, expectedRevision: 1, action: 'claim' }, 'c3');
    const blocked = await collaboration.updateTask(
      's1',
      { taskId: task.id, expectedRevision: 2, action: 'block', reason: 'needs input' },
      'c4',
    );
    expect(blocked).toMatchObject({ revision: 3, status: 'blocked', ownerWorkerId: null, blockReason: 'needs input' });

    await expect(
      collaboration.updateTask('s1', { taskId: task.id, expectedRevision: 3, action: 'unblock' }, 'c5'),
    ).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });

    const reopened = await collaboration.updateTask(
      's1',
      { taskId: task.id, expectedRevision: 3, action: 'unblock', reason: 'answered' },
      'c6',
    );
    expect(reopened).toMatchObject({ revision: 4, status: 'open', blockReason: null });

    const cancelled = await collaboration.updateTask(
      's1',
      { taskId: task.id, expectedRevision: 4, action: 'cancel', reason: 'obsolete' },
      'c7',
    );
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellationReason: 'obsolete' });

    await expect(
      collaboration.updateTask('s1', { taskId: task.id, expectedRevision: 5, action: 'claim' }, 'c8'),
    ).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
  });

  it('rejects mutations while the run is not running', async () => {
    const { collaboration, store, runId } = await makeHarness();
    await store.update(runId, (run) => ({ ...structuredClone(run), phase: 'paused' }));
    await expect(
      collaboration.createTask('s1', { kind: 'code', subject: 'a', acceptance: 'a', scope }, 'c1'),
    ).rejects.toMatchObject({ code: 'SWARM_NOT_RUNNING' });
    expect(() => collaboration.resolveWorker('unknown')).toThrowError(/not a swarm worker/);
  });

  it('completes a research task only with an evidenced finding', async () => {
    const { collaboration } = await makeHarness();
    const task = await collaboration.createTask(
      's1',
      { kind: 'research', subject: 'investigate', acceptance: 'report', scope },
      'c1',
    );
    await collaboration.updateTask('s1', { taskId: task.id, expectedRevision: 1, action: 'claim' }, 'c2');
    const bare = await collaboration.publish(
      's1',
      { kind: 'observed', summary: 'no evidence', taskId: task.id },
      'c3',
    );

    await expect(
      collaboration.updateTask(
        's1',
        { taskId: task.id, expectedRevision: 2, action: 'research_complete', findingId: bare.id },
        'c4',
      ),
    ).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });

    const finding = await collaboration.publish(
      's1',
      { kind: 'fact', summary: 'use zod', taskId: task.id, evidenceRefs: ['artifact:1'] },
      'c5',
    );
    const done = await collaboration.updateTask(
      's1',
      { taskId: task.id, expectedRevision: 2, action: 'research_complete', findingId: finding.id },
      'c6',
    );
    expect(done).toMatchObject({ status: 'done', resultFindingId: finding.id, ownerWorkerId: null });
    expect(finding.seq).toBeGreaterThan(0);
  });

  it('keeps private messages invisible to third parties', async () => {
    const { collaboration } = await makeHarness();
    const message = await collaboration.message('s1', { target: 'w2', body: 'secret plan' }, 'c1');
    expect(message.targetWorkerId).toBe('w2');

    const reader = await collaboration.read('s2', { id: message.id });
    expect(reader.items[0]?.kind).toBe('message');

    await expect(collaboration.read('s3', { id: message.id })).rejects.toMatchObject({
      code: 'SWARM_NOT_FOUND',
    });
    const third = await collaboration.read('s3', { query: 'secret' });
    expect(third.total).toBe(0);

    await expect(
      collaboration.message('s1', { target: 's1', body: 'self' }, 'c2'),
    ).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });
  });

  it('searches full history with the shared boolean expression language', async () => {
    const { collaboration } = await makeHarness();
    const task = await collaboration.createTask('s1', { kind: 'code', subject: 'parser work', acceptance: 'tests', scope }, 'c1');
    await collaboration.publish('s1', { kind: 'fact', summary: 'parser handles phrases', taskId: task.id }, 'c2');
    await collaboration.publish('s2', { kind: 'fail', summary: 'build broken on node' }, 'c3');
    await collaboration.message('s1', { target: 'w2', body: 'parser review please' }, 'c4');

    const kinds = async (query: string, session = 's2') =>
      (await collaboration.read(session, { query })).items.map((item) => item.kind);
    expect(await kinds('parser')).toEqual(['task', 'finding', 'message']);
    expect(await kinds('parser -kind:task')).toEqual(['finding', 'message']);
    expect(await kinds('kind:fact | kind:fail')).toEqual(['finding', 'finding']);
    expect(await kinds(`task:${task.id} kind:finding`)).toEqual(['finding']);
    expect(await kinds('author:w2')).toEqual(['finding']);
    expect(await kinds('"handles phrases"')).toEqual(['finding']);
    // DMs remain private to their two parties.
    expect(await kinds('review', 's3')).toEqual([]);

    const page = await collaboration.read('s2', { query: 'parser | build', limit: 2 });
    expect(page).toMatchObject({ total: 4, truncated: true, hasMore: true });
    await expect(collaboration.read('s2', { query: '(parser' })).rejects.toMatchObject({
      code: 'SWARM_INVALID_INPUT',
      details: { position: 0 },
    });
  });

  it('paginates sync events, skips invisible messages and honors ack', async () => {
    const { collaboration, store, runId } = await makeHarness({ pageSize: 2 });
    await collaboration.createTask('s1', { kind: 'code', subject: 't1', acceptance: 'a', scope }, 'c1');
    await collaboration.createTask('s1', { kind: 'code', subject: 't2', acceptance: 'a', scope }, 'c2');
    await collaboration.message('s1', { target: 'w2', body: 'hidden' }, 'c3');
    await collaboration.createTask('s1', { kind: 'code', subject: 't3', acceptance: 'a', scope }, 'c4');

    const first = await collaboration.sync('s3', { limit: 2 });
    expect(first.events).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.throughSeq).toBe(3);
    expect(first.offeredSeq).toBe(3);
    expect(first.goal).toBe('ship feature');
    expect(first.tasks).toHaveLength(3);

    const second = await collaboration.sync('s3', { ackSeq: 3, limit: 10 });
    expect(second.events.map((item) => item.event.seq)).toEqual([4]);
    expect(second.hasMore).toBe(false);
    expect(second.offeredSeq).toBe(4);
    expect(second.worker.observedSeq).toBe(3);
    expect(workerOf(store, runId, 'w3').observedSeq).toBe(3);

    await expect(collaboration.sync('s3', { ackSeq: 2 })).rejects.toMatchObject({
      code: 'SWARM_INVALID_INPUT',
    });
  });

  it('registers a wait, then returns increments once a matching event arrives', async () => {
    const { collaboration, store, runId } = await makeHarness();
    const pending = await collaboration.wait('s1', { afterSeq: 0 }, 'c1');
    expect(pending).toMatchObject({ waiting: true, events: [] });
    expect(workerOf(store, runId, 'w1').waitRegistration).toMatchObject({ mode: 'any', afterSeq: 0 });

    await collaboration.createTask('s2', { kind: 'code', subject: 'new', acceptance: 'a', scope }, 'c2');

    const ready = await collaboration.wait('s1', { afterSeq: 0 }, 'c3');
    expect(ready.waiting).toBe(false);
    expect(ready.events).toHaveLength(1);
    expect(ready.events[0]?.event.kind).toBe('task');
    expect(workerOf(store, runId, 'w1').waitRegistration).toBeNull();

    await expect(collaboration.wait('s1', { afterSeq: 0 }, 'c4', true)).rejects.toMatchObject({
      code: 'SWARM_WORKER_BUSY',
    });
    await expect(collaboration.wait('s1', { afterSeq: 99 }, 'c5')).rejects.toMatchObject({
      code: 'SWARM_INVALID_INPUT',
    });
  });

  it('lets only the run owner control tasks while paused', async () => {
    const { collaboration, store, runId } = await makeHarness();
    const task = await collaboration.createTask(
      's1',
      { kind: 'code', subject: 'a', acceptance: 'a', scope },
      'c1',
    );
    await collaboration.updateTask('s1', { taskId: task.id, expectedRevision: 1, action: 'claim' }, 'c2');
    await store.update(runId, (run) => ({ ...structuredClone(run), phase: 'paused' }));

    await expect(
      collaboration.controlTask(runId, 'someone-else', {
        taskId: task.id,
        expectedRevision: 2,
        action: 'release',
        reason: 'user stop',
      }),
    ).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });

    const released = await collaboration.controlTask(runId, 'owner-session', {
      taskId: task.id,
      expectedRevision: 2,
      action: 'release',
      reason: 'user stop',
    });
    expect(released).toMatchObject({ revision: 3, status: 'open', ownerWorkerId: null });
    expect(workerOf(store, runId, 'w1').currentTaskId).toBeNull();

    const cancelled = await collaboration.controlTask(runId, 'owner-session', {
      taskId: task.id,
      expectedRevision: 3,
      action: 'cancel',
      reason: 'user stop',
    });
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellationReason: 'user stop' });

    await store.update(runId, (run) => ({ ...structuredClone(run), phase: 'running' }));
    await expect(
      collaboration.controlTask(runId, 'owner-session', {
        taskId: task.id,
        expectedRevision: 4,
        action: 'cancel',
        reason: 'again',
      }),
    ).rejects.toMatchObject({ code: 'SWARM_NOT_RUNNING' });
  });
});