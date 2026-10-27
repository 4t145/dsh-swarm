/** Keep the provider's store alive until its headless callers have stopped. */
import { SwarmError } from './errors.ts';

export class HeadlessDriverLifetime {
  private closed = false;
  private readonly active = new Set<{ controller: AbortController; done: Promise<void> }>();

  /** Register before invoking the callback, so shutdown cannot miss startup. */
  async run<T>(operation: (signal: AbortSignal) => Promise<T>, callerSignal?: AbortSignal): Promise<T> {
    if (this.closed) throw new SwarmError('SWARM_INVALID_STATE', 'Swarm service is shutting down');
    const controller = new AbortController();
    let finish = (): void => undefined;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const lease = { controller, done };
    this.active.add(lease);
    try {
      return await operation(callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal);
    } finally {
      this.active.delete(lease);
      finish();
    }
  }

  /** Abort drivers and await their terminal/failed outcome before closing storage. */
  async close(): Promise<void> {
    this.closed = true;
    const leases = [...this.active];
    for (const lease of leases) lease.controller.abort(new Error('Swarm service is shutting down'));
    await Promise.all(leases.map((lease) => lease.done));
  }
}
