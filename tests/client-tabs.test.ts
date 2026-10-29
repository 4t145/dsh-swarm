import { loadClient } from './client-fixture.ts';
import { describe, expect, it, vi } from 'vitest';

// Component/handler tests with a minimal hook owner, not browser visual acceptance.
type Props = Record<string, unknown>;
type Component = (props: Props) => Element;
interface Element { type: string | Component; props: Props; children: unknown[] }
interface Client {
  RunBody: Component;
  GoalSection: Component;
  AddWorkerControl: Component;
  nextTab(current: string, key: string): string | null;
  viewTabs: string[];
  goalColumns(progress: Props): Record<string, Props[]>;
  addWorkerState(progress: Props, connected: boolean): string;
  workerName(t: (key: string, vars: Props) => string, worker: Props, number: number): string;
  workerReceipt(text: string, runId: string): Props;
  dictionaries: Record<'en' | 'zh', Record<string, string>>;
}
function harness() {
  const values: unknown[] = [];
  const cleanups: (() => void)[] = [];
  let cursor = 0;
  const react = {
    createElement: (type: Element['type'], props: Props, ...children: unknown[]): Element => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment',
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (value: unknown) => { values[index] = value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = { current: initial };
      return values[index];
    },
    useEffect(effect: () => (() => void) | undefined) {
      const index = cursor++;
      if (!(index in values)) { values[index] = true; const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    },
  };
  const client = loadClient<{ progressClient: Client }>(react).progressClient;
  const t = (key: string, vars: Props = {}) => (client.dictionaries.en[key] ?? key).replace(/\{(\w+)\}/gu, (_, name: string) => String(vars[name]));
  return { client, t, render(component: Component, props: Props) { cursor = 0; return component({ t, ...props }); }, unmount() { cleanups.forEach((cleanup) => cleanup()); } };
}
function elements(node: unknown): Element[] {
  if (!node || typeof node !== 'object' || !('children' in node)) return [];
  const element = node as Element;
  return [element, ...element.children.flatMap(elements)];
}
function nodes(node: Element, predicate: (node: Element) => boolean): Element[] { return elements(node).filter(predicate); }
function text(node: Element): string { return node.children.map((value) => typeof value === 'string' ? value : value && typeof value === 'object' && 'children' in value ? text(value as Element) : '').join(' '); }
const progress = () => ({ runId: 'run', phase: 'running', goal: 'Initial objective', workers: [{ id: 'w1', displayName: 'Quiet Otter' }], workerControls: { canAdd: true, maxWorkers: 4 }, goalBoard: { items: [], counts: { active: 0, deferred: 0, completed: 0, continued: 0 }, truncated: false } });

describe('independent collaboration tabs', () => {
  it('exposes six linked panels with only the selected panel visible', () => {
    const ui = harness();
    const props = { state: { progress: progress(), status: 'live' }, sessionId: 'owner', now: 1000 };
    let tree = ui.render(ui.client.RunBody, props);
    const tabs = nodes(tree, (node) => node.props.role === 'tab');
    expect(tabs.map(text)).toEqual(['Dashboard', 'Members', 'Collaboration flow', 'Public discussion', 'Goal board', 'Git worktrees']);
    expect(nodes(tree, (node) => node.props.role === 'tabpanel' && !node.props.hidden)).toHaveLength(1);
    const members = tabs[1]!;
    (members.props.onClick as () => void)();
    tree = ui.render(ui.client.RunBody, props);
    const visible = nodes(tree, (node) => node.props.role === 'tabpanel' && !node.props.hidden);
    expect(visible[0]?.props.id).toBe(members.props['aria-controls']);
    expect(visible[0]?.props['aria-labelledby']).toBe(members.props.id);
    expect((visible[0]?.children[0] as Element).type).toHaveProperty('name', 'WorkersSection');
    const goals = nodes(tree, (node) => node.props.role === 'tabpanel' && String(node.props.id).endsWith('-goals'))[0]!;
    expect(goals.props.hidden).toBe(true);
    expect((goals.children[0] as Element).type).toBe(ui.client.GoalSection); // Draft owner stays mounted.
  });

  it('moves keyboard focus and the sole roving tabindex through wrapping arrows and Home/End', () => {
    const ui = harness();
    const props = { state: { progress: progress(), status: 'live' }, sessionId: 'owner', now: 1000 };
    for (const [key, target] of [['ArrowLeft', 'worktrees'], ['ArrowRight', 'dashboard'], ['End', 'worktrees'], ['Home', 'dashboard']]) {
      const tree = ui.render(ui.client.RunBody, props);
      const selected = nodes(tree, (node) => node.props.role === 'tab' && node.props['aria-selected'] === true)[0]!;
      const focus = vi.fn();
      const querySelector = vi.fn(() => ({ focus }));
      const preventDefault = vi.fn();
      (selected.props.onKeyDown as (event: Props) => void)({ key, preventDefault, currentTarget: { parentElement: { querySelector } } });
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(querySelector).toHaveBeenCalledExactlyOnceWith(`[data-swarm-tab="${target}"]`);
      expect(focus).toHaveBeenCalledTimes(1);
      const updated = nodes(ui.render(ui.client.RunBody, props), (node) => node.props.role === 'tab');
      expect(updated.filter((node) => node.props.tabIndex === 0).map((node) => node.props['data-swarm-tab'])).toEqual([target]);
      expect(updated.filter((node) => !node.props['aria-selected']).every((node) => node.props.tabIndex === -1)).toBe(true);
    }
    const preventDefault = vi.fn();
    const selected = nodes(ui.render(ui.client.RunBody, props), (node) => node.props.role === 'tab' && node.props['aria-selected'] === true)[0]!;
    (selected.props.onKeyDown as (event: Props) => void)({ key: 'Tab', preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('three-pool goal board', () => {
  it('places original and appended goals by evidence, not by terminal status alone', () => {
    const { client } = harness();
    const goals = [{ id: 'active', status: 'active' }, { id: 'deferred', status: 'deferred' }, { id: 'done', status: 'completed' }, { id: 'transferred', status: 'active', continuedInRunId: 'next' }];
    const p = { ...progress(), goalBoard: { items: goals } };
    const ids = (columns: Record<string, Props[]>) => Object.fromEntries(Object.entries(columns).map(([key, entries]) => [key, entries.map((entry) => entry.id)]));
    expect(ids(client.goalColumns(p))).toEqual({ todo: ['deferred', 'transferred'], doing: ['original', 'active'], done: ['done'] });
    for (const phase of ['stopped', 'failed']) expect(ids(client.goalColumns({ ...p, phase }))).toEqual({ todo: ['original', 'active', 'deferred', 'transferred'], doing: [], done: ['done'] });
    expect(ids(client.goalColumns({ ...p, phase: 'completed' }))).toEqual({ todo: ['active', 'deferred', 'transferred'], doing: [], done: ['original', 'done'] });
  });

  it('retains drafts and blocks a round switch or publish when the owner view is stale', () => {
    const ui = harness();
    const executeCommand = vi.fn();
    const p = { ...progress(), phase: 'completed', goalBoard: { items: [], counts: { active: 0, deferred: 1, completed: 0, continued: 0 } } };
    const props = { progress: p, sessionId: 'owner', connected: true, executeCommand };
    let tree = ui.render(ui.client.GoalSection, props);
    const draft = nodes(tree, (node) => node.type === 'textarea')[0]!;
    (draft.props.onChange as (event: Props) => void)({ target: { value: 'Keep this wish until confirmed' } });
    tree = ui.render(ui.client.GoalSection, props);
    const nextRound = nodes(tree, (node) => node.type === 'button' && node.props.type === 'button')[0]!;
    expect(nextRound.props.disabled).toBe(true);
    expect(text(nextRound)).toContain('Publish or clear the draft first');
    (nextRound.props.onClick as () => void)(); // Guard the handler too, not only the disabled attribute.
    expect(executeCommand).not.toHaveBeenCalled();
    tree = ui.render(ui.client.GoalSection, { ...props, connected: false });
    expect(nodes(tree, (node) => node.type === 'textarea')[0]?.props.value).toBe('Keep this wish until confirmed');
    expect(nodes(tree, (node) => node.type === 'button' && node.props.type === 'submit')[0]?.props.disabled).toBe(true);
    const preventDefault = vi.fn();
    (nodes(tree, (node) => node.type === 'form')[0]!.props.onSubmit as (event: Props) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(executeCommand).not.toHaveBeenCalled();
    ui.unmount();
  });

  it('puts the wish composer only in To do and keeps explicit empty states', () => {
    const ui = harness();
    const tree = ui.render(ui.client.GoalSection, { progress: progress(), sessionId: 'owner', connected: true, executeCommand: vi.fn() });
    const lanes = nodes(tree, (node) => typeof node.props['data-lane'] === 'string');
    expect(lanes.map((lane) => lane.props['data-lane'])).toEqual(['todo', 'doing', 'done']);
    expect(lanes.map((lane) => nodes(lane, (node) => node.type === 'form').length)).toEqual([1, 0, 0]);
    expect(text(lanes[0]!)).toContain('Add a wish');
    expect(text(lanes[2]!)).toContain('No goals in this pool');
    const submit = nodes(tree, (node) => node.type === 'button' && node.props.type === 'submit')[0]!;
    expect(submit.props.disabled).toBe(true);
  });
});

describe('owner add-worker UI', () => {
  it('uses stored names consistently with a legacy fallback', () => {
    const { client, t } = harness();
    expect(client.workerName(t, { displayName: 'Quiet Otter' }, 1)).toBe('Quiet Otter');
    for (const displayName of [undefined, '', '  ']) expect(client.workerName(t, { displayName }, 2)).toBe('Worker 2');
  });

  it('disables stale/legacy/full/closing runs and allows paused additions', () => {
    const { client } = harness();
    expect(client.addWorkerState(progress(), true)).toBe('ready');
    expect(client.addWorkerState({ ...progress(), phase: 'paused' }, true)).toBe('ready');
    expect(client.addWorkerState(progress(), false)).toBe('disconnected');
    expect(client.addWorkerState({ ...progress(), workerControls: undefined }, true)).toBe('unavailable');
    expect(client.addWorkerState({ ...progress(), workers: Array(4).fill({}) }, true)).toBe('limit');
    for (const phase of ['preparing', 'draining', 'quiescing', 'completed', 'stopped', 'failed']) expect(client.addWorkerState({ ...progress(), phase }, true)).toBe('phase');
  });

  it('validates receipt identity and explicit disposition rather than guessing success', () => {
    const { client } = harness();
    const receipt = { runId: 'run', workerId: 'w2', displayName: 'Bright Finch', disposition: 'paused' };
    expect(client.workerReceipt(JSON.stringify(receipt), 'run')).toEqual(receipt);
    for (const patch of [{ runId: 'other' }, { workerId: '' }, { displayName: '' }, { disposition: 'success' }]) expect(() => client.workerReceipt(JSON.stringify({ ...receipt, ...patch }), 'run')).toThrow('receipt');
  });

  it('submits one owner command, guards duplicate clicks and cancels on unmount', async () => {
    const ui = harness();
    let complete!: (reply: unknown) => void;
    const response = new Promise((resolve) => { complete = resolve; });
    const executeCommand = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => response);
    const props = { progress: progress(), sessionId: 'owner-session', connected: true, executeCommand };
    let tree = ui.render(ui.client.AddWorkerControl, props);
    const click = nodes(tree, (node) => node.type === 'button')[0]!.props.onClick as () => void;
    click(); click();
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(executeCommand.mock.calls[0]).toEqual(['owner-session', '/swarm worker add --json', [], expect.any(AbortSignal)]);
    tree = ui.render(ui.client.AddWorkerControl, props);
    expect(nodes(tree, (node) => node.type === 'button')[0]?.props.disabled).toBe(true);
    const signal = executeCommand.mock.calls[0]![3] as AbortSignal;
    ui.unmount();
    expect(signal.aborted).toBe(true);
    complete({ ok: true, value: { result: { kind: 'success', text: JSON.stringify({ runId: 'run', workerId: 'w2', displayName: 'Bright Finch', disposition: 'started' }) } } });
    await response;
    await Promise.resolve();
    await Promise.resolve();
  });
});
