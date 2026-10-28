/**
 * 进度 Host DTO 与 watch 订阅的针对性测试。
 *
 * 只用 fake runtime / 手动变更源，不启动模型、Git 或 HTTP；重点覆盖公开字段
 * 映射、隐私与体积上界、会话归属、终态结束与取消。
 */

import { describe, expect, it } from 'vitest';

import { isRemoteFailure } from '@deepseek-ai/dsh-api-gateway/client';
import { SwarmError } from '../src/errors.ts';
import {
  PROGRESS_LIMITS,
  ProgressFeed,
  progressRemoteMethods,
  toProgressSnapshot,
  type ProgressChange,
  type ProgressRunDetail,
  type ProgressWatchItem,
} from '../src/progress.ts';
import type { RunStatus, WorkerStatusSummary } from '../src/runtime.ts';

const OWNER = 'owner-session';
const RUN = 'run-1';

function worker(overrides: Partial<WorkerStatusSummary> = {}): WorkerStatusSummary {
  return {
    id: 'w2',
    sessionId: 'worker-session-2',
    initializationState: 'ready',
    nativeStatus: 'running',
    nativeStatusError: null,
    currentTaskId: null,
    worktreePath: '/tmp/worktree',
    unavailableReason: null,
    initializationError: null,
    ...overrides,
  };
}

function status(overrides: Partial<RunStatus> = {}): RunStatus {
  return {
    runId: RUN,
    ownerSessionId: OWNER,
    phase: 'running',
    reason: null,
    quiesceTarget: null,
    deadline: 10_000,
    now: 4_000,
    budgetExpired: false,
    baseCommit: 'a'.repeat(40),
    acceptedHead: 'b'.repeat(40),
    resultRef: 'refs/dsh-swarm/result',
    integrationWorktree: '/tmp/integration',
    tasks: { open: 1, claimed: 2, proposed: 3, done: 4, blocked: 5, cancelled: 6, total: 21 },
    workers: [
      worker({ id: 'w1', nativeStatus: 'running', currentTaskId: 'task-1' }),
      worker({ id: 'w2', nativeStatus: 'inactive' }),
      worker({
        id: 'w3',
        initializationState: 'failed',
        nativeStatus: 'unavailable',
        nativeStatusError: 'provider missing',
      }),
    ],
    proposals: { queued: 1, integrating: 2, accepted: 3, rejected: 4 },
    verifications: { queued: 1, running: 2, passed: 3, failed: 4, interrupted: 5 },
    finishRequest: { id: 'finish-1', acceptedHead: 'c'.repeat(40), verificationId: 'verify-1' },
    admission: 'open',
    diagnostics: ['internal detail that must not reach the panel'],
    ...overrides,
  };
}

function detail(): ProgressRunDetail {
  return {
    tasks: {
      'task-1': { id: 'task-1', subject: 'Implement progress DTO', status: 'claimed', revision: 3 },
    },
    workers: {
      w1: { currentTaskId: 'task-1' },
      w2: { currentTaskId: null },
    },
  };
}

