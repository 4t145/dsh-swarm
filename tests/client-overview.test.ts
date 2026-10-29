import { clientSource as source, loadClient } from './client-fixture.ts';
import { describe, expect, it } from 'vitest';

// Pure presentation facts only. These checks are not a browser/visual acceptance test.
interface Task { id: string; status: string }
interface Event { seq: number; kind: string }
interface Progress {
  phase?: string;
  quiesceTarget?: string;
  acceptedHead?: string;
  baseCommit?: string;
  finishRequest?: unknown;
  taskBoard?: { items: Task[]; total: number; truncated: boolean };
  recentEvents?: Event[];
}
interface Client {
  filterTasks(progress: Progress, status: string): Task[];
  filterEvents(progress: Progress, kind: string): Event[];
  deliveryState(progress: Progress): string;
  dictionaries: Record<'zh' | 'en', Record<string, string>>;
}
const client = loadClient<{ progressClient: Client }>().progressClient;

describe('overview and collaboration presentation', () => {
  it('filters only supplied tasks without inventing missing/truncated rows', () => {
    const items = [{ id: 'open', status: 'open' }, { id: 'claimed', status: 'claimed' }, { id: 'cancelled', status: 'cancelled' }];
    const progress = { taskBoard: { items, total: 50, truncated: true } };
    expect(client.filterTasks(progress, 'all')).toEqual(items);
    expect(client.filterTasks(progress, 'claimed')).toEqual([items[1]]);
    expect(client.filterTasks(progress, 'done')).toEqual([]);
    expect(client.filterTasks({}, 'all')).toEqual([]);
    expect(progress.taskBoard.items).toEqual(items);
  });

  it('filters recent public events newest first, without mutating Host order', () => {
    const recentEvents = [{ seq: 1, kind: 'task' }, { seq: 2, kind: 'proposal' }, { seq: 3, kind: 'task' }, { seq: 4, kind: 'head' }];
    expect(client.filterEvents({ recentEvents }, 'task')).toEqual([recentEvents[2], recentEvents[0]]);
    expect(client.filterEvents({ recentEvents }, 'all').map((event) => event.seq)).toEqual([4, 3, 2, 1]);
    expect(client.filterEvents({ recentEvents }, 'run')).toEqual([]);
    expect(client.filterEvents({}, 'all')).toEqual([]);
    expect(recentEvents.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
  });

  it('distinguishes baseline, accepted revision and completed delivery', () => {
    const progress = { phase: 'running', acceptedHead: 'base', baseCommit: 'base' };
    expect(client.deliveryState(progress)).toBe('baseline');
    expect(client.deliveryState({ ...progress, acceptedHead: 'new' })).toBe('integrated');
    expect(client.deliveryState({ ...progress, finishRequest: { id: 'request-only' } })).toBe('baseline');
    expect(client.deliveryState({ ...progress, phase: 'draining' })).toBe('verifying');
    expect(client.deliveryState({ ...progress, phase: 'quiescing', quiesceTarget: 'completed' })).toBe('closing');
    for (const phase of ['completed', 'failed', 'stopped']) expect(client.deliveryState({ ...progress, phase })).toBe(phase);
    expect(client.deliveryState({ ...progress, phase: 'quiescing', quiesceTarget: 'stopped' })).not.toBe('completed');
  });

  it('keeps filters keyboard-operable, bounded-data notices and run-scoped state', () => {
    expect(source).toContain('"aria-pressed": selected');
    expect(source).toContain('key: sessionId + ":" + current.progress.runId');
    expect(source).toContain('board?.truncated');
    expect(source).toContain('h(DeliveryCard, { t, progress: p })');
    for (const key of ['tasks.snapshot', 'tasks.noMatch', 'events.scope', 'events.sourceNote', 'delivery.integrated', 'delivery.completed']) {
      expect(client.dictionaries.zh[key]).toBeTruthy();
      expect(client.dictionaries.en[key]).toBeTruthy();
    }
    expect(Object.keys(client.dictionaries.zh).sort()).toEqual(Object.keys(client.dictionaries.en).sort());
  });
});
