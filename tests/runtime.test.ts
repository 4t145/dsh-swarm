/**
 * SwarmRuntime 控制面测试。
 *
 * 依赖边界：
 * - StateStore 用真实 MemoryStateStore + 内存 RunTable；
 * - Delivery / IntegrationQueue 用模块 mock（它们的契约在 notes/runtime-contract.md 固定，
 *   内部实现由各自模块测试覆盖），这里只断言 runtime 的调用顺序与参数；
 * - Host / Workspace / Artifact / Clock 用 fake，不调用真实模型、Git 或子进程；
 * - 所有时序用显式 Promise 屏障与受控时钟推进，不用 sleep 证明竞态。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 模块 mock 共享状态；vi.hoisted 保证在 import runtime 之前建立。 */
const harness = vi.hoisted(() => ({
  delivery: {
    constructed: 0,
    starts: [] as { runId: string; workerId: string }[],
    kicks: [] as string[],
    idleCalls: 0,
    disposeCalls: 0,
    onStart: null as null | ((runId: string, workerId: string) => Promise<void>),
    onKick: null as null | ((runId: string) => Promise<void>),
    idleBarrier: null as null | Promise<void>,
    options: null as null | {
      admitWorkerOperation: (
        runId: string,
        workerId: string,
        kind: 'create' | 'notify',
      ) => Promise<{ signal: AbortSignal; release(): void }>;
      onError: (runId: string, error: unknown) => void;
    },
  },
  integration: {
    constructed: 0,
    processes: [] as string[],
    interrupts: [] as { runId: string; reason: string }[],
    recovers: [] as string[],
    idles: [] as (string | undefined)[],
    onProcess: null as null | ((runId: string) => Promise<void>),
    gate: null as unknown,
  },
}));

vi.mock('../src/delivery.ts', () => ({
  Delivery: class MockDelivery {
    constructor(_store: unknown, _host: unknown, options: typeof harness.delivery.options) {
      harness.delivery.constructed += 1;
      harness.delivery.options = options;
    }

    async start(runId: string, workerId: string): Promise<void> {
      harness.delivery.starts.push({ runId, workerId });
      if (harness.delivery.onStart !== null) {
        await harness.delivery.onStart(runId, workerId);
      }
    }

    async resume(runId: string, workerId: string): Promise<void> {
      harness.delivery.kicks.push(`${runId}:${workerId}:resume`);
    }

    async kick(runId: string): Promise<void> {
      harness.delivery.kicks.push(runId);
      if (harness.delivery.onKick !== null) {
        await harness.delivery.onKick(runId);
      }
    }

    async idle(): Promise<void> {
      harness.delivery.idleCalls += 1;
      if (harness.delivery.idleBarrier !== null) {
        await harness.delivery.idleBarrier;
      }
    }

    async dispose(): Promise<void> {
      harness.delivery.disposeCalls += 1;
    }
  },
}));

vi.mock('../src/integration.ts', () => ({
  IntegrationQueue: class MockIntegrationQueue {
    constructor(
      _store: unknown,
      _workspace: unknown,
      _artifacts: unknown,
      gate: unknown,
      _options: unknown,
    ) {
      harness.integration.constructed += 1;
      harness.integration.gate = gate;
    }

    async process(runId: string): Promise<void> {
      harness.integration.processes.push(runId);
      if (harness.integration.onProcess !== null) {
        await harness.integration.onProcess(runId);
      }
    }

    async recover(runId: string): Promise<void> {
      harness.integration.recovers.push(runId);
    }

    async interrupt(runId: string, reason: 'pause' | 'stop' | 'budget'): Promise<void> {
      harness.integration.interrupts.push({ runId, reason });
    }

    async idle(runId?: string): Promise<void> {
      harness.integration.idles.push(runId);
    }
  },
}));

import { SwarmError } from '../src/errors.ts';
import { verificationFingerprint } from '../src/ports.ts';
import type {
  ArtifactPort,
  CandidateResult,
  Clock,
  RepositoryInfo,
  VerificationOutcome,
  WorkerHost,
  WorkerStartRequest,
  WorkspacePort,
} from '../src/ports.ts';
import { SwarmRuntime, type SwarmRuntimeOptions } from '../src/runtime.ts';
import { createMemoryStateStore, type RunTable, type StateStore } from '../src/store.ts';
import type {
  CommitSha,
  ProposalRecord,
  Run,
  RunId,
  RunSpec,
  WorkerRecord,
} from '../src/types.ts';

/* ------------------------------------------------------------------ */
/* fake 环境                                                           */
/* ------------------------------------------------------------------ */

const OWNER = 'owner-session-1';

const BASE_SPEC: RunSpec = {
  specPath: '/tmp/swarm/spec.json',
  repository: '/repo',
  baseRef: 'HEAD',
  goal: '为项目增加 CSV 导入',
  acceptanceCriteria: ['CSV 导入结果正确', 'CLI 可调用导入并报告错误'],
  workers: 2,
  budgetMinutes: 30,
  allowDirtyBaseline: false,
  verification: {
    setup: [],
    test: [{ argv: ['npm', 'test'], timeoutMs: 60_000 }],
  },
};