describe('toProgressSnapshot', () => {
  it('maps the bounded public facts without inventing percentages', () => {
    const snapshot = toProgressSnapshot(status(), detail(), 4_500);

    expect(snapshot.runId).toBe(RUN);
    expect(snapshot.phase).toBe('running');
    expect(snapshot.remainingMs).toBe(5_500);
    expect(snapshot.tasks).toEqual({
      open: 1, claimed: 2, proposed: 3, done: 4, blocked: 5, cancelled: 6, total: 21,
    });
    expect(snapshot.proposals).toEqual({ queued: 1, integrating: 2, accepted: 3, rejected: 4 });
    expect(snapshot.verifications).toEqual({
      queued: 1, running: 2, passed: 3, failed: 4, interrupted: 5,
    });
    expect(snapshot.finishRequest?.verificationId).toBe('verify-1');

    const [first, second, third] = snapshot.workers;
    expect(first?.nativeStatus).toBe('running');
    expect(first?.currentTask).toEqual({
      id: 'task-1', subject: 'Implement progress DTO', status: 'claimed', revision: 3,
    });
    expect(second?.nativeStatus).toBe('inactive');
    expect(second?.currentTask).toBeNull();
    expect(third?.nativeStatus).toBe('unavailable');
    expect(third?.diagnostic).toBe('provider missing');
    expect(JSON.stringify(snapshot)).not.toContain('percent');
  });

  it('keeps inactive distinct from done and clamps expired budgets at zero', () => {
    const snapshot = toProgressSnapshot(
      status({ deadline: 1_000, now: 9_999, tasks: { ...status().tasks, done: 0 } }),
      detail(),
      9_999,
    );
    expect(snapshot.remainingMs).toBe(0);
    expect(snapshot.tasks.done).toBe(0);
    expect(snapshot.workers[1]?.nativeStatus).toBe('inactive');
  });

  it('truncates long text and never forwards diagnostics or message bodies', () => {
    const secret = `SECRET-${'x'.repeat(500)}`;
    const snapshot = toProgressSnapshot(
      status({
        reason: secret,
        diagnostics: [secret],
        workers: [worker({ nativeStatusError: secret, currentTaskId: 'task-1' })],
      }),
      {
        tasks: { 'task-1': { id: 'task-1', subject: secret, status: 'claimed', revision: 1 } },
        workers: { w2: { currentTaskId: 'task-1' } },
      },
      1,
    );

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(secret);
    expect(snapshot.reason?.length).toBeLessThanOrEqual(PROGRESS_LIMITS.reasonChars);
    expect(snapshot.workers[0]?.diagnostic?.length).toBeLessThanOrEqual(PROGRESS_LIMITS.diagnosticChars);
    expect(snapshot.workers[0]?.currentTask?.subject.length)
      .toBeLessThanOrEqual(PROGRESS_LIMITS.subjectChars);
    expect(serialized.length).toBeLessThan(8_000);
    expect(snapshot).not.toHaveProperty('diagnostics');
    expect(snapshot).not.toHaveProperty('messages');
  });

  it('caps the worker list even if a broken runtime returns more', () => {
    const workers = Array.from({ length: PROGRESS_LIMITS.workers + 4 }, (_, index) =>
      worker({ id: `w${index}` }));
    const snapshot = toProgressSnapshot(status({ workers }), undefined, 1);
    expect(snapshot.workers).toHaveLength(PROGRESS_LIMITS.workers);
  });
});

describe('ProgressFeed.snapshot', () => {
  it('returns null when the runtime has no run for the session', () => {
    const feed = new ProgressFeed(
      {
        status: () => {
          throw new SwarmError('SWARM_NOT_FOUND', 'no run', { details: { ownerSessionId: OWNER } });
        },
      },
      { subscribe: () => () => undefined },
    );
    expect(feed.snapshot(OWNER)).toBeNull();
  });

  it('rejects another session reading a run it does not own', () => {
    const feed = new ProgressFeed(
      { status: () => status({ ownerSessionId: 'someone-else' }) },
      { subscribe: () => () => undefined },
    );
    try {
      feed.snapshot(OWNER);
      throw new Error('expected forbidden');
    } catch (error) {
      expect(isRemoteFailure(error)).toBe(true);
      if (isRemoteFailure(error)) {
        expect(error.code).toBe('swarm-progress/forbidden');
        expect(error.details).toEqual({ sessionId: OWNER, runId: RUN });
      }
    }
  });

  it('rejects invalid session ids before touching the runtime', () => {
    let called = false;
    const feed = new ProgressFeed(
      {
        status: () => {
          called = true;
          return status();
        },
      },
      { subscribe: () => () => undefined },
    );
    expect(() => feed.snapshot('   ')).toThrowError(/sessionId/);
    expect(called).toBe(false);
  });

  it('keeps working when the optional task detail lookup fails', () => {
    const feed = new ProgressFeed(
      { status: () => status() },
      {
        subscribe: () => () => undefined,
        detail: () => {
          throw new Error('store hiccup');
        },
      },
    );
    const snapshot = feed.snapshot(OWNER);
    expect(snapshot?.workers[0]?.currentTask).toBeNull();
    expect(snapshot?.detailError).toContain('store hiccup');
  });
});

