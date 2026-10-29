/** Passive peer knowledge at tool boundaries; never acknowledges events or wakes an Agent. */
import type { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-tools';
import type { Collaboration } from './collaboration.ts';
import { isSwarmError } from './errors.ts';
import { isEventVisible, notificationReference, pendingNotifications } from './events.ts';
import type { Run, SwarmEvent } from './types.ts';

export interface WorkerContextConfig {
  peerNoticeItems: number;
  peerNoticeChars: number;
}

function short(text: string, chars: number): string {
  return text.length <= chars ? text : `${text.slice(0, chars - 1)}…`;
}

/** Project one visible event to a small notice; details remain available through swarm_read/sync. */
function notice(run: Run, event: SwarmEvent, chars: number): object | null {
  const base = { eventSeq: event.seq, author: event.authorWorkerId, kind: event.kind };
  switch (event.kind) {
    case 'goal': {
      const goal = run.goals[event.goalId];
      return goal ? { ...base, id: goal.id, text: short(goal.text, chars), status: goal.status,
        goalRevision: run.goalRevision, source: 'owner' } : null;
    }
    case 'finding': {
      const finding = run.findings[event.findingId];
      return finding ? { ...base, id: finding.id, type: finding.kind, taskId: finding.taskId,
        summary: short(finding.summary, chars), evidence: finding.evidenceRefs.slice(0, 2).map((ref) => short(ref, chars)) } : null;
    }
    case 'task': {
      const task = run.tasks[event.taskId];
      return task ? { ...base, id: task.id, subject: short(task.subject, chars),
        status: event.status, owner: event.ownerWorkerId, scope: task.scope.slice(0, 3).map((path) => short(path, chars)) } : null;
    }
    case 'message': {
      const message = run.messages[event.messageId];
      return message ? { ...base, id: message.id, body: short(message.body, chars) } : null;
    }
    case 'proposal': {
      const proposal = run.proposals[event.proposalId];
      return { ...base, id: event.proposalId, taskId: event.taskId, status: event.status,
        diagnosticsRef: proposal?.diagnosticsRef ?? null };
    }
    case 'head':
      return { ...base, acceptedHead: event.acceptedHead };
    case 'public':
      // The collector groups public events below; never expand bodies at this boundary.
      return null;
    case 'run':
      return null;
  }
}

/** Bounded passive projection. Its scanned cursor is memory-only, never an offered/read cursor. */
export function collectWorkerNotices(run: Run, workerId: string, after: number, config: WorkerContextConfig) {
  const updates: object[] = [];
  const groups = new Map<string, { kind: 'public'; channelId: string; threadId: string | null;
    title: string; latestEventSeq: number; activityCount: number }>();
  let scanned = after;
  let hasMore = false;
  for (const event of run.events) {
    if (event.seq <= after) continue;
    if (event.authorWorkerId === workerId || !isEventVisible(event, workerId) || event.kind === 'run') {
      scanned = event.seq;
      continue;
    }
    const key = event.kind === 'public' ? (event.threadId ?? event.channelId) : null;
    const previous = key === null ? undefined : groups.get(key);
    if (updates.length >= config.peerNoticeItems && !previous) { hasMore = true; break; }
    if (event.kind === 'public') {
      if (previous) { previous.latestEventSeq = event.seq; previous.activityCount += 1; }
      else {
        const item = { kind: 'public' as const, channelId: event.channelId, threadId: event.threadId,
          title: short((event.threadId ? run.threads[event.threadId]?.title : run.channels[event.channelId]?.name) ?? '', config.peerNoticeChars),
          latestEventSeq: event.seq, activityCount: 1 };
        groups.set(event.threadId ?? event.channelId, item);
        updates.push(item);
      }
    } else {
      const item = notice(run, event, config.peerNoticeChars);
      if (item !== null) updates.push(item);
    }
    scanned = event.seq;
  }
  const pending = pendingNotifications(run, workerId);
  return { updates, scanned, hasMore, attention: pending.slice(0, config.peerNoticeItems).map(notificationReference),
    attentionTotal: pending.length, attentionHasMore: pending.length > config.peerNoticeItems };
}

/**
 * Append logged additional context after an accepted worker tool result, preserving its outcome.
 * The in-memory cursor only suppresses repeated notices. Durable offered/observed/wait state is
 * untouched: a later swarm_sync remains authoritative, and cold resumes may repeat summaries.
 * The caller's preset context owns registration and disposal.
 */
export function registerWorkerContext(ctx: Context, collaboration: Collaboration, config: WorkerContextConfig): () => void {
  let cursors = new WeakMap<object, number>();
  let attentionSeen = new WeakMap<object, string>();
  const remove = ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    if (decision.kind !== 'accept' || exec.signal.aborted || !exec.agent || result.isError || result.concludesTurn) return decision;
    if (exec.name === 'swarm_wait' || exec.name === 'swarm_finish') return decision;

    let membership: ReturnType<Collaboration['resolveWorker']>;
    try {
      membership = collaboration.resolveWorker(exec.agent.id);
    } catch (error) {
      if (isSwarmError(error) && error.code === 'SWARM_FORBIDDEN') return decision;
      // A notice failure must not turn an already-executed edit or command into a retryable failure.
      ctx.logger.warn('Swarm peer context unavailable: %s', error instanceof Error ? error.message : String(error));
      return { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), createUserMessage({
        source: { kind: 'tool', callId: exec.callId },
        content: [{ type: 'text', text: '[Swarm] Peer updates could not be read. Use swarm_sync before choosing further work.' }],
      })] };
    }
    const { run, worker } = membership;
    if (run.phase !== 'running' || worker.waitRegistration !== null) return decision;

    // Explicit sync already returned the complete event page; do not repeat it as a notice.
    if (exec.name === 'swarm_sync') {
      const value = result.value;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)
        && typeof value.throughSeq === 'number') {
        cursors.set(exec.agent, Math.max(cursors.get(exec.agent) ?? 0, value.throughSeq));
      }
      return decision;
    }

    const after = Math.max(worker.observedSeq, cursors.get(exec.agent) ?? worker.observedSeq);
    const page = collectWorkerNotices(run, worker.id, after, config);
    cursors.set(exec.agent, page.scanned);
    const signature = JSON.stringify(page.attention);
    const showAttention = attentionSeen.get(exec.agent) !== signature;
    attentionSeen.set(exec.agent, signature);
    const attention = showAttention ? page.attention : [];
    if ((!page.updates.length && !attention.length) || exec.signal.aborted) return decision;
    return { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), createUserMessage({
      source: { kind: 'tool', callId: exec.callId },
      content: [{ type: 'text', text: '[Swarm shared context — goal records are owner additions; other records are peer reports]\n'
        + JSON.stringify({ runId: run.id, attention, attentionTotal: page.attentionTotal,
          attentionHasMore: page.attentionHasMore, updates: page.updates, hasMore: page.hasMore })
        + '\nUse findings to adjust your work; negotiate overlaps in public threads. '
        + 'Read priority attention and source public messages on demand; swarm_read expands legacy records. '
        + 'Summaries are not full-message reads, responses or agreement confirmations. '
        + 'These notice sequences are NOT acknowledgement cursors; use swarm_sync before ack or wait.' }],
    })] };
  });
  return () => { remove(); cursors = new WeakMap(); attentionSeen = new WeakMap(); };
}
