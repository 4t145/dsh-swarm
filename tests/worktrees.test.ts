/**
 * Worktree Host 服务（`swarmWorktrees`）的行为测试。
 *
 * 全部夹具都在临时目录的独立 Git 仓库里创建 worktree，不读也不写任何用户 checkout。
 * 重点覆盖：porcelain 解析、相对路径/分支/detached、每个 worktree 的提交历史与 20 条上界、
 * unborn/非 Git 目录的显式空态、创建路径与 base ref 校验、冲突、沙箱拒绝、unknown actor、
 * Git 失败，以及“创建不改变发起会话的用户 checkout”。
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { isRemoteFailure } from '@deepseek-ai/dsh-api-gateway/client';

import { SwarmError } from '../src/errors.ts';
import type { CommandExecutor, CommandResult } from '../src/ports.ts';
import {
  WORKTREE_LIMITS,
  WorktreeCatalogue,
  baseRefIssues,
  parseCommitLog,
  parseWorktreePorcelain,
  worktreeNameIssues,
  worktreeRemoteMethods,
} from '../src/worktrees.ts';
import { gitSync, LocalCommandExecutor } from './local-executor.ts';

const OWNER = 'owner-session';
const FIXED_NOW = Date.parse('2025-02-03T04:05:06Z');
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const COMMIT_IDENTITY = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com'] as const;
const fixtureRoots: string[] = [];

afterEach(async () => {
  for (const root of fixtureRoots.splice(0)) {
    if (!resolve(root).startsWith(join(tmpdir(), 'dsh-swarm-worktrees-'))) {
      throw new Error(`refusing to delete an unexpected fixture path: ${root}`);
    }
    await rm(root, { recursive: true, force: true });
  }
});

/** 临时目录（realpath 后登记清理）。 */
async function temporaryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-swarm-worktrees-')));
  fixtureRoots.push(root);
  return root;
}

function commit(cwd: string, message: string): void {
  gitSync([...COMMIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', message], cwd);
}

/** 有 `root commit` 的临时仓库。 */
async function repository(): Promise<string> {
  const root = await temporaryRoot();
  gitSync(['init', '-q', '-b', 'main'], root);
  commit(root, 'root commit');
  return root;
}

interface FixtureOptions {
  readonly executor?: CommandExecutor;
  readonly now?: () => number;
  readonly pathExists?: (path: string) => Promise<boolean>;
}

interface Fixture {
  readonly root: string;
  readonly catalogue: WorktreeCatalogue;
}

async function catalogueFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const root = await repository();
  const sessions = new Map<string, string>([[OWNER, root]]);
  const catalogue = new WorktreeCatalogue({
    executor: options.executor ?? new LocalCommandExecutor(),
    sessionDirectory: (sessionId) => sessions.get(sessionId),
    pathExists: options.pathExists ?? (async (path) => existsSync(path)),
    now: options.now ?? (() => FIXED_NOW),
  });
  return { root, catalogue };
}

/** 取失败的 Remote 错误；不是 Remote 失败时让测试失败。 */
async function failureOf(promise: Promise<unknown>): Promise<{
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
}> {
  try {
    await promise;
  } catch (error) {
    if (!isRemoteFailure(error)) throw error;
    return { code: error.code, message: error.message, details: error.details };
  }
  throw new Error('expected the call to fail');
}

/** 拦截指定 Git 子命令的执行器；其余请求交给本地执行器。 */
class InterceptingExecutor implements CommandExecutor {
  private readonly inner = new LocalCommandExecutor();

  constructor(
    private readonly intercept: (request: {
      readonly argv: readonly string[];
      readonly cwd: string;
      readonly actorSessionId: string;
    }) => CommandResult | undefined | never,
  ) {}

  run(request: Parameters<CommandExecutor['run']>[0]): Promise<CommandResult> {
    const injected = this.intercept(request);
    if (injected !== undefined) return Promise.resolve(injected);
    return this.inner.run(request);
  }
}

/** 匹配 `git ... worktree add ...`。 */
function isWorktreeAdd(argv: readonly string[]): boolean {
  return argv.includes('worktree') && argv.includes('add');
}

describe('parseWorktreePorcelain', () => {
  it('parses linked, detached, locked and prunable records', () => {
    const rows = parseWorktreePorcelain(
      [
        'worktree /repo',
        'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'branch refs/heads/main',
        '',
        'worktree /repo/.agents/worktrees/det',
        'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'detached',
        'prunable gitdir file points to non-existent location',
        '',
        'worktree /repo/.agents/worktrees/locked',
        'HEAD cccccccccccccccccccccccccccccccccccccccc',
        'branch refs/heads/locked',
        'locked testing lock',
        '',
      ].join('\n'),
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      path: '/repo',
      branch: 'main',
      detached: false,
      locked: null,
      prunable: null,
    });
    expect(rows[1]).toMatchObject({
      path: '/repo/.agents/worktrees/det',
      head: 'b'.repeat(40),
      branch: null,
      detached: true,
      prunable: 'gitdir file points to non-existent location',
    });
    expect(rows[2]).toMatchObject({ branch: 'locked', locked: 'testing lock' });
  });

  it('ignores malformed leading lines and CRLF', () => {
    const rows = parseWorktreePorcelain('garbage\r\nworktree /repo\r\nHEAD abc\r\nbranch refs/heads/main\r\n');
    expect(rows).toEqual([
      { path: '/repo', head: 'abc', branch: 'main', detached: false, bare: false, locked: null, prunable: null },
    ]);
  });
});