/** 手动变更源：测试显式决定何时发布，不依赖 sleep。 */
function manualChanges(): {
  feed: ProgressFeed;
  emit: (change: ProgressChange) => void;
  emitAgent: (agentSessionId: string) => void;
  unsubscribeCount: () => number;
  runtime: { status: (sessionId: string) => RunStatus; setPhase: (next: RunStatus) => void };
} {
  let current = status();
  const listeners = new Set<(change: ProgressChange) => void>();
  const agentListeners = new Set<(agentSessionId: string) => void>();
  let unsubscribed = 0;
  const runtime = {
    status: (_sessionId: string): RunStatus => current,
    setPhase: (next: RunStatus): void => {
      current = next;
    },
  };
  const feed = new ProgressFeed(runtime, {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribed += 1;
      };
    },
    detail,
    now: () => 4_500,
    agentEvents: (listener) => {
      agentListeners.add(listener);
      return () => {
        agentListeners.delete(listener);
      };
    },
  });
  return {
    feed,
    runtime,
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
    emitAgent: (agentSessionId) => {
      for (const listener of [...agentListeners]) listener(agentSessionId);
    },
    unsubscribeCount: () => unsubscribed,
  };
}

describe('ProgressFeed.watch', () => {
  it('emits one opening frame, then the terminal frame and ends', async () => {
    const { feed, runtime, emit } = manualChanges();
    const iterator = feed.watch(OWNER)[Symbol.asyncIterator]();

    const opening = await iterator.next();
    expect(opening.done).toBe(false);
    expect(opening.value?.seq).toBe(1);
    expect(opening.value?.progress?.phase).toBe('running');

    const completed = status({ phase: 'completed', now: 9_000 });
    runtime.setPhase(completed);
    emit({ runId: RUN, ownerSessionId: OWNER, phase: 'completed' });

    const terminal = await iterator.next();
    expect(terminal.done).toBe(false);
    expect(terminal.value?.seq).toBe(2);
    expect(terminal.value?.progress?.phase).toBe('completed');

    const end = await iterator.next();
    expect(end.done).toBe(true);
    await feed.dispose();
  });

  it('ignores changes owned by other sessions', async () => {
    const { feed, emit, runtime } = manualChanges();
    const iterator = feed.watch(OWNER)[Symbol.asyncIterator]();
    await iterator.next();

    emit({ runId: 'run-other', ownerSessionId: 'other-owner', phase: 'running' });
    let settled = false;
    const pending = iterator.next().then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    runtime.setPhase(status({ tasks: { ...status().tasks, done: 9 } }));
    emit({ runId: RUN, ownerSessionId: OWNER, phase: 'running' });
    const next = await pending;
    expect(next.value?.seq).toBe(2);
    expect(next.value?.progress?.tasks.done).toBe(9);
    await feed.dispose();
  });

  it('stops an in-flight watch when the caller aborts', async () => {
    const { feed } = manualChanges();
    const controller = new AbortController();
    const iterator = feed.watch(OWNER, controller.signal)[Symbol.asyncIterator]();
    await iterator.next();

    controller.abort();
    const end = await iterator.next();
    expect(end.done).toBe(true);
  });

  it('closes subscriptions when a terminal frame ends the stream', async () => {
    const { feed, runtime, emit, unsubscribeCount } = manualChanges();
    runtime.setPhase(status({ phase: 'failed' }));
    emit({ runId: RUN, ownerSessionId: OWNER, phase: 'failed' });

    const frames: ProgressWatchItem[] = [];
    for await (const frame of feed.watch(OWNER)) frames.push(frame);
    expect(frames.at(-1)?.progress?.phase).toBe('failed');
    expect(unsubscribeCount()).toBe(1);
  });

  it('dispose ends every active watch', async () => {
    const { feed } = manualChanges();
    const iterator = feed.watch(OWNER)[Symbol.asyncIterator]();
    await iterator.next();
    await feed.dispose();
    expect((await iterator.next()).done).toBe(true);
    expect(() => feed.snapshot(OWNER)).toThrowError(/disposed/);
  });
});

