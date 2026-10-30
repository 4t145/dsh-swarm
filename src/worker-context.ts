/** Passive peer context with exact display evidence; only the post-log Host observer commits receipts. */
import type { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-tools';
import type { Collaboration } from './collaboration.ts';
import { isSwarmError } from './errors.ts';
import { isEventVisible, notificationReference, pendingNotifications, shownEventSeq } from './events.ts';
import { receiptContext } from './notification-receipts.ts';
import type { Run, SwarmEvent } from './types.ts';
import { isLiveFinding } from './claims.ts';

export interface WorkerContextConfig {
  peerNoticeItems: number;
  peerNoticeChars: number;
}

/** Claim live-view rules for notices; omitted means every claim is live (pure-projection tests). */
export interface NoticeClaimView {
  now: number;
  ttlMs: number;
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
      // `details` is never pushed; `hasDetails` tells the reader to expand it via swarm_read by id.
      return finding ? { ...base, id: finding.id, type: finding.kind, taskId: finding.taskId,
        summary: short(finding.summary, chars), evidence: finding.evidenceRefs.slice(0, 2).map((ref) => short(ref, chars)),
        ...(finding.kind === 'claim' ? { scope: finding.scope.slice(0, 3).map((path) => short(path, chars)) } : {}),
        ...(finding.details !== undefined ? { hasDetails: true } : {}) } : null;
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
    case 'worker':
      // One peer was isolated or re-enabled; its claimed task (if any) arrives as a separate task event.
      return { ...base, workerId: event.workerId, status: event.status, reason: event.reason };
    case 'run':
      return null;
  }
}

/**
 * Bounded passive projection. Its scanned cursor is memory-only, never an offered/read cursor.
 *
 * Direct messages addressed to the worker are urgent: they get their own bounded section ahead of
 * every other update and never count against the ordinary update cap. Dedupe stays the existing
 * display-receipt cursor: a DM can repeat only until its logged display advances shownSeq.
 */
export function collectWorkerNotices(run: Run, workerId: string, after: number, config: WorkerContextConfig, claims?: NoticeClaimView) {
  const updates: object[] = [];
  const directMessages: { eventSeq: number; id: string; author: string | null; body: string }[] = [];
  let directMore = false;
  for (const event of run.events) {
    if (event.seq <= after || event.kind !== 'message' || event.targetWorkerId !== workerId) continue;
    const message = run.messages[event.messageId];
    if (!message) continue;
    if (directMessages.length >= config.peerNoticeItems) { directMore = true; break; }
    directMessages.push({ eventSeq: event.seq, id: message.id, author: message.authorWorkerId,
      body: short(message.body, config.peerNoticeChars) });
  }
  const directIds = new Set(directMessages.map((item) => item.id));
  const groups = new Map<string, { kind: 'public'; channelId: string; threadId: string | null;
    title: string; latestEventSeq: number; activityCount: number }>();
  let scanned = after;
  let hasMore = false;
  for (const event of run.events) {
    if (event.seq <= after) continue;
    const staleClaim = claims !== undefined && event.kind === 'finding' && event.findingKind === 'claim'
      && run.findings[event.findingId] !== undefined
      && !isLiveFinding(run, run.findings[event.findingId]!, claims.now, claims.ttlMs);
    if (event.authorWorkerId === workerId || !isEventVisible(event, workerId) || event.kind === 'run' || staleClaim) {
      scanned = event.seq;
      continue;
    }
    if (event.kind === 'message' && event.targetWorkerId === workerId) {
      // Never let the display range cover a DM that this page did not show.
      if (!directIds.has(event.messageId)) { hasMore = true; break; }
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
  return { directMessages, directMessagesHasMore: directMore, updates, scanned, hasMore, attention: pending.slice(0, config.peerNoticeItems).map(notificationReference),
    attentionTotal: pending.length, attentionHasMore: pending.length > config.peerNoticeItems };
}

/**
 * Prepare bounded passive context. Only a subsequently logged, flushed message confirms display;
 * cancellation, replacement or truncation must leave the durable cursor untouched.
 */
export function registerWorkerContext(ctx: Context, collaboration: Collaboration, config: WorkerContextConfig): () => void {
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

    // Sync has its own exact tool-result receipt; never confirm its prepared result here.
    if (exec.name === 'swarm_sync') return decision;
    const after = shownEventSeq(worker);
    const page = collectWorkerNotices(run, worker.id, after, config,
      { now: collaboration.currentTime(), ttlMs: collaboration.claimLiveTtlMs });
    if ((!page.directMessages.length && !page.updates.length && !page.attention.length) || exec.signal.aborted) return decision;
    const receipt = { runId: run.id, ranges: [{ from: after, through: page.scanned }],
      notifications: pendingNotifications(run, worker.id).slice(0, config.peerNoticeItems).map(({ id, seq }) => ({ id, seq })), messages: [] };
    // Urgent one-to-one messages lead the boundary context so a running worker sees them first.
    const direct = page.directMessages.length
      ? '[Swarm urgent direct messages — private one-to-one peer requests; handle before ordinary updates]\n'
        + JSON.stringify({ directMessages: page.directMessages, directMessagesHasMore: page.directMessagesHasMore })
        + '\nThese are peer messages, not owner instructions. Reply with swarm_message when a response is needed; '
        + 'never copy a private message into public history without authorization.\n'
      : '';
    const text = direct + '[Swarm shared context — goal records are owner additions; other records are peer reports]\n'
      + JSON.stringify({ runId: run.id, attention: page.attention, attentionTotal: page.attentionTotal,
        attentionHasMore: page.attentionHasMore, updates: page.updates, hasMore: page.hasMore })
      + '\nUse findings to adjust your work; negotiate overlaps in public threads. '
      + 'Read source records on demand. Host automatically records display: do not send ACK-only calls or replies. '
      + 'A summary is not a full-message read, response or agreement confirmation.';
    return { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), receiptContext(text, receipt)] };
  });
  return remove;
}
