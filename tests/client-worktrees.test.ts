import { loadClient } from './client-fixture.ts';
import { describe, expect, it, vi } from 'vitest';

interface Lane { workerId: string | null; displayName: string | null; branch: string; worktreePath: string | null }
interface Commit extends Lane { id: string; sha: string; parents: string[]; subject: string; committedAt: number }
interface Page { runId: string; items: Commit[]; worktrees: Array<Lane & { head: string | null; diagnostic: string | null }>; nextCursor: string | null }
interface HistoryState extends Page { sessionId: string; started: boolean; loading: boolean; error: { code: string | null; message: string } | null }
type Loader = (sessionId: string, cursor: string | null, signal: AbortSignal) => Promise<unknown>;
interface Pager { loadMore(): Promise<void>; refresh(): Promise<void>; dispose(): void }
interface Element { type: string; props: Record<string, unknown>; children: unknown[] }
interface Client {
  readHistoryPage(page: unknown, runId: string): Page;
  executeHistoryRead(read: Loader, sessionId: string, cursor: string | null, signal: AbortSignal): Promise<unknown>;
  initialHistory(sessionId: string, runId: string): HistoryState;
  createHistoryPager(options: { sessionId: string; runId: string; loadHistory: Loader; onChange(state: HistoryState): void }): Pager;
  observeHistoryEnd(root: object, target: object, loadMore: () => void): (() => void) | undefined;
  GitStreamSection(props: { t: (key: string) => string; progress: { runId: string; workers: unknown[] }; sessionId: string; loadHistory?: Loader }): Element;
  trackLayout(items: Commit[], worktrees: Page['worktrees'], tips: { sha: string; workerId: string }[], more: boolean): { lanes: { key: string }[]; nodes: { lane: { key: string }; merge: boolean; head: boolean }[]; edges: { key: string; kind: string }[]; base: object | null };
  dictionaries: Record<'zh' | 'en', Record<string, string>>;
}
function load(extras: Record<string, unknown> = {}, state?: HistoryState): Client {
  return loadClient<{ progressClient: Client }>({
    createElement: (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children }),
    useState: (init: () => unknown) => [state ?? init(), vi.fn()], useRef: () => ({ current: null }), useEffect: vi.fn(),
  }, extras).progressClient;
}
const client = load();
const lane: Lane = { workerId: 'w1', displayName: 'Bright Otter', branch: 'run-w1', worktreePath: '/repo/.agents/worktrees/w1' };
const sha = (letter: string) => letter.repeat(40);
const commit = (letter: string, extra: Partial<Commit> = {}): Commit => ({ ...lane, id: sha(letter), sha: sha(letter), parents: [sha('a')], subject: `Commit ${letter}`, committedAt: 1000, ...extra });
const page = (items: Commit[], nextCursor: string | null = null): Page => ({ runId: 'run', items, nextCursor, worktrees: [{ ...lane, head: sha('f'), diagnostic: null }] });
function setup(loadHistory: Loader) {
  let state = client.initialHistory('owner', 'run');
  const onChange = vi.fn((next: HistoryState) => { state = next; });
  const pager = client.createHistoryPager({ sessionId: 'owner', runId: 'run', loadHistory, onChange });
  return { pager, onChange, state: () => state };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('type' in node) || !('children' in node)) return [];
  const element = node as Element;
  return [element, ...element.children.flatMap(elements)];
}

