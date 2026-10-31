import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage, type MessageSource, type ContentBlock } from '@deepseek-ai/dsh-llm';
import { deliverSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal';
import { SubagentError } from '@deepseek-ai/dsh-subagent';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { DshWorkerHost } from '../src/dsh-worker-host.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import { createRun, type Run } from '../src/types.ts';
import type { NotificationRecord } from '../src/public-types.ts';

async function initializationHarness() {
  const root = await mkdtemp(join(tmpdir(), 'swarm-native-init-'));
  const integration = join(root, 'build'), worktree = join(root, 'worker');
  await Promise.all([mkdir(integration), mkdir(worktree)]);
  const ctx = new Context();
  const records = new Map<string, Run>();
  const store = new MemoryStateStore({
    get: (id) => records.get(id), entries: () => records.entries(),
    put: async (id, run) => { records.set(id, structuredClone(run)); },
    update: async (id, reduce) => {
      const previous = records.get(id);
      if (!previous) throw new Error('missing fixture');
      const next = reduce(structuredClone(previous));
      records.set(id, next);
      return next;
    },
  });
  const run = createRun({
    id: 'r', ownerSessionId: 'owner', repositoryRoot: root, gitCommonDir: join(root, '.git'),
    goal: 'test', acceptanceCriteria: ['test'], verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
    baseCommit: 'a'.repeat(40), resultRef: 'refs/heads/swarm-r-result', deadline: null,
  });
  run.phase = 'running';
  run.integrationWorktree = integration;
  run.acceptedHead = 'b'.repeat(40);
  run.workers['w'] = {
    id: 'w', displayName: 'Bright Otter', sessionId: 'worker', branch: 'swarm-r-w', worktreePath: null,
    initializationState: 'pending', initializationError: null, unavailableReason: null,
    offeredSeq: 0, observedSeq: 0, notifiedSeq: 0, wakeTargetSeq: 0,
    waitRegistration: null, currentTaskId: null, createdAt: Date.now(),
  };
  await store.create(run);
  // Native adapter consumes Agent identity only in this fixture; no model loop is emulated.
  const agent = { id: SessionId('worker') } as Agent;
  const owner = { id: SessionId('owner') } as Agent;
  const create = vi.fn(async (_agent: Agent, _request: unknown, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    return { repositoryRoot: root, path: worktree, branch: 'swarm-r-w' };
  });
  const set = vi.fn(async (_agent: Agent, path: string, signal?: AbortSignal) => { signal?.throwIfAborted(); return path; });
  const emit = (signal: AbortSignal) => ctx.events.serial('agent/created', { agent, source: 'startup', signal });
  const startActivation = vi.fn(async (spec: { signal: AbortSignal }) => {
    await emit(spec.signal);
    return { result: new Promise(() => {}), dispose: async () => {} };
  });
  ctx.provide('agents', { get: (id: string) => id === 'owner' ? owner : undefined });
  const deliver = vi.fn(async (_parent: Agent, _child: string, content: ContentBlock[], source: MessageSource) =>
    createUserMessage({ source, content }).id);
  ctx.provide('subagents', { getProvider: () => ({}), startActivation, [deliverSubagentPrompt]: deliver,
    sendMessage: () => { throw new Error('model-authored messaging must not carry Host protocol'); } });
  ctx.provide('worktrees', { create });
  ctx.provide('workingDirectory', { set });
  const host = new DshWorkerHost(ctx, store);
  return { root, integration, worktree, ctx, store, host, create, set, emit, startActivation, deliver,
    close: async () => { await host.dispose(); await store.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); },
  };
}

