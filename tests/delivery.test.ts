/**
 * Delivery 针对性测试：串行投递、admission、wait/settled 竞态、steer 限制、
 * 暂停保留 pending、dispose。使用 fake WorkerHost + 内存 RunTable，
 * 不 sleep、不依赖真实 DSH。
 */

import { describe, expect, it } from 'vitest';
import { Delivery, type DeliveryOptions } from '../src/delivery.ts';
import { appendEvent, type EventInput } from '../src/events.ts';
import { SwarmError } from '../src/errors.ts';
import type { WorkerHost } from '../src/ports.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import {
  createRun,
  type Run,
  type VerificationConfig,
  type WaitRegistration,
  type WorkerRecord,
} from '../src/types.ts';

/* --------------------------- 夹具 --------------------------- */

class MapRunTable implements RunTable {
  readonly records = new Map<string, Run>();

  get(id: string): Run | undefined {
    return this.records.get(id);
  }

  entries(): IterableIterator<[string, Run]> {
    return this.records.entries();
  }

  async put(id: string, run: Run): Promise<void> {
    this.records.set(id, structuredClone(run));
  }

  async update(id: string, fn: (run: Run) => Run): Promise<Run> {
    const current = this.records.get(id);
    if (current === undefined) {
      throw new Error(`no record ${id}`);
    }
    const stored = structuredClone(fn(current));
    this.records.set(id, stored);
    return structuredClone(stored);
  }
}

interface SettleListener {
  (sessionId: string, activationId: string, failed: boolean): void;
}

class FakeHost implements WorkerHost {
  readonly starts: { runId: string; workerId: string }[] = [];
  readonly notifies: { runId: string; workerId: string; throughSeq: number }[] = [];
  readonly statuses = new Map<string, 'running' | 'inactive' | 'unavailable'>();
  startError: Error | null = null;
  notifyError: Error | null = null;
  stopCalls = 0;
  private listener: SettleListener | null = null;

  async start(request: { run: Run; worker: WorkerRecord }): Promise<void> {
    if (this.startError !== null) {
      throw this.startError;
    }
    this.starts.push({ runId: request.run.id, workerId: request.worker.id });
    this.statuses.set(request.worker.sessionId, 'running');
  }

  async notify(run: Run, worker: WorkerRecord, throughSeq: number): Promise<void> {
    if (this.notifyError !== null) {
      throw this.notifyError;
    }
    this.notifies.push({ runId: run.id, workerId: worker.id, throughSeq });
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }

  isOwnerLive(): boolean {
    return true;
  }

  isWorkerBusy(sessionId: string): boolean {
    return this.statuses.get(sessionId) === 'running';
  }

  workerStatus(sessionId: string): 'running' | 'inactive' | 'unavailable' {
    return this.statuses.get(sessionId) ?? 'unavailable';
  }

