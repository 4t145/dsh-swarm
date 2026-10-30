/**
 * Claim Findings, per-kind summary caps and the optional `details` field.
 * Deterministic clock injection; no sleeps.
 */
import { describe, expect, it } from 'vitest';
import { Collaboration } from '../src/collaboration.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import {
  DEFAULT_CLAIM_TTL_MS, FINDING_SUMMARY_LIMITS, parseRun, parseRuntimeConfig,
} from '../src/schema.ts';
import { collectWorkerNotices } from '../src/worker-context.ts';
import { createRun, type Run, type RunId, type WorkerId, type WorkerRecord } from '../src/types.ts';

class InMemoryRunTable implements RunTable {
  private readonly records = new Map<RunId, Run>();
  get(id: RunId): Run | undefined { return this.records.get(id); }
  entries(): IterableIterator<[RunId, Run]> { return this.records.entries(); }
  async put(id: RunId, run: Run): Promise<void> { this.records.set(id, run); }
  async update(id: RunId, fn: (run: Run) => Run): Promise<Run> {
    const next = fn(this.records.get(id)!);
    this.records.set(id, next);
    return next;
  }
}

function makeWorker(id: WorkerId, sessionId: string): WorkerRecord {
  return {
    id, sessionId, branch: `swarm/${id}`, worktreePath: `/tmp/${id}`, initializationState: 'ready',
    initializationError: null, unavailableReason: null, offeredSeq: 0, observedSeq: 0, notifiedSeq: 0,
    wakeTargetSeq: 0, waitRegistration: null, currentTaskId: null, createdAt: 0,
  };
}

async function harness(ttlMs = DEFAULT_CLAIM_TTL_MS) {
  const store = new MemoryStateStore(new InMemoryRunTable());
  const run = createRun({
    id: 'run-1', ownerSessionId: 'owner', repositoryRoot: '/tmp/repo', gitCommonDir: '/tmp/repo/.git',
    goal: 'g', acceptanceCriteria: ['c'], verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
    baseCommit: 'a'.repeat(40), resultRef: 'refs/heads/r', deadline: null, createdAt: 0,
  });
  run.phase = 'running';
  run.workers = { w1: makeWorker('w1', 's1'), w2: makeWorker('w2', 's2') };
  await store.create(run);
  const clock = { now: 1000 };
  let next = 0;
  const collaboration = new Collaboration(store, {
    now: () => clock.now, id: () => `id-${(next += 1)}`, eventPageSize: 20, claimTtlMs: ttlMs,
  });
  let call = 0;
  const callId = () => `call-${(call += 1)}`;
  const task = await collaboration.createTask('s1', { kind: 'code', subject: 't', acceptance: 'a', scope: [] }, callId());
  return { store, collaboration, clock, callId, task };
}

const notices = (h: Awaited<ReturnType<typeof harness>>, workerId: string) =>
  collectWorkerNotices(h.store.get('run-1'), workerId, 0, { peerNoticeItems: 20, peerNoticeChars: 400 },
    { now: h.clock.now, ttlMs: h.collaboration.claimLiveTtlMs }).updates as { kind: string; id?: string; type?: string }[];

describe('claim findings', () => {
  it('appears in sync claims, sync events and notices while live, and expires after the TTL', async () => {
    const h = await harness(60_000);
    const claim = await h.collaboration.publish('s1',
      { kind: 'claim', summary: 'editing src/foo.ts', scope: ['src/foo.ts'], taskId: h.task.id }, h.callId());
    let sync = await h.collaboration.sync('s2', { ackSeq: 0 });
    expect(sync.claims.map((item) => item.id)).toEqual([claim.id]);
    expect(sync.claims[0]).toMatchObject({ authorWorkerId: 'w1', taskId: h.task.id, expiresAt: claim.createdAt + 60_000 });
    expect(sync.events.some((item) => item.finding?.id === claim.id)).toBe(true);
    expect(notices(h, 'w2').some((item) => item.id === claim.id && item.type === 'claim')).toBe(true);

    h.clock.now += 60_000;
    sync = await h.collaboration.sync('s2', { ackSeq: 0 });
    expect(sync.claims).toEqual([]);
    expect(sync.claimsTotal).toBe(0);
    expect(sync.events.some((item) => item.finding?.id === claim.id)).toBe(false);
    expect(notices(h, 'w2').some((item) => item.id === claim.id)).toBe(false);

    // History keeps it: read by id and full-history search still find it.
    const byId = await h.collaboration.read('s2', { id: claim.id });
    expect(byId.items[0]?.finding?.id).toBe(claim.id);
    const search = await h.collaboration.read('s2', { query: 'src/foo.ts' });
    expect(search.items.some((item) => item.finding?.id === claim.id)).toBe(true);
    const byKind = await h.collaboration.read('s2', { query: `kind:claim task:${h.task.id} author:w1` });
    expect(byKind.items.map((item) => item.finding?.id)).toEqual([claim.id]);
  });

  it('full-history search matches text that only appears in details', async () => {
    const h = await harness();
    const finding = await h.collaboration.publish('s1',
      { kind: 'fact', summary: 'short gist', details: 'root cause is the zebra-cache eviction' }, h.callId());
    const page = await h.collaboration.read('s2', { query: '"zebra-cache eviction" kind:fact' });
    expect(page.items.map((item) => item.finding?.id)).toEqual([finding.id]);
    expect(page).toMatchObject({ total: 1, truncated: false });
  });

  it('a newer claim by the same author on the same task replaces the older one in live views', async () => {
    const h = await harness();
    const first = await h.collaboration.publish('s1', { kind: 'claim', summary: 'first scope', taskId: h.task.id }, h.callId());
    h.clock.now += 1;
    const second = await h.collaboration.publish('s1', { kind: 'claim', summary: 'second scope', taskId: h.task.id }, h.callId());
    const otherAuthor = await h.collaboration.publish('s2', { kind: 'claim', summary: 'peer scope', taskId: h.task.id }, h.callId());
    const sync = await h.collaboration.sync('s2', { ackSeq: 0 });
    expect(sync.claims.map((item) => item.id)).toEqual([second.id, otherAuthor.id]);
    expect(sync.events.some((item) => item.finding?.id === first.id)).toBe(false);
    const ids = notices(h, 'w2').map((item) => item.id);
    expect(ids).toContain(second.id);
    expect(ids).not.toContain(first.id);
    // The replaced claim is still in the stored history.
    expect(h.store.get('run-1').findings[first.id]?.summary).toBe('first scope');
  });

  it('claims without a task stay independent and are not a lock on the task', async () => {
    const h = await harness();
    await h.collaboration.publish('s2', { kind: 'claim', summary: 'looking at docs' }, h.callId());
    await h.collaboration.publish('s2', { kind: 'claim', summary: 'looking at tests' }, h.callId());
    expect((await h.collaboration.sync('s1', { ackSeq: 0 })).claims).toHaveLength(2);
    await h.collaboration.publish('s2', { kind: 'claim', summary: 'taking task', taskId: h.task.id }, h.callId());
    // Task CAS stays the authority: w1 can still claim the task.
    const claimed = await h.collaboration.updateTask('s1', { taskId: h.task.id, expectedRevision: 1, action: 'claim' }, h.callId());
    expect(claimed.ownerWorkerId).toBe('w1');
  });
});

