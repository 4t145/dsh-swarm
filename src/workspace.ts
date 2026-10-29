/**
 * Git 工作区访问：仓库身份核对、提交锁定、组合候选构造、验证与结果分支发布。
 *
 * 边界（架构 §5.2 / §8.1–§8.3）：
 * - 本类**不创建** worktree。创建由 Host 原生 worktree 服务完成，这里只核对并使用记录里的路径。
 * - 所有 Git 命令与验证命令都经过注入的 `CommandExecutor.run`；不导入 `child_process`，不拼 shell。
 * - 对用户 checkout 只跑只读命令（`rev-parse`/`status`/`diff`）和插件自有 ref 的 `update-ref`；
 *   `reset --hard` 只在核对过的插件集成 worktree 内执行。
 *
 * 命令隔离：每条 Git argv 都带 `--no-lazy-fetch` 与 `-c core.hooksPath=/dev/null` 等设置，禁用
 * repo hooks、fsmonitor、自动 gc、子模块递归、懒加载与已声明的 clean/smudge/process filter。
 * 只对本次调用生效，不写用户 `.git/config`（架构 §4）。这些设置都走 argv，因为端口没有 env
 * 字段；`GIT_NO_LAZY_FETCH`/`GIT_TERMINAL_PROMPT` 另由 Host 执行器补齐（notes/workspace-api.md §5），
 * 这里再显式加一次，使换任何执行器都仍然禁懒加载。
 */

import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';

import { normalizeError, SwarmError, type SwarmErrorCode } from './errors.ts';
import { disabledGitFilterArgs, GIT_ISOLATION_ARGV } from './git-isolation.ts';
import type {
  CandidateResult,
  CommandExecutor,
  CommandResult,
  RepositoryInfo,
  VerificationOutcome,
  WorkspacePort,
} from './ports.ts';
import type { WorktreeGitCommit } from './worktree-history.ts';
import type {
  CommandSpec,
  CommitSha,
  IntegrationAttempt,
  JsonObject,
  ProposalRecord,
  Run,
  RunSpec,
  WorkerRecord,
} from './types.ts';

/** 单条 Git 命令的墙钟上限；验证命令使用 `run.verification` 里各自的 `timeoutMs`。 */
const GIT_TIMEOUT_MS = 120_000;
/** 错误 details 里保留的诊断字符数。 */
const DIAGNOSTIC_LIMIT = 4_000;
/** 验证日志里单条命令保留的输出字符数，避免失控输出撑爆内存与记录。 */
const COMMAND_LOG_LIMIT = 65_536;

/** 插件自己创建候选提交时使用的提交者身份；不读也不写用户的 Git 配置。 */
const COMMIT_IDENTITY_ARGV: readonly string[] = [
  '-c',
  'user.name=dsh-swarm',
  '-c',
  'user.email=dsh-swarm@localhost',
];

const SHA_PATTERN = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
/** 只接受完整 ref 名；最终格式仍由 Git 校验，这里先排除拼接与明显非法的输入。 */
const REF_PATTERN = /^refs\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

interface GitIdentity {
  /** 规范化（realpath）后的 checkout 根。 */
  root: string;
  /** 规范化后的共享 Git 目录，作为同一仓库的身份键（架构 §4.2）。 */
  commonDir: string;
}

/**
 * `WorkspacePort` 的 Git 实现。
 *
 * 所有命令都走构造时注入的执行器；`run.ownerSessionId` 是 run 的权限来源，集成与验证命令
 * 一律以 owner 身份执行，不使用 worker 身份，也不扩大 worker 权限。
 */
export class GitWorkspace implements WorkspacePort {
  private readonly executor: CommandExecutor;
  /** cwd → 该仓库已声明 filter driver 的禁用参数；同一 checkout 的配置在一次 run 内视为稳定。 */
  private readonly filterArgsByCwd = new Map<string, readonly string[]>();

  constructor(executor: CommandExecutor) {
    this.executor = executor;
  }

