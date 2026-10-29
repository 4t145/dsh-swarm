import { loadClient } from './client-fixture.ts';
import { describe, expect, it } from 'vitest';

// Layout and privacy facts for the collaboration flow; not browser visual acceptance.
interface Interaction { seq: number; kind: string; status: string; actorWorkerId: string | null; peerWorkerId: string | null; objectId: string; taskId: string | null; createdAt: number }
interface Progress { runId: string; workers: { id: string; displayName?: string }[]; interactions?: Interaction[] }
interface Mark { item: Interaction; y: number; targetY: number | null; lane: { key: string | null } }
interface Client {
  flowLayout(progress: Progress, kind: string): { lanes: { key: string | null; host?: boolean; unknown?: boolean; color: string }[]; marks: Mark[] };
  messagePairs(progress: Progress): { from: string; to: string; count: number }[];
  flowHoverPosition(mark: { x: number; y: number }, view: { headWidth: number; scrollLeft: number; scrollTop: number; top: number; width: number; height: number }): { left: number; top: number; above: boolean };
  FlowSection(props: Record<string, unknown>): unknown;
  trackLanes(worktrees: { workerId: string | null; branch: string; displayName: string | null; worktreePath: string | null }[], items: unknown[]): { color: string }[];
  trackLayout(items: unknown[], worktrees: unknown[], tips: unknown[], more: boolean): { height: number };
  readFrame(item: unknown): unknown;
  dictionaries: Record<'en' | 'zh', Record<string, string>>;
}
const client = loadClient<{ progressClient: Client }>().progressClient;

/** Render FlowSection with a forced hover state through a minimal hook stub. */
function renderFlow(hover: unknown, bodies: Map<number, unknown>) {
  let state = 0;
  type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] };
  const react = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Node => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment',
    useState: (initial: unknown) => [state++ === 1 ? hover : initial, () => undefined],
    useRef: () => ({ current: null }),
    useEffect: () => undefined,
  };
  const ui = loadClient<{ progressClient: Client }>(react).progressClient;
  const t = (key: string, vars: Record<string, unknown> = {}) => key + (Object.keys(vars).length ? JSON.stringify(vars) : '');
  const conversation = { bodies, available: true, state: { error: null }, loadAround: () => undefined };
  const tree = ui.FlowSection({ t, progress, conversation }) as Node;
  const all: Node[] = [];
  const walk = (node: unknown): void => { if (node && typeof node === 'object' && 'props' in node) { all.push(node as Node); (node as Node).children.forEach(walk); } };
  walk(tree);
  const text = (node: Node): string => node.children.map((child) => typeof child === 'string' ? child : child && typeof child === 'object' && 'children' in child ? text(child as Node) : '').join('');
  return { all, text };
}

const event = (seq: number, kind: string, actorWorkerId: string | null, peerWorkerId: string | null, status = 'sent'): Interaction =>
  ({ seq, kind, status, actorWorkerId, peerWorkerId, objectId: 'o' + seq, taskId: null, createdAt: 1_000 + seq });
const progress: Progress = {
  runId: 'run',
  workers: [{ id: 'w1' }, { id: 'w2' }],
  interactions: [
    event(1, 'message', 'w1', 'w2'),
    event(2, 'message', 'w1', 'w2'),
    event(3, 'message', 'w2', 'w1'),
    event(4, 'task', 'w2', 'w1', 'claimed'),
    event(5, 'proposal', 'w2', 'w2', 'queued'),
    event(6, 'head', null, 'w2', 'accepted'),
    event(8, 'proposal', null, 'w2', 'accepted'),
    event(7, 'finding', 'w9', null, 'fact'),
  ],
};

