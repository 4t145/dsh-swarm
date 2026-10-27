/**
 * GitWorkspace 的行为测试。
 *
 * 夹具在临时目录里建一个源仓库、两个 worker worktree 和一个集成 worktree，全部用本文件的
 * `LocalCommandExecutor` 执行真实 Git；不触碰任何用户仓库。
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { isSwarmError, SwarmError, type SwarmErrorCode } from '../src/errors.ts';
import type { CommandExecutor, CommandResult, RepositoryInfo } from '../src/ports.ts';
import type {
  CommandSpec,
  IntegrationAttempt,
  ProposalRecord,
  Run,
  RunSpec,
  VerificationConfig,
  WorkerRecord,
} from '../src/types.ts';
import { createRun } from '../src/types.ts';
import { GitWorkspace } from '../src/workspace.ts';
import { gitSync, LocalCommandExecutor, tryGitSync } from './local-executor.ts';

const OWNER = 'session-owner';
const RESULT_REF = 'refs/heads/swarm-r1-result';
const SLEEP_MARKER = 'swarm-verify-sleep-marker';

interface Fixture {
  root: string;
  source: string;
  workerOne: string;
  workerTwo: string;
  build: string;
  base: string;
  spec: RunSpec;
  workspace: GitWorkspace;
  info: RepositoryInfo;
  run: Run;
  one: WorkerRecord;
  two: WorkerRecord;
}

interface FixtureOptions {
  setup?: CommandSpec[];
  test?: CommandSpec[];
  integrationWorktree?: string | null;
  executor?: CommandExecutor;
}

const fixtureRoots: string[] = [];
let idSequence = 0;

afterEach(async () => {
  for (const root of fixtureRoots.splice(0)) {
    if (!resolve(root).startsWith(join(tmpdir(), 'dsh-swarm-workspace-'))) {
      throw new Error(`refusing to delete an unexpected fixture path: ${root}`);
    }
    await rm(root, { recursive: true, force: true });
  }
});

function nextId(prefix: string): string {
  idSequence += 1;
  return `${prefix}-${idSequence}`;
}

function makeWorker(id: string, sessionId: string, branch: string, worktreePath: string | null): WorkerRecord {
  return {
    id,
    sessionId,
    branch,
    worktreePath,
    initializationState: 'ready',
    initializationError: null,
    unavailableReason: null,
    offeredSeq: 0,
    observedSeq: 0,
    notifiedSeq: 0,
    wakeTargetSeq: 0,
    waitRegistration: null,
    currentTaskId: null,
    createdAt: Date.now(),
  };
}

function makeProposal(
  run: Run,
  sourceCommit: string,
  overrides: Partial<ProposalRecord> = {},
): ProposalRecord {
  const id = overrides.id ?? nextId('proposal');
  return {
    id,
    taskId: 'task-1',
    authorWorkerId: 'w1',
    sourceCommit,
    resultRefAtSubmission: run.acceptedHead,
    proposalRef: `refs/swarm/proposals/${id}`,
    status: 'queued',
    acceptedCommit: null,
    diagnosticsRef: null,
    rejectionReason: null,
    attemptIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeAttempt(
  proposal: ProposalRecord,
  expectedHead: string,
  overrides: Partial<IntegrationAttempt> = {},
): IntegrationAttempt {
  return {
    id: nextId('attempt'),
    proposalId: proposal.id,
    expectedHead,
    sourceCommit: proposal.sourceCommit,
    candidateCommit: null,
    status: 'merging',
    diagnosticsRef: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** 在某个 worktree 里写文件、提交，并返回该提交 SHA。 */
async function commitChanges(
  worktree: string,
  changes: Record<string, string>,
  message: string,
): Promise<string> {
  for (const [file, content] of Object.entries(changes)) {
    await writeFile(join(worktree, file), content, 'utf8');
  }
  gitSync(['add', '--all'], worktree);
  gitSync(['commit', '--quiet', '-m', message], worktree);
  return gitSync(['rev-parse', 'HEAD'], worktree).trim();
}

