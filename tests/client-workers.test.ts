import { clientSource as source, loadClient } from './client-fixture.ts';
import { describe, expect, it } from 'vitest';

// Fact derivations only; these tests do not claim browser or visual acceptance.
type Worker = Record<string, unknown> & { id: string };
interface Progress { runId: string; workers: Worker[] }
interface Selection { runId: string; workerId: string | null }
interface Client {
  deriveWorker(worker: Worker): { task: unknown; work: string; activity: string; activeTools: unknown[] };
  selectWorkers(progress: Progress, selection: Selection | null): { selectedId: string | null; items: { worker: Worker; number: number }[] };
  dictionaries: Record<'en' | 'zh', Record<string, string>>;
}
const client = loadClient<{ progressClient: Client }>().progressClient;

function worker(overrides: Record<string, unknown> = {}): Worker {
  return {
    id: 'w1', nativeStatus: 'running', initializationState: 'ready',
    currentTask: { id: 't1', subject: 'Current task', status: 'claimed', revision: 2 },
    currentProposal: null, wait: null, diagnostic: null,
    activity: { status: 'running', activeTools: [], recentTools: [], diagnostic: null },
    ...overrides,
  };
}
const executing = { status: 'executing', activeTools: [{ id: 'call1', name: 'read', status: 'executing' }, { id: 'call2', name: 'edit', status: 'completed' }] };

describe('worker fact hierarchy', () => {
  it('does not infer selecting work from a running native status', () => {
    expect(client.deriveWorker(worker({ currentTask: null }))).toMatchObject({ task: null, work: 'unassigned', activity: 'running' });
  });

  it('keeps ownership, collaboration wait and queued integration distinct', () => {
    const waiting = worker({ wait: { mode: 'any', afterSeq: 3, taskIds: [], proposalIds: [] } });
    expect(client.deriveWorker(waiting)).toMatchObject({ work: 'waiting', task: { status: 'claimed' } });
    expect(client.deriveWorker({ ...waiting, currentProposal: { status: 'queued' } }).work).toBe('integration');
    expect(client.deriveWorker({ ...waiting, currentProposal: { status: 'integrating' } }).work).toBe('integrating');
  });

  it('never presents inactive or unavailable workers as executing tools', () => {
    expect(client.deriveWorker(worker({ activity: executing })).activeTools).toEqual([executing.activeTools[0]]);
    expect(client.deriveWorker(worker({ nativeStatus: 'inactive', activity: executing }))).toMatchObject({ task: { status: 'claimed' }, work: 'assigned', activity: 'idle', activeTools: [] });
    for (const nativeStatus of ['unavailable', 'future-status']) {
      expect(client.deriveWorker(worker({ nativeStatus, activity: executing }))).toMatchObject({ activity: 'unavailable', activeTools: [] });
    }
  });

  it('preserves unavailable activity instead of replacing it with inactivity', () => {
    expect(client.deriveWorker(worker({ nativeStatus: 'inactive', activity: { status: 'unavailable' } }))).toMatchObject({ activity: 'unavailable', activeTools: [] });
    expect(client.deriveWorker(worker({ activity: undefined }))).toMatchObject({ activity: 'legacy', activeTools: [] });
    expect(client.deriveWorker(worker({ initializationState: 'future-state' })).work).toBe('unavailable');
  });

  it('removes completed and cancelled task pointers without inventing a replacement', () => {
    for (const status of ['done', 'cancelled']) {
      expect(client.deriveWorker(worker({ currentTask: { id: 'old', status } }))).toMatchObject({ task: null, work: 'unassigned' });
    }
  });
});

describe('member focus', () => {
  const progress: Progress = { runId: 'run1', workers: [worker(), worker({ id: 'w2' })] };

  it('preserves original worker numbering and offers all members by default', () => {
    expect(client.selectWorkers(progress, null).items.map((item) => item.number)).toEqual([1, 2]);
    const focused = client.selectWorkers(progress, { runId: 'run1', workerId: 'w2' });
    expect(focused.selectedId).toBe('w2');
    expect(focused.items.map((item) => [item.worker.id, item.number])).toEqual([['w2', 2]]);
    expect(client.selectWorkers(progress, { runId: 'run1', workerId: null }).items).toHaveLength(2);
  });

  it('clears focus synchronously on a new run or missing member', () => {
    for (const selection of [{ runId: 'old-run', workerId: 'w2' }, { runId: 'run1', workerId: 'removed' }]) {
      expect(client.selectWorkers(progress, selection)).toMatchObject({ selectedId: null, items: [{ number: 1 }, { number: 2 }] });
    }
  });

  it('provides bilingual focus and disclosure labels without a completion disclaimer', () => {
    for (const key of ['workers.filter', 'workers.all', 'worker.task', 'worker.execution', 'worker.snapshot', 'work.unavailable', 'tools.moreActive', 'wait.targets']) {
      expect(client.dictionaries.en[key]).toBeTruthy();
      expect(client.dictionaries.zh[key]).toBeTruthy();
    }
    expect(source).toContain('"aria-pressed": focused.selectedId === workerId');
    expect(source).toContain('timeElement(tool.startedAt)');
    expect(source).toContain('timeElement(tool.finishedAt)');
    expect(source).not.toContain('t("worker.inactiveNote"');
    expect(source).not.toContain('t("workers.note"');
  });
});
