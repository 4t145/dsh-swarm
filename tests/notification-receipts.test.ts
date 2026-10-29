import { afterEach, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { createToolResultMessage, createUserMessage, ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { Collaboration } from '../src/collaboration.ts';
import { PublicCollaboration } from '../src/public-collaboration.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import { createRun, type JsonValue, type Run, type WorkerRecord } from '../src/types.ts';
import type { AgreementRecord, PublicMessageRecord, ThreadRecord } from '../src/public-types.ts';
import type { PublicCommand } from '../src/public-input.ts';
import { pendingNotifications, shownEventSeq } from '../src/events.ts';
import { collectWorkerNotices } from '../src/worker-context.ts';
import { receiptContext, receiptFromEvent, toolReceiptMeta, type ShownReceipt } from '../src/notification-receipts.ts';
import { registerWorkerReceipts, type WorkerReceipts } from '../src/worker-receipts.ts';

class Table implements RunTable {
  records = new Map<string, Run>();
  fail = false;
  get(id: string) { return this.records.get(id); }
  entries() { return this.records.entries(); }
  async put(id: string, run: Run) { this.records.set(id, structuredClone(run)); }
  async update(id: string, reduce: (run: Run) => Run) {
    if (this.fail) throw new Error('receipt store unavailable');
    const next = reduce(structuredClone(this.records.get(id)!));
    this.records.set(id, next); return next;
  }
}
function worker(id: string): WorkerRecord {
  return { id, sessionId: `s-${id}`, branch: id, worktreePath: '/repo', initializationState: 'ready',
    initializationError: null, unavailableReason: null, offeredSeq: 0, observedSeq: 0, notifiedSeq: 0,
    wakeTargetSeq: 0, waitRegistration: null, currentTaskId: null, createdAt: 0 };
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup() {
  const ctx = new Context();
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjectionRegistry);
  const session = ctx.sessions.create(SessionId('s-b'));
  // Controlled durability adapter; other tests add explicit failure/barrier listeners.
  const persistedMessages: unknown[][] = [];
  ctx.on('session/flush', (current) => { persistedMessages.push(current.deriveMessages()); });
  const table = new Table();
  const store = new MemoryStateStore(table);
  const run = createRun({ id: 'r', ownerSessionId: 'owner', repositoryRoot: '/repo', gitCommonDir: '/repo/.git',
    goal: 'automatic receipts', acceptanceCriteria: ['no model ACK'], verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1 }] },
    baseCommit: 'a'.repeat(40), resultRef: 'refs/heads/result', deadline: null, createdAt: 0 });
  run.phase = 'running'; run.workers = { a: worker('a'), b: worker('b'), c: worker('c') };
  await store.create(run);
  let count = 0;
  const collaboration = new Collaboration(store, { now: () => 42, id: () => `legacy-${++count}` });
  const api = new PublicCollaboration(store, { now: () => 42, id: () => `public-${++count}` });
  const call = (who: string, command: PublicCommand) => api.execute(`s-${who}`, command, `call-${++count}`);
  const thread = await call('a', { action: 'create_thread', channelId: 'r:general', title: 'Interfaces' }) as ThreadRecord;
  const post = (body: string, extra: Partial<Extract<PublicCommand, { action: 'post' }>> = {}) =>
    call('a', { action: 'post', threadId: thread.id, body, ...extra }) as Promise<PublicMessageRecord>;
  const registrations: WorkerReceipts[] = [];
  const register = () => { const receipts = registerWorkerReceipts(ctx, collaboration); registrations.push(receipts); return receipts; };
  const receipts = register();
  cleanup.push(async () => { for (const registration of registrations) await registration.dispose(); await store.close(); await ctx.fiber.dispose(); });
  const context = () => {
    const run = store.get('r');
    const from = shownEventSeq(run.workers.b!);
    const page = collectWorkerNotices(run, 'b', from, { peerNoticeItems: 2, peerNoticeChars: 80 });
    return receiptContext(JSON.stringify(page), { runId: run.id, ranges: [{ from, through: page.scanned }],
      notifications: pendingNotifications(run, 'b').slice(0, 2).map(({ id, seq }) => ({ id, seq })), messages: [] });
  };
  function logTool(name: string, value: unknown, options: { isError?: boolean; content?: ContentBlock[] } = {}) {
    const json: JsonValue = JSON.parse(JSON.stringify(value));
    const callId = ToolCallId(`native-${++count}`);
    const call = session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' });
    const content = options.content ?? [{ type: 'text' as const, text: JSON.stringify(json) }];
    return session.append('tool/result', { turn: 1, step: 1,
      message: createToolResultMessage({ callId, content, isError: options.isError ?? false }), meta: toolReceiptMeta(name, json) },
    { surfaceOp: 'append', sourceEventSeqs: [call.seq] });
  }
  return { ctx, session, table, store, collaboration, api, call, thread, post, context, logTool, receipts, register };
}

