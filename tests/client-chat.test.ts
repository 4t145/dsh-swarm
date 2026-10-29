import { loadClient } from './client-fixture.ts';
import { describe, expect, it } from 'vitest';

// Public channel IM view and DM matrix facts; not browser visual acceptance.
interface Interaction { seq: number; kind: string; status: string; actorWorkerId: string | null; peerWorkerId: string | null; objectId: string; taskId: string | null; createdAt: number }
type Props = Record<string, unknown>;
type Node = { type: unknown; props: Props; children: unknown[] };
interface Client {
  channelItems(progress: Props): (Interaction & { side: string })[];
  dmMatrix(progress: Props): { members: string[]; cells: number[][]; max: number };
  dmThread(items: Props[], a: string, b: string): Props[];
  ChannelSection(props: Props): Node;
  DmSection(props: Props): Node;
  dictionaries: Record<'en' | 'zh', Record<string, string>>;
}

const event = (seq: number, kind: string, actorWorkerId: string | null, peerWorkerId: string | null, status = 'sent'): Interaction =>
  ({ seq, kind, status, actorWorkerId, peerWorkerId, objectId: 'object' + seq, taskId: null, createdAt: 1_000 + seq });
const progress = {
  runId: 'run', phase: 'running',
  workers: [{ id: 'w1', displayName: 'Quiet Otter', initializationState: 'ready' }, { id: 'w2', displayName: 'Bright Finch', initializationState: 'ready' }],
  interactions: [
    event(1, 'message', 'w1', 'w2'),
    event(2, 'finding', 'w1', null, 'fact'),
    event(3, 'message', 'w1', 'w2'),
    event(4, 'message', 'w2', 'w1'),
    event(5, 'proposal', 'w2', 'w2', 'queued'),
    event(6, 'head', null, 'w2', 'accepted'),
  ],
  recentEvents: [{ seq: 7, kind: 'run', status: 'completed', objectId: 'run', authorWorkerId: null, createdAt: 1_007 }, { seq: 5, kind: 'proposal', status: 'queued', objectId: 'object5', authorWorkerId: 'w2', createdAt: 1_005 }],
};
const dm = (seq: number, from: string, to: string, body: string) => ({ kind: 'message', id: 'm' + seq, seq, authorWorkerId: from, targetWorkerId: to, body, truncated: false, createdAt: 1_000 + seq });

function harness() {
  const values: unknown[] = [];
  let cursor = 0;
  const react = {
    createElement: (type: unknown, props: Props | null, ...children: unknown[]): Node => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment',
    useState(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], (value: unknown) => { values[index] = value; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect: () => undefined,
  };
  const client = loadClient<{ progressClient: Client }>(react).progressClient;
  const t = (key: string, vars: Props = {}) => (client.dictionaries.en[key] ?? key).replace(/\{(\w+)\}/gu, (_, name: string) => String(vars[name]));
  return { client, render: (component: (props: Props) => Node, props: Props) => { cursor = 0; return component({ t, ...props }); } };
}
const all = (node: unknown): Node[] => node && typeof node === 'object' && 'children' in node ? [node as Node, ...(node as Node).children.flatMap(all)] : [];
const text = (node: Node): string => node.children.map((child) => typeof child === 'string' ? child : child && typeof child === 'object' && 'children' in child ? text(child as Node) : '').join(' ');
const conversation = (items: Props[]) => ({ available: true, bodies: new Map(items.map((item) => [item.seq, item])), state: { items, next: null, loading: false, error: null, started: true }, load: () => undefined });

describe('public channel IM view', () => {
  it('merges collaboration and run events oldest first without direct messages', () => {
    const { client } = harness();
    const items = client.channelItems(progress);
    expect(items.map((item) => item.seq)).toEqual([2, 5, 6, 7]);
    expect(items.some((item) => item.kind === 'message')).toBe(false);
    expect(items.map((item) => item.side)).toEqual(['left', 'left', 'right', 'right']);
  });

  it('falls back to public recent events on Hosts without interactions', () => {
    const { client } = harness();
    const items = client.channelItems({ ...progress, interactions: undefined });
    expect(items.map((item) => [item.seq, item.kind, item.side])).toEqual([[5, 'proposal', 'left'], [7, 'run', 'right']]);
  });

  it('renders Host lines on the right and workers on the left with sender name and time', () => {
    const ui = harness();
    const tree = ui.render(ui.client.ChannelSection, { progress, conversation: conversation([]) });
    const rows = all(tree).filter((node) => node.props.className === 'dshSwarm_chatRow');
    expect(rows.map((row) => row.props['data-side'])).toEqual(['left', 'left', 'right', 'right']);
    expect(text(rows[0]!)).toContain('Quiet Otter');
    expect(text(rows[2]!)).toContain('Host');
    expect(rows.every((row) => all(row).some((node) => node.type === 'time'))).toBe(true);
    expect(text(tree)).not.toContain('messaged');
  });
});

describe('direct message matrix', () => {
  it('counts sender × recipient cells in roster order', () => {
    const { client } = harness();
    expect(client.dmMatrix(progress)).toEqual({ members: ['w1', 'w2'], cells: [[0, 2], [1, 0]], max: 2 });
    expect(client.dmMatrix({ ...progress, interactions: [event(1, 'message', 'w1', 'w9')] }).members).toEqual(['w1', 'w2', 'w9']);
  });

  it('selects a pair thread in both directions, oldest first', () => {
    const { client } = harness();
    const items = [dm(4, 'w2', 'w1', 'c'), dm(3, 'w1', 'w2', 'b'), dm(1, 'w1', 'w2', 'a'), dm(2, 'w1', 'w9', 'x')];
    expect(client.dmThread(items, 'w1', 'w2').map((item) => item.body)).toEqual(['a', 'b', 'c']);
  });

  it('shows the selected cell as an IM thread', () => {
    const ui = harness();
    const items = [dm(4, 'w2', 'w1', 'Rebased, thanks'), dm(3, 'w1', 'w2', 'Please rebase'), dm(1, 'w1', 'w2', 'Hi')];
    const props = { progress, conversation: conversation(items) };
    let tree = ui.render(ui.client.DmSection, props);
    const cells = all(tree).filter((node) => node.props.className === 'dshSwarm_dmCell');
    expect(cells.map((cell) => cell.children.join(''))).toEqual(['—', '2', '1', '—']);
    expect(cells[0]!.props.disabled).toBe(true);
    (cells[1]!.props.onClick as () => void)();
    tree = ui.render(ui.client.DmSection, props);
    const rows = all(tree).filter((node) => node.props.className === 'dshSwarm_chatRow');
    expect(rows.map((row) => text(row).includes('Rebased') ? 'reply' : 'sent')).toEqual(['sent', 'sent', 'reply']);
    expect(rows.map((row) => row.props['data-side'])).toEqual(['left', 'left', 'right']);
    expect(text(rows[2]!)).toContain('Bright Finch');
  });
});

describe('channel locale', () => {
  it('keeps chat.* and dm.* keys in sync', () => {
    const { client } = harness();
    for (const prefix of ['chat.', 'dm.']) {
      const keys = (lang: 'en' | 'zh') => Object.keys(client.dictionaries[lang]).filter((key) => key.startsWith(prefix)).sort();
      expect(keys('zh')).toEqual(keys('en'));
      expect(keys('en').length).toBeGreaterThan(5);
    }
  });
});
