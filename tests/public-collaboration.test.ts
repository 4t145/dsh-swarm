import { describe, expect, it } from 'vitest';
import { PublicCollaboration } from '../src/public-collaboration.ts';
import { Collaboration } from '../src/collaboration.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import { createRun, type Run, type WorkerRecord } from '../src/types.ts';
import { parseRun } from '../src/schema.ts';
import type { PublicCommand } from '../src/public-input.ts';
import type { AgreementRecord, ChannelRecord, PublicMessageRecord, ResponseRequestRecord, ThreadRecord } from '../src/public-types.ts';

class Table implements RunTable {
  records = new Map<string, Run>();
  get(id: string) { return this.records.get(id); }
  entries() { return this.records.entries(); }
  async put(id: string, run: Run) { this.records.set(id, run); }
  async update(id: string, fn: (run: Run) => Run) { const next = fn(this.records.get(id)!); this.records.set(id, next); return next; }
}
function worker(id: string): WorkerRecord {
  return { id, sessionId: `s-${id}`, branch: id, worktreePath: '/tmp/repo', initializationState: 'ready',
    initializationError: null, unavailableReason: null, offeredSeq: 0, observedSeq: 0, notifiedSeq: 0,
    wakeTargetSeq: 0, waitRegistration: null, currentTaskId: null, createdAt: 0 };
}
async function setup(options: { now?: () => number } = {}) {
  const store = new MemoryStateStore(new Table());
  const run = createRun({ id: 'r', ownerSessionId: 'owner', repositoryRoot: '/tmp/repo', gitCommonDir: '/tmp/repo/.git',
    goal: 'public collaboration', acceptanceCriteria: ['complete'], verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
    baseCommit: 'a'.repeat(40), resultRef: 'refs/heads/result', deadline: null, createdAt: 0 });
  run.phase = 'running'; run.workers = { a: worker('a'), b: worker('b'), c: worker('c') };
  await store.create(run);
  let counter = 0;
  const api = new PublicCollaboration(store, { id: () => `public-${++counter}`, now: options.now ?? (() => 1000) });
  const legacy = new Collaboration(store, { id: () => `legacy-${++counter}`, now: () => 1000 });
  const call = (who: string, command: PublicCommand, callId = `call-${++counter}`) => api.execute(`s-${who}`, command, callId);
  const thread = await call('a', { action: 'create_thread', channelId: 'r:general', title: 'Protocol' }) as ThreadRecord;
  const post = (who: string, body = 'Question', extra: Partial<Extract<PublicCommand, { action: 'post' }>> = {}) =>
    call(who, { action: 'post', threadId: thread.id, body, ...extra }) as Promise<PublicMessageRecord>;
  return { store, api, legacy, call, thread, post };
}

