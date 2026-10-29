import { z } from 'zod';

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