async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-swarm-workspace-'));
  fixtureRoots.push(root);
  const source = join(root, 'source');
  gitSync(['init', '--quiet', '-b', 'main', source], root);
  gitSync(['config', 'user.name', 'Swarm Fixture'], source);
  gitSync(['config', 'user.email', 'fixture@example.com'], source);
  await writeFile(join(source, 'a.txt'), 'alpha\n', 'utf8');
  await writeFile(join(source, 'b.txt'), 'beta\n', 'utf8');
  gitSync(['add', '--all'], source);
  gitSync(['commit', '--quiet', '-m', 'initial'], source);
  const base = gitSync(['rev-parse', 'HEAD'], source).trim();

  const workerOne = join(root, 'worker-one');
  const workerTwo = join(root, 'worker-two');
  const build = join(root, 'build');
  gitSync(['worktree', 'add', '--quiet', '-b', 'swarm-r1-w1', workerOne, base], source);
  gitSync(['worktree', 'add', '--quiet', '-b', 'swarm-r1-w2', workerTwo, base], source);
  gitSync(['worktree', 'add', '--quiet', '-b', 'swarm-r1-build', build, base], source);

  const verification: VerificationConfig = {
    setup: options.setup ?? [],
    test: options.test ?? [{ argv: ['node', '--version'], timeoutMs: 10_000 }],
  };
  const spec: RunSpec = {
    specPath: join(root, 'swarm-run.json'),
    repository: source,
    baseRef: 'HEAD',
    goal: 'fixture goal',
    acceptanceCriteria: ['the fixture works'],
    workers: 2,
    budgetMinutes: 30,
    allowDirtyBaseline: false,
    verification,
  };

  const workspace = new GitWorkspace(options.executor ?? new LocalCommandExecutor());
  const info = await workspace.inspect(spec, OWNER);
  const one = makeWorker('w1', 'session-w1', 'swarm-r1-w1', workerOne);
  const two = makeWorker('w2', 'session-w2', 'swarm-r1-w2', workerTwo);
  const run: Run = {
    ...createRun({
      id: 'run-1',
      ownerSessionId: OWNER,
      repositoryRoot: info.repositoryRoot,
      gitCommonDir: info.gitCommonDir,
      goal: spec.goal,
      acceptanceCriteria: [...spec.acceptanceCriteria],
      verification,
      baseCommit: info.baseCommit,
      resultRef: RESULT_REF,
      deadline: Date.now() + 60 * 60_000,
      budgetMinutes: 30,
    }),
    integrationWorktree: options.integrationWorktree === undefined ? build : options.integrationWorktree,
    workers: { [one.id]: one, [two.id]: two },
  };
  await workspace.initializeResult(run);
  return { root, source, workerOne, workerTwo, build, base, spec, workspace, info, run, one, two };
}

/** 提交一个 worker 改动并把 H=acceptedHead 的候选构造出来。 */
async function prepareCandidate(
  fixture: Fixture,
  changes: Record<string, string> = { 'a.txt': 'alpha one\n' },
): Promise<{ proposal: ProposalRecord; attempt: IntegrationAttempt; candidate: string }> {
  const commit = await commitChanges(fixture.workerOne, changes, 'worker change');
  const proposal = makeProposal(fixture.run, commit);
  const attempt = makeAttempt(proposal, fixture.run.acceptedHead);
  const result = await fixture.workspace.buildCandidate(fixture.run, proposal, attempt);
  if (result.kind === 'conflict') {
    throw new Error(`expected a candidate, got a conflict: ${result.diagnostics}`);
  }
  return { proposal, attempt, candidate: result.commit };
}

async function expectSwarmError(promise: Promise<unknown>, code: SwarmErrorCode): Promise<SwarmError> {
  try {
    await promise;
  } catch (error) {
    if (!isSwarmError(error)) {
      throw error;
    }
    expect(error.code).toBe(code);
    return error;
  }
  throw new Error(`expected SwarmError ${code} but the call succeeded`);
}

function sourceSnapshot(fixture: Fixture): { branch: string; head: string; status: string; staged: string } {
  return {
    branch: gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], fixture.source).trim(),
    head: gitSync(['rev-parse', 'HEAD'], fixture.source).trim(),
    status: gitSync(['status', '--porcelain=v1', '--untracked-files=normal'], fixture.source),
    staged: gitSync(['diff', '--cached', '--name-only'], fixture.source),
  };
}