describe('parseCommitLog', () => {
  it('keeps short SHA and subject, and tolerates empty subjects', () => {
    const commits = parseCommitLog('aaaaaaa\u0000first\nbbbbbbb\u0000\n');
    expect(commits).toEqual([
      { shortSha: 'aaaaaaa', subject: 'first' },
      { shortSha: 'bbbbbbb', subject: '' },
    ]);
  });

  it('bounds the result to the requested limit', () => {
    const stdout = Array.from({ length: 30 }, (_, index) => `s${String(index)}\u0000c${String(index)}`).join('\n');
    expect(parseCommitLog(stdout)).toHaveLength(WORKTREE_LIMITS.history);
    expect(parseCommitLog(stdout, 3)).toHaveLength(3);
  });
});

describe('worktree name and base validation', () => {
  it('accepts safe single-component names', () => {
    for (const name of ['feat', 'fix-1', 'a.b_c', 'v2']) expect(worktreeNameIssues(name)).toEqual([]);
  });

  it('rejects unsafe or invalid names with actionable issues', () => {
    for (const name of ['-lead', 'has space', 'a/b', '..', 'a..b', 'trail.', 'x.lock', 'HEAD', '.hidden']) {
      const issues = worktreeNameIssues(name);
      expect(issues.length, `name ${name}`).toBeGreaterThan(0);
      expect(issues.every((issue) => issue.path === 'name' && issue.message.length > 0)).toBe(true);
    }
  });

  it('rejects option-like and whitespace-bearing base refs', () => {
    expect(baseRefIssues('HEAD')).toEqual([]);
    expect(baseRefIssues('origin/main')).toEqual([]);
    expect(baseRefIssues('-x').length).toBeGreaterThan(0);
    expect(baseRefIssues('has space').length).toBeGreaterThan(0);
    expect(baseRefIssues('').length).toBeGreaterThan(0);
  });
});

