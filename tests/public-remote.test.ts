import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { ProgressService, toProgressSnapshot } from '../src/progress.ts';
import { PublicHistoryReader } from '../src/public-remote.ts';
import { PublicCollaboration } from '../src/public-collaboration.ts';
import { Collaboration } from '../src/collaboration.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import { createRun, type Run, type WorkerRecord } from '../src/types.ts';
import type { RunStatus } from '../src/runtime.ts';
import type { ThreadRecord } from '../src/public-types.ts';

class Table implements RunTable {
  records = new Map<string, Run>();
  get(id: string) { return this.records.get(id); }
  entries() { return this.records.entries(); }
  async put(id: string, run: Run) { this.records.set(id, structuredClone(run)); }
  async update(id: string, fn: (run: Run) => Run) { const run = structuredClone(fn(this.records.get(id)!)); this.records.set(id, run); return run; }
}
function worker(id: string): WorkerRecord {
  return { id, sessionId: `s-${id}`, branch: id, worktreePath: '/repo', initializationState: 'ready',
    initializationError: null, unavailableReason: null, offeredSeq: 0, observedSeq: 0, notifiedSeq: 0,
    wakeTargetSeq: 0, waitRegistration: null, currentTaskId: null, createdAt: 0 };
}
function status(run: Run): RunStatus {
  return { runId: run.id, ownerSessionId: run.ownerSessionId, phase: run.phase, reason: null, quiesceTarget: null,
    deadline: null, now: 1000, budgetExpired: false, goalRevision: 0, goals: { total: 0, active: 0, deferred: 0, completed: 0 },
    baseCommit: run.baseCommit, acceptedHead: run.acceptedHead, resultRef: run.resultRef, integrationWorktree: null,
    tasks: { open: 0, claimed: 0, proposed: 0, done: 0, blocked: 0, cancelled: 0, total: 0 },
    workers: [], proposals: { queued: 0, integrating: 0, accepted: 0, rejected: 0 },
    verifications: { queued: 0, running: 0, passed: 0, failed: 0, interrupted: 0 },
    finishRequest: null, admission: 'open', diagnostics: [] };
}
async function setup() {
  const store = new MemoryStateStore(new Table());
  const run = createRun({ id: 'run', ownerSessionId: 'owner', repositoryRoot: '/repo', gitCommonDir: '/repo/.git',
    goal: 'channels', acceptanceCriteria: ['readable'], verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
    baseCommit: 'a'.repeat(40), resultRef: 'refs/heads/result', deadline: null, createdAt: 0 });
  run.phase = 'running'; run.workers = { a: worker('a'), b: worker('b') };
  await store.create(run);
  let id = 0;
  const api = new PublicCollaboration(store, { id: () => `public-${++id}`, now: () => 1000 });
  const thread = await api.execute('s-a', { action: 'create_thread', channelId: 'run:general', title: 'Protocol' }, 'thread') as ThreadRecord;
  const runtime = { status: () => status(store.get('run')), publicCollaboration: api };
  const ctx = new Context();
  let listeners = 0;
  const service = new ProgressService(ctx, runtime, { detail: (runId) => store.get(runId), now: () => 1000,
    subscribe: (listener) => { listeners++; const off = store.subscribe((changed) => listener({ runId: changed.id, ownerSessionId: changed.ownerSessionId, phase: changed.phase })); return () => { listeners--; off(); }; } });
  const post = (text: string) => api.execute('s-a', { action: 'post', threadId: thread.id, body: text, responseRequestedFrom: ['b'] }, `post-${++id}`);
  return { store, api, runtime, service, post, thread, listeners: () => listeners, async dispose() { await service.dispose(); await ctx.fiber.dispose(); } };
}

