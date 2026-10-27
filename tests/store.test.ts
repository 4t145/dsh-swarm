/**
 * StateStore 针对性测试：串行化、持久后发布、reducer 防线、close、订阅。
 * 使用内存 RunTable 与显式闸门，不依赖 sleep，也不依赖 DSH。
 */

import { describe, expect, it, vi } from 'vitest';
import { isSwarmError, SwarmError } from '../src/errors.ts';
import { MemoryStateStore, type RunTable, type StateStore } from '../src/store.ts';
import { createRun, type Run, type VerificationConfig } from '../src/types.ts';

/* --------------------------- 测试夹具 --------------------------- */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function defer<T = void>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolveFn?.(value);
    },
    reject: (reason: unknown) => {
      rejectFn?.(reason);
    },
  };
}

/** 可控内存表：每次写入前可挂闸门，用于证明“持久化确认后才发布”。 */
class FakeRunTable implements RunTable {
  readonly records = new Map<string, Run>();
  readonly writes: string[] = [];
  onEnter: ((kind: 'put' | 'update', id: string) => void) | null = null;
  failNextPut: Error | null = null;

  private readonly gates = new Map<string, Deferred<void>>();

  /** 让该 id 的下一次写入停在持久化之前。 */
  hold(id: string): Deferred<void> {
    const gate = defer();
    this.gates.set(id, gate);
    return gate;
  }

  /** 直接注入一条不合法的记录，模拟后端数据损坏。 */
  injectCorrupt(id: string, value: unknown): void {
    this.records.set(id, value as Run);
  }

  get(id: string): Run | undefined {
    return this.records.get(id);
  }

  entries(): IterableIterator<[string, Run]> {
    return this.records.entries();
  }

  async put(id: string, run: Run): Promise<void> {
    this.onEnter?.('put', id);
    await this.waitGate(id);
    if (this.failNextPut !== null) {
      const error = this.failNextPut;
      this.failNextPut = null;
      throw error;
    }
    this.records.set(id, structuredClone(run));
    this.writes.push(`put:${id}`);
  }

  async update(id: string, fn: (run: Run) => Run): Promise<Run> {
    this.onEnter?.('update', id);
    await this.waitGate(id);
    const current = this.records.get(id);
    if (current === undefined) {
      throw new Error(`fake table has no run ${id}`);
    }
    const next = fn(current);
    const stored = structuredClone(next);
    this.records.set(id, stored);
    this.writes.push(`update:${id}`);
    return structuredClone(stored);
  }

  private async waitGate(id: string): Promise<void> {
    const gate = this.gates.get(id);
    if (gate !== undefined) {
      this.gates.delete(id);
      await gate.promise;
    }
  }
}

function testVerification(): VerificationConfig {
  return {
    setup: [],
    test: [{ argv: ['npm', 'test'], timeoutMs: 60_000 }],
  };
}

function makeRun(id: string, overrides: Partial<Run> = {}): Run {
  const run = createRun({
    id,
    ownerSessionId: 'session-owner',
    repositoryRoot: '/repo',
    gitCommonDir: '/repo/.git',
    goal: '实现 CSV 导入',
    acceptanceCriteria: ['导入结果正确'],
    verification: testVerification(),
    baseCommit: 'h0',
    resultRef: `refs/heads/swarm-${id}-result`,
    deadline: 1_000,
    budgetMinutes: 30,
    createdAt: 10,
  });
  return { ...run, ...overrides };
}

interface Harness {
  table: FakeRunTable;
  store: StateStore;
}

function harness(): Harness {
  const table = new FakeRunTable();
  return { table, store: new MemoryStateStore(table) };
}

