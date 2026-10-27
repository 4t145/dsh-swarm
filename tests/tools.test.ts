/**
 * Worker tool surface tests.
 *
 * 依赖边界：
 * - 真实 Cordis Context + 真实 `ToolRuntime`/`SystemPrompt` 服务，工具参数因此经过真实
 *   registry 校验与执行管线；只有 `jobs` 用窄 fake 提供；
 * - 真实 `SwarmRuntime` + `MemoryStateStore`，Host/Workspace 用 fake，不碰 Git、模型或子进程；
 * - worker 身份用最小 `Agent`（只暴露 `id`）驱动，验证身份只来自 `exec.agent`。
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, type ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import { StoredArtifacts, type ArtifactRecord, type ArtifactTable } from '../src/artifacts.ts';
import {
  verificationFingerprint,
  type ArtifactPort,
  type CandidateResult,
  type RepositoryInfo,
  type VerificationOutcome,
  type WorkerHost,
  type WorkerStartRequest,
  type WorkspacePort,
} from '../src/ports.ts';
import { SwarmRuntime } from '../src/runtime.ts';
import { MemoryStateStore, type RunTable } from '../src/store.ts';
import {
  createRun,
  type CommitSha,
  type ProposalRecord,
  type Run,
  type RunId,
  type WorkerRecord,
} from '../src/types.ts';
import { registerWorkerTools } from '../src/tools.ts';
import { apply, inject, name as pluginName } from '../src/worker.ts';

/* ------------------------------------------------------------------ */
/* fake 环境                                                           */
/* ------------------------------------------------------------------ */

const HEAD: CommitSha = 'a'.repeat(40);

class InMemoryRunTable implements RunTable {
  private readonly records = new Map<RunId, Run>();

  get(id: RunId): Run | undefined {
    return this.records.get(id);
  }

  *entries(): IterableIterator<[RunId, Run]> {
    yield* this.records.entries();
  }

  async put(id: RunId, run: Run): Promise<void> {
    this.records.set(id, run);
  }

  async update(id: RunId, fn: (run: Run) => Run): Promise<Run> {
    const current = this.records.get(id);
    if (current === undefined) {
      throw new Error(`missing run ${id}`);
    }
    const next = fn(current);
    this.records.set(id, next);
    return next;
  }
}

class InMemoryArtifactTable implements ArtifactTable {
  private readonly records = new Map<string, ArtifactRecord>();

  get(id: string): ArtifactRecord | undefined {
    return this.records.get(id);
  }

  async put(id: string, record: ArtifactRecord): Promise<void> {
    this.records.set(id, record);
  }
}

class FakeWorkspace implements WorkspacePort {
  async inspect(): Promise<RepositoryInfo> {
    return { repositoryRoot: '/repo', gitCommonDir: '/repo/.git', baseCommit: HEAD, dirty: false };
  }

  async initializeResult(): Promise<void> {}

  async validateSubmission(
    _run: Run,
    _worker: WorkerRecord,
    commit: string,
  ): Promise<CommitSha> {
    return commit;
  }

  async pinProposal(_run: Run, _proposal: ProposalRecord): Promise<void> {}

  async buildCandidate(): Promise<CandidateResult> {
    return { kind: 'candidate', commit: HEAD };
  }

  async verify(): Promise<VerificationOutcome> {
    return { passed: true, interrupted: false, exitCode: 0, timedOut: false, log: 'ok' };
  }

  async publish(): Promise<void> {}

  async resultHead(): Promise<CommitSha> {
    return HEAD;
  }

  async diff(): Promise<string> {
    return '';
  }
}

class FakeHost implements WorkerHost {
  async start(_request: WorkerStartRequest): Promise<void> {}

  async notify(): Promise<void> {}

  async stop(): Promise<void> {}

  isOwnerLive(): boolean {
    return true;
  }

  isWorkerBusy(): boolean {
    return false;
  }

  workerStatus(): 'running' | 'inactive' | 'unavailable' {
    return 'inactive';
  }

  onSettled(): () => void {
    return () => {};
  }
}

function makeWorker(id: string, sessionId: string): WorkerRecord {
  return {
    id,
    sessionId,
    branch: `swarm/${id}`,
    worktreePath: `/tmp/worktrees/${id}`,
    initializationState: 'ready',
    initializationError: null,
    unavailableReason: null,
    offeredSeq: 0,
    observedSeq: 0,
    notifiedSeq: 0,
    wakeTargetSeq: 0,
    waitRegistration: null,
    currentTaskId: null,
    createdAt: 0,
  };
}

/** 受测 worker 能看到的窄 jobs 面：只有 `list`，并由用例控制状态。 */
class FakeJobs {
  views: { status: string }[] = [];