  /**
   * 解析仓库身份与不可变基线，并检查工作区是否脏。
   *
   * 返回规范化后的 `repositoryRoot` / `gitCommonDir`、解析出的本地 `baseCommit` 与 `dirty`。
   * `dirty` 且 `spec.allowDirtyBaseline=false` 时抛 `SWARM_INVALID_STATE`（不 stash、不清理）；
   * 路径不可用或 `baseRef` 无法解析为本地 commit 时抛 `SWARM_INVALID_INPUT`。
   */
  async inspect(spec: RunSpec, actorSessionId: string, signal?: AbortSignal): Promise<RepositoryInfo> {
    if (typeof spec.repository !== 'string' || !isAbsolute(spec.repository)) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'run spec repository must be an absolute path', {
        details: { repository: spec.repository },
      });
    }
    const repositoryPath = await this.canonicalDirectory(
      spec.repository,
      'SWARM_INVALID_INPUT',
      'run spec repository',
    );
    const identity = await this.readIdentity(repositoryPath, actorSessionId, signal, 'SWARM_INVALID_INPUT');
    const baseCommit = await this.resolveCommit(
      identity.root,
      spec.baseRef,
      actorSessionId,
      signal,
      'run spec baseRef does not resolve to a local commit',
    );
    const entries = await this.worktreeEntries(identity.root, actorSessionId, signal);
    const dirty = entries.length > 0;
    if (dirty && !spec.allowDirtyBaseline) {
      throw new SwarmError(
        'SWARM_INVALID_STATE',
        'repository has uncommitted changes; commit or discard them, or set allowDirtyBaseline only to run from committed commits',
        {
          details: {
            repositoryRoot: identity.root,
            dirty: true,
            allowDirtyBaseline: false,
            entries: entries.slice(0, 20),
            entryCount: entries.length,
          },
        },
      );
    }
    return { repositoryRoot: identity.root, gitCommonDir: identity.commonDir, baseCommit, dirty };
  }

  /**
   * 创建 run 的 result ref 指向 `run.baseCommit`。
   *
   * 已存在且指向同一 commit 时视为已完成（恢复幂等）；指向别处时抛 `SWARM_INVALID_STATE`，
   * 绝不替换既有 ref。只写插件自有 ref，不碰用户分支与工作树。
   */
  async initializeResult(run: Run, signal?: AbortSignal): Promise<void> {
    const actor = run.ownerSessionId;
    const repository = await this.assertRunRepository(run, signal);
    const ref = assertRefName(run.resultRef, 'run.resultRef');
    const base = normalizeSha(run.baseCommit, 'run.baseCommit');
    await this.assertCommitExists(repository.root, base, actor, signal, 'run.baseCommit');

    const existing = await this.tryGitLine(
      repository.root,
      ['rev-parse', '--verify', '--quiet', '--end-of-options', ref],
      actor,
      signal,
    );
    if (existing !== null) {
      if (existing.toLowerCase() === base) {
        return;
      }
      throw new SwarmError(
        'SWARM_INVALID_STATE',
        `result ref ${ref} already exists at ${existing}; refusing to replace it`,
        { details: { resultRef: ref, existing, baseCommit: base } },
      );
    }

    const zero = await this.zeroOid(repository.root, actor, signal);
    const result = await this.runGit(repository.root, ['update-ref', ref, base, zero], actor, signal);
    if (result.exitCode !== 0) {
      throw this.gitFailure('SWARM_INVALID_STATE', `create result ref ${ref}`, ['update-ref', ref, base], result);
    }
  }

  /**
   * 核对提交来自本次 run 的 worker：同一仓库、同一 branch、该 branch 的当前 HEAD、工作树干净。
   *
   * 返回规范化的 commit SHA。任一核对失败抛 `SWARM_INVALID_STATE`，`details.check` 指明
   * 失败的检查项；commit 不是完整 SHA 时抛 `SWARM_INVALID_INPUT`。
   */
  async validateSubmission(
    run: Run,
    worker: WorkerRecord,
    commit: string,
    signal?: AbortSignal,
  ): Promise<CommitSha> {
    const actor = run.ownerSessionId;
    const submitted = normalizeSha(commit, 'sourceCommit');
    if (typeof worker.worktreePath !== 'string' || worker.worktreePath.length === 0) {
      throw new SwarmError('SWARM_INVALID_STATE', 'worker has no prepared worktree', {
        details: { workerId: worker.id, check: 'worktree' },
      });
    }
    const worktreePath = await this.canonicalDirectory(
      worker.worktreePath,
      'SWARM_INVALID_STATE',
      'worker worktree',
    );
    if (worktreePath === (await this.canonicalOrNull(run.repositoryRoot))) {
      throw new SwarmError('SWARM_INVALID_STATE', 'worker worktree must not be the user checkout', {
        details: { workerId: worker.id, worktreePath, check: 'worktree' },
      });
    }

    const expectedCommon = await this.canonicalDirectory(
      run.gitCommonDir,
      'SWARM_INVALID_STATE',
      'run.gitCommonDir',
    );
    const identity = await this.readIdentity(worktreePath, actor, signal, 'SWARM_INVALID_STATE');
    if (identity.root !== worktreePath) {
      throw new SwarmError('SWARM_INVALID_STATE', 'worker worktree path is not a checkout root', {
        details: { workerId: worker.id, worktreePath, actualRoot: identity.root, check: 'worktree' },
      });
    }
    if (identity.commonDir !== expectedCommon) {
      throw new SwarmError('SWARM_INVALID_STATE', 'worker worktree belongs to another repository', {
        details: {
          workerId: worker.id,
          worktreePath,
          gitCommonDir: expectedCommon,
          actualCommonDir: identity.commonDir,
          check: 'common_dir',
        },
      });
    }

    const expectedBranch = worker.branch.startsWith('refs/heads/')
      ? worker.branch.slice('refs/heads/'.length)
      : worker.branch;
    const headRef = await this.tryGitLine(worktreePath, ['symbolic-ref', '--quiet', 'HEAD'], actor, signal);
    const actualBranch = headRef === null ? null : headRef.replace(/^refs\/heads\//, '');
    if (actualBranch !== expectedBranch) {
      throw new SwarmError('SWARM_INVALID_STATE', 'worker checkout is not on its recorded branch', {
        details: { workerId: worker.id, worktreePath, branch: expectedBranch, actualBranch, check: 'branch' },
      });
    }

    const head = await this.gitLine(worktreePath, ['rev-parse', '--verify', 'HEAD'], actor, signal);
    if (head.toLowerCase() !== submitted) {
      throw new SwarmError('SWARM_INVALID_STATE', 'sourceCommit is not the worker branch head', {
        details: { workerId: worker.id, sourceCommit: submitted, head: head.toLowerCase(), check: 'head' },
      });
    }

    const dirty = await this.worktreeEntries(worktreePath, actor, signal);
    if (dirty.length > 0) {
      throw new SwarmError('SWARM_INVALID_STATE', 'worker worktree is not clean', {
        details: { workerId: worker.id, worktreePath, entries: dirty.slice(0, 20), check: 'clean' },
      });
    }
    return submitted;
  }

  /**
   * 把候选 commit 固定到 `proposal.proposalRef`。
   *
   * 该 ref 必须尚不存在；已存在且指向同一 commit 时为幂等成功，指向别处时抛
   * `SWARM_INVALID_STATE`——proposal ref 一旦写入不可移动。ref 名非法抛 `SWARM_INVALID_INPUT`。
   */
  async pinProposal(run: Run, proposal: ProposalRecord, signal?: AbortSignal): Promise<void> {
    const actor = run.ownerSessionId;
    const repository = await this.assertRunRepository(run, signal);
    const ref = assertRefName(proposal.proposalRef, 'proposal.proposalRef');
    const source = normalizeSha(proposal.sourceCommit, 'proposal.sourceCommit');
    await this.assertCommitExists(repository.root, source, actor, signal, 'proposal.sourceCommit');

    const existing = await this.tryGitLine(
      repository.root,
      ['rev-parse', '--verify', '--quiet', '--end-of-options', ref],
      actor,
      signal,
    );
    if (existing !== null) {
      if (existing.toLowerCase() === source) {
        return;
      }
      throw new SwarmError(
        'SWARM_INVALID_STATE',
        `proposal ref ${ref} is already pinned to ${existing}; refusing to move it`,
        { details: { proposalId: proposal.id, proposalRef: ref, existing, sourceCommit: source } },
      );
    }

    const zero = await this.zeroOid(repository.root, actor, signal);
    const result = await this.runGit(repository.root, ['update-ref', ref, source, zero], actor, signal);
    if (result.exitCode !== 0) {
      throw this.gitFailure(
        'SWARM_INVALID_STATE',
        `pin proposal ${proposal.id}`,
        ['update-ref', ref, source],
        result,
      );
    }
  }

  /**
   * 在插件集成 worktree 中把 HEAD 重置到验证基线 H，再合并候选 C，生成不可变候选提交 M。
   *
   * 只更新集成 worktree 自己的 HEAD/branch，绝不更新 result ref，也不碰用户 checkout 或
   * worker worktree。merge 失败时先取回冲突诊断，再把集成树恢复到 H，返回 `kind:'conflict'`；
   * C 已被 H 包含时返回 H 本身。集成树路径未记录、属于用户 checkout/worker 树、或检出了
   * result ref 时抛 `SWARM_INVALID_STATE`（不做任何破坏性操作）。
   */
  async buildCandidate(
    run: Run,
    proposal: ProposalRecord,
    attempt: IntegrationAttempt,
    signal?: AbortSignal,
  ): Promise<CandidateResult> {
    const actor = run.ownerSessionId;
    const integrationPath = await this.assertIntegrationWorktree(run, signal);
    if (attempt.proposalId !== proposal.id) {
      throw new SwarmError('SWARM_INVALID_STATE', 'integration attempt does not belong to the proposal', {
        details: { proposalId: proposal.id, attemptId: attempt.id, attemptProposalId: attempt.proposalId },
      });
    }
    const expectedHead = normalizeSha(attempt.expectedHead, 'attempt.expectedHead');
    const sourceCommit = normalizeSha(attempt.sourceCommit, 'attempt.sourceCommit');
    if (sourceCommit !== normalizeSha(proposal.sourceCommit, 'proposal.sourceCommit')) {
      throw new SwarmError('SWARM_INVALID_STATE', 'attempt sourceCommit does not match the proposal', {
        details: { proposalId: proposal.id, attemptId: attempt.id, sourceCommit, proposalSourceCommit: proposal.sourceCommit },
      });
    }
    await this.assertCommitExists(integrationPath, expectedHead, actor, signal, 'attempt.expectedHead');
    await this.assertCommitExists(integrationPath, sourceCommit, actor, signal, 'attempt.sourceCommit');

    const reset = await this.runGit(
      integrationPath,
      ['reset', '--hard', '--quiet', expectedHead],
      actor,
      signal,
    );
    if (reset.exitCode !== 0) {
      throw this.gitFailure(
        'SWARM_INVALID_STATE',
        'reset integration worktree to the expected head',
        ['reset', '--hard', expectedHead],
        reset,
      );
    }

    const mergeArgs = [
      ...COMMIT_IDENTITY_ARGV,
      'merge',
      '--no-ff',
      '--no-stat',
      '--no-gpg-sign',
      '-m',
      `swarm: integrate ${proposal.id}`,
      sourceCommit,
    ];
    const merge = await this.runGit(integrationPath, mergeArgs, actor, signal);
    if (merge.exitCode !== 0) {
      const diagnostics = await this.collectMergeDiagnostics(
        integrationPath,
        expectedHead,
        sourceCommit,
        merge,
        actor,
        signal,
      );
      return { kind: 'conflict', diagnostics };
    }

    const head = await this.gitLine(integrationPath, ['rev-parse', '--verify', 'HEAD'], actor, signal);
    const candidate = normalizeSha(head, 'candidate commit');
    if (candidate === expectedHead) {
      // C 已经是 H 的祖先：没有可合并内容，候选就是 H，不伪造 merge commit。
      return { kind: 'candidate', commit: candidate };
    }
    await this.assertMergeParents(integrationPath, candidate, expectedHead, sourceCommit, actor, signal);
    return { kind: 'candidate', commit: candidate };
  }

  /**
   * 在集成 worktree checkout `commit`，执行固定的 setup/test 命令并记录真实结果。
   *
   * 只要 setup 或 test 非零退出、超时、被取消，或命令改动了 tracked 文件，就返回
   * `passed:false`；不会把未知结果当成通过，也不更新 result ref。checkout 失败或执行器
   * 违反契约时抛 `SWARM_INVALID_STATE`/`SWARM_INTERNAL`；取消返回 `interrupted:true`。
   */
  async verify(run: Run, commit: CommitSha, signal?: AbortSignal): Promise<VerificationOutcome> {
    const actor = run.ownerSessionId;
    const candidate = normalizeSha(commit, 'verification commit');
    const log: string[] = [`# verify ${candidate}`];
    try {
      const integrationPath = await this.assertIntegrationWorktree(run, signal);
      await this.assertCommitExists(integrationPath, candidate, actor, signal, 'verification commit');
      if (run.verification.test.length === 0) {
        log.push('[no test command configured: this run cannot decide whether the candidate may be published]');
        return { passed: false, interrupted: false, exitCode: null, timedOut: false, log: log.join('\n') };
      }

      const reset = await this.runGit(
        integrationPath,
        ['reset', '--hard', '--quiet', candidate],
        actor,
        signal,
      );
      if (reset.exitCode !== 0) {
        throw this.gitFailure(
          'SWARM_INVALID_STATE',
          'checkout verification commit',
          ['reset', '--hard', candidate],
          reset,
        );
      }

      const plan = commandPlan(run.verification);
      let interrupted = false;
      let timedOut = false;
      let failed = false;
      let exitCode: number | null = null;

      for (const step of plan) {
        if (isAborted(signal)) {
          interrupted = true;
          exitCode = null;
          break;
        }
        log.push(`[${step.phase} ${step.index}/${step.total}] ${step.spec.argv.join(' ')}`);
        let result: CommandResult;
        try {
          result = await this.executor.run({
            argv: [...step.spec.argv],
            cwd: integrationPath,
            timeoutMs: step.spec.timeoutMs,
            actorSessionId: actor,
            signal,
          });
        } catch (error) {
          if (isAborted(signal)) {
            interrupted = true;
            exitCode = null;
            break;
          }
          throw normalizeError(error, 'SWARM_INTERNAL', `run ${step.phase} command`);
        }
        exitCode = result.exitCode;
        appendCommandOutput(log, result);
        if (result.timedOut) {
          timedOut = true;
          failed = true;
          log.push('[timed out]');
          break;
        }
        if (isAborted(signal)) {
          interrupted = true;
          exitCode = null;
          log.push('[cancelled]');
          break;
        }
        if (result.exitCode !== 0) {
          failed = true;
          log.push(`[exit code ${result.exitCode === null ? 'none' : String(result.exitCode)}]`);
          break;
        }
      }

      let polluted = false;
      if (!interrupted && !failed) {
        const entries = await this.trackedEntries(integrationPath, actor, signal);
        if (entries.length > 0) {
          polluted = true;
          log.push('[tracked files changed by verification commands]', ...entries.slice(0, 50));
          if (entries.length > 50) {
            log.push(`[... ${entries.length - 50} more changed paths]`);
          }
        }
      }
      log.push(
        interrupted
          ? '[result] interrupted'
          : failed
            ? '[result] failed'
            : polluted
              ? '[result] failed: verification commands modified tracked files'
              : '[result] passed',
      );
      return {
        passed: !interrupted && !failed && !polluted,
        interrupted,
        exitCode,
        timedOut,
        log: log.join('\n'),
      };
    } catch (error) {
      if (isCancellation(error)) {
        log.push('[cancelled]');
        return { passed: false, interrupted: true, exitCode: null, timedOut: false, log: log.join('\n') };
      }
      throw error;
    }
  }

  /**
   * 以 `expected` 为 expectedHead 对 result ref 做 update-ref CAS。
   *
   * 只在 ref 当前值等于 `expected` 时推进到 `candidate`；否则抛 `SWARM_STALE_HEAD`
   * （`details.actual` 是实际值或 null），不改动 ref。candidate 必须是本地 commit。
   */
  async publish(run: Run, expected: CommitSha, candidate: CommitSha, signal?: AbortSignal): Promise<void> {
    const actor = run.ownerSessionId;
    const repository = await this.assertRunRepository(run, signal);
    const ref = assertRefName(run.resultRef, 'run.resultRef');
    const expectedSha = normalizeSha(expected, 'expected head');
    const candidateSha = normalizeSha(candidate, 'candidate commit');
    await this.assertCommitExists(repository.root, candidateSha, actor, signal, 'candidate commit');

    const update = await this.runGit(
      repository.root,
      ['update-ref', ref, candidateSha, expectedSha],
      actor,
      signal,
    );
    if (update.exitCode !== 0) {
      const actual = await this.tryGitLine(
        repository.root,
        ['rev-parse', '--verify', '--quiet', '--end-of-options', ref],
        actor,
        signal,
      );
      throw new SwarmError('SWARM_STALE_HEAD', `result ref ${ref} is not at the expected head`, {
        details: {
          resultRef: ref,
          expected: expectedSha,
          candidate: candidateSha,
          actual,
          exitCode: update.exitCode,
          stderr: truncate(update.stderr),
        },
      });
    }
  }

  /** 读取 result ref 当前指向的 commit；ref 不存在时抛 `SWARM_NOT_FOUND`。 */
  async resultHead(run: Run, signal?: AbortSignal): Promise<CommitSha> {
    const repository = await this.assertRunRepository(run, signal);
    return this.resolveResultHead(run, repository.root, signal);
  }

  /** 返回 `run.baseCommit` 到 result ref 的完整 patch（不调用外部 diff/textconv 驱动）。 */
  async diff(run: Run, signal?: AbortSignal): Promise<string> {
    const actor = run.ownerSessionId;
    const repository = await this.assertRunRepository(run, signal);
    const base = normalizeSha(run.baseCommit, 'run.baseCommit');
    const head = await this.resolveResultHead(run, repository.root, signal);
    return this.gitText(
      repository.root,
      ['diff', '--no-ext-diff', '--no-textconv', '--no-color', base, head],
      actor,
      signal,
      'SWARM_INVALID_STATE',
      'diff result branch against the base commit',
    );
  }

  /** Read a live worker HEAD only after checking its recorded worktree and repository identity. */
  async readWorktreeHead(run: Run, worker: WorkerRecord, signal?: AbortSignal): Promise<CommitSha> {
    if (!worker.worktreePath) throw new SwarmError('SWARM_INVALID_STATE', 'Worker worktree is not prepared');
    const path = await this.canonicalDirectory(worker.worktreePath, 'SWARM_INVALID_STATE', 'worker worktree');
    const identity = await this.readIdentity(path, run.ownerSessionId, signal, 'SWARM_INVALID_STATE');
    const common = await this.canonicalDirectory(run.gitCommonDir, 'SWARM_INVALID_STATE', 'run.gitCommonDir');
    if (identity.root !== path || identity.commonDir !== common) {
      throw new SwarmError('SWARM_INVALID_STATE', 'Worker worktree repository identity changed');
    }
    const expectedRef = worker.branch.startsWith('refs/heads/') ? worker.branch : `refs/heads/${worker.branch}`;
    const actualRef = await this.gitLine(path, ['symbolic-ref', '--quiet', 'HEAD'], run.ownerSessionId, signal);
    if (actualRef !== expectedRef) throw new SwarmError('SWARM_INVALID_STATE', 'Worker worktree is not on its recorded branch');
    return normalizeSha(await this.gitLine(path, ['rev-parse', '--verify', 'HEAD'], run.ownerSessionId, signal), 'worker HEAD');
  }

  /** Traverse the pinned, deduplicated run DAG; never read other refs or pre-run history. */
  async readWorktreeLog(run: Run, heads: readonly string[], offset: number, limit: number, signal?: AbortSignal): Promise<readonly WorktreeGitCommit[]> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || heads.length > 17) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'Invalid Git history page bounds');
    }
    if (!heads.length) return [];
    const pinned = [...new Set(heads.map((head) => normalizeSha(head, 'history head')))];
    const repository = await this.assertRunRepository(run, signal);
    const traversal = ['--date-order', `--skip=${offset}`, `--max-count=${limit}`, ...pinned, `^${normalizeSha(run.baseCommit, 'run.baseCommit')}`, '--'];
    // The small SHA-only page detects even whole-record truncation by bounded Host output buffers.
    const expectedText = await this.gitText(repository.root, ['rev-list', ...traversal], run.ownerSessionId, signal, 'SWARM_INVALID_STATE', 'enumerate worktree Git history');
    const expected = expectedText.trim() ? expectedText.trim().split('\n').map((sha) => normalizeSha(sha, 'history commit')) : [];
    const output = await this.gitText(repository.root, [
      'log', '--no-patch', '--no-notes', '--no-show-signature', '--no-decorate', '--no-color', '--source', '-z',
      '--format=format:%H%x00%P%x00%ct%x00%S%x00%<(240,trunc)%s', ...traversal,
    ], run.ownerSessionId, signal, 'SWARM_INVALID_STATE', 'read worktree Git history');
    if (!output && !expected.length) return [];
    const fields = output.split('\0');
    if (fields.length % 5 !== 0) throw new SwarmError('SWARM_INVALID_STATE', 'Git history output was incomplete or malformed');
    const commits: WorktreeGitCommit[] = [];
    for (let i = 0; i < fields.length; i += 5) {
      const [sha, parentsText, seconds, sourceHead, subject] = fields.slice(i, i + 5);
      const committedAt = Number(seconds) * 1000;
      if (!sha || parentsText === undefined || !seconds || !/^-?\d+$/.test(seconds) || !sourceHead || subject === undefined
        || !Number.isFinite(committedAt) || Math.abs(committedAt) > 8.64e15 || !pinned.includes(sourceHead)) {
        throw new SwarmError('SWARM_INVALID_STATE', 'Git history returned invalid commit fields');
      }
      commits.push({ sha: normalizeSha(sha, 'history commit'), parents: parentsText ? parentsText.split(' ').map((parent) => normalizeSha(parent, 'history parent')) : [],
        committedAt, sourceHead, subject: subject.trimEnd().slice(0, 240) });
    }
    if (commits.length !== expected.length || commits.some((commit, index) => commit.sha !== expected[index])) {
      throw new SwarmError('SWARM_INVALID_STATE', 'Git history output was truncated; increase commandOutputBytes');
    }
    return commits;
  }

  /* ------------------------------ 仓库身份 ------------------------------ */

  /** 解析 cwd 所在仓库的规范化 root 与共享 Git 目录。 */
  private async readIdentity(
    cwd: string,
    actor: string,
    signal: AbortSignal | undefined,
    code: SwarmErrorCode,
  ): Promise<GitIdentity> {
    const toplevel = await this.gitLine(cwd, ['rev-parse', '--show-toplevel'], actor, signal, code, 'resolve repository root');
    const root = await this.canonicalDirectory(toplevel, code, 'repository root');
    const common = await this.resolveGitPath(cwd, '--git-common-dir', actor, signal, code);
    const commonDir = await this.canonicalDirectory(common, code, 'git common dir');
    return { root, commonDir };
  }

  /** `--path-format=absolute` 在 Git ≥ 2.31 可用；旧版本退化为按 cwd 解析相对输出。 */
  private async resolveGitPath(
    cwd: string,
    flag: string,
    actor: string,
    signal: AbortSignal | undefined,
    code: SwarmErrorCode,
  ): Promise<string> {
    const absolute = await this.tryGitLine(
      cwd,
      ['rev-parse', '--path-format=absolute', flag],
      actor,
      signal,
    );
    if (absolute !== null) {
      return absolute;
    }
    const relative = await this.gitLine(cwd, ['rev-parse', flag], actor, signal, code, `resolve ${flag}`);
    return resolvePath(cwd, relative);
  }

  /** 核对 run 记录的仓库身份仍与磁盘一致（commonDir 是唯一身份键）。 */
  private async assertRunRepository(run: Run, signal: AbortSignal | undefined): Promise<GitIdentity> {
    const actor = run.ownerSessionId;
    const repositoryRoot = await this.canonicalDirectory(
      run.repositoryRoot,
      'SWARM_INVALID_STATE',
      'run.repositoryRoot',
    );
    const expectedCommon = await this.canonicalDirectory(
      run.gitCommonDir,
      'SWARM_INVALID_STATE',
      'run.gitCommonDir',
    );
    const identity = await this.readIdentity(repositoryRoot, actor, signal, 'SWARM_INVALID_STATE');
    if (identity.commonDir !== expectedCommon) {
      throw new SwarmError('SWARM_INVALID_STATE', 'run repository identity changed on disk', {
        details: {
          repositoryRoot,
          gitCommonDir: expectedCommon,
          actualCommonDir: identity.commonDir,
        },
      });
    }
    return identity;
  }

  /**
   * 核对 `run.integrationWorktree` 确实是同一个仓库里、由插件拥有的独立 checkout。
   *
   * 拒绝：未记录、不是 checkout 根、属于别的仓库、等于用户 checkout 或任一 worker worktree、
   * 检出了 result ref。拒绝发生在任何 reset/merge 之前。
   */
  private async assertIntegrationWorktree(run: Run, signal: AbortSignal | undefined): Promise<string> {
    const actor = run.ownerSessionId;
    if (run.integrationWorktree === null) {
      throw new SwarmError('SWARM_INVALID_STATE', 'run has no integration worktree yet', {
        details: { runId: run.id },
      });
    }
    const integrationPath = await this.canonicalDirectory(
      run.integrationWorktree,
      'SWARM_INVALID_STATE',
      'run.integrationWorktree',
    );
    const expectedCommon = await this.canonicalDirectory(
      run.gitCommonDir,
      'SWARM_INVALID_STATE',
      'run.gitCommonDir',
    );
    const identity = await this.readIdentity(integrationPath, actor, signal, 'SWARM_INVALID_STATE');
    if (identity.root !== integrationPath) {
      throw new SwarmError('SWARM_INVALID_STATE', 'integration worktree path is not a checkout root', {
        details: { integrationWorktree: integrationPath, actualRoot: identity.root, reason: 'not_checkout_root' },
      });
    }
    if (identity.commonDir !== expectedCommon) {
      throw new SwarmError('SWARM_INVALID_STATE', 'integration worktree belongs to another repository', {
        details: {
          integrationWorktree: integrationPath,
          gitCommonDir: expectedCommon,
          actualCommonDir: identity.commonDir,
          reason: 'common_dir',
        },
      });
    }

    const userCheckout = await this.canonicalOrNull(run.repositoryRoot);
    if (userCheckout !== null && userCheckout === integrationPath) {
      throw new SwarmError('SWARM_INVALID_STATE', 'refusing to use the user checkout as the integration worktree', {
        details: { integrationWorktree: integrationPath, reason: 'user_checkout' },
      });
    }
    for (const worker of Object.values(run.workers)) {
      if (worker.worktreePath === null) {
        continue;
      }
      const workerPath = await this.canonicalOrNull(worker.worktreePath);
      if (workerPath !== null && workerPath === integrationPath) {
        throw new SwarmError('SWARM_INVALID_STATE', 'refusing to use a worker worktree as the integration worktree', {
          details: { integrationWorktree: integrationPath, workerId: worker.id, reason: 'worker_worktree' },
        });
      }
    }

    const checkoutRef = await this.tryGitLine(integrationPath, ['symbolic-ref', '--quiet', 'HEAD'], actor, signal);
    if (checkoutRef !== null && checkoutRef === run.resultRef) {
      throw new SwarmError('SWARM_INVALID_STATE', 'integration worktree must not check out the result ref', {
        details: { integrationWorktree: integrationPath, resultRef: run.resultRef, reason: 'result_ref_checked_out' },
      });
    }
    return integrationPath;
  }

  /* ------------------------------ 候选与诊断 ------------------------------ */

  /** 冲突后先收集未合并路径，再把集成树恢复到 H；恢复失败则报告而不是留下半合并状态。 */
  private async collectMergeDiagnostics(
    integrationPath: string,
    expectedHead: CommitSha,
    sourceCommit: CommitSha,
    merge: CommandResult,
    actor: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const unmerged = await this.tryGitLine(
      integrationPath,
      ['diff', '--name-only', '--diff-filter=U', '--no-ext-diff', '--no-textconv'],
      actor,
      signal,
    );
    const restore = await this.runGit(
      integrationPath,
      ['reset', '--hard', '--quiet', expectedHead],
      actor,
      signal,
    );
    if (restore.exitCode !== 0) {
      throw new SwarmError('SWARM_INVALID_STATE', 'failed to restore the integration worktree after a merge failure', {
        details: {
          integrationWorktree: integrationPath,
          expectedHead,
          mergeExitCode: merge.exitCode,
          restoreExitCode: restore.exitCode,
          stderr: truncate(restore.stderr),
        },
      });
    }
    return [
      `merge of ${sourceCommit} onto ${expectedHead} failed (git exit ${String(merge.exitCode ?? 'signal')})`,
      unmerged === null || unmerged === ''
        ? 'no unmerged paths: git stopped before creating a merge result'
        : `conflicted paths:\n${unmerged}`,
      truncate(merge.stdout),
      truncate(merge.stderr),
    ]
      .filter((section) => section !== '')
      .join('\n\n');
  }

  /** merge 成功的候选必须是 H 与 C 的合并提交；否则报告内部不一致。 */
  private async assertMergeParents(
    integrationPath: string,
    candidate: CommitSha,
    expectedHead: CommitSha,
    sourceCommit: CommitSha,
    actor: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const line = await this.gitLine(
      integrationPath,
      ['rev-list', '--parents', '-n', '1', candidate],
      actor,
      signal,
    );
    const [, ...parents] = line.split(' ');
    if (!parents.includes(expectedHead) || !parents.includes(sourceCommit)) {
      throw new SwarmError('SWARM_INTERNAL', 'candidate commit does not merge the expected head and source commit', {
        details: { candidate, expectedHead, sourceCommit, parents },
      });
    }
  }

  /** result ref 当前值；不存在时抛 `SWARM_NOT_FOUND`。 */
  private async resolveResultHead(
    run: Run,
    repositoryRoot: string,
    signal: AbortSignal | undefined,
  ): Promise<CommitSha> {
    const ref = assertRefName(run.resultRef, 'run.resultRef');
    const sha = await this.tryGitLine(
      repositoryRoot,
      ['rev-parse', '--verify', '--quiet', '--end-of-options', ref],
      run.ownerSessionId,
      signal,
    );
    if (sha === null) {
      throw new SwarmError('SWARM_NOT_FOUND', `result ref ${ref} does not exist`, {
        details: { resultRef: ref },
      });
    }
    return normalizeSha(sha, 'result ref');
  }

  /* ------------------------------ Git 执行 ------------------------------ */

  /**
   * 执行一条 Git 命令（自动加隔离参数与 filter 禁用参数）。
   *
   * 超时与取消抛 `SWARM_INVALID_STATE`（`details.cancelled` 标记取消）；非零退出由调用方
   * 用自己的错误码与操作名报告。
   */
  private async runGit(
    cwd: string,
    args: readonly string[],
    actor: string,
    signal: AbortSignal | undefined,
  ): Promise<CommandResult> {
    const filterArgs = await this.filterIsolationArgs(cwd, actor, signal);
    return this.runGitRaw(cwd, [...filterArgs, ...args], actor, signal, 'git');
  }

  /** 不带 filter 预扫描的 Git 执行入口；filter 预扫描自身也走这里以避免递归。 */
  private async runGitRaw(
    cwd: string,
    args: readonly string[],
    actor: string,
    signal: AbortSignal | undefined,
    operation: string,
  ): Promise<CommandResult> {
    const argv = ['git', ...GIT_ISOLATION_ARGV, ...args];
    this.assertNotAborted(signal, operation);
    let result: CommandResult;
    try {
      result = await this.executor.run({
        argv,
        cwd,
        timeoutMs: GIT_TIMEOUT_MS,
        actorSessionId: actor,
        signal,
      });
    } catch (error) {
      if (isAborted(signal)) {
        throw this.cancellation(operation);
      }
      throw normalizeError(error, 'SWARM_INTERNAL', operation);
    }
    if (result.timedOut) {
      throw new SwarmError('SWARM_INVALID_STATE', `${operation} timed out after ${GIT_TIMEOUT_MS}ms`, {
        details: { operation, argv, timedOut: true },
      });
    }
    if (isAborted(signal)) {
      throw this.cancellation(operation);
    }
    return result;
  }

  /** Git stdout（原样保留换行），非零退出抛 `code`。 */
  private async gitText(
    cwd: string,
    args: readonly string[],
    actor: string,
    signal: AbortSignal | undefined,
    code: SwarmErrorCode,
    operation: string,
  ): Promise<string> {
    const result = await this.runGit(cwd, args, actor, signal);
    if (result.exitCode !== 0) {
      throw this.gitFailure(code, operation, args, result);
    }
    return result.stdout;
  }

  /** Git stdout 去掉首尾空白，非零退出抛 `code`。 */
  private async gitLine(
    cwd: string,
    args: readonly string[],
    actor: string,
    signal: AbortSignal | undefined,
    code: SwarmErrorCode = 'SWARM_INVALID_STATE',
    operation: string = `git ${args[0] ?? 'command'}`,
  ): Promise<string> {
    return (await this.gitText(cwd, args, actor, signal, code, operation)).trim();
  }

  /** 只用于条件判断的 Git 调用；非零退出返回 null（不当作成功）。 */
  private async tryGitLine(
    cwd: string,
    args: readonly string[],
    actor: string,
    signal: AbortSignal | undefined,
  ): Promise<string | null> {
    const result = await this.runGit(cwd, args, actor, signal);
    if (result.exitCode !== 0) {
      return null;
    }
    return result.stdout.trim();
  }

  /** 关闭仓库里真实声明过的 filter driver（clean/smudge/process 置空，并且不要求 driver 存在）。 */
  private async filterIsolationArgs(
    cwd: string,
    actor: string,
    signal: AbortSignal | undefined,
  ): Promise<readonly string[]> {
    const cached = this.filterArgsByCwd.get(cwd);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.runGitRaw(
      cwd,
      ['config', '--get-regexp', '^filter\\.'],
      actor,
      signal,
      'read configured Git filters',
    );
    // 退出码 1 表示没有 filter 配置；其他失败留给真正的 Git 命令报出更准确的错误。
    if (result.exitCode !== 0) {
      return [];
    }
    const args = disabledGitFilterArgs(result.stdout);
    this.filterArgsByCwd.set(cwd, args);
    return args;
  }

  /** `git status --porcelain` 的条目；包含 staged/unstaged/untracked。 */
  private async worktreeEntries(
    cwd: string,
    actor: string,
    signal: AbortSignal | undefined,
  ): Promise<string[]> {
    const text = await this.gitLine(
      cwd,
      ['status', '--porcelain=v1', '--untracked-files=normal'],
      actor,
      signal,
      'SWARM_INVALID_STATE',
      'read checkout status',
    );
    return splitLines(text);
  }

  /** 被验证命令改动的 tracked 路径（暂存或未暂存）；忽略 untracked 生成物。 */
  private async trackedEntries(
    cwd: string,
    actor: string,
    signal: AbortSignal | undefined,
  ): Promise<string[]> {
    const text = await this.gitLine(
      cwd,
      ['status', '--porcelain=v1', '--untracked-files=no'],
      actor,
      signal,
      'SWARM_INVALID_STATE',
      'read tracked changes after verification',
    );
    return splitLines(text);
  }

  /** 确认 sha 是本地已存在的 commit（只读本地对象，不触发懒加载）。 */
  private async assertCommitExists(
    cwd: string,
    sha: string,
    actor: string,
    signal: AbortSignal | undefined,
    field: string,
  ): Promise<void> {
    const resolved = await this.tryGitLine(
      cwd,
      ['rev-parse', '--verify', '--quiet', '--end-of-options', `${sha}^{commit}`],
      actor,
      signal,
    );
    if (resolved === null) {
      throw new SwarmError('SWARM_INVALID_INPUT', `${field} is not a local commit: ${sha}`, {
        details: { [field]: sha },
      });
    }
  }

  /** update-ref 需要的全零旧值，随仓库对象格式（sha1/sha256）选择长度。 */
  private async zeroOid(cwd: string, actor: string, signal: AbortSignal | undefined): Promise<string> {
    const format = await this.tryGitLine(cwd, ['rev-parse', '--show-object-format'], actor, signal);
    return '0'.repeat(format === 'sha256' ? 64 : 40);
  }

  /** 解析 ref/rev 为本地 commit SHA；解析失败抛 `SWARM_INVALID_INPUT`。 */
  private async resolveCommit(
    cwd: string,
    rev: string,
    actor: string,
    signal: AbortSignal | undefined,
    message: string,
  ): Promise<CommitSha> {
    if (typeof rev !== 'string' || rev.trim() === '') {
      throw new SwarmError('SWARM_INVALID_INPUT', 'baseRef must be a non-empty string', {
        details: { baseRef: rev },
      });
    }
    const sha = await this.tryGitLine(
      cwd,
      ['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`],
      actor,
      signal,
    );
    if (sha === null) {
      throw new SwarmError('SWARM_INVALID_INPUT', message, { details: { baseRef: rev } });
    }
    return normalizeSha(sha, 'baseRef');
  }

  /* ------------------------------ 小工具 ------------------------------ */

  private gitFailure(
    code: SwarmErrorCode,
    operation: string,
    args: readonly string[],
    result: CommandResult,
  ): SwarmError {
    const details: JsonObject = {
      operation,
      argv: [...args],
      exitCode: result.exitCode,
      signal: result.signal,
      stderr: truncate(result.stderr),
      stdout: truncate(result.stdout),
    };
    return new SwarmError(code, `${operation} failed (${exitDescription(result)})`, {
      details,
    });
  }

  private cancellation(operation: string): SwarmError {
    return new SwarmError('SWARM_INVALID_STATE', `${operation} cancelled`, {
      details: { cancelled: true, operation },
    });
  }

  /** 取消在每次命令前后都检查；取消不是 Git 失败，用 `details.cancelled` 标记。 */
  private assertNotAborted(signal: AbortSignal | undefined, operation: string): void {
    if (isAborted(signal)) {
      throw this.cancellation(operation);
    }
  }

  /** realpath + 目录校验；失败按调用方给的错误码报告。 */
  private async canonicalDirectory(path: string, code: SwarmErrorCode, label: string): Promise<string> {
    let resolved: string;
    try {
      resolved = await realpath(path);
    } catch (error) {
      throw new SwarmError(code, `${label} is not a readable path: ${path}`, {
        details: { path },
        cause: error,
      });
    }
    const stats = await stat(resolved);
    if (!stats.isDirectory()) {
      throw new SwarmError(code, `${label} is not a directory: ${path}`, { details: { path: resolved } });
    }
    return resolved;
  }

  /** realpath，路径不存在时返回 null（用于比较“是不是同一个目录”）。 */
  private async canonicalOrNull(path: string): Promise<string | null> {
    try {
      return await realpath(path);
    } catch {
      return null;
    }
  }
}