/** 取出被抛出的 SwarmError；非 SwarmError 直接让测试失败。 */
function captureError(fn: () => unknown): SwarmError {
  try {
    fn();
  } catch (error) {
    if (isSwarmError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the call to throw');
}

async function captureRejection(promise: Promise<unknown>): Promise<SwarmError> {
  try {
    await promise;
  } catch (error) {
    if (isSwarmError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the promise to reject');
}

/* --------------------------- 基本读写 --------------------------- */

describe('StateStore 基本读写', () => {
  it('create 后 get/list 返回已持久化记录，且返回副本', async () => {
    const { store } = harness();
    const run = makeRun('r1');
    await store.create(run);

    const loaded = store.get('r1');
    expect(loaded.id).toBe('r1');
    expect(loaded.phase).toBe('preparing');
    expect(loaded.baseCommit).toBe('h0');
    expect(loaded.acceptedHead).toBe('h0');
    expect(store.list().map((item) => item.id)).toEqual(['r1']);

    loaded.goal = '被调用方改动';
    expect(store.get('r1').goal).toBe('实现 CSV 导入');
  });

  it('create 重复 id 抛 SWARM_ALREADY_EXISTS 且保留原记录', async () => {
    const { store } = harness();
    await store.create(makeRun('r1'));

    const error = await captureRejection(store.create(makeRun('r1', { goal: '另一个目标' })));
    expect(error.code).toBe('SWARM_ALREADY_EXISTS');
    expect(store.get('r1').goal).toBe('实现 CSV 导入');
  });

  it('create 校验入参：非法记录抛 SWARM_INVALID_INPUT 且不落盘', async () => {
    const { table, store } = harness();
    const invalid = { ...makeRun('r1'), goal: '' };

    const error = await captureRejection(store.create(invalid));
    expect(error.code).toBe('SWARM_INVALID_INPUT');
    expect(table.records.has('r1')).toBe(false);
  });

  it('create 不通知订阅者（订阅者只观察变更）', async () => {
    const { store } = harness();
    const seen: string[] = [];
    store.subscribe((run) => seen.push(run.id));
    await store.create(makeRun('r1'));
    expect(seen).toEqual([]);
  });

  it('get 未知 id 抛 SWARM_NOT_FOUND；update 未知 id 同样拒绝', async () => {
    const { store } = harness();
    expect(captureError(() => store.get('missing')).code).toBe('SWARM_NOT_FOUND');

    const error = await captureRejection(store.update('missing', (run) => run));
    expect(error.code).toBe('SWARM_NOT_FOUND');
  });
});

/* --------------------------- 更新与发布 --------------------------- */

describe('StateStore 更新语义', () => {
  it('update 应用 reducer、递增 revision 并被 get 读到', async () => {
    const { store } = harness();
    await store.create(makeRun('r1'));

    const updated = await store.update('r1', (run) => ({ ...run, revision: run.revision + 1, goal: '新目标' }));
    expect(updated.revision).toBe(1);
    expect(updated.goal).toBe('新目标');
    expect(store.get('r1').revision).toBe(1);
  });

  it('持久化确认之前不发布', async () => {
    const { table, store } = harness();
    await store.create(makeRun('r1'));
    const notified: Run[] = [];
    store.subscribe((run) => notified.push(run));

    const entered = defer();
    table.onEnter = () => entered.resolve();
    const gate = table.hold('r1');
    const pending = store.update('r1', (run) => ({ ...run, revision: run.revision + 1 }));

    await entered.promise;
    expect(notified).toHaveLength(0);
    expect(table.records.get('r1')?.revision).toBe(0);

    gate.resolve();
    const updated = await pending;
    expect(updated.revision).toBe(1);
    expect(notified).toHaveLength(1);
    expect(notified[0]?.revision).toBe(1);
  });

  it('同一 run 的更新串行：第二个 reducer 看到第一个的结果', async () => {
    const { table, store } = harness();
    await store.create(makeRun('r1'));

    const seenRevisions: number[] = [];
    const gate = table.hold('r1');
    const first = store.update('r1', (run) => {
      seenRevisions.push(run.revision);
      return { ...run, revision: run.revision + 1 };
    });
    const second = store.update('r1', (run) => {
      seenRevisions.push(run.revision);
      return { ...run, revision: run.revision + 1 };
    });

    gate.resolve();
    await first;
    const afterSecond = await second;

    expect(seenRevisions).toEqual([0, 1]);
    expect(afterSecond.revision).toBe(2);
    expect(store.get('r1').revision).toBe(2);
  });

  it('不同 run 的更新互不阻塞', async () => {
    const { table, store } = harness();
    await store.create(makeRun('r1'));
    await store.create(makeRun('r2'));

    const gate = table.hold('r1');
    const blocked = store.update('r1', (run) => ({ ...run, revision: run.revision + 1 }));

    const other = await store.update('r2', (run) => ({ ...run, revision: run.revision + 1 }));
    expect(other.revision).toBe(1);

    gate.resolve();
    await blocked;
    expect(store.get('r1').revision).toBe(1);
  });
});

/* --------------------------- reducer 防线 --------------------------- */

describe('StateStore reducer 防线', () => {
  it('reducer 返回 Promise 抛 SWARM_INVALID_REDUCER 且不写后端', async () => {
    const { table, store } = harness();
    await store.create(makeRun('r1'));
    const notified: Run[] = [];
    store.subscribe((run) => notified.push(run));

    // 故意违反“reducer 必须同步”的约定，验证 store 的运行时防线。
    const asyncReducer = vi.fn();
    asyncReducer.mockReturnValue(Promise.resolve(makeRun('r1', { goal: '不该写入' })));

    const error = await captureRejection(store.update('r1', asyncReducer));
    expect(error.code).toBe('SWARM_INVALID_REDUCER');
    expect(table.records.get('r1')?.goal).toBe('实现 CSV 导入');
    expect(table.writes).toEqual(['put:r1']);
    expect(notified).toEqual([]);
  });

  it('reducer 抛错时错误收敛为 SWARM_INVALID_REDUCER 且不写后端', async () => {
    const { table, store } = harness();
    await store.create(makeRun('r1'));
    const boom = new Error('reducer bug');

    const error = await captureRejection(
      store.update('r1', () => {
        throw boom;
      }),
    );
    expect(error.code).toBe('SWARM_INVALID_REDUCER');
    expect(error.message).toContain('reducer bug');
    expect(error.cause).toBe(boom);
    expect(table.records.get('r1')?.revision).toBe(0);
    expect(table.writes).toEqual(['put:r1']);
  });

  it('reducer 抛出的业务 SwarmError 原样冒泡，保留自己的错误码', async () => {
    const { table, store } = harness();
    await store.create(makeRun('r1'));
    const stale = new SwarmError('SWARM_STALE_REVISION', 'task revision 已过期', {
      details: { taskId: 't1', expectedRevision: 2 },
    });

    const error = await captureRejection(
      store.update('r1', () => {
        throw stale;
      }),
    );
    expect(error).toBe(stale);
    expect(error.code).toBe('SWARM_STALE_REVISION');
    expect(table.records.get('r1')?.revision).toBe(0);
    expect(table.writes).toEqual(['put:r1']);
  });

  it('reducer 结果不符合 schema 时抛 SWARM_INVALID_REDUCER 且不写后端', async () => {
    const { table, store } = harness();
    await store.create(makeRun('r1'));

    const error = await captureRejection(store.update('r1', (run) => ({ ...run, goal: '' })));
    expect(error.code).toBe('SWARM_INVALID_REDUCER');
    expect(table.records.get('r1')?.goal).toBe('实现 CSV 导入');
  });

  it('后端写入失败抛 SWARM_STORE_WRITE_FAILED 且不发布', async () => {
    const { table, store } = harness();
    const notified: Run[] = [];
    store.subscribe((run) => notified.push(run));
    table.failNextPut = new Error('disk full');

    const error = await captureRejection(store.create(makeRun('r1')));
    expect(error.code).toBe('SWARM_STORE_WRITE_FAILED');
    expect(error.message).toContain('disk full');
    expect(table.records.has('r1')).toBe(false);
    expect(notified).toEqual([]);
  });
});

/* --------------------------- 订阅 --------------------------- */

describe('StateStore 订阅', () => {
  it('取消订阅后不再收到通知，重复取消无副作用', async () => {
    const { store } = harness();
    await store.create(makeRun('r1'));
    const seen: number[] = [];
    const unsubscribe = store.subscribe((run) => seen.push(run.revision));

    await store.update('r1', (run) => ({ ...run, revision: run.revision + 1 }));
    unsubscribe();
    unsubscribe();
    await store.update('r1', (run) => ({ ...run, revision: run.revision + 1 }));

    expect(seen).toEqual([1]);
  });

  it('单个订阅者抛错不影响已完成的更新与其他订阅者', async () => {
    const table = new FakeRunTable();
    const reported: unknown[] = [];
    const store = new MemoryStateStore(table, {
      onListenerError: (error) => reported.push(error),
    });
    await store.create(makeRun('r1'));

    const seen: number[] = [];
    store.subscribe(() => {
      throw new Error('listener bug');
    });
    store.subscribe((run) => seen.push(run.revision));

    const updated = await store.update('r1', (run) => ({ ...run, revision: run.revision + 1 }));
    expect(updated.revision).toBe(1);
    expect(seen).toEqual([1]);
    expect(reported).toHaveLength(1);
    expect(store.get('r1').revision).toBe(1);
  });
});

/* --------------------------- 数据损坏与关闭 --------------------------- */

describe('StateStore 损坏与关闭', () => {
  it('后端记录不符合 schema 时 get/list 抛 SWARM_STORE_CORRUPT', async () => {
    const { table, store } = harness();
    table.injectCorrupt('r1', { id: 'r1' });

    expect(captureError(() => store.get('r1')).code).toBe('SWARM_STORE_CORRUPT');
    expect(captureError(() => store.list()).code).toBe('SWARM_STORE_CORRUPT');
  });

  it('close 拒绝新调用、等待在途更新、可重复调用', async () => {
    const { table, store } = harness();
    await store.create(makeRun('r1'));

    const gate = table.hold('r1');
    const pending = store.update('r1', (run) => ({ ...run, revision: run.revision + 1 }));
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    const closing = store.close();
    expect(captureError(() => store.get('r1')).code).toBe('SWARM_STORE_CLOSED');
    const rejected = await captureRejection(store.update('r1', (run) => run));
    expect(rejected.code).toBe('SWARM_STORE_CLOSED');
    expect(captureError(() => store.subscribe(() => undefined)).code).toBe('SWARM_STORE_CLOSED');

    gate.resolve();
    await pending;
    await closing;
    await store.close();

    expect(settled).toBe(true);
    expect(captureError(() => store.list()).code).toBe('SWARM_STORE_CLOSED');
  });
});