class InMemoryRunTable implements RunTable {
  private readonly records = new Map<string, Run>();

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

/** 受控时钟：只有显式 advance 才让 timer 到期。 */
class FakeClock implements Clock {
  private current: number;
  private sequence = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  constructor(start = 1_000_000) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): () => void {
    this.sequence += 1;
    const id = this.sequence;
    this.timers.set(id, { at: this.current + delayMs, callback });
    return () => {
      this.timers.delete(id);
    };
  }

  /** 推进时间并触发所有到期 timer（按到期时间排序）。 */
  advance(ms: number): void {
    this.current += ms;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.current)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }

  pendingTimers(): number {
    return this.timers.size;
  }
}

class FakeWorkspace implements WorkspacePort {
  info: RepositoryInfo = {
    repositoryRoot: '/repo',
    gitCommonDir: '/repo/.git',
    baseCommit: 'h0',
    dirty: false,
  };
  inspectCalls = 0;
  validateSubmissionCalls = 0;
  validated: CommitSha[] = [];
  pinned: ProposalRecord[] = [];
  /** 非空时 validateSubmission 会等待它，用来制造“提交被 stop 打断”的竞态。 */
  validateBarrier: Promise<void> | null = null;
  /** 非空时在 validateSubmission 返回前执行，用来制造“校验后、CAS 前被并发修改”。 */
  afterValidate: (() => Promise<void>) | null = null;

  async inspect(): Promise<RepositoryInfo> {
    this.inspectCalls += 1;
    return this.info;
  }

  async initializeResult(): Promise<void> {}

  async validateSubmission(
    _run: Run,
    _worker: WorkerRecord,
    commit: string,
    signal?: AbortSignal,
  ): Promise<CommitSha> {
    this.validateSubmissionCalls += 1;
    if (this.validateBarrier !== null) {
      await this.validateBarrier;
    }
    if (signal?.aborted === true) {
      throw new SwarmError('SWARM_INVALID_STATE', 'validateSubmission aborted by admission close');
    }
    this.validated.push(commit);
    if (this.afterValidate !== null) {
      await this.afterValidate();
    }
    return commit;
  }

  async pinProposal(_run: Run, proposal: ProposalRecord): Promise<void> {
    this.pinned.push(proposal);
  }

  async buildCandidate(): Promise<CandidateResult> {
    return { kind: 'candidate', commit: 'm1' };
  }

  async verify(): Promise<VerificationOutcome> {
    return { passed: true, interrupted: false, exitCode: 0, timedOut: false, log: 'ok' };
  }

  async publish(): Promise<void> {}

  async resultHead(): Promise<CommitSha> {
    return 'h0';
  }

  async diff(): Promise<string> {
    return '';
  }
}

class FakeHost implements WorkerHost {
  live = true;
  nativeStatus: 'running' | 'inactive' | 'unavailable' = 'inactive';
  readonly stopped: RunId[] = [];

  async start(_request: WorkerStartRequest): Promise<void> {}

  async notify(): Promise<void> {}

  async stop(run: Run): Promise<void> {
    this.stopped.push(run.id);
  }

  isOwnerLive(): boolean {
    return this.live;
  }

  isWorkerBusy(): boolean {
    return false;
  }

  workerStatus(): 'running' | 'inactive' | 'unavailable' {
    return this.nativeStatus;
  }

  onSettled(): () => void {
    return () => {};
  }
}

class FakeArtifacts implements ArtifactPort {
  readonly saved: { runId: string; name: string; text: string }[] = [];

  async save(runId: string, name: string, text: string): Promise<string> {
    this.saved.push({ runId, name, text });
    return `artifact://${runId}/${name}`;
  }

  async read(reference: string): Promise<string> {
    return reference;
  }
}

interface Harness {
  runtime: SwarmRuntime;
  store: StateStore;
  table: InMemoryRunTable;
  host: FakeHost;
  workspace: FakeWorkspace;
  artifacts: FakeArtifacts;
  clock: FakeClock;
}

function createHarness(options: { start?: number; runtime?: SwarmRuntimeOptions } = {}): Harness {
  const table = new InMemoryRunTable();
  const store = createMemoryStateStore(table);
  const host = new FakeHost();
  const workspace = new FakeWorkspace();
  const artifacts = new FakeArtifacts();
  const clock = new FakeClock(options.start ?? 1_000_000);
  let counter = 0;
  const runtime = new SwarmRuntime(store, host, workspace, artifacts, {
    clock,
    id: () => `id-${(counter += 1)}`,
    eventPageSize: 20,
    ...options.runtime,
  });
  return { runtime, store, table, host, workspace, artifacts, clock };
}

/** 让已排队的微任务与 store 串行链跑完；不依赖任何真实时间。 */
function macrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function waitFor(check: () => boolean, what: string, attempts = 200): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (check()) {
      return;
    }
    await macrotask();
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * 模拟 native host 在 agent/created 内写回 worktree 与 ready 状态。
 */