describe('WorktreeCatalogue.list', () => {
  it('lists the main worktree with branch, HEAD and commit records', async () => {
    const { root, catalogue } = await catalogueFixture();
    const snapshot = await catalogue.list(OWNER);
    expect(snapshot).toMatchObject({
      sessionDirectory: root,
      repositoryRoot: root,
      repositoryName: basename(root),
      note: null,
      updatedAt: FIXED_NOW,
    });
    expect(snapshot.worktrees).toHaveLength(1);
    const main = snapshot.worktrees[0];
    if (main === undefined) throw new Error('main worktree missing');
    expect(main).toMatchObject({
      relativePath: '.',
      branch: 'main',
      detached: false,
      isMain: true,
      isBare: false,
      locked: null,
      prunable: null,
      subject: 'root commit',
    });
    expect(main.head).not.toBeNull();
    expect(FULL_SHA.test(main.head ?? '')).toBe(true);
    expect(main.headShort).not.toBeNull();
    expect(main.head?.startsWith(main.headShort ?? '')).toBe(true);
    expect(main.commits).toEqual([{ shortSha: main.headShort, subject: 'root commit' }]);
  });

  it('lists linked worktrees relative to the repository root with their own histories', async () => {
    const { root, catalogue } = await catalogueFixture();
    const linked = join(root, '.agents', 'worktrees', 'feat');
    gitSync(['worktree', 'add', '-q', '-b', 'feat', linked, 'HEAD'], root);
    commit(linked, 'feature work');

    const snapshot = await catalogue.list(OWNER);
    expect(snapshot.worktrees).toHaveLength(2);
    const main = snapshot.worktrees[0];
    const feature = snapshot.worktrees[1];
    if (main === undefined || feature === undefined) throw new Error('worktrees missing');
    expect(main.subject).toBe('root commit');
    expect(feature).toMatchObject({
      path: linked,
      relativePath: '.agents/worktrees/feat',
      branch: 'feat',
      detached: false,
      isMain: false,
      subject: 'feature work',
    });
    expect(feature.commits[0]).toEqual({ shortSha: feature.headShort, subject: 'feature work' });
    // 主树历史不受 linked worktree 的提交影响。
    expect(main.commits).toHaveLength(1);
  });

  it('bounds each history to 20 commits, newest first', async () => {
    const { root, catalogue } = await catalogueFixture();
    for (let index = 1; index <= 25; index += 1) {
      commit(root, `commit ${String(index).padStart(2, '0')}`);
    }
    const snapshot = await catalogue.list(OWNER);
    const main = snapshot.worktrees[0];
    if (main === undefined) throw new Error('main worktree missing');
    expect(main.commits).toHaveLength(WORKTREE_LIMITS.history);
    expect(main.commits[0]?.subject).toBe('commit 25');
    expect(main.commits[WORKTREE_LIMITS.history - 1]?.subject).toBe('commit 06');
  });

  it('reports detached worktrees without a branch name', async () => {
    const { root, catalogue } = await catalogueFixture();
    gitSync(['worktree', 'add', '-q', '--detach', join(root, '.agents', 'worktrees', 'det'), 'HEAD'], root);
    const snapshot = await catalogue.list(OWNER);
    const detached = snapshot.worktrees.find((entry) => entry.relativePath === '.agents/worktrees/det');
    if (detached === undefined) throw new Error('detached worktree missing');
    expect(detached).toMatchObject({ branch: null, detached: true, isMain: false });
    expect(detached.headShort).not.toBeNull();
  });

  it('reports unborn repositories as an explicit empty state', async () => {
    const root = await temporaryRoot();
    gitSync(['init', '-q', '-b', 'main'], root);
    const catalogue = new WorktreeCatalogue({
      executor: new LocalCommandExecutor(),
      sessionDirectory: () => root,
      pathExists: async (path) => existsSync(path),
    });
    const snapshot = await catalogue.list(OWNER);
    expect(snapshot).toMatchObject({ repositoryRoot: root, note: 'unborn' });
    expect(snapshot.worktrees).toHaveLength(1);
    const main = snapshot.worktrees[0];
    if (main === undefined) throw new Error('main worktree missing');
    expect(main).toMatchObject({ branch: 'main', head: null, headShort: null, subject: null, commits: [] });
  });

  it('reports non-repository session directories without throwing', async () => {
    const directory = await temporaryRoot();
    const catalogue = new WorktreeCatalogue({
      executor: new LocalCommandExecutor(),
      sessionDirectory: () => directory,
      pathExists: async () => false,
    });
    const snapshot = await catalogue.list(OWNER);
    expect(snapshot).toEqual({
      sessionDirectory: directory,
      repositoryRoot: null,
      repositoryName: null,
      note: 'not-a-repository',
      worktrees: [],
      updatedAt: expect.any(Number),
    });
  });

  it('forbids sessions that do not own a working directory', async () => {
    const { catalogue } = await catalogueFixture();
    const error = await failureOf(catalogue.list('stranger'));
    expect(error.code).toBe('swarm-worktrees/forbidden');
    expect(error.message).toContain('stranger');
  });

  it('rejects an empty session id at the boundary', async () => {
    const { catalogue } = await catalogueFixture();
    const error = await failureOf(catalogue.list(''));
    expect(error).toMatchObject({ code: 'swarm-worktrees/bad-request' });
  });
});

