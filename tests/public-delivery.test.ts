import { afterEach, describe, expect, it } from 'vitest';
import { Collaboration } from '../src/collaboration.ts';
import { Delivery } from '../src/delivery.ts';
import { matchesWait, pendingNotifications } from '../src/events.ts';
import { PublicCollaboration } from '../src/public-collaboration.ts';
import type { PublicCommand } from '../src/public-input.ts';
import type { NotificationRecord, PublicMessageRecord, ThreadRecord } from '../src/public-types.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import { createRun, type Run, type WorkerRecord } from '../src/types.ts';
import type { WorkerHost } from '../src/ports.ts';
import { collectWorkerNotices } from '../src/worker-context.ts';
import { WORKER_POLICY } from '../src/worker-policy.ts';

class Table implements RunTable {
  records = new Map<string, Run>();
  get(id: string) { return this.records.get(id); }
  entries() { return this.records.entries(); }
  async put(id: string, run: Run) { this.records.set(id, structuredClone(run)); }
  async update(id: string, fn: (run: Run) => Run) {
    const run = structuredClone(fn(this.records.get(id)!)); this.records.set(id, run); return run;
  }
}
function worker(id: string): WorkerRecord {
  return { id, sessionId: `s-${id}`, branch: id, worktreePath: '/repo', initializationState: 'ready',
    initializationError: null, unavailableReason: null, offeredSeq: 0, observedSeq: 0, notifiedSeq: 0,
    wakeTargetSeq: 0, waitRegistration: null, currentTaskId: null, createdAt: 0 };
}
class Host implements WorkerHost {
  notices: { workerId: string; seq: number; notifications: readonly NotificationRecord[] }[] = [];
  statuses = new Map<string, 'running' | 'inactive' | 'unavailable'>([['s-a', 'running'], ['s-b', 'running'], ['s-c', 'running']]);
  settled: ((sessionId: string, activationId: string, failed: boolean) => void) | null = null;
  beforeNotify: (() => Promise<void>) | null = null;
  async start() {}
  async notify(_run: Run, worker: WorkerRecord, seq: number, _signal: AbortSignal, notifications: readonly NotificationRecord[] = []) {
    await this.beforeNotify?.(); this.notices.push({ workerId: worker.id, seq, notifications });
  }
  async stop() {}
  isOwnerLive() { return true; }
  isWorkerBusy(sessionId: string) { return this.workerStatus(sessionId) === 'running'; }
  workerStatus(sessionId: string) { return this.statuses.get(sessionId) ?? 'unavailable'; }
  onSettled(listener: NonNullable<Host['settled']>) { this.settled = listener; return () => { this.settled = null; }; }
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((dispose) => dispose())); });
async function harness() {
  const store = new MemoryStateStore(new Table());
  const run = createRun({ id: 'r', ownerSessionId: 'owner', repositoryRoot: '/repo', gitCommonDir: '/repo/.git',
    goal: 'public delivery', acceptanceCriteria: ['separate cursors'], verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
    baseCommit: 'a'.repeat(40), resultRef: 'refs/heads/result', deadline: null, createdAt: 0 });
  run.phase = 'running'; run.workers = { a: worker('a'), b: worker('b'), c: worker('c') };
  await store.create(run);
  let count = 0;
  const api = new PublicCollaboration(store, { id: () => `public-${++count}`, now: () => 100 });
  const legacy = new Collaboration(store);
  const call = (who: string, command: PublicCommand) => api.execute(`s-${who}`, command, `call-${++count}`);
  const thread = await call('a', { action: 'create_thread', channelId: 'r:general', title: 'Protocol' }) as ThreadRecord;
  const post = (who: string, body: string, extra: Partial<Extract<PublicCommand, { action: 'post' }>> = {}) =>
    call(who, { action: 'post', threadId: thread.id, body, ...extra }) as Promise<PublicMessageRecord>;
  const host = new Host();
  const errors: unknown[] = [];
  let permits = 0;
  let releases = 0;
  const delivery = new Delivery(store, host, {
    admitWorkerOperation: async () => { permits++; return { signal: new AbortController().signal, release: () => { releases++; } }; },
    onError: (_run, error) => { errors.push(error); },
  });
  disposers.push(() => delivery.dispose());
  return { store, api, legacy, call, thread, post, host, delivery, errors, counts: () => ({ permits, releases }) };
}

