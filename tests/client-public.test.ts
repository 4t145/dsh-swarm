import { describe, expect, it, vi } from 'vitest';
import { loadClient } from './client-fixture.ts';
import type { PublicQuery } from '../src/public-input.ts';
import type { PublicItem, PublicMessageView, PublicPage } from '../src/public-query.ts';

type Props = Record<string, unknown>;
interface Element { type: string | ((props: Props) => Element); props: Props; children: unknown[] }
interface PageState { sessionId: string; runId: string; queryKey: string; page: PublicPage | null; cursor: string | null; history: (string | null)[]; loading: boolean; error: { code: string; message: string } | null }
interface Pager { reset(query: PublicQuery): Promise<void>; next(): Promise<void>; previous(): Promise<void>; refresh(): void; dispose(): void }
interface Stream { items: PublicItem[]; next: string | null; cursors: string[] }
interface FeedState { streams: Record<'messages' | 'requests' | 'agreements' | 'threads', Stream>; loading: boolean; error: { code: string; message: string } | null; snapshotSeq: number | null; capped: boolean }
interface FeedPager { reset(scope: Props): Promise<void>; older(): Promise<void> | undefined; refresh(): Promise<void> | undefined; dispose(): void }
interface Client {
  publicQueryInput(query: unknown): PublicQuery;
  readPublicPage(page: unknown, runId: string): PublicPage;
  createPublicPager(options: { sessionId: string; runId: string; loadPublic: (sessionId: string, runId: string, query: PublicQuery, signal: AbortSignal) => Promise<unknown>; onChange: (state: PageState) => void }): Pager;
  PublicSection(props: Props): Element;
  ChannelSection(props: Props): Element;
  DmSection(props: Props): Element;
  nextConversation(ids: string[], current: string, key: string): string | null;
  createChannelFeed(options: { sessionId: string; runId: string; loadPublic: (sessionId: string, runId: string, query: PublicQuery, signal: AbortSignal) => Promise<unknown>; onChange: (state: FeedState) => void }): FeedPager;
  channelTimeline(progress: Props, streams?: FeedState['streams'], options?: { showEvents?: boolean }): { key: string; seq: number; kind: string; side: string }[];
  dictionaries: { en: Record<string, string>; zh: Record<string, string> };
}
function load() {
  const react = { createElement: (type: Element['type'], props: Props, ...children: unknown[]): Element => ({ type, props: props ?? {}, children: children.flat(Infinity) }), Fragment: 'fragment',
    useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => undefined], useRef: (initial: unknown) => ({ current: initial }), useEffect: () => undefined };
  const client = loadClient<{ progressClient: Client }>(react).progressClient;
  const t = (key: string, vars: Props = {}) => (client.dictionaries.en[key] ?? key).replace(/\{(\w+)\}/gu, (_, name: string) => String(vars[name]));
  return { client, t };
}
function hookHarness() {
  const cells: unknown[] = [];
  const effects = new Map<number, { dependencies: unknown[]; cleanup: (() => void) | undefined }>();
  let cursor = 0;
  let pending: (() => void)[] = [];
  const loading = new Set<number>();
  const idleWaiters: (() => void)[] = [];
  const react = {
    createElement: (type: Element['type'], props: Props, ...children: unknown[]): Element => ({ type, props: props ?? {}, children: children.flat(Infinity) }), Fragment: 'fragment',
    useState(initial: unknown) { const index = cursor++; if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial;
      return [cells[index], (value: unknown) => {
        const next: unknown = typeof value === 'function' ? value(cells[index]) : value; cells[index] = next;
        if (next !== null && typeof next === 'object' && 'loading' in next) {
          if (next.loading === true) loading.add(index); else loading.delete(index);
          if (!loading.size) idleWaiters.splice(0).forEach((resolve) => resolve());
        }
      }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in cells)) cells[index] = { current: initial }; return cells[index]; },
    useEffect(effect: () => (() => void) | undefined, dependencies: unknown[]) {
      const index = cursor++; const previous = effects.get(index);
      if (previous && previous.dependencies.length === dependencies.length && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
      pending.push(() => { previous?.cleanup?.(); effects.set(index, { dependencies, cleanup: effect() }); });
    },
  };
  const client = loadClient<{ progressClient: Client }>(react).progressClient;
  const t = (key: string, vars: Props = {}) => (client.dictionaries.en[key] ?? key).replace(/\{(\w+)\}/gu, (_, name: string) => String(vars[name]));
  return { client, render(props: Props, component: (props: Props) => Element = client.PublicSection) { cursor = 0; const tree = component({ t, ...props }); const queued = pending; pending = []; queued.forEach((effect) => effect()); return tree; },
    idle() { return loading.size ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve(); },
    dispose() { for (const effect of effects.values()) effect.cleanup?.(); effects.clear(); } };
}
function elements(value: unknown): Element[] {
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  const node = value as Element; return [node, ...node.children.flatMap(elements)];
}
function text(node: Element): string { return node.children.map((value) => typeof value === 'string' ? value : value && typeof value === 'object' && 'children' in value ? text(value as Element) : '').join(' '); }
const message = (patch: Partial<PublicMessageView> = {}): PublicMessageView => ({ id: 'm', kind: 'public', seq: 2, updatedSeq: 2, channelId: 'r:general', threadId: 't', replyToMessageId: 'parent', authorWorkerId: 'a', announcement: false,
  createdAt: 1, editedAt: 1, revision: 1, revisionCount: 2, body: 'Public body', mentions: ['b'], taskIds: ['task'], findingIds: ['finding'], proposalIds: ['proposal'], ...patch });