async function markWorkerReady(
  store: StateStore,
  runId: string,
  workerId: string,
): Promise<void> {
  await store.update(runId, (run) => {
    const worker = run.workers[workerId];
    if (worker === undefined) {
      throw new Error(`worker ${workerId} was not reserved`);
    }
    return {
      ...run,
      workers: {
        ...run.workers,
        [worker.id]: {
          ...worker,
          initializationState: 'ready',
          worktreePath: `/repo/.agents/worktrees/${worker.id}`,
        },
      },
    };
  });
}

/** Delivery mock 的默认行为：host.start 成功即写 ready。 */
function installReadyWorkerHook(store: StateStore): void {
  harness.delivery.onStart = (runId: string, workerId: string) =>
    markWorkerReady(store, runId, workerId);
}

/** 造一个已认领的 code 任务，满足 submit 的前置条件。 */
async function seedClaimedTask(
  store: StateStore,
  runId: RunId,
  workerId: string,
  revision = 1,
): Promise<void> {
  await store.update(runId, (run) => {
    const worker = run.workers[workerId];
    if (worker === undefined) {
      throw new Error(`worker ${workerId} is missing`);
    }
    const now = run.updatedAt;
    return {
      ...run,
      tasks: {
        ...run.tasks,
        t1: {
          id: 't1',
          revision,
          createdByWorkerId: worker.id,
          kind: 'code',
          subject: 'CSV 解析',
          acceptance: '解析函数返回 Row[]',
          scope: ['src/csv.ts'],
          status: 'claimed',
          ownerWorkerId: worker.id,
          proposalId: null,
          resultFindingId: null,
          blockReason: null,
          cancellationReason: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      workers: { ...run.workers, [worker.id]: { ...worker, currentTaskId: 't1' } },
    };
  });
}

function workerIds(run: Run): string[] {
  return Object.keys(run.workers);
}

async function startRun(harnessIn: Harness, specOverrides: Partial<RunSpec> = {}): Promise<Run> {
  installReadyWorkerHook(harnessIn.store);
  return harnessIn.runtime.start(OWNER, { ...BASE_SPEC, ...specOverrides });
}

function firstWorkerSession(run: Run): string {
  const [worker] = Object.values(run.workers);
  if (worker === undefined) {
    throw new Error('run has no workers');
  }
  return worker.sessionId;
}

/** 等待所有预留 worker 都写完 ready（其余 worker 是异步初始化的）。 */
async function settleWorkers(h: Harness, runId: RunId): Promise<void> {
  await waitFor(
    () =>
      Object.values(h.store.get(runId).workers).every(
        (worker) => worker.initializationState === 'ready',
      ),
    'all workers ready',
  );
}

/* ------------------------------------------------------------------ */
/* 测试                                                               */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  harness.delivery.constructed = 0;
  harness.delivery.starts.length = 0;
  harness.delivery.kicks.length = 0;
  harness.delivery.idleCalls = 0;
  harness.delivery.disposeCalls = 0;
  harness.delivery.onStart = null;
  harness.delivery.onKick = null;
  harness.delivery.idleBarrier = null;
  harness.delivery.options = null;
  harness.integration.constructed = 0;
  harness.integration.processes.length = 0;
  harness.integration.interrupts.length = 0;
  harness.integration.recovers.length = 0;
  harness.integration.idles.length = 0;
  harness.integration.onProcess = null;
  harness.integration.gate = null;
});

