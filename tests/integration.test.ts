/**
 * IntegrationQueue 的确定性测试：fake Workspace/Artifact + 内存 StateStore，
 * 竞态用 Promise 屏障控制先后，不使用 sleep。
 */

import { describe, expect, it } from 'vitest';
import { IntegrationQueue, selectPassedVerification } from '../src/integration.ts';
import { verificationFingerprint, type ArtifactPort, type CandidateResult, type RepositoryInfo, type VerificationOutcome, type WorkspacePort } from '../src/ports.ts';
import type { PublicationGate } from '../src/serial.ts';
import { createMemoryStateStore, type RunTable, type StateStore } from '../src/store.ts';
import { createRun } from '../src/types.ts';
import type {
  CommitSha,
  ProposalRecord,
  ProposalStatus,
  Run,
  RunId,
  RunPhase,
  TaskRecord,
  VerificationRecord,
  VerificationStatus,
} from '../src/types.ts';

/* ------------------------------------------------------------------ */
/* 测试夹具                                                            */
/* ------------------------------------------------------------------ */

const RUN_ID = 'run-1';
const BASE = 'h0';
const SUBMITTED_HEAD = 'h1';
const SOURCE = 'c1';
const CANDIDATE = 'm1';
const REF = 'refs/heads/swarm-r1-result';

const VERIFICATION_CONFIG = {
  setup: [],
  test: [{ argv: ['npm', 'test'], timeoutMs: 1000 }],
};

class Deferred<T> {
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;
  readonly promise: Promise<T>;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class InMemoryRunTable implements RunTable {
  private readonly records = new Map<RunId, Run>();
  /** 下一次 update 抛出的错误；用于模拟“ref 已推进、domain 写失败”。 */
  failNextUpdate: Error | null = null;

  get(id: RunId): Run | undefined {
    return this.records.get(id);
  }

  entries(): IterableIterator<[RunId, Run]> {
    return this.records.entries();
  }

  async put(id: RunId, run: Run): Promise<void> {
    this.records.set(id, run);
  }

  async update(id: RunId, fn: (run: Run) => Run): Promise<Run> {
    const current = this.records.get(id);
    if (current === undefined) {
      throw new Error(`missing run ${id}`);
    }
    if (this.failNextUpdate !== null) {
      const error = this.failNextUpdate;
      this.failNextUpdate = null;
      throw error;
    }
    const next = fn(current);
    this.records.set(id, next);
    return next;
  }
}

class FakeArtifacts implements ArtifactPort {
  readonly saved = new Map<string, string>();

  async save(runId: string, name: string, text: string): Promise<string> {
    const reference = `artifact:${runId}/${name}`;
    this.saved.set(reference, text);
    return reference;
  }

  async read(reference: string): Promise<string> {
    const text = this.saved.get(reference);
    if (text === undefined) {
      throw new Error(`missing artifact ${reference}`);
    }
    return text;
  }
}

class FakeWorkspace implements WorkspacePort {
  ref: CommitSha;
  candidate: CandidateResult = { kind: 'candidate', commit: CANDIDATE };
  outcome: VerificationOutcome = { passed: true, interrupted: false, exitCode: 0, timedOut: false, log: 'all green' };
  verifyGate: Deferred<void> | null = null;
  verifyStarted = new Deferred<void>();
  publishGate: Deferred<void> | null = null;
  publishStarted = new Deferred<void>();
  onPublish: (() => void) | null = null;
  readonly verifyCalls: CommitSha[] = [];
  readonly publishCalls: { expected: CommitSha; candidate: CommitSha }[] = [];

  constructor(ref: CommitSha) {
    this.ref = ref;
  }

  async inspect(): Promise<RepositoryInfo> {
    throw new Error('not used');
  }

  async initializeResult(): Promise<void> {
    throw new Error('not used');
  }

  async validateSubmission(): Promise<CommitSha> {
    throw new Error('not used');
  }

  async pinProposal(): Promise<void> {
    throw new Error('not used');
  }

  async buildCandidate(): Promise<CandidateResult> {
    return this.candidate;
  }

  async verify(_run: Run, commit: CommitSha, signal?: AbortSignal): Promise<VerificationOutcome> {
    this.verifyCalls.push(commit);
    this.verifyStarted.resolve();
    if (this.verifyGate !== null) {
      await this.verifyGate.promise;
    }
    if (signal?.aborted === true) {
      return { passed: false, interrupted: true, exitCode: null, timedOut: false, log: 'aborted by signal' };
    }
    return this.outcome;
  }

  async publish(_run: Run, expected: CommitSha, candidate: CommitSha): Promise<void> {
    this.publishCalls.push({ expected, candidate });
    this.publishStarted.resolve();
    this.onPublish?.();
    if (this.publishGate !== null) {
      await this.publishGate.promise;
    }
    this.ref = candidate;
  }

  async resultHead(): Promise<CommitSha> {
    return this.ref;
  }

  async diff(): Promise<string> {
    return '';
  }
}

/** 支持“先被控制临界区占用”的短门禁。 */
class TestGate implements PublicationGate {
  private tail: Promise<void> = Promise.resolve();

