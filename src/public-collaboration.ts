/** Atomic public collaboration business API. All writes share the existing run store/receipt queue. */
import { randomUUID } from 'node:crypto';
import { assert, SwarmError } from './errors.ts';
import { appendEvent } from './events.ts';
import { publicCommandSchema, publicQuerySchema, type PublicCommand, type ParsedPublicCommand, type PublicQuery } from './public-input.ts';
import { buildPublicPage, type PublicPage } from './public-query.ts';
import type { StateStore } from './store.ts';
import type { Run, WorkerRecord } from './types.ts';
import type { AgreementRecord, AgreementVersion, ChannelReadRecord, ChannelRecord, NotificationReason,
  PublicEvent, PublicMessageRecord, PublicMessageRevision, ResponseRequestRecord, SubscriptionRecord, ThreadRecord } from './public-types.ts';

export type PublicMutationResult = ChannelRecord | ThreadRecord | PublicMessageRecord | SubscriptionRecord |
  ResponseRequestRecord | AgreementRecord | ChannelReadRecord | { acknowledgedIds: string[] };
type Context = { run: Run; worker: WorkerRecord; now: number };
const distinct = (values: string[]): string[] => [...new Set(values)];

/** Reads only own-property IDs: strings such as __proto__ cannot resolve inherited objects. */
export function publicRecord<T>(map: Record<string, T>, id: string, label: string): T {
  assert(Object.hasOwn(map, id), 'SWARM_NOT_FOUND', `${label} ${id} not found in this run`);
  return map[id]!;
}
function cas(actual: number, expected: number): void {
  assert(actual === expected, 'SWARM_STALE_REVISION', `Expected revision ${expected}; current revision is ${actual}`);
}
function messageVersion(message: PublicMessageRecord): PublicMessageRevision {
  const { revision, body, mentions, taskIds, findingIds, proposalIds, editedAt } = message;
  return { revision, body, mentions: [...mentions], taskIds: [...taskIds], findingIds: [...findingIds], proposalIds: [...proposalIds], editedAt };
}
function agreementVersion(agreement: AgreementRecord): AgreementVersion {
  const { version, content, sourceMessageIds, taskIds, stakeholderWorkerIds, createdAt } = agreement;
  return { version, content, sourceMessageIds: [...sourceMessageIds], taskIds: [...taskIds], stakeholderWorkerIds: [...stakeholderWorkerIds], createdAt };
}