describe('start', () => {
  it('预留 worker、首个 worker ready 后进入 running，其余 worker 异步启动', async () => {
    const h = createHarness();
    let releaseRemaining: () => void = () => {};
    const remainingGate = new Promise<void>((resolve) => {
      releaseRemaining = resolve;
    });
    // 第 2、3 个 worker 的 host.start 停在屏障上：start 不应等待它们。
    harness.delivery.onStart = async (runId, workerId) => {
      if (!workerId.endsWith('-w1')) {
        await remainingGate;
      }
      await markWorkerReady(h.store, runId, workerId);
    };

    const run = await h.runtime.start(OWNER, { ...BASE_SPEC, workers: 3 });

    expect(run.phase).toBe('running');
    expect(Object.keys(run.workers)).toHaveLength(3);
    const first = Object.values(run.workers)[0];
    expect(first?.initializationState).toBe('ready');
    expect(first?.sessionId).toBe(`${run.id}-w1-session`);
    expect(first?.branch).toBe(`${run.id}-w1`);
    expect(first?.worktreePath).toBe(`/repo/.agents/worktrees/${run.id}-w1`);
    expect(run.baseCommit).toBe('h0');
    expect(run.acceptedHead).toBe('h0');
    expect(run.deadline).toBe(1_000_000 + 30 * 60_000);
    expect(run.resultRef).toBe(`refs/heads/swarm-${run.id}-result`);

    // start 已经返回，但另外两个 worker 仍在初始化阶段。
    const ready = Object.values(h.store.get(run.id).workers).filter(
      (worker) => worker.initializationState === 'ready',
    );
    expect(ready).toHaveLength(1);
    expect(harness.delivery.starts).toHaveLength(3);
    expect(harness.integration.constructed).toBe(1);

    releaseRemaining();
    await settleWorkers(h, run.id);
  });

  it('同一仓库已有非终态 run（含 paused）时拒绝启动新 run', async () => {
    const h = createHarness();
    const run = await startRun(h);
    await h.runtime.pause(OWNER);

    await expect(h.runtime.start(OWNER, BASE_SPEC)).rejects.toMatchObject({
      code: 'SWARM_INVALID_STATE',
      details: { gitCommonDir: '/repo/.git' },
    });
    await expect(h.runtime.start('other-owner', BASE_SPEC)).rejects.toMatchObject({
      code: 'SWARM_INVALID_STATE',
    });
    expect(h.store.get(run.id).phase).toBe('paused');
  });

  it('脏基线默认拒绝，allowDirtyBaseline=true 时接受', async () => {
    const h = createHarness();
    h.workspace.info = { ...h.workspace.info, dirty: true };

    await expect(startRun(h)).rejects.toMatchObject({ code: 'SWARM_INVALID_SPEC' });
    expect(h.store.list()).toHaveLength(0);

    installReadyWorkerHook(h.store);
    const run = await h.runtime.start(OWNER, { ...BASE_SPEC, allowDirtyBaseline: true });
    expect(run.phase).toBe('running');
    expect(run.allowDirtyBaseline).toBe(true);
  });

  it('owner 不在线时拒绝启动', async () => {
    const h = createHarness();
    h.host.live = false;
    await expect(startRun(h)).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    expect(h.workspace.inspectCalls).toBe(0);
  });

  it('首个 worker 初始化失败时本 run 收尾为 failed 并保留诊断', async () => {
    const h = createHarness();
    harness.delivery.onStart = async () => {
      throw new Error('worktree create failed');
    };
    await expect(h.runtime.start(OWNER, BASE_SPEC)).rejects.toMatchObject({
      code: 'SWARM_INTERNAL',
    });
    const [run] = h.store.list();
    expect(run?.phase).toBe('failed');
    expect(run?.quiesceTarget).toBeNull();
    expect(h.host.stopped).toContain(run?.id);
    expect(h.artifacts.saved.map((entry) => entry.name)).toContain(
      'worker_initialization_failed',
    );
  });
});

describe('pause / resume / stop 与预算', () => {
  it('pause 先持久化 quiescing 再停资源，最后 paused 且取消 deadline timer', async () => {
    const h = createHarness();
    const run = await startRun(h);
    expect(h.clock.pendingTimers()).toBe(1);

    let releaseIdle: () => void = () => {};
    harness.delivery.idleBarrier = new Promise<void>((resolve) => {
      releaseIdle = resolve;
    });

    const pausing = h.runtime.pause(OWNER);
    await waitFor(() => h.store.get(run.id).phase === 'quiescing', 'quiescing before resources');
    expect(h.store.get(run.id).quiesceTarget).toBe('paused');
    expect(h.host.stopped).toHaveLength(0);

    releaseIdle();
    const paused = await pausing;
    expect(paused.phase).toBe('paused');
    expect(paused.quiesceTarget).toBeNull();
    expect(h.host.stopped).toEqual([run.id]);
    expect(harness.integration.interrupts).toEqual([{ runId: run.id, reason: 'pause' }]);
    expect(h.clock.pendingTimers()).toBe(0);

    // paused 不排 timer，但绝对 deadline 照常推进。
    h.clock.advance(60 * 60_000);
    expect(h.store.get(run.id).phase).toBe('paused');
    expect(h.store.get(run.id).deadline).toBe(1_000_000 + 30 * 60_000);
  });

  it('活动 run 预算到期进入 stopped(budget_exhausted)，不是 completed', async () => {
    const h = createHarness();
    const run = await startRun(h, { budgetMinutes: 1 });

    h.clock.advance(60_000);
    await waitFor(() => h.store.get(run.id).phase === 'stopped', 'budget stop');

    const stopped = h.store.get(run.id);
    expect(stopped.phase).toBe('stopped');
    expect(stopped.reason).toBe('budget_exhausted');
    expect(stopped.budgetExpiredAt).toBe(1_000_000 + 60_000);
    expect(h.host.stopped).toEqual([run.id]);
    expect(harness.integration.interrupts).toEqual([{ runId: run.id, reason: 'budget' }]);
  });

  it('paused 且过期时 resume 必须追加预算；追加后 deadline 从当前时间重算', async () => {
    const h = createHarness();
    const run = await startRun(h, { budgetMinutes: 1 });
    await h.runtime.pause(OWNER);
    h.clock.advance(5 * 60_000);

    await expect(h.runtime.resume(OWNER)).rejects.toMatchObject({
      code: 'SWARM_BUDGET_EXHAUSTED',
    });
    // paused 不跑截止 timer，过期事实在 resume 尝试时落盘；run 保持 paused。
    const expired = h.store.get(run.id);
    expect(expired.phase).toBe('paused');
    expect(expired.budgetExpiredAt).toBe(h.clock.now());
    expect(h.runtime.status(OWNER).budgetExpired).toBe(true);

    const resumed = await h.runtime.resume(OWNER, 10);
    expect(resumed.phase).toBe('running');
    expect(resumed.deadline).toBe(h.clock.now() + 10 * 60_000);
    expect(resumed.budgetExpiredAt).toBeNull();
    expect(h.clock.pendingTimers()).toBe(1);
    expect(harness.delivery.kicks).toContain(run.id);
  });

  it('终态 run 不能 resume', async () => {
    const h = createHarness();
    const run = await startRun(h);
    await h.runtime.stop(OWNER);
    expect(h.store.get(run.id).phase).toBe('stopped');

    await expect(h.runtime.resume(OWNER, 10)).rejects.toMatchObject({
      code: 'SWARM_INVALID_STATE',
    });
    await expect(h.runtime.stop(OWNER)).rejects.toMatchObject({ code: 'SWARM_NOT_FOUND' });
  });

  it('stop 等待在途提交被取消后才确认 stopped', async () => {
    const h = createHarness();
    const run = await startRun(h);
    const workerId = workerIds(run)[0];
    if (workerId === undefined) {
      throw new Error('missing worker');
    }
    await seedClaimedTask(h.store, run.id, workerId);

    let releaseValidate: () => void = () => {};
    h.workspace.validateBarrier = new Promise<void>((resolve) => {
      releaseValidate = resolve;
    });

    const submitting = h.runtime.submit(
      firstWorkerSession(run),
      { taskId: 't1', expectedRevision: 1, sourceCommit: 'c1' },
      'call-1',
    );
    await waitFor(() => h.workspace.validateSubmissionCalls === 1, 'submit to reach workspace');

    const stopping = h.runtime.stop(OWNER);
    await waitFor(() => h.store.get(run.id).phase === 'quiescing', 'quiescing before abort');
    // 停止请求已到达，但资源未静止：不能宣称已停止，也不能先停原生会话。
    expect(h.host.stopped).toHaveLength(0);

    releaseValidate();
    await expect(submitting).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    const stopped = await stopping;
    expect(stopped.phase).toBe('stopped');
    expect(h.host.stopped).toEqual([run.id]);
    // 被取消的提交没有产生 proposal，也没有改动任务。
    expect(h.store.get(run.id).proposals).toEqual({});
    expect(h.store.get(run.id).tasks['t1']?.status).toBe('claimed');
    expect(h.workspace.pinned).toHaveLength(0);
  });
});