  onSettled(listener: SettleListener): () => void {
    this.listener = listener;
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  emitSettled(sessionId: string, activationId: string, failed = false): void {
    this.listener?.(sessionId, activationId, failed);
  }

  get listening(): boolean {
    return this.listener !== null;
  }
}

interface Harness {
  table: MapRunTable;
  store: MemoryStateStore;
  host: FakeHost;
  delivery: Delivery;
  errors: { runId: string; error: unknown }[];
  counts: { permits: number; releases: number };
  options: DeliveryOptions;
  rejectAdmission: SwarmError | null;
}

function testVerification(): VerificationConfig {
  return { setup: [], test: [{ argv: ['npm', 'test'], timeoutMs: 60_000 }] };
}

const RUN_ID = 'run-1';

function makeRun(): Run {
  return createRun({
    id: RUN_ID,
    ownerSessionId: 'session-owner',
    repositoryRoot: '/repo',
    gitCommonDir: '/repo/.git',
    goal: '串行投递',
    acceptanceCriteria: ['pending 必须发出去'],
    verification: testVerification(),
    baseCommit: 'h0',
    resultRef: 'refs/heads/swarm-run-1-result',
    deadline: 10_000_000,
    budgetMinutes: 30,
    createdAt: 1,
  });
}

function createHarness(phase?: Run['phase']): Harness {
  const table = new MapRunTable();
  const store = new MemoryStateStore(table);
  const host = new FakeHost();
  const errors: { runId: string; error: unknown }[] = [];
  const counts = { permits: 0, releases: 0 };

  const harness: Harness = {
    table,
    store,
    host,
    errors,
    counts,
    options: {
      admitWorkerOperation: async (runId: string, workerId: string, kind: 'create' | 'notify') => {
        if (harness.rejectAdmission !== null) {
          throw harness.rejectAdmission;
        }
        counts.permits += 1;
        void workerId;
        void kind;
        let released = false;
        return {
          signal: new AbortController().signal,
          release: () => {
            if (released) {
              return;
            }
            released = true;
            counts.releases += 1;
          },
        };
      },
      onError: (runId: string, error: unknown) => {
        errors.push({ runId, error });
      },
    },
    rejectAdmission: null,
  } as Harness;

  const run = makeRun();
  if (phase !== undefined) {
    run.phase = phase;
  }
  table.records.set(RUN_ID, run);
  harness.delivery = new Delivery(store, host, harness.options);
  return harness;
}

function addWorker(harness: Harness, workerId: string, overrides: Partial<WorkerRecord> = {}): void {
  void harness.store.update(RUN_ID, (run) => ({
    ...run,
    revision: run.revision + 1,
    workers: {
      ...run.workers,
      [workerId]: {
        id: workerId,
        sessionId: `session-${workerId}`,
        branch: `swarm/${workerId}`,
        worktreePath: `/tmp/${workerId}`,
        initializationState: 'ready',
        initializationError: null,
        unavailableReason: null,
        offeredSeq: 0,
        observedSeq: 0,
        notifiedSeq: 0,
        wakeTargetSeq: 0,
        waitRegistration: null,
        currentTaskId: null,
        createdAt: 1,
        ...overrides,
      },
    },
  }));
}

function wait(workerId: string, afterSeq = 0): WaitRegistration {
  return { afterSeq, mode: 'any', taskIds: [], proposalIds: [] };
}

/** 追加一条事件（走真实 appendEvent，因此 wait 匹配逻辑与生产一致）。 */
async function append(harness: Harness, event: EventInput): Promise<number> {
  let seq = 0;
  await harness.store.update(RUN_ID, (run) => {
    seq = appendEvent(run, event, 5).seq;
    return { ...run, revision: run.revision + 1 };
  });
  return seq;
}

function finding(author: string, id: string): EventInput {
  return {
    kind: 'finding',
    findingId: id,
    taskId: null,
    findingKind: 'observed',
    authorWorkerId: author,
    audience: { kind: 'all' },
  };
}

function message(author: string, target: string, id: string): EventInput {
  return {
    kind: 'message',
    messageId: id,
    targetWorkerId: target,
    authorWorkerId: author,
    audience: { kind: 'workers', workerIds: [author, target] },
  };
}

function worker(run: Run, workerId: string): WorkerRecord {
  const record = run.workers[workerId];
  if (record === undefined) {
    throw new Error(`missing worker ${workerId}`);
  }
  return record;
}

/* --------------------------- 用例 --------------------------- */

describe('Delivery.start', () => {
  it('申请许可、发布后立即返回，并在失败时仍释放许可', async () => {
    const h = createHarness('preparing');
    addWorker(h, 'w1');

    await h.delivery.start(RUN_ID, 'w1');
    expect(h.host.starts).toEqual([{ runId: RUN_ID, workerId: 'w1' }]);
    expect(h.counts).toEqual({ permits: 1, releases: 1 });

    h.host.startError = new Error('native session vanished');
    await expect(h.delivery.start(RUN_ID, 'w1')).rejects.toThrow('native session vanished');
    expect(h.counts).toEqual({ permits: 2, releases: 2 });
  });
});

describe('wait → pending → settled', () => {
  it('等待登记期间的 pending 只置位，settled 之后恰好通知一次', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1', { waitRegistration: wait('w1') });
    h.host.statuses.set('session-w1', 'running');

    await h.delivery.start(RUN_ID, 'w1');
    // 事件在 turn 结束前到达：wakeTargetSeq 抬高，但不能打扰正在等待的 activation。
    const seq = await append(h, finding('w2', 'f1'));
    await h.delivery.idle();
    expect(h.host.notifies).toEqual([]);
    expect(worker(h.store.get(RUN_ID), 'w1').wakeTargetSeq).toBe(seq);

    h.host.emitSettled('session-w1', 'act-1');
    await h.delivery.idle();
    expect(h.host.notifies).toEqual([{ runId: RUN_ID, workerId: 'w1', throughSeq: seq }]);
    expect(h.counts).toEqual({ permits: 2, releases: 2 });

    const after = worker(h.store.get(RUN_ID), 'w1');
    expect(after.notifiedSeq).toBe(seq);
    expect(after.observedSeq).toBe(0);
    expect(after.offeredSeq).toBe(0);
  });

  it('重复 settled 回调（同一 activationId）不会二次通知', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1', { waitRegistration: wait('w1') });
    h.host.statuses.set('session-w1', 'running');

    await append(h, finding('w2', 'f1'));
    h.host.emitSettled('session-w1', 'act-1');
    h.host.emitSettled('session-w1', 'act-1');
    await h.delivery.idle();
    expect(h.host.notifies).toHaveLength(1);

    // 让 observedSeq 追上已通知上界，后续 settled 不再重投。
    await h.store.update(RUN_ID, (run) => ({
      ...run,
      revision: run.revision + 1,
      workers: { ...run.workers, w1: { ...worker(run, 'w1'), observedSeq: 1 } },
    }));
    h.host.emitSettled('session-w1', 'act-2');
    await h.delivery.idle();
    expect(h.host.notifies).toHaveLength(1);
  });

