import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SwarmError } from '../src/errors.ts';
import { createRun, type Run, type WorkerRecord } from '../src/types.ts';
import { GitWorkspace } from '../src/workspace.ts';
import { WorktreeHistory, WORKTREE_HISTORY_PAGE_SIZE, type WorktreeHistoryGitPort } from '../src/worktree-history.ts';
import { gitSync, LocalCommandExecutor } from './local-executor.ts';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(join(tmpdir(), 'swarm-history-'))) throw new Error('Unexpected fixture path');
    await rm(root, { recursive: true, force: true });
  }
});
function worker(id: string, path: string | null): WorkerRecord {
  return { id, sessionId: `${id}-session`, branch: id, worktreePath: path, initializationState: 'ready',
    initializationError: null, unavailableReason: null, offeredSeq: 0, observedSeq: 0, notifiedSeq: 0, wakeTargetSeq: 0,
    waitRegistration: null, currentTaskId: null, createdAt: 1 };
}
function makeRun(): Run {
  return createRun({ id: 'run', ownerSessionId: 'owner', repositoryRoot: '/repo', gitCommonDir: '/repo/.git', goal: 'goal',
    acceptanceCriteria: ['works'], verification: { setup: [], test: [{ argv: ['true'], timeoutMs: 1000 }] },
    baseCommit: 'a'.repeat(40), resultRef: 'refs/heads/result', deadline: null, budgetMinutes: 0 });
}
function service(run: Run, git: WorktreeHistoryGitPort) {
  return new WorktreeHistory({ status: () => ({ runId: run.id, ownerSessionId: run.ownerSessionId }), getRun: () => run, git });
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'swarm-history-'));
  roots.push(root);
  gitSync(['init', '--quiet', '-b', 'main'], root);
  gitSync(['config', 'user.name', 'Fixture'], root);
  gitSync(['config', 'user.email', 'fixture@example.invalid'], root);
  gitSync(['commit', '--quiet', '--allow-empty', '-m', 'before-run'], root);
  const base = gitSync(['rev-parse', 'HEAD'], root).trim();
  const run = makeRun();
  run.repositoryRoot = await realpath(root);
  run.gitCommonDir = await realpath(join(root, '.git'));
  run.baseCommit = base;
  run.acceptedHead = base;
  for (const id of ['w1', 'w2']) {
    const path = join(root, id);
    gitSync(['worktree', 'add', '--quiet', '-b', id, path, base], root);
    run.workers[id] = worker(id, path);
  }
  const git = new GitWorkspace(new LocalCommandExecutor());
  return { root, run, git, history: service(run, git) };
}
function commit(path: string, subject: string): string {
  gitSync(['commit', '--quiet', '--allow-empty', '-m', subject], path);
  return gitSync(['rev-parse', 'HEAD'], path).trim();
}

