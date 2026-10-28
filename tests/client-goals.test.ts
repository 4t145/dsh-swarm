import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Transport and projection checks; these do not claim browser visual acceptance.
interface Client {
  appendGoalLine(goal: string, criteria: string): string;
  executeGoalCommand(execute: (...args: unknown[]) => Promise<unknown>, session: string, line: string, signal: AbortSignal): Promise<string>;
  appendReceipt(text: string): { disposition: string; goalId: string };
  goalState(goal: { status: string; continuedInRunId?: string | null }, phase: string): string;
  dictionaries: Record<'zh' | 'en', Record<string, string>>;
}
interface Module { factory(require: (name: string) => unknown): { progressClient: Client } }
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
let module: Module | undefined;
runInNewContext(source, {
  window: { __ModuleLoader__: { load(value: Module) { module = value; } } },
  console, AbortController, Date, Error, TypeError,
});
if (!module) throw new Error('Client was not registered');
const client = module.factory(() => ({})).progressClient;

describe('goal panel native command transport', () => {
  it('encodes arbitrary goal text as one native command without shell quoting', () => {
    const text = 'support "CSV" and \'TSV\'\nC:\\exports; $(never execute)';
    const line = client.appendGoalLine(text, ' works offline \n\n has tests\r\n');
    expect(line.startsWith('/swarm append --json ')).toBe(true);
    expect(JSON.parse(line.slice('/swarm append --json '.length))).toEqual({
      goal: text, acceptanceCriteria: ['works offline', 'has tests'],
    });
    expect(JSON.parse(client.appendGoalLine('  Next  ', '').slice('/swarm append --json '.length))).toEqual({ goal: 'Next' });
  });

  it('uses current session, complete slash line, empty attachments and the owned cancellation signal', async () => {
    const signal = new AbortController().signal;
    const execute = vi.fn(async () => ({ ok: true, value: { result: { kind: 'success', text: 'receipt' } } }));
    await expect(client.executeGoalCommand(execute, 'real-owner', '/swarm continue', signal)).resolves.toBe('receipt');
    expect(execute).toHaveBeenCalledExactlyOnceWith('real-owner', '/swarm continue', [], signal);
  });

  it('never converts native admission or inner handler failures into success', async () => {
    for (const [reply, message] of [
      [{ ok: false, error: { code: 'forbidden', message: 'read only' } }, 'forbidden: read only'],
      [{ ok: true, value: { result: { kind: 'error', text: 'SWARM_FORBIDDEN: worker' } } }, 'SWARM_FORBIDDEN: worker'],
      [{ ok: true, value: undefined }, 'Command was not accepted'],
      [{ ok: true, value: { result: { kind: 'cancelled' } } }, 'Command was not accepted'],
    ] as const) {
      await expect(client.executeGoalCommand(async () => reply, 'owner', '/swarm append x', new AbortController().signal)).rejects.toThrow(message);
    }
    await expect(client.executeGoalCommand(async () => { throw new Error('disconnected'); }, 'owner', '/swarm append x', new AbortController().signal)).rejects.toThrow('disconnected');
  });

  it('accepts only explicit Host append dispositions and does not infer them from the old phase', () => {
    for (const disposition of ['executing', 'paused', 'deferred']) {
      expect(client.appendReceipt(JSON.stringify({ runId: 'run', goalId: 'goal', disposition, goalRevision: 2 })).disposition).toBe(disposition);
    }
    for (const text of ['', '{}', 'true', '{"disposition":"executing"}', '{"goalId":"goal","disposition":"success"}']) {
      expect(() => client.appendReceipt(text)).toThrow();
    }
  });

  it('shows unfinished terminal additions as pending and transferred goals as transferred, not done', () => {
    expect(client.goalState({ status: 'active' }, 'running')).toBe('active');
    expect(client.goalState({ status: 'active' }, 'paused')).toBe('active');
    for (const phase of ['stopped', 'failed', 'completed']) expect(client.goalState({ status: 'active' }, phase)).toBe('deferred');
    expect(client.goalState({ status: 'active', continuedInRunId: 'next' }, 'stopped')).toBe('continued');
    expect(client.goalState({ status: 'completed' }, 'completed')).toBe('completed');
  });

  it('states bounded history honestly and requires publishing a draft before switching rounds', () => {
    expect(client.dictionaries.zh['goals.more']).toContain('暂不在面板展示');
    expect(client.dictionaries.en['goals.more']).toContain('not shown in this panel');
    expect(client.dictionaries.en['goals.clipped']).not.toContain('ask the Agent');
    expect(client.dictionaries.zh['goals.publishFirst']).toBeTruthy();
    expect(client.dictionaries.en['goals.publishFirst']).toBeTruthy();
    expect(source).toContain('(action === "continue" && hasDraft)');
    expect(source).toContain('(p.phase !== "paused" && hasDraft)');
  });

  it('keeps publishing accessible, drafts on errors, scoped effects and bilingual identity', () => {
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('role: receipt.ok ? "status" : "alert"');
    expect(source).toContain('request.current?.abort()');
    expect(source).toContain('ctx.get("remote.commands")');
    expect(source).toContain('h(SwarmMark)');
    expect(source).not.toContain('sessionEvents.append');
    for (const key of ['goals.add', 'goals.publish', 'goals.criteria', 'goals.sent.executing', 'goals.sent.paused', 'goals.sent.deferred', 'goals.failed', 'goals.scope']) {
      expect(client.dictionaries.zh[key]).toBeTruthy();
      expect(client.dictionaries.en[key]).toBeTruthy();
    }
    expect(client.dictionaries.zh['view.label']).toContain('◈');
    expect(client.dictionaries.en['view.label']).toContain('◈');
    expect(Object.keys(client.dictionaries.zh).sort()).toEqual(Object.keys(client.dictionaries.en).sort());
  });
});
