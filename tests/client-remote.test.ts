import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import * as registry from '@deepseek-ai/dsh-typert-registry/client';
import * as gateway from '@deepseek-ai/dsh-api-gateway/client';

interface Captured {
  factory: (require: (name: string) => unknown) => { apply: (ctx: Context) => Promise<void> };
}
interface Registered {
  options: { inject: (sessionId: string) => { progressAvailable: boolean; progressError: string | null } };
}

/** Regression: the panel must reach `remote.swarmProgress` through the real Cordis inject rules. */
describe('client.js with the real Remote client', () => {
  it('mounts swarmProgress and reports it available', async () => {
    const ctx = new Context();
    ctx.provide('connection', {
      interactions: 'none',
      isLoopback: true,
      generation: { getSnapshot: () => undefined },
      rpc: { call: async () => ({ ok: true, value: null }) },
    });
    await ctx.plugin(registry);
    await ctx.plugin(gateway);
    let registration: Registered | undefined;
    let registered!: () => void;
    const ready = new Promise<void>((resolve) => { registered = resolve; });
    ctx.provide('locale', { register: () => () => undefined, bind: () => (key: string) => key });
    ctx.provide('slots', {
      inject: (_name: string, fn: () => unknown) => fn(),
      register: (options: Registered['options']) => { registration = { options }; registered(); return () => undefined; },
    });
    const captures: Captured[] = [];
    Reflect.set(globalThis, 'window', { __ModuleLoader__: { load: (module: Captured) => captures.push(module) } });
    // @ts-expect-error client.js is an untyped browser bundle that registers through window.
    await import('../client.js?real-remote');
    const loaded = captures[0];
    if (loaded === undefined) throw new Error('client.js did not register');
    await ctx.plugin(loaded.factory((name) => {
      if (name === 'react') return {};
      throw new Error(`unexpected require ${name}`);
    }));
    await ready;
    const props = registration?.options.inject('owner');
    expect(props).toMatchObject({ progressAvailable: true, progressError: null });
    await ctx.fiber.dispose();
  });
});