describe('finding summary caps and details', () => {
  it('rejects summaries over the per-kind limit with SWARM_INVALID_INPUT', async () => {
    const h = await harness();
    for (const kind of ['observed', 'fact', 'fail', 'claim'] as const) {
      await expect(h.collaboration.publish('s1', { kind, summary: 'x'.repeat(FINDING_SUMMARY_LIMITS[kind] + 1) }, h.callId()))
        .rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT', details: { field: 'summary', limit: 100 } });
      await expect(h.collaboration.publish('s1', { kind, summary: 'x'.repeat(100) }, h.callId())).resolves.toBeTruthy();
    }
    await expect(h.collaboration.publish('s1', { kind: 'patch_summary', summary: 'x'.repeat(301) }, h.callId()))
      .rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT', details: { limit: 300 } });
    await expect(h.collaboration.publish('s1', { kind: 'patch_summary', summary: 'x'.repeat(300) }, h.callId())).resolves.toBeTruthy();
  });

  it('stores details, excludes them from pushed sync/notices, and expands them via read by id', async () => {
    const h = await harness();
    const finding = await h.collaboration.publish('s1',
      { kind: 'fact', summary: 'short gist', details: 'long supporting detail SECRET-DETAIL' }, h.callId());
    expect(h.store.get('run-1').findings[finding.id]?.details).toBe('long supporting detail SECRET-DETAIL');

    const sync = await h.collaboration.sync('s2', { ackSeq: 0 });
    const pushed = sync.events.find((item) => item.finding?.id === finding.id)?.finding;
    expect(pushed).toMatchObject({ summary: 'short gist', hasDetails: true });
    expect(pushed).not.toHaveProperty('details');
    expect(JSON.stringify(notices(h, 'w2'))).not.toContain('SECRET-DETAIL');
    expect(JSON.stringify(notices(h, 'w2'))).toContain('"hasDetails":true');

    const read = await h.collaboration.read('s2', { id: finding.id });
    expect(read.items[0]?.finding?.details).toBe('long supporting detail SECRET-DETAIL');
  });

  it('loads stored findings without details or with long legacy summaries', () => {
    const run = createRun({
      id: 'r', ownerSessionId: 'o', repositoryRoot: '/r', gitCommonDir: '/r/.git', goal: 'g', acceptanceCriteria: ['c'],
      verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1 }] }, baseCommit: 'b', resultRef: 'refs/x', deadline: null, createdAt: 0,
    });
    run.events.push({ kind: 'finding', seq: 1, createdAt: 0, authorWorkerId: 'w', findingId: 'f', taskId: null, findingKind: 'fact', audience: { kind: 'all' } });
    run.nextSeq = 2;
    run.workers = { w: makeWorker('w', 's') };
    run.findings = { f: { id: 'f', seq: 1, authorWorkerId: 'w', taskId: null, kind: 'fact', summary: 'y'.repeat(500),
      scope: [], evidenceRefs: [], supersedesId: null, blockingRepairTaskId: null, createdAt: 0 } };
    const parsed = parseRun(JSON.parse(JSON.stringify(run)));
    expect(parsed.findings['f']?.details).toBeUndefined();
    expect(parsed.findings['f']?.summary).toHaveLength(500);
  });
});

describe('claim TTL config', () => {
  it('defaults to one hour and validates bounds', () => {
    const base = { workerCountMin: 2, defaultWorkerCount: 2, eventPageSize: 20 };
    expect(parseRuntimeConfig(base).claimTtlMs).toBe(3_600_000);
    expect(() => parseRuntimeConfig({ ...base, claimTtlMs: 10 })).toThrow(/runtime config/);
    expect(parseRuntimeConfig({ ...base, claimTtlMs: 120_000 }).claimTtlMs).toBe(120_000);
  });
});