const page = (items: PublicItem[] = [], patch: Partial<PublicPage> = {}): PublicPage => ({ runId: 'r', items, total: items.length, hasMore: false, truncated: false, nextCursor: null, snapshotSeq: 10, ...patch });
const progress = { runId: 'r', workers: [{ id: 'a', displayName: 'Quiet Otter' }, { id: 'b', displayName: 'Bright Finch' }] };

describe('public client validation and bounded pagination', () => {
  it('validates query fields, record kinds, payload bounds and run identity before rendering', () => {
    const { client } = load();
    expect(client.publicQueryInput({ view: 'messages', channelId: 'r:general', limit: 20 })).toMatchObject({ limit: 20 });
    for (const value of [{ view: 'private' }, { view: 'messages', identity: 'a' }, { view: 'messages', limit: 21 }, { view: 'messages', cursor: 'x'.repeat(2001) }, { view: 'messages', threadId: 1 }]) expect(() => client.publicQueryInput(value)).toThrow();
    const valid = page([{ kind: 'message', message: message() }]);
    expect(client.readPublicPage(valid, 'r')).toEqual(valid);
    for (const patch of [{ items: Array(21).fill(valid.items[0]) }, { items: [{ kind: 'private', body: 'secret' }] }, { items: [{ kind: 'message', message: { ...message(), kind: 'private' } }] }, { nextCursor: 'cursor', hasMore: false }, { items: [{ kind: 'message', message: { ...message(), body: 'x'.repeat(12001) } }] }]) expect(() => client.readPublicPage({ ...valid, ...patch }, 'r')).toThrow('Invalid public');
    expect(() => client.readPublicPage(valid, 'other')).toThrow('Run changed');
  });

  it('keeps only the current page, sends query-bound cursors and supports keyboard-equivalent previous navigation', async () => {
    const { client } = load();
    const states: PageState[] = [];
    const read = vi.fn(async (_session: string, _run: string, query: PublicQuery) => query.cursor
      ? page([{ kind: 'message', message: message({ id: 'm2' }) }], { total: 2 })
      : page([{ kind: 'message', message: message() }], { total: 2, hasMore: true, truncated: true, nextCursor: 'page-2' }));
    const pager = client.createPublicPager({ sessionId: 'owner', runId: 'r', loadPublic: read, onChange: (state) => states.push(state) });
    await pager.reset({ view: 'messages', threadId: 't', query: 'public' });
    await pager.next();
    expect(read.mock.calls[1]?.[2]).toEqual({ view: 'messages', threadId: 't', query: 'public', cursor: 'page-2' });
    expect(states.at(-1)?.page?.items).toHaveLength(1);
    expect(states.at(-1)?.history).toEqual([null]);
    await pager.previous();
    expect(states.at(-1)?.history).toEqual([]);
    expect(states.at(-1)?.page?.items[0]).toMatchObject({ message: { id: 'm' } });
    pager.dispose();
  });

  it('aborts superseded requests and ignores late results after scope changes or unmount', async () => {
    const { client } = load();
    const pending: { signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
    const states: PageState[] = [];
    const read = (_session: string, _run: string, _query: PublicQuery, signal: AbortSignal) => new Promise((resolve) => pending.push({ signal, resolve }));
    const pager = client.createPublicPager({ sessionId: 'owner', runId: 'r', loadPublic: read, onChange: (state) => states.push(state) });
    const old = pager.reset({ view: 'messages', threadId: 'old' });
    const latest = pager.reset({ view: 'threads' });
    expect(pending[0]?.signal.aborted).toBe(true);
    pending[1]!.resolve(page([])); await latest;
    const before = states.length;
    pending[0]!.resolve(page([{ kind: 'message', message: message({ body: 'STALE BODY' }) }])); await old;
    expect(states).toHaveLength(before);
    expect(JSON.stringify(states)).not.toContain('STALE BODY');
    const ending = pager.reset({ view: 'messages' });
    pager.dispose(); expect(pending[2]?.signal.aborted).toBe(true);
    const disposedCount = states.length;
    pending[2]!.resolve(page([{ kind: 'message', message: message({ body: 'UNMOUNTED' }) }])); await ending;
    expect(states).toHaveLength(disposedCount);
  });

  it('guards duplicate page clicks and reports repeated cursors and cross-run replies', async () => {
    const { client } = load();
    const states: PageState[] = [];
    let resolve!: (value: unknown) => void;
    const read = vi.fn(() => new Promise((done) => { resolve = done; }));
    const pager = client.createPublicPager({ sessionId: 'owner', runId: 'r', loadPublic: read, onChange: (state) => states.push(state) });
    const first = pager.reset({ view: 'messages' });
    void pager.next(); void pager.next(); expect(read).toHaveBeenCalledTimes(1);
    resolve(page([], { total: 2, nextCursor: 'same', hasMore: true, truncated: true })); await first;
    const second = pager.next();
    resolve(page([], { total: 2, nextCursor: 'same', hasMore: true, truncated: true })); await second;
    expect(states.at(-1)?.error?.code).toBe('public/invalid');
    const wrong = pager.reset({ view: 'threads' }); resolve(page([], { runId: 'foreign' })); await wrong;
    expect(states.at(-1)?.error?.code).toBe('history/run-changed');
    pager.dispose();
  });
});

const channel = { id: 'r:general', name: 'general', purpose: 'Run-wide', createdByWorkerId: null, status: 'active', revision: 1, createdAt: 1, updatedAt: 1 };
const thread = (id: string, title: string) => ({ id, channelId: 'r:general', title, createdByWorkerId: 'a', participantWorkerIds: ['a'], taskIds: [], status: 'open', conclusionMessageId: null, findingIds: [], revision: 1, seq: 1, updatedSeq: 1, createdAt: 1, updatedAt: 1 });
const request = { id: 'q', seq: 4, channelId: 'r:general', threadId: 't', messageId: 'm', taskIds: [], requestedByWorkerId: 'a', targetWorkerId: 'b', status: 'pending', responseMessageId: null, revision: 1, createdAt: 4, updatedAt: 4 };
const agreement = { id: 'ag', seq: 6, channelId: 'r:general', threadId: 't', title: 'Interface', createdByWorkerId: 'a', version: 2, versionCount: 2, content: 'Contract v2', sourceMessageIds: ['m'], taskIds: [], stakeholderWorkerIds: ['a', 'b'], createdAt: 6, confirmations: [{ workerId: 'a', version: 2, confirmedAt: 7 }] };
const imProgress = { ...progress, phase: 'running', publicActivity: { protocolVersion: 1, latestSeq: 10 },
  workers: progress.workers.map((worker) => ({ ...worker, initializationState: 'ready' })),
  interactions: [
    { seq: 1, kind: 'message', status: 'sent', actorWorkerId: 'a', peerWorkerId: 'b', objectId: '', taskId: null, createdAt: 1 },
    { seq: 3, kind: 'finding', status: 'fact', actorWorkerId: 'a', peerWorkerId: null, objectId: '', taskId: null, createdAt: 3 },
    { seq: 5, kind: 'head', status: 'accepted', actorWorkerId: null, peerWorkerId: 'b', objectId: 'abcdef1234', taskId: null, createdAt: 5 },
  ] };
function publicHost(pages: Partial<Record<string, (query: PublicQuery) => PublicPage>> = {}) {
  return vi.fn(async (_session: string, runId: string, query: PublicQuery) => {
    const custom = pages[query.view];
    if (custom) return { ...custom(query), runId };
    switch (query.view) {
      case 'channels': return page([{ kind: 'channel', channel } as PublicItem]);
      case 'threads': return page([{ kind: 'thread', thread: thread('t', 'API shape') } as PublicItem]);
      case 'messages': return page([{ kind: 'message', message: message({ id: 'parent', seq: 2, body: 'Original idea', replyToMessageId: null }) }, { kind: 'message', message: message({ seq: 7, authorWorkerId: 'b', body: 'Agreed, ship it' }) }]);
      case 'requests': return page([{ kind: 'request', request } as PublicItem]);
      case 'agreements': return page([{ kind: 'agreement', agreement } as PublicItem]);
      default: return page([]);
    }
  });
}

describe('IM conversation sidebar', () => {
  it('renders a vertical tablist with one entry per channel plus Direct messages and roving keyboard focus', async () => {
    const ui = hookHarness();
    const loadPublic = publicHost();
    const props = { progress: imProgress, sessionId: 'owner', loadPublic };
    try {
      ui.render(props); await ui.idle();
      let tree = ui.render(props);
      const list = elements(tree).find((node) => node.props.role === 'tablist')!;
      expect(list.props['aria-orientation']).toBe('vertical');
      let tabs = elements(list).filter((node) => node.props.role === 'tab');
      expect(tabs.map((tab) => tab.props['data-conversation'])).toEqual(['c:r:general', 'dm']);
      expect(text(tabs[0]!)).toContain('# general'); expect(text(tabs[1]!)).toContain('Direct messages');
      expect(tabs.map((tab) => [tab.props['aria-selected'], tab.props.tabIndex])).toEqual([[true, 0], [false, -1]]);
      const panel = elements(tree).find((node) => node.props.role === 'tabpanel')!;
      expect(panel.props['aria-labelledby']).toBe(tabs[0]!.props.id);
      const focus = vi.fn(); const preventDefault = vi.fn();
      (tabs[0]!.props.onKeyDown as (event: Props) => void)({ key: 'ArrowDown', preventDefault, currentTarget: { parentElement: { querySelector: () => ({ focus }) } } });
      expect(preventDefault).toHaveBeenCalled(); expect(focus).toHaveBeenCalled();
      tree = ui.render(props);
      tabs = elements(tree).filter((node) => node.props.role === 'tab');
      expect(tabs.map((tab) => tab.props['aria-selected'])).toEqual([false, true]);
      expect(elements(tree).some((node) => node.type === ui.client.DmSection)).toBe(true);
      expect(ui.client.nextConversation(['a', 'b', 'c'], 'a', 'ArrowUp')).toBe('c');
      expect(ui.client.nextConversation(['a', 'b', 'c'], 'b', 'End')).toBe('c');
      expect(ui.client.nextConversation(['a', 'b', 'c'], 'b', 'Tab')).toBeNull();
    } finally { ui.dispose(); }
  });

  it('keeps the legacy channel and Direct messages entries when the Host lacks the public protocol', () => {
    const { client, t } = load();
    const tree = client.PublicSection({ t, progress, sessionId: 'owner', loadPublic: vi.fn() });
    expect(text(tree)).toContain('This Host does not provide the public channel protocol');
    expect(elements(tree).filter((node) => node.props.role === 'tab').map(text).join('|')).toContain('Direct messages');
  });
});

describe('channel group chat', () => {
  it('merges public messages, requests, agreements and collaboration events in seq order with Host on the right', async () => {
    const ui = hookHarness();
    const loadPublic = publicHost();
    const props = { progress: imProgress, sessionId: 'owner', loadPublic, available: true, channel, conversation: { available: false, bodies: new Map(), state: { items: [] } } };
    try {
      ui.render(props, ui.client.ChannelSection); await ui.idle();
      const tree = ui.render(props, ui.client.ChannelSection);
      const rows = elements(tree).filter((node) => node.props.className === 'dshSwarm_chatRow');
      expect(rows.map((row) => row.props['data-kind'])).toEqual(['message', 'event', 'request', 'event', 'agreement', 'message']);
      expect(rows.map((row) => row.props['data-side'])).toEqual(['left', 'left', 'left', 'right', 'left', 'left']);
      expect(text(rows[0]!)).toContain('Quiet Otter'); expect(text(rows[3]!)).toContain('Host');
      expect(rows.every((row) => elements(row).some((node) => node.type === 'time'))).toBe(true);
      expect(text(rows[2]!)).toContain('Quiet Otter asks Bright Finch to respond');
      expect(text(rows[4]!)).toContain('Agreement v2 · Interface'); expect(text(rows[4]!)).toContain('Awaiting confirmation: Bright Finch');
      const reply = elements(rows[5]!).find((node) => node.type === 'blockquote')!;
      expect(text(reply)).toContain('Original idea');
      expect(text(rows[5]!)).toContain('# API shape');
      expect(elements(tree).every((node) => node.props.dangerouslySetInnerHTML === undefined && node.props.type !== 'submit')).toBe(true);
      // Every query is a read view, newest first, bounded.
      for (const [, , query] of loadPublic.mock.calls) {
        expect(['messages', 'requests', 'agreements', 'threads']).toContain(query.view);
        expect(query).toMatchObject({ channelId: 'r:general', order: 'desc', limit: 20 });
      }
      // Clicking a thread label filters the conversation to that thread.
      const chip = elements(rows[5]!).find((node) => node.props.className === 'dshSwarm_threadChip')!;
      (chip.props.onClick as () => void)();
      ui.render(props, ui.client.ChannelSection); await ui.idle();
      const filtered = loadPublic.mock.calls.filter(([, , query]) => query.threadId === 't').map(([, , query]) => query.view).sort();
      expect(filtered).toEqual(['agreements', 'messages', 'requests']);
      const after = ui.render(props, ui.client.ChannelSection);
      expect(elements(after).filter((node) => node.props['data-kind'] === 'event')).toHaveLength(0);
    } finally { ui.dispose(); }
  });

  it('loads older pages gap-free, one stream at a time, and stays bounded', async () => {
    const { client } = load();
    const states: FeedState[] = [];
    const messagesPage = (query: PublicQuery) => query.cursor
      ? page([{ kind: 'message', message: message({ id: 'old', seq: 3 }) }])
      : page([{ kind: 'message', message: message({ id: 'new', seq: 9 }) }], { total: 2, hasMore: true, truncated: true, nextCursor: 'm2' });
    const loadPublic = publicHost({ messages: messagesPage, requests: () => page([{ kind: 'request', request } as PublicItem]), agreements: () => page([]) });
    const feed = client.createChannelFeed({ sessionId: 'owner', runId: 'r', loadPublic, onChange: (state) => states.push(state) });
    await feed.reset({ channelId: 'r:general' });
    let state = states.at(-1)!;
    // The request at seq 4 is older than the loaded message window (seq 9) and stays hidden until it catches up.
    expect(client.channelTimeline({ ...imProgress, interactions: [] }, state.streams).map((entry) => entry.key)).toEqual(['mnew']);
    const calls = loadPublic.mock.calls.length;
    await feed.older();
    expect(loadPublic.mock.calls.slice(calls).map(([, , query]) => [query.view, query.cursor])).toEqual([['messages', 'm2']]);
    state = states.at(-1)!;
    expect(client.channelTimeline({ ...imProgress, interactions: [] }, state.streams).map((entry) => entry.key)).toEqual(['mold', 'rq', 'mnew']);
    expect(feed.older()).toBeUndefined();
    feed.dispose();
  });
});

describe('direct message picker', () => {
  const dm = (seq: number, from: string, to: string, body: string) => ({ kind: 'message', id: 'd' + seq, seq, authorWorkerId: from, targetWorkerId: to, body, truncated: false, createdAt: seq });
  it('opens the matrix, closes it on a cell choice to show the pair chat, and reopens to switch pairs', () => {
    const ui = hookHarness();
    const items = [dm(1, 'a', 'b', 'Hi'), dm(4, 'b', 'a', 'Hello back')];
    const props = { progress: imProgress, conversation: { available: true, bodies: new Map(), state: { items, next: null, loading: false, error: null }, load: vi.fn() } };
    try {
      let tree = ui.render(props, ui.client.DmSection);
      expect(elements(tree).some((node) => node.props.role === 'dialog')).toBe(true);
      const cells = elements(tree).filter((node) => node.props.className === 'dshSwarm_dmCell');
      expect(cells.map((cell) => cell.children.join(''))).toEqual(['—', '1', '0', '—']);
      (cells[1]!.props.onClick as () => void)();
      tree = ui.render(props, ui.client.DmSection);
      expect(elements(tree).some((node) => node.props.role === 'dialog')).toBe(false);
      const rows = elements(tree).filter((node) => node.props.className === 'dshSwarm_chatRow');
      expect(rows.map((row) => [row.props['data-side'], text(row).includes('Hello back')])).toEqual([['left', false], ['right', true]]);
      const reopen = elements(tree).find((node) => node.type === 'button' && text(node) === 'Switch pair')!;
      (reopen.props.onClick as () => void)();
      tree = ui.render(props, ui.client.DmSection);
      expect(elements(tree).some((node) => node.props.role === 'dialog')).toBe(true);
    } finally { ui.dispose(); }
  });
});

describe('public locale', () => {
  it('keeps public.* and dm.* keys in sync between zh and en', () => {
    const { client } = load();
    for (const prefix of ['public.', 'dm.', 'chat.']) {
      const keys = (lang: 'en' | 'zh') => Object.keys(client.dictionaries[lang]).filter((key) => key.startsWith(prefix)).sort();
      expect(keys('zh')).toEqual(keys('en'));
    }
  });
});
