/** Shared spec-file contract through the registered command and native tool runtime. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native';
import { registerSwarmCommand, type SwarmCommandContext, type SwarmCommandDefinition, type SwarmRunView, type SwarmRuntimePort } from '../src/commands.ts';
import { registerOwnerTools } from '../src/owner-tools.ts';
import type { RunSpec } from '../src/types.ts';

const SPEC = {
  repository: '../repo', baseRef: 'HEAD', goal: 'test spec loading', acceptanceCriteria: ['works'],
  workers: 2, allowDirtyBaseline: false, verification: { setup: [], test: [{ argv: ['node', '--version'], timeoutMs: 1000 }] },
};
const RUN: SwarmRunView = {
  id: 'run', phase: 'running', reason: null, deadline: null, baseCommit: 'base', acceptedHead: 'head',
  resultRef: 'refs/heads/result', allowDirtyBaseline: false,
};

const disposers: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

function harness(entry: 'command' | 'tool') {
  const host = new Context();
  disposers.push(() => host.fiber.dispose());
  new SystemPrompt(host, { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: '', personaSuffix: '', toolOrder: undefined });
  new ToolRuntime(host);
  host.tools.setExecutor(new NativeToolExecutor(host));
  const session = Session.create(SessionId('spec-owner'));
  // Only the real identity/session surface is consumed; no model or Agent loop runs.
  const agent = { id: session.id, session } as Agent;
  const state = { source: JSON.stringify(SPEC), mode: 'workspace-write', failure: null as 'resolve' | 'read' | null };
  const fs = {
    resolve: vi.fn(async (_path: string, _options?: { cwd?: string; signal?: AbortSignal }) => {
      if (state.failure === 'resolve') throw new Error('fixture resolve denied');
      // The display label is not the canonical spec path used for repository resolution.
      return { displayPath: '/virtual/spec-label' };
    }),
    readText: vi.fn(async (_target: { displayPath: string }, _signal?: AbortSignal) => {
      if (state.failure === 'read') throw new Error('fixture read denied');
      return state.source;
    }),
  };
  const start = vi.fn(async (_owner: string, _spec: RunSpec) => RUN);
  const unexpected = (): never => { throw new Error('unexpected runtime operation'); };
  const runtime: SwarmRuntimePort = {
    start, status: unexpected, pause: unexpected, resume: unexpected, stop: unexpected,
    appendGoal: unexpected, continueGoals: unexpected, addWorker: unexpected,
    collaboration: { controlTask: unexpected },
  };
  let command: SwarmCommandDefinition | undefined;
  const ctx: SwarmCommandContext & { tools: ToolRuntime } = {
    tools: host.tools, fs, workingDirectory: { get: () => '/workspace/project' },
    sandboxPolicy: { resolve: () => ({ mode: state.mode }) }, effect: () => undefined,
    commands: { register: (definition) => { command = definition; return () => undefined; } },
  };
  disposers.push(entry === 'command'
    ? registerSwarmCommand(ctx, runtime, { resultHead: unexpected })
    : registerOwnerTools(ctx, runtime));
  return {
    state, fs, start,
    async call(signal: AbortSignal = new AbortController().signal) {
      if (entry === 'command') {
        if (!command) throw new Error('command was not registered');
        const result = await command.handler({ agent, rawInput: 'start --spec "configs/run spec.json"', signal });
        return { ok: result.kind === 'success', text: result.text ?? '' };
      }
      const batch = await host.tools.execute({
        calls: [{ type: 'tool-call', id: ToolCallId('spec-call'), name: 'swarm_manage', arguments: JSON.stringify({ action: 'start', spec_path: 'configs/run spec.json' }) }],
        agent, signal,
      });
      const result = batch.results[0]?.result;
      if (result === undefined) throw new Error('no swarm_manage result');
      return { ok: !result.isError, text: result.isError ? result.error.message : JSON.stringify(result.value) };
    },
  };
}

describe.each(['command', 'tool'] as const)('registered %s spec-file boundary', (entry) => {
  it('loads through Host fs with the same signal and resolves relative to the spec directory', async () => {
    const h = harness(entry);
    const signal = new AbortController().signal;
    expect((await h.call(signal)).ok).toBe(true);
    expect(h.fs.resolve).toHaveBeenCalledExactlyOnceWith('configs/run spec.json', { cwd: '/workspace/project', signal });
    expect(h.fs.readText).toHaveBeenCalledExactlyOnceWith({ displayPath: '/virtual/spec-label' }, signal);
    expect(h.start).toHaveBeenCalledExactlyOnceWith('spec-owner', expect.objectContaining({
      specPath: '/workspace/project/configs/run spec.json', repository: '/workspace/project/repo', budgetMinutes: 0,
      verification: { setup: [], test: [{ argv: ['node', '--version'], timeoutMs: 1000 }] },
    }));
  });

  it.each(['resolve', 'read'] as const)('preserves the existing diagnostic policy when Host fs %s fails', async (failure) => {
    const h = harness(entry);
    h.state.failure = failure;
    const result = await h.call();
    expect(result.ok).toBe(false);
    expect(result.text).toContain('failed to read swarm spec /workspace/project/configs/run spec.json');
    if (entry === 'command') expect(result.text).toContain(`: fixture ${failure} denied`);
    else expect(result.text).not.toContain('fixture');
    expect(h.start).not.toHaveBeenCalled();
    expect(h.fs.readText).toHaveBeenCalledTimes(failure === 'resolve' ? 0 : 1);
  });

  it.each(['null', '{', '{"workers":9}'])('rejects invalid JSON/schema %s before starting', async (source) => {
    const h = harness(entry);
    h.state.source = source;
    const result = await h.call();
    expect(result.ok).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
    if (source === '{') expect(result.text).toContain('is not valid JSON');
    else expect(result.text).toContain('spec');
  });

  it('denies read-only startup before any fs access', async () => {
    const h = harness(entry);
    h.state.mode = 'read-only';
    expect((await h.call()).ok).toBe(false);
    expect(h.fs.resolve).not.toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
  });

  it('does not access the spec or start a run after cancellation', async () => {
    const h = harness(entry);
    expect((await h.call(AbortSignal.abort())).ok).toBe(false);
    expect(h.fs.resolve).not.toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
  });
});
