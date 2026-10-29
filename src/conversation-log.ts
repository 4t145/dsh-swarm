/**
 * Owner-only, paginated read of worker messages and findings, including bodies.
 *
 * The progress stream deliberately carries metadata only. This module is the
 * explicit, on-demand path for the run owner to inspect what workers actually
 * said to each other and published. Ownership is checked against both the
 * runtime status and the persisted run, the same rule as worktree history.
 */

import { SwarmError, isSwarmError } from './errors.ts';
import type { FindingKind, Run } from './types.ts';

export const CONVERSATION_PAGE_SIZE = 40;
export const CONVERSATION_LIMITS = Object.freeze({ bodyChars: 8000, refs: 16, refChars: 300 });

export type ConversationItem =
  | {
    readonly kind: 'message';
    readonly id: string;
    readonly seq: number;
    readonly authorWorkerId: string;
    readonly targetWorkerId: string;
    readonly body: string;
    readonly truncated: boolean;
    readonly createdAt: number;
  }
  | {
    readonly kind: 'finding';
    readonly id: string;
    readonly seq: number;
    readonly authorWorkerId: string;
    readonly findingKind: FindingKind;
    readonly taskId: string | null;
    readonly body: string;
    readonly truncated: boolean;
    readonly scope: readonly string[];
    readonly evidenceRefs: readonly string[];
    readonly supersedesId: string | null;
    readonly createdAt: number;
  };

export interface ConversationPage {
  readonly runId: string;
  /** Newest first. */
  readonly items: readonly ConversationItem[];
  /** Pass as `beforeSeq` to read older items; null when there are none. */
  readonly nextBeforeSeq: number | null;
}

interface ConversationOptions {
  readonly status: (ownerSessionId: string) => { readonly runId: string; readonly ownerSessionId: string };
  readonly getRun: (runId: string) => Run;
}

function clip(text: string, max: number): { text: string; truncated: boolean } {
  return text.length <= max ? { text, truncated: false } : { text: `${text.slice(0, max - 1)}…`, truncated: true };
}

const refs = (values: readonly string[]): string[] =>
  values.slice(0, CONVERSATION_LIMITS.refs).map((value) => clip(value, CONVERSATION_LIMITS.refChars).text);

/** Reads the owner's current run only; never another session's run. */
export class ConversationLog {
  constructor(private readonly options: ConversationOptions) {}

  /**
   * @param beforeSeq exclusive upper bound from a previous page, or null for the newest page.
   * @returns null when the owner has no run and no cursor was given.
   * @throws SwarmError `SWARM_FORBIDDEN` for a non-owner, `SWARM_INVALID_INPUT` for bad input.
   */
  page(sessionId: string, beforeSeq: number | null): ConversationPage | null {
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'sessionId must be a non-empty string of at most 200 characters');
    }
    if (beforeSeq !== null && (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1)) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'beforeSeq must be a positive integer or null');
    }
    let run: Run;
    try {
      const status = this.options.status(sessionId);
      if (status.ownerSessionId !== sessionId) throw new SwarmError('SWARM_FORBIDDEN', 'Only the run owner may read worker conversations');
      run = this.options.getRun(status.runId);
      if (run.ownerSessionId !== sessionId) throw new SwarmError('SWARM_FORBIDDEN', 'Only the run owner may read worker conversations');
    } catch (error) {
      if (isSwarmError(error) && error.code === 'SWARM_NOT_FOUND' && beforeSeq === null) return null;
      throw error;
    }
    const all: ConversationItem[] = [];
    for (const message of Object.values(run.messages)) {
      if (beforeSeq !== null && message.seq >= beforeSeq) continue;
      const body = clip(message.body, CONVERSATION_LIMITS.bodyChars);
      all.push({ kind: 'message', id: message.id, seq: message.seq, authorWorkerId: message.authorWorkerId, targetWorkerId: message.targetWorkerId,
        body: body.text, truncated: body.truncated, createdAt: message.createdAt });
    }
    for (const finding of Object.values(run.findings)) {
      if (beforeSeq !== null && finding.seq >= beforeSeq) continue;
      const body = clip(finding.summary, CONVERSATION_LIMITS.bodyChars);
      all.push({ kind: 'finding', id: finding.id, seq: finding.seq, authorWorkerId: finding.authorWorkerId, findingKind: finding.kind,
        taskId: finding.taskId, body: body.text, truncated: body.truncated, scope: refs(finding.scope),
        evidenceRefs: refs(finding.evidenceRefs), supersedesId: finding.supersedesId, createdAt: finding.createdAt });
    }
    all.sort((a, b) => b.seq - a.seq);
    const items = all.slice(0, CONVERSATION_PAGE_SIZE);
    const last = items.at(-1);
    return { runId: run.id, items, nextBeforeSeq: all.length > items.length && last ? last.seq : null };
  }
}