export class PublicCollaboration {
  private readonly now: () => number;
  private readonly id: () => string;
  constructor(private readonly store: StateStore, options: { now?: () => number; id?: () => string } = {}) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
  }

  /** Identity comes from the actual exec.agent session; repeats return the original receipt even after pause. */
  async execute(sessionId: string, input: PublicCommand, callId: string): Promise<PublicMutationResult> {
    const parsed = publicCommandSchema.safeParse(input);
    assert(parsed.success, 'SWARM_INVALID_INPUT', parsed.error?.message ?? 'Invalid public command');
    assert(typeof callId === 'string' && callId.length > 0, 'SWARM_INVALID_INPUT', 'callId is required');
    const identity = this.identity(sessionId);
    const command = parsed.data;
    const method = `public:${command.action}`;
    const key = `${sessionId}:${callId}`;
    const persisted = await this.store.update(identity.run.id, (run) => {
      const worker = publicRecord(run.workers, identity.worker.id, 'worker');
      assert(worker.sessionId === sessionId, 'SWARM_FORBIDDEN', 'Session is not this run member');
      const prior = run.mutationReceipts[key];
      if (prior) {
        assert(prior.method === method, 'SWARM_INVALID_INPUT', 'Tool call ID was already used for a different mutation');
        return run;
      }
      const now = this.now();
      if (command.action !== 'mark_read' && command.action !== 'ack_notifications') {
        assert(run.phase === 'running', 'SWARM_NOT_RUNNING', `Public mutation requires running; current phase is ${run.phase}`);
        assert(run.deadline === null || now < run.deadline, 'SWARM_BUDGET_EXHAUSTED', 'Run budget exhausted');
      }
      const result = this.apply({ run, worker, now }, command);
      run.mutationReceipts[key] = { key, workerSessionId: sessionId, toolCallId: callId, method, result: JSON.stringify(result), createdAt: now };
      run.revision++;
      run.updatedAt = now;
      return run;
    });
    const receipt = persisted.mutationReceipts[key]!;
    assert(typeof receipt.result === 'string', 'SWARM_STORE_CORRUPT', 'Invalid public mutation receipt');
    return JSON.parse(receipt.result) as PublicMutationResult;
  }

  /** Public history is visible to every member; full current message reads separately record offered versions. */
  async query(sessionId: string, input: PublicQuery): Promise<PublicPage> {
    const identity = this.identity(sessionId);
    const parsed = publicQuerySchema.safeParse(input);
    assert(parsed.success, 'SWARM_INVALID_INPUT', parsed.error?.message ?? 'Invalid public query');
    assert(parsed.data.workerId === undefined || parsed.data.workerId === identity.worker.id,
      'SWARM_FORBIDDEN', 'Personal attention belongs to the current worker');
    const page = buildPublicPage(identity.run, parsed.data, identity.worker.id);
    const messages = page.items.flatMap((item) => item.kind === 'message' ? [item.message] : []);
    if (messages.length) await this.store.update(identity.run.id, (run) => {
      for (const message of messages) {
        const read = this.readState(run, identity.worker.id, message.channelId);
        read.offeredMessageRevisions[message.id] = Math.max(read.offeredMessageRevisions[message.id] ?? 0, message.revision);
      }
      return run;
    });
    return page;
  }

  /** Owner-only on-demand surface; never exposes legacy private messages or changes worker read cursors. */
  queryForOwner(ownerSessionId: string, runId: string, input: PublicQuery): PublicPage {
    const run = this.store.get(runId);
    assert(run.ownerSessionId === ownerSessionId, 'SWARM_FORBIDDEN', 'Only the original owner can inspect public collaboration');
    const parsed = publicQuerySchema.safeParse(input);
    assert(parsed.success, 'SWARM_INVALID_INPUT', parsed.error?.message ?? 'Invalid public query');
    return buildPublicPage(run, parsed.data, null);
  }

  private identity(sessionId: string): { run: Run; worker: WorkerRecord } {
    for (const run of this.store.list()) {
      const worker = Object.values(run.workers).find((candidate) => candidate.sessionId === sessionId);
      if (worker) return { run, worker };
    }
    throw new SwarmError('SWARM_FORBIDDEN', 'Session is not a Swarm worker');
  }

  private channel(run: Run, channelId: string): ChannelRecord {
    const channel = publicRecord(run.channels, channelId, 'channel');
    assert(channel.status === 'active', 'SWARM_INVALID_STATE', 'Archived channels retain history but reject discussion mutations');
    return channel;
  }
  private thread(run: Run, threadId: string): ThreadRecord {
    const thread = publicRecord(run.threads, threadId, 'thread');
    this.channel(run, thread.channelId);
    return thread;
  }
  private refs(run: Run, input: { mentions?: string[]; taskIds?: string[]; findingIds?: string[]; proposalIds?: string[] }): void {
    for (const id of input.mentions ?? []) publicRecord(run.workers, id, 'mention worker');
    for (const id of input.taskIds ?? []) publicRecord(run.tasks, id, 'task');
    for (const id of input.findingIds ?? []) publicRecord(run.findings, id, 'finding');
    for (const id of input.proposalIds ?? []) publicRecord(run.proposals, id, 'proposal');
  }
  private emit(ctx: Context, action: PublicEvent['action'], channelId: string,
    refs: Partial<Pick<PublicEvent, 'threadId' | 'messageId' | 'requestId' | 'agreementId'>> = {}, notificationIds: string[] = []): void {
    appendEvent(ctx.run, { kind: 'public', action, authorWorkerId: ctx.worker.id, audience: { kind: 'all' },
      channelId, threadId: refs.threadId ?? null, messageId: refs.messageId ?? null,
      requestId: refs.requestId ?? null, agreementId: refs.agreementId ?? null, notificationIds }, ctx.now);
  }
  private notify(ctx: Context, channelId: string, threadId: string | null, workerId: string,
    reasons: NotificationReason[], refs: { messageId?: string; requestId?: string; agreementId?: string } = {}): string | null {
    if (workerId === ctx.worker.id) return null;
    const priority = reasons.some((reason) => ['mention', 'response_request', 'reply', 'announcement', 'agreement_confirmation'].includes(reason)) ? 'immediate' : 'digest';
    const previous = priority === 'digest' ? Object.values(ctx.run.notifications).find((notice) =>
      notice.workerId === workerId && notice.threadId === threadId && notice.channelId === channelId &&
      notice.priority === 'digest' && notice.acknowledgedAt === null) : undefined;
    if (previous) {
      previous.seq = ctx.run.nextSeq;
      previous.messageId = refs.messageId ?? null;
      previous.reasons = distinct([...previous.reasons, ...reasons]) as NotificationReason[];
      previous.deliveredAt = null;
      return previous.id;
    }
    const id = this.id();
    ctx.run.notifications[id] = { id, seq: ctx.run.nextSeq, workerId, channelId, threadId,
      messageId: refs.messageId ?? null, requestId: refs.requestId ?? null, agreementId: refs.agreementId ?? null,
      reasons: [...new Set(reasons)], priority, createdAt: ctx.now, deliveredAt: null, acknowledgedAt: null };
    return id;
  }
  private notifyThread(ctx: Context, thread: ThreadRecord): string[] {
    const notices: string[] = [];
    for (const worker of Object.values(ctx.run.workers)) {
      const reasons: NotificationReason[] = [];
      if (thread.taskIds.some((id) => ctx.run.tasks[id]?.ownerWorkerId === worker.id)) reasons.push('task_owner');
      const subscriptions = Object.values(ctx.run.subscriptions).filter((sub) => sub.workerId === worker.id && sub.channelId === thread.channelId);
      const effective = subscriptions.find((sub) => sub.threadId === thread.id) ?? subscriptions.find((sub) => sub.threadId === null);
      if (effective?.mode === 'following') reasons.push('subscription');
      if (effective?.mode !== 'muted' && thread.participantWorkerIds.includes(worker.id)) reasons.push('participant');
      if (reasons.length) {
        const id = this.notify(ctx, thread.channelId, thread.id, worker.id, reasons);
        if (id) notices.push(id);
      }
    }
    return notices;
  }
  private notifyMessage(ctx: Context, message: PublicMessageRecord, thread: ThreadRecord): string[] {
    const notices: string[] = [];
    for (const worker of Object.values(ctx.run.workers)) {
      const reasons: NotificationReason[] = [];
      if (message.mentions.includes(worker.id)) reasons.push('mention');
      if (message.announcement) reasons.push('announcement');
      if (message.replyToMessageId && ctx.run.publicMessages[message.replyToMessageId]?.authorWorkerId === worker.id) reasons.push('reply');
      if (distinct([...thread.taskIds, ...message.taskIds]).some((id) => ctx.run.tasks[id]?.ownerWorkerId === worker.id)) reasons.push('task_owner');
      const subscriptions = Object.values(ctx.run.subscriptions).filter((sub) => sub.workerId === worker.id && sub.channelId === message.channelId);
      const effective = subscriptions.find((sub) => sub.threadId === thread.id) ?? subscriptions.find((sub) => sub.threadId === null);
      if (effective?.mode === 'following') reasons.push('subscription');
      if (effective?.mode !== 'muted' && thread.participantWorkerIds.includes(worker.id)) reasons.push('participant');
      if (reasons.length) {
        const id = this.notify(ctx, message.channelId, thread.id, worker.id, reasons, { messageId: message.id });
        if (id) notices.push(id);
      }
    }
    return notices;
  }
  private request(ctx: Context, message: PublicMessageRecord, targetWorkerId: string, taskIds: string[]): ResponseRequestRecord {
    publicRecord(ctx.run.workers, targetWorkerId, 'request target');
    this.refs(ctx.run, { taskIds });
    assert(targetWorkerId !== ctx.worker.id, 'SWARM_INVALID_INPUT', 'Cannot request a response from yourself');
    const request: ResponseRequestRecord = { id: this.id(), seq: ctx.run.nextSeq, channelId: message.channelId,
      threadId: message.threadId, messageId: message.id, taskIds: distinct(taskIds), requestedByWorkerId: ctx.worker.id,
      targetWorkerId, status: 'pending', responseMessageId: null, revision: 1, createdAt: ctx.now, updatedAt: ctx.now };
    ctx.run.responseRequests[request.id] = request;
    const notice = this.notify(ctx, message.channelId, message.threadId, targetWorkerId, ['response_request'], { messageId: message.id, requestId: request.id });
    this.emit(ctx, 'request_created', message.channelId, { threadId: message.threadId, messageId: message.id, requestId: request.id }, notice ? [notice] : []);
    return request;
  }
  private readState(run: Run, workerId: string, channelId: string): ChannelReadRecord {
    const id = JSON.stringify([workerId, channelId]);
    return run.channelReads[id] ??= { id, workerId, channelId, offeredMessageRevisions: {}, readMessageRevisions: {} };
  }
  private agreementRefs(run: Run, thread: ThreadRecord, input: { sourceMessageIds: string[]; taskIds: string[]; stakeholderWorkerIds: string[] }): void {
    this.refs(run, { taskIds: input.taskIds, mentions: input.stakeholderWorkerIds });
    for (const id of input.sourceMessageIds) {
      const message = publicRecord(run.publicMessages, id, 'public source message');
      assert(message.threadId === thread.id, 'SWARM_INVALID_INPUT', 'Agreement sources must belong to its thread');
    }
  }
  private notifyAgreement(ctx: Context, agreement: AgreementRecord): string[] {
    return agreement.stakeholderWorkerIds.flatMap((workerId) => {
      const id = this.notify(ctx, agreement.channelId, agreement.threadId, workerId, ['agreement_confirmation'], { agreementId: agreement.id });
      return id ? [id] : [];
    });
  }

  private apply(ctx: Context, input: ParsedPublicCommand): PublicMutationResult {
    const { run, worker, now } = ctx;
    switch (input.action) {
      case 'create_channel': {
        assert(!Object.values(run.channels).some((channel) => channel.name === input.name), 'SWARM_ALREADY_EXISTS', 'Channel name already exists, including archived names');
        const channel: ChannelRecord = { id: this.id(), name: input.name, purpose: input.purpose, createdByWorkerId: worker.id,
          status: 'active', revision: 1, createdAt: now, updatedAt: now };
        run.channels[channel.id] = channel;
        this.emit(ctx, 'channel_created', channel.id);
        return channel;
      }
      case 'archive_channel': {
        const channel = this.channel(run, input.channelId);
        assert(channel.createdByWorkerId === worker.id, 'SWARM_FORBIDDEN', 'Only the channel creator can archive it; general is permanent');
        cas(channel.revision, input.expectedRevision);
        channel.status = 'archived'; channel.revision++; channel.updatedAt = now;
        this.emit(ctx, 'channel_archived', channel.id);
        return channel;
      }
      case 'create_thread': {
        this.channel(run, input.channelId); this.refs(run, input);
        const thread: ThreadRecord = { id: this.id(), channelId: input.channelId, title: input.title, createdByWorkerId: worker.id,
          participantWorkerIds: [worker.id], taskIds: distinct(input.taskIds), status: 'open', conclusionMessageId: null,
          findingIds: [], revision: 1, seq: run.nextSeq, updatedSeq: run.nextSeq, createdAt: now, updatedAt: now };
        run.threads[thread.id] = thread;
        this.emit(ctx, 'thread_created', thread.channelId, { threadId: thread.id }, this.notifyThread(ctx, thread));
        return thread;
      }
      case 'update_thread': {
        const thread = this.thread(run, input.threadId);
        assert(thread.createdByWorkerId === worker.id, 'SWARM_FORBIDDEN', 'Only thread creator can change thread metadata');
        cas(thread.revision, input.expectedRevision); this.refs(run, input);
        if (input.conclusionMessageId) {
          const conclusion = publicRecord(run.publicMessages, input.conclusionMessageId, 'conclusion');
          assert(conclusion.threadId === thread.id, 'SWARM_INVALID_INPUT', 'Conclusion must belong to this thread');
        }
        if (input.title !== undefined) thread.title = input.title;
        if (input.taskIds !== undefined) thread.taskIds = distinct(input.taskIds);
        if (input.status !== undefined) thread.status = input.status;
        if (input.conclusionMessageId !== undefined) thread.conclusionMessageId = input.conclusionMessageId;
        thread.revision++; thread.updatedAt = now; thread.updatedSeq = run.nextSeq;
        this.emit(ctx, 'thread_updated', thread.channelId, { threadId: thread.id }, this.notifyThread(ctx, thread));
        return thread;
      }
      case 'post': {
        const thread = this.thread(run, input.threadId); this.refs(run, input);
        if (input.replyToMessageId) {
          const parent = publicRecord(run.publicMessages, input.replyToMessageId, 'public reply parent');
          assert(parent.threadId === thread.id, 'SWARM_INVALID_INPUT', 'Reply parent must belong to this thread');
        }
        const message: PublicMessageRecord = { id: this.id(), kind: 'public', seq: run.nextSeq, updatedSeq: run.nextSeq,
          channelId: thread.channelId, threadId: thread.id, replyToMessageId: input.replyToMessageId ?? null,
          authorWorkerId: worker.id, announcement: input.announcement, createdAt: now, editedAt: now, revision: 1,
          body: input.body, mentions: distinct(input.mentions), taskIds: distinct(input.taskIds), findingIds: distinct(input.findingIds),
          proposalIds: distinct(input.proposalIds), revisions: [] };
        run.publicMessages[message.id] = message;
        thread.participantWorkerIds = distinct([...thread.participantWorkerIds, worker.id]);
        thread.updatedAt = now; thread.updatedSeq = run.nextSeq;
        this.emit(ctx, 'message_posted', thread.channelId, { threadId: thread.id, messageId: message.id }, this.notifyMessage(ctx, message, thread));
        for (const target of distinct(input.responseRequestedFrom)) this.request(ctx, message, target, distinct([...thread.taskIds, ...message.taskIds]));
        return message;
      }
      case 'revise_message': {
        const message = publicRecord(run.publicMessages, input.messageId, 'public message');
        const thread = this.thread(run, message.threadId);
        assert(message.authorWorkerId === worker.id, 'SWARM_FORBIDDEN', 'Only message author can revise it');
        cas(message.revision, input.expectedRevision); this.refs(run, input);
        message.revisions.push(messageVersion(message));
        message.revision++; message.body = input.body; message.mentions = distinct(input.mentions);
        message.taskIds = distinct(input.taskIds); message.findingIds = distinct(input.findingIds); message.proposalIds = distinct(input.proposalIds);
        message.editedAt = now; message.updatedSeq = run.nextSeq;
        thread.updatedAt = now; thread.updatedSeq = run.nextSeq;
        this.emit(ctx, 'message_revised', message.channelId, { threadId: message.threadId, messageId: message.id }, this.notifyMessage(ctx, message, thread));
        return { ...message, revisions: message.revisions.slice(-1) };
      }
      case 'subscribe': {
        this.channel(run, input.channelId);
        if (input.threadId) assert(this.thread(run, input.threadId).channelId === input.channelId, 'SWARM_INVALID_INPUT', 'Thread belongs to another channel');
        const id = JSON.stringify([worker.id, input.channelId, input.threadId ?? null]);
        const subscription: SubscriptionRecord = { id, workerId: worker.id, channelId: input.channelId, threadId: input.threadId ?? null, mode: input.mode };
        run.subscriptions[id] = subscription;
        return subscription;
      }
      case 'request_response': {
        const message = publicRecord(run.publicMessages, input.messageId, 'public message');
        this.thread(run, message.threadId);
        return this.request(ctx, message, input.targetWorkerId, input.taskIds);
      }
      case 'respond':
      case 'withdraw_request': {
        const request = publicRecord(run.responseRequests, input.requestId, 'response request');
        this.thread(run, request.threadId);
        cas(request.revision, input.expectedRevision);
        assert(request.status === 'pending', 'SWARM_INVALID_STATE', 'Only pending requests can be answered or withdrawn');
        if (input.action === 'respond') {
          assert(request.targetWorkerId === worker.id, 'SWARM_FORBIDDEN', 'Only the requested worker can respond');
          const response = publicRecord(run.publicMessages, input.responseMessageId, 'response message');
          assert(response.authorWorkerId === worker.id && response.threadId === request.threadId, 'SWARM_FORBIDDEN', 'Response must be your own message in this thread');
          request.status = 'responded'; request.responseMessageId = response.id;
        } else {
          assert(request.requestedByWorkerId === worker.id, 'SWARM_FORBIDDEN', 'Only requester can withdraw');
          request.status = 'withdrawn';
        }
        request.revision++; request.updatedAt = now;
        const notice = input.action === 'respond' ? this.notify(ctx, request.channelId, request.threadId, request.requestedByWorkerId,
          ['reply'], { messageId: request.responseMessageId!, requestId: request.id }) : null;
        this.emit(ctx, input.action === 'respond' ? 'request_responded' : 'request_withdrawn', request.channelId,
          { threadId: request.threadId, messageId: request.responseMessageId ?? request.messageId, requestId: request.id }, notice ? [notice] : []);
        return request;
      }
      case 'create_agreement': {
        const thread = this.thread(run, input.threadId); this.agreementRefs(run, thread, input);
        const agreement: AgreementRecord = { id: this.id(), seq: run.nextSeq, channelId: thread.channelId, threadId: thread.id,
          title: input.title, createdByWorkerId: worker.id, version: 1, content: input.content,
          sourceMessageIds: distinct(input.sourceMessageIds), taskIds: distinct(input.taskIds), stakeholderWorkerIds: distinct(input.stakeholderWorkerIds),
          createdAt: now, versions: [], confirmations: [] };
        run.agreements[agreement.id] = agreement;
        this.emit(ctx, 'agreement_created', thread.channelId, { threadId: thread.id, agreementId: agreement.id }, this.notifyAgreement(ctx, agreement));
        return agreement;
      }
      case 'revise_agreement': {
        const agreement = publicRecord(run.agreements, input.agreementId, 'agreement');
        const thread = this.thread(run, agreement.threadId);
        assert(agreement.createdByWorkerId === worker.id, 'SWARM_FORBIDDEN', 'Only agreement creator can revise');
        cas(agreement.version, input.expectedVersion); this.agreementRefs(run, thread, input);
        agreement.versions.push(agreementVersion(agreement)); agreement.version++;
        agreement.content = input.content; agreement.sourceMessageIds = distinct(input.sourceMessageIds);
        agreement.taskIds = distinct(input.taskIds); agreement.stakeholderWorkerIds = distinct(input.stakeholderWorkerIds); agreement.createdAt = now;
        this.emit(ctx, 'agreement_revised', agreement.channelId, { threadId: agreement.threadId, agreementId: agreement.id }, this.notifyAgreement(ctx, agreement));
        return { ...agreement, versions: agreement.versions.slice(-1), confirmations: agreement.confirmations.filter((confirmation) => confirmation.version === agreement.version) };
      }
      case 'confirm_agreement': {
        const agreement = publicRecord(run.agreements, input.agreementId, 'agreement');
        this.thread(run, agreement.threadId); cas(agreement.version, input.version);
        assert(agreement.stakeholderWorkerIds.includes(worker.id), 'SWARM_FORBIDDEN', 'Only listed stakeholders can confirm');
        if (!agreement.confirmations.some((confirmation) => confirmation.workerId === worker.id && confirmation.version === input.version)) {
          agreement.confirmations.push({ workerId: worker.id, version: input.version, confirmedAt: now });
          this.emit(ctx, 'agreement_confirmed', agreement.channelId, { threadId: agreement.threadId, agreementId: agreement.id });
        }
        return { ...agreement, versions: [], confirmations: agreement.confirmations.filter((confirmation) => confirmation.version === agreement.version) };
      }
      case 'link_finding': {
        const thread = this.thread(run, input.threadId); cas(thread.revision, input.expectedRevision);
        publicRecord(run.findings, input.findingId, 'finding');
        if (input.messageId) assert(publicRecord(run.publicMessages, input.messageId, 'public source').threadId === thread.id, 'SWARM_INVALID_INPUT', 'Source must belong to thread');
        thread.findingIds = distinct([...thread.findingIds, input.findingId]); thread.revision++;
        thread.updatedAt = now; thread.updatedSeq = run.nextSeq;
        this.emit(ctx, 'finding_linked', thread.channelId, { threadId: thread.id, messageId: input.messageId }, this.notifyThread(ctx, thread));
        return thread;
      }
      case 'ack_notifications': {
        for (const id of distinct(input.notificationIds)) {
          const notice = publicRecord(run.notifications, id, 'notification');
          assert(notice.workerId === worker.id, 'SWARM_FORBIDDEN', 'Cannot acknowledge another worker notification');
          notice.acknowledgedAt ??= now;
        }
        return { acknowledgedIds: distinct(input.notificationIds) };
      }
      case 'mark_read': {
        publicRecord(run.channels, input.channelId, 'channel');
        const read = this.readState(run, worker.id, input.channelId);
        for (const item of input.messages) {
          const message = publicRecord(run.publicMessages, item.messageId, 'message');
          assert(message.channelId === input.channelId, 'SWARM_INVALID_INPUT', 'Message belongs to another channel');
          assert(read.offeredMessageRevisions[message.id] === item.revision, 'SWARM_INVALID_CURSOR', 'Confirm the exact full message version most recently offered to this worker');
          read.readMessageRevisions[message.id] = Math.max(read.readMessageRevisions[message.id] ?? 0, item.revision);
        }
        return { ...read, offeredMessageRevisions: Object.fromEntries(input.messages.map((item) => [item.messageId, read.offeredMessageRevisions[item.messageId]!])),
          readMessageRevisions: Object.fromEntries(input.messages.map((item) => [item.messageId, read.readMessageRevisions[item.messageId]!])) };
      }
    }
  }
}