function buildState(fixture: Fixture): {
  branch: string;
  head: string;
  status: string;
  mergeHead: string | null;
} {
  return {
    branch: gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], fixture.build).trim(),
    head: gitSync(['rev-parse', 'HEAD'], fixture.build).trim(),
    status: gitSync(['status', '--porcelain=v1', '--untracked-files=normal'], fixture.build),
    mergeHead: tryGitSync(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], fixture.build),
  };
}

describe('GitWorkspace.inspect', () => {
  it('resolves the canonical identity, the base commit and a clean state', async () => {
    const fixture = await createFixture();
    expect(fixture.info.repositoryRoot).toBe(await realpath(fixture.source));
    expect(fixture.info.gitCommonDir).toBe(await realpath(join(fixture.source, '.git')));
    expect(fixture.info.baseCommit).toBe(fixture.base);
    expect(fixture.info.dirty).toBe(false);
  });

  it('resolves a subdirectory of the checkout to the repository root', async () => {
    const fixture = await createFixture();
    const nested = join(fixture.source, 'packages', 'nested');
    await mkdir(nested, { recursive: true });
    const info = await fixture.workspace.inspect({ ...fixture.spec, repository: nested }, OWNER);
    expect(info.repositoryRoot).toBe(await realpath(fixture.source));
  });

  it('refuses a dirty checkout unless the spec explicitly allows it', async () => {
    const fixture = await createFixture();
    const before = sourceSnapshot(fixture);
    await writeFile(join(fixture.source, 'a.txt'), 'uncommitted\n', 'utf8');

    const error = await expectSwarmError(fixture.workspace.inspect(fixture.spec, OWNER), 'SWARM_INVALID_STATE');
    expect(error.details?.['dirty']).toBe(true);
    expect(error.details?.['allowDirtyBaseline']).toBe(false);

    const allowed = await fixture.workspace.inspect({ ...fixture.spec, allowDirtyBaseline: true }, OWNER);
    expect(allowed.dirty).toBe(true);
    expect(allowed.baseCommit).toBe(fixture.base);

    // 拒绝与“明确允许”都不 stash、不 commit、不清空用户改动。
    expect(gitSync(['status', '--porcelain=v1'], fixture.source)).toContain('a.txt');
    const after = sourceSnapshot(fixture);
    expect(after.head).toBe(before.head);
    expect(after.branch).toBe(before.branch);
  });

  it('rejects a base ref that does not resolve locally', async () => {
    const fixture = await createFixture();
    await expectSwarmError(
      fixture.workspace.inspect({ ...fixture.spec, baseRef: 'refs/heads/missing-branch' }, OWNER),
      'SWARM_INVALID_INPUT',
    );
  });

  it('rejects a path that is not a git repository', async () => {
    const fixture = await createFixture();
    await expectSwarmError(
      fixture.workspace.inspect({ ...fixture.spec, repository: fixture.root }, OWNER),
      'SWARM_INVALID_INPUT',
    );
  });
});

describe('GitWorkspace.initializeResult', () => {
  it('creates the result ref at the base commit and is idempotent', async () => {
    const fixture = await createFixture();
    expect(await fixture.workspace.resultHead(fixture.run)).toBe(fixture.base);
    await expect(fixture.workspace.initializeResult(fixture.run)).resolves.toBeUndefined();
    expect(gitSync(['rev-parse', '--verify', RESULT_REF], fixture.source).trim()).toBe(fixture.base);
  });

  it('refuses to replace an existing result ref', async () => {
    const fixture = await createFixture();
    const commit = await commitChanges(fixture.workerOne, { 'a.txt': 'alpha one\n' }, 'worker change');
    gitSync(['update-ref', RESULT_REF, commit], fixture.source);

    const error = await expectSwarmError(fixture.workspace.initializeResult(fixture.run), 'SWARM_INVALID_STATE');
    expect(error.details?.['existing']).toBe(commit);
    expect(await fixture.workspace.resultHead(fixture.run)).toBe(commit);
  });

  it('rejects a result ref outside the refs/ namespace', async () => {
    const fixture = await createFixture();
    await expectSwarmError(
      fixture.workspace.initializeResult({ ...fixture.run, resultRef: 'heads/result' }),
      'SWARM_INVALID_INPUT',
    );
  });

  it('reports a missing result ref instead of guessing one', async () => {
    const fixture = await createFixture();
    gitSync(['update-ref', '-d', RESULT_REF], fixture.source);
    await expectSwarmError(fixture.workspace.resultHead(fixture.run), 'SWARM_NOT_FOUND');
  });
});

