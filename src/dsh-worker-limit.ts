/** Read the validated running provider config, not raw Loader input or schema defaults. */
import { Context, type Volatile } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-subagent';
import { SwarmError } from './errors.ts';
import { resolveWorkerLimit, type WorkerLimitResolver } from './worker-limit.ts';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** Read the documented Volatile.get protocol after narrowing unknown Fiber.config. */
function volatileValue(value: unknown): unknown {
  if (!record(value) || typeof value['get'] !== 'function') {
    throw new SwarmError('SWARM_CONFIG_UNAVAILABLE', 'running subagents maxActiveSubagents is not a readable Volatile reference');
  }
  return value['get']();
}

/**
 * Uses the same Host context as DshWorkerHost's native calls. Cordis service isolation
 * selects its provider fiber; that public fiber.config contains the exact references
 * handed to SubagentRuntime. Loader commits valid dynamic edits into these references.
 * The owner selects the native capacity pool at activation, not a second config default.
 */
export function dshWorkerLimitResolver(ctx: Context, override?: Volatile<number | undefined>): WorkerLimitResolver {
  return (_ownerSessionId) => {
    try {
      return resolveWorkerLimit(override?.get(), () => {
        const key = ctx[Context.isolate]['subagents'];
        const provider = key === undefined ? undefined : ctx.reflect.store[key];
        if (!provider || provider.name !== 'subagents' || !ctx.get('subagents')) {
          throw new SwarmError('SWARM_CONFIG_UNAVAILABLE', 'active subagents provider config is unavailable in the Swarm Host scope');
        }
        const config: unknown = provider.fiber.config;
        if (!record(config) || !Object.hasOwn(config, 'maxActiveSubagents')) {
          throw new SwarmError('SWARM_CONFIG_UNAVAILABLE', 'running subagents provider does not expose validated maxActiveSubagents config');
        }
        return volatileValue(config['maxActiveSubagents']);
      });
    } catch (error) {
      if (error instanceof SwarmError) throw error;
      throw new SwarmError('SWARM_CONFIG_UNAVAILABLE', `cannot resolve current worker limit: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  };
}