  run<T>(_runId: string, operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 占用门禁直到返回的函数被调用。 */
  hold(): () => void {
    const release = new Deferred<void>();
    this.tail = this.tail.then(() => release.promise);
    return () => {
      release.resolve();
    };
  }
}

function baseRun(input: { acceptedHead?: CommitSha; phase?: RunPhase } = {}): Run {
  const run = createRun({
    id: RUN_ID,
    ownerSessionId: 'owner-session',
    repositoryRoot: '/repo',
    gitCommonDir: '/repo/.git',
    goal: 'goal',
    acceptanceCriteria: ['all tests pass'],
    verification: VERIFICATION_CONFIG,
    baseCommit: BASE,
    resultRef: REF,
    deadline: 10_000,
    createdAt: 1000,
  });
  run.phase = input.phase ?? 'running';
  if (input.acceptedHead !== undefined) {
    run.acceptedHead = input.acceptedHead;
  }
  return run;
}

function addWorker(run: Run, currentTaskId: string | null): void {
  run.workers.w1 = {
    id: 'w1',
    sessionId: 'w1-session',
    branch: 'swarm-w1',
    worktreePath: '/repo/.agents/worktrees/w1',
    initializationState: 'ready',
    initializationError: null,
    unavailableReason: null,
    offeredSeq: 0,
    observedSeq: 0,
    notifiedSeq: 0,
    wakeTargetSeq: 0,
    waitRegistration: null,
    currentTaskId,
    createdAt: 1000,
  };
}

function addProposal(
  run: Run,
  input: {
    id: string;
    taskId: string;
    sourceCommit?: CommitSha;
    status?: ProposalStatus;
    submissionHead?: CommitSha;
    attemptIds?: string[];
  },
): void {
  const task: TaskRecord = {
    id: input.taskId,
    revision: 1,
    createdByWorkerId: 'w1',
    kind: 'code',
    subject: `subject ${input.taskId}`,
    acceptance: 'acceptance',
    scope: [],
    status: 'proposed',
    ownerWorkerId: 'w1',
    proposalId: input.id,
    resultFindingId: null,
    blockReason: null,
    cancellationReason: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
  run.tasks[task.id] = task;
  const proposal: ProposalRecord = {
    id: input.id,
    taskId: input.taskId,
    authorWorkerId: 'w1',
    sourceCommit: input.sourceCommit ?? SOURCE,
    resultRefAtSubmission: input.submissionHead ?? BASE,
    proposalRef: `refs/swarm/${input.id}`,
    status: input.status ?? 'queued',
    acceptedCommit: null,
    diagnosticsRef: null,
    rejectionReason: null,
    attemptIds: input.attemptIds ?? [],
    createdAt: 1000,
    updatedAt: 1000,
  };
  run.proposals[proposal.id] = proposal;
}

function addFinishRequest(run: Run, verificationId: string): void {
  run.finishRequest = {
    id: 'finish-1',
    requestedByWorkerId: 'w1',
    acceptedHead: run.acceptedHead,
    notes: [{ criterion: 'all tests pass', evidence: ['target passed'] }],
    verificationId,
    createdAt: 1000,
  };
}

function addFinishVerification(run: Run, id: string, status: VerificationStatus = 'queued'): void {
  const record: VerificationRecord = {
    id,
    purpose: 'finish',
    commit: run.acceptedHead,
    expectedHead: run.acceptedHead,
    sourceCommit: null,
    proposalId: null,
    attemptId: null,
    configFingerprint: verificationFingerprint(run.verification),
    status,
    receiptRef: null,
    diagnosticsRef: null,
    exitCode: null,
    timedOut: false,
    createdAt: 1000,
    startedAt: null,
    finishedAt: null,
  };
  run.verifications[id] = record;
}

function addPassedProposalVerification(
  run: Run,
  input: { id: string; proposalId: string; attemptId: string; sourceCommit?: CommitSha },
): void {
  const record: VerificationRecord = {
    id: input.id,
    purpose: 'proposal',
    commit: CANDIDATE,
    expectedHead: run.acceptedHead,
    sourceCommit: input.sourceCommit ?? SOURCE,
    proposalId: input.proposalId,
    attemptId: input.attemptId,
    configFingerprint: verificationFingerprint(run.verification),
    status: 'passed',
    receiptRef: 'artifact:prior',
    diagnosticsRef: null,
    exitCode: 0,
    timedOut: false,
    createdAt: 1000,
    startedAt: 1000,
    finishedAt: 1000,
  };
  run.verifications[record.id] = record;
}

function testIds(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `generated-${String(counter)}`;
  };
}

function fixture(run: Run): {
  store: StateStore;
  table: InMemoryRunTable;
  workspace: FakeWorkspace;
  artifacts: FakeArtifacts;
  gate: TestGate;
  queue: IntegrationQueue;
  failures: unknown[];
} {
  const table = new InMemoryRunTable();
  const store = createMemoryStateStore(table);
  const workspace = new FakeWorkspace(run.acceptedHead);
  const artifacts = new FakeArtifacts();
  const gate = new TestGate();
  const failures: unknown[] = [];
  const queue = new IntegrationQueue(store, workspace, artifacts, gate, {
    now: () => 2000,
    id: testIds(),
    onFailure: (_runId, error) => failures.push(error),
  });
  return { store, table, workspace, artifacts, gate, queue, failures };
}

function proposalOf(run: Run, id: string): ProposalRecord {
  const proposal = run.proposals[id];
  if (proposal === undefined) {
    throw new Error(`missing proposal ${id}`);
  }
  return proposal;
}

function taskOf(run: Run, id: string): TaskRecord {
  const task = run.tasks[id];
  if (task === undefined) {
    throw new Error(`missing task ${id}`);
  }
  return task;
}

function verificationOf(run: Run, id: string): VerificationRecord {
  const verification = run.verifications[id];
  if (verification === undefined) {
    throw new Error(`missing verification ${id}`);
  }
  return verification;
}

function only<T>(items: T[]): T {
  const [head] = items;
  if (head === undefined || items.length !== 1) {
    throw new Error(`expected exactly one item, got ${String(items.length)}`);
  }
  return head;
}

function waitForRun(store: StateStore, runId: RunId, predicate: (run: Run) => boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      off();
      resolve();
    };
    const off = store.subscribe((run) => {
      if (run.id === runId && predicate(run)) {
        finish();
      }
    });
    if (predicate(store.get(runId))) {
      finish();
    }
  });
}

