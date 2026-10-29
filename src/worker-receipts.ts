/** Worker-owned replay and persistence of technical display receipts, without invoking a model. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-projection';
import type {} from '@deepseek-ai/dsh-tools';
import type { Collaboration } from './collaboration.ts';
import { isSwarmError, SwarmError } from './errors.ts';
import { RECEIPT_PROJECTION_KEY, receiptFromEvent, receiptProjection, type ReceiptProjection } from './notification-receipts.ts';
import { SerialQueue } from './serial.ts';

export interface WorkerReceipts {
  /** Await receipt durability before an existing tool/step; never starts another model turn. */
  reconcile(session: Session): Promise<void>;
  dispose(): Promise<void>;
}

/** Uses post-commit Session events plus the real flush checkpoint; failed writes remain replayable. */
export function registerWorkerReceipts(ctx: Context, collaboration: Collaboration): WorkerReceipts {
  const registry = ctx.get('sessionProjections');
  const sessions = ctx.get('sessions');
  if (!registry || !sessions) throw new SwarmError('SWARM_INTERNAL', 'Automatic display receipts require sessions and sessionProjections');
  const unregister = registry.register(receiptProjection);
  const queue = new SerialQueue();
  const saved = new WeakMap<Session, ReceiptProjection>();
  let disposed = false;
  const reconcile = (session: Session): Promise<void> => queue.run(async () => {
    const state = registry.stateOf(session, RECEIPT_PROJECTION_KEY);
    if (!state || saved.get(session) === state) return;
    let identity: ReturnType<Collaboration['resolveWorker']>;
    try { identity = collaboration.resolveWorker(session.id); }
    catch (error) {
      if (isSwarmError(error) && error.code === 'SWARM_FORBIDDEN') return;
      throw error;
    }
    const receipt = state.runs[identity.run.id];
    if (!receipt) { saved.set(session, state); return; }
    // session/event is post-commit in memory, NOT a disk durability guarantee.
    // Persist its evidence first so a crash cannot leave an ACK for a lost input.
    if (!await sessions.flush(session)) {
      throw new SwarmError('SWARM_INTERNAL', 'Cannot persist display receipt: no Session durability listener is available');
    }
    await collaboration.recordShown(session.id, receipt);
    saved.set(session, state);
  });
  const removeEvent = ctx.on('session/event', (session, event) => {
    if (disposed || !receiptFromEvent(event)) return;
    // Observer errors must not turn an already-executed edit into a retryable tool error.
    // The next pre-step/pre-execute barrier retries and surfaces a persistent failure.
    void reconcile(session).catch((error: unknown) => {
      ctx.logger.warn('Swarm automatic display receipt pending: %s', error instanceof Error ? error.message : String(error));
    });
  });
  const removeStep = ctx.on('agent/pre-step', async ({ agent }, next) => {
    await reconcile(agent.session);
    return next();
  });
  const removeTool = ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent) await reconcile(exec.agent.session);
    return next();
  });
  const removeStop = ctx.on('agent/turn-stopping', async ({ agent }) => { await reconcile(agent.session); });
  return {
    reconcile,
    async dispose() {
      if (disposed) return;
      disposed = true;
      removeEvent(); removeStep(); removeTool(); removeStop();
      await queue.idle();
      unregister();
    },
  };
}
