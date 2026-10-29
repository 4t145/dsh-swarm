import { describe, expect, it } from 'vitest';

import { SwarmError } from '../src/errors.ts';
import { CONVERSATION_LIMITS, CONVERSATION_PAGE_SIZE, ConversationLog } from '../src/conversation-log.ts';
import type { FindingRecord, MessageRecord, Run } from '../src/types.ts';

function message(seq: number, body = 'hello ' + seq): MessageRecord {
  return { id: 'm' + seq, seq, authorWorkerId: 'w1', targetWorkerId: 'w2', body, createdAt: seq };
}
function finding(seq: number): FindingRecord {
  return { id: 'f' + seq, seq, authorWorkerId: 'w2', taskId: 't1', kind: 'fact', summary: 'fact ' + seq,
    scope: ['src/a.ts'], evidenceRefs: ['pnpm test'], supersedesId: null, blockingRepairTaskId: null, createdAt: seq };
}
function log(run: Partial<Run> & { messages: Run['messages']; findings: Run['findings'] }, owner = 'owner') {
  const full = { id: 'run-1', ownerSessionId: owner, ...run } as Run;
  return new ConversationLog({
    status: (sessionId) => {
      if (sessionId === 'nobody') throw new SwarmError('SWARM_NOT_FOUND', 'none');
      return { runId: full.id, ownerSessionId: sessionId };
    },
    getRun: () => full,
  });
}

describe('owner conversation log', () => {
  it('returns message and finding bodies newest first', () => {
    const page = log({ messages: { m1: message(1), m3: message(3) }, findings: { f2: finding(2) } }).page('owner', null);
    expect(page?.items.map((item) => item.seq)).toEqual([3, 2, 1]);
    expect(page?.items[0]).toMatchObject({ kind: 'message', body: 'hello 3', authorWorkerId: 'w1', targetWorkerId: 'w2' });
    expect(page?.items[1]).toMatchObject({ kind: 'finding', body: 'fact 2', findingKind: 'fact', scope: ['src/a.ts'], evidenceRefs: ['pnpm test'] });
    expect(page?.nextBeforeSeq).toBeNull();
  });

  it('pages with an exclusive beforeSeq cursor without gaps or duplicates', () => {
    const messages = Object.fromEntries(Array.from({ length: CONVERSATION_PAGE_SIZE + 5 }, (_, i) => [`m${i + 1}`, message(i + 1)]));
    const source = log({ messages, findings: {} });
    const first = source.page('owner', null)!;
    expect(first.items).toHaveLength(CONVERSATION_PAGE_SIZE);
    const second = source.page('owner', first.nextBeforeSeq)!;
    expect(second.nextBeforeSeq).toBeNull();
    const seqs = [...first.items, ...second.items].map((item) => item.seq);
    expect(new Set(seqs).size).toBe(CONVERSATION_PAGE_SIZE + 5);
  });

  it('bounds long bodies and marks truncation', () => {
    const page = log({ messages: { m1: message(1, 'x'.repeat(CONVERSATION_LIMITS.bodyChars + 10)) }, findings: {} }).page('owner', null)!;
    expect(page.items[0]?.body).toHaveLength(CONVERSATION_LIMITS.bodyChars);
    expect(page.items[0]?.truncated).toBe(true);
  });

  it('refuses non-owners, rejects bad cursors and returns null without a run', () => {
    expect(() => log({ messages: {}, findings: {} }, 'someone-else').page('owner', null)).toThrow(/run owner/);
    expect(() => log({ messages: {}, findings: {} }).page('owner', 0)).toThrow(/beforeSeq/);
    expect(log({ messages: {}, findings: {} }).page('nobody', null)).toBeNull();
  });
});