describe('ProgressFeed native agent refresh', () => {
  it('notifies a new frame for a run worker without closing the stream', async () => {
    const { feed, runtime, emit, emitAgent } = manualChanges();
    const iterator = feed.watch(OWNER)[Symbol.asyncIterator]();
    await iterator.next();

    runtime.setPhase(status({ workers: [
      worker({ id: 'w1', nativeStatus: 'inactive' }),
      worker({ id: 'w2', nativeStatus: 'inactive' }),
      worker({ id: 'w3', initializationState: 'failed', nativeStatus: 'unavailable' }),
    ] }));
    emitAgent('worker-session-2');

    const refreshed = await iterator.next();
    expect(refreshed.done).toBe(false);
    expect(refreshed.value?.seq).toBe(2);
    expect(refreshed.value?.progress?.workers[0]?.nativeStatus).toBe('inactive');

    // 后续业务变更仍能产生新帧，证明 agent 通知没有关闭 watcher。
    runtime.setPhase(status({ phase: 'completed' }));
    emit({ runId: RUN, ownerSessionId: OWNER, phase: 'completed' });
    const terminal = await iterator.next();
    expect(terminal.value?.progress?.phase).toBe('completed');
    expect((await iterator.next()).done).toBe(true);
    await feed.dispose();
  });

  it('ignores agent events from sessions that are not run workers', async () => {
    const { feed, emitAgent } = manualChanges();
    const iterator = feed.watch(OWNER)[Symbol.asyncIterator]();
    await iterator.next();

    emitAgent('unrelated-agent-session');
    let settled = false;
    const pending = iterator.next().then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await feed.dispose();
    await pending;
  });
});

describe('Remote markers', () => {
  it('exports snapshot as unary and watch as a stream on the swarmProgress namespace', () => {
    expect(progressRemoteMethods()).toEqual([
      { method: 'snapshot' },
      { method: 'watch', mode: 'stream' },
    ]);
  });
});
/* ------------------------------------------------------------------ */
/* 浏览器插件：conversation.view order=5 + ctx.remote.$mount            */
/* ------------------------------------------------------------------ */

interface LoadedPlugin {
  exports: {
    apply: (ctx: unknown) => Promise<void>;
    inject: readonly string[];
  };
  contribution: {
    package: string;
    descriptors: readonly {
      id: string;
      namespace: string;
      method: string;
      mode?: string;
      cancellation?: { parameter: string };
      parameters: readonly { codec: { mode: string } }[];
      result: { mode: string };
    }[];
  };
  locale: { zh: Record<string, string>; en: Record<string, string> };
  registration: {
    options: {
      name: string;
      id: string;
      order: number;
      locale: string;
      label: () => string;
      inject: (sessionId: string) => Record<string, unknown>;
    };
    component: (props: Record<string, unknown>) => unknown;
  };
  render: (sessionId?: string) => { text: string; element: unknown };
}
/** 最小假 React：只为提取注册与渲染文本服务，不模拟真实调度。 */
function fakeReact(): {
  createElement: (tag: unknown, props: unknown, ...children: unknown[]) => unknown;
  useState: (initial: unknown) => [unknown, (next: unknown) => void];
  useEffect: (effect: () => unknown, deps?: readonly unknown[]) => void;
  reset: () => void;
} {
  let slots: Array<{ value?: unknown; deps?: readonly unknown[] }> = [];
  let cursor = 0;
  const sameDeps = (left?: readonly unknown[], right?: readonly unknown[]): boolean =>
    left !== undefined && right !== undefined && left.length === right.length
      && left.every((value, index) => value === right[index]);
  return {
    createElement: (tag, props, ...children) => ({
      tag,
      props: (props ?? {}) as Record<string, unknown>,
      children: children.flat(Infinity),
    }),
    useState: (initial) => {
      const index = cursor++;
      if (slots[index] === undefined) slots[index] = { value: initial };
      const slot = slots[index];
      return [slot.value, (next: unknown) => {
        slot.value = typeof next === 'function' ? (next as (value: unknown) => unknown)(slot.value) : next;
      }];
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) {
        slots[index] = { deps };
        effect();
      }
    },
    reset: () => {
      cursor = 0;
    },
  };
}

