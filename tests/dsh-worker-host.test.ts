import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';
import { DshWorkerHost } from '../src/dsh-worker-host.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import { createRun, type Run } from '../src/types.ts';

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
