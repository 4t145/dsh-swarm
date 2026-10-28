import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
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
}
interface Registration {
  name: string;
  id: string;
  order: number;
  inject: () => ViewProps;
}
interface Captured {
  factory: (require: (name: string) => unknown) => { apply: (ctx: Context) => void; inject: string[] };
}
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
function load() {
  let captured: Captured | undefined;
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: (module: Captured) => { captured = module; } } },
    console, AbortController, Error,
  });
  if (!captured) throw new Error('client.js did not register');
  return captured.factory((name) => {
    if (name === 'react') return {}; // Slot registration only; not visual rendering.
    throw new Error(`unexpected require ${name}`);
  });
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
