/** Bounded public read projection; metadata streams and cursors never imply full-message acknowledgement. */
import { assert } from './errors.ts';
import type { ParsedPublicQuery } from './public-input.ts';
import type { Run } from './types.ts';
import type { AgreementRecord, AgreementVersion, ChannelRecord, NotificationRecord, PublicMessageRecord,
  PublicMessageRevision, ResponseRequestRecord, ThreadRecord } from './public-types.ts';

export type PublicMessageView = Omit<PublicMessageRecord, 'revisions'> & { revisionCount: number };
export type AgreementView = Omit<AgreementRecord, 'versions'> & { versionCount: number };
export type PublicItem =
  | { kind: 'channel'; channel: ChannelRecord }
  | { kind: 'thread'; thread: ThreadRecord }
  | { kind: 'message'; message: PublicMessageView }
  | { kind: 'request'; request: ResponseRequestRecord }
  | { kind: 'agreement'; agreement: AgreementView }
  | { kind: 'notification'; notification: NotificationRecord }
  | { kind: 'activity'; threadId: string; channelId: string; title: string; status: ThreadRecord['status']; updatedSeq: number; messageCount: number; pendingRequestCount: number; agreementIds: string[]; agreementCount: number; agreementsTruncated: boolean; taskIds: string[] }
  | { kind: 'message_revision'; messageId: string; value: PublicMessageRevision }
  | { kind: 'agreement_version'; agreementId: string; value: AgreementVersion; confirmations: AgreementRecord['confirmations'] };
export interface PublicPage {
  runId: string;
  items: PublicItem[];
  total: number;
  hasMore: boolean;
  truncated: boolean;
  nextCursor: string | null;
  /** Event snapshot only. Never a valid legacy ACK or full-message read cursor. */
  snapshotSeq: number;
}
interface Row { key: string; seq: number; item: PublicItem }
interface Cursor { runId: string; filter: string; upperSeq: number; lastKey: string }
const numberKey = (value: number): string => String(value).padStart(16, '0');
function currentMessage(message: PublicMessageRecord): PublicMessageView {
  const { revisions, ...value } = message;
  return { ...value, revisionCount: revisions.length + 1 };
}
function currentAgreement(agreement: AgreementRecord): AgreementView {
  const { versions, ...value } = agreement;
  return { ...value, confirmations: value.confirmations.filter((confirmation) => confirmation.version === value.version), versionCount: versions.length + 1 };
}
function requireId<T>(map: Record<string, T>, id: string | undefined, label: string): T | null {
  if (id === undefined) return null;
  assert(Object.hasOwn(map, id), 'SWARM_NOT_FOUND', `${label} ${id} not found in this run`);
  return map[id]!;
}