describe('GitWorkspace.validateSubmission', () => {
  it('returns the normalized HEAD sha of a clean worker branch', async () => {
    const fixture = await createFixture();
    const commit = await commitChanges(fixture.workerOne, { 'a.txt': 'alpha one\n' }, 'worker change');
    const returned = await fixture.workspace.validateSubmission(fixture.run, fixture.one, commit.toUpperCase());
    expect(returned).toBe(commit);
    expect(returned).toMatch(/^[0-9a-f]{40,64}$/);
  });

  it('rejects a commit that is not the current worker head', async () => {
    const fixture = await createFixture();
    await commitChanges(fixture.workerOne, { 'a.txt': 'alpha one\n' }, 'worker change');
    const error = await expectSwarmError(
      fixture.workspace.validateSubmission(fixture.run, fixture.one, fixture.base),
      'SWARM_INVALID_STATE',
    );
    expect(error.details?.['check']).toBe('head');
  });

  it('rejects a dirty worker worktree', async () => {
    const fixture = await createFixture();
    const commit = await commitChanges(fixture.workerOne, { 'a.txt': 'alpha one\n' }, 'worker change');
    await writeFile(join(fixture.workerOne, 'b.txt'), 'not committed\n', 'utf8');
    const error = await expectSwarmError(
      fixture.workspace.validateSubmission(fixture.run, fixture.one, commit),
      'SWARM_INVALID_STATE',
    );
    expect(error.details?.['check']).toBe('clean');
  });

  it('rejects a worker record for another branch', async () => {
    const fixture = await createFixture();
    const commit = await commitChanges(fixture.workerOne, { 'a.txt': 'alpha one\n' }, 'worker change');
    const error = await expectSwarmError(
      fixture.workspace.validateSubmission(fixture.run, { ...fixture.one, branch: 'swarm-r1-w2' }, commit),
      'SWARM_INVALID_STATE',
    );
    expect(error.details?.['check']).toBe('branch');
  });

  it('rejects a worker checkout from another repository', async () => {
    const fixture = await createFixture();
    const other = join(fixture.root, 'other');
    gitSync(['init', '--quiet', '-b', 'main', other], fixture.root);
    gitSync(['config', 'user.name', 'Other'], other);
    gitSync(['config', 'user.email', 'other@example.com'], other);
    await writeFile(join(other, 'a.txt'), 'other\n', 'utf8');
    gitSync(['add', '--all'], other);
    gitSync(['commit', '--quiet', '-m', 'other initial'], other);
    const otherWorktree = join(fixture.root, 'other-worktree');
    gitSync(['worktree', 'add', '--quiet', '-b', 'swarm-r1-w1', otherWorktree, 'HEAD'], other);
    const otherCommit = await commitChanges(otherWorktree, { 'a.txt': 'other change\n' }, 'other change');

    const error = await expectSwarmError(
      fixture.workspace.validateSubmission(
        fixture.run,
        { ...fixture.one, worktreePath: otherWorktree },
        otherCommit,
      ),
      'SWARM_INVALID_STATE',
    );
    expect(error.details?.['check']).toBe('common_dir');
  });

  it('refuses a worker record that points at the user checkout', async () => {
    const fixture = await createFixture();
    const error = await expectSwarmError(
      fixture.workspace.validateSubmission(
        fixture.run,
        { ...fixture.one, worktreePath: fixture.source },
        fixture.base,
      ),
      'SWARM_INVALID_STATE',
    );
    expect(error.details?.['check']).toBe('worktree');
  });

  it('requires a full commit SHA', async () => {
    const fixture = await createFixture();
    await expectSwarmError(
      fixture.workspace.validateSubmission(fixture.run, fixture.one, 'HEAD'),
      'SWARM_INVALID_INPUT',
    );
  });
});

