import { z } from 'zod';
import type { Run } from './types.ts';

const id = z.string().min(1).max(240);
const seq = z.number().int().nonnegative();
const revision = z.number().int().positive();
const ids = z.array(id).max(100);
const body = z.string().trim().min(1).max(12000);

export const channelRecordSchema = z.strictObject({
  id, name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), purpose: z.string().trim().min(1).max(1000),
  createdByWorkerId: id.nullable(), status: z.enum(['active', 'archived']), revision,
  createdAt: seq, updatedAt: seq,
});
export const threadRecordSchema = z.strictObject({
  id, channelId: id, title: z.string().trim().min(1).max(240), createdByWorkerId: id,
  participantWorkerIds: ids, taskIds: ids, status: z.enum(['open', 'resolved']),
  conclusionMessageId: id.nullable(), findingIds: ids, revision, seq, updatedSeq: seq,
  createdAt: seq, updatedAt: seq,
});
const messageVersionShape = { revision, body, mentions: ids, taskIds: ids, findingIds: ids, proposalIds: ids, editedAt: seq };
export const publicMessageRecordSchema = z.strictObject({
  ...messageVersionShape, id, kind: z.literal('public'), seq, updatedSeq: seq,
  channelId: id, threadId: id, replyToMessageId: id.nullable(), authorWorkerId: id,
  announcement: z.boolean(), createdAt: seq, revisions: z.array(z.strictObject(messageVersionShape)),
});
export const notificationRecordSchema = z.strictObject({
  id, seq, workerId: id, channelId: id, threadId: id.nullable(), messageId: id.nullable(),
  requestId: id.nullable(), agreementId: id.nullable(),
  reasons: z.array(z.enum(['mention', 'response_request', 'reply', 'task_owner', 'participant',
    'subscription', 'announcement', 'agreement_confirmation'])).min(1),
  priority: z.enum(['immediate', 'digest']), createdAt: seq, deliveredAt: seq.nullable(), acknowledgedAt: seq.nullable(),
});
export const subscriptionRecordSchema = z.strictObject({
  id, workerId: id, channelId: id, threadId: id.nullable(), mode: z.enum(['following', 'muted']),
});
export const channelReadRecordSchema = z.strictObject({
  id, workerId: id, channelId: id,
  offeredMessageRevisions: z.record(id, revision), readMessageRevisions: z.record(id, revision),
});
export const responseRequestRecordSchema = z.strictObject({
  id, seq, channelId: id, threadId: id, messageId: id, taskIds: ids, requestedByWorkerId: id,
  targetWorkerId: id, status: z.enum(['pending', 'responded', 'withdrawn']), responseMessageId: id.nullable(),
  revision, createdAt: seq, updatedAt: seq,
});
const agreementVersionShape = {
  version: revision, content: body, sourceMessageIds: ids.min(1), taskIds: ids,
  stakeholderWorkerIds: ids.min(1), createdAt: seq,
};
export const agreementRecordSchema = z.strictObject({
  ...agreementVersionShape, id, seq, channelId: id, threadId: id, title: z.string().trim().min(1).max(240),
  createdByWorkerId: id, versions: z.array(z.strictObject(agreementVersionShape)),
  confirmations: z.array(z.strictObject({ workerId: id, version: revision, confirmedAt: seq })),
});
export const publicEventSchema = z.strictObject({
  kind: z.literal('public'), seq, createdAt: seq, authorWorkerId: id.nullable(),
  audience: z.strictObject({ kind: z.literal('all') }),
  action: z.enum(['channel_created', 'channel_archived', 'thread_created', 'thread_updated',
    'message_posted', 'message_revised', 'request_created', 'request_responded', 'request_withdrawn',
    'agreement_created', 'agreement_revised', 'agreement_confirmed', 'finding_linked']),
  channelId: id, threadId: id.nullable(), messageId: id.nullable(), requestId: id.nullable(),
  agreementId: id.nullable(), notificationIds: ids,
});