  it('连续空转两次上报暂停建议，不再唤醒且保留未确认 pending', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1', { waitRegistration: wait('w1') });
    h.host.statuses.set('session-w1', 'running');
    const seq = await append(h, finding('w2', 'f1'));

    h.host.emitSettled('session-w1', 'act-1');
    await h.delivery.idle();
    expect(h.host.notifies.map((n) => n.throughSeq)).toEqual([seq]);

    // 第二轮没有 cursor/业务进展：暂停报告与再次唤醒互斥。
    h.host.emitSettled('session-w1', 'act-2');
    await h.delivery.idle();
    expect(h.host.notifies.map((n) => n.throughSeq)).toEqual([seq]);
    expect(worker(h.store.get(RUN_ID), 'w1')).toMatchObject({
      observedSeq: 0, wakeTargetSeq: seq, notifiedSeq: seq,
    });
    expect(h.errors).toHaveLength(1);
    const error = h.errors[0]?.error;
    expect(error).toBeInstanceOf(SwarmError);
    expect((error as SwarmError).code).toBe('SWARM_WORKER_BUSY');
    expect((error as SwarmError).message).toContain('consider pausing');
  });

  it('有部分确认进展的新 settled 仍可重投未确认的同一上界', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1', { waitRegistration: wait('w1') });
    h.host.statuses.set('session-w1', 'running');
    const acknowledged = await append(h, finding('w2', 'f1'));
    const seq = await append(h, finding('w2', 'f2'));

    h.host.emitSettled('session-w1', 'act-1');
    await h.delivery.idle();
    expect(h.host.notifies.map((n) => n.throughSeq)).toEqual([seq]);

    // 仅确认第一条，未确认目标仍为 seq；进展不能被误判为空转。
    await h.store.update(RUN_ID, (run) => ({
      ...run,
      revision: run.revision + 1,
      workers: { ...run.workers, w1: { ...worker(run, 'w1'), observedSeq: acknowledged } },
    }));
    h.host.emitSettled('session-w1', 'act-2');
    await h.delivery.idle();
    expect(h.host.notifies.map((n) => n.throughSeq)).toEqual([seq, seq]);
    expect(h.errors).toEqual([]);
    expect(worker(h.store.get(RUN_ID), 'w1')).toMatchObject({
      observedSeq: acknowledged, wakeTargetSeq: seq, notifiedSeq: seq,
    });
  });

  it('failed activation 走上报通道且不清掉 pending', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1', { waitRegistration: wait('w1') });
    h.host.statuses.set('session-w1', 'running');
    const seq = await append(h, finding('w2', 'f1'));

    h.host.emitSettled('session-w1', 'act-1', true);
    await h.delivery.idle();
    expect(h.host.notifies).toEqual([]);
    expect(h.errors).toHaveLength(1);
    expect(worker(h.store.get(RUN_ID), 'w1').wakeTargetSeq).toBe(seq);
  });
});

describe('running 中的 steer 限制', () => {
  it('无 wait 时只有最新未确认直接消息可 steer，finding 留待 sync', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1');
    h.host.statuses.set('session-w1', 'running');

    const findingSeq = await append(h, finding('w2', 'f1'));
    await h.delivery.idle();
    // wakeTargetSeq 因为没有 wait 登记而没被抬高，但即便如此也不能 steer。
    expect(h.host.notifies).toEqual([]);

    const messageSeq = await append(h, message('w2', 'w1', 'm1'));
    await h.delivery.idle();
    expect(h.host.notifies).toEqual([{ runId: RUN_ID, workerId: 'w1', throughSeq: messageSeq }]);
    void findingSeq;

    const record = worker(h.store.get(RUN_ID), 'w1');
    expect(record.notifiedSeq).toBe(messageSeq);
    expect(record.observedSeq).toBe(0);

    // 同一 activation 内同一 target 只通知一次。
    await h.delivery.kick(RUN_ID, 'w1');
    await h.delivery.idle();
    expect(h.host.notifies).toHaveLength(1);
  });

  it('后续新消息可以在同一 activation 内继续 steer', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1');
    h.host.statuses.set('session-w1', 'running');

    await append(h, message('w2', 'w1', 'm1'));
    await h.delivery.idle();
    const second = await append(h, message('w2', 'w1', 'm2'));
    await h.delivery.idle();
    expect(h.host.notifies.map((n) => n.throughSeq)).toEqual([1, second]);
  });
});

