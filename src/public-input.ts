import { z } from 'zod';

const id = z.string().trim().min(1).max(240);
const ids = z.array(id).max(100).default([]);
const revision = z.number().int().positive();
const body = z.string().trim().min(1).max(12000);
const title = z.string().trim().min(1).max(240);
const messageFields = { body, mentions: ids, taskIds: ids, findingIds: ids, proposalIds: ids };
const agreementFields = { content: body, sourceMessageIds: z.array(id).min(1).max(100), taskIds: ids,
  stakeholderWorkerIds: z.array(id).min(1).max(100) };

/** Shared by worker tools and the domain boundary; no caller-supplied identity. */
export const publicCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create_channel'), name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), purpose: z.string().trim().min(1).max(1000) }),
  z.strictObject({ action: z.literal('archive_channel'), channelId: id, expectedRevision: revision }),
  z.strictObject({ action: z.literal('create_thread'), channelId: id, title, taskIds: ids }),
  z.strictObject({ action: z.literal('update_thread'), threadId: id, expectedRevision: revision,
    title: title.optional(), taskIds: z.array(id).max(100).optional(), status: z.enum(['open', 'resolved']).optional(), conclusionMessageId: id.nullable().optional() }),
  z.strictObject({ action: z.literal('post'), threadId: id, replyToMessageId: id.optional(),
    ...messageFields, announcement: z.boolean().default(false), responseRequestedFrom: ids }),
  z.strictObject({ action: z.literal('revise_message'), messageId: id, expectedRevision: revision, ...messageFields }),
  z.strictObject({ action: z.literal('subscribe'), channelId: id, threadId: id.optional(), mode: z.enum(['following', 'muted']) }),
  z.strictObject({ action: z.literal('request_response'), messageId: id, targetWorkerId: id, taskIds: ids }),
  z.strictObject({ action: z.literal('respond'), requestId: id, expectedRevision: revision, responseMessageId: id }),
  z.strictObject({ action: z.literal('withdraw_request'), requestId: id, expectedRevision: revision }),
  z.strictObject({ action: z.literal('create_agreement'), threadId: id, title, ...agreementFields }),
  z.strictObject({ action: z.literal('revise_agreement'), agreementId: id, expectedVersion: revision, ...agreementFields }),
  z.strictObject({ action: z.literal('confirm_agreement'), agreementId: id, version: revision }),
  z.strictObject({ action: z.literal('link_finding'), threadId: id, findingId: id, messageId: id.optional(), expectedRevision: revision }),
  z.strictObject({ action: z.literal('ack_notifications'), notificationIds: z.array(id).min(1).max(100) }),
  z.strictObject({ action: z.literal('mark_read'), channelId: id,
    messages: z.array(z.strictObject({ messageId: id, revision })).min(1).max(20) }),
]);
export type PublicCommand = z.input<typeof publicCommandSchema>;
export type ParsedPublicCommand = z.output<typeof publicCommandSchema>;

export const publicQuerySchema = z.strictObject({
  view: z.enum(['channels', 'threads', 'messages', 'requests', 'agreements', 'attention', 'activity', 'message_revisions', 'agreement_versions']),
  channelId: id.optional(), threadId: id.optional(), taskId: id.optional(), messageId: id.optional(),
  agreementId: id.optional(), findingId: id.optional(), workerId: id.optional(),
  query: z.string().trim().max(200).optional(), status: z.enum(['active', 'archived', 'open', 'resolved', 'pending', 'responded', 'withdrawn']).optional(),
  cursor: z.string().max(2000).optional(), limit: z.number().int().min(1).max(20).default(20),
  includeAcknowledged: z.boolean().default(false),
});
export type PublicQuery = z.input<typeof publicQuerySchema>;
export type ParsedPublicQuery = z.output<typeof publicQuerySchema>;