/** Validate same-aggregate graph edges at the persistence boundary, including legacy/private separation. */
export function publicReferenceIssues(run: Run): { path: string[]; message: string }[] {
  const issues: { path: string[]; message: string }[] = [];
  const ref = (map: object, id: string | null, path: string[]): void => {
    if (id !== null && !Object.hasOwn(map, id)) issues.push({ path, message: `Missing same-run public reference: ${id}` });
  };
  const threadRef = (channelId: string, threadId: string, path: string[]): void => {
    ref(run.channels, channelId, path); ref(run.threads, threadId, path);
    if (run.threads[threadId] && run.threads[threadId]!.channelId !== channelId) issues.push({ path, message: 'Thread/channel mismatch' });
  };
  const messageRef = (messageId: string | null, threadId: string, path: string[]): void => {
    ref(run.publicMessages, messageId, path);
    if (messageId && run.publicMessages[messageId] && run.publicMessages[messageId]!.threadId !== threadId) issues.push({ path, message: 'Message/thread mismatch' });
  };
  for (const channel of Object.values(run.channels)) ref(run.workers, channel.createdByWorkerId, ['channels', channel.id]);
  for (const thread of Object.values(run.threads)) {
    const path = ['threads', thread.id];
    ref(run.channels, thread.channelId, path); ref(run.workers, thread.createdByWorkerId, path);
    for (const id of thread.participantWorkerIds) ref(run.workers, id, path);
    for (const id of thread.taskIds) ref(run.tasks, id, path);
    for (const id of thread.findingIds) ref(run.findings, id, path);
    messageRef(thread.conclusionMessageId, thread.id, path);
  }
  for (const message of Object.values(run.publicMessages)) {
    const path = ['publicMessages', message.id];
    threadRef(message.channelId, message.threadId, path); ref(run.workers, message.authorWorkerId, path);
    messageRef(message.replyToMessageId, message.threadId, path);
    for (const version of [...message.revisions, message]) {
      for (const id of version.mentions) ref(run.workers, id, path);
      for (const id of version.taskIds) ref(run.tasks, id, path);
      for (const id of version.findingIds) ref(run.findings, id, path);
      for (const id of version.proposalIds) ref(run.proposals, id, path);
    }
  }
  for (const request of Object.values(run.responseRequests)) {
    const path = ['responseRequests', request.id];
    threadRef(request.channelId, request.threadId, path);
    messageRef(request.messageId, request.threadId, path); messageRef(request.responseMessageId, request.threadId, path);
    ref(run.workers, request.targetWorkerId, path); ref(run.workers, request.requestedByWorkerId, path);
    for (const id of request.taskIds) ref(run.tasks, id, path);
  }
  for (const agreement of Object.values(run.agreements)) {
    const path = ['agreements', agreement.id];
    threadRef(agreement.channelId, agreement.threadId, path); ref(run.workers, agreement.createdByWorkerId, path);
    for (const version of [...agreement.versions, agreement]) {
      for (const id of version.sourceMessageIds) messageRef(id, agreement.threadId, path);
      for (const id of version.taskIds) ref(run.tasks, id, path);
      for (const id of version.stakeholderWorkerIds) ref(run.workers, id, path);
    }
    for (const confirmation of agreement.confirmations) {
      ref(run.workers, confirmation.workerId, path);
      const version = confirmation.version === agreement.version ? agreement : agreement.versions.find((record) => record.version === confirmation.version);
      if (!version?.stakeholderWorkerIds.includes(confirmation.workerId)) issues.push({ path, message: 'Confirmation does not match a stakeholder/version' });
    }
  }
  for (const subscription of Object.values(run.subscriptions)) {
    const path = ['subscriptions', subscription.id];
    ref(run.workers, subscription.workerId, path); ref(run.channels, subscription.channelId, path);
    if (subscription.threadId) threadRef(subscription.channelId, subscription.threadId, path);
  }
  for (const read of Object.values(run.channelReads)) {
    const path = ['channelReads', read.id];
    ref(run.workers, read.workerId, path); ref(run.channels, read.channelId, path);
    for (const [id, revision] of Object.entries(read.offeredMessageRevisions)) {
      ref(run.publicMessages, id, path);
      const message = run.publicMessages[id];
      if (message && (message.channelId !== read.channelId || revision > message.revision)) issues.push({ path, message: 'Invalid offered message version' });
    }
    for (const [id, revision] of Object.entries(read.readMessageRevisions)) if ((read.offeredMessageRevisions[id] ?? 0) < revision) issues.push({ path, message: 'Read version exceeds offered version' });
  }
  for (const notice of Object.values(run.notifications)) {
    const path = ['notifications', notice.id];
    ref(run.workers, notice.workerId, path); ref(run.channels, notice.channelId, path);
    if (notice.threadId) {
      threadRef(notice.channelId, notice.threadId, path); messageRef(notice.messageId, notice.threadId, path);
    }
    ref(run.responseRequests, notice.requestId, path); ref(run.agreements, notice.agreementId, path);
  }
  for (const event of run.events) if (event.kind === 'public') {
    const path = ['events', String(event.seq)];
    ref(run.channels, event.channelId, path);
    if (event.threadId) { threadRef(event.channelId, event.threadId, path); messageRef(event.messageId, event.threadId, path); }
    ref(run.responseRequests, event.requestId, path); ref(run.agreements, event.agreementId, path);
    for (const id of event.notificationIds) ref(run.notifications, id, path);
  }
  return issues;
}

export const publicStateShape = {
  channels: z.record(z.string(), channelRecordSchema).default({}),
  threads: z.record(z.string(), threadRecordSchema).default({}),
  publicMessages: z.record(z.string(), publicMessageRecordSchema).default({}),
  notifications: z.record(z.string(), notificationRecordSchema).default({}),
  subscriptions: z.record(z.string(), subscriptionRecordSchema).default({}),
  channelReads: z.record(z.string(), channelReadRecordSchema).default({}),
  responseRequests: z.record(z.string(), responseRequestRecordSchema).default({}),
  agreements: z.record(z.string(), agreementRecordSchema).default({}),
};