describe('submit', () => {
  it('同一次调用命中 receipt 时只回放已有 Proposal，不重复访问 Git', async () => {
    const h = createHarness();
    const run = await startRun(h);
    const workerId = workerIds(run)[0];
    if (workerId === undefined) {
      throw new Error('missing worker');
    }
    await seedClaimedTask(h.store, run.id, workerId);
    const session = firstWorkerSession(run);

    const first = await h.runtime.submit(
      session,
      { taskId: 't1', expectedRevision: 1, sourceCommit: 'c1' },
      'call-1',
    );
    expect(first.status).toBe('queued');
    expect(first.sourceCommit).toBe('c1');
    expect(first.proposalRef).toBe(`refs/swarm/${run.id}/proposals/${first.id}`);
    expect(h.workspace.validateSubmissionCalls).toBe(1);
    expect(h.workspace.pinned).toHaveLength(1);

    const persisted = h.store.get(run.id);
    expect(persisted.tasks['t1']?.status).toBe('proposed');
    expect(persisted.tasks['t1']?.revision).toBe(2);
    expect(persisted.tasks['t1']?.proposalId).toBe(first.id);
    expect(persisted.workers[workerId]?.waitRegistration).toBeNull();
    expect(persisted.events.filter((event) => event.kind === 'proposal')).toHaveLength(1);

    const replay = await h.runtime.submit(
      session,
      { taskId: 't1', expectedRevision: 1, sourceCommit: 'c1' },
      'call-1',
    );
    expect(replay.id).toBe(first.id);
    expect(h.workspace.validateSubmissionCalls).toBe(1);
    expect(harness.integration.processes).toContain(run.id);
  });

  it('拒绝过期 revision，且不产生 Git 或 store 副作用', async () => {
    const h = createHarness();
    const run = await startRun(h);
    const workerId = workerIds(run)[0];
    if (workerId === undefined) {
      throw new Error('missing worker');
    }
    await seedClaimedTask(h.store, run.id, workerId, 3);

    await expect(
      h.runtime.submit(
        firstWorkerSession(run),
        { taskId: 't1', expectedRevision: 1, sourceCommit: 'c1' },
        'call-1',
      ),
    ).rejects.toMatchObject({ code: 'SWARM_STALE_REVISION' });
    expect(h.workspace.validateSubmissionCalls).toBe(0);
    expect(h.store.get(run.id).tasks['t1']?.status).toBe('claimed');
  });

  it('校验通过后、CAS 写入前任务被并发修改时不写入，返回 SWARM_STALE_REVISION', async () => {
    const h = createHarness();
    const run = await startRun(h);
    const workerId = workerIds(run)[0];
    if (workerId === undefined) {
      throw new Error('missing worker');
    }
    await seedClaimedTask(h.store, run.id, workerId);
    // Git 校验与 store 写入之间，另一个控制面更新推进了任务 revision。
    h.workspace.afterValidate = async () => {
      await h.store.update(run.id, (current) => {
        const task = current.tasks['t1'];
        if (task === undefined) {
          return current;
        }
        return {
          ...current,
          tasks: {
            ...current.tasks,
            // 仍归原 owner，但 revision 已推进（例如并发修改了验收说明）。
            t1: { ...task, revision: task.revision + 1, subject: 'changed concurrently' },
          },
        };
      });
    };

    await expect(
      h.runtime.submit(
        firstWorkerSession(run),
        { taskId: 't1', expectedRevision: 1, sourceCommit: 'c1' },
        'call-race',
      ),
    ).rejects.toMatchObject({ code: 'SWARM_STALE_REVISION' });

    const after = h.store.get(run.id);
    expect(after.proposals).toEqual({});
    expect(after.mutationReceipts).toEqual({});
    expect(after.tasks['t1']?.revision).toBe(2);
    expect(after.tasks['t1']?.status).toBe('claimed');
  });

  it('draining 下的 submit 返回 SWARM_NOT_RUNNING 且无副作用', async () => {
    const h = createHarness();
    const run = await startRun(h);
    await settleWorkers(h, run.id);

    // 没有未收束任务，finish 的结构条件满足，run 进入 draining。
    const decision = await h.runtime.finish(
      firstWorkerSession(run),
      {
        acceptedCommit: 'h0',
        notes: BASE_SPEC.acceptanceCriteria.map((criterion) => ({
          criterion,
          evidence: ['node --test'],
        })),
      },
      'finish-1',
    );
    expect(decision.status).toBe('accepted');
    expect(h.store.get(run.id).phase).toBe('draining');

    await expect(
      h.runtime.submit(
        firstWorkerSession(run),
        { taskId: 't2', expectedRevision: 1, sourceCommit: 'c9' },
        'call-2',
      ),
    ).rejects.toMatchObject({ code: 'SWARM_NOT_RUNNING' });
    expect(h.workspace.validateSubmissionCalls).toBe(0);
  });
});

