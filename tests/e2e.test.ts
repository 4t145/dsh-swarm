/**
 * 业务端到端：真实 SwarmRuntime + Collaboration + Delivery + IntegrationQueue + GitWorkspace。
 *
 * 只替换三个外部端口：原生 WorkerHost（不跑模型，按 nativeHost 契约在临时源仓库里建
 * integration / worker worktree 并把 path/branch/ready 写回 store）、ArtifactPort、RunTable。
 * result ref 必须由 Runtime 自己调用 Workspace.initializeResult 创建，夹具不代劳。
 *
 * 两个 worker 的“思考”由测试通过 runtime.collaboration 直接模拟：各自 createTask/claim、
 * 在自己的 worktree 改文件并 commit、用确切 SHA 调 runtime.submit。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ArtifactPort, WorkerHost, WorkerStartRequest } from '../src/ports.ts';
import { SwarmRuntime } from '../src/runtime.ts';
import { MemoryStateStore, type RunTable, type StateStore } from '../src/store.ts';
import type { Run, RunId, RunSpec, WorkerId, WorkerRecord } from '../src/types.ts';
import { GitWorkspace } from '../src/workspace.ts';
import { gitSync, LocalCommandExecutor } from './local-executor.ts';

const OWNER = 'fake-owner-session';
const WORKER_TIMEOUT_MS = 20_000;

const TWO_FLAGS_TEST = [
  "const fs = require('node:fs');",
  "for (const name of ['a.txt', 'b.txt']) {",
  '  const value = fs.readFileSync(name, "utf8").trim();',
  '  if (value !== "0" && value !== "1") {',
  '    console.error(`${name}=${value}`);',
  '    process.exit(1);',
  '  }',
  '}',
].join('\n');

const cleanupRoots: string[] = [];

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    if (resolve(root).startsWith(join(tmpdir(), 'dsh-swarm-e2e-'))) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

interface Fixture {
  root: string;
  source: string;
  worktreesRoot: string;
  baseCommit: string;
  spec: RunSpec;
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-swarm-e2e-'));
  cleanupRoots.push(root);
  const source = join(root, 'source');
  const worktreesRoot = join(root, 'worktrees');
  gitSync(['init', '--quiet', '-b', 'main', source], root);
  gitSync(['config', 'user.email', 'e2e@example.test'], source);
  gitSync(['config', 'user.name', 'Swarm E2E'], source);
  gitSync(['config', 'commit.gpgsign', 'false'], source);
  writeFileSync(join(source, 'a.txt'), '0\n');
  writeFileSync(join(source, 'b.txt'), '0\n');
  gitSync(['add', 'a.txt', 'b.txt'], source);
  gitSync(['commit', '--quiet', '-m', 'H0'], source);
  const baseCommit = gitSync(['rev-parse', 'HEAD'], source).trim();

  return {
    root,
    source,
    worktreesRoot,
    baseCommit,
    spec: {
      specPath: join(root, 'swarm.spec.json'),
      repository: source,
      baseRef: 'HEAD',
      goal: 'set both flags to 1 without clobbering each other',
      acceptanceCriteria: ['a.txt contains 1', 'b.txt contains 1'],
      workers: 2,
      budgetMinutes: 30,
      allowDirtyBaseline: false,
      verification: {
        setup: [],
        test: [{ argv: [process.execPath, '-e', TWO_FLAGS_TEST], timeoutMs: 20_000 }],
      },
    },
  };
}

/** 内存 RunTable：只当外部持久化后端，不参与业务逻辑。 */
class MemoryRunTable implements RunTable {
  private readonly records = new Map<RunId, Run>();
  get(id: RunId): Run | undefined {
    return this.records.get(id);
  }
  *entries(): IterableIterator<[RunId, Run]> {
    for (const entry of this.records) {
      yield entry;
    }
  }
  async put(id: RunId, run: Run): Promise<void> {
    this.records.set(id, run);
  }
  async update(id: RunId, fn: (run: Run) => Run): Promise<Run> {
    const current = this.records.get(id);
    if (current === undefined) {
      throw new Error(`run ${id} does not exist`);
    }
    const next = fn(current);
    this.records.set(id, next);
    return next;
  }
}