describe('Git worktree history paging', () => {
  it('keeps Git order, appends pages once and stops at the last cursor', async () => {
    const read = vi.fn<Loader>().mockResolvedValueOnce(page([commit('f'), commit('e')], 'page-2'))
      .mockResolvedValueOnce(page([commit('e'), commit('d')]));
    const view = setup(read);
    await view.pager.loadMore();
    await view.pager.loadMore();
    await view.pager.loadMore();
    expect(read.mock.calls.map((call) => call.slice(0, 2))).toEqual([['owner', null], ['owner', 'page-2']]);
    expect(view.state().items.map((item) => item.sha)).toEqual([sha('f'), sha('e'), sha('d')]);
    expect(view.state()).toMatchObject({ started: true, loading: false, error: null, nextCursor: null });
    view.pager.dispose();
  });

  it('coalesces concurrent scroll requests and aborts on unmount without late state writes', async () => {
    const waiting = deferred<Page>();
    const read = vi.fn<Loader>(() => waiting.promise);
    const view = setup(read);
    const pending = view.pager.loadMore();
    await view.pager.loadMore();
    expect(read).toHaveBeenCalledTimes(1);
    view.pager.dispose();
    expect(read.mock.calls[0]?.[2].aborted).toBe(true);
    const count = view.onChange.mock.calls.length;
    waiting.resolve(page([commit('f')]));
    await pending;
    expect(view.onChange).toHaveBeenCalledTimes(count);
    await view.pager.loadMore();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('refresh cancels and discards an older snapshot even if it resolves after the new one', async () => {
    const waiting = deferred<Page>();
    const read = vi.fn<Loader>().mockImplementationOnce(() => waiting.promise).mockResolvedValueOnce(page([commit('e')]));
    const view = setup(read);
    const old = view.pager.loadMore();
    await view.pager.refresh();
    waiting.resolve(page([commit('f')], 'stale-cursor'));
    await old;
    expect(read.mock.calls[0]?.[2].aborted).toBe(true);
    expect(view.state().items.map((item) => item.sha)).toEqual([sha('e')]);
    expect(view.state().nextCursor).toBe(null);
    view.pager.dispose();
  });

  it('retains useful earlier pages on errors and retries the same cursor explicitly', async () => {
    const read = vi.fn<Loader>().mockResolvedValueOnce(page([commit('f')], 'page-2'))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([commit('e')]));
    const view = setup(read);
    await view.pager.loadMore();
    await view.pager.loadMore();
    expect(view.state()).toMatchObject({ error: { message: 'offline' }, nextCursor: 'page-2', loading: false });
    expect(view.state().items).toHaveLength(1);
    await view.pager.loadMore();
    expect(read.mock.calls.map((call) => call[1])).toEqual([null, 'page-2', 'page-2']);
    expect(view.state().items).toHaveLength(2);
    expect(view.state().error).toBe(null);
    view.pager.dispose();
  });

  it('rejects wrong-run, malformed and looping pages without replacing useful data', async () => {
    for (const invalid of [null, { ...page([]), runId: 'another-run' }, { ...page([]), nextCursor: 1 }, page([commit('x')]), page([commit('f', { committedAt: NaN })])]) {
      expect(() => client.readHistoryPage(invalid, 'run')).toThrow();
    }
    const read = vi.fn<Loader>().mockResolvedValueOnce(page([commit('f')], 'page-2'))
      .mockResolvedValueOnce(page([commit('e')], 'page-2'));
    const view = setup(read);
    await view.pager.loadMore();
    await view.pager.loadMore();
    expect(view.state()).toMatchObject({ error: { code: 'history/invalid' }, nextCursor: 'page-2' });
    expect(view.state().items).toHaveLength(1);
    view.pager.dispose();
  });

  it('unwraps unary Remote results and preserves capability errors', async () => {
    const signal = new AbortController().signal;
    const read = vi.fn<Loader>().mockResolvedValue({ ok: true, value: page([]) });
    await expect(client.executeHistoryRead(read, 'owner', null, signal)).resolves.toEqual(page([]));
    expect(read).toHaveBeenCalledExactlyOnceWith('owner', null, signal);
    read.mockResolvedValue({ ok: false, error: { code: 'gateway/method-unavailable', message: 'Old Host' } });
    await expect(client.executeHistoryRead(read, 'owner', null, signal)).rejects.toMatchObject({ code: 'gateway/method-unavailable', message: 'Old Host' });
  });
});

describe('Git history infinite-scroll enhancement and presentation', () => {
  it('observes only the sentinel and disposes the observer, with a no-API fallback', () => {
    let callback!: (entries: { isIntersecting: boolean }[]) => void;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const construct = vi.fn();
    const enhanced = load({ IntersectionObserver: class {
      constructor(handler: typeof callback, options: unknown) { callback = handler; construct(options); }
      observe = observe;
      disconnect = disconnect;
    } });
    const root = {}, target = {}, next = vi.fn();
    const dispose = enhanced.observeHistoryEnd(root, target, next);
    expect(construct).toHaveBeenCalledWith({ root, rootMargin: '0px 0px 240px 0px' });
    expect(observe).toHaveBeenCalledExactlyOnceWith(target);
    callback([{ isIntersecting: false }]);
    expect(next).not.toHaveBeenCalled();
    callback([{ isIntersecting: true }]);
    expect(next).toHaveBeenCalledTimes(1);
    dispose?.();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(client.observeHistoryEnd(root, target, next)).toBeUndefined();
  });

  it('renders merged commit identities, source lanes and a keyboard-operable load-more fallback', () => {
    const state: HistoryState = { ...client.initialHistory('owner', 'run'), ...page([commit('f', { parents: [sha('a'), sha('b')] })], 'page-2'), started: true };
    const rendered = load({}, state).GitStreamSection({ t: (key) => key, progress: { runId: 'run', workers: [] }, sessionId: 'owner', loadHistory: async () => page([]) });
    const all = elements(rendered);
    expect(all.find((item) => item.props.className === 'dshSwarm_gitScroll')?.props).toMatchObject({ tabIndex: 0, role: 'region', 'aria-busy': false });
    const canvas = all.find((item) => item.props.className === 'dshSwarm_trackCanvas');
    expect(canvas).toBeTruthy();
    const labels = all.filter((item) => item.props.className === 'dshSwarm_trackLabel');
    expect(labels).toHaveLength(1);
    expect(labels[0]?.props).toMatchObject({ key: sha('f') });
    expect(all.find((item) => item.type === 'button' && item.children.includes('git.more'))?.props).toMatchObject({ type: 'button', disabled: false });
    const text = JSON.stringify(rendered);
    for (const label of ['Bright Otter', 'run-w1', 'git.source', 'git.merge', sha('f').slice(0, 10)]) expect(text).toContain(label);
    expect(text).not.toContain('authored by');
  });

  it('never renders preceding-session data while effects are switching', () => {
    const state: HistoryState = { ...client.initialHistory('old-owner', 'run'), ...page([commit('f')]), started: true };
    const rendered = load({}, state).GitStreamSection({ t: (key) => key, progress: { runId: 'run', workers: [] }, sessionId: 'new-owner', loadHistory: async () => page([]) });
    expect(elements(rendered).filter((item) => item.props.className === 'dshSwarm_trackLabel')).toHaveLength(0);
  });

  it('puts each commit on its worktree track by first-parent chain and routes merges between tracks', () => {
    const w1 = { ...lane, head: sha('b'), diagnostic: null };
    const w2 = { ...lane, workerId: 'w2', displayName: 'Calm Heron', branch: 'run-w2', head: sha('c'), diagnostic: null };
    const result = { workerId: null, displayName: null, branch: 'swarm/result', worktreePath: null, head: sha('e'), diagnostic: null };
    // --source attributes everything to the result head; layout must still split tracks.
    const src = { workerId: null, displayName: null, branch: 'swarm/result', worktreePath: null };
    const items = [
      commit('e', { ...src, parents: [sha('d'), sha('b')] }),
      commit('c', { ...src, parents: [sha('d')] }),
      commit('b', { ...src, parents: [sha('d')] }),
      commit('d', { ...src, parents: [sha('0')] }),
    ];
    const layout = client.trackLayout(items, [w1, w2, result], [], false);
    expect(layout.lanes.map((item) => item.key)).toEqual(['result:swarm/result', 'worker:w1', 'worker:w2']);
    expect(layout.nodes.map((node) => node.lane.key)).toEqual(['result:swarm/result', 'worker:w2', 'worker:w1', 'result:swarm/result']);
    expect(layout.nodes[0]).toMatchObject({ merge: true, head: true });
    const kinds = Object.fromEntries(layout.edges.map((edge) => [edge.key, edge.kind]));
    expect(kinds[`${sha('e')}:${sha('d')}`]).toBe('track');
    expect(kinds[`${sha('e')}:${sha('b')}`]).toBe('merge');
    expect(kinds[`${sha('b')}:${sha('d')}`]).toBe('branch');
    // The pre-run parent becomes a base terminus only when no older page exists.
    expect(layout.base).not.toBeNull();
    expect(client.trackLayout(items, [w1, w2, result], [], true).base).toBeNull();
  });

  it('keeps merged worker commits on their track through proposal tips after HEAD moves on', () => {
    const w1 = { ...lane, head: sha('c'), diagnostic: null };
    const result = { workerId: null, displayName: null, branch: 'swarm/result', worktreePath: null, head: sha('e'), diagnostic: null };
    const src = { workerId: null, displayName: null, branch: 'swarm/result', worktreePath: null };
    const items = [
      commit('c', { ...src, parents: [sha('d')] }),
      commit('e', { ...src, parents: [sha('d'), sha('b')] }),
      commit('b', { ...src, parents: [sha('d')] }),
      commit('d', { ...src, parents: [sha('0')] }),
    ];
    const keys = (tips: { sha: string; workerId: string }[]) => client.trackLayout(items, [w1, result], tips, false).nodes.map((node) => node.lane.key);
    // Without a tip, b is only reachable from the result head and falls back to the trunk.
    expect(keys([])[2]).toBe('result:swarm/result');
    expect(keys([{ sha: sha('b'), workerId: 'w1' }])[2]).toBe('worker:w1');
  });

  it('provides bilingual labels and retains truthful unavailable/empty states', () => {
    for (const key of ['git.title', 'git.more', 'git.end', 'git.empty', 'git.unavailable', 'git.snapshot', 'git.source', 'git.failed', 'git.retry']) {
      expect(client.dictionaries.en[key]).toBeTruthy();
      expect(client.dictionaries.zh[key]).toBeTruthy();
    }
    const rendered = client.GitStreamSection({ t: (key) => key, progress: { runId: 'run', workers: [] }, sessionId: 'owner' });
    expect(JSON.stringify(rendered)).toContain('git.unavailable');
  });
});
