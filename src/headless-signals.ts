/** Application-only signal ownership: persist stop before the launcher disposes storage. */
import type { EventEmitter } from 'node:events';

/**
 * Delay the launcher's first interrupt until cancel() leads to appExit().
 * A repeated signal delegates to the launcher's original escalation path.
 * Restore all borrowed listeners on application unload; never use in the GUI entry.
 */
export function installHeadlessSignals(emitter: EventEmitter, cancel: () => void): () => void {
  const signals = ['SIGINT', 'SIGTERM'] as const;
  // Node types expose raw listeners as Function; these signal handlers are callable.
  type SignalListener = (...args: unknown[]) => void;
  const previous = new Map(signals.map((signal) => [signal, emitter.rawListeners(signal).map((listener) => listener as SignalListener)]));
  let interrupted = false;
  let restored = false;
  const handlers = new Map(signals.map((signal) => [signal, (...args: unknown[]) => {
    if (!interrupted) {
      interrupted = true;
      cancel();
      return;
    }
    for (const listener of previous.get(signal) ?? []) listener.apply(emitter, args);
  }]));
  for (const signal of signals) {
    for (const listener of previous.get(signal) ?? []) emitter.off(signal, listener);
    const handler = handlers.get(signal);
    if (handler) emitter.on(signal, handler);
  }
  return () => {
    if (restored) return;
    restored = true;
    for (const signal of signals) {
      const handler = handlers.get(signal);
      if (handler) emitter.off(signal, handler);
      for (const listener of previous.get(signal) ?? []) {
        if (!emitter.rawListeners(signal).includes(listener)) emitter.on(signal, listener);
      }
    }
  };
}