/** 内存 ArtifactPort：诊断只要求可保存/读取。 */
class MemoryArtifacts implements ArtifactPort {
  private readonly records = new Map<string, string>();
  async save(_runId: string, name: string, text: string): Promise<string> {
    const reference = `mem://${name}/${String(this.records.size)}`;
    this.records.set(reference, text);
    return reference;
  }
  async read(reference: string): Promise<string> {
    const text = this.records.get(reference);
    if (text === undefined) {
      throw new Error(`unknown artifact ${reference}`);
    }
    return text;
  }
}

/**
 * 原生 WorkerHost 的测试替身。
 *
 * 契约与 nativeHost 一致：start 时若无 integration worktree 就先建它并写回 run，再按 worker
 * 记录的 branch 建自己的 worktree 并写回 `worktreePath` + `initializationState: 'ready'`。
 * 它不跑模型、不写 result ref、不调用 initializeResult——那是 Runtime 的职责。
 */
class FakeWorkerHost implements WorkerHost {
  readonly stopCalls: RunId[] = [];
  readonly notifyCalls: { runId: RunId; workerId: WorkerId; throughSeq: number }[] = [];
  private readonly started = new Set<WorkerId>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: StateStore,
    private readonly source: string,
    private readonly worktreesRoot: string,
  ) {}

  start(request: WorkerStartRequest): Promise<void> {
    const runId = request.run.id;
    const workerId = request.worker.id;
    const task = this.chain.then(() => this.initializeWorker(runId, workerId));
    this.chain = task.catch(() => undefined);
    return task;
  }

  async notify(run: Run, worker: WorkerRecord, throughSeq: number): Promise<void> {
    this.notifyCalls.push({ runId: run.id, workerId: worker.id, throughSeq });
  }

  async stop(run: Run): Promise<void> {
    this.stopCalls.push(run.id);
  }

  isOwnerLive(ownerSessionId: string): boolean {
    return ownerSessionId === OWNER;
  }

  isWorkerBusy(_sessionId: string): boolean {
    return false;
  }

  workerStatus(_sessionId: string): 'running' | 'inactive' | 'unavailable' {
    // 假 worker 从不运行模型，门槛保持在 inactive；Delivery 只把它当通知目标。
    return 'inactive';
  }

  onSettled(): () => void {
    return () => undefined;
  }

  private async initializeWorker(runId: RunId, workerId: WorkerId): Promise<void> {
    if (this.started.has(workerId)) {
      return;
    }
    let run = this.store.get(runId);
    if (run.integrationWorktree === null) {
      const path = join(this.worktreesRoot, `build-${runId}`);
      gitSync(
        ['worktree', 'add', '--quiet', '-b', `swarm-${runId}-build`, path, run.baseCommit],
        this.source,
      );
      await this.store.update(runId, (current) =>
        current.integrationWorktree === null ? { ...current, integrationWorktree: path } : current,
      );
      run = this.store.get(runId);
    }

    const worker = run.workers[workerId];
    if (worker === undefined) {
      throw new Error(`worker ${workerId} is not reserved in run ${runId}`);
    }
    let worktreePath = worker.worktreePath;
    if (worktreePath === null) {
      worktreePath = join(this.worktreesRoot, `w-${workerId}`);
      gitSync(['worktree', 'add', '--quiet', '-b', worker.branch, worktreePath, run.baseCommit], this.source);
    }

    await this.store.update(runId, (current) => {
      const record = current.workers[workerId];
      if (record === undefined) {
        return current;
      }
      return {
        ...current,
        workers: {
          ...current.workers,
          [workerId]: {
            ...record,
            worktreePath,
            initializationState: 'ready',
            initializationError: null,
            unavailableReason: null,
          },
        },
      };
    });
    this.started.add(workerId);
  }
}