describe('WorktreeCatalogue.create', () => {
  it('creates a branch and checkout under .agents/worktrees without touching the user checkout', async () => {
    const { root, catalogue } = await catalogueFixture();
    // 与真实仓库一致：worktree 池被忽略，因此未跟踪目录也不会改变 checkout 状态。
    await writeFile(join(root, '.gitignore'), '.agents/worktrees/\n');
    gitSync(['add', '.gitignore'], root);
    commit(root, 'ignore worktree pool');
    const headBefore = gitSync(['rev-parse', 'HEAD'], root).trim();
    const branchBefore = gitSync(['symbolic-ref', '--short', 'HEAD'], root).trim();
    const statusBefore = gitSync(['status', '--porcelain'], root);
    expect(statusBefore).toBe('');

    const result = await catalogue.create(OWNER, { name: 'feat-x' });

    expect(result.worktree).toMatchObject({
      relativePath: '.agents/worktrees/feat-x',
      branch: 'feat-x',
      detached: false,
      head: headBefore,
      subject: 'ignore worktree pool',
      isMain: false,
    });
    expect(result.worktree.path).toBe(join(root, '.agents', 'worktrees', 'feat-x'));
    expect(result.snapshot.worktrees).toHaveLength(2);
    // 新 worktree 是普通 Git worktree：分支与 checkout 都真实存在。
    expect(gitSync(['rev-parse', 'feat-x'], root).trim()).toBe(headBefore);
    expect(gitSync(['rev-parse', '--show-toplevel'], result.worktree.path).trim()).toBe(result.worktree.path);
    // 用户 checkout 保持原状：HEAD、分支、index 与工作区状态都不变。
    expect(gitSync(['rev-parse', 'HEAD'], root).trim()).toBe(headBefore);
    expect(gitSync(['symbolic-ref', '--short', 'HEAD'], root).trim()).toBe(branchBefore);
    expect(gitSync(['status', '--porcelain'], root)).toBe(statusBefore);
    expect(gitSync(['status', '--porcelain', '--untracked-files=no'], root)).toBe('');
    // 会话 cwd 没有被切换（Host 从未调用 workingDirectory.set）。
    expect(process.cwd()).not.toBe(result.worktree.path);
  });

  it('adds only the untracked .agents parent to a checkout that lacked it', async () => {
    const { root, catalogue } = await catalogueFixture();
    await catalogue.create(OWNER, { name: 'fresh' });
    // 未跟踪父目录是放在仓库内的唯一副作用；tracked 内容不变。
    expect(gitSync(['status', '--porcelain', '--untracked-files=no'], root)).toBe('');
    const untracked = gitSync(['status', '--porcelain'], root).trim().split('\n');
    expect(untracked).toEqual(['?? .agents/']);
  });

  it('generates a deterministic automatic name and de-duplicates it', async () => {
    const { catalogue } = await catalogueFixture();
    const first = await catalogue.create(OWNER, {});
    expect(first.worktree.branch).toBe('worktree-20250203-040506');
    const second = await catalogue.create(OWNER, {});
    expect(second.worktree.branch).toBe('worktree-20250203-040506-2');
  });

  it('defaults the base ref to HEAD and honors an explicit local base', async () => {
    const { root, catalogue } = await catalogueFixture();
    const first = gitSync(['rev-parse', 'HEAD'], root).trim();
    commit(root, 'second commit');
    const head = gitSync(['rev-parse', 'HEAD'], root).trim();

    const fromHead = await catalogue.create(OWNER, { name: 'from-head' });
    expect(fromHead.worktree.head).toBe(head);
    const fromBase = await catalogue.create(OWNER, { name: 'from-base', base: first });
    expect(fromBase.worktree.head).toBe(first);
    expect(gitSync(['rev-parse', 'from-base'], root).trim()).toBe(first);
  });

  it('reports an existing branch as a conflict', async () => {
    const { root, catalogue } = await catalogueFixture();
    gitSync(['branch', 'taken'], root);
    const error = await failureOf(catalogue.create(OWNER, { name: 'taken' }));
    expect(error.code).toBe('swarm-worktrees/conflict');
    expect(error.message).toContain('already exists');
    expect(error.details).toMatchObject({ kind: 'branch', branch: 'taken' });
  });

  it('reports an existing path as a conflict', async () => {
    const { root, catalogue } = await catalogueFixture();
    await mkdir(join(root, '.agents', 'worktrees', 'occupied'), { recursive: true });
    const error = await failureOf(catalogue.create(OWNER, { name: 'occupied' }));
    expect(error.code).toBe('swarm-worktrees/conflict');
    expect(error.details).toMatchObject({ kind: 'path' });
  });

  it('reports a worktree already registered at the target path as a conflict', async () => {
    const { root, catalogue } = await catalogueFixture();
    gitSync(['worktree', 'add', '-q', '--detach', join(root, '.agents', 'worktrees', 'detached'), 'HEAD'], root);
    const error = await failureOf(catalogue.create(OWNER, { name: 'detached' }));
    expect(error.code).toBe('swarm-worktrees/conflict');
    expect(error.details).toMatchObject({ kind: 'path' });
  });

  it('rejects invalid names and unresolvable base refs at the boundary', async () => {
    const { catalogue } = await catalogueFixture();
    const badName = await failureOf(catalogue.create(OWNER, { name: 'bad name' }));
    expect(badName.code).toBe('swarm-worktrees/bad-request');
    expect(Array.isArray((badName.details as { issues?: unknown }).issues)).toBe(true);

    const badBase = await failureOf(catalogue.create(OWNER, { name: 'fresh', base: 'no-such-ref' }));
    expect(badBase.code).toBe('swarm-worktrees/bad-request');
    expect(badBase.message).toContain('no-such-ref');

    const optionBase = await failureOf(catalogue.create(OWNER, { name: 'fresh2', base: '-x' }));
    expect(optionBase.code).toBe('swarm-worktrees/bad-request');
  });

  it('reports an unborn repository as an actionable bad base ref', async () => {
    const root = await temporaryRoot();
    gitSync(['init', '-q', '-b', 'main'], root);
    const catalogue = new WorktreeCatalogue({
      executor: new LocalCommandExecutor(),
      sessionDirectory: () => root,
      pathExists: async (path) => existsSync(path),
    });
    const error = await failureOf(catalogue.create(OWNER, { name: 'first' }));
    expect(error.code).toBe('swarm-worktrees/bad-request');
    expect(error.message).toContain('create a commit first');
  });

  it('reports a non-repository session directory', async () => {
    const directory = await temporaryRoot();
    const catalogue = new WorktreeCatalogue({
      executor: new LocalCommandExecutor(),
      sessionDirectory: () => directory,
      pathExists: async () => false,
    });
    const error = await failureOf(catalogue.create(OWNER, { name: 'nope' }));
    expect(error.code).toBe('swarm-worktrees/not-a-repository');
  });

  it('maps a read-only sandbox denial to an actionable sandbox error', async () => {
    const deny = new SwarmError('SWARM_FORBIDDEN', 'the sandbox denied this command under mode read-only', {
      details: { sandboxMode: 'read-only', exitCode: 1, argv: ['git'] },
    });
    const executor = new InterceptingExecutor((request) => {
      if (isWorktreeAdd(request.argv)) throw deny;
      return undefined;
    });
    const { catalogue } = await catalogueFixture({ executor });
    const error = await failureOf(catalogue.create(OWNER, { name: 'blocked' }));
    expect(error.code).toBe('swarm-worktrees/sandbox-denied');
    expect(error.details).toMatchObject({ mode: 'read-only' });
    expect(error.message).toContain('write access');
  });

  it('maps a vanished actor session to forbidden', async () => {
    const deny = new SwarmError('SWARM_FORBIDDEN', `actor session ${OWNER} is not a live agent`, {
      details: { reason: 'unknown-actor', actorSessionId: OWNER },
    });
    const executor = new InterceptingExecutor((request) => {
      if (isWorktreeAdd(request.argv)) throw deny;
      return undefined;
    });
    const { catalogue } = await catalogueFixture({ executor });
    const error = await failureOf(catalogue.create(OWNER, { name: 'gone' }));
    expect(error.code).toBe('swarm-worktrees/forbidden');
  });

  it('reports unexpected Git failures with the command and stderr', async () => {
    const executor = new InterceptingExecutor((request) =>
      isWorktreeAdd(request.argv)
        ? { exitCode: 1, stdout: '', stderr: 'fatal: simulated failure', signal: null, timedOut: false }
        : undefined,
    );
    const { catalogue } = await catalogueFixture({ executor });
    const error = await failureOf(catalogue.create(OWNER, { name: 'broken' }));
    expect(error.code).toBe('swarm-worktrees/git-failed');
    expect(error.message).toContain('simulated failure');
    expect(error.details).toMatchObject({ exitCode: 1, stderr: 'fatal: simulated failure' });
  });

  it('forbids unknown sessions before touching Git', async () => {
    const { catalogue } = await catalogueFixture();
    const error = await failureOf(catalogue.create('stranger', { name: 'x' }));
    expect(error.code).toBe('swarm-worktrees/forbidden');
  });
});

describe('swarmWorktrees Remote markers', () => {
  it('exports exactly the list and create methods', () => {
    expect(worktreeRemoteMethods()).toEqual([{ method: 'list' }, { method: 'create' }]);
  });
});