describe('native initialization cancellation', () => {
  it('reports native capacity rejection distinctly instead of team-limit or false start success', async () => {
    const h = await initializationHarness();
    try {
      h.startActivation.mockRejectedValueOnce(new SubagentError('active child limit: 3', 'ACTIVATION_LIMIT_REACHED'));
      const run = h.store.get('r');
      await expect(h.host.start({ run, worker: run.workers.w!, signal: new AbortController().signal })).rejects.toMatchObject({
        code: 'SWARM_NATIVE_CAPACITY', details: { nativeCode: 'ACTIVATION_LIMIT_REACHED', ownerSessionId: 'owner' },
      });
      expect(h.create).not.toHaveBeenCalled();
      expect(h.host.workerStatus('worker')).toBe('unavailable');
    } finally { await h.close(); }
  });

  it('uses the native host delivery adapter and preserves exact receipt source without acknowledging inbox acceptance', async () => {
    const h = await initializationHarness();
    try {
      const { deliver } = h;
      const run = h.store.get('r');
      const notification: NotificationRecord = { id: 'n1', seq: 3, workerId: 'w', channelId: 'r:general',
        threadId: null, messageId: null, requestId: null, agreementId: null,
        reasons: ['mention'], priority: 'immediate', createdAt: 0, deliveredAt: null, acknowledgedAt: null };
      await h.host.notify(run, run.workers.w!, 3, new AbortController().signal, [notification]);
      expect(deliver).toHaveBeenCalledTimes(1);
      expect(deliver.mock.calls[0]?.[3]).toMatchObject({ kind: 'swarm-context', proof: { receipt: {
        runId: 'r', ranges: [], notifications: [{ id: 'n1', seq: 3 }], messages: [],
      } } });
      expect(deliver.mock.calls[0]?.[1]).toBe('worker');
      expect(h.store.get('r').workers.w?.shownSeq).toBeUndefined();
      expect(notification.acknowledgedAt).toBeNull();
    } finally { await h.close(); }
  });

  it('keeps a pre-create abort pending and later starts with readable name at acceptedHead', async () => {
    const h = await initializationHarness();
    try {
      const aborted = new AbortController();
      aborted.abort(new Error('pause'));
      await expect(h.emit(aborted.signal)).rejects.toThrow('pause');
      expect(h.create).not.toHaveBeenCalled();
      expect(h.store.get('r').workers['w']).toMatchObject({ initializationState: 'pending', worktreePath: null });
      const run = h.store.get('r'), worker = run.workers['w'];
      if (!worker) throw new Error('missing worker');
      await h.host.start({ run, worker, signal: new AbortController().signal });
      expect(h.startActivation).toHaveBeenCalledWith(expect.objectContaining({ label: 'Bright Otter · swarm r' }));
      expect(h.create).toHaveBeenCalledWith(expect.anything(), { name: 'swarm-r-w', from: 'b'.repeat(40) }, expect.any(AbortSignal));
      expect(h.store.get('r').workers['w']).toMatchObject({ initializationState: 'ready', worktreePath: h.worktree });
    } finally { await h.close(); }
  });

  it('persists a verified worker path before cancelled cwd switch and reuses it', async () => {
    const h = await initializationHarness();
    try {
      const controller = new AbortController();
      h.set.mockImplementationOnce(async () => {
        controller.abort(new Error('pause during cwd switch'));
        controller.signal.throwIfAborted();
        return h.worktree;
      });
      await expect(h.emit(controller.signal)).rejects.toThrow('pause during cwd switch');
      expect(h.store.get('r').workers['w']).toMatchObject({ initializationState: 'pending', worktreePath: h.worktree });
      await h.emit(new AbortController().signal);
      expect(h.create).toHaveBeenCalledTimes(1);
      expect(h.store.get('r').workers['w']).toMatchObject({ initializationState: 'ready', initializationError: null });
    } finally { await h.close(); }
  });

  it('does not retry an aborted create whose worktree outcome is unknown', async () => {
    const h = await initializationHarness();
    try {
      const controller = new AbortController();
      h.create.mockImplementationOnce(async () => {
        controller.abort(new Error('unknown partial creation'));
        throw controller.signal.reason;
      });
      await expect(h.emit(controller.signal)).rejects.toThrow('unknown partial creation');
      expect(h.store.get('r').workers['w']).toMatchObject({ initializationState: 'failed', worktreePath: null, initializationError: 'unknown partial creation' });
      await expect(h.emit(new AbortController().signal)).rejects.toThrow('inspect its worktree');
      expect(h.store.get('r').workers['w']?.initializationError).toBe('unknown partial creation');
      expect(h.create).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  });

  it('retains a recorded integration tree if cancellation precedes worker creation', async () => {
    const h = await initializationHarness();
    try {
      await h.store.update('r', (run) => ({ ...run, integrationWorktree: null }));
      h.create.mockResolvedValueOnce({ repositoryRoot: h.root, path: h.integration, branch: 'swarm-r-build' });
      const controller = new AbortController();
      h.set.mockImplementationOnce(async () => {
        controller.abort(new Error('pause after integration'));
        controller.signal.throwIfAborted();
        return h.root;
      });
      await expect(h.emit(controller.signal)).rejects.toThrow('pause after integration');
      expect(h.store.get('r').integrationWorktree).toBe(h.integration);
      expect(h.store.get('r').workers['w']).toMatchObject({ initializationState: 'pending', worktreePath: null });
      await h.emit(new AbortController().signal);
      expect(h.create).toHaveBeenCalledTimes(2); // Integration once, worker once; no recreation.
      expect(h.store.get('r').workers['w']?.initializationState).toBe('ready');
    } finally { await h.close(); }
  });
});

describe('native worker job ownership', () => {
  it('does not cancel unowned or another Session jobs when stopping a run', async () => {
    const ctx = new Context();
    const records = new Map<string, Run>();
    const table: RunTable = {
      get: (id) => records.get(id),
      entries: () => records.entries(),
      put: async (id, run) => { records.set(id, structuredClone(run)); },
      update: async (id, reduce) => {
        const run = records.get(id);
        if (!run) throw new Error('missing fixture');
        const next = reduce(structuredClone(run));
        records.set(id, next);
        return next;
      },
    };
    const store = new MemoryStateStore(table);
    const run = createRun({
      id: 'r', ownerSessionId: 'owner', repositoryRoot: '/repo', gitCommonDir: '/repo/.git',
      goal: 'test', acceptanceCriteria: ['test'], verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
      baseCommit: 'a'.repeat(40), resultRef: 'refs/heads/swarm-r-result', deadline: Date.now() + 60000,
    });
    run.workers['w'] = {
      id: 'w', sessionId: 'worker', branch: 'swarm-r-w', worktreePath: '/repo/w',
      initializationState: 'ready', initializationError: null, unavailableReason: null,
      offeredSeq: 0, observedSeq: 0, notifiedSeq: 0, wakeTargetSeq: 0,
      waitRegistration: null, currentTaskId: null, createdAt: Date.now(),
    };
    await store.create(run);
    const jobs = [
      { id: 'own', owner: 'worker', status: 'running' },
      { id: 'unowned', owner: undefined, status: 'running' },
      { id: 'foreign', owner: 'other', status: 'running' },
    ];
    const killed: string[] = [];
    ctx.provide('agents', { get: (id: string) => id === 'owner' ? { id } : undefined });
    ctx.provide('subagents', { drainChildren: async () => undefined });
    ctx.provide('jobs', {
      list: () => jobs,
      kill: (id: string) => { killed.push(id); const job = jobs.find((item) => item.id === id); if (job) job.status = 'completed'; return 'requested'; },
      wait: async (id: string) => jobs.find((job) => job.id === id),
    });
    const host = new DshWorkerHost(ctx, store);
    expect(host.isWorkerBusy('worker')).toBe(true);
    await host.stop(run);
    expect(killed).toEqual(['own']);
    expect(jobs.filter((job) => job.status === 'running').map((job) => job.id)).toEqual(['unowned', 'foreign']);
    expect(host.isWorkerBusy('worker')).toBe(false);
    await host.dispose();
    await store.close();
  });
});
