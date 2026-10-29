/**
 * 每个 worker 一个串行投递队列：把**已持久化**的 pending 转成一次 Host.start 或
 * Host.notify。
 *
 * 职责边界（notes/runtime-contract.md）：
 * - start 只保证“已发布”（host.start resolve），不等待 activation 结算；
 *   结算由 `host.onSettled(sessionId, activationId, failed)` 回报。
 * - notify 前必须 `admitWorkerOperation(...)` 取得许可，`release` 放在 finally。
 * - 持久 pending 是 `WorkerRecord.wakeTargetSeq`，通知上界是 `notifiedSeq`，
 *   明确已读是 `observedSeq`；本模块只写 `notifiedSeq`，不改 offered/observed。
 * - 不建立模型循环、不轮询、不调用 `host.stop`（由 Runtime 负责）。
 */

import { isSwarmError, SwarmError } from './errors.ts';
import { pendingNotifications } from './events.ts';
import type { NotificationRecord } from './public-types.ts';
import type { WorkerHost } from './ports.ts';
import { SerialQueue } from './serial.ts';
import type { StateStore } from './store.ts';
import type { EventSeq, Run, RunId, WorkerId, WorkerRecord } from './types.ts';

/** 一次受控 worker 操作的许可；`release` 必须放在 finally 中调用。 */
export interface OperationPermit {
  signal: AbortSignal;
  release(): void;
}

export interface DeliveryOptions {
  /** 由 Runtime 提供的 admission：检查 run 状态/预算并登记在途操作。 */
  admitWorkerOperation(runId: string, workerId: string, kind: 'create' | 'notify'): Promise<OperationPermit>;
  /** 非预期失败（activation failed、连续空转、store 写失败）的上报通道。 */
  onError(runId: string, error: unknown): void;
}

/** 已处理 settled 回调的激活 id 记忆上限（只做防御性去重）。 */
const SETTLED_MEMORY = 512;

/** admission 的“预期拒绝”：run 暂停/停止/超预算时保留 pending，不算失败。 */
const EXPECTED_REJECTIONS: ReadonlySet<string> = new Set<string>([
  'SWARM_NOT_RUNNING',
  'SWARM_BUDGET_EXHAUSTED',
  'SWARM_STORE_CLOSED',
]);

interface WorkerState {
  /** 该 worker 的全部投递操作串行执行。 */
  readonly queue: SerialQueue;
  /** 已排队但尚未执行的 drain 请求（合并同一 tick 的多次触发）。 */
  requested: boolean;
  /** 当前正在执行的 drain 循环；null 表示队列空闲。 */
  loop: Promise<void> | null;
  /** activation 代际：每次 settled 回调 +1，用于区分“同一活跃 activation 内”。 */
  generation: number;
  /** 最近一次被接受的通知发生在哪一代。 */
  notifiedGeneration: number;
  /** Notification id/version pairs delivered in this activation; never a read/response ACK. */
  publicNotified: Map<string, number>;
  /** 最近一次被接受的通知上界（仅诊断用，权威值是 notifiedSeq）。 */
  lastNotifiedSeq: EventSeq | null;
  /** 上一次 settled 时的业务进度标记，用于检测连续空转。 */
  settledMarker: string | null;
  /** 连续多少次 settled 没有 cursor 或业务进展。 */
  settledWithoutProgress: number;
  /**
   * wait 屏障：true 表示“等待中的 activation 不能被打断”。
   * 初始为 true；settled 时打开一次（允许一次投递），通知被接受后重新关上。
   */
  waitGateClosed: boolean;
}

type WorkerStatus = 'running' | 'inactive' | 'unavailable';
const NOTIFICATION_BATCH_SIZE = 20;
interface DeliveryTarget {
  throughSeq: EventSeq;
  notifications: NotificationRecord[];
}

/**
 * 把持久 pending 转成 Host 投递动作。
 *
 * @throws SwarmError `SWARM_STORE_CLOSED` —— 已 dispose 时拒绝新的 start/kick。
 */