describe('collaboration flow layout', () => {
  it('puts the Host lane first, roster order next and unknown actors last', () => {
    const { lanes } = client.flowLayout(progress, 'all');
    expect(lanes.map((lane) => lane.key)).toEqual([null, 'w1', 'w2', 'w9']);
    expect(lanes[0]?.host).toBe(true);
    expect(lanes[3]?.unknown).toBe(true);
  });

  it('routes messages to the recipient, tasks to the owner and accepted heads from the author', () => {
    const { marks } = client.flowLayout(progress, 'all');
    const [message, , , task, , head] = marks;
    expect(message?.lane.key).toBe('w1');
    expect(message?.targetY).toBeGreaterThan(message!.y);
    expect(task?.lane.key).toBe('w1'); // claimed by w2 for owner w1 → owner lane
    expect(head?.lane.key).toBeNull();
    expect(head?.targetY).toBeGreaterThan(head!.y);
    // Host-performed integration transitions stay on the proposer's lane.
    expect(marks.find((mark) => mark.item.seq === 8)?.lane.key).toBe('w2');
  });

  it('filters by kind and keeps result advances with proposals', () => {
    expect(client.flowLayout(progress, 'message').marks).toHaveLength(3);
    expect(client.flowLayout(progress, 'proposal').marks.map((mark) => mark.item.kind)).toEqual(['proposal', 'head', 'proposal']);
  });

  it('counts directed message pairs, busiest first', () => {
    expect(client.messagePairs(progress)).toEqual([
      expect.objectContaining({ from: 'w1', to: 'w2', count: 2 }),
      expect.objectContaining({ from: 'w2', to: 'w1', count: 1 }),
    ]);
  });

  it('shares the Git track lane geometry and palette', () => {
    const { lanes, marks } = client.flowLayout(progress, 'all');
    const git = client.trackLanes([{ workerId: null, branch: 'result', displayName: null, worktreePath: null }, { workerId: 'w1', branch: 'b1', displayName: null, worktreePath: null }, { workerId: 'w2', branch: 'b2', displayName: null, worktreePath: null }], []);
    expect(lanes.slice(0, 3).map((lane) => lane.color)).toEqual(git.map((lane) => lane.color));
    const layout = client.trackLayout([], [], [], false);
    const rowY = (index: number) => 22 + index * 84 + 42; // TRACK.pad + index * TRACK.lane + TRACK.lane / 2
    expect(layout.height).toBe(22 * 2 + 84);
    expect(marks.find((mark) => mark.lane.key === 'w1')?.y).toBe(rowY(1));
  });

  it('draws the chart with Git track rails, station rings, legend and axis', () => {
    const { all } = renderFlow(null, new Map());
    const svg = (type: string, match: (props: Record<string, unknown>) => boolean) => all.filter((node) => node.type === type && match(node.props));
    // Wide faint rail per lane (Git rails) and solid 4px track segments between stations.
    expect(svg('line', (props) => props.className === 'dshSwarm_trackRail' && props.strokeWidth === 8)).toHaveLength(4);
    expect(svg('path', (props) => props.strokeWidth === 4).length).toBeGreaterThan(0);
    // Message stations are Git commit rings: r=6, 3px stroke on the layer background.
    expect(svg('circle', (props) => props.r === 6 && props.strokeWidth === 3 && (props.style as { fill: string }).fill === 'var(--dsw-alias-bg-layer-1)').length).toBeGreaterThanOrEqual(3);
    const legend = all.find((node) => node.props.className === 'dshSwarm_trackLegend');
    expect(legend?.children.filter((child) => (child as { type?: unknown }).type === 'span')).toHaveLength(6);
    expect(all.some((node) => node.props.className === 'dshSwarm_flowKey')).toBe(false);
    expect(all.some((node) => node.props.className === 'dshSwarm_trackAxis' && node.children.includes('flow.axis'))).toBe(true);
    const heads = all.filter((node) => node.props.className === 'dshSwarm_laneHead');
    expect(heads.map((node) => (node.props.style as { height: string }).height)).toEqual(Array(4).fill('84px'));
  });

  it('reads oldest-left on both charts with the same axis wording', () => {
    expect(client.dictionaries.en['flow.axis']).toMatch(/^← Older/);
    expect(client.dictionaries.zh['flow.axis']).toMatch(/^← 更早/);
  });

  it('has matching bilingual flow labels', () => {
    const keys = (lang: 'en' | 'zh') => Object.keys(client.dictionaries[lang]).filter((key) => key.startsWith('flow.')).sort();
    expect(keys('zh')).toEqual(keys('en'));
    expect(keys('en').length).toBeGreaterThan(20);
  });

  it('keeps the hover card inside the stage: right of the mark, flipping left and above near edges', () => {
    const view = { headWidth: 150, scrollLeft: 0, scrollTop: 0, top: 0, width: 1000, height: 400 };
    expect(client.flowHoverPosition({ x: 100, y: 60 }, view)).toEqual({ left: 268, top: 60, above: false });
    const right = client.flowHoverPosition({ x: 800, y: 300 }, view);
    expect(right.left + 340).toBeLessThanOrEqual(view.headWidth + 800);
    expect(right.above).toBe(true);
    expect(client.flowHoverPosition({ x: 300, y: 60 }, { ...view, scrollLeft: 200 }).left).toBe(268);
  });

  it('makes every mark focusable and shows the message body in the hover card', () => {
    const body = { kind: 'message', seq: 1, body: 'Can you rebase on my cursor change?', truncated: false };
    const { all, text } = renderFlow({ seq: 1, pinned: false, left: 10, top: 10, above: false }, new Map([[1, body]]));
    const marks = all.filter((node) => node.props.className === 'dshSwarm_flowMark');
    expect(marks).toHaveLength(progress.interactions!.length);
    expect(marks.every((node) => node.props.tabIndex === 0 && typeof node.props.onMouseEnter === 'function' && typeof node.props.onClick === 'function')).toBe(true);
    const card = all.find((node) => node.props.className === 'dshSwarm_hoverCard');
    expect(card?.props.role).toBe('tooltip');
    expect(text(card!)).toContain('Can you rebase on my cursor change?');
  });

  it('shows a loading state when a body has not arrived and a dialog with close when pinned', () => {
    const { all } = renderFlow({ seq: 2, pinned: true, left: 10, top: 10, above: false }, new Map());
    const card = all.find((node) => node.props.className === 'dshSwarm_hoverCard');
    expect(card?.props.role).toBe('dialog');
    expect(all.some((node) => node.props.className === 'dshSwarm_hoverClose')).toBe(true);
    expect(all.some((node) => node.props.className === 'dshSwarm_subtle' && node.children.includes('conv.loading'))).toBe(true);
  });
});

