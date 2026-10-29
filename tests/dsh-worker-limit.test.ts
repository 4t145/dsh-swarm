import { Context, type Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import { describe, expect, it } from 'vitest';
import { dshWorkerLimitResolver } from '../src/dsh-worker-limit.ts';
import { resolveWorkerLimit } from '../src/worker-limit.ts';
import { SwarmService } from '../src/index.ts';

/** Real Cordis config validation and service isolation, without a model runtime. */
async function host(value?: number) {
  const ctx = new Context();
  ctx.provide('workingDirectory', {});
  const fiber = ctx.plugin(SubagentRuntime, value === undefined ? {} : { maxActiveSubagents: value });
  await fiber.await();
  return { ctx, fiber, close: () => ctx.fiber.dispose() };
}

describe('effective native worker policy', () => {
  it('inherits the installed default, configured 12, and live provider replacement', async () => {
    const h = await host();
    try {
      const resolve = dshWorkerLimitResolver(h.ctx);
      // This expectation verifies the installed DSH default; production does not copy it.
      expect(resolve('owner')).toEqual({ maxWorkers: 8, source: 'host' });
      await h.fiber.dispose();
      const replacement = h.ctx.plugin(SubagentRuntime, { maxActiveSubagents: 12 });
      await replacement.await();
      expect(resolve('owner')).toEqual({ maxWorkers: 12, source: 'host' });
    } finally { await h.close(); }
  });

  it('reads current Volatile values, gives override precedence and restores inheritance', async () => {
    const h = await host(12);
    let override: number | undefined;
    const reference: Volatile<number | undefined> = { get: () => override };
    try {
      const resolve = dshWorkerLimitResolver(h.ctx, reference);
      expect(resolve('owner').maxWorkers).toBe(12);
      override = 20;
      expect(resolve('owner')).toEqual({ maxWorkers: 20, source: 'override' });
      override = 3;
      expect(resolve('owner')).toEqual({ maxWorkers: 3, source: 'override' });
      override = undefined;
      expect(resolve('owner')).toEqual({ maxWorkers: 12, source: 'host' });
      expect(h.fiber.config.maxActiveSubagents.get()).toBe(12);
    } finally { await h.close(); }
  });

  it('uses the native provider in the same isolated Host scope, not a global default', async () => {
    const h = await host(12);
    const isolated = h.ctx.isolate('subagents');
    const fiber = isolated.plugin(SubagentRuntime, { maxActiveSubagents: 6 });
    await fiber.await();
    try {
      expect(dshWorkerLimitResolver(h.ctx)('owner-a').maxWorkers).toBe(12);
      expect(dshWorkerLimitResolver(isolated)('owner-b').maxWorkers).toBe(6);
    } finally { await h.close(); }
  });

  it('fails explicitly for absent provider/config/reference, without substituting capacity', async () => {
    const ctx = new Context();
    try {
      expect(() => dshWorkerLimitResolver(ctx)('owner')).toThrow(/unavailable/);
      ctx.provide('subagents', {});
      expect(() => dshWorkerLimitResolver(ctx)('owner')).toThrow(/validated maxActiveSubagents/);
      expect(dshWorkerLimitResolver(ctx, { get: () => 11 })('owner')).toEqual({ maxWorkers: 11, source: 'override' });
    } finally { await ctx.fiber.dispose(); }
  });

  it('evaluates the same dynamic reference on every call rather than capturing a schema default', async () => {
    let current = 8;
    const ctx = new Context();
    const plugin = Object.assign((scope: Context) => { scope.provide('subagents', {}); }, {
      Config: Schema.object({ maxActiveSubagents: Schema.any() }),
    });
    const fiber = ctx.plugin(plugin, { maxActiveSubagents: { get: () => current } });
    await fiber.await();
    try {
      const resolve = dshWorkerLimitResolver(ctx);
      expect(resolve('owner').maxWorkers).toBe(8);
      current = 12;
      expect(resolve('owner').maxWorkers).toBe(12);
      current = NaN;
      expect(() => resolve('owner')).toThrow(/positive safe integer/);
    } finally { await ctx.fiber.dispose(); }
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, '8', false, null, {}, Number.MAX_SAFE_INTEGER + 1])('rejects invalid explicit override %s without calling host fallback', (value) => {
    expect(() => resolveWorkerLimit(value, () => { throw new Error('must not fall back'); })).toThrow(/workerCountMax must/);
    expect(() => resolveWorkerLimit(undefined, () => value)).toThrow(/maxActiveSubagents must/);
  });

  it('Host schema has no numeric override default and rejects invalid values', () => {
    const unset = SwarmService.Config({});
    expect(unset.workerCountMax.get()).toBeUndefined();
    expect(SwarmService.Config({ workerCountMax: 12 }).workerCountMax.get()).toBe(12);
    for (const workerCountMax of [0, -1, 1.5, NaN, Infinity, '8', false]) {
      expect(() => Schema.resolve({ workerCountMax }, SwarmService.Config)).toThrow();
    }
    // Schemastery's optional nullable value survives parsing, so Swarm validates it explicitly.
    const nullConfig = SwarmService.Config({ workerCountMax: null });
    expect(() => resolveWorkerLimit(nullConfig.workerCountMax.get(), () => 12)).toThrow(/workerCountMax must/);
  });
});