describe('public notification delivery and bounded context', () => {
  it('A asks B: only B steers, C can read and participate, and summaries never ACK full messages', async () => {
    const h = await harness();
    const message = await h.post('a', 'PRIVATE-TO-NO-ONE-BUT-ON-DEMAND-BODY', { mentions: ['b'], responseRequestedFrom: ['b'] });
    await h.delivery.idle();
    expect(h.host.notices.map((item) => item.workerId)).toEqual(['b']);
    expect(h.host.notices[0]?.notifications[0]).toMatchObject({ messageId: message.id, priority: 'immediate' });
    expect(h.counts()).toEqual({ permits: 1, releases: 1 });
    const pending = pendingNotifications(h.store.get('r'), 'b')[0]!;
    expect(pending.deliveredAt).not.toBeNull();
    expect(pending.acknowledgedAt).toBeNull();
    expect(h.store.get('r').workers.b).toMatchObject({ offeredSeq: 0, observedSeq: 0, wakeTargetSeq: 0 });
    const context = collectWorkerNotices(h.store.get('r'), 'c', 0, { peerNoticeItems: 2, peerNoticeChars: 40 });
    expect(JSON.stringify(context)).not.toContain(message.body);
    expect(context.updates).toHaveLength(1);
    expect(context.attention).toEqual([]);
    expect(h.store.get('r').channelReads).toEqual({});
    expect((await h.api.query('s-c', { view: 'messages', messageId: message.id })).items).toHaveLength(1);
    await h.post('c', 'I can help');
    await h.delivery.idle();
    expect(h.host.notices.map((item) => item.workerId)).toEqual(['b']);
  });

  it('event ACK does not erase attention or permit wait; notification ACK is not a response', async () => {
    const h = await harness();
    await h.post('a', 'Please answer', { responseRequestedFrom: ['b'] });
    await h.delivery.idle();
    const page = await h.legacy.sync('s-b');
    await h.legacy.sync('s-b', { ackSeq: page.throughSeq });
    const waiting = await h.legacy.wait('s-b', { afterSeq: page.throughSeq }, 'wait');
    expect(waiting.waiting).toBe(false);
    expect(waiting.events).toEqual([]);
    expect(waiting.attentionTotal).toBeGreaterThan(0);
    const notices = pendingNotifications(h.store.get('r'), 'b');
    await h.call('b', { action: 'ack_notifications', notifications: notices.map(({ id, seq }) => ({ id, seq })) });
    await h.delivery.kick('r');
    expect(h.host.notices).toHaveLength(1);
    expect(Object.values(h.store.get('r').responseRequests)[0]?.status).toBe('pending');
    expect((await h.legacy.wait('s-b', { afterSeq: page.throughSeq }, 'wait2')).waiting).toBe(true);
  });

  it('wait/settled gate keeps an addressed event pending before activation settlement', async () => {
    const h = await harness();
    const page = await h.legacy.sync('s-b');
    expect((await h.legacy.wait('s-b', { afterSeq: page.throughSeq }, 'wait')).waiting).toBe(true);
    await h.post('a', 'Mention after wait', { mentions: ['b'] });
    await h.delivery.idle();
    expect(h.host.notices).toEqual([]);
    const run = h.store.get('r');
    const event = run.events.at(-1)!;
    expect(matchesWait(run, run.workers.b!, event)).toBe(true);
    expect(matchesWait(run, { ...run.workers.c!, waitRegistration: run.workers.b!.waitRegistration }, event)).toBe(false);
    h.host.settled?.('s-b', 'activation-b', false);
    await h.delivery.idle();
    expect(h.host.notices).toHaveLength(1);
    h.host.settled?.('s-b', 'activation-b', false);
    await h.delivery.idle();
    expect(h.host.notices).toHaveLength(1);
  });

  it('ordinary subscription updates coalesce and never bury priority requests in bounded output', async () => {
    const h = await harness();
    await h.call('b', { action: 'subscribe', channelId: h.thread.channelId, threadId: h.thread.id, mode: 'following' });
    await h.post('a', 'Answer this first', { responseRequestedFrom: ['b'] });
    await h.delivery.idle();
    for (let i = 0; i < 30; i++) await h.post('a', `ordinary ${i}`);
    await h.delivery.idle();
    expect(h.host.notices).toHaveLength(1);
    const context = collectWorkerNotices(h.store.get('r'), 'b', 0, { peerNoticeItems: 1, peerNoticeChars: 40 });
    expect(context.attention[0]).toMatchObject({ reasons: ['response_request'] });
    expect(context.attentionHasMore).toBe(true);
    expect(context.updates).toHaveLength(1);
    expect(context.updates[0]).toMatchObject({ kind: 'public', activityCount: 33 });
    expect(JSON.stringify(context)).not.toContain('ordinary 29');
    h.host.statuses.set('s-b', 'inactive');
    await h.delivery.kick('r', 'b');
    expect(h.host.notices).toHaveLength(2);
    expect(h.host.notices[1]?.notifications).toHaveLength(1);
    expect(h.host.notices[1]?.notifications[0]?.priority).toBe('digest');
    await h.delivery.kick('r', 'b');
    expect(h.host.notices).toHaveLength(2);
  });

  it('pause keeps pending, explicit resume redelivers independent of global cursor, stop never starts', async () => {
    const h = await harness();
    await h.store.update('r', (run) => ({ ...run, phase: 'paused' }));
    // Simulate a notification persisted before a control boundary, not an unauthorized paused mutation.
    await h.store.update('r', (run) => ({ ...run, phase: 'running' }));
    h.host.statuses.set('s-b', 'unavailable');
    await h.post('a', 'pending request', { responseRequestedFrom: ['b'] });
    await h.store.update('r', (run) => ({ ...run, phase: 'paused' }));
    h.host.statuses.set('s-b', 'inactive');
    await h.delivery.kick('r', 'b');
    expect(h.host.notices).toEqual([]);
    expect(pendingNotifications(h.store.get('r'), 'b')[0]?.deliveredAt).toBeNull();
    await h.store.update('r', (run) => ({ ...run, phase: 'running' }));
    await h.delivery.resume('r', 'b');
    await h.delivery.idle();
    expect(h.host.notices.some((item) => item.notifications.length > 0)).toBe(true);
    const before = h.host.notices.length;
    await h.store.update('r', (run) => ({ ...run, phase: 'stopped' }));
    h.host.settled?.('s-b', 'after-stop', false);
    await h.delivery.kick('r', 'b');
    await h.delivery.idle();
    expect(h.host.notices).toHaveLength(before);
    expect(h.errors).toEqual([]);
  });

  it('a coalesced update during an in-flight send is not stamped delivered by the old receipt', async () => {
    const h = await harness();
    await h.call('b', { action: 'subscribe', channelId: h.thread.channelId, threadId: h.thread.id, mode: 'following' });
    h.host.statuses.set('s-b', 'inactive');
    const enteredFirst = barrier();
    const releaseFirst = barrier();
    const enteredSecond = barrier();
    const releaseSecond = barrier();
    let sending = 0;
    h.host.beforeNotify = async () => {
      if (++sending === 1) { enteredFirst.resolve(); await releaseFirst.promise; }
      else { enteredSecond.resolve(); await releaseSecond.promise; }
    };
    await h.post('a', 'first digest');
    await enteredFirst.promise;
    const firstSeq = pendingNotifications(h.store.get('r'), 'b')[0]!.seq;
    await h.post('a', 'new version while old notification is in flight');
    const latest = pendingNotifications(h.store.get('r'), 'b')[0]!;
    expect(latest.seq).toBeGreaterThan(firstSeq);
    releaseFirst.resolve();
    await enteredSecond.promise;
    expect(h.store.get('r').notifications[latest.id]?.deliveredAt).toBeNull();
    releaseSecond.resolve();
    await h.delivery.idle();
    expect(h.host.notices).toHaveLength(2);
    expect(h.store.get('r').notifications[latest.id]?.deliveredAt).not.toBeNull();
    expect(h.store.get('r').notifications[latest.id]?.acknowledgedAt).toBeNull();
  });

  it('cold delivery replays unacknowledged attention after global event ACK without repeating mutation', async () => {
    const h = await harness();
    await h.post('a', 'pending', { responseRequestedFrom: ['b'] });
    await h.delivery.idle();
    const page = await h.legacy.sync('s-b');
    await h.legacy.sync('s-b', { ackSeq: page.throughSeq });
    await h.delivery.dispose();
    const recovery = new Delivery(h.store, h.host, {
      admitWorkerOperation: async () => ({ signal: new AbortController().signal, release() {} }),
      onError: (_run, error) => { throw error; },
    });
    disposers.push(() => recovery.dispose());
    await recovery.kick('r', 'b');
    await recovery.idle();
    expect(h.host.notices).toHaveLength(2);
    expect(Object.keys(h.store.get('r').publicMessages)).toHaveLength(1);
    expect(Object.keys(h.store.get('r').responseRequests)).toHaveLength(1);
    expect(h.store.get('r').workers.b?.observedSeq).toBe(page.throughSeq);
  });

  it('worker policy separates public coordination, private exceptions, responses and explicit consent', () => {
    expect(WORKER_POLICY).toContain('Public channels and threads are the default');
    expect(WORKER_POLICY).toContain('private swarm_message only');
    expect(WORKER_POLICY).toContain('Neither silence');
    expect(WORKER_POLICY).toContain('Summary notices are not full-message reads');
  });
});