describe('GitWorkspace.pinProposal', () => {
  it('pins the candidate to an immutable proposal ref and is idempotent', async () => {
    const fixture = await createFixture();
    const commit = await commitChanges(fixture.workerOne, { 'a.txt': 'alpha one\n' }, 'worker change');
    const proposal = makeProposal(fixture.run, commit);

    await fixture.workspace.pinProposal(fixture.run, proposal);
    expect(gitSync(['rev-parse', '--verify', proposal.proposalRef], fixture.source).trim()).toBe(commit);
    await expect(fixture.workspace.pinProposal(fixture.run, proposal)).resolves.toBeUndefined();
  });

  it('refuses to move an already pinned proposal ref', async () => {
    const fixture = await createFixture();
    const first = await commitChanges(fixture.workerOne, { 'a.txt': 'alpha one\n' }, 'worker change');
    const second = await commitChanges(fixture.workerOne, { 'a.txt': 'alpha two\n' }, 'second change');
    const proposal = makeProposal(fixture.run, first);
    await fixture.workspace.pinProposal(fixture.run, proposal);

    const error = await expectSwarmError(
      fixture.workspace.pinProposal(fixture.run, { ...proposal, sourceCommit: second }),
      'SWARM_INVALID_STATE',
    );
    expect(error.details?.['existing']).toBe(first);
    expect(gitSync(['rev-parse', '--verify', proposal.proposalRef], fixture.source).trim()).toBe(first);
  });

  it('rejects an unknown commit and an invalid ref name', async () => {
    const fixture = await createFixture();
    const unknown = 'f'.repeat(40);
    await expectSwarmError(
      fixture.workspace.pinProposal(fixture.run, makeProposal(fixture.run, unknown)),
      'SWARM_INVALID_INPUT',
    );
    const commit = await commitChanges(fixture.workerOne, { 'a.txt': 'alpha one\n' }, 'worker change');
    await expectSwarmError(
      fixture.workspace.pinProposal(fixture.run, makeProposal(fixture.run, commit, { proposalRef: 'heads/x' })),
      'SWARM_INVALID_INPUT',
    );
  });
});