describe('Host technical display receipts', () => {
  it('records summary/notification display without reading bodies, responding, consenting or broadcasting ACKs', async () => {
    const h = await setup();
    const message = await h.post('Please choose the interface', { mentions: ['b'], responseRequestedFrom: ['b'] });
    const agreement = await h.call('a', { action: 'create_agreement', threadId: h.thread.id, title: 'Contract',
      content: 'Use Row[]', sourceMessageIds: [message.id], stakeholderWorkerIds: ['b'] }) as AgreementRecord;
    const notice = h.context();
    const before = h.store.get('r');
    // Preparing the context cannot acknowledge anything yet.
    expect(pendingNotifications(before, 'b').length).toBeGreaterThan(0);
    h.session.append('user/message', notice, { surfaceOp: 'append' });
    await h.receipts.reconcile(h.session);
    const after = h.store.get('r');
    expect(after.workers.b?.shownSeq).toBe(before.nextSeq - 1);
    expect(after.workers.b?.observedSeq).toBe(0);
    expect(after.channelReads).toEqual({});
    expect(after.responseRequests).toEqual(before.responseRequests);
    expect(after.agreements[agreement.id]?.confirmations).toEqual([]);
    expect(after.nextSeq).toBe(before.nextSeq);
    expect(after.messages).toEqual(before.messages);
    expect(after.workers.a).toEqual(before.workers.a);
    expect(pendingNotifications(after, 'b').length).toBeLessThan(pendingNotifications(before, 'b').length);
  });

  it('persists the actual Session content before its display receipt', async () => {
    const h = await setup();
    await h.post('Mention', { mentions: ['b'] });
    const entered = barrier(), release = barrier();
    const remove = h.ctx.on('session/flush', async () => { entered.resolve(); await release.promise; });
    h.session.append('user/message', h.context(), { surfaceOp: 'append' });
    await entered.promise;
    expect(h.store.get('r').workers.b?.shownSeq).toBeUndefined();
    expect(pendingNotifications(h.store.get('r'), 'b')).toHaveLength(1);
    release.resolve();
    await h.receipts.reconcile(h.session);
    expect(pendingNotifications(h.store.get('r'), 'b')).toEqual([]);
    remove();
  });

  it('full-message display records only the exact offered version even after a concurrent edit', async () => {
    const h = await setup();
    const message = await h.post('version one', { responseRequestedFrom: ['b'] });
    const page = await h.api.query('s-b', { view: 'messages', messageId: message.id });
    expect(h.store.get('r').channelReads).toEqual({});
    await h.call('a', { action: 'revise_message', messageId: message.id, expectedRevision: 1, body: 'version two' });
    h.logTool('swarm_public_read', page);
    await h.receipts.reconcile(h.session);
    const reads = Object.values(h.store.get('r').channelReads)[0]!;
    expect(reads.offeredMessageRevisions[message.id]).toBe(1);
    expect(reads.readMessageRevisions[message.id]).toBe(1);
    expect(h.store.get('r').publicMessages[message.id]?.revision).toBe(2);
    expect(Object.values(h.store.get('r').responseRequests)[0]?.status).toBe('pending');
  });

  it('rejects truncated/replaced/error tool outputs and contexts that never entered the Session', async () => {
    const h = await setup();
    const message = await h.post('full body', { mentions: ['b'] });
    const page = await h.api.query('s-b', { view: 'messages' });
    h.context(); // prepared additionalContexts discarded by cancellation
    h.logTool('swarm_public_read', page, { isError: true });
    h.logTool('swarm_public_read', page, { content: [{ type: 'text', text: 'truncated: see artifact' }] });
    const original = h.context();
    h.session.append('user/message', createUserMessage({ source: original.source,
      content: [{ type: 'text', text: 'rewritten context' }] }), { surfaceOp: 'append' });
    // User-authored text which looks exactly like our notice is not producer evidence.
    h.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: original.content }),
      { surfaceOp: 'append' });
    await h.receipts.reconcile(h.session);
    expect(h.store.get('r').channelReads).toEqual({});
    expect(h.store.get('r').workers.b?.shownSeq).toBeUndefined();
    expect(pendingNotifications(h.store.get('r'), 'b')[0]?.messageId).toBe(message.id);
  });

  it('pages and waits without model ACK calls and does not skip invisible/private or unoffered events', async () => {
    const h = await setup();
    await h.collaboration.message('s-a', { target: 'b', body: 'first' }, 'one');
    await h.collaboration.message('s-a', { target: 'c', body: 'not for b' }, 'hidden');
    await h.collaboration.message('s-a', { target: 'b', body: 'last' }, 'two');
    const first = await h.collaboration.sync('s-b', { limit: 1 });
    h.logTool('swarm_sync', first);
    await h.receipts.reconcile(h.session);
    const second = await h.collaboration.sync('s-b', { limit: 1 });
    expect(second.fromSeq).toBe(first.throughSeq);
    expect(second.events[0]?.event.seq).toBeGreaterThan(first.throughSeq);
    expect(JSON.stringify(second)).not.toContain('not for b');
    h.logTool('swarm_sync', second);
    await h.receipts.reconcile(h.session);
    const waiting = await h.collaboration.wait('s-b', {}, 'wait-with-no-ack');
    expect(waiting.waiting).toBe(false); // remaining last message was not offered by page two
    h.logTool('swarm_wait', waiting);
    await h.receipts.reconcile(h.session);
    expect((await h.collaboration.wait('s-b', {}, 'wait-again')).waiting).toBe(true);
    expect(h.store.get('r').workers.b?.observedSeq).toBe(0);
  });

  it('old coalesced notification receipts cannot acknowledge a newer version', async () => {
    const h = await setup();
    await h.call('b', { action: 'subscribe', channelId: h.thread.channelId, mode: 'following' });
    await h.post('first');
    const old = h.context();
    const oldSeq = pendingNotifications(h.store.get('r'), 'b')[0]!.seq;
    await h.post('second');
    h.session.append('user/message', old, { surfaceOp: 'append' });
    await h.receipts.reconcile(h.session);
    const fresh = pendingNotifications(h.store.get('r'), 'b')[0]!;
    expect(fresh.seq).toBeGreaterThan(oldSeq);
    expect(fresh.acknowledgedAt).toBeNull();
    h.session.append('user/message', h.context(), { surfaceOp: 'append' });
    await h.receipts.reconcile(h.session);
    expect(pendingNotifications(h.store.get('r'), 'b')).toEqual([]);
  });

  it('replays logged evidence after receipt storage failure without another model turn or business mutation', async () => {
    const h = await setup();
    await h.post('recover me', { mentions: ['b'] });
    h.table.fail = true;
    h.session.append('user/message', h.context(), { surfaceOp: 'append' });
    await expect(h.receipts.reconcile(h.session)).rejects.toThrow('receipt store unavailable');
    expect(pendingNotifications(h.store.get('r'), 'b')).toHaveLength(1);
    await h.receipts.dispose();
    h.table.fail = false;
    const recovered = h.register(); // new native projection reconstructs from the Session log
    await recovered.reconcile(h.session);
    expect(pendingNotifications(h.store.get('r'), 'b')).toEqual([]);
    const before = h.store.get('r');
    await recovered.reconcile(h.session);
    expect(h.store.get('r')).toEqual(before);
    expect(Object.keys(before.publicMessages)).toHaveLength(1);
  });

  it('failed Session durability never commits display; recovery retries retained evidence', async () => {
    const h = await setup();
    await h.post('persist before acknowledging', { mentions: ['b'] });
    const remove = h.ctx.on('session/flush', () => { throw new Error('disk flush failed'); });
    h.session.append('user/message', h.context(), { surfaceOp: 'append' });
    await expect(h.receipts.reconcile(h.session)).rejects.toThrow('disk flush failed');
    expect(pendingNotifications(h.store.get('r'), 'b')).toHaveLength(1);
    remove();
    await h.receipts.reconcile(h.session);
    expect(pendingNotifications(h.store.get('r'), 'b')).toEqual([]);
  });

  it('never bridges an unshown prefix or consumes unseen notification/full-message pages', async () => {
    const h = await setup();
    for (let i = 0; i < 4; i++) await h.post(`notice ${i}`, { mentions: ['b'] });
    const notices = pendingNotifications(h.store.get('r'), 'b');
    const receipt: ShownReceipt = { runId: 'r', ranges: [{ from: 2, through: 3 }],
      notifications: [{ id: notices[0]!.id, seq: notices[0]!.seq }], messages: [] };
    await h.collaboration.recordShown('s-b', receipt);
    expect(h.store.get('r').workers.b?.shownSeq ?? 0).toBe(0);
    expect(pendingNotifications(h.store.get('r'), 'b')).toHaveLength(3);
    expect(h.store.get('r').channelReads).toEqual({});
    await h.collaboration.recordShown('s-b', { ...receipt, ranges: [{ from: 0, through: 2 }, { from: 2, through: 3 }] });
    expect(h.store.get('r').workers.b?.shownSeq).toBe(3);
  });

  it('keeps metadata receipts private to the true worker and rejects foreign run evidence', async () => {
    const h = await setup();
    await h.post('B only attention', { mentions: ['b'] });
    const receipt: ShownReceipt = { runId: 'r', ranges: [], notifications: pendingNotifications(h.store.get('r'), 'b'), messages: [] };
    await expect(h.collaboration.recordShown('s-c', receipt)).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    await expect(h.collaboration.recordShown('s-b', { ...receipt, runId: 'other' })).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    await expect(h.collaboration.recordShown('owner', receipt)).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    expect(pendingNotifications(h.store.get('r'), 'b')).toHaveLength(1);
  });

  it('uses native Session events as evidence, not an API response prepared before publication', async () => {
    const h = await setup();
    const page = await h.collaboration.sync('s-b');
    const event = h.logTool('swarm_sync', page);
    expect(receiptFromEvent(event)).toMatchObject({ runId: 'r', ranges: [{ from: 0, through: page.throughSeq }] });
    await h.receipts.reconcile(h.session);
    expect(h.store.get('r').workers.b?.shownSeq).toBe(page.throughSeq);
  });
});