describe('persistent public collaboration', () => {
  it('migrates old runs without exposing, copying or inventing private messages', async () => {
    const { store, api, legacy } = await setup();
    const secret = await legacy.message('s-a', { target: 'b', body: 'private secret' }, 'private');
    const raw: Record<string, unknown> = { ...structuredClone(store.get('r')) };
    for (const field of ['channels', 'threads', 'publicMessages', 'notifications', 'subscriptions', 'channelReads', 'responseRequests', 'agreements']) delete raw[field];
    // Remove new protocol events too: this models an actual legacy run, not a corrupt mixed record.
    raw.events = (raw.events as Run['events']).filter((event) => event.kind !== 'public');
    const restored = parseRun(raw);
    expect(restored.channels['r:general']?.createdByWorkerId).toBeNull();
    expect(restored.publicMessages).toEqual({});
    expect(restored.messages[secret.id]?.body).toBe('private secret');
    expect((await api.query('s-c', { view: 'messages' })).items).toEqual([]);
    await expect(api.query('s-c', { view: 'messages', messageId: secret.id })).rejects.toMatchObject({ code: 'SWARM_NOT_FOUND' });
    expect(JSON.stringify(await legacy.read('s-c', { query: 'secret' }))).not.toContain('private secret');
  });

  it('validates identity, channel creation, creator authorization, archive and duplicate names', async () => {
    const { api, call, store } = await setup();
    await expect(api.execute('impostor', { action: 'create_channel', name: 'ok', purpose: 'x' }, 'x')).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    await expect(call('a', { action: 'create_channel', name: 'Bad Name', purpose: 'x' })).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });
    const channel = await call('a', { action: 'create_channel', name: 'api', purpose: 'Interfaces' }) as ChannelRecord;
    await expect(call('b', { action: 'archive_channel', channelId: channel.id, expectedRevision: 1 })).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    await call('a', { action: 'archive_channel', channelId: channel.id, expectedRevision: 1 });
    await expect(call('a', { action: 'create_thread', channelId: channel.id, title: 'no' })).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    await expect(call('a', { action: 'create_channel', name: 'api', purpose: 'duplicate' })).rejects.toMatchObject({ code: 'SWARM_ALREADY_EXISTS' });
    expect((await api.query('s-c', { view: 'channels', status: 'archived' })).total).toBe(1);
    expect(store.get('r').channels['r:general']?.status).toBe('active');
  });

  it('stores one public message and targets B while C can read and participate without a notice', async () => {
    const { post, api, store, thread } = await setup();
    const message = await post('a', 'B please review', { mentions: ['b'], responseRequestedFrom: ['b'] });
    const run = store.get('r');
    expect(Object.keys(run.publicMessages)).toEqual([message.id]);
    expect(run.messages).toEqual({});
    expect(Object.values(run.notifications).every((notice) => notice.workerId === 'b')).toBe(true);
    const page = await api.query('s-c', { view: 'messages', threadId: thread.id });
    expect(page.items[0]).toMatchObject({ kind: 'message', message: { body: 'B please review' } });
    await post('c', 'I can help');
    expect(store.get('r').threads[thread.id]?.participantWorkerIds).toEqual(['a', 'c']);
    expect(Object.values(store.get('r').notifications).some((notice) => notice.workerId === 'a' && notice.priority === 'digest')).toBe(true);
  });

  it('never confuses summaries/global ACK, full read, notification ACK or explicit response', async () => {
    const { post, api, call, legacy, store } = await setup();
    const message = await post('a', 'Please answer', { responseRequestedFrom: ['b'] });
    const request = Object.values(store.get('r').responseRequests)[0]!;
    const notice = Object.values(store.get('r').notifications)[0]!;
    const sync = await legacy.sync('s-b', {});
    expect(JSON.stringify(sync)).not.toContain('Please answer');
    await legacy.sync('s-b', { ackSeq: sync.throughSeq });
    await api.query('s-b', { view: 'activity' });
    await expect(call('b', { action: 'mark_read', channelId: message.channelId, messages: [{ messageId: message.id, revision: 1 }] })).rejects.toMatchObject({ code: 'SWARM_INVALID_CURSOR' });
    await api.query('s-b', { view: 'messages', messageId: message.id });
    await call('b', { action: 'mark_read', channelId: message.channelId, messages: [{ messageId: message.id, revision: 1 }] });
    expect(store.get('r').notifications[notice.id]?.acknowledgedAt).toBeNull();
    await call('b', { action: 'ack_notifications', notifications: [{ id: notice.id, seq: notice.seq }] });
    expect(store.get('r').responseRequests[request.id]?.status).toBe('pending');
    expect((await api.query('s-b', { view: 'attention' })).items[0]).toMatchObject({ kind: 'request', request: { id: request.id } });
  });

  it('prioritizes pending requests ahead of coalesced ordinary chatter', async () => {
    const { post, call, api, store, thread } = await setup();
    await call('b', { action: 'subscribe', channelId: thread.channelId, threadId: thread.id, mode: 'following' });
    await post('a', 'respond', { responseRequestedFrom: ['b'] });
    for (let i = 0; i < 30; i++) await post('a', `ordinary ${i}`);
    const notices = Object.values(store.get('r').notifications).filter((notice) => notice.workerId === 'b');
    expect(notices.filter((notice) => notice.priority === 'digest')).toHaveLength(1);
    expect(notices.filter((notice) => notice.priority === 'immediate')).toHaveLength(1);
    expect((await api.query('s-b', { view: 'attention', limit: 1 })).items[0]?.kind).toBe('request');
    const run = store.get('r');
    expect(run.workers.b?.observedSeq).toBe(0);
  });

  it('does not let a stale notification ACK consume a concurrently coalesced update', async () => {
    const { post, call, store, thread } = await setup();
    await call('b', { action: 'subscribe', channelId: thread.channelId, threadId: thread.id, mode: 'following' });
    await post('a', 'one');
    const first = Object.values(store.get('r').notifications)[0]!;
    await post('a', 'two');
    await expect(call('b', { action: 'ack_notifications', notifications: [{ id: first.id, seq: first.seq }] })).rejects.toMatchObject({ code: 'SWARM_STALE_REVISION' });
    expect(store.get('r').notifications[first.id]?.acknowledgedAt).toBeNull();
    const current = store.get('r').notifications[first.id]!;
    await expect(call('c', { action: 'ack_notifications', notifications: [{ id: current.id, seq: current.seq }] })).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    await call('b', { action: 'ack_notifications', notifications: [{ id: current.id, seq: current.seq }] });
  });

  it('notifies reply author, explicit announcement, live task owner and dynamic subscriber only', async () => {
    const { post, call, legacy, store, thread } = await setup();
    const task = await legacy.createTask('s-a', { kind: 'code', subject: 'API', acceptance: 'tests', scope: [] }, 'task');
    await legacy.updateTask('s-b', { taskId: task.id, expectedRevision: task.revision, action: 'claim' }, 'claim');
    const root = await post('a', 'question', { taskIds: [task.id] });
    expect(Object.values(store.get('r').notifications).some((notice) => notice.workerId === 'b' && notice.reasons.includes('task_owner'))).toBe(true);
    await post('b', 'answer', { replyToMessageId: root.id });
    expect(Object.values(store.get('r').notifications).some((notice) => notice.workerId === 'a' && notice.reasons.includes('reply'))).toBe(true);
    await store.update('r', (run) => { run.workers.d = worker('d'); return run; });
    await post('a', 'All hands', { announcement: true });
    expect(Object.values(store.get('r').notifications).some((notice) => notice.workerId === 'd' && notice.reasons.includes('announcement'))).toBe(true);
    await call('c', { action: 'subscribe', channelId: thread.channelId, mode: 'following' });
    await post('a', 'channel update');
    expect(Object.values(store.get('r').notifications).some((notice) => notice.workerId === 'c' && notice.reasons.includes('subscription'))).toBe(true);
  });

  it('uses request CAS and target/requester authorization without inferring responses from posts', async () => {
    const { post, call, store } = await setup();
    await post('a', 'need response', { responseRequestedFrom: ['b'] });
    const request = Object.values(store.get('r').responseRequests)[0]!;
    const response = await post('b', 'response');
    expect(store.get('r').responseRequests[request.id]?.status).toBe('pending');
    await expect(call('c', { action: 'respond', requestId: request.id, expectedRevision: 1, responseMessageId: response.id })).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    await expect(call('b', { action: 'withdraw_request', requestId: request.id, expectedRevision: 1 })).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    const answered = await call('b', { action: 'respond', requestId: request.id, expectedRevision: 1, responseMessageId: response.id }) as ResponseRequestRecord;
    expect(answered.status).toBe('responded');
    await expect(call('a', { action: 'withdraw_request', requestId: request.id, expectedRevision: 1 })).rejects.toMatchObject({ code: 'SWARM_STALE_REVISION' });
  });

  it('retains explicit agreement confirmations per version and rejects stale or unrelated confirmations', async () => {
    const { post, call, api, store, thread } = await setup();
    const source = await post('a', 'proposal, not yet a fact');
    const fields = { content: 'v1 contract', sourceMessageIds: [source.id], stakeholderWorkerIds: ['a', 'b'] };
    const agreement = await call('a', { action: 'create_agreement', threadId: thread.id, title: 'API', ...fields }) as AgreementRecord;
    await api.query('s-b', { view: 'agreements' });
    expect(store.get('r').agreements[agreement.id]?.confirmations).toEqual([]);
    await call('b', { action: 'confirm_agreement', agreementId: agreement.id, version: 1 });
    await call('a', { action: 'revise_agreement', agreementId: agreement.id, expectedVersion: 1, ...fields, content: 'v2 contract' });
    await expect(call('b', { action: 'confirm_agreement', agreementId: agreement.id, version: 1 })).rejects.toMatchObject({ code: 'SWARM_STALE_REVISION' });
    await expect(call('c', { action: 'confirm_agreement', agreementId: agreement.id, version: 2 })).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    const page = await api.query('s-b', { view: 'agreements' });
    expect(page.items[0]).toMatchObject({ agreement: { version: 2, confirmations: [] } });
    expect((await api.query('s-b', { view: 'agreement_versions', agreementId: agreement.id })).items).toHaveLength(2);
  });

  it('rejects private/cross-thread/prototype references and author-only concurrent revisions', async () => {
    const { post, call, api, legacy, thread, store } = await setup();
    const secret = await legacy.message('s-a', { target: 'b', body: 'secret' }, 'secret');
    await expect(post('a', 'leak', { replyToMessageId: secret.id })).rejects.toMatchObject({ code: 'SWARM_NOT_FOUND' });
    await expect(post('a', 'foreign', { taskIds: ['other-run-task'] })).rejects.toMatchObject({ code: 'SWARM_NOT_FOUND' });
    await expect(post('a', 'prototype', { mentions: ['__proto__'] })).rejects.toMatchObject({ code: 'SWARM_NOT_FOUND' });
    const message = await post('a');
    const other = await call('b', { action: 'create_thread', channelId: thread.channelId, title: 'Other' }) as ThreadRecord;
    await expect(call('b', { action: 'post', threadId: other.id, body: 'wrong thread', replyToMessageId: message.id })).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });
    await expect(call('b', { action: 'revise_message', messageId: message.id, expectedRevision: 1, body: 'not mine' })).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    const result = await Promise.allSettled(['first', 'second'].map((body) => call('a', { action: 'revise_message', messageId: message.id, expectedRevision: 1, body })));
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(store.get('r').publicMessages[message.id]?.revisions).toHaveLength(1);
    expect((await api.query('s-c', { view: 'message_revisions', messageId: message.id })).total).toBe(2);
  });

  it('preserves task/finding bidirectional query provenance and conclusion ownership', async () => {
    const { post, call, legacy, api, thread, store } = await setup();
    const task = await legacy.createTask('s-a', { kind: 'research', subject: 'design', acceptance: 'evidence', scope: [] }, 'task');
    const finding = await legacy.publish('s-a', { kind: 'observed', summary: 'confirmed evidence', evidenceRefs: ['tests'], taskId: task.id }, 'finding');
    const source = await post('a', 'source', { taskIds: [task.id], findingIds: [finding.id] });
    await call('a', { action: 'update_thread', threadId: thread.id, expectedRevision: 1, taskIds: [task.id], conclusionMessageId: source.id, status: 'resolved' });
    await call('b', { action: 'link_finding', threadId: thread.id, findingId: finding.id, messageId: source.id, expectedRevision: 2 });
    expect((await api.query('s-c', { view: 'threads', taskId: task.id })).total).toBe(1);
    expect((await api.query('s-c', { view: 'threads', findingId: finding.id })).total).toBe(1);
    expect(store.get('r').findings[finding.id]).toEqual(finding);
  });

  it('paginates concurrent posting with a bound run/filter snapshot and bounded full bodies', async () => {
    const { post, api, thread } = await setup();
    await Promise.all(Array.from({ length: 8 }, (_, i) => post('a', `message ${i}`)));
    const first = await api.query('s-c', { view: 'messages', threadId: thread.id, limit: 3 });
    await post('a', 'late append');
    const second = await api.query('s-c', { view: 'messages', threadId: thread.id, limit: 3, cursor: first.nextCursor! });
    const third = await api.query('s-c', { view: 'messages', threadId: thread.id, limit: 3, cursor: second.nextCursor! });
    expect([...first.items, ...second.items, ...third.items]).toHaveLength(8);
    expect(third.hasMore).toBe(false);
    await expect(api.query('s-c', { view: 'messages', query: 'different', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'SWARM_INVALID_CURSOR' });
    await expect(api.query('s-c', { view: 'messages', limit: 21 })).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });
    expect((await api.query('s-c', { view: 'messages', query: 'late' })).total).toBe(1);
  });

  it('is idempotent across pause, rejects new mutations, and does not broadcast read/ACK/subscription bookkeeping', async () => {
    const { call, post, api, store, thread } = await setup();
    const input = { action: 'post', threadId: thread.id, body: 'once' } as const;
    const once = await call('a', input, 'same');
    const before = store.get('r').events.length;
    await call('b', { action: 'subscribe', channelId: thread.channelId, mode: 'following' });
    await api.query('s-b', { view: 'messages' });
    expect(store.get('r').events).toHaveLength(before);
    await store.update('r', (run) => { run.phase = 'paused'; return run; });
    expect(await call('a', input, 'same')).toEqual(once);
    await expect(post('a', 'new')).rejects.toMatchObject({ code: 'SWARM_NOT_RUNNING' });
    await expect(call('a', { action: 'create_thread', channelId: thread.channelId, title: 'wrong method' }, 'same')).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });
    expect(store.get('r').events).toHaveLength(before);
  });

  it('retains archived discussion history while rejecting new posts and revisions', async () => {
    const { api, call } = await setup();
    const channel = await call('a', { action: 'create_channel', name: 'archive-test', purpose: 'history' }) as ChannelRecord;
    const thread = await call('a', { action: 'create_thread', channelId: channel.id, title: 'frozen' }) as ThreadRecord;
    const message = await call('b', { action: 'post', threadId: thread.id, body: 'retained' }) as PublicMessageRecord;
    await call('a', { action: 'archive_channel', channelId: channel.id, expectedRevision: 1 });
    await expect(call('b', { action: 'post', threadId: thread.id, body: 'no' })).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    await expect(call('b', { action: 'revise_message', messageId: message.id, expectedRevision: 1, body: 'no' })).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    expect((await api.query('s-c', { view: 'messages', channelId: channel.id, query: 'retained' })).total).toBe(1);
  });

  it('rejects corrupted persisted public references and never treats a revised message as fully read', async () => {
    const { post, call, api, store } = await setup();
    const message = await post('a', 'v1');
    await api.query('s-b', { view: 'messages' });
    await call('a', { action: 'revise_message', messageId: message.id, expectedRevision: 1, body: 'v2' });
    await expect(call('b', { action: 'mark_read', channelId: message.channelId, messages: [{ messageId: message.id, revision: 2 }] })).rejects.toMatchObject({ code: 'SWARM_INVALID_CURSOR' });
    const corrupted = store.get('r');
    corrupted.publicMessages[message.id]!.replyToMessageId = 'private-or-foreign';
    expect(() => parseRun(corrupted)).toThrow(/failed validation/);
    const invalidRead = store.get('r');
    Object.values(invalidRead.channelReads)[0]!.readMessageRevisions[message.id] = 2;
    expect(() => parseRun(invalidRead)).toThrow(/failed validation/);
  });

  it('withdraws requests only by requester and observes task owner reassignment on later posts', async () => {
    const { post, call, store, legacy } = await setup();
    const task = await legacy.createTask('s-a', { kind: 'code', subject: 'ownership', acceptance: 'checks', scope: [] }, 'create');
    const claimed = await legacy.updateTask('s-b', { taskId: task.id, expectedRevision: 1, action: 'claim' }, 'claim');
    await post('a', 'before', { taskIds: [task.id], responseRequestedFrom: ['b'] });
    const request = Object.values(store.get('r').responseRequests)[0]!;
    await call('a', { action: 'withdraw_request', requestId: request.id, expectedRevision: 1 });
    expect(store.get('r').responseRequests[request.id]?.status).toBe('withdrawn');
    const released = await legacy.updateTask('s-b', { taskId: task.id, expectedRevision: claimed.revision, action: 'release' }, 'release');
    await legacy.updateTask('s-c', { taskId: task.id, expectedRevision: released.revision, action: 'claim' }, 'claim-c');
    const after = await post('a', 'after', { taskIds: [task.id] });
    expect(Object.values(store.get('r').notifications).some((notice) => notice.messageId === after.id && notice.workerId === 'c' && notice.reasons.includes('task_owner'))).toBe(true);
  });

  it('advances thread activity for request/response/agreement events, not passive reads', async () => {
    let tick = 0;
    const { post, call, api, thread, store } = await setup({ now: () => ++tick });
    const assertLatest = () => {
      const run = store.get('r');
      expect(run.threads[thread.id]).toMatchObject({ updatedSeq: run.events.at(-1)!.seq, updatedAt: run.events.at(-1)!.createdAt, revision: 1 });
    };
    const message = await post('a', 'request', { responseRequestedFrom: ['b'] }); assertLatest();
    const request = Object.values(store.get('r').responseRequests)[0]!;
    const response = await post('b', 'answer');
    await call('b', { action: 'respond', requestId: request.id, expectedRevision: 1, responseMessageId: response.id }); assertLatest();
    const fields = { content: 'contract', sourceMessageIds: [message.id], stakeholderWorkerIds: ['b'] };
    const agreement = await call('a', { action: 'create_agreement', threadId: thread.id, title: 'API', ...fields }) as AgreementRecord; assertLatest();
    await call('b', { action: 'confirm_agreement', agreementId: agreement.id, version: 1 }); assertLatest();
    await call('a', { action: 'revise_agreement', agreementId: agreement.id, expectedVersion: 1, ...fields, content: 'revision' }); assertLatest();
    const beforeRead = store.get('r').threads[thread.id];
    await api.query('s-b', { view: 'activity' });
    await api.query('s-b', { view: 'messages', messageId: message.id });
    expect(store.get('r').threads[thread.id]).toEqual(beforeRead);
  });

  it('signals truncation of activity agreement references and offers complete paged agreement history', async () => {
    const { post, call, api, thread } = await setup();
    const source = await post('a');
    for (let i = 0; i < 21; i++) await call('a', { action: 'create_agreement', threadId: thread.id,
      title: `Decision ${i}`, content: 'contract', sourceMessageIds: [source.id], stakeholderWorkerIds: ['a'] });
    const activity = (await api.query('s-c', { view: 'activity', threadId: thread.id })).items[0]!;
    expect(activity).toMatchObject({ kind: 'activity', agreementCount: 21, agreementsTruncated: true });
    if (activity.kind !== 'activity') throw new Error('Expected activity');
    expect(activity.agreementIds).toHaveLength(20);
    const page = await api.query('s-c', { view: 'agreements', threadId: thread.id });
    const next = await api.query('s-c', { view: 'agreements', threadId: thread.id, cursor: page.nextCursor! });
    expect([...page.items, ...next.items]).toHaveLength(21);
  });

  it('preserves exact immutable Finding-to-source links without editing someone else message', async () => {
    const { post, call, legacy, api, thread, store } = await setup();
    const source = await post('a', 'Measured result');
    const finding = await legacy.publish('s-b', { kind: 'observed', summary: 'Confirmed result', evidenceRefs: ['measurement'] }, 'evidence');
    await call('b', { action: 'link_finding', threadId: thread.id, findingId: finding.id, messageId: source.id, expectedRevision: 1 });
    expect(store.get('r').events.at(-1)).toMatchObject({ kind: 'public', action: 'finding_linked', findingId: finding.id, messageId: source.id });
    expect(store.get('r').publicMessages[source.id]).toEqual(source);
    expect((await api.query('s-c', { view: 'messages', findingId: finding.id })).items).toMatchObject([{ kind: 'message', message: { id: source.id } }]);
    expect((await api.query('s-c', { view: 'threads', findingId: finding.id })).total).toBe(1);
    expect(store.get('r').findings[finding.id]).toEqual(finding);
  });

  it('requires refresh for a coalesced attention update newer than an existing page snapshot', async () => {
    const { post, call, api, thread, store } = await setup();
    await call('b', { action: 'subscribe', channelId: thread.channelId, threadId: thread.id, mode: 'following' });
    await post('a', 'question', { responseRequestedFrom: ['b'] });
    const first = await api.query('s-b', { view: 'attention', limit: 1 });
    const updated = await post('a', 'new ordinary update');
    const rest = await api.query('s-b', { view: 'attention', cursor: first.nextCursor!, limit: 20 });
    expect(rest.items.some((item) => item.kind === 'notification' && item.notification.messageId === updated.id)).toBe(false);
    const refreshed = await api.query('s-b', { view: 'attention' });
    expect(refreshed.items.some((item) => item.kind === 'notification' && item.notification.messageId === updated.id)).toBe(true);
    expect(Object.values(store.get('r').responseRequests)[0]?.status).toBe('pending');
  });

  it('enforces owner-only read access and keeps owner reads separate from worker full-read offers', async () => {
    const { post, call, api, thread } = await setup();
    const message = await post('a');
    expect(() => api.queryForOwner('s-c', 'r', { view: 'messages' })).toThrow(/original owner/);
    expect(api.queryForOwner('owner', 'r', { view: 'messages' }).total).toBe(1);
    await expect(call('b', { action: 'mark_read', channelId: thread.channelId, messages: [{ messageId: message.id, revision: 1 }] })).rejects.toMatchObject({ code: 'SWARM_INVALID_CURSOR' });
  });
});
