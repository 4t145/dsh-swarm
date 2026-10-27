/**
 * run 聚合记录的状态仓库。
 *
 * 语义（架构 §4.1 / §4.3）：
 * - 一个 run 的业务变更在一个 `update` 内完成；reducer 是纯同步函数。
 * - 同一 run 的 create/update 串行执行，不同 run 互不阻塞。
 * - 只有后端持久化成功之后才向订阅者发布。
 *
 * 本模块不导入 DSH：Host 后续把一个 storageDomain table 适配成 `RunTable` 传入。
 */

import { isSwarmError, SwarmError, normalizeError } from './errors.ts';
import { parseRun } from './schema.ts';
import { KeyedSerialQueue } from './serial.ts';
import type { Run, RunId } from './types.ts';

/**
 * 持久记录端口。Host 适配器把 `update` 映射为**同一个** storageDomain
 * `table.update(runId, reducer)`；`put` 用于首次创建。
 */
export interface RunTable {
  /** 同步读取最近一次已持久化的记录；不存在返回 undefined。 */
  get(id: RunId): Run | undefined;
  /** 遍历全部已持久化记录。 */
  entries(): IterableIterator<[RunId, Run]>;
  /** 写入整条记录；成功 resolve 后该记录才算持久。 */
  put(id: RunId, run: Run): Promise<void>;
  /** 在记录上同步应用 reducer 并持久化，返回新记录；同一 id 的调用必须串行。 */
  update(id: RunId, fn: (run: Run) => Run): Promise<Run>;
}

/** 状态仓库接口：内存实现与将来的 domain 适配实现共用。 */
export interface StateStore {
  /** 持久化一个新 run；重复 id 抛 `SWARM_ALREADY_EXISTS`，不通知订阅者。 */
  create(run: Run): Promise<void>;
  /** 读取已持久化的 run 快照；不存在抛 `SWARM_NOT_FOUND`。 */
  get(id: RunId): Run;
  /** 全部 run 的已持久化快照，顺序由后端 `entries()` 决定。 */
  list(): Run[];
  /**
   * 同步应用 reducer 并持久化，返回新记录。
   *
   * reducer 必须同步返回新 Run（返回 Promise 抛 `SWARM_INVALID_REDUCER` 且不写后端）；
   * reducer 抛错同样不写。持久成功后才通知订阅者。
   */
  update(id: RunId, reducer: (run: Run) => Run): Promise<Run>;
  /** 订阅持久化后的 run 变更；返回取消订阅函数（可重复调用）。 */
  subscribe(listener: (run: Run) => void): () => void;
  /** 拒绝新调用、等待已在队的更新结束、清空订阅者。可重复调用。 */
  close(): Promise<void>;
}

export interface MemoryStateStoreOptions {
  /**
   * 订阅者抛错时的上报通道；默认写 console.error，避免把已持久化的更新判为失败。
   * Host 可注入 ctx.logger 路径。
   */
  onListenerError?: (error: unknown, run: Run) => void;
}

/**
 * 基于 `RunTable` 的 StateStore 实现。
 *
 * 单进程内用它承载串行化与“持久后发布”；测试用内存 RunTable，生产用 Host 注入的
 * storageDomain 适配器，因此两者对上层是同一接口。
 */
export class MemoryStateStore implements StateStore {
  private readonly table: RunTable;
  private readonly onListenerError: ((error: unknown, run: Run) => void) | undefined;
  private readonly listeners = new Set<(run: Run) => void>();
  /** 每个 run 一条串行队列；队列本身永不 reject（与 delivery 共用 src/serial.ts）。 */
  private readonly queue = new KeyedSerialQueue();
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(table: RunTable, options: MemoryStateStoreOptions = {}) {
    this.table = table;
    this.onListenerError = options.onListenerError;
  }

  async create(run: Run): Promise<void> {
    this.assertOpen('create');
    // 调用方入参在此校验一次；parseRun 返回副本，调用方后续修改不会影响已存记录。
    const record = parseRun(run, 'SWARM_INVALID_INPUT');
    await this.queue.run(record.id, async () => {
      if (this.table.get(record.id) !== undefined) {
        throw new SwarmError('SWARM_ALREADY_EXISTS', `run ${record.id} already exists`, {
          details: { runId: record.id },
        });
      }
      await this.put(record);
    });
  }

  get(id: RunId): Run {
    this.assertOpen('get');
    return this.read(id);
  }

  list(): Run[] {
    this.assertOpen('list');
    const runs: Run[] = [];
    for (const [id, raw] of this.table.entries()) {
      runs.push(this.parseRecord(id, raw));
    }
    return runs;
  }