describe('finish', () => {
  const notes = BASE_SPEC.acceptanceCriteria.map((criterion) => ({
    criterion,
    evidence: ['node --test output'],
  }));

  it('原子受理进入 draining，重复 finish 返回 already_finishing', async () => {
    const h = createHarness();
    const run = await startRun(h);
    await settleWorkers(h, run.id);
    const session = firstWorkerSession(run);
    const requester = Object.values(h.store.get(run.id).workers)[0];
    if (requester === undefined) {
      throw new Error('missing worker');
    }
    // 提出者此前登记过等待：成功受理 finish 必须清除它。
    await h.store.update(run.id, (current) => ({
      ...current,
      workers: {
        ...current.workers,
        [requester.id]: {
          ...requester,
          waitRegistration: { afterSeq: 0, mode: 'any', taskIds: [], proposalIds: [] },
        },
      },
    }));

    const accepted = await h.runtime.finish(session, { acceptedCommit: 'h0', notes }, 'finish-1');
    expect(accepted).toMatchObject({ status: 'accepted' });
    if (accepted.status !== 'accepted') {
      throw new Error('expected acceptance');
    }
    expect(accepted.verificationId).not.toBeNull();

    const persisted = h.store.get(run.id);
    expect(persisted.phase).toBe('draining');
    expect(persisted.workers[requester.id]?.waitRegistration).toBeNull();
    expect(persisted.finishRequest?.id).toBe(accepted.finishRequestId);
    expect(persisted.finishRequest?.verificationId).toBe(accepted.verificationId);
    const verification = Object.values(persisted.verifications)[0];
    expect(verification?.purpose).toBe('finish');
    expect(verification?.commit).toBe('h0');
    expect(verification?.expectedHead).toBe('h0');
    expect(verification?.status).toBe('queued');
    expect(harness.integration.processes).toContain(run.id);

    const duplicate = await h.runtime.finish(
      session,
      { acceptedCommit: 'h0', notes },
      'finish-2',
    );
    expect(duplicate).toEqual({
      status: 'already_finishing',
      finishRequestId: accepted.finishRequestId,
      verificationId: accepted.verificationId,
    });
    expect(h.store.get(run.id).events.filter((event) => event.kind === 'run')).toHaveLength(2);
  });

  it('前置检查通过后并发开了新任务时，原子受理拒绝且仍为 running', async () => {
    const h = createHarness();
    const run = await startRun(h);
    await settleWorkers(h, run.id);
    const session = firstWorkerSession(run);

    // 在 finish 的原子写之前插入一个 open 任务，模拟并发 task_create。
    const originalUpdate = h.store.update.bind(h.store);
    let injected = false;
    h.store.update = async (id, reducer) => {
      if (!injected && id === run.id) {
        injected = true;
        await originalUpdate(id, (current) => ({
          ...current,
          tasks: {
            ...current.tasks,
            't-concurrent': {
              id: 't-concurrent',
              revision: 1,
              createdByWorkerId: null,
              kind: 'code',
              subject: '并发任务',
              acceptance: '任意验收',
              scope: [],
              status: 'open',
              ownerWorkerId: null,
              proposalId: null,
              resultFindingId: null,
              blockReason: null,
              cancellationReason: null,
              createdAt: current.updatedAt,
              updatedAt: current.updatedAt,
            },
          },
        }));
      }
      return originalUpdate(id, reducer);
    };

    await expect(
      h.runtime.finish(session, { acceptedCommit: 'h0', notes }, 'finish-race'),
    ).rejects.toMatchObject({
      code: 'SWARM_INVALID_STATE',
      details: { unfinishedTasks: [{ taskId: 't-concurrent', status: 'open' }] },
    });

    const after = h.store.get(run.id);
    expect(after.phase).toBe('running');
    expect(after.finishRequest).toBeNull();
    expect(after.mutationReceipts).toEqual({});
  });

  it('验收项未逐条覆盖时拒绝并给出字段诊断', async () => {
    const h = createHarness();
    const run = await startRun(h);
    const session = firstWorkerSession(run);

    await expect(
      h.runtime.finish(
        session,
        {
          acceptedCommit: 'h0',
          notes: [
            { criterion: BASE_SPEC.acceptanceCriteria[0] ?? '', evidence: ['x'] },
            { criterion: '编造的验收项', evidence: ['y'] },
          ],
        },
        'finish-1',
      ),
    ).rejects.toMatchObject({
      code: 'SWARM_INVALID_STATE',
      details: {
        missingCriteria: [BASE_SPEC.acceptanceCriteria[1]],
        unknownCriteria: ['编造的验收项'],
      },
    });
    expect(h.store.get(run.id).phase).toBe('running');
    expect(h.store.get(run.id).finishRequest).toBeNull();
  });

  it('引用旧 acceptedHead 的 finish 返回 SWARM_STALE_HEAD', async () => {
    const h = createHarness();
    await startRun(h);
    const run = h.store.list()[0];
    if (run === undefined) {
      throw new Error('missing run');
    }
    await expect(
      h.runtime.finish(
        firstWorkerSession(run),
        { acceptedCommit: 'old-sha', notes },
        'finish-1',
      ),
    ).rejects.toMatchObject({ code: 'SWARM_STALE_HEAD' });
  });

  it('已有匹配 passed 验证时复用记录，并在订阅驱动的收尾中到达 completed', async () => {
    const h = createHarness();
    const run = await startRun(h);
    await settleWorkers(h, run.id);
    const session = firstWorkerSession(run);
    const fingerprint = verificationFingerprint(BASE_SPEC.verification);

    await h.store.update(run.id, (current) => ({
      ...current,
      verifications: {
        'v-existing': {
          id: 'v-existing',
          purpose: 'proposal',
          commit: 'h0',
          expectedHead: 'h0',
          sourceCommit: null,
          proposalId: null,
          attemptId: null,
          configFingerprint: fingerprint,
          status: 'passed',
          receiptRef: 'artifact://receipt',
          diagnosticsRef: null,
          exitCode: 0,
          timedOut: false,
          createdAt: current.updatedAt,
          startedAt: current.updatedAt,
          finishedAt: current.updatedAt,
        },
      },
    }));

    const accepted = await h.runtime.finish(session, { acceptedCommit: 'h0', notes }, 'finish-1');
    expect(accepted).toMatchObject({ status: 'accepted', verificationId: 'v-existing' });

    await waitFor(() => h.store.get(run.id).phase === 'completed', 'completed after finish');
    const completed = h.store.get(run.id);
    expect(completed.quiesceTarget).toBeNull();
    expect(completed.finishRequest?.verificationId).toBe('v-existing');
    expect(h.host.stopped).toEqual([run.id]);
    // 复用 passed 记录时不创建新的 finish verification、也不再跑集成。
    expect(Object.keys(completed.verifications)).toEqual(['v-existing']);
    expect(harness.integration.processes).toHaveLength(0);
  });
});

