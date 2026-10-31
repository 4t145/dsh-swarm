/** Current team policy, deliberately separate from native free capacity. */
import { SwarmError } from './errors.ts';

export interface WorkerLimit {
  maxWorkers: number;
  source: 'host' | 'override';
}

export interface WorkerControls {
  canAdd: boolean;
  maxWorkers: number | null;
  source: WorkerLimit['source'] | null;
  diagnostic: string | null;
}

/** Resolve afresh at admission/status; never persist a policy snapshot in a run. */
export type WorkerLimitResolver = (ownerSessionId: string) => WorkerLimit;

/** Undefined alone means absent; invalid explicit values never inherit. */
export function resolveWorkerLimit(override: unknown, readHost: () => unknown): WorkerLimit {
  if (override !== undefined) return { maxWorkers: positiveLimit(override, 'workerCountMax'), source: 'override' };
  return { maxWorkers: positiveLimit(readHost(), 'maxActiveSubagents'), source: 'host' };
}

/** Validate both external config and resolver boundaries, without coercion. */
export function positiveLimit(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new SwarmError('SWARM_CONFIG_UNAVAILABLE', `${field} must be a positive safe integer; no fallback was applied`, {
      details: { field, received: String(value) },
    });
  }
  return value;
}

/** Team-policy rejection is not a claim about native free slots. */
export function assertWorkerLimit(count: number, limit: WorkerLimit): void {
  if (count > limit.maxWorkers) {
    throw new SwarmError('SWARM_WORKER_LIMIT', `requested team size ${count} exceeds ${limit.source} worker limit ${limit.maxWorkers}`, {
      details: { requestedWorkers: count, maxWorkers: limit.maxWorkers, source: limit.source },
    });
  }
}