describe('real merged worktree Git history', () => {
  it('includes every branch and result merges once, with parents and bounded public fields', async () => {
    const { root, run, history } = await fixture();
    const one = run.workers['w1']!;
    const two = run.workers['w2']!;
    one.displayName = 'Calm Otter';
    const a = commit(one.worktreePath!, 'worker one');
    const b = commit(two.worktreePath!, 'worker two');
    gitSync(['merge', '--quiet', '--no-ff', '-m', 'integrate one', a], root);
    gitSync(['merge', '--quiet', '--no-ff', '-m', 'integrate two', b], root);
    run.acceptedHead = gitSync(['rev-parse', 'HEAD'], root).trim();
    const page = await history.page('owner');
    expect(page?.items).toHaveLength(4);
    expect(page?.items[0]).toMatchObject({ sha: run.acceptedHead, workerId: null, branch: run.resultRef });
    expect(page?.items[0]?.parents).toHaveLength(2);
    expect(page?.items.map((item) => item.sha)).toEqual(expect.arrayContaining([a, b]));
    expect(new Set(page?.items.map((item) => item.sha)).size).toBe(4);
    expect(page?.worktrees.map((lane) => lane.workerId)).toEqual(['w1', 'w2', null]);
    expect(page?.worktrees[0]?.displayName).toBe('Calm Otter');
    expect(page?.worktrees[1]?.displayName).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(page?.worktrees.every((lane) => lane.diagnostic === null)).toBe(true);
    expect(page?.items.every((item) => item.committedAt > 1_000_000_000_000)).toBe(true);
    expect(page?.nextCursor).toBeNull();
    expect(JSON.stringify(page)).not.toContain('before-run');
  });

  it('exposes proposal source commits as track tips, newest first and deduplicated', async () => {
    const { run, history } = await fixture();
    const a = commit(run.workers['w1']!.worktreePath!, 'worker one');
    const b = commit(run.workers['w2']!.worktreePath!, 'worker two');
    const proposal = (id: string, authorWorkerId: string, sourceCommit: string, createdAt: number) =>
      ({ id, authorWorkerId, sourceCommit, createdAt }) as Run['proposals'][string];
    run.proposals = { p1: proposal('p1', 'w1', a, 1), p2: proposal('p2', 'w2', b, 2), p3: proposal('p3', 'w2', a, 0), p4: proposal('p4', 'gone', b, 3) };
    const page = await history.page('owner');
    expect(page?.tips).toEqual([{ sha: b, workerId: 'w2' }, { sha: a, workerId: 'w1' }]);
  });

  it('pins a traversal so new commits do not cause duplicates or missing records between pages', async () => {
    const { run, history } = await fixture();
    const path = run.workers['w1']!.worktreePath!;
    const shas: string[] = [];
    for (let i = 0; i < WORKTREE_HISTORY_PAGE_SIZE + 5; i++) shas.push(commit(path, `change ${i}`));
    const first = (await history.page('owner'))!;
    expect(first.items).toHaveLength(WORKTREE_HISTORY_PAGE_SIZE);
    expect(first.nextCursor).toEqual(expect.any(String));
    const later = commit(path, 'new since first page');
    const second = (await history.page('owner', first.nextCursor))!;
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((item) => item.sha);
    expect(all).toEqual(shas.toReversed());
    expect(all).not.toContain(later);
    expect((await history.page('owner'))?.items[0]?.sha).toBe(later);
    await expect(history.page('owner', `${first.nextCursor}tamper`)).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });
    run.id = 'different-run';
    await expect(history.page('owner', first.nextCursor)).rejects.toMatchObject({ code: 'SWARM_INVALID_INPUT' });
  });

  it('reports missing/moved branches instead of inventing empty successful history', async () => {
    const { root, run, history } = await fixture();
    gitSync(['checkout', '--quiet', '--detach'], run.workers['w1']!.worktreePath!);
    run.workers['w2']!.initializationState = 'initializing';
    const page = await history.page('owner');
    expect(page?.items).toEqual([]);
    expect(page?.worktrees[0]).toMatchObject({ workerId: 'w1', head: null, diagnostic: expect.any(String) });
    expect(page?.worktrees[1]).toMatchObject({ workerId: 'w2', head: null, diagnostic: 'Worktree initializing' });
    expect(gitSync(['status', '--porcelain'], root)).toBe('?? w1/\n?? w2/\n');
  });

  it('rejects nonzero Git log and malformed/truncated output without yielding a false end', async () => {
    const { run } = await fixture();
    const first = commit(run.workers['w1']!.worktreePath!, 'first');
    const head = commit(run.workers['w1']!.worktreePath!, 'second');
    const local = new LocalCommandExecutor();
    // Also reject a buffer truncated exactly between complete commit records.
    for (const output of [null, 'truncated', [head, first, '1700000000', head, 'second'].join('\0')]) {
      const git = new GitWorkspace({ run: async (request) => request.argv.includes('log')
        ? { exitCode: output === null ? 128 : 0, stdout: output ?? '', stderr: 'fixture failure', timedOut: false, signal: null }
        : local.run(request) });
      await expect(service(run, git).page('owner')).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    }
  });
});

describe('history ownership and lifetime', () => {
  it('rejects a nonowner before reading any Git state', async () => {
    const run = makeRun();
    const git = { readWorktreeHead: vi.fn(), readWorktreeLog: vi.fn() };
    await expect(service(run, git).page('worker')).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    expect(git.readWorktreeHead).not.toHaveBeenCalled();
    expect(git.readWorktreeLog).not.toHaveBeenCalled();
  });

  it('propagates permission denials, but returns null for no current run', async () => {
    const run = makeRun();
    run.workers['w1'] = worker('w1', '/repo/w1');
    const git = { readWorktreeHead: vi.fn().mockRejectedValue(new SwarmError('SWARM_FORBIDDEN', 'sandbox denial')), readWorktreeLog: vi.fn() };
    await expect(service(run, git).page('owner')).rejects.toMatchObject({ code: 'SWARM_FORBIDDEN' });
    expect(git.readWorktreeLog).not.toHaveBeenCalled();
    const empty = new WorktreeHistory({ status: () => { throw new SwarmError('SWARM_NOT_FOUND', 'no run'); }, getRun: () => run, git });
    expect(await empty.page('owner')).toBeNull();
  });

  it('cancels and drains in-flight work on disposal and refuses later reads', async () => {
    const run = makeRun();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let finish!: () => void;
    let observedSignal: AbortSignal | undefined;
    const history = service(run, {
      readWorktreeHead: vi.fn(),
      readWorktreeLog: async (_run, _heads, _offset, _limit, signal) => {
        observedSignal = signal;
        entered();
        await new Promise<void>((resolve) => { finish = resolve; });
        return [];
      },
    });
    const reading = history.page('owner');
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    let disposed = false;
    const closing = history.dispose().then(() => { disposed = true; });
    expect(observedSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(disposed).toBe(false);
    finish();
    await closing;
    await rejected;
    await expect(history.page('owner')).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
  });

  it('does not let a response escape after the owner switches runs', async () => {
    const run = makeRun();
    // getRun returns a mutable fixture; production store values are immutable snapshots.
    const originalId = run.id;
    const checked = new WorktreeHistory({ status: () => ({ runId: run.id, ownerSessionId: 'owner' }), getRun: () => ({ ...run, id: originalId }),
      git: { readWorktreeHead: vi.fn(), readWorktreeLog: async () => { run.id = 'new-run'; return []; } } });
    await expect(checked.page('owner')).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
    await checked.dispose();
  });
});
