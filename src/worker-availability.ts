/**
 * Pure helpers for per-worker failure isolation. Kept outside Delivery/Runtime so both can share
 * them without import cycles (and tests mocking Delivery keep the real predicate).
 */

import type { WorkerRecord } from './types.ts';

/** Host isolated this worker (retries exhausted / no progress); delivery skips it until re-enabled. */
export function isIsolatedWorker(worker: WorkerRecord): boolean {
  const reason = worker.unavailableDetail?.reason;
  return reason === 'activation_failed' || reason === 'no_progress';
}

/** A worker that can still make progress: initialized (or initializing) and not Host-isolated. */
export function isAvailableWorker(worker: WorkerRecord): boolean {
  return worker.initializationState !== 'failed' && !isIsolatedWorker(worker);
}