/** Cursor is bound to run, viewer and filters. Stable keyset pagination excludes later appended records. */
export function buildPublicPage(run: Run, input: ParsedPublicQuery, workerId: string | null): PublicPage {
  requireId(run.channels, input.channelId, 'channel');
  const thread = requireId(run.threads, input.threadId, 'thread');
  requireId(run.tasks, input.taskId, 'task');
  requireId(run.findings, input.findingId, 'finding');
  const message = requireId(run.publicMessages, input.messageId, 'public message');
  const agreement = requireId(run.agreements, input.agreementId, 'agreement');
  requireId(run.workers, input.workerId, 'worker');
  if (thread && input.channelId) assert(thread.channelId === input.channelId, 'SWARM_INVALID_INPUT', 'Thread/channel mismatch');
  if (message && input.threadId) assert(message.threadId === input.threadId, 'SWARM_INVALID_INPUT', 'Message/thread mismatch');
  const viewer = workerId ?? input.workerId ?? null;
  const { cursor: ignoredCursor, limit: ignoredLimit, ...filters } = input;
  const filter = JSON.stringify([viewer, filters]);
  let upperSeq = run.nextSeq - 1;
  let lastKey = '';
  if (input.cursor) {
    let cursor: unknown;
    try { cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')); }
    catch { assert(false, 'SWARM_INVALID_CURSOR', 'Invalid public page cursor'); }
    assert(typeof cursor === 'object' && cursor !== null && 'runId' in cursor && 'filter' in cursor &&
      'upperSeq' in cursor && 'lastKey' in cursor, 'SWARM_INVALID_CURSOR', 'Invalid public page cursor');
    assert(cursor.runId === run.id && cursor.filter === filter && typeof cursor.upperSeq === 'number' &&
      Number.isSafeInteger(cursor.upperSeq) && cursor.upperSeq >= 0 && cursor.upperSeq < run.nextSeq &&
      typeof cursor.lastKey === 'string', 'SWARM_INVALID_CURSOR', 'Cursor does not match this run/view/filter');
    upperSeq = cursor.upperSeq;
    lastKey = cursor.lastKey;
  }
  const matches = (value: { channelId?: string; threadId?: string; taskIds?: string[] }, text: string): boolean =>
    (!input.channelId || value.channelId === input.channelId) && (!input.threadId || value.threadId === input.threadId) &&
    (!input.taskId || value.taskIds?.includes(input.taskId) === true) && (!input.query || text.toLowerCase().includes(input.query.toLowerCase()));
  const rows: Row[] = [];
  const add = (seq: number, id: string, item: PublicItem, priority = '2'): void => {
    if (seq <= upperSeq) rows.push({ seq, key: `${priority}:${numberKey(seq)}:${id}`, item });
  };
  switch (input.view) {
    case 'channels':
      for (const channel of Object.values(run.channels)) {
        if (input.channelId && channel.id !== input.channelId) continue;
        if (input.status && channel.status !== input.status) continue;
        if (input.query && !`${channel.name}\n${channel.purpose}`.toLowerCase().includes(input.query.toLowerCase())) continue;
        const seq = run.events.find((event) => event.kind === 'public' && event.channelId === channel.id && event.action === 'channel_created')?.seq ?? 0;
        add(seq, channel.id, { kind: 'channel', channel });
      }
      break;
    case 'threads':
    case 'activity':
      for (const entry of Object.values(run.threads)) {
        const taskIds = [...entry.taskIds, ...Object.values(run.publicMessages).filter((msg) => msg.threadId === entry.id).flatMap((msg) => msg.taskIds)];
        if (!matches({ ...entry, threadId: entry.id, taskIds }, entry.title) || (input.status && entry.status !== input.status)) continue;
        if (input.findingId && !entry.findingIds.includes(input.findingId) && !Object.values(run.publicMessages).some((msg) => msg.threadId === entry.id && msg.findingIds.includes(input.findingId!))) continue;
        if (input.view === 'threads') add(entry.seq, entry.id, { kind: 'thread', thread: entry });
        else {
          const agreements = Object.values(run.agreements).filter((record) => record.threadId === entry.id);
          add(entry.seq, entry.id, { kind: 'activity', threadId: entry.id, channelId: entry.channelId, title: entry.title,
            status: entry.status, updatedSeq: entry.updatedSeq,
            messageCount: Object.values(run.publicMessages).filter((msg) => msg.threadId === entry.id).length,
            pendingRequestCount: Object.values(run.responseRequests).filter((request) => request.threadId === entry.id && request.status === 'pending').length,
            agreementIds: agreements.slice(0, 20).map((record) => record.id), agreementCount: agreements.length,
            agreementsTruncated: agreements.length > 20, taskIds: entry.taskIds });
        }
      }
      break;
    case 'messages':
      for (const entry of Object.values(run.publicMessages)) {
        if (input.messageId && entry.id !== input.messageId) continue;
        const taskIds = [...entry.taskIds, ...(run.threads[entry.threadId]?.taskIds ?? [])];
        const linkedFinding = input.findingId && (entry.findingIds.includes(input.findingId) || run.events.some((event) =>
          event.kind === 'public' && event.action === 'finding_linked' && event.findingId === input.findingId && event.messageId === entry.id));
        if (!matches({ ...entry, taskIds }, entry.body) || (input.findingId && !linkedFinding)) continue;
        add(entry.seq, entry.id, { kind: 'message', message: currentMessage(entry) });
      }
      break;
    case 'requests':
      for (const request of Object.values(run.responseRequests)) {
        if (!matches(request, run.publicMessages[request.messageId]?.body ?? '') || (input.status && request.status !== input.status)) continue;
        if (input.workerId && request.targetWorkerId !== input.workerId) continue;
        add(request.seq, request.id, { kind: 'request', request });
      }
      break;
    case 'agreements':
      for (const entry of Object.values(run.agreements)) {
        if (input.agreementId && entry.id !== input.agreementId) continue;
        if (!matches(entry, `${entry.title}\n${entry.content}`)) continue;
        add(entry.seq, entry.id, { kind: 'agreement', agreement: currentAgreement(entry) });
      }
      break;
    case 'attention':
      // Requests stay visible ahead of ordinary updates even after their notification is acknowledged.
      for (const request of Object.values(run.responseRequests)) {
        if (request.status !== 'pending' || (viewer && request.targetWorkerId !== viewer) || !matches(request, '')) continue;
        add(request.seq, request.id, { kind: 'request', request }, '0');
      }
      for (const notification of Object.values(run.notifications)) {
        if ((viewer && notification.workerId !== viewer) || (!input.includeAcknowledged && notification.acknowledgedAt !== null)) continue;
        if (!matches({ channelId: notification.channelId, threadId: notification.threadId ?? undefined,
          taskIds: notification.threadId ? run.threads[notification.threadId]?.taskIds : [] }, notification.reasons.join(' '))) continue;
        add(notification.seq, notification.id, { kind: 'notification', notification }, notification.priority === 'immediate' ? '1' : '2');
      }
      break;
    case 'message_revisions':
      assert(message, 'SWARM_INVALID_INPUT', 'messageId is required for revisions');
      for (const value of [...message.revisions, message]) {
        const { revision, body, mentions, taskIds, findingIds, proposalIds, editedAt } = value;
        add(message.seq, `${message.id}:${numberKey(revision)}`, { kind: 'message_revision', messageId: message.id,
          value: { revision, body, mentions, taskIds, findingIds, proposalIds, editedAt } });
      }
      break;
    case 'agreement_versions':
      assert(agreement, 'SWARM_INVALID_INPUT', 'agreementId is required for versions');
      for (const value of [...agreement.versions, agreement]) {
        const { version, content, sourceMessageIds, taskIds, stakeholderWorkerIds, createdAt } = value;
        add(agreement.seq, `${agreement.id}:${numberKey(version)}`, { kind: 'agreement_version', agreementId: agreement.id,
          value: { version, content, sourceMessageIds, taskIds, stakeholderWorkerIds, createdAt },
          confirmations: agreement.confirmations.filter((confirmation) => confirmation.version === version) });
      }
      break;
  }
  rows.sort((left, right) => left.key.localeCompare(right.key));
  const remaining = rows.filter((row) => row.key > lastKey);
  // Bound payload as well as row count. Records themselves have validated 12k text limits.
  const selected: Row[] = [];
  let bytes = 0;
  for (const row of remaining) {
    const size = JSON.stringify(row.item).length;
    if (selected.length >= input.limit || (selected.length > 0 && bytes + size > 24000)) break;
    selected.push(row); bytes += size;
  }
  const hasMore = selected.length < remaining.length;
  const next: Cursor | null = hasMore && selected.length ? { runId: run.id, filter, upperSeq, lastKey: selected.at(-1)!.key } : null;
  return { runId: run.id, items: selected.map((row) => row.item), total: rows.length, hasMore, truncated: hasMore,
    nextCursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null, snapshotSeq: upperSeq };
}