interface PlannedCommand {
  phase: 'setup' | 'test';
  index: number;
  total: number;
  spec: CommandSpec;
}

/** setup 先于 test；两段各自编号，便于日志定位。 */
function commandPlan(verification: { setup: readonly CommandSpec[]; test: readonly CommandSpec[] }): PlannedCommand[] {
  const plan: PlannedCommand[] = [];
  verification.setup.forEach((spec, index) => {
    plan.push({ phase: 'setup', index: index + 1, total: verification.setup.length, spec });
  });
  verification.test.forEach((spec, index) => {
    plan.push({ phase: 'test', index: index + 1, total: verification.test.length, spec });
  });
  return plan;
}

/** 校验并返回完整 ref 名；只接受 `refs/...`，拒绝会让 update-ref 落入其它命名空间的输入。 */
function assertRefName(value: string, field: string): string {
  const valid =
    typeof value === 'string' &&
    REF_PATTERN.test(value) &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.endsWith('/') &&
    !value.endsWith('.lock') &&
    value.split('/').length >= 3;
  if (!valid) {
    throw new SwarmError('SWARM_INVALID_INPUT', `${field} must be a full Git ref name`, {
      details: { field, value },
    });
  }
  return value;
}

/** 校验并返回小写完整 commit SHA；短 SHA 与 refs 一律拒绝，避免固定到可变目标。 */
function normalizeSha(value: string, field: string): CommitSha {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA_PATTERN.test(normalized)) {
    throw new SwarmError('SWARM_INVALID_INPUT', `${field} must be a full 40- or 64-character hex commit SHA`, {
      details: { field, value },
    });
  }
  return normalized;
}

/** 取消状态在 await 之间可能变化，通过函数读取，避免编译器记住过期的窄化结果。 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof SwarmError &&
    error.details !== null &&
    error.details['cancelled'] === true
  );
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '');
}

function truncate(text: string, limit: number = DIAGNOSTIC_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[... truncated ${text.length - limit} chars ...]`;
}

/** 诊断里描述一次命令的结束方式：退出码、终止信号或未知。 */
function exitDescription(result: CommandResult): string {
  if (result.exitCode !== null) {
    return `git exit ${result.exitCode}`;
  }
  return result.signal === null ? 'git produced no exit code' : `git killed by ${result.signal}`;
}

/** 把命令输出写进验证日志；单条命令的输出有上限，避免失控输出撑爆记录。 */
function appendCommandOutput(log: string[], result: CommandResult): void {
  const stdout = truncate(result.stdout, COMMAND_LOG_LIMIT);
  const stderr = truncate(result.stderr, COMMAND_LOG_LIMIT);
  if (stdout !== '') {
    log.push(stdout.trimEnd());
  }
  if (stderr !== '') {
    log.push(`[stderr] ${stderr.trimEnd()}`);
  }
}