function flattenText(node: unknown): string {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(' ');
  if (typeof node === 'object' && node !== null && 'tag' in node && node.tag === 'style') return '';
  if (typeof node === 'object' && node !== null && 'children' in node) {
    const children = (node as { children: unknown[] }).children;
    return children.map(flattenText).join(' ');
  }
  return '';
}

interface ClientModule {
  id: string;
  factory: (require: (name: string) => unknown) => LoadedPlugin['exports'];
}

let clientModule: Promise<ClientModule> | null = null;

/** 只加载一次浏览器 bundle；每次测试用新的 factory 实例隔离状态。 */
async function clientModuleOnce(): Promise<ClientModule> {
  if (clientModule !== null) return clientModule;
  clientModule = (async () => {
    const captures: ClientModule[] = [];
    Reflect.set(globalThis, 'window', {
      __ModuleLoader__: { load: (module: ClientModule) => captures.push(module) },
    });
    // @ts-expect-error client.js is an untyped browser bundle that registers through window.
    await import('../client.js');
    const loaded = captures[0];
    if (loaded === undefined) throw new Error('client.js did not register with the module loader');
    return loaded;
  })();
  return clientModule;
}

interface LoadPluginOptions {
  readonly items?: readonly unknown[];
  readonly mountFails?: boolean;
}

async function loadPlugin(options: LoadPluginOptions = {}): Promise<LoadedPlugin> {
  const loaded = await clientModuleOnce();
  expect(loaded.id).toBe('@local/dsh-swarm');

  let locale: LoadedPlugin['locale'] = { zh: {}, en: {} };
  let contribution: LoadedPlugin['contribution'] | undefined;
  let registration: LoadedPlugin['registration'] | undefined;
  const react = fakeReact();

  const pluginExports = loaded.factory((name) => {
    if (name === 'react') return react;
    if (name === 'zod') return { z: { string: () => 'string', unknown: () => 'unknown' } };
    throw new Error(`unexpected require(${name})`);
  });

  const t = (key: string, vars?: Record<string, unknown>): string => {
    const template = locale.zh[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
      vars?.[name] === undefined ? `{${name}}` : String(vars[name]));
  };
  const ctx = {
    effect: (fn: () => () => void) => fn(),
    locale: {
      register: (_namespace: string, dictionaries: LoadedPlugin['locale']) => {
        locale = dictionaries;
        return () => undefined;
      },
      bind: () => t,
    },
    slots: {
      inject: (_slot: string, fn: () => LoadedPlugin['registration']) => {
        registration = fn();
      },
      register: (options: LoadedPlugin['registration']['options'], component: LoadedPlugin['registration']['component']) => ({
        options,
        component,
      }),
    },
    remote: {
      $mount: async (mounted: LoadedPlugin['contribution']) => {
        if (options.mountFails === true) throw new Error('mount failed');
        contribution = mounted;
        return async () => undefined;
      },
    },
    // Mounted namespaces are their own `remote.<ns>` services, read via ctx.get().
    get: (name: string) => (name === 'remote.swarmProgress' && contribution !== undefined ? progressRemote : undefined),
  };
  const progressRemote = {
        snapshot: async () => ({ ok: true, value: null }),
        watch: () => {
          let index = 0;
          return {
            async *[Symbol.asyncIterator]() {
              const items = options.items ?? [{ seq: 1, progress: null }];
              while (index < items.length) {
                const item = items[index];
                index += 1;
                yield item;
                await Promise.resolve();
              }
            },
            dispose: () => undefined,
          };
        },
  };

  await pluginExports.apply(ctx);
  if (registration === undefined) throw new Error('client plugin did not register conversation.view');
  if (contribution === undefined && options.mountFails !== true) {
    throw new Error('client plugin did not mount its Remote contribution');
  }
  const registered = registration;

  return {
    exports: pluginExports,
    contribution: contribution ?? { package: '', descriptors: [] },
    locale,
    registration: registered,
    render: (sessionId = OWNER) => {
      react.reset();
      const props = {
        sessionId,
        t,
        ...registered.options.inject(sessionId),
      };
      const element = registered.component(props);
      return { element, text: flattenText(element) };
    },
  };
}