export class Delivery {
  private readonly store: StateStore;
  private readonly host: WorkerHost;
  private readonly options: DeliveryOptions;
  private readonly states = new Map<string, WorkerState>();
  /** sessionId → 所属 run/worker；settled 回调只带 sessionId。 */
  private readonly sessionIndex = new Map<string, { runId: RunId; workerId: WorkerId }>();
  private readonly settledSeen = new Set<string>();
  private readonly settledOrder: string[] = [];
  private readonly unsubscribeStore: () => void;
  private readonly unsubscribeSettled: () => void;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  constructor(store: StateStore, host: WorkerHost, options: DeliveryOptions) {
    this.store = store;
    this.host = host;
    this.options = options;
    this.unsubscribeStore = store.subscribe((run) => this.onStoreChange(run));
    this.unsubscribeSettled = host.onSettled((sessionId, activationId, failed) =>
      this.onSettled(sessionId, activationId, failed),
    );
  }

  /**
   * 发布一次 worker 创建请求并等待 host.start resolve（即“已发布”，不是结算）。
   *
   * @throws 透传 host.start / admission 的错误，由 Runtime 决定如何收尾。
   */
  async start(runId: RunId, workerId: WorkerId): Promise<void> {
    this.assertActive('start');
    const state = this.workerState(runId, workerId);
    return state.queue.run(async () => {
      this.assertActive('start');
      const run = this.readRun(runId);
      if (run === null) {
        throw new SwarmError('SWARM_NOT_FOUND', `run ${runId} not found`, { details: { runId } });
      }
      const worker = run.workers[workerId];
      if (worker === undefined) {
        throw new SwarmError('SWARM_NOT_FOUND', `worker ${workerId} not found in run ${runId}`, {
          details: { runId, workerId },
        });
      }
      this.sessionIndex.set(worker.sessionId, { runId, workerId });

      const permit = await this.options.admitWorkerOperation(runId, workerId, 'create');
      try {
        if (permit.signal.aborted) {
          return;
        }
        await this.host.start({ run, worker, signal: permit.signal });
      } finally {
        permit.release();
      }
    });
  }

  /** Explicit user resume wakes a retained Session even without unread events. */
  async resume(runId: RunId, workerId: WorkerId): Promise<void> {
    this.assertActive('resume');
    const state = this.workerState(runId, workerId);
    await state.queue.run(async () => {
      const run = this.store.get(runId);
      const worker = run.workers[workerId];
      if (!worker) throw new SwarmError('SWARM_NOT_FOUND', 'Worker no longer exists');
      const permit = await this.options.admitWorkerOperation(runId, workerId, 'notify');
      try {
        permit.signal.throwIfAborted();
        const through = Math.max(worker.observedSeq, run.nextSeq - 1);
        const notifications = pendingNotifications(run, worker.id).slice(0, NOTIFICATION_BATCH_SIZE);
        await this.host.notify(run, worker, through, permit.signal, notifications);
        state.notifiedGeneration = state.generation;
        state.lastNotifiedSeq = through;
        state.publicNotified.clear();
        for (const item of notifications) state.publicNotified.set(item.id, item.seq);
        await this.recordNotified(runId, workerId, through, notifications);
        state.waitGateClosed = true;
        state.settledMarker = null;
        state.settledWithoutProgress = 0;
      } finally {
        permit.release();
      }
    });
  }

  /**
   * 重新检查该 run（或其中某个 worker）的 pending 并尝试投递。
   *
   * 返回的 promise 覆盖本次 drain 完成；由于队列串行，重复调用会合并。
   * 内部失败走 `onError`，因此正常路径不会 reject。
   */
  async kick(runId: RunId, workerId?: WorkerId): Promise<void> {
    this.assertActive('kick');
    if (workerId !== undefined) {
      return this.kickWorker(runId, workerId);
    }
    const run = this.readRun(runId);
    if (run === null) {
      return Promise.resolve();
    }
    return Promise.all(Object.keys(run.workers).map((id) => this.kickWorker(runId, id))).then(() => undefined);
  }

