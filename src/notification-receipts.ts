/** Technical display receipts: evidence comes from logged content, never from model-authored ACKs. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createUserMessage, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { JsonValue } from './types.ts';

const seq = z.number().int().nonnegative();
const id = z.string().min(1);
const reference = z.object({ id, seq });
const messageVersion = z.object({ id, channelId: id, revision: z.number().int().positive() });
export const shownReceiptSchema = z.object({
  runId: id,
  ranges: z.array(z.object({ from: seq, through: seq }).refine((range) => range.from <= range.through)),
  notifications: z.array(reference),
  messages: z.array(messageVersion),
});
export type ShownReceipt = z.infer<typeof shownReceiptSchema>;
const proofSchema = z.object({ version: z.literal(1), digest: z.string(), receipt: shownReceiptSchema });
type ReceiptProof = z.infer<typeof proofSchema>;

// This is a producer-owned MessageSource, NOT a new SessionEvent type.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'swarm-context': { kind: 'swarm-context'; proof: ReceiptProof };
  }
}

function digest(content: readonly ContentBlock[]): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
function proof(receipt: ShownReceipt, content: readonly ContentBlock[]): ReceiptProof {
  return { version: 1, digest: digest(content), receipt };
}

/** Normal logged context with hidden producer evidence bound to the exact model-facing blocks. */
export function receiptContext(text: string | ContentBlock[], receipt: ShownReceipt): UserMessage {
  const content: ContentBlock[] = typeof text === 'string' ? [{ type: 'text', text }] : text;
  return createUserMessage({ source: { kind: 'swarm-context', proof: proof(receipt, content) }, content });
}

const streamPage = z.object({ runId: id, fromSeq: seq, throughSeq: seq, attention: z.array(reference) });
const publicPage = z.object({ runId: id, items: z.array(z.unknown()) });
const notificationItem = z.object({ kind: z.literal('notification'), notification: reference });
const messageItem = z.object({ kind: z.literal('message'), message: messageVersion });

/** Tool-private metadata survives native replay; a truncated/replaced result fails its content digest. */
export function toolReceiptMeta(name: string, value: JsonValue): JsonValue {
  let receipt: ShownReceipt | null = null;
  if (name === 'swarm_sync' || name === 'swarm_wait') {
    const page = streamPage.safeParse(value);
    if (page.success && page.data.fromSeq <= page.data.throughSeq) {
      receipt = { runId: page.data.runId, ranges: [{ from: page.data.fromSeq, through: page.data.throughSeq }],
        notifications: page.data.attention, messages: [] };
    }
  } else if (name === 'swarm_public_read') {
    const page = publicPage.safeParse(value);
    if (page.success) {
      receipt = { runId: page.data.runId, ranges: [], notifications: [], messages: [] };
      for (const item of page.data.items) {
        const notice = notificationItem.safeParse(item);
        if (notice.success) receipt.notifications.push(notice.data.notification);
        const message = messageItem.safeParse(item);
        if (message.success) receipt.messages.push(message.data.message);
      }
    }
  }
  return receipt ? { swarmDisplay: proof(receipt, [{ type: 'text', text: JSON.stringify(value) }]) } : {};
}

/** Only genuine appended, successful surface content is receipt evidence; PTC audit records are not. */
export function receiptFromEvent(event: SessionEvent): ShownReceipt | null {
  if (event.surfaceOp !== 'append') return null;
  let candidate: unknown;
  let content: readonly ContentBlock[];
  if (event.type === 'user/message' && event.data.source.kind === 'swarm-context') {
    candidate = event.data.source.proof;
    content = event.data.content;
  } else if (event.type === 'tool/result' && !event.data.message.isError) {
    const meta = event.data.meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    candidate = meta.swarmDisplay;
    content = event.data.message.content;
  } else return null;
  const parsed = proofSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.digest !== digest(content)) return null;
  const receipt = parsed.data.receipt;
  if (!receipt.notifications.length && !receipt.messages.length && !receipt.ranges.some((range) => range.through > range.from)) return null;
  return receipt;
}

/** Union exact evidence without treating a gap in event coverage as displayed. */
export function mergeShownReceipt(previous: ShownReceipt | undefined, next: ShownReceipt): ShownReceipt {
  const ranges: ShownReceipt['ranges'] = [];
  for (const range of [...(previous?.ranges ?? []), ...next.ranges].sort((a, b) => a.from - b.from)) {
    const last = ranges.at(-1);
    if (last && range.from <= last.through) last.through = Math.max(last.through, range.through);
    else ranges.push({ ...range });
  }
  const notifications = new Map((previous?.notifications ?? []).map((item) => [item.id, item]));
  for (const item of next.notifications) {
    if ((notifications.get(item.id)?.seq ?? -1) < item.seq) notifications.set(item.id, item);
  }
  const messages = new Map((previous?.messages ?? []).map((item) => [item.id, item]));
  for (const item of next.messages) {
    if ((messages.get(item.id)?.revision ?? 0) < item.revision) messages.set(item.id, item);
  }
  return { runId: next.runId, ranges, notifications: [...notifications.values()], messages: [...messages.values()] };
}

const projectionSchema = z.object({ inherited: seq, runs: z.record(id, shownReceiptSchema) });
export type ReceiptProjection = z.infer<typeof projectionSchema>;
export const RECEIPT_PROJECTION_KEY = 'swarm.displayReceipts';
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { 'swarm.displayReceipts': ReceiptProjection }
}
/** Pure native projection reconstructs pending receipt evidence after a crash; no custom Session events. */
export const receiptProjection: ProjectionDefinition<typeof RECEIPT_PROJECTION_KEY> = {
  key: RECEIPT_PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: projectionSchema,
  init: (_header, inherited) => ({ inherited, runs: {} }),
  apply: (state, event) => {
    if (event.seq < state.inherited) return state;
    const receipt = receiptFromEvent(event);
    if (!receipt) return state;
    return { ...state, runs: { ...state.runs, [receipt.runId]: mergeShownReceipt(state.runs[receipt.runId], receipt) } };
  },
};