describe('owner public Remote protocol', () => {
  it('reads public history without private content or any worker read/ACK side effect', async () => {
    const h = await setup();
    try {
      await h.post('public body only on demand');
      await new Collaboration(h.store).message('s-a', { target: 'b', body: 'private must stay private' }, 'private');
      const before = h.store.get('run');
      const page = await h.service.publicDiscussion('owner', 'run', { view: 'messages', threadId: h.thread.id });
      expect(JSON.stringify(page)).toContain('public body only on demand');
      expect(JSON.stringify(page)).not.toContain('private must stay private');
      expect(h.store.get('run')).toEqual(before);
      const snapshot = toProgressSnapshot(h.runtime.status(), before, 1000);
      expect(snapshot.publicActivity).toMatchObject({ protocolVersion: 1, channels: 1, threads: 1, pendingRequests: 1 });
      expect(JSON.stringify(snapshot)).not.toContain('public body only on demand');
      expect(JSON.stringify(snapshot)).not.toContain('private must stay private');
      expect(JSON.stringify(snapshot)).not.toContain('Run-wide public coordination');
    } finally { await h.dispose(); }
  });

  it('validates owner, run, query references, limits and cursors on each request', async () => {
    const h = await setup();
    try {
      for (let index = 0; index < 3; index++) await h.post(`body-${index}`);
      await expect(h.service.publicDiscussion('s-a', 'run', { view: 'messages' })).rejects.toMatchObject({ code: 'swarm-progress/forbidden' });
      await expect(h.service.publicDiscussion('owner', 'other-run', { view: 'messages' })).rejects.toMatchObject({ code: 'gateway/bad-request' });
      await expect(h.service.publicDiscussion('owner', 'run', { view: 'messages', limit: 21 })).rejects.toMatchObject({ code: 'gateway/bad-request' });
      await expect(h.service.publicDiscussion('owner', 'run', { view: 'messages', channelId: 'foreign' })).rejects.toMatchObject({ code: 'gateway/bad-request' });
      const first = await h.service.publicDiscussion('owner', 'run', { view: 'messages', limit: 1 });
      expect(first).toMatchObject({ total: 3, hasMore: true, truncated: true });
      expect(first.items).toHaveLength(1);
      await expect(h.service.publicDiscussion('owner', 'run', { view: 'threads', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'gateway/bad-request' });
      const second = await h.service.publicDiscussion('owner', 'run', { view: 'messages', cursor: first.nextCursor!, limit: 1 });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]).not.toEqual(first.items[0]);
      await expect(h.service.publicDiscussion('owner', 'run', { view: 'messages', cursor: 'garbage' })).rejects.toMatchObject({ code: 'gateway/bad-request' });
      await h.store.update('run', (run) => ({ ...run, ownerSessionId: 'replacement' }));
      await expect(h.service.publicDiscussion('owner', 'run', { view: 'messages', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'swarm-progress/forbidden' });
    } finally { await h.dispose(); }
  });

  it('public mutations invalidate the existing owner stream using metadata, abort releases subscription', async () => {
    const h = await setup();
    const abort = new AbortController();
    try {
      const stream = h.service.watchSession('owner', abort.signal)[Symbol.asyncIterator]();
      const opening = await stream.next();
      expect(opening.value?.progress?.publicActivity?.pendingRequests).toBe(0);
      expect(h.listeners()).toBe(1);
      const next = stream.next();
      await h.post('body must not enter progress');
      const changed = await next;
      expect(changed.value?.progress?.publicActivity?.pendingRequests).toBe(1);
      expect(JSON.stringify(changed)).not.toContain('body must not enter progress');
      abort.abort();
      expect(h.listeners()).toBe(0);
      expect((await stream.next()).done).toBe(true);
      await h.service.dispose();
      await expect(h.service.publicDiscussion('owner', 'run', { view: 'channels' })).rejects.toMatchObject({ code: 'gateway/internal' });
    } finally { abort.abort(); await h.dispose(); }
  });

  it('keeps bare SRC parameters and refuses stale run requests before querying the domain', async () => {
    const h = await setup();
    try {
      const source = String(ProgressService.prototype.publicDiscussion);
      expect(source.slice(source.indexOf('(') + 1, source.indexOf(')')).split(',').map((value) => value.trim())).toEqual(['sessionId', 'runId', 'query', 'signal']);
      const reader = new PublicHistoryReader({ status: () => ({ ownerSessionId: 'owner', runId: 'new' }) }, h.api);
      expect(() => reader.page('owner', 'run', { view: 'channels' })).toThrow('Run changed');
      reader.dispose();
      expect(() => reader.page('owner', 'new', { view: 'channels' })).toThrow('disposed');
    } finally { await h.dispose(); }
  });
});