  /** 等待所有已排队（含合并的 drain 循环）的投递结束。 */
  async idle(): Promise<void> {
    // settled/store 回调通过 queueMicrotask 入场；先让它们登记完再等队列。
    await Promise.resolve();
    await Promise.resolve();
    await Promise.all([...this.states.values()].map((state) => state.queue.idle()));
  }

  /**
   * 移除订阅与 settled 监听、拒绝新操作，然后排空在途投递。
   * 不调用 `host.stop`：run 的资源静止由 Runtime 负责。可重复调用。
   */
  dispose(): Promise<void> {
    if (this.disposePromise !== null) {
      return this.disposePromise;
    }
    this.disposed = true;
    this.unsubscribeStore();
    this.unsubscribeSettled();
    this.disposePromise = (async () => {
      await this.idle();
      this.states.clear();
      this.sessionIndex.clear();
      this.settledSeen.clear();
      this.settledOrder.length = 0;
    })();
    return this.disposePromise;
  }

  /* ---------------------------------------------------------------- */
  /* 调度                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * store 变更只调度“确实有新东西”的 worker：新推进的 wakeTargetSeq，或未读直接消息。
   * cursor 写回（notifiedSeq/offeredSeq/observedSeq）不会自激。
   */
  private onStoreChange(run: Run): void {
    if (this.disposed) {
      return;
    }
    for (const worker of Object.values(run.workers)) {
      this.sessionIndex.set(worker.sessionId, { runId: run.id, workerId: worker.id });
      if (worker.wakeTargetSeq > worker.observedSeq || latestUnreadMessageSeq(run, worker) !== null
        || pendingNotifications(run, worker.id).length > 0) {
        this.scheduleKick(run.id, worker.id);
      }
    }
  }

  /**
   * Host settled 回调：按 activationId 去重，记录该 session 已结算，然后**在微任务里**
   * 重新调度——绝不在 Host 的同步 emit 栈里重入 Agent 创建或投递。
   */
  private onSettled(sessionId: string, activationId: string, failed: boolean): void {
    if (this.disposed) {
      return;
    }
    if (this.rememberSettled(activationId)) {
      return;
    }
    const location = this.locate(sessionId);
    if (location === null) {
      return;
    }
    queueMicrotask(() => {
      void this.settlePass(location.runId, location.workerId, activationId, failed);
    });
  }

  private scheduleKick(runId: RunId, workerId: WorkerId): void {
    queueMicrotask(() => {
      if (this.disposed) {
        return;
      }
      void this.kickWorker(runId, workerId);
    });
  }

  /** 合并同一 tick 的请求：一个 drain 循环跑到 `requested` 清空为止。 */
  private kickWorker(runId: RunId, workerId: WorkerId): Promise<void> {
    const state = this.workerState(runId, workerId);
    state.requested = true;
    if (state.loop === null) {
      state.loop = state.queue.run(async () => {
        try {
          while (state.requested && !this.disposed) {
            state.requested = false;
            await this.deliverOnce(runId, workerId);
          }
        } finally {
          state.loop = null;
        }
      });
    }
    return state.loop;
  }

  /* ---------------------------------------------------------------- */
  /* 投递判定                                                          */
  /* ---------------------------------------------------------------- */