describe('run 状态', () => {
  it('paused 时不发通知也不丢 pending', async () => {
    const h = createHarness('paused');
    addWorker(h, 'w1', { waitRegistration: wait('w1') });
    h.host.statuses.set('session-w1', 'inactive');
    const seq = await append(h, finding('w2', 'f1'));

    await h.delivery.kick(RUN_ID);
    await h.delivery.idle();
    expect(h.host.notifies).toEqual([]);
    expect(worker(h.store.get(RUN_ID), 'w1').wakeTargetSeq).toBe(seq);

    h.host.emitSettled('session-w1', 'act-1');
    await h.delivery.idle();
    expect(h.host.notifies).toEqual([]);
    expect(h.errors).toEqual([]);
  });

  it('admission 的预期拒绝保留 pending 且不上报', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1', { waitRegistration: wait('w1') });
    h.host.statuses.set('session-w1', 'inactive');
    h.rejectAdmission = new SwarmError('SWARM_NOT_RUNNING', 'run admission is closed');

    const seq = await append(h, finding('w2', 'f1'));
    await h.delivery.kick(RUN_ID, 'w1');
    await h.delivery.idle();
    expect(h.host.notifies).toEqual([]);
    expect(h.errors).toEqual([]);
    expect(worker(h.store.get(RUN_ID), 'w1').wakeTargetSeq).toBe(seq);
  });

  it('inactive 的 worker 用 wakeTargetSeq 整体唤醒', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1', { waitRegistration: wait('w1') });
    h.host.statuses.set('session-w1', 'inactive');
    const seq = await append(h, finding('w2', 'f1'));

    await h.delivery.kick(RUN_ID, 'w1');
    await h.delivery.idle();
    expect(h.host.notifies).toEqual([{ runId: RUN_ID, workerId: 'w1', throughSeq: seq }]);
  });
});

describe('explicit user resume', () => {
  it('wakes an idle retained worker with no unread events through admission', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1');
    await h.store.update(RUN_ID, (run) => run);
    h.host.statuses.set('session-w1', 'inactive');
    await h.delivery.resume(RUN_ID, 'w1');
    expect(h.host.notifies).toEqual([{ runId: RUN_ID, workerId: 'w1', throughSeq: 0 }]);
    expect(h.counts).toEqual({ permits: 1, releases: 1 });
    expect(h.store.get(RUN_ID).workers['w1']?.observedSeq).toBe(0);
    await h.delivery.dispose();
  });
});

describe('dispose', () => {
  it('移除订阅与 settled 监听、拒绝新操作、不调用 host.stop', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1', { waitRegistration: wait('w1') });
    h.host.statuses.set('session-w1', 'running');

    await h.delivery.dispose();
    expect(h.host.listening).toBe(false);
    await expect(h.delivery.start(RUN_ID, 'w1')).rejects.toMatchObject({ code: 'SWARM_STORE_CLOSED' });
    await expect(h.delivery.kick(RUN_ID)).rejects.toMatchObject({ code: 'SWARM_STORE_CLOSED' });

    await append(h, finding('w2', 'f1'));
    h.host.emitSettled('session-w1', 'act-1');
    await h.delivery.idle();
    expect(h.host.notifies).toEqual([]);
    expect(h.host.stopCalls).toBe(0);

    // 可重复调用。
    await expect(h.delivery.dispose()).resolves.toBeUndefined();
  });

  it('排空已排队通知后才完成', async () => {
    const h = createHarness('running');
    addWorker(h, 'w1', { waitRegistration: wait('w1') });
    h.host.statuses.set('session-w1', 'inactive');
    await append(h, finding('w2', 'f1'));

    await h.delivery.kick(RUN_ID, 'w1');
    await h.delivery.dispose();
    expect(h.host.notifies).toHaveLength(1);
  });
});