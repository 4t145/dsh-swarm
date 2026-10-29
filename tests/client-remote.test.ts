import { loadClient } from './client-fixture.ts';
import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import * as registry from '@deepseek-ai/dsh-typert-registry/client';
import * as gateway from '@deepseek-ai/dsh-api-gateway/client';

interface Stream extends AsyncIterable<unknown> { dispose(): void }
interface ViewProps {
  progressAvailable: boolean;
  progressError: string | null;
  watchProgress(sessionId: string, signal?: AbortSignal): Stream;
  watchSessionProgress(sessionId: string, signal?: AbortSignal): Stream;
  executeCommand(sessionId: string, line: string, attachments: readonly unknown[], signal?: AbortSignal): Promise<unknown>;
  loadHistory(sessionId: string, cursor: string | null, signal?: AbortSignal): Promise<unknown>;
  loadPublic(sessionId: string, runId: string, query: unknown, signal?: AbortSignal): Promise<unknown>;
  listWorktrees(sessionId: string): Promise<unknown>;
  createWorktree(sessionId: string, request: unknown): Promise<unknown>;
}
interface Registration {
  name: string;
  id: string;
  order: number;
  inject: () => ViewProps;
}
function load() {
  return loadClient<{ apply: (ctx: Context) => void; inject: string[] }>();
}
function viewServices(ctx: Context) {
  let registration: Registration | undefined;
  const removeLocale = vi.fn();
  const removeSlot = vi.fn();
  ctx.provide('locale', { register: () => removeLocale, bind: () => (key: string) => key });
  ctx.provide('slots', {
    inject: (_name: string, fn: () => unknown) => fn(),
    register: (options: Registration) => { registration = options; return removeSlot; },
  });
  return { registration: () => registration, removeLocale, removeSlot };
}