/**
 * 订阅驱动的条件等待：不轮询、不 sleep。
 *
 * 超时 reject 并附带 run 摘要；调用方持有外层 try/finally 负责 dispose。
 */
function waitForRun(
  store: StateStore,
  runId: RunId,
  predicate: (run: Run) => boolean,
  label: string,
  timeoutMs = WORKER_TIMEOUT_MS,
): Promise<Run> {
  return new Promise<Run>((resolvePromise, rejectPromise) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let unsubscribe: () => void = () => undefined;

    const settle = (error: Error | null, run?: Run): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      unsubscribe();
      if (error !== null) {
        rejectPromise(error);
      } else if (run !== undefined) {
        resolvePromise(run);
      }
    };
    const check = (run: Run): void => {
      try {
        if (predicate(run)) {
          settle(null, run);
        }
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    };

    try {
      check(store.get(runId));
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (settled) {
      return;
    }
    unsubscribe = store.subscribe((run) => {
      if (run.id === runId) {
        check(run);
      }
    });
    timer = setTimeout(() => {
      let snapshot = 'run unavailable';
      try {
        const run = store.get(runId);
        snapshot =
          `phase=${run.phase} reason=${String(run.reason)} acceptedHead=${run.acceptedHead} ` +
          `proposals=${Object.values(run.proposals)
            .map((proposal) => `${proposal.status}:${String(proposal.rejectionReason)}`)
            .join(',') || 'none'}`;
      } catch {
        // run 已被清理，保留占位摘要。
      }
      settle(new Error(`timed out waiting for ${label} (${snapshot})`));
    }, timeoutMs);
    timer.unref();
  });
}

function latestProposalFor(run: Run, taskId: string) {
  return Object.values(run.proposals).filter((proposal) => proposal.taskId === taskId).at(-1);
}

function workspaceOf(fixture: Fixture, store: StateStore, host: FakeWorkerHost): SwarmRuntime {
  return new SwarmRuntime(store, host, new GitWorkspace(new LocalCommandExecutor()), new MemoryArtifacts());
}

function beginRun(fixture: Fixture): {
  store: StateStore;
  host: FakeWorkerHost;
  runtime: SwarmRuntime;
} {
  const store = new MemoryStateStore(new MemoryRunTable());
  const host = new FakeWorkerHost(store, fixture.source, fixture.worktreesRoot);
  return { store, host, runtime: workspaceOf(fixture, store, host) };
}

/** A/B 两个 worker 都 ready 的 run 快照。 */
function bothWorkersReady(run: Run): boolean {
  const workers = Object.values(run.workers);
  return (
    workers.length === 2 &&
    workers.every((worker) => worker.initializationState === 'ready' && worker.worktreePath !== null)
  );
}

function workerPaths(run: Run): { a: WorkerRecord; b: WorkerRecord } {
  const workers = Object.values(run.workers);
  const [a, b] = workers;
  if (a === undefined || b === undefined) {
    throw new Error('expected two reserved workers');
  }
  return { a, b };
}

function commitAll(worktree: string, message: string): string {
  gitSync(['add', '-A'], worktree);
  gitSync(['commit', '--quiet', '-m', message], worktree);
  return gitSync(['rev-parse', 'HEAD'], worktree).trim();
}

function proposalSettled(run: Run, taskId: string): boolean {
  const proposal = latestProposalFor(run, taskId);
  if (proposal !== undefined && (proposal.status === 'accepted' || proposal.status === 'rejected')) {
    return true;
  }
  return run.phase === 'failed' || run.phase === 'stopped' || run.phase === 'completed';
}