describe('GitWorkspace.buildCandidate', () => {
  it('merges the proposal onto the integration baseline without touching the result ref', async () => {
    const fixture = await createFixture();
    const before = sourceSnapshot(fixture);
    const { proposal, candidate } = await prepareCandidate(fixture);

    expect(candidate).not.toBe(fixture.base);
    const parents = gitSync(['rev-list', '--parents', '-n', '1', candidate], fixture.source).trim().split(' ');
    expect(parents.slice(1).sort()).toEqual([fixture.base, proposal.sourceCommit].sort());
    expect(await fixture.workspace.resultHead(fixture.run)).toBe(fixture.base);
    expect(sourceSnapshot(fixture)).toEqual(before);

    const state = buildState(fixture);
    expect(state.head).toBe(candidate);
    expect(state.branch).toBe('swarm-r1-build');
    expect(state.status).toBe('');
    expect(state.mergeHead).toBeNull();
  });

  it('returns conflict diagnostics and restores the integration baseline', async () => {
    const fixture = await createFixture();
    const first = await prepareCandidate(fixture);
    // 先把 M1 作为新的 H，验证候选必须基于它而不是提交时的旧快照。
    fixture.run = { ...fixture.run, acceptedHead: first.candidate };

    const conflictingCommit = await commitChanges(
      fixture.workerTwo,
      { 'a.txt': 'alpha from worker two\n' },
      'worker two change',
    );
    const proposal = makeProposal(fixture.run, conflictingCommit);
    const attempt = makeAttempt(proposal, first.candidate);

    const result = await fixture.workspace.buildCandidate(fixture.run, proposal, attempt);
    expect(result.kind).toBe('conflict');
    if (result.kind !== 'conflict') {
      throw new Error('unreachable');
    }
    expect(result.diagnostics).toContain('a.txt');
    expect(result.diagnostics).toContain(first.candidate);

    const state = buildState(fixture);
    expect(state.head).toBe(first.candidate);
    expect(state.status).toBe('');
    expect(state.mergeHead).toBeNull();
    expect(await fixture.workspace.resultHead(fixture.run)).toBe(fixture.base);
    expect(gitSync(['status', '--porcelain=v1'], fixture.workerTwo)).toBe('');
  });

  it('treats an already contained source commit as the baseline itself', async () => {
    const fixture = await createFixture();
    const commit = await commitChanges(fixture.workerOne, { 'a.txt': 'alpha one\n' }, 'worker change');
    const proposal = makeProposal(fixture.run, commit);
    const attempt = makeAttempt(proposal, commit);

    const result = await fixture.workspace.buildCandidate(fixture.run, proposal, attempt);
    expect(result).toEqual({ kind: 'candidate', commit });
  });

  it('refuses the user checkout or a worker worktree as the integration worktree', async () => {
    const fixture = await createFixture();
    const commit = await commitChanges(fixture.workerOne, { 'a.txt': 'alpha one\n' }, 'worker change');
    const proposal = makeProposal(fixture.run, commit);
    const attempt = makeAttempt(proposal, fixture.base);
    const beforeSource = sourceSnapshot(fixture);
    const beforeWorker = {
      head: gitSync(['rev-parse', 'HEAD'], fixture.workerOne).trim(),
      status: gitSync(['status', '--porcelain=v1'], fixture.workerOne),
    };

    const userCheckout = await expectSwarmError(
      fixture.workspace.buildCandidate({ ...fixture.run, integrationWorktree: fixture.source }, proposal, attempt),
      'SWARM_INVALID_STATE',
    );
    expect(userCheckout.details?.['reason']).toBe('user_checkout');
    expect(sourceSnapshot(fixture)).toEqual(beforeSource);

    const workerTree = await expectSwarmError(
      fixture.workspace.buildCandidate(
        { ...fixture.run, integrationWorktree: fixture.workerOne },
        proposal,
        attempt,
      ),
      'SWARM_INVALID_STATE',
    );
    expect(workerTree.details?.['reason']).toBe('worker_worktree');
    expect(gitSync(['rev-parse', 'HEAD'], fixture.workerOne).trim()).toBe(beforeWorker.head);
    expect(gitSync(['status', '--porcelain=v1'], fixture.workerOne)).toBe(beforeWorker.status);

    await expectSwarmError(
      fixture.workspace.verify({ ...fixture.run, integrationWorktree: fixture.source }, commit),
      'SWARM_INVALID_STATE',
    );
    expect(sourceSnapshot(fixture)).toEqual(beforeSource);
  });
});