/** Uses actual Cordis ownership and Gateway mount contracts, not a replacement Remote implementation. */
describe('client.js with the real Remote client', () => {
  it('mounts the namespace through ctx.get and disposes descriptors, slot and locale', async () => {
    const ctx = new Context();
    try {
      ctx.provide('connection', {
        interactions: 'none', isLoopback: true,
        generation: { getSnapshot: () => undefined },
        rpc: { call: async () => ({ ok: true, value: null }) },
      });
      await ctx.plugin(registry);
      await ctx.plugin(gateway);
      const view = viewServices(ctx);
      const panel = await ctx.plugin(load());
      expect(view.registration()).toMatchObject({ name: 'conversation.view', id: 'swarm-progress', order: 5 });
      const props = view.registration()?.inject();
      expect(props).toMatchObject({ progressAvailable: true, progressError: null });
      expect(typeof props?.watchSessionProgress).toBe('function');
      // A changed injected object must not tear down/reopen a healthy stream on each render.
      expect(view.registration()?.inject().watchSessionProgress).toBe(props?.watchSessionProgress);
      expect(ctx.get('remote.swarmProgress')).toBeDefined();
      await panel.dispose();
      expect(ctx.get('remote.swarmProgress')).toBeUndefined();
      expect(view.removeSlot).toHaveBeenCalledTimes(1);
      expect(view.removeLocale).toHaveBeenCalledTimes(1);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('forwards session and cancellation through the real watchSession descriptor', async () => {
    const ctx = new Context();
    let rawSignal: AbortSignal | undefined;
    const calls: Array<{ endpoint: string; payload: unknown }> = [];
    try {
      ctx.provide('connection', {
        interactions: 'none', isLoopback: true,
        generation: { getSnapshot: () => undefined },
        rpc: {
          call: async () => ({ ok: true, value: null }),
          open: (_path: string, endpoint: string, payload: unknown, signal: AbortSignal) => {
            calls.push({ endpoint, payload });
            rawSignal = signal;
            return (async function* () {
              yield { seq: 1, progress: null };
              if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
            })();
          },
        },
      });
      await ctx.plugin(registry);
      await ctx.plugin(gateway);
      const view = viewServices(ctx);
      const panel = await ctx.plugin(load());
      const props = view.registration()?.inject();
      if (!props) throw new Error('missing view');
      const handle = props.watchSessionProgress('actual-owner');
      const iterator = handle[Symbol.asyncIterator]();
      expect(await iterator.next()).toEqual({ done: false, value: { seq: 1, progress: null } });
      expect(calls).toEqual([{ endpoint: 'swarmProgress/watchSession', payload: { args: { sessionId: 'actual-owner' } } }]);
      await panel.dispose();
      expect(rawSignal?.aborted).toBe(true);
      expect((await iterator.next()).done).toBe(true);
      expect(ctx.get('remote.swarmProgress')).toBeUndefined();
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('resolves the native commands namespace through Cordis without inventing a write remote', async () => {
    const ctx = new Context();
    const execute = vi.fn(async () => ({ ok: true, value: { result: { kind: 'success', text: 'saved' } } }));
    try {
      ctx.provide('connection', {
        interactions: 'none', isLoopback: true,
        generation: { getSnapshot: () => undefined },
        rpc: { call: async () => ({ ok: true, value: null }) },
      });
      await ctx.plugin(registry);
      await ctx.plugin(gateway);
      ctx.provide('remote.commands', { execute });
      const view = viewServices(ctx);
      const panel = await ctx.plugin(load());
      const props = view.registration()?.inject();
      if (!props) throw new Error('missing view');
      const signal = new AbortController().signal;
      await expect(props.executeCommand('owner-session', '/swarm append --json {"goal":"CSV"}', [], signal))
        .resolves.toMatchObject({ ok: true, value: { result: { kind: 'success' } } });
      expect(execute).toHaveBeenCalledExactlyOnceWith('owner-session', '/swarm append --json {"goal":"CSV"}', [], signal);
      expect(view.registration()?.inject().executeCommand).toBe(props.executeCommand);
      await panel.dispose();
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('forwards history cursors and cancellation through the real unary descriptor', async () => {
    const ctx = new Context();
    const page = { runId: 'run', items: [], worktrees: [], nextCursor: null };
    let rawSignal: AbortSignal | undefined;
    const call = vi.fn(async (_path: string, _endpoint: string, _payload: unknown, signal: AbortSignal) => {
      rawSignal = signal;
      return { ok: true, value: page };
    });
    try {
      ctx.provide('connection', {
        interactions: 'none', isLoopback: true,
        generation: { getSnapshot: () => undefined }, rpc: { call },
      });
      await ctx.plugin(registry);
      await ctx.plugin(gateway);
      const view = viewServices(ctx);
      const panel = await ctx.plugin(load());
      const props = view.registration()?.inject();
      if (!props) throw new Error('missing view');
      const controller = new AbortController();
      await expect(props.loadHistory('owner-session', 'opaque-cursor', controller.signal)).resolves.toEqual(page);
      expect(call).toHaveBeenCalledWith('/api', 'swarmProgress/worktreeHistory', { args: { sessionId: 'owner-session', cursor: 'opaque-cursor' } }, expect.any(AbortSignal));
      controller.abort();
      expect(rawSignal?.aborted).toBe(true);
      expect(view.registration()?.inject().loadHistory).toBe(props.loadHistory);
      await panel.dispose();
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('forwards bounded public query identity and cancellation through the real Remote descriptor', async () => {
    const ctx = new Context();
    const page = { runId: 'run', items: [], total: 0, hasMore: false, truncated: false, nextCursor: null, snapshotSeq: 0 };
    let rawSignal: AbortSignal | undefined;
    const call = vi.fn(async (_path: string, _endpoint: string, _payload: unknown, signal: AbortSignal) => { rawSignal = signal; return { ok: true, value: page }; });
    try {
      ctx.provide('connection', { interactions: 'none', isLoopback: true, generation: { getSnapshot: () => undefined }, rpc: { call } });
      await ctx.plugin(registry); await ctx.plugin(gateway);
      const view = viewServices(ctx); const panel = await ctx.plugin(load());
      const props = view.registration()!.inject();
      const abort = new AbortController();
      const query = { view: 'messages', threadId: 'thread', cursor: 'opaque', limit: 10 };
      await expect(props.loadPublic('owner', 'run', query, abort.signal)).resolves.toEqual(page);
      expect(call).toHaveBeenCalledWith('/api', 'swarmProgress/publicDiscussion', { args: { sessionId: 'owner', runId: 'run', query } }, expect.any(AbortSignal));
      abort.abort(); expect(rawSignal?.aborted).toBe(true);
      expect(view.registration()!.inject().loadPublic).toBe(props.loadPublic);
      await expect(props.loadPublic('owner', 'run', { view: 'messages', limit: 21 })).rejects.toThrow('page limit');
      expect(call).toHaveBeenCalledTimes(1);
      await panel.dispose(); expect(ctx.get('remote.swarmProgress')).toBeUndefined();
    } finally { await ctx.fiber.dispose(); }
  });

  it('lists and creates worktrees through the real repository descriptors', async () => {
    const ctx = new Context();
    const snapshot = {
      sessionDirectory: '/repo',
      repositoryRoot: '/repo',
      repositoryName: 'repo',
      note: null,
      worktrees: [],
      updatedAt: 1,
    };
    const created = { worktree: { branch: 'wt-1' }, snapshot };
    const calls: Array<{ endpoint: string; payload: unknown }> = [];
    try {
      ctx.provide('connection', {
        interactions: 'none', isLoopback: true,
        generation: { getSnapshot: () => undefined },
        rpc: {
          call: async (_path: string, endpoint: string, payload: unknown) => {
            calls.push({ endpoint, payload });
            return { ok: true, value: endpoint === 'swarmWorktrees/list' ? snapshot : created };
          },
        },
      });
      await ctx.plugin(registry);
      await ctx.plugin(gateway);
      const view = viewServices(ctx);
      const panel = await ctx.plugin(load());
      const props = view.registration()?.inject();
      if (!props) throw new Error('missing view');
      await expect(props.listWorktrees('owner-session')).resolves.toEqual(snapshot);
      await expect(props.createWorktree('owner-session', { name: 'wt-1' })).resolves.toEqual(created);
      expect(calls).toEqual([
        { endpoint: 'swarmWorktrees/list', payload: { args: { sessionId: 'owner-session' } } },
        { endpoint: 'swarmWorktrees/create', payload: { args: { sessionId: 'owner-session', request: { name: 'wt-1' } } } },
      ]);
      await panel.dispose();
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('does not register a late slot when unloaded while mount is pending', async () => {
    const ctx = new Context();
    let begin!: () => void;
    let finish!: (dispose: () => void) => void;
    const started = new Promise<void>((resolve) => { begin = resolve; });
    const mounted = new Promise<() => void>((resolve) => { finish = resolve; });
    const unmount = vi.fn();
    try {
      ctx.provide('remote', { $mount: () => { begin(); return mounted; } });
      const view = viewServices(ctx);
      const panel = ctx.plugin(load());
      await started;
      const disposing = panel.dispose();
      finish(unmount);
      await disposing;
      expect(view.registration()).toBeUndefined();
      expect(unmount).toHaveBeenCalledTimes(1);
      expect(view.removeLocale).toHaveBeenCalledTimes(1);
    } finally {
      await ctx.fiber.dispose();
    }
  });
});