  list(_caller?: unknown): { status: string }[] {
    return this.views;
  }
}

interface Harness {
  readonly ctx: Context;
  readonly jobs: FakeJobs;
  readonly store: MemoryStateStore;
  readonly artifacts: StoredArtifacts;
  readonly runtime: SwarmRuntime;
  /** 释放本 harness 注册的工具。 */
  readonly dispose: () => void;
  call(toolName: string, args: unknown, agent?: Agent): Promise<ToolExecutionResult>;
}

function agentFor(sessionId: string): Agent {
  // 只暴露 `id` 的最小 Agent：`swarm_*` 只允许从 exec.agent 读取身份。
  return { id: SessionId(sessionId) } as Agent;
}

function toolNames(ctx: Context, scope?: object): string[] {
  return ctx.tools
    .schemas(scope)
    .map((schema) => schema.name)
    .sort();
}

function successValue(result: ToolExecutionResult): Record<string, unknown> {
  if (result.isError) {
    throw new Error(`unexpected tool failure: ${result.error.message}`);
  }
  const value = result.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('tool result is not a JSON object');
  }
  return value;
}

function failureMessage(result: ToolExecutionResult): string {
  if (!result.isError) {
    throw new Error('expected the tool to fail');
  }
  return result.error.message;
}

async function makeHarness(
  options: { withFinishCredential?: boolean; registerTools?: boolean } = {},
): Promise<Harness> {
  const ctx = new Context();
  new SystemPrompt(ctx, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    personaPrefix: '',
    personaSuffix: '',
    toolOrder: undefined,
  });
  new ToolRuntime(ctx, { mode: 'native', maxParallelSubCalls: 10 });

  const jobs = new FakeJobs();
  ctx.provide('jobs', jobs);

  const store = new MemoryStateStore(new InMemoryRunTable());
  const artifacts = new StoredArtifacts(new InMemoryArtifactTable());
  const runtime = new SwarmRuntime(store, new FakeHost(), new FakeWorkspace(), artifacts, {
    eventPageSize: 20,
  });

  const run = createRun({
    id: 'run-1',
    ownerSessionId: 'owner-session',
    repositoryRoot: '/repo',
    gitCommonDir: '/repo/.git',
    goal: 'ship the CSV importer',
    acceptanceCriteria: ['csv import works'],
    verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
    baseCommit: HEAD,
    resultRef: 'refs/heads/swarm-result',
    deadline: 1_000_000,
    createdAt: 0,
  });
  run.phase = 'running';
  run.workers = { w1: makeWorker('w1', 's1'), w2: makeWorker('w2', 's2') };
  if (options.withFinishCredential === true) {
    run.verifications = {
      'verify-1': {
        id: 'verify-1',
        purpose: 'finish',
        commit: HEAD,
        expectedHead: HEAD,
        sourceCommit: null,
        proposalId: null,
        attemptId: null,
        configFingerprint: verificationFingerprint(run.verification),
        status: 'passed',
        receiptRef: 'swarm-artifact:receipt',
        diagnosticsRef: null,
        exitCode: 0,
        timedOut: false,
        createdAt: 0,
        startedAt: 0,
        finishedAt: 0,
      },
    };
  }
  await store.create(run);

  const dispose = options.registerTools === false ? () => {} : registerWorkerTools(ctx, runtime, artifacts);

  let calls = 0;
  return {
    ctx,
    jobs,
    store,
    artifacts,
    runtime,
    dispose,
    async call(toolName, args, agent) {
      calls += 1;
      return ctx.tools.execute({
        callId: ToolCallId(`call-${calls}`),
        name: toolName,
        arguments: args,
        ...(agent === undefined ? {} : { agent }),
        signal: new AbortController().signal,
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* 用例                                                                */
/* ------------------------------------------------------------------ */

describe('worker tools', () => {
  it('registers exactly the nine swarm tools and removes them on dispose', async () => {
    const harness = await makeHarness();
    const before = toolNames(harness.ctx);
    expect(before).toEqual([
      'swarm_finish',
      'swarm_message',
      'swarm_publish',
      'swarm_read',
      'swarm_submit',
      'swarm_sync',
      'swarm_task_create',
      'swarm_task_update',
      'swarm_wait',
    ]);

    harness.dispose();
    expect(toolNames(harness.ctx)).toEqual([]);
  });

  it('rejects arguments that only zod catches', async () => {
    const { call } = await makeHarness();
    const result = await call('swarm_sync', { limit: 0 }, agentFor('s1'));
    expect(failureMessage(result)).toContain('swarm_sync arguments are invalid');
  });

  it('derives identity from exec.agent and refuses agent-less calls', async () => {
    const { call } = await makeHarness();
    const sync = successValue(await call('swarm_sync', {}, agentFor('s2')));
    expect(sync).toMatchObject({
      runId: 'run-1',
      goal: 'ship the CSV importer',
      worker: { id: 'w2', sessionId: 's2' },
    });

    const anonymous = await call('swarm_sync', {});
    expect(failureMessage(anonymous)).toContain('requires an owning agent session');
  });

  it('refuses swarm_wait while an owned job is running', async () => {
    const harness = await makeHarness();
    harness.jobs.views = [{ status: 'running' }, { status: 'completed' }];
    const result = await harness.call('swarm_wait', { after_seq: 0 }, agentFor('s1'));
    expect(failureMessage(result)).toContain('worker already has an outstanding wait');
    expect(result.isError).toBe(true);

    harness.jobs.views = [{ status: 'stopping' }];
    const stopping = await harness.call('swarm_wait', { after_seq: 0 }, agentFor('s1'));
    expect(failureMessage(stopping)).toContain('worker already has an outstanding wait');

    harness.jobs.views = [{ status: 'completed' }];
    const settled = await harness.call('swarm_wait', { after_seq: 0 }, agentFor('s1'));
    expect(successValue(settled)).toMatchObject({ waiting: true });
  });

  it('concludes the turn when swarm_wait parks', async () => {
    const harness = await makeHarness();
    const result = await harness.call('swarm_wait', { after_seq: 0 }, agentFor('s1'));
    expect(successValue(result)).toMatchObject({ waiting: true });
    expect(result).toMatchObject({ isError: false, concludesTurn: true });
  });

  it('concludes the turn when swarm_finish is accepted and the run completes', async () => {
    const harness = await makeHarness({ withFinishCredential: true });
    const completed = new Promise<Run>((resolve) => {
      const unsubscribe = harness.store.subscribe((run) => {
        if (run.phase === 'completed') {
          unsubscribe();
          resolve(run);
        }
      });
    });

    const result = await harness.call(
      'swarm_finish',
      { accepted_commit: HEAD, notes: [{ criterion: 'csv import works', evidence: [HEAD] }] },
      agentFor('s1'),
    );

    expect(successValue(result)).toMatchObject({ status: 'accepted', verificationId: 'verify-1' });
    expect(result).toMatchObject({ isError: false, concludesTurn: true });
    await expect(completed).resolves.toMatchObject({ phase: 'completed', id: 'run-1' });
  });

  it('reads diagnostics only for the caller own run', async () => {
    const harness = await makeHarness();
    const shared = await harness.artifacts.save('run-1', 'verify.log', 'abcdefghij');
    const foreign = await harness.artifacts.save('run-2', 'verify.log', 'secret');

    const page = successValue(
      await harness.call('swarm_read', { id: shared, offset: 2, limit: 4 }, agentFor('s1')),
    );
    expect(page).toMatchObject({ reference: shared, name: 'verify.log', text: 'cdef', total: 10 });

    const denied = await harness.call('swarm_read', { id: foreign }, agentFor('s1'));
    expect(failureMessage(denied)).toContain('Diagnostic belongs to another run');

    const offsetWithoutArtifact = await harness.call('swarm_read', { offset: 1 }, agentFor('s1'));
    expect(failureMessage(offsetWithoutArtifact)).toContain(
      'offset is only supported for diagnostic artifacts',
    );
  });

  it('installs tools and the worker policy in the preset scope and cleans them up', async () => {
    const harness = await makeHarness({ registerTools: false });
    const scope = createScope(harness.ctx, {});
    const key = scopeOf(scope.ctx);

    harness.ctx.provide('swarm', {
      ready: Promise.resolve(harness.runtime),
      artifacts: harness.artifacts,
    });

    expect(toolNames(harness.ctx, key)).toHaveLength(0);

    await apply(scope.ctx);

    expect(pluginName).toBe('swarm-worker');
    expect(inject).toEqual(['swarm', 'tools', 'systemPrompt', 'jobs']);
    // preset scope 拿到 9 个工具，global scope 仍然没有：不污染父 session。
    expect(toolNames(harness.ctx, key)).toHaveLength(9);
    expect(toolNames(harness.ctx)).toHaveLength(0);

    // 同一 scope 再注册同名 policy section 必须失败：说明 worker 已经占用该名字。
    expect(() =>
      scope.ctx.systemPrompt.section({ name: 'swarm:worker-policy', order: 2950, text: 'x' }),
    ).toThrow(/already registered/);

    await scope.dispose();
    expect(toolNames(harness.ctx, key)).toHaveLength(0);
  });
});