describe('client.js conversation view', () => {
  it('mounts strict-codec Remote descriptors and registers conversation.view order 5', async () => {
    const plugin = await loadPlugin();
    expect(plugin.exports.inject).toEqual(['slots', 'locale', 'remote']);
    expect(plugin.contribution.package).toBe('@local/dsh-swarm');

    const [snapshot, watch] = plugin.contribution.descriptors;
    expect(snapshot?.id).toBe('@local/dsh-swarm#swarmProgress/snapshot');
    expect(snapshot?.mode).toBeUndefined();
    expect(snapshot?.parameters[0]?.codec.mode).toBe('strict');
    expect(snapshot?.result.mode).toBe('strict');
    expect(watch?.mode).toBe('stream');
    expect(watch?.cancellation).toEqual({ parameter: 'signal' });
    expect(watch?.parameters[0]?.codec.mode).toBe('strict');

    expect(plugin.registration.options.name).toBe('conversation.view');
    expect(plugin.registration.options.id).toBe('swarm-progress');
    expect(plugin.registration.options.order).toBe(5);
    expect(plugin.registration.options.locale).toBe('swarmProgress');
    expect(plugin.registration.options.label()).toBe(plugin.locale.zh['view.label']);
    expect(typeof plugin.registration.component).toBe('function');
  });

  it('registers zh/en dictionaries with identical keys', async () => {
    const plugin = await loadPlugin();
    expect(Object.keys(plugin.locale.zh).sort()).toEqual(Object.keys(plugin.locale.en).sort());
    for (const phase of ['preparing', 'running', 'draining', 'quiescing', 'paused', 'completed', 'stopped', 'failed']) {
      expect(plugin.locale.zh[`phase.${phase}`]).toBeTruthy();
    }
    expect(plugin.locale.zh['noRun.body']).toContain('/swarm start');
    expect(plugin.locale.zh['noRun.body']).toContain('swarm_manage');
  });
});

describe('client.js progress panel rendering', () => {
  async function flush(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  it('renders phase, budget, task counts, worker states and current task', async () => {
    const progress = toProgressSnapshot(status(), detail(), 4_500);
    const plugin = await loadPlugin({ items: [{ seq: 1, progress }] });
    plugin.render();
    await flush();
    const { text } = plugin.render();
    const zh = (key: string): string => {
      const value = plugin.locale.zh[key];
      if (value === undefined) throw new Error(`missing zh key: `);
      return value;
    };

    expect(text).toContain(zh('title'));
    expect(text).toContain(RUN);
    expect(text).toContain(zh('phase.running'));
    expect(text).toContain('4/21');
    expect(text).toContain(zh('budget.remaining').replace('{minutes}', '1'));
    // 每个 worker 的原生状态原样展示；inactive 不得显示成完成。
    expect(text).toContain('w1');
    expect(text).toContain('w2');
    expect(text).toContain('w3');
    expect(text).toContain(plugin.locale.zh['worker.running']);
    expect(text).toContain(plugin.locale.zh['worker.inactive']);
    expect(text).toContain(plugin.locale.zh['worker.unavailable']);
    expect(text).toContain('provider missing');
    expect(text).toContain('Implement progress DTO');
    expect(text).toContain('3');
    expect(text).not.toContain('%');
  });

  it('shows a friendly start hint when the session has no run', async () => {
    const plugin = await loadPlugin({ items: [{ seq: 1, progress: null }] });
    plugin.render();
    await flush();
    const { text } = plugin.render();
    expect(text).toContain(plugin.locale.zh['noRun.title']);
    expect(text).toContain('/swarm start');
    expect(text).toContain('swarm_manage');
  });

  it('reports the Host interface as unavailable when the Remote mount fails', async () => {
    const plugin = await loadPlugin({ mountFails: true });
    const { text } = plugin.render();
    expect(text).toContain('Swarm 进度连接失败');
    expect(text).toContain('mount failed');
  });
});