/* ------------------------------------------------------------------ */
/* 测试                                                                */
/* ------------------------------------------------------------------ */

describe('IntegrationQueue', () => {
  it('integrates one queued proposal once and records exact accepted events', async () => {
    const run = baseRun({ acceptedHead: SUBMITTED_HEAD });
    addProposal(run, { id: 'p1', taskId: 't1', sourceCommit: SOURCE, submissionHead: BASE });
    addWorker(run, 't1');
    const { store, workspace, artifacts, queue } = fixture(run);
    await store.create(run);

    // 重复触发不得重复合并/发布。
    await Promise.all([queue.process(RUN_ID), queue.process(RUN_ID)]);
    await queue.idle(RUN_ID);

    const updated = store.get(RUN_ID);
    expect(workspace.publishCalls).toEqual([{ expected: SUBMITTED_HEAD, candidate: CANDIDATE }]);
    expect(workspace.verifyCalls).toEqual([CANDIDATE]);

    // expectedHead 是实际开始集成时的 acceptedHead，不是提交时快照。
    const attempt = only(Object.values(updated.integrationAttempts));
    expect(attempt.expectedHead).toBe(SUBMITTED_HEAD);
    expect(attempt.sourceCommit).toBe(SOURCE);
    expect(attempt.candidateCommit).toBe(CANDIDATE);
    expect(attempt.status).toBe('published');

    const proposal = proposalOf(updated, 'p1');
    expect(proposal.status).toBe('accepted');
    expect(proposal.acceptedCommit).toBe(CANDIDATE);
    expect(proposal.rejectionReason).toBeNull();

    const task = taskOf(updated, 't1');
    expect(task.status).toBe('done');
    expect(task.revision).toBe(2);
    // Acceptance completes the task, so the author no longer has a current task.
    expect(updated.workers.w1?.currentTaskId).toBeNull();
    expect(task.ownerWorkerId).toBe('w1');

    const verification = only(Object.values(updated.verifications));
    expect(verification.purpose).toBe('proposal');
    expect(verification.commit).toBe(CANDIDATE);
    expect(verification.expectedHead).toBe(SUBMITTED_HEAD);
    expect(verification.sourceCommit).toBe(SOURCE);
    expect(verification.proposalId).toBe('p1');
    expect(verification.attemptId).toBe(attempt.id);
    expect(verification.configFingerprint).toBe(verificationFingerprint(run.verification));
    expect(verification.status).toBe('passed');
    expect(verification.exitCode).toBe(0);
    expect(verification.finishedAt).toBe(2000);

    const receiptRef = verification.receiptRef;
    expect(receiptRef).not.toBeNull();
    if (receiptRef !== null) {
      expect(await artifacts.read(receiptRef)).toContain('all green');
    }

    expect(updated.acceptedHead).toBe(CANDIDATE);
    expect(updated.activeAttemptId).toBeNull();
    expect(updated.events.map((event) => event.kind)).toEqual(['proposal', 'head', 'task']);
    expect(updated.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(updated.events[0]).toMatchObject({
      kind: 'proposal',
      proposalId: 'p1',
      taskId: 't1',
      status: 'accepted',
      audience: { kind: 'all' },
    });
    expect(updated.events[1]).toMatchObject({ kind: 'head', acceptedHead: CANDIDATE, proposalId: 'p1' });
    expect(updated.events[2]).toMatchObject({ kind: 'task', taskId: 't1', status: 'done', ownerWorkerId: 'w1' });

    // 已发布凭据可用于 finish 复用判断，且按指纹过滤。
    expect(selectPassedVerification(updated, CANDIDATE)?.id).toBe(verification.id);
    expect(selectPassedVerification(updated, CANDIDATE, 'other-config')).toBeNull();

    // 再次 recover 是幂等的：ref=acceptedHead，不重复追加接受事件。
    await queue.recover(RUN_ID);
    const afterRecover = store.get(RUN_ID);
    expect(afterRecover.events).toHaveLength(3);
    expect(afterRecover.acceptedHead).toBe(CANDIDATE);
  });

  it('does not clear an unrelated current-task pointer during acceptance', async () => {
    const run = baseRun();
    addProposal(run, { id: 'p1', taskId: 't1' });
    addWorker(run, 'another-task');
    const { store, queue } = fixture(run);
    await store.create(run);

    await queue.process(RUN_ID);

    const updated = store.get(RUN_ID);
    expect(taskOf(updated, 't1').status).toBe('done');
    expect(updated.workers.w1?.currentTaskId).toBe('another-task');
  });

  it('rejects the proposal and keeps the head when combined verification fails', async () => {
    const run = baseRun({ acceptedHead: SUBMITTED_HEAD });
    addProposal(run, { id: 'p1', taskId: 't1' });
    addWorker(run, 't1');
    const { store, workspace, artifacts, queue } = fixture(run);
    workspace.outcome = { passed: false, interrupted: false, exitCode: 1, timedOut: false, log: 'FAIL combined suite' };
    await store.create(run);

    await queue.process(RUN_ID);

    const updated = store.get(RUN_ID);
    expect(workspace.publishCalls).toHaveLength(0);
    expect(updated.acceptedHead).toBe(SUBMITTED_HEAD);

    const proposal = proposalOf(updated, 'p1');
    expect(proposal.status).toBe('rejected');
    expect(proposal.rejectionReason).toBe('verification_failed');
    expect(proposal.diagnosticsRef).not.toBeNull();

    const task = taskOf(updated, 't1');
    expect(task.status).toBe('claimed');
    expect(task.ownerWorkerId).toBe('w1');
    expect(task.proposalId).toBeNull();
    expect(updated.workers.w1?.currentTaskId).toBe('t1');

    const verification = only(Object.values(updated.verifications));
    expect(verification.status).toBe('failed');
    expect(verification.exitCode).toBe(1);
    expect(verification.diagnosticsRef).not.toBeNull();
    if (verification.diagnosticsRef !== null) {
      expect(await artifacts.read(verification.diagnosticsRef)).toContain('FAIL combined suite');
    }
    const attempt = only(Object.values(updated.integrationAttempts));
    expect(attempt.status).toBe('rejected');

    expect(updated.events.map((event) => event.kind)).toEqual(['proposal', 'task']);
    expect(updated.events[0]).toMatchObject({ kind: 'proposal', status: 'rejected' });
    expect(updated.events[1]).toMatchObject({ kind: 'task', taskId: 't1', status: 'claimed' });
  });

  it.each(['conflict', 'verification', 'interrupt', 'recover'] as const)(
    'keeps rejection facts atomic and retry-idempotent through %s',
    async (path) => {
      const run = baseRun();
      addProposal(run, { id: 'p1', taskId: 't1' });
      addWorker(run, 't1');
      proposalOf(run, 'p1').diagnosticsRef = 'prior-diagnostic';
      const worker = run.workers.w1!;
      worker.waitRegistration = { afterSeq: 0, mode: 'selected', taskIds: ['t1'], proposalIds: [] };
      if (path === 'interrupt' || path === 'recover') run.phase = 'paused';
      const { store, workspace, queue } = fixture(run);
      workspace.candidate = path === 'conflict'
        ? { kind: 'conflict', diagnostics: 'CONFLICT' }
        : { kind: 'candidate', commit: CANDIDATE };
      workspace.outcome = { passed: false, interrupted: false, exitCode: 2, timedOut: false, log: 'failed' };
      await store.create(run);
      const reject = () => path === 'interrupt'
        ? queue.interrupt(RUN_ID, 'pause')
        : path === 'recover' ? queue.recover(RUN_ID) : queue.process(RUN_ID);

      await reject();

      const updated = store.get(RUN_ID);
      expect(taskOf(updated, 't1')).toMatchObject({
        status: 'claimed', revision: 2, ownerWorkerId: 'w1', proposalId: null,
      });
      expect(updated.workers.w1).toMatchObject({
        currentTaskId: 't1', observedSeq: 0, offeredSeq: 0, wakeTargetSeq: 2,
      });
      expect(updated.events.map((event) => [event.seq, event.kind, event.authorWorkerId])).toEqual([
        [1, 'proposal', null], [2, 'task', null],
      ]);
      expect(proposalOf(updated, 'p1').diagnosticsRef).toBe(
        path === 'interrupt' || path === 'recover' ? 'prior-diagnostic'
          : only(Object.values(updated.integrationAttempts)).diagnosticsRef,
      );
      expect(workspace.publishCalls).toEqual([]);
      expect(updated.acceptedHead).toBe(BASE);

      await reject();
      expect(store.get(RUN_ID)).toEqual(updated);
    },
  );

  it('does not reclaim non-proposed tasks or rewrite terminal proposals during bulk interruption', async () => {
    const run = baseRun({ phase: 'paused' });
    addProposal(run, { id: 'pending', taskId: 'already-claimed' });
    addProposal(run, { id: 'accepted', taskId: 'done', status: 'accepted' });
    addProposal(run, { id: 'rejected', taskId: 'claimed', status: 'rejected' });
    addProposal(run, { id: 'orphan', taskId: 'missing' });
    run.tasks['already-claimed'] = { ...taskOf(run, 'already-claimed'), status: 'claimed', revision: 9 };
    run.tasks.done = { ...taskOf(run, 'done'), status: 'done' };
    run.tasks.claimed = { ...taskOf(run, 'claimed'), status: 'claimed' };
    delete run.tasks.missing;
    const { store, queue } = fixture(run);
    await store.create(run);
    const before = store.get(RUN_ID);

    await queue.interrupt(RUN_ID, 'stop');

    const updated = store.get(RUN_ID);
    expect(updated.tasks).toEqual(before.tasks);
    expect(updated.proposals.accepted).toEqual(before.proposals.accepted);
    expect(updated.proposals.rejected).toEqual(before.proposals.rejected);
    expect(updated.events.map((event) => event.kind === 'proposal' && event.proposalId)).toEqual(['pending', 'orphan']);
    expect(updated.revision).toBe(before.revision + 1);
  });

  it('records a merge conflict without moving the result ref', async () => {
    const run = baseRun({ acceptedHead: SUBMITTED_HEAD });
    addProposal(run, { id: 'p1', taskId: 't1' });
    const { store, workspace, artifacts, queue } = fixture(run);
    workspace.candidate = { kind: 'conflict', diagnostics: 'CONFLICT in src/app.ts' };
    await store.create(run);

    await queue.process(RUN_ID);

    const updated = store.get(RUN_ID);
    expect(workspace.publishCalls).toHaveLength(0);
    expect(updated.acceptedHead).toBe(SUBMITTED_HEAD);
    expect(proposalOf(updated, 'p1').rejectionReason).toBe('merge_conflict');
    expect(taskOf(updated, 't1').status).toBe('claimed');
    const attempt = only(Object.values(updated.integrationAttempts));
    expect(attempt.status).toBe('merge_conflict');
    if (attempt.diagnosticsRef !== null) {
      expect(await artifacts.read(attempt.diagnosticsRef)).toContain('CONFLICT in src/app.ts');
    }
    expect(updated.events.map((event) => event.kind)).toEqual(['proposal', 'task']);
  });

  it('gives the control critical section priority: a validated candidate is not published', async () => {
    const run = baseRun({ acceptedHead: SUBMITTED_HEAD });
    addProposal(run, { id: 'p1', taskId: 't1' });
    const { store, workspace, gate, queue } = fixture(run);
    await store.create(run);

    const releaseGate = gate.hold();
    const processing = queue.process(RUN_ID);
    // 验证已经通过并落盘，但发布临界区尚未取得 gate。
    await waitForRun(store, RUN_ID, (current) =>
      Object.values(current.verifications).some((verification) => verification.status === 'passed'),
    );
    const interrupting = queue.interrupt(RUN_ID, 'stop');
    releaseGate();
    await processing;
    await interrupting;

    const updated = store.get(RUN_ID);
    expect(workspace.publishCalls).toHaveLength(0);
    expect(updated.acceptedHead).toBe(SUBMITTED_HEAD);
    expect(proposalOf(updated, 'p1').status).toBe('rejected');
    expect(proposalOf(updated, 'p1').rejectionReason).toBe('interrupted_by_stop');
    expect(taskOf(updated, 't1').status).toBe('claimed');
    // 真实测试凭据保留，但不得绕过被拒的 Proposal 发布。
    expect(only(Object.values(updated.verifications)).status).toBe('passed');
    expect(only(Object.values(updated.integrationAttempts)).status).toBe('interrupted');
    expect(updated.events.map((event) => event.kind)).toEqual(['proposal', 'task']);
  });

  it('keeps an accepted result when publication acquired the gate first', async () => {
    const run = baseRun({ acceptedHead: SUBMITTED_HEAD });
    addProposal(run, { id: 'p1', taskId: 't1' });
    const { store, workspace, queue } = fixture(run);
    await store.create(run);

    // 发布临界区已持有 gate（ref CAS 进行中）时收到 stop：已取得的发布先完成。
    workspace.publishGate = new Deferred<void>();
    const processing = queue.process(RUN_ID);
    await workspace.publishStarted.promise;
    const interrupting = queue.interrupt(RUN_ID, 'stop');
    workspace.publishGate.resolve();
    await processing;
    await interrupting;

    const updated = store.get(RUN_ID);
    expect(workspace.publishCalls).toHaveLength(1);
    expect(updated.acceptedHead).toBe(CANDIDATE);
    expect(proposalOf(updated, 'p1').status).toBe('accepted');
    expect(taskOf(updated, 't1').status).toBe('done');
    expect(only(Object.values(updated.verifications)).status).toBe('passed');
    expect(updated.events).toHaveLength(3);
  });

  it('interrupts a running verification without forging a test failure', async () => {
    const run = baseRun({ acceptedHead: SUBMITTED_HEAD });
    addProposal(run, { id: 'p1', taskId: 't1' });
    const { store, workspace, queue } = fixture(run);
    await store.create(run);

    workspace.verifyGate = new Deferred<void>();
    workspace.outcome = { passed: true, interrupted: false, exitCode: 0, timedOut: false, log: 'would pass' };
    const processing = queue.process(RUN_ID);
    await workspace.verifyStarted.promise;
    const interrupting = queue.interrupt(RUN_ID, 'pause');
    workspace.verifyGate.resolve();
    await processing;
    await interrupting;

    const updated = store.get(RUN_ID);
    const verification = only(Object.values(updated.verifications));
    expect(verification.status).toBe('interrupted');
    expect(verification.exitCode).toBeNull();
    expect(proposalOf(updated, 'p1').rejectionReason).toBe('interrupted_by_pause');
    expect(taskOf(updated, 't1').status).toBe('claimed');
    expect(workspace.publishCalls).toHaveLength(0);
    expect(updated.acceptedHead).toBe(SUBMITTED_HEAD);
  });

  it('recovers domain state after ref CAS succeeded but the domain write failed', async () => {
    const run = baseRun({ acceptedHead: SUBMITTED_HEAD });
    addProposal(run, { id: 'p1', taskId: 't1' });
    addWorker(run, 't1');
    const { store, table, workspace, queue, failures } = fixture(run);
    await store.create(run);
    workspace.onPublish = () => {
      table.failNextUpdate = new Error('domain write failed');
    };

    await expect(queue.process(RUN_ID)).rejects.toThrow(/domain write failed/);
    expect(failures).toHaveLength(1);

    const afterFailure = store.get(RUN_ID);
    expect(workspace.ref).toBe(CANDIDATE);
    expect(afterFailure.acceptedHead).toBe(SUBMITTED_HEAD);
    expect(proposalOf(afterFailure, 'p1').status).toBe('integrating');
    expect(afterFailure.workers.w1?.currentTaskId).toBe('t1');
    expect(only(Object.values(afterFailure.verifications)).status).toBe('passed');

    // 只补 domain：不再次合并、不再次移动 ref。
    await queue.recover(RUN_ID);

    const recovered = store.get(RUN_ID);
    expect(workspace.publishCalls).toHaveLength(1);
    expect(recovered.acceptedHead).toBe(CANDIDATE);
    expect(proposalOf(recovered, 'p1').status).toBe('accepted');
    expect(proposalOf(recovered, 'p1').acceptedCommit).toBe(CANDIDATE);
    expect(taskOf(recovered, 't1').status).toBe('done');
    expect(taskOf(recovered, 't1').ownerWorkerId).toBe('w1');
    expect(recovered.workers.w1?.currentTaskId).toBeNull();
    expect(only(Object.values(recovered.integrationAttempts)).status).toBe('published');
    expect(recovered.events.map((event) => event.kind)).toEqual(['proposal', 'head', 'task']);
  });

  it('rejects an old validated candidate when the result ref is still H', async () => {
    const run = baseRun({ acceptedHead: BASE });
    addProposal(run, { id: 'p1', taskId: 't1', status: 'integrating', attemptIds: ['att1'] });
    run.integrationAttempts['att1'] = {
      id: 'att1',
      proposalId: 'p1',
      expectedHead: BASE,
      sourceCommit: SOURCE,
      candidateCommit: CANDIDATE,
      status: 'verified',
      diagnosticsRef: null,
      createdAt: 1000,
      updatedAt: 1000,
    };
    run.activeAttemptId = 'att1';
    addPassedProposalVerification(run, { id: 'v1', proposalId: 'p1', attemptId: 'att1' });
    const { store, workspace, queue } = fixture(run);
    await store.create(run);

    await queue.recover(RUN_ID);

    const updated = store.get(RUN_ID);
    expect(workspace.publishCalls).toHaveLength(0);
    expect(workspace.verifyCalls).toHaveLength(0);
    expect(updated.acceptedHead).toBe(BASE);
    expect(proposalOf(updated, 'p1').status).toBe('rejected');
    expect(proposalOf(updated, 'p1').rejectionReason).toBe('interrupted_before_publish');
    expect(taskOf(updated, 't1').status).toBe('claimed');
    // passed 凭据保留供诊断；历史 attempt 不被抹掉。
    expect(verificationOf(updated, 'v1').status).toBe('passed');
    expect(verificationOf(updated, 'v1').receiptRef).toBe('artifact:prior');
    expect(updated.integrationAttempts['att1']?.status).toBe('verified');
    expect(updated.events.map((event) => event.kind)).toEqual(['proposal', 'task']);
  });

  it('stops without guessing when the result ref is an unknown SHA', async () => {
    const run = baseRun({ acceptedHead: BASE });
    addProposal(run, { id: 'p1', taskId: 't1' });
    const { store, workspace, queue, failures } = fixture(run);
    await store.create(run);
    workspace.ref = 'external-deadbeef';

    await expect(queue.recover(RUN_ID)).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    expect(failures).toHaveLength(1);

    const updated = store.get(RUN_ID);
    expect(updated.acceptedHead).toBe(BASE);
    expect(proposalOf(updated, 'p1').status).toBe('queued');
    expect(taskOf(updated, 't1').status).toBe('proposed');
    expect(updated.events).toHaveLength(0);
    expect(workspace.publishCalls).toHaveLength(0);
  });

  it('does not overwrite a rejected proposal when the ref points at its candidate', async () => {
    const run = baseRun({ acceptedHead: BASE });
    addProposal(run, { id: 'p1', taskId: 't1', status: 'rejected', attemptIds: ['att1'] });
    run.tasks['t1'] = { ...taskOf(run, 't1'), status: 'claimed', proposalId: null };
    run.integrationAttempts['att1'] = {
      id: 'att1',
      proposalId: 'p1',
      expectedHead: BASE,
      sourceCommit: SOURCE,
      candidateCommit: CANDIDATE,
      status: 'verified',
      diagnosticsRef: null,
      createdAt: 1000,
      updatedAt: 1000,
    };
    addPassedProposalVerification(run, { id: 'v1', proposalId: 'p1', attemptId: 'att1' });
    const { store, workspace, queue } = fixture(run);
    await store.create(run);
    workspace.ref = CANDIDATE;

    await expect(queue.recover(RUN_ID)).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });

    const updated = store.get(RUN_ID);
    expect(updated.acceptedHead).toBe(BASE);
    expect(proposalOf(updated, 'p1').status).toBe('rejected');
    expect(taskOf(updated, 't1').status).toBe('claimed');
    expect(verificationOf(updated, 'v1').status).toBe('passed');
    expect(updated.events).toHaveLength(0);
    expect(workspace.publishCalls).toHaveLength(0);
  });

  it('integrates again after the control abort was cleared on resume', async () => {
    const run = baseRun({ acceptedHead: SUBMITTED_HEAD });
    addProposal(run, { id: 'p1', taskId: 't1' });
    const { store, workspace, queue } = fixture(run);
    await store.create(run);

    await queue.interrupt(RUN_ID, 'pause');
    expect(proposalOf(store.get(RUN_ID), 'p1').status).toBe('rejected');

    // 模拟 resume：run 回 running，worker 提交了新的候选。
    await store.update(RUN_ID, (current) => {
      current.phase = 'running';
      current.quiesceTarget = null;
      addProposal(current, { id: 'p2', taskId: 't2' });
      return current;
    });

    await queue.process(RUN_ID);

    const updated = store.get(RUN_ID);
    expect(workspace.publishCalls).toEqual([{ expected: SUBMITTED_HEAD, candidate: CANDIDATE }]);
    expect(updated.acceptedHead).toBe(CANDIDATE);
    expect(proposalOf(updated, 'p2').status).toBe('accepted');
    expect(taskOf(updated, 't2').status).toBe('done');
  });

  it('runs a finish verification without creating a proposal or moving the ref', async () => {
    const run = baseRun({ phase: 'draining' });
    addFinishVerification(run, 'fv1');
    addFinishRequest(run, 'fv1');
    const { store, workspace, artifacts, queue } = fixture(run);
    await store.create(run);

    await queue.process(RUN_ID);

    const updated = store.get(RUN_ID);
    expect(workspace.verifyCalls).toEqual([BASE]);
    expect(workspace.publishCalls).toHaveLength(0);
    const verification = verificationOf(updated, 'fv1');
    expect(verification.status).toBe('passed');
    expect(verification.commit).toBe(BASE);
    expect(verification.expectedHead).toBe(BASE);
    expect(verification.purpose).toBe('finish');
    expect(verification.receiptRef).not.toBeNull();
    if (verification.receiptRef !== null) {
      expect(await artifacts.read(verification.receiptRef)).toContain('all green');
    }
    expect(Object.values(updated.proposals)).toHaveLength(0);
    expect(updated.finishRequest).not.toBeNull();
    expect(updated.phase).toBe('quiescing');
    expect(updated.quiesceTarget).toBe('completed');
    expect(updated.reason).toBe('finish_verified');
    expect(updated.acceptedHead).toBe(BASE);

    expect(updated.events.map((event) => event.kind)).toEqual(['run']);
    expect(updated.events[0]).toMatchObject({
      kind: 'run',
      phase: 'quiescing',
      target: 'completed',
      reason: 'finish_verified',
    });
    // finish 的 passed 记录同样是可复用凭据，但指纹必须一致。
    expect(selectPassedVerification(updated, BASE)?.id).toBe('fv1');
    expect(selectPassedVerification(updated, BASE, 'other-config')).toBeNull();

    // 重复触发不重复验证。
    await queue.process(RUN_ID);
    expect(workspace.verifyCalls).toHaveLength(1);
  });

  it('creates a real open repair task and FAIL when the finish verification fails', async () => {
    const run = baseRun({ phase: 'draining' });
    addFinishVerification(run, 'fv1');
    addFinishRequest(run, 'fv1');
    const { store, workspace, artifacts, queue } = fixture(run);
    workspace.outcome = { passed: false, interrupted: false, exitCode: 7, timedOut: false, log: 'compile error' };
    await store.create(run);

    await queue.process(RUN_ID);

    const updated = store.get(RUN_ID);
    const verification = verificationOf(updated, 'fv1');
    expect(verification.status).toBe('failed');
    expect(verification.exitCode).toBe(7);
    expect(verification.diagnosticsRef).not.toBeNull();
    if (verification.diagnosticsRef !== null) {
      expect(await artifacts.read(verification.diagnosticsRef)).toContain('compile error');
    }
    expect(updated.finishRequest).toBeNull();
    expect(updated.phase).toBe('running');
    expect(updated.quiesceTarget).toBeNull();
    expect(updated.reason).toBe('finish_verification_failed');
    expect(updated.acceptedHead).toBe(BASE);

    const repairTask = only(Object.values(updated.tasks));
    expect(repairTask.kind).toBe('code');
    expect(repairTask.status).toBe('open');
    expect(repairTask.ownerWorkerId).toBeNull();
    expect(repairTask.subject).toContain('最终验证失败');
    expect(repairTask.acceptance).toContain('验证命令通过');

    const finding = only(Object.values(updated.findings));
    expect(finding.kind).toBe('fail');
    expect(finding.blockingRepairTaskId).toBe(repairTask.id);
    expect(finding.authorWorkerId).toBe('w1');
    expect(finding.evidenceRefs).toEqual([verification.diagnosticsRef]);

    expect(updated.events.map((event) => event.kind)).toEqual(['task', 'finding', 'run']);
    expect(updated.events[0]).toMatchObject({ kind: 'task', taskId: repairTask.id, status: 'open' });
    expect(updated.events[1]).toMatchObject({
      kind: 'finding',
      findingId: finding.id,
      findingKind: 'fail',
      seq: finding.seq,
    });
    expect(updated.events[2]).toMatchObject({ kind: 'run', phase: 'running', target: null });
  });

  it('interrupts a queued finish verification without creating a fake failure', async () => {
    const run = baseRun({ phase: 'quiescing' });
    run.quiesceTarget = 'paused';
    addFinishVerification(run, 'fv1');
    addFinishRequest(run, 'fv1');
    addProposal(run, { id: 'p1', taskId: 't1', status: 'rejected' });
    run.tasks['t1'] = { ...taskOf(run, 't1'), status: 'claimed', proposalId: null };
    addFinishVerification(run, 'passed-finish', 'passed');
    const { store, workspace, queue } = fixture(run);
    await store.create(run);

    await queue.interrupt(RUN_ID, 'pause');

    const updated = store.get(RUN_ID);
    expect(workspace.verifyCalls).toHaveLength(0);
    expect(verificationOf(updated, 'fv1').status).toBe('interrupted');
    expect(updated.finishRequest).toBeNull();
    expect(updated.phase).toBe('quiescing');
    expect(Object.values(updated.findings)).toHaveLength(0);
    expect(Object.values(updated.tasks)).toHaveLength(1);
    expect(verificationOf(updated, 'passed-finish').status).toBe('passed');
  });

  it('clears a passed finish request on interrupt but keeps the passed credential', async () => {
    const run = baseRun({ phase: 'quiescing' });
    run.quiesceTarget = 'paused';
    const passId = 'finish-passed';
    addFinishVerification(run, passId, 'passed');
    addFinishRequest(run, passId);
    const { store, queue } = fixture(run);
    await store.create(run);

    await queue.interrupt(RUN_ID, 'pause');

    const updated = store.get(RUN_ID);
    expect(updated.finishRequest).toBeNull();
    expect(verificationOf(updated, passId).status).toBe('passed');
    expect(selectPassedVerification(updated, BASE)?.id).toBe(passId);
  });

  it('rejects every unaccepted proposal on interrupt and preserves passed records', async () => {
    const run = baseRun({ acceptedHead: BASE });
    run.phase = 'quiescing';
    run.quiesceTarget = 'stopped';
    addProposal(run, { id: 'p1', taskId: 't1' });
    addFinishVerification(run, 'done-already', 'passed');
    const { store, workspace, queue } = fixture(run);
    await store.create(run);

    await queue.interrupt(RUN_ID, 'budget');

    const updated = store.get(RUN_ID);
    expect(workspace.verifyCalls).toHaveLength(0);
    expect(proposalOf(updated, 'p1').status).toBe('rejected');
    expect(proposalOf(updated, 'p1').rejectionReason).toBe('interrupted_by_budget');
    expect(taskOf(updated, 't1').status).toBe('claimed');
    expect(verificationOf(updated, 'done-already').status).toBe('passed');
    expect(updated.events.map((event) => event.kind)).toEqual(['proposal', 'task']);
  });
});