describe('GitWorkspace.verify', () => {
  it('runs the fixed setup/test commands against the candidate and records the exit code', async () => {
    const fixture = await createFixture({
      setup: [{ argv: ['node', '-e', 'process.exit(0)'], timeoutMs: 10_000 }],
      test: [{ argv: ['node', '--version'], timeoutMs: 10_000 }],
    });
    const { candidate } = await prepareCandidate(fixture);

    const outcome = await fixture.workspace.verify(fixture.run, candidate);
    expect(outcome).toMatchObject({ passed: true, interrupted: false, timedOut: false, exitCode: 0 });
    expect(outcome.log).toContain('[setup 1/1]');
    expect(outcome.log).toContain('[test 1/1]');
    expect(outcome.log).toContain('[result] passed');
    expect(await fixture.workspace.resultHead(fixture.run)).toBe(fixture.base);
    expect(buildState(fixture).head).toBe(candidate);
  });

  it('reports the real exit code of a failing test and does not publish', async () => {
    const fixture = await createFixture({
      test: [{ argv: ['node', '-e', 'process.exit(3)'], timeoutMs: 10_000 }],
    });
    const { candidate } = await prepareCandidate(fixture);

    const outcome = await fixture.workspace.verify(fixture.run, candidate);
    expect(outcome.passed).toBe(false);
    expect(outcome.exitCode).toBe(3);
    expect(outcome.timedOut).toBe(false);
    expect(outcome.interrupted).toBe(false);
    expect(outcome.log).toContain('[result] failed');
    expect(await fixture.workspace.resultHead(fixture.run)).toBe(fixture.base);
  });

  it('fails when verification commands modify tracked files', async () => {
    const fixture = await createFixture({
      test: [{ argv: ['node', '-e', 'require("fs").appendFileSync("a.txt", "polluted\\n")'], timeoutMs: 10_000 }],
    });
    const { candidate } = await prepareCandidate(fixture);

    const outcome = await fixture.workspace.verify(fixture.run, candidate);
    expect(outcome.passed).toBe(false);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.log).toContain('tracked files changed by verification commands');
    expect(outcome.log).toContain('a.txt');
  });

  it('records a timeout instead of a pass', async () => {
    const fixture = await createFixture({
      test: [{ argv: ['node', '-e', 'setTimeout(() => {}, 60000)'], timeoutMs: 200 }],
    });
    const { candidate } = await prepareCandidate(fixture);

    const outcome = await fixture.workspace.verify(fixture.run, candidate);
    expect(outcome.passed).toBe(false);
    expect(outcome.timedOut).toBe(true);
    expect(outcome.interrupted).toBe(false);
    expect(outcome.log).toContain('[timed out]');
  });

  it('records cancellation while the test command is running', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted;
    });
    const inner = new LocalCommandExecutor();
    const gated: CommandExecutor = {
      run(request) {
        const result: Promise<CommandResult> = inner.run(request);
        if (request.argv.some((arg) => arg.includes(SLEEP_MARKER))) {
          markStarted();
        }
        return result;
      },
    };
    const fixture = await createFixture({
      executor: gated,
      test: [
        { argv: ['node', '-e', `/* ${SLEEP_MARKER} */ setTimeout(() => {}, 60000)`], timeoutMs: 60_000 },
      ],
    });
    const { candidate } = await prepareCandidate(fixture);

    const controller = new AbortController();
    const pending = fixture.workspace.verify(fixture.run, candidate, controller.signal);
    await started;
    controller.abort();
    const outcome = await pending;
    expect(outcome.interrupted).toBe(true);
    expect(outcome.passed).toBe(false);
    expect(outcome.log).toContain('[cancelled]');
  });

  it('returns interrupted without side effects when the signal is already aborted', async () => {
    const fixture = await createFixture();
    const { candidate } = await prepareCandidate(fixture);
    const before = buildState(fixture);
    const controller = new AbortController();
    controller.abort();

    const outcome = await fixture.workspace.verify(fixture.run, candidate, controller.signal);
    expect(outcome).toMatchObject({ passed: false, interrupted: true, timedOut: false, exitCode: null });
    expect(outcome.log).toContain('[cancelled]');
    expect(buildState(fixture)).toEqual(before);
  });

  it('does not run the test command when setup fails', async () => {
    const fixture = await createFixture({
      setup: [{ argv: ['node', '-e', 'process.exit(4)'], timeoutMs: 10_000 }],
      test: [
        {
          argv: ['node', '-e', 'require("fs").writeFileSync("marker.txt", "ran")'],
          timeoutMs: 10_000,
        },
      ],
    });
    const { candidate } = await prepareCandidate(fixture);

    const outcome = await fixture.workspace.verify(fixture.run, candidate);
    expect(outcome.passed).toBe(false);
    expect(outcome.exitCode).toBe(4);
    expect(outcome.log).toContain('[setup 1/1]');
    expect(outcome.log).not.toContain('[test 1/1]');
    expect(existsSync(join(fixture.build, 'marker.txt'))).toBe(false);
  });
});