  private async deliverOnce(runId: RunId, workerId: WorkerId): Promise<void> {
    const run = this.readRun(runId);
    if (run === null) {
      return;
    }
    const worker = run.workers[workerId];
    if (worker === undefined) {
      return;
    }
    this.sessionIndex.set(worker.sessionId, { runId, workerId });
    // paused/stopped/draining/quiescing 一律不发，pending 原样保留。
    if (run.phase !== 'running' || worker.initializationState !== 'ready') {
      return;
    }

    const state = this.workerState(runId, workerId);
    const status = this.workerStatus(worker.sessionId);
    const target = this.selectTarget(run, worker, status, state);
    if (target === null) {
      return;
    }

    try {
      const permit = await this.options.admitWorkerOperation(runId, workerId, 'notify');
      try {
        if (permit.signal.aborted) {
          return;
        }
        await this.host.notify(run, worker, target.throughSeq, permit.signal, target.notifications);
      } finally {
        permit.release();
      }
    } catch (error) {
      if (isExpectedRejection(error)) {
        return;
      }
      // 投递失败：若该 activation 仍在等待，屏障重新关上，避免在 wait 期间反复打断。
      state.waitGateClosed = worker.waitRegistration !== null && status === 'running';
      this.report(runId, error);
      return;
    }

    state.notifiedGeneration = state.generation;
    state.lastNotifiedSeq = target.throughSeq;
    for (const item of target.notifications) state.publicNotified.set(item.id, item.seq);
    state.waitGateClosed = true;
    try {
      await this.recordNotified(runId, workerId, target.throughSeq, target.notifications);
    } catch (error) {
      // 已通知但没记上界：允许 at-least-once 重投，但必须让上层知道。
      this.report(runId, error);
    }
  }

  /**
   * 选出本次通知的 throughSeq；null 表示“现在不该发”。
   *
   * 规则：
   * - 有 waitRegistration 且 activation 仍在跑：等 settled，普通事件只置 pending。
   * - 无 wait 且 activation 在跑：只有最新未读直接消息可以 steer，普通 finding 留待 sync。
   * - activation 不在跑：用 wakeTargetSeq 或未读直接消息整体唤醒。
   * - 同一 activation 内同一 target 只通知一次；新 settled 但没 ack 允许重投同 ID。
   */
  private selectTarget(
    run: Run,
    worker: WorkerRecord,
    status: WorkerStatus,
    state: WorkerState,
  ): DeliveryTarget | null {
    if (status === 'unavailable') {
      return null;
    }
    const unreadMessage = latestUnreadMessageSeq(run, worker);
    const pendingWake = worker.wakeTargetSeq > worker.observedSeq ? worker.wakeTargetSeq : null;
    const waiting = worker.waitRegistration !== null && status === 'running';

    // 等待中的 activation 不能被打断：pending 只置位，settled 之后才发。
    if (waiting && state.waitGateClosed) {
      return null;
    }
    // 刚刚 settled、但 wait 登记还没被业务代码清掉：整批 pending 都可以发。
    const afterSettle = waiting && !state.waitGateClosed;

    const active = status === 'running' && !afterSettle;
    const pending = pendingNotifications(run, worker.id);
    const pendingIds = new Set(pending.map((item) => item.id));
    for (const id of state.publicNotified.keys()) {
      if (!pendingIds.has(id)) state.publicNotified.delete(id);
    }
    const notifications = pending.filter((item) => (!active || item.priority === 'immediate')
      && state.publicNotified.get(item.id) !== item.seq).slice(0, NOTIFICATION_BATCH_SIZE);

    // Ordinary public updates coalesce until an idle/settled boundary; explicit requests steer.
    let legacy = active ? unreadMessage : maxSeq(pendingWake, unreadMessage);
    if (legacy !== null && legacy <= worker.notifiedSeq && state.notifiedGeneration === state.generation) legacy = null;
    const throughSeq = maxSeq(legacy, notifications.length ? Math.max(...notifications.map((item) => item.seq)) : null);
    return throughSeq === null ? null : { throughSeq, notifications };
  }

  /** settled 之后：推进代际、检测连续空转，然后重新尝试投递。 */
  private async settlePass(
    runId: RunId,
    workerId: WorkerId,
    activationId: string,
    failed: boolean,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }
    const state = this.workerState(runId, workerId);
    state.generation += 1;
    state.publicNotified.clear();
    // 该 activation 已结束：允许一次“即便还有 wait 登记也要发”的投递。
    state.waitGateClosed = false;

