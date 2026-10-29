/** Urgent direct messages: next tool-result boundary while running, wake while idle, public digest still deferred. */
import { afterEach, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, type ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import { Collaboration } from '../src/collaboration.ts';
import { Delivery } from '../src/delivery.ts';
import { PublicCollaboration } from '../src/public-collaboration.ts';
import type { PublicCommand } from '../src/public-input.ts';
import type { NotificationRecord, ThreadRecord } from '../src/public-types.ts';
import type { WorkerHost } from '../src/ports.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import { createRun, type Run, type WorkerRecord } from '../src/types.ts';
import { collectWorkerNotices, registerWorkerContext } from '../src/worker-context.ts';
import { WORKER_POLICY } from '../src/worker-policy.ts';
import { registerWorkerTools } from '../src/tools.ts';

class Table implements RunTable {
  records = new Map<string, Run>();
  get(id: string) { return this.records.get(id); }
  entries() { return this.records.entries(); }
  async put(id: string, run: Run) { this.records.set(id, structuredClone(run)); }
  async update(id: string, fn: (run: Run) => Run) {
    const run = structuredClone(fn(this.records.get(id)!)); this.records.set(id, run); return run;
  }
}
function worker(id: string): WorkerRecord {
  return { id, sessionId: `s-${id}`, branch: id, worktreePath: '/repo', initializationState: 'ready',
    initializationError: null, unavailableReason: null, offeredSeq: 0, observedSeq: 0, notifiedSeq: 0,
    wakeTargetSeq: 0, waitRegistration: null, currentTaskId: null, createdAt: 0 };
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
class Host implements WorkerHost {
  notices: { workerId: string; seq: number; notifications: readonly NotificationRecord[] }[] = [];
  statuses = new Map<string, 'running' | 'inactive' | 'unavailable'>([['s-a', 'running'], ['s-b', 'running']]);
  settled: ((sessionId: string, activationId: string, failed: boolean) => void) | null = null;
  async start() {}
  async notify(_run: Run, target: WorkerRecord, seq: number, _signal: AbortSignal, notifications: readonly NotificationRecord[] = []) {
    this.notices.push({ workerId: target.id, seq, notifications });
  }
  async stop() {}
  isOwnerLive() { return true; }
  isWorkerBusy(sessionId: string) { return this.workerStatus(sessionId) === 'running'; }
  workerStatus(sessionId: string) { return this.statuses.get(sessionId) ?? 'unavailable'; }
  onSettled(listener: NonNullable<Host['settled']>) { this.settled = listener; return () => { this.settled = null; }; }
}
const CONFIG = { peerNoticeItems: 4, peerNoticeChars: 200 };
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function harness() {
  const ctx = new Context();
  new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: '',
    personaSuffix: '', toolOrder: undefined });
  new ToolRuntime(ctx, { mode: 'native', maxParallelSubCalls: 10 });
  const store = new MemoryStateStore(new Table());
  const run = createRun({ id: 'r', ownerSessionId: 'owner', repositoryRoot: '/repo', gitCommonDir: '/repo/.git',
    goal: 'urgent dm', acceptanceCriteria: ['dm steers'], verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
    baseCommit: 'a'.repeat(40), resultRef: 'refs/heads/result', deadline: null, createdAt: 0 });
  run.phase = 'running'; run.workers = { a: worker('a'), b: worker('b') };
  await store.create(run);
  let count = 0;
  const collaboration = new Collaboration(store, { now: () => 50, id: () => `legacy-${++count}` });
  const api = new PublicCollaboration(store, { id: () => `public-${++count}`, now: () => 50 });
  const host = new Host();
  const errors: unknown[] = [];
  const delivery = new Delivery(store, host, {
    admitWorkerOperation: async () => ({ signal: new AbortController().signal, release() {} }),
    onError: (_run, error) => { errors.push(error); },
  });
  // A fake model-requested edit that stays "in flight" until the test releases it.
  let gate: Promise<void> = Promise.resolve();
  let entered = barrier();
  const removeTool = ctx.tools.register({ name: 'fake_edit', description: 'fake long-running edit',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    execute: async () => { entered.resolve(); await gate; return { ok: true }; } });
  const removeContext = registerWorkerContext(ctx, collaboration, CONFIG);
  cleanup.push(async () => { removeContext(); removeTool(); await delivery.dispose(); await store.close(); await ctx.fiber.dispose(); });
  const removeTools = registerWorkerTools(ctx, { collaboration } as never, {} as never);
  cleanup.push(() => removeTools());
  const exec = (name: string, who: string, args: Record<string, unknown> = {}) => ctx.tools.execute({
    callId: ToolCallId(`call-${++count}`), name, arguments: JSON.stringify(args),
    agent: { id: SessionId(`s-${who}`) } as Agent, signal: new AbortController().signal,
  }) as Promise<ToolExecutionResult>;
  const hold = () => { const release = barrier(); gate = release.promise; entered = barrier(); return release; };
  const call = (who: string, command: PublicCommand) => api.execute(`s-${who}`, command, `call-${++count}`);
  return { ctx, store, collaboration, api, host, delivery, errors, exec, hold, call, entered: () => entered.promise };
}

