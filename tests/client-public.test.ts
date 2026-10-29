import { describe, expect, it, vi } from 'vitest';
import { loadClient } from './client-fixture.ts';
import type { PublicQuery } from '../src/public-input.ts';
import type { PublicItem, PublicMessageView, PublicPage } from '../src/public-query.ts';

type Props = Record<string, unknown>;
interface Element { type: string | ((props: Props) => Element); props: Props; children: unknown[] }
interface PageState { sessionId: string; runId: string; queryKey: string; page: PublicPage | null; cursor: string | null; history: (string | null)[]; loading: boolean; error: { code: string; message: string } | null }
interface Pager { reset(query: PublicQuery): Promise<void>; next(): Promise<void>; previous(): Promise<void>; refresh(): void; dispose(): void }
interface Client {
  publicQueryInput(query: unknown): PublicQuery;
  readPublicPage(page: unknown, runId: string): PublicPage;
  createPublicPager(options: { sessionId: string; runId: string; loadPublic: (sessionId: string, runId: string, query: PublicQuery, signal: AbortSignal) => Promise<unknown>; onChange: (state: PageState) => void }): Pager;
  PublicRecord(props: Props): Element;
  PublicSection(props: Props): Element;
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
  return { client, render(props: Props) { cursor = 0; const tree = client.PublicSection({ t, ...props }); const queued = pending; pending = []; queued.forEach((effect) => effect()); return tree; },
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

describe('live public pane lifecycle', () => {
  it('preserves a deep page on metadata updates, advertises refresh and replaces only on explicit action', async () => {
    const ui = hookHarness();
    let snapshotSeq = 10;
    const loadPublic = vi.fn(async (_session: string, runId: string, query: PublicQuery) => query.view === 'threads'
      ? page([{ kind: 'thread', thread: { id: query.cursor ? 'second' : 'first', channelId: 'r:general', title: 'Thread', createdByWorkerId: 'a', participantWorkerIds: ['a'], taskIds: [], status: 'open', conclusionMessageId: null, findingIds: [], revision: 1, seq: 1, updatedSeq: 1, createdAt: 1, updatedAt: 1 } }],
        { runId, snapshotSeq, total: 2, hasMore: !query.cursor, truncated: !query.cursor, nextCursor: query.cursor ? null : 'page2' })
      : page([], { runId, snapshotSeq }));
    const props = { progress: { ...progress, publicActivity: { protocolVersion: 1, latestSeq: 10 } }, sessionId: 'owner', loadPublic };
    const mainReader = (tree: Element) => elements(tree).filter((node) => typeof node.type === 'function' && node.type.name === 'PublicPagination').at(-1)!.props.reader as { state: PageState; pager: { current: Pager | null } };
    try {
      ui.render(props);
      await ui.idle();
      let tree = ui.render(props);
      expect(mainReader(tree).state.error).toBeNull();
      expect(mainReader(tree).state.page).toMatchObject({ hasMore: true, nextCursor: 'page2' });
      await mainReader(tree).pager.current!.next();
      tree = ui.render(props);
      expect(mainReader(tree).state.history).toEqual([null]);
      expect(mainReader(tree).state.page?.items[0]).toMatchObject({ thread: { id: 'second' } });
      const callsBeforeMetadata = loadPublic.mock.calls.length;
      const updated = { ...props, progress: { ...props.progress, publicActivity: { protocolVersion: 1, latestSeq: 11 } } };
      tree = ui.render(updated);
      expect(loadPublic).toHaveBeenCalledTimes(callsBeforeMetadata);
      expect(mainReader(tree).state.history).toEqual([null]);
      expect(text(tree)).toContain('New public activity is available');
      snapshotSeq = 11;
      const refresh = elements(tree).find((node) => node.type === 'button' && text(node) === 'Refresh this scope')!;
      (refresh.props.onClick as () => void)();
      await ui.idle();
      tree = ui.render(updated);
      expect(mainReader(tree).state.history).toEqual([]);
      expect(mainReader(tree).state.page?.items[0]).toMatchObject({ thread: { id: 'first' } });
      expect(text(tree)).not.toContain('New public activity is available');
      const previous = mainReader(tree);
      const switched = ui.render({ ...updated, sessionId: 'other-owner', progress: { ...updated.progress, runId: 'other-run' } });
      expect(mainReader(switched).state.page).toBeNull();
      expect(loadPublic.mock.calls.at(-1)?.slice(0, 2)).toEqual(['other-owner', 'other-run']);
      ui.dispose();
      expect(previous.pager.current).toBeNull();
    } finally { ui.dispose(); }
  });
});

describe('public record rendering and compatibility', () => {
  it('renders reply context, mentions, tasks/findings/proposals and revision/source navigation as plain text', () => {
    const { client, t } = load(); const navigate = vi.fn();
    const tree = client.PublicRecord({ t, progress, navigate, item: { kind: 'message', message: message({ body: '<script>untrusted text</script>' }) } });
    const content = text(tree);
    expect(content).toContain('Quiet Otter'); expect(content).toContain('@Bright Finch');
    expect(content).toContain('Reply source'); expect(content).toContain('Revision history');
    expect(content).toContain('Tasks'); expect(content).toContain('Findings'); expect(content).toContain('Proposals');
    expect(content).toContain('<script>untrusted text</script>');
    expect(elements(tree).every((node) => node.props.dangerouslySetInnerHTML === undefined)).toBe(true);
    const history = elements(tree).find((node) => node.type === 'button' && text(node) === 'Revision history')!;
    (history.props.onClick as () => void)(); expect(navigate).toHaveBeenCalledWith({ view: 'message_revisions', messageId: 'm' });
    const reply = elements(tree).find((node) => node.type === 'button' && text(node).includes('Reply source'))!;
    (reply.props.onClick as () => void)(); expect(navigate).toHaveBeenCalledWith({ view: 'messages', messageId: 'parent' });
  });

  it('separates exact-version consent, pending responders, and delivered/acknowledged notification labels', () => {
    const { client, t } = load(); const navigate = vi.fn();
    const agreement = { kind: 'agreement', agreement: { id: 'agreement', version: 2, versionCount: 2, title: 'Interface', content: 'Current contract', sourceMessageIds: ['m'], taskIds: [], stakeholderWorkerIds: ['a', 'b'], confirmations: [{ workerId: 'a', version: 1, confirmedAt: 1 }, { workerId: 'b', version: 2, confirmedAt: 2 }] } };
    const contract = text(client.PublicRecord({ t, progress, navigate, item: agreement }));
    expect(contract).toContain('Version 2'); expect(contract).toContain('Explicitly confirmed this version :  Bright Finch');
    expect(contract).toContain('Not confirmed for this version :  Quiet Otter');
    const request = text(client.PublicRecord({ t, progress, navigate, item: { kind: 'request', request: { id: 'request', status: 'pending', requestedByWorkerId: 'a', targetWorkerId: 'b', messageId: 'm', responseMessageId: null, taskIds: [] } } }));
    expect(request).toContain('Awaiting response'); expect(request).toContain('Response requested from :  Bright Finch');
    const notice = text(client.PublicRecord({ t, progress, navigate, item: { kind: 'notification', notification: { workerId: 'b', reasons: ['response_request'], deliveredAt: 1, acknowledgedAt: null, messageId: 'm', threadId: null, agreementId: null } } }));
    expect(notice).toContain('Explicit response request'); expect(notice).toContain('Notification delivered'); expect(notice).toContain('Notification not acknowledged');
  });

  it('keeps legacy Host capability messaging and complete bilingual public labels without implicit owner submission', () => {
    const { client, t } = load();
    const tree = client.PublicSection({ t, progress, sessionId: 'owner', loadPublic: vi.fn() });
    expect(text(tree)).toContain('This Host does not provide the public channel protocol');
    expect(text(tree)).toContain('does not add owner requirements');
    const en = Object.keys(client.dictionaries.en).filter((key) => key.startsWith('public.'));
    expect(en.length).toBeGreaterThan(40);
    expect(en.every((key) => Boolean(client.dictionaries.zh[key]))).toBe(true);
    expect(elements(tree).some((node) => node.props.type === 'submit')).toBe(false);
  });
});
