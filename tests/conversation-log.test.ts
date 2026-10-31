import { describe, expect, it, vi } from 'vitest';

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
    status: (sessionId) => ({ runId: full.id, ownerSessionId: sessionId }),
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
    const seqs = Array.from({ length: CONVERSATION_PAGE_SIZE + 5 }, (_, i) => (i + 1) * 2);
    const messages = Object.fromEntries(seqs.filter((_, i) => i % 2 === 0).map((seq) => [`m${seq}`, message(seq)]));
    const findings = Object.fromEntries(seqs.filter((_, i) => i % 2 !== 0).map((seq) => [`f${seq}`, finding(seq)]));
    const source = log({ messages, findings });
    const first = source.page('owner', null)!;
    expect(first.items).toHaveLength(CONVERSATION_PAGE_SIZE);
    expect(first.nextBeforeSeq).toBe(first.items.at(-1)?.seq);
    // Newly published content must not shift the exclusive older-page boundary.
    messages['new'] = message(1000);
    const second = source.page('owner', first.nextBeforeSeq)!;
    expect(second.nextBeforeSeq).toBeNull();
    expect([...first.items, ...second.items].map((item) => item.seq)).toEqual(seqs.toReversed());
    expect(source.page('owner', null)?.items[0]?.seq).toBe(1000);
  });

  it('bounds long bodies and marks truncation', () => {
    const page = log({ messages: { m1: message(1, 'x'.repeat(CONVERSATION_LIMITS.bodyChars + 10)) }, findings: {} }).page('owner', null)!;
    expect(page.items[0]?.body).toHaveLength(CONVERSATION_LIMITS.bodyChars);
    expect(page.items[0]?.truncated).toBe(true);
  });

  it('bounds finding bodies and reference lists without losing their visible prefixes', () => {
    const item = finding(1);
    item.summary = 'f'.repeat(CONVERSATION_LIMITS.bodyChars + 1);
    item.scope = Array.from({ length: CONVERSATION_LIMITS.refs + 1 }, () => 's'.repeat(CONVERSATION_LIMITS.refChars + 1));
    item.evidenceRefs = Array.from({ length: CONVERSATION_LIMITS.refs + 1 }, () => 'e'.repeat(CONVERSATION_LIMITS.refChars + 1));
    const page = log({ messages: {}, findings: { f1: item } }).page('owner', null)!;
    const shown = page.items[0]!;
    expect(shown).toMatchObject({ kind: 'finding', truncated: true, body: `${'f'.repeat(CONVERSATION_LIMITS.bodyChars - 1)}…` });
    if (shown.kind !== 'finding') throw new Error('expected a finding');
    expect(shown.scope).toEqual(Array(CONVERSATION_LIMITS.refs).fill(`${'s'.repeat(CONVERSATION_LIMITS.refChars - 1)}…`));
    expect(shown.evidenceRefs).toEqual(Array(CONVERSATION_LIMITS.refs).fill(`${'e'.repeat(CONVERSATION_LIMITS.refChars - 1)}…`));
  });

  it('rejects runtime membership before reading stored data, and rechecks persisted ownership', () => {
    const getRun = vi.fn(() => ({ id: 'run-1', ownerSessionId: 'someone-else', messages: {}, findings: {} }) as Run);
    const runtimeDenied = new ConversationLog({ status: () => ({ runId: 'run-1', ownerSessionId: 'someone-else' }), getRun });
    expect(() => runtimeDenied.page('owner', null)).toThrow(expect.objectContaining({ code: 'SWARM_FORBIDDEN' }));
    expect(getRun).not.toHaveBeenCalled();
    const persistedDenied = new ConversationLog({ status: () => ({ runId: 'run-1', ownerSessionId: 'owner' }), getRun });
    expect(() => persistedDenied.page('owner', null)).toThrow(expect.objectContaining({ code: 'SWARM_FORBIDDEN' }));
    expect(getRun).toHaveBeenCalledOnce();
  });

  it('distinguishes absent runs from stale cursors and storage failures', () => {
    const absent = new SwarmError('SWARM_NOT_FOUND', 'no run');
    const missing = new ConversationLog({ status: () => { throw absent; }, getRun: vi.fn() });
    expect(missing.page('owner', null)).toBeNull();
    expect(() => missing.page('owner', 3)).toThrow(absent);
    const failure = new Error('storage offline');
    const broken = new ConversationLog({ status: () => ({ runId: 'run-1', ownerSessionId: 'owner' }), getRun: () => { throw failure; } });
    expect(() => broken.page('owner', null)).toThrow(failure);
  });

  it('rejects invalid cursors before consulting runtime or persistence', () => {
    const status = vi.fn();
    const getRun = vi.fn();
    const source = new ConversationLog({ status, getRun });
    for (const cursor of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => source.page('owner', cursor)).toThrow(expect.objectContaining({ code: 'SWARM_INVALID_INPUT' }));
    }
    expect(status).not.toHaveBeenCalled();
    expect(getRun).not.toHaveBeenCalled();
  });
});