function contextText(result: ToolExecutionResult): string {
  return (result.additionalContexts ?? []).flatMap((message: UserMessage) =>
    message.content.map((block) => (block.type === 'text' ? block.text : ''))).join('\n');
}

describe('urgent direct messages', () => {
  it('a DM sent while the target runs a tool arrives at that tool-result boundary, ahead of updates', async () => {
    const h = await harness();
    const release = h.hold();
    const pending = h.exec('fake_edit', 'b');
    await h.entered();
    const sent = await h.collaboration.message('s-a', { target: 'b', body: 'STOP: I am editing src/delivery.ts too' }, 'dm-1');
    release.resolve();
    const result = await pending;
    expect(result.isError).toBe(false);
    const text = contextText(result);
    expect(text.indexOf('[Swarm urgent direct messages')).toBe(0);
    expect(text).toContain(sent.id);
    expect(text).toContain('STOP: I am editing src/delivery.ts too');
    expect(text.indexOf('urgent direct messages')).toBeLessThan(text.indexOf('[Swarm shared context'));
    // The DM is never visible to a third party's projection, and the sender's own boundary does not echo it.
    expect(contextText(await h.exec('fake_edit', 'a'))).not.toContain('STOP:');
  });

  it('DMs are not capped behind ordinary updates and the display range never skips an unshown DM', async () => {
    const h = await harness();
    for (let i = 0; i < 6; i++) {
      await h.collaboration.publish('s-a', { kind: 'observed', summary: `finding ${i}` }, `f-${i}`);
    }
    const dm = await h.collaboration.message('s-a', { target: 'b', body: 'urgent after many findings' }, 'dm-2');
    const page = collectWorkerNotices(h.store.get('r'), 'b', 0, { peerNoticeItems: 2, peerNoticeChars: 80 });
    expect(page.directMessages.map((item) => item.id)).toEqual([dm.id]);
    expect(page.updates).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    // Bounded DM batch: extra DMs are flagged and the scanned range stops before the first unshown one.
    for (let i = 0; i < 3; i++) await h.collaboration.message('s-a', { target: 'b', body: `dm ${i}` }, `dm-x-${i}`);
    const bounded = collectWorkerNotices(h.store.get('r'), 'b', 0, { peerNoticeItems: 2, peerNoticeChars: 80 });
    expect(bounded.directMessages).toHaveLength(2);
    expect(bounded.directMessagesHasMore).toBe(true);
    const firstUnshown = h.store.get('r').events.find((event) => event.kind === 'message'
      && !bounded.directMessages.some((item) => item.id === event.messageId))!;
    expect(bounded.scanned).toBeLessThan(firstUnshown.seq);
  });

  it('an idle target is still woken by a DM, while public digest traffic waits for idle boundaries', async () => {
    const h = await harness();
    const thread = await h.call('a', { action: 'create_thread', channelId: 'r:general', title: 'Digest' }) as ThreadRecord;
    await h.call('b', { action: 'subscribe', channelId: thread.channelId, threadId: thread.id, mode: 'following' });
    await h.call('a', { action: 'post', threadId: thread.id, body: 'ordinary digest chatter' });
    await h.delivery.idle();
    // Running target: digest is not pushed by Delivery and its body never enters boundary context.
    expect(h.host.notices).toEqual([]);
    const release = h.hold();
    const pending = h.exec('fake_edit', 'b');
    await h.entered();
    release.resolve();
    expect(contextText(await pending)).not.toContain('ordinary digest chatter');
    // Idle target: a DM wakes it.
    h.host.statuses.set('s-b', 'inactive');
    const dm = await h.collaboration.message('s-a', { target: 'b', body: 'wake up' }, 'dm-3');
    await h.delivery.idle();
    expect(h.host.notices.at(-1)).toMatchObject({ workerId: 'b' });
    expect(h.host.notices.at(-1)!.seq).toBeGreaterThanOrEqual(dm.seq);
    expect(h.errors).toEqual([]);
  });

  it('policy and tool description state DMs are urgent, higher priority, and public threads stay default', async () => {
    const h = await harness();
    expect(WORKER_POLICY).toContain('urgent, targeted one-to-one');
    expect(WORKER_POLICY).toContain('higher priority');
    expect(WORKER_POLICY).toContain('Public threads remain the default');
    const definition = h.ctx.tools.schemas().find((tool) => tool.name === 'swarm_message')!;
    expect(definition.description).toContain('urgent private message');
    expect(definition.description).toContain('higher priority');
    expect(definition.description).toContain('public threads stay the default');
  });
});