describe('admission 与失败处理', () => {
  it('关闭 admission 后 Delivery 无法登记新操作', async () => {
    const h = createHarness();
    const run = await startRun(h);
    const workerId = workerIds(run)[0];
    if (workerId === undefined) {
      throw new Error('missing worker');
    }
    const options = harness.delivery.options;
    if (options === null) {
      throw new Error('delivery options were not captured');
    }

    const permit = await options.admitWorkerOperation(run.id, workerId, 'notify');
    expect(permit.signal.aborted).toBe(false);
    permit.release();

    await h.runtime.stop(OWNER);
    await expect(options.admitWorkerOperation(run.id, workerId, 'notify')).rejects.toMatchObject({
      code: 'SWARM_NOT_RUNNING',
    });
  });

  it('Delivery 上报的错误把 run 收尾为 failed 并写诊断', async () => {
    const h = createHarness();
    const run = await startRun(h);
    const options = harness.delivery.options;
    if (options === null) {
      throw new Error('delivery options were not captured');
    }

    options.onError(run.id, new Error('subagent session vanished'));
    await waitFor(() => h.store.get(run.id).phase === 'failed', 'failed run');

    const status = h.runtime.status(OWNER);
    expect(status.phase).toBe('failed');
    expect(status.diagnostics.join(' ')).toContain('subagent session vanished');
    expect(h.artifacts.saved.some((entry) => entry.name === 'delivery_error')).toBe(true);
  });
});