function explainRefusal(runtime: SwarmRuntime, run: Run, taskId: string): string {
  const proposal = latestProposalFor(run, taskId);
  let diagnostics = 'unavailable';
  try {
    diagnostics = runtime.status(OWNER).diagnostics.slice(-5).join(' | ') || 'none';
  } catch {
    // 已卸载的 runtime 无法再读诊断，保留占位。
  }
  return (
    `proposal=${String(proposal?.status)} reason=${String(proposal?.rejectionReason)} ` +
    `run.phase=${run.phase} run.reason=${String(run.reason)} `
    + `acceptedHead=${run.acceptedHead} baseCommit=${run.baseCommit} diagnostics=[${diagnostics}]`
  );
}

describe('Swarm end-to-end over real Git worktrees', () => {
  it(
    'integrates two independently committed tasks, publishes the result ref and finishes',
    async () => {
      const fixture = createFixture();
      const { store, host, runtime } = beginRun(fixture);
      const before = {
        head: gitSync(['rev-parse', 'HEAD'], fixture.source).trim(),
        branch: gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], fixture.source).trim(),
        status: gitSync(['status', '--porcelain'], fixture.source),
        index: gitSync(['ls-files', '-s'], fixture.source),
      };
      expect(before.head).toBe(fixture.baseCommit);

      try {
        const started = await runtime.start(OWNER, fixture.spec);
        const runId = started.id;

        const ready = await waitForRun(store, runId, bothWorkersReady, 'both workers ready');
        const { a, b } = workerPaths(ready);
        const worktreeA = a.worktreePath;
        const worktreeB = b.worktreePath;
        if (worktreeA === null || worktreeB === null) {
          throw new Error('ready workers must have worktree paths');
        }

        // Runtime 必须在 start 阶段调用 Workspace.initializeResult 创建结果 ref（= baseCommit）。
        // 用 soft 断言：即使这里缺口，后续集成仍继续跑，尽量暴露完整链路。
        const initialResult = (() => {
          try {
            return gitSync(['rev-parse', '--verify', ready.resultRef], fixture.source).trim();
          } catch {
            return '<missing>';
          }
        })();
        expect
          .soft(initialResult, `result ref ${ready.resultRef} must be initialized at baseCommit by Runtime`)
          .toBe(fixture.baseCommit);

        // ---- worker A：建任务、认领、改 a.txt、提交确切 SHA ----
        const taskA = await runtime.collaboration.createTask(
          a.sessionId,
          { kind: 'code', subject: 'set a.txt to 1', acceptance: 'a.txt contains 1', scope: ['a.txt'] },
          'call-a-create',
        );
        const claimedA = await runtime.collaboration.updateTask(
          a.sessionId,
          { taskId: taskA.id, expectedRevision: taskA.revision, action: 'claim' },
          'call-a-claim',
        );
        writeFileSync(join(worktreeA, 'a.txt'), '1\n');
        const commitA = commitAll(worktreeA, 'worker a: a.txt=1');
        const submittedA = await runtime.submit(
          a.sessionId,
          { taskId: taskA.id, expectedRevision: claimedA.revision, sourceCommit: commitA },
          'call-a-submit',
        );

        const afterA = await waitForRun(store, runId, (run) => proposalSettled(run, taskA.id), 'worker A proposal settled');
        const proposalA = latestProposalFor(afterA, taskA.id);
        expect(proposalA?.status, `worker A proposal must be accepted (${explainRefusal(runtime, afterA, taskA.id)})`).toBe(
          'accepted',
        );
        expect(submittedA.sourceCommit).toBe(commitA);
        const acceptedHeadA = afterA.acceptedHead;
        expect(acceptedHeadA).not.toBe(fixture.baseCommit);

        // ---- worker B：明确 merge 第一个 acceptedHead，再改 b.txt 并提交 ----
        const taskB = await runtime.collaboration.createTask(
          b.sessionId,
          { kind: 'code', subject: 'set b.txt to 1', acceptance: 'b.txt contains 1', scope: ['b.txt'] },
          'call-b-create',
        );
        const claimedB = await runtime.collaboration.updateTask(
          b.sessionId,
          { taskId: taskB.id, expectedRevision: taskB.revision, action: 'claim' },
          'call-b-claim',
        );
        gitSync(['merge', '--no-ff', '--no-gpg-sign', '-m', 'worker b: merge accepted A', acceptedHeadA], worktreeB);
        writeFileSync(join(worktreeB, 'b.txt'), '1\n');
        const commitB = commitAll(worktreeB, 'worker b: b.txt=1');
        // B 必须真的把 A 的 accepted commit 合进自己的提交图。
        gitSync(['merge-base', '--is-ancestor', acceptedHeadA, commitB], worktreeB);

        await runtime.submit(
          b.sessionId,
          { taskId: taskB.id, expectedRevision: claimedB.revision, sourceCommit: commitB },
          'call-b-submit',
        );

        const afterB = await waitForRun(store, runId, (run) => proposalSettled(run, taskB.id), 'worker B proposal settled');
        const proposalB = latestProposalFor(afterB, taskB.id);
        expect(proposalB?.status, `worker B proposal must be accepted (${explainRefusal(runtime, afterB, taskB.id)})`).toBe(
          'accepted',
        );
        expect(proposalB?.sourceCommit).toBe(commitB);
        const acceptedHeadB = afterB.acceptedHead;
        expect(acceptedHeadB).not.toBe(acceptedHeadA);

        const tasksDone = await waitForRun(
          store,
          runId,
          (run) => Object.values(run.tasks).every((task) => task.status === 'done'),
          'all tasks done',
        );
        expect(Object.values(tasksDone.tasks).map((task) => task.status)).toEqual(['done', 'done']);

        // ---- finish：每条原始验收项都必须有证据 ----
        const decision = await runtime.finish(
          b.sessionId,
          {
            acceptedCommit: acceptedHeadB,
            notes: tasksDone.acceptanceCriteria.map((criterion) => ({
              criterion,
              evidence: [`node check passed on ${acceptedHeadB}; ${criterion} verified in the result ref`],
            })),
          },
          'call-finish',
        );
        expect(decision.status).toBe('accepted');

        const completed = await waitForRun(store, runId, (run) => run.phase === 'completed', 'run completed');

        // ---- 最终事实核对 ----
        const publishedHead = gitSync(['rev-parse', completed.resultRef], fixture.source).trim();
        expect(publishedHead, 'result ref must point at acceptedHead').toBe(completed.acceptedHead);
        expect(publishedHead).toBe(acceptedHeadB);
        expect(gitSync(['show', `${completed.resultRef}:a.txt`], fixture.source).trim()).toBe('1');
        expect(gitSync(['show', `${completed.resultRef}:b.txt`], fixture.source).trim()).toBe('1');

        expect(gitSync(['rev-parse', 'HEAD'], fixture.source).trim()).toBe(before.head);
        expect(gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], fixture.source).trim()).toBe(before.branch);
        expect(gitSync(['status', '--porcelain'], fixture.source)).toBe(before.status);
        expect(gitSync(['ls-files', '-s'], fixture.source)).toBe(before.index);

        expect(host.stopCalls).toEqual([runId]);
        expect(completed.finishRequest?.notes.map((note) => note.criterion)).toEqual(
          fixture.spec.acceptanceCriteria,
        );
      } finally {
        await runtime.dispose().catch((error: unknown) => {
          console.error('[e2e] runtime.dispose failed during teardown', error);
        });
        await store.close();
      }
    },
    30_000,
  );

  it(
    'keeps the result head when a candidate fails verification, then accepts the repaired resubmission',
    async () => {
      const fixture = createFixture();
      const { store, host, runtime } = beginRun(fixture);

      try {
        const started = await runtime.start(OWNER, fixture.spec);
        const runId = started.id;
        const ready = await waitForRun(store, runId, bothWorkersReady, 'both workers ready');
        const { a } = workerPaths(ready);
        const worktreeA = a.worktreePath;
        if (worktreeA === null) {
          throw new Error('ready worker must have a worktree path');
        }

        const initialResult = (() => {
          try {
            return gitSync(['rev-parse', '--verify', ready.resultRef], fixture.source).trim();
          } catch {
            return '<missing>';
          }
        })();
        expect
          .soft(initialResult, `result ref ${ready.resultRef} must be initialized at baseCommit by Runtime`)
          .toBe(fixture.baseCommit);

        const task = await runtime.collaboration.createTask(
          a.sessionId,
          { kind: 'code', subject: 'set a.txt to 1', acceptance: 'a.txt contains 1', scope: ['a.txt'] },
          'call-create',
        );
        const claimed = await runtime.collaboration.updateTask(
          a.sessionId,
          { taskId: task.id, expectedRevision: task.revision, action: 'claim' },
          'call-claim',
        );

        // 第一次候选写非法值 2：测试必须拒绝，result ref 不得推进。
        writeFileSync(join(worktreeA, 'a.txt'), '2\n');
        const badCommit = commitAll(worktreeA, 'worker a: a.txt=2 (bad)');
        await runtime.submit(
          a.sessionId,
          { taskId: task.id, expectedRevision: claimed.revision, sourceCommit: badCommit },
          'call-submit-bad',
        );

        const afterBad = await waitForRun(store, runId, (run) => proposalSettled(run, task.id), 'bad proposal settled');
        const badProposal = latestProposalFor(afterBad, task.id);
        expect(badProposal?.status, `bad candidate must be rejected (${explainRefusal(runtime, afterBad, task.id)})`).toBe(
          'rejected',
        );
        expect(badProposal?.rejectionReason).toBe('verification_failed');
        expect(afterBad.acceptedHead).toBe(fixture.baseCommit);
        const headAfterBad = (() => {
          try {
            return gitSync(['rev-parse', '--verify', afterBad.resultRef], fixture.source).trim();
          } catch {
            return '<missing>';
          }
        })();
        expect
          .soft(headAfterBad, 'rejected candidate must not advance the result ref')
          .toBe(fixture.baseCommit);

        // 修复后重提：任务因拒绝回到 claimed，revision 已增加。
        const reclaimed = afterBad.tasks[task.id];
        expect(reclaimed?.status).toBe('claimed');
        if (reclaimed === undefined) {
          throw new Error('task disappeared after rejection');
        }
        writeFileSync(join(worktreeA, 'a.txt'), '1\n');
        const goodCommit = commitAll(worktreeA, 'worker a: a.txt=1');
        await runtime.submit(
          a.sessionId,
          { taskId: task.id, expectedRevision: reclaimed.revision, sourceCommit: goodCommit },
          'call-submit-good',
        );

        const afterGood = await waitForRun(store, runId, (run) => proposalSettled(run, task.id), 'repaired proposal settled');
        const goodProposal = latestProposalFor(afterGood, task.id);
        expect(goodProposal?.status, `repaired candidate must be accepted (${explainRefusal(runtime, afterGood, task.id)})`).toBe(
          'accepted',
        );
        expect(goodProposal?.sourceCommit).toBe(goodCommit);
        expect(afterGood.acceptedHead).not.toBe(fixture.baseCommit);
        expect(gitSync(['rev-parse', afterGood.resultRef], fixture.source).trim()).toBe(afterGood.acceptedHead);
        expect(afterGood.tasks[task.id]?.status).toBe('done');
        expect(afterGood.phase).toBe('running');
        expect(host.stopCalls).toEqual([]);
      } finally {
        await runtime.dispose().catch((error: unknown) => {
          console.error('[e2e] runtime.dispose failed during teardown', error);
        });
        await store.close();
      }
    },
    30_000,
  );
});