describe('GitWorkspace.publish', () => {
  it('advances the result ref only when the expected head matches', async () => {
    const fixture = await createFixture();
    const { candidate } = await prepareCandidate(fixture);

    await fixture.workspace.publish(fixture.run, fixture.base, candidate);
    expect(await fixture.workspace.resultHead(fixture.run)).toBe(candidate);
    expect(gitSync(['rev-parse', '--verify', RESULT_REF], fixture.source).trim()).toBe(candidate);

    const diff = await fixture.workspace.diff(fixture.run);
    expect(diff).toContain('diff --git a/a.txt b/a.txt');
    expect(diff).toContain('+alpha one');
  });

  it('rejects a stale expected head without moving the ref', async () => {
    const fixture = await createFixture();
    const first = await prepareCandidate(fixture);
    await fixture.workspace.publish(fixture.run, fixture.base, first.candidate);

    const secondCommit = await commitChanges(fixture.workerTwo, { 'b.txt': 'beta two\n' }, 'worker two');
    const proposal = makeProposal(fixture.run, secondCommit);
    const attempt = makeAttempt(proposal, fixture.run.acceptedHead);
    const built = await fixture.workspace.buildCandidate(fixture.run, proposal, attempt);
    if (built.kind === 'conflict') {
      throw new Error(`expected a candidate, got a conflict: ${built.diagnostics}`);
    }

    const error = await expectSwarmError(
      fixture.workspace.publish(fixture.run, fixture.base, built.commit),
      'SWARM_STALE_HEAD',
    );
    expect(error.details?.['actual']).toBe(first.candidate);
    expect(await fixture.workspace.resultHead(fixture.run)).toBe(first.candidate);
  });

  it('rejects a candidate that is not a local commit', async () => {
    const fixture = await createFixture();
    await expectSwarmError(
      fixture.workspace.publish(fixture.run, fixture.base, 'f'.repeat(40)),
      'SWARM_INVALID_INPUT',
    );
    expect(await fixture.workspace.resultHead(fixture.run)).toBe(fixture.base);
  });
});

describe('GitWorkspace command isolation', () => {
  it('ignores failing repository hooks and clean/smudge filters', async () => {
    const fixture = await createFixture();
    gitSync(['config', 'filter.evil.clean', 'cat'], fixture.source);
    gitSync(['config', 'filter.evil.smudge', 'false'], fixture.source);
    gitSync(['config', 'filter.evil.required', 'true'], fixture.source);
    await mkdir(join(fixture.source, '.git', 'hooks'), { recursive: true });
    await writeFile(
      join(fixture.source, '.git', 'hooks', 'pre-merge-commit'),
      '#!/bin/sh\necho "pre-merge-commit refused" >&2\nexit 1\n',
      { mode: 0o755 },
    );

    const commit = await commitChanges(
      fixture.workerOne,
      { '.gitattributes': '*.txt filter=evil\n', 'a.txt': 'alpha one\n' },
      'worker change with a filter attribute',
    );
    const proposal = makeProposal(fixture.run, commit);
    const attempt = makeAttempt(proposal, fixture.base);

    const result = await fixture.workspace.buildCandidate(fixture.run, proposal, attempt);
    expect(result.kind).toBe('candidate');
    if (result.kind !== 'candidate') {
      throw new Error('unreachable');
    }
    // 合并成功说明 pre-merge-commit 没有执行；文件内容未被 smudge 过滤改写说明 filter 被禁用。
    expect(gitSync(['show', `${result.commit}:a.txt`], fixture.source)).toBe('alpha one\n');
    expect(gitSync(['show', `${result.commit}:.gitattributes`], fixture.source)).toContain('filter=evil');
  });

  it('keeps the user checkout, its index and the worker branches untouched through a full cycle', async () => {
    const fixture = await createFixture();
    const before = sourceSnapshot(fixture);
    const { candidate } = await prepareCandidate(fixture);

    const outcome = await fixture.workspace.verify(fixture.run, candidate);
    expect(outcome.passed).toBe(true);
    await fixture.workspace.publish(fixture.run, fixture.base, candidate);

    expect(sourceSnapshot(fixture)).toEqual(before);
    expect(gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], fixture.workerOne).trim()).toBe('swarm-r1-w1');
    expect(gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], fixture.workerTwo).trim()).toBe('swarm-r1-w2');
    expect(gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], fixture.build).trim()).toBe('swarm-r1-build');
    expect(gitSync(['status', '--porcelain=v1'], fixture.workerOne)).toBe('');
    expect(gitSync(['status', '--porcelain=v1'], fixture.workerTwo)).toBe('');
    expect(await fixture.workspace.diff(fixture.run)).toContain('+alpha one');
  });
});