describe('recover', () => {
  it('未终止 run 默认 paused，只补 Git 事实，不启动 worker', async () => {
    const h = createHarness();
    const run = await startRun(h);
    await h.runtime.dispose();

    harness.delivery.starts.length = 0;
    harness.integration.recovers.length = 0;
    // 复用同一个持久 store，模拟进程重启。
    const recoveredStore = h.store;
    const recoveredHost = new FakeHost();
    recoveredHost.live = false;
    let counter = 100;
    const runtime = new SwarmRuntime(
      recoveredStore,
      recoveredHost,
      h.workspace,
      h.artifacts,
      { clock: h.clock, id: () => `id-${(counter += 1)}` },
    );

    await runtime.recover();
    const recovered = recoveredStore.get(run.id);
    expect(recovered.phase).toBe('paused');
    expect(recovered.reason).toBe('owner_offline');
    expect(recovered.quiesceTarget).toBeNull();
    expect(harness.integration.recovers).toEqual([run.id]);
    expect(harness.delivery.starts).toHaveLength(0);
    await runtime.dispose();
  });
});

describe('status', () => {
  it('摘要含进度计数与原生状态，details 有界且不含消息正文', async () => {
    const h = createHarness({ runtime: { eventPageSize: 2 } });
    const run = await startRun(h, { workers: 3 });
    h.host.nativeStatus = 'running';

    await h.store.update(run.id, (current) => ({
      ...current,
      messages: {
        'm1': {
          id: 'm1',
          seq: 1,
          authorWorkerId: `${run.id}-w1`,
          targetWorkerId: `${run.id}-w2`,
          body: 'private note: do not leak',
          createdAt: current.updatedAt,
        },
      },
    }));

    const summary = h.runtime.status(OWNER);
    expect(summary.runId).toBe(run.id);
    expect(summary.phase).toBe('running');
    expect(summary.workers).toHaveLength(3);
    expect(summary.workers[0]?.nativeStatus).toBe('running');
    expect(summary.tasks).toMatchObject({ total: 0, done: 0, cancelled: 0 });
    expect(summary.admission).toBe('open');
    expect(JSON.stringify(summary)).not.toContain('private note');

    const details = h.runtime.status(OWNER, true);
    expect(details.details?.workers).toHaveLength(2);
    expect(details.details?.eventCount).toBeGreaterThan(0);
    expect(details.details?.messageCount).toBe(1);
    expect(details.details?.resultRefConsistency).toBe('unverified');
    expect(JSON.stringify(details)).not.toContain('private note');
  });

  it('没有 run 时抛 SWARM_NOT_FOUND', () => {
    const h = createHarness();
    expect(() => h.runtime.status(OWNER)).toThrow(SwarmError);
    try {
      h.runtime.status(OWNER);
    } catch (error) {
      expect(error).toMatchObject({ code: 'SWARM_NOT_FOUND' });
    }
  });
});

describe('cross-module wiring regressions', () => {
  it('reserves one repository atomically and initializes its public ref once', async () => {
    const h = createHarness();
    installReadyWorkerHook(h.store);
    const initialize = vi.spyOn(h.workspace, 'initializeResult');
    const results = await Promise.allSettled([
      h.runtime.start(OWNER, BASE_SPEC),
      h.runtime.start('another-owner', BASE_SPEC),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(h.store.list()).toHaveLength(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    await h.runtime.dispose();
  });

  it('pauses a failed worker activation without turning it into permanent run failure', async () => {
    const h = createHarness();
    const run = await startRun(h);
    await settleWorkers(h, run.id);
    harness.delivery.options?.onError(run.id, new SwarmError('SWARM_INTERNAL', 'worker failed', {
      details: { workerId: workerIds(run)[0] ?? '', activationId: 'activation-1' },
    }));
    await waitFor(() => h.store.get(run.id).phase === 'paused', 'worker failure pause');
    expect(h.store.get(run.id).reason).toBe('worker_activation_failed');
    await h.runtime.dispose();
  });

  it('explicitly resumes all retained workers even with no unread events', async () => {
    const h = createHarness();
    const run = await startRun(h);
    await settleWorkers(h, run.id);
    await seedClaimedTask(h.store, run.id, workerIds(run)[0]!);
    await h.runtime.pause(OWNER);
    const countBefore = harness.delivery.kicks.length;
    await h.runtime.resume(OWNER);
    await macrotask();
    for (const workerId of workerIds(run)) {
      expect(harness.delivery.kicks.slice(countBefore)).toContain(`${run.id}:${workerId}:resume`);
    }
    expect(h.store.get(run.id).tasks['t1']?.status).toBe('claimed');
    await h.runtime.dispose();
  });
});
