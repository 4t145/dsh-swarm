import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionSeq, SessionStore, type SessionEvent } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import {
  ACTIVITY_LIMITS, WORKER_ACTIVITY_KEY, applyWorkerActivity, emptyWorkerActivity,
  registerWorkerActivity, toWorkerActivity, workerActivityProjection, workerActivitySchema,
} from '../src/worker-activity.ts';

const call = (id: string, time = 100, name = 'read'): SessionEvent<'tool/call'> => ({
  type: 'tool/call', seq: SessionSeq(1), time,
  data: { turn: 1, step: 2, callId: ToolCallId(id), name, arguments: 'PRIVATE ARGUMENTS' },
});
const result = (id: string, failed = false): SessionEvent<'tool/result'> => ({
  type: 'tool/result', seq: SessionSeq(2), time: 200, surfaceOp: 'append',
  data: { turn: 1, step: 2, message: {
    id: MessageId('message'), role: 'tool', source: { kind: 'tool', callId: ToolCallId(id) },
    toolCallId: ToolCallId(id), isError: failed, content: [{ type: 'text', text: 'PRIVATE RESULT' }],
  }, meta: { private: 'PRIVATE META' } },
});

describe('worker activity pure projection', () => {
  it('tracks parallel tools independently and retains only whitelisted facts', () => {
    const initial = emptyWorkerActivity();
    const first = applyWorkerActivity(initial, call('a'));
    const second = applyWorkerActivity(first, call('b', 110, 'bash'));
    expect(initial.activeTools).toEqual([]);
    expect(second.activeTools.map((tool) => tool.id)).toEqual(['a', 'b']);
    const partial = applyWorkerActivity(second, result('a'));
    expect(partial.status).toBe('executing');
    expect(partial.activeTools.map((tool) => tool.id)).toEqual(['b']);
    expect(partial.recentTools[0]).toEqual({ id: 'a', name: 'read', turn: 1, step: 2,
      status: 'completed', startedAt: 100, finishedAt: 200 });
    const done = applyWorkerActivity(partial, result('b', true));
    expect(done.status).toBe('running');
    expect(done.activeTools).toEqual([]);
    expect(done.recentTools.map((tool) => tool.status)).toEqual(['failed', 'completed']);
    expect(JSON.stringify(done)).not.toMatch(/PRIVATE|arguments|content|meta/);
    expect(workerActivitySchema.parse(done)).toEqual(done);
  });

  it('preserves state/view identity for ignored text and unmatched results', () => {
    const state = applyWorkerActivity(emptyWorkerActivity(), call('a'));
    const text: SessionEvent<'assistant/message'> = {
      type: 'assistant/message', time: 300, seq: SessionSeq(3), surfaceOp: 'append',
      data: { turn: 1, step: 2, stream: [], message: { id: MessageId('assistant'), role: 'assistant',
        source: { kind: 'model', provider: 'private', model: 'private' },
        content: [{ type: 'reasoning', text: 'PRIVATE REASONING' }, { type: 'text', text: 'PRIVATE TEXT' }],
      } },
    };
    expect(applyWorkerActivity(state, text)).toBe(state);
    expect(applyWorkerActivity(state, result('unrelated'))).toBe(state);
    expect(workerActivityProjection.wire.view(state)).toBe(state);
  });

  it('marks unfinished calls interrupted at turn end without inventing success', () => {
    const active = applyWorkerActivity(emptyWorkerActivity(), call('a'));
    const ended = applyWorkerActivity(active, { type: 'turn/end', seq: SessionSeq(4), time: 400,
      data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } });
    expect(ended.status).toBe('idle');
    expect(ended.activeTools).toEqual([]);
    expect(ended.recentTools[0]).toMatchObject({ status: 'interrupted', finishedAt: 400 });
    expect(active.activeTools[0]?.status).toBe('executing');
  });

  it('lets native inactive/unavailable override stale executing state without mutating it', () => {
    const active = applyWorkerActivity(emptyWorkerActivity(), call('a'));
    for (const native of ['inactive', 'unavailable'] as const) {
      const dto = toWorkerActivity(active, native);
      expect(dto.status).toBe(native === 'inactive' ? 'idle' : 'unavailable');
      expect(dto.activeTools).toEqual([]);
      expect(JSON.stringify(dto)).not.toContain('executing');
    }
    expect(active.activeTools[0]?.status).toBe('executing');
    expect(toWorkerActivity(undefined, 'running')).toMatchObject({ status: 'unavailable',
      diagnostic: 'worker activity projection unavailable' });
  });

  it('never claims no tools remain when an omitted concurrent call is still running', () => {
    let state = applyWorkerActivity(emptyWorkerActivity(), call('omitted'));
    for (let index = 0; index < ACTIVITY_LIMITS.activeTools; index++) state = applyWorkerActivity(state, call(String(index)));
    for (let index = 0; index < ACTIVITY_LIMITS.activeTools; index++) state = applyWorkerActivity(state, result(String(index)));
    expect(state.activeTools).toEqual([]);
    expect(state.activeToolsTruncated).toBe(true);
    expect(state.status).toBe('executing');
    expect(toWorkerActivity(state, 'running')).toMatchObject({ status: 'executing', activeToolsTruncated: true });
    expect(toWorkerActivity(state, 'running').diagnostic).toContain('omitted');
    const ended = applyWorkerActivity(state, { type: 'step/end', seq: SessionSeq(40), time: 500,
      data: { turn: 1, step: 2 } });
    expect(ended.activeToolsTruncated).toBe(false);
    expect(ended.status).toBe('running');
    expect(toWorkerActivity(state, 'inactive')).toMatchObject({ status: 'idle', activeToolsTruncated: false });
  });

  it('bounds every retained list and tool identity/name', () => {
    let state = emptyWorkerActivity();
    for (let index = 0; index < 60; index++) state = applyWorkerActivity(state, call(String(index), index, 'x'.repeat(500)));
    expect(state.activeTools).toHaveLength(ACTIVITY_LIMITS.activeTools);
    for (let index = 44; index < 60; index++) state = applyWorkerActivity(state, result(String(index)));
    expect(state.recentTools).toHaveLength(ACTIVITY_LIMITS.recentTools);
    expect(state.recentTools.every((tool) => tool.name.length === ACTIVITY_LIMITS.nameChars)).toBe(true);
    expect(workerActivitySchema.safeParse({ ...state, private: 'secret' }).success).toBe(false);
  });
});

describe('worker activity native registry adapter', () => {
  it('reads live agent.session, drives onChanged, and removes all registrations on dispose', async () => {
    const ctx = new Context();
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    const session = ctx.sessions.create(SessionId('worker'));
    const requested: string[] = [];
    ctx.provide('agents', { get: (id: string) => {
      requested.push(id);
      return id === 'worker' ? { session } : undefined;
    } });
    const source = registerWorkerActivity(ctx);
    const changed: string[] = [];
    source.subscribe((id) => changed.push(id));
    expect(source.read('missing')).toBeUndefined();
    expect(source.read('worker')?.activeTools).toEqual([]);
    session.append('tool/call', call('a').data);
    expect(changed).toEqual(['worker']);
    expect(source.read('worker')?.activeTools[0]?.id).toBe('a');
    expect(requested).toEqual(['missing', 'worker', 'worker']);
    source.dispose();
    source.dispose();
    expect(ctx.sessionProjections.stateOf(session, WORKER_ACTIVITY_KEY)).toBeUndefined();
    session.append('tool/call', call('b').data);
    expect(changed).toEqual(['worker']);
    expect(() => source.read('worker')).toThrow(/disposed/);
    await ctx.fiber.dispose();
  });
});