  async update(id: RunId, reducer: (run: Run) => Run): Promise<Run> {
    this.assertOpen('update');
    if (typeof reducer !== 'function') {
      throw new SwarmError('SWARM_INVALID_INPUT', 'reducer must be a function', { details: { runId: id } });
    }
    return this.queue.run(id, async () => {
      const persisted = await this.applyUpdate(id, reducer);
      this.publish(persisted);
      return persisted;
    });
  }

  subscribe(listener: (run: Run) => void): () => void {
    this.assertOpen('subscribe');
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.listeners.delete(listener);
    };
  }

  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }
    this.closed = true;
    this.closePromise = (async () => {
      await this.queue.idle();
      this.listeners.clear();
    })();
    return this.closePromise;
  }

  /** 在记录上同步执行 reducer 并交给后端持久化；reducer 的问题不会写到后端。 */
  private async applyUpdate(id: RunId, reducer: (run: Run) => Run): Promise<Run> {
    if (!this.exists(id)) {
      throw new SwarmError('SWARM_NOT_FOUND', `run ${id} not found`, { details: { runId: id } });
    }

    let persisted: Run;
    try {
      persisted = await this.table.update(id, (raw) => {
        const current = this.parseRecord(id, raw);
        return this.runReducer(id, current, reducer);
      });
    } catch (error) {
      throw normalizeError(error, 'SWARM_STORE_WRITE_FAILED', `update run ${id}`);
    }
    return this.parseRecord(id, persisted);
  }

  /** 执行 reducer 并校验其结果：必须同步返回一个合法的 Run。 */
  private runReducer(id: RunId, current: Run, reducer: (run: Run) => Run): Run {
    let candidate: unknown;
    try {
      candidate = reducer(current);
    } catch (error) {
      // 业务拒绝（CAS 失败、越权、状态机不允许）必须保留自己的错误码，由调用方按 code 区分；
      // 只有非 SwarmError 的抛出才说明 reducer 本身有缺陷。
      if (isSwarmError(error)) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new SwarmError('SWARM_INVALID_REDUCER', `reducer for run ${id} threw: ${detail}`, {
        details: { runId: id },
        cause: error,
      });
    }
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      typeof (candidate as { then?: unknown }).then === 'function'
    ) {
      throw new SwarmError(
        'SWARM_INVALID_REDUCER',
        `reducer for run ${id} must return a Run object synchronously`,
        { details: { runId: id } },
      );
    }
    return parseRun(candidate, 'SWARM_INVALID_REDUCER');
  }

  private async put(record: Run): Promise<void> {
    try {
      await this.table.put(record.id, record);
    } catch (error) {
      throw normalizeError(error, 'SWARM_STORE_WRITE_FAILED', `put run ${record.id}`);
    }
  }

  private read(id: RunId): Run {
    const raw = this.table.get(id);
    if (raw === undefined) {
      throw new SwarmError('SWARM_NOT_FOUND', `run ${id} not found`, { details: { runId: id } });
    }
    return this.parseRecord(id, raw);
  }

  private exists(id: RunId): boolean {
    return this.table.get(id) !== undefined;
  }

  /** 后端记录必须通过 schema 校验；失败报告 `SWARM_STORE_CORRUPT` 并带上原始诊断。 */
  private parseRecord(id: RunId, raw: unknown): Run {
    try {
      return parseRun(raw);
    } catch (error) {
      const issues = isSwarmError(error) && error.details !== null ? (error.details['issues'] ?? null) : null;
      throw new SwarmError('SWARM_STORE_CORRUPT', `run ${id} record is corrupt`, {
        details: { runId: id, issues },
        cause: error,
      });
    }
  }

  private publish(run: Run): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(run);
      } catch (error) {
        this.reportListenerError(error, run);
      }
    }
  }

  /** 订阅者的错误不得把已持久化的更新判为失败；统一上报而不是静默丢弃。 */
  private reportListenerError(error: unknown, run: Run): void {
    try {
      if (this.onListenerError !== undefined) {
        this.onListenerError(error, run);
      } else {
        console.error('[dsh-swarm] state store listener failed', { runId: run.id }, error);
      }
    } catch (handlerError) {
      console.error('[dsh-swarm] state store listener error handler failed', handlerError);
    }
  }

  private assertOpen(operation: string): void {
    if (this.closed) {
      throw new SwarmError('SWARM_STORE_CLOSED', `state store is closed (${operation})`);
    }
  }
}

/** 构造 StateStore 的便捷入口；与 `new MemoryStateStore(...)` 等价。 */
export function createMemoryStateStore(
  table: RunTable,
  options: MemoryStateStoreOptions = {},
): StateStore {
  return new MemoryStateStore(table, options);
}