    if (failed) {
      this.report(
        runId,
        new SwarmError(
          'SWARM_INTERNAL',
          `worker ${workerId} activation ${activationId} failed`,
          { details: { runId, workerId, activationId } },
        ),
      );
      return;
    }

    if (!this.trackProgress(runId, workerId, activationId, state)) return;

    try {
      await this.kickWorker(runId, workerId);
      await this.continueAfterSettle(runId, workerId, state);
    } catch (error) {
      this.report(runId, error);
    }
  }

  /** Continue an ordinary finished activation, not an explicit wait or a stopped run. */
  private async continueAfterSettle(runId: RunId, workerId: WorkerId, state: WorkerState): Promise<void> {
    await state.queue.run(async () => {
      if (this.disposed || state.notifiedGeneration === state.generation) return;
      const run = this.readRun(runId);
      const worker = run?.workers[workerId];
      if (!run || run.phase !== 'running' || !worker || worker.initializationState !== 'ready'
        || worker.waitRegistration !== null || this.workerStatus(worker.sessionId) !== 'inactive'
        || this.host.isWorkerBusy(worker.sessionId)) return;
      try {
        const permit = await this.options.admitWorkerOperation(runId, workerId, 'notify');
        try {
          permit.signal.throwIfAborted();
          const through = Math.max(worker.observedSeq, run.nextSeq - 1);
          // No task is assigned here: peers choose what to inspect, claim, help with, or finish.
          await this.host.notify(run, worker, through, permit.signal);
          state.notifiedGeneration = state.generation;
          state.lastNotifiedSeq = through;
          state.waitGateClosed = true;
          await this.recordNotified(runId, workerId, through);
        } finally {
          permit.release();
        }
      } catch (error) {
        if (!isExpectedRejection(error)) this.report(runId, error);
      }
    });
  }

  /**
   * 连续两次 settled 既没有 cursor 前进也没有新业务事件时上报，建议上层暂停该 run。
   * 返回 false 时本轮不得继续唤醒；实际暂停由 Runtime 负责。
   */
  private trackProgress(runId: RunId, workerId: WorkerId, activationId: string, state: WorkerState): boolean {
    const run = this.readRun(runId);
    if (run === null || run.phase !== 'running') {
      return false;
    }
    const worker = run.workers[workerId];
    if (worker === undefined) {
      return false;
    }
    const attention = pendingNotifications(run, workerId).map((item) => `${item.id}:${item.seq}`).join(',');
    const marker = `${worker.observedSeq}:${run.nextSeq}:${attention}`;
    if (state.settledMarker !== null && marker === state.settledMarker) {
      state.settledWithoutProgress += 1;
    } else {
      state.settledWithoutProgress = 0;
    }
    state.settledMarker = marker;
    // 连续两次 settled 既没有 cursor 前进也没有新业务事件。
    if (state.settledWithoutProgress < 1) {
      return true;
    }
    state.settledWithoutProgress = 0;
    this.report(
      runId,
      new SwarmError(
        'SWARM_WORKER_BUSY',
        `worker ${workerId} settled twice without progress after activation ${activationId}; consider pausing the run`,
        { details: { runId, workerId, activationId, observedSeq: worker.observedSeq } },
      ),
    );
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* 持久化与辅助                                                      */
  /* ---------------------------------------------------------------- */

  /** 记录通知已被 inbox 接受的上界；不改 offered/observed。 */
  private async recordNotified(runId: RunId, workerId: WorkerId, throughSeq: EventSeq,
    delivered: readonly NotificationRecord[] = []): Promise<void> {
    await this.store.update(runId, (run) => {
      const worker = run.workers[workerId];
      if (worker === undefined) return run;
      let changed = worker.notifiedSeq < throughSeq;
      const notifications = { ...run.notifications };
      const now = Date.now();
      for (const sent of delivered) {
        const current = notifications[sent.id];
        // A concurrent coalescing update must not be marked delivered by an older receipt.
        if (current?.workerId !== workerId || current.seq !== sent.seq || current.deliveredAt !== null) continue;
        notifications[sent.id] = { ...current, deliveredAt: now };
        changed = true;
      }
      if (!changed) return run;
      return { ...run, notifications, revision: run.revision + 1, updatedAt: Math.max(run.updatedAt, now),
        workers: { ...run.workers, [workerId]: { ...worker, notifiedSeq: Math.max(worker.notifiedSeq, throughSeq) } } };
    });
  }

  private readRun(runId: RunId): Run | null {
    try {
      return this.store.get(runId);
    } catch (error) {
      if (isExpectedRejection(error)) {
        return null;
      }
      throw error;
    }
  }

  private workerStatus(sessionId: string): WorkerStatus {
    try {
      return this.host.workerStatus(sessionId);
    } catch {
      return 'unavailable';
    }
  }

  private workerState(runId: RunId, workerId: WorkerId): WorkerState {
    const key = `${runId}\u0000${workerId}`;
    let state = this.states.get(key);
    if (state === undefined) {
      state = {
        queue: new SerialQueue(),
        requested: false,
        loop: null,
        generation: 0,
        notifiedGeneration: -1,
        publicNotified: new Map(),
        lastNotifiedSeq: null,
        settledMarker: null,
        settledWithoutProgress: 0,
        waitGateClosed: true,
      };
      this.states.set(key, state);
    }
    return state;
  }

  private locate(sessionId: string): { runId: RunId; workerId: WorkerId } | null {
    const known = this.sessionIndex.get(sessionId);
    if (known !== undefined) {
      return known;
    }
    try {
      for (const run of this.store.list()) {
        for (const worker of Object.values(run.workers)) {
          this.sessionIndex.set(worker.sessionId, { runId: run.id, workerId: worker.id });
          if (worker.sessionId === sessionId) {
            return { runId: run.id, workerId: worker.id };
          }
        }
      }
    } catch (error) {
      if (!isExpectedRejection(error)) {
        throw error;
      }
    }
    return null;
  }

  /** @returns true 表示这个 activationId 已经处理过（重复回调）。 */
  private rememberSettled(activationId: string): boolean {
    if (this.settledSeen.has(activationId)) {
      return true;
    }
    this.settledSeen.add(activationId);
    this.settledOrder.push(activationId);
    if (this.settledOrder.length > SETTLED_MEMORY) {
      const evicted = this.settledOrder.shift();
      if (evicted !== undefined) {
        this.settledSeen.delete(evicted);
      }
    }
    return false;
  }

  private report(runId: RunId, error: unknown): void {
    try {
      this.options.onError(runId, error);
    } catch (handlerError) {
      console.error('[dsh-swarm] delivery onError handler failed', handlerError);
    }
  }

  private assertActive(operation: string): void {
    if (this.disposed) {
      throw new SwarmError('SWARM_STORE_CLOSED', `delivery is disposed (${operation})`);
    }
  }
}

/** 该 worker 可见且未被确认的最新直接消息 seq。 */
function latestUnreadMessageSeq(run: Run, worker: WorkerRecord): EventSeq | null {
  let latest: EventSeq | null = null;
  for (const event of run.events) {
    if (event.kind !== 'message' || event.targetWorkerId !== worker.id) {
      continue;
    }
    if (event.seq <= worker.observedSeq) {
      continue;
    }
    if (latest === null || event.seq > latest) {
      latest = event.seq;
    }
  }
  return latest;
}

function maxSeq(a: EventSeq | null, b: EventSeq | null): EventSeq | null {
  return a === null ? b : b === null ? a : Math.max(a, b);
}

function isExpectedRejection(error: unknown): boolean {
  return isSwarmError(error) && EXPECTED_REJECTIONS.has(error.code);
}