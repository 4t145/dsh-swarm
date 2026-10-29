/** Public collaboration records live in the existing run aggregate; no private message migration. */
export interface ChannelRecord {
  id: string;
  name: string;
  purpose: string;
  createdByWorkerId: string | null;
  status: 'active' | 'archived';
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadRecord {
  id: string;
  channelId: string;
  title: string;
  createdByWorkerId: string;
  participantWorkerIds: string[];
  taskIds: string[];
  status: 'open' | 'resolved';
  conclusionMessageId: string | null;
  findingIds: string[];
  revision: number;
  seq: number;
  updatedSeq: number;
  createdAt: number;
  updatedAt: number;
}

export interface PublicMessageRevision {
  revision: number;
  body: string;
  mentions: string[];
  taskIds: string[];
  findingIds: string[];
  proposalIds: string[];
  editedAt: number;
}

export interface PublicMessageRecord extends PublicMessageRevision {
  id: string;
  kind: 'public';
  seq: number;
  updatedSeq: number;
  channelId: string;
  threadId: string;
  replyToMessageId: string | null;
  authorWorkerId: string;
  announcement: boolean;
  createdAt: number;
  /** Previous immutable versions; the current version is on the record. */
  revisions: PublicMessageRevision[];
}

export type NotificationReason = 'mention' | 'response_request' | 'reply' | 'task_owner' |
  'participant' | 'subscription' | 'announcement' | 'agreement_confirmation';

export interface NotificationRecord {
  id: string;
  seq: number;
  workerId: string;
  channelId: string;
  threadId: string | null;
  messageId: string | null;
  requestId: string | null;
  agreementId: string | null;
  reasons: NotificationReason[];
  priority: 'immediate' | 'digest';
  createdAt: number;
  deliveredAt: number | null;
  acknowledgedAt: number | null;
}

export interface SubscriptionRecord {
  id: string;
  workerId: string;
  channelId: string;
  threadId: string | null;
  mode: 'following' | 'muted';
}

/** Explicitly offered FULL message versions, not the global event/summary cursor. */
export interface ChannelReadRecord {
  id: string;
  workerId: string;
  channelId: string;
  offeredMessageRevisions: Record<string, number>;
  readMessageRevisions: Record<string, number>;
}

export interface ResponseRequestRecord {
  id: string;
  seq: number;
  channelId: string;
  threadId: string;
  messageId: string;
  taskIds: string[];
  requestedByWorkerId: string;
  targetWorkerId: string;
  status: 'pending' | 'responded' | 'withdrawn';
  responseMessageId: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgreementVersion {
  version: number;
  content: string;
  sourceMessageIds: string[];
  taskIds: string[];
  stakeholderWorkerIds: string[];
  createdAt: number;
}

export interface AgreementRecord extends AgreementVersion {
  id: string;
  seq: number;
  channelId: string;
  threadId: string;
  title: string;
  createdByWorkerId: string;
  versions: AgreementVersion[];
  /** Versioned confirmations never carry forward to a new version. */
  confirmations: { workerId: string; version: number; confirmedAt: number }[];
}

export interface PublicEvent {
  kind: 'public';
  seq: number;
  createdAt: number;
  authorWorkerId: string | null;
  audience: { kind: 'all' };
  action: 'channel_created' | 'channel_archived' | 'thread_created' | 'thread_updated' |
    'message_posted' | 'message_revised' | 'request_created' | 'request_responded' |
    'request_withdrawn' | 'agreement_created' | 'agreement_revised' | 'agreement_confirmed' | 'finding_linked';
  channelId: string;
  threadId: string | null;
  messageId: string | null;
  requestId: string | null;
  agreementId: string | null;
  notificationIds: string[];
  /** Present on finding_linked; optional only for older public-event records. */
  findingId?: string;
}

export interface PublicState {
  channels: Record<string, ChannelRecord>;
  threads: Record<string, ThreadRecord>;
  publicMessages: Record<string, PublicMessageRecord>;
  notifications: Record<string, NotificationRecord>;
  subscriptions: Record<string, SubscriptionRecord>;
  channelReads: Record<string, ChannelReadRecord>;
  responseRequests: Record<string, ResponseRequestRecord>;
  agreements: Record<string, AgreementRecord>;
}

/** Deterministic migration: creates infrastructure only, never invents historical messages/events. */
export function defaultPublicState(runId: string, createdAt: number): PublicState {
  const id = `${runId}:general`;
  return {
    channels: { [id]: { id, name: 'general', purpose: 'Run-wide public coordination',
      createdByWorkerId: null, status: 'active', revision: 1, createdAt, updatedAt: createdAt } },
    threads: {}, publicMessages: {}, notifications: {}, subscriptions: {}, channelReads: {},
    responseRequests: {}, agreements: {},
  };
}
