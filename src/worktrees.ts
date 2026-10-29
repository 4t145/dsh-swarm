/**
 * Worktree tab Host 服务：只读列出会话仓库已注册的 Git worktree，并按请求新建一个。
 *
 * 边界（架构 §5.2 / AGENTS §3）：
 * - **不改会话目录**：本模块从不调用 `ctx.worktrees.create`（它会把调用 Agent 的
 *   cwd 切到新 worktree），也不调用 `workingDirectory.set`。用户 checkout 的 HEAD、
 *   index 与工作区保持原样；新建的只是普通 Git worktree 与分支。
 * - **命令只走 Host 适配器**：所有 Git 命令都经注入的 `CommandExecutor.run`，即
 *   `ctx.subprocess` / `ctx.sandbox` / `ctx.sandboxPolicy`，不接受 shell 字符串。
 * - **无 run 依赖**：列表与创建只依赖会话的工作目录，Swarm run 不存在时同样可用。
 * - **仓库根取主 worktree**：在 linked worktree 里打开面板时仍列出同一仓库的全部
 *   worktree，路径相对主 worktree 根；`git worktree list --porcelain` 的第一项即主树。
 * - **可预期失败**：非法输入、冲突、非 Git 目录、沙箱拒绝与 Git 失败分别映射为稳定的
 *   `swarm-worktrees/*` Remote 错误码，消息可直接展示；不吞错、不空成功。
 *
 * 该服务按既有 Typert Remote 模式（`src/progress.ts`）暴露 `list`/`create`：显式安装
 * Remote 标记，保持 source-fallback 的具名参数，无需 Typert 代码生成。
 *
 * @module @deepseek-ai/dsh-swarm/worktrees
 */

import { basename, join, relative, resolve as resolvePath, sep } from 'node:path';

import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-fs';
import { SessionId } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-working-directory';
import {
  RemoteError,
  TypertRemoteService,
  remoteMethods,
} from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';

import { isSwarmError } from './errors.ts';
import { markRemoteMethod } from './remote-marker.ts';
import type { CommandExecutor, CommandResult } from './ports.ts';

/* ------------------------------------------------------------------ */
/* 错误码                                                              */
/* ------------------------------------------------------------------ */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** 请求方会话没有可归属的存活工作目录（非本会话或已销毁）。 */
    'swarm-worktrees/forbidden': {
      readonly sessionId: string;
    };
    /** 边界校验失败：name/base 形状或 Git ref 语义不合法。 */
    'swarm-worktrees/bad-request': {
      readonly issues?: readonly object[];
    };
    /** 会话工作目录不在任何 Git working tree 内。 */
    'swarm-worktrees/not-a-repository': {
      readonly directory: string;
    };
    /** 新分支或目标路径已被占用。 */
    'swarm-worktrees/conflict': {
      readonly kind: 'branch' | 'path';
      readonly branch: string;
      readonly path: string;
    };
    /** Host 沙箱拒绝了写操作（例如只读模式）。 */
    'swarm-worktrees/sandbox-denied': {
      readonly mode: string;
      readonly command: string;
      readonly detail: string;
    };
    /** Git 命令非零退出或无法执行。 */
    'swarm-worktrees/git-failed': {
      readonly command: string;
      readonly exitCode: number | null;
      readonly stderr: string;
    };
  }
}

/* ------------------------------------------------------------------ */
/* 公共 DTO 与上限                                                     */
/* ------------------------------------------------------------------ */

/** 单次输出的固定上限；保证面板一帧的体积有界。 */
export const WORKTREE_LIMITS = Object.freeze({
  sessionIdChars: 200,
  shaChars: 80,
  nameChars: 120,
  baseChars: 200,
  subjectChars: 200,
  branchChars: 200,
  pathChars: 500,
  diagnosticChars: 2_000,
  history: 20,
  worktrees: 100,
});

/** 列表为空的原因；`null` 表示仓库正常且有 worktree。 */
export type WorktreeNote = 'not-a-repository' | 'unborn' | 'empty';

/** 一条最近提交记录。 */
export interface WorktreeCommit {
  /** Git 的短 SHA（`%h`）。 */
  readonly shortSha: string;
  readonly subject: string;
}

/** 一个已注册 worktree 的公开视图。 */
export interface WorktreeEntry {
  /** 规范化前的绝对 checkout 路径（来自 `git worktree list --porcelain`）。 */
  readonly path: string;
  /** 相对仓库根（主 worktree）的路径；主树为 `.`。 */
  readonly relativePath: string;
  /** 分支短名（去掉 `refs/heads/`）；detached/bare 时为 null。 */
  readonly branch: string | null;
  readonly detached: boolean;
  /** HEAD 完整 SHA；unborn/bare 时为 null。 */
  readonly head: string | null;
  /** HEAD 短 SHA；unborn/bare 时为 null。 */
  readonly headShort: string | null;
  /** HEAD 提交标题；unborn/bare 时为 null。 */
  readonly subject: string | null;
  readonly isMain: boolean;
  readonly isBare: boolean;
  /** Git 的 locked 原因；未锁定为 null。 */
  readonly locked: string | null;
  /** Git 的 prunable 原因；不可清理为 null。 */
  readonly prunable: string | null;
  /** 最近提交（最多 {@link WORKTREE_LIMITS.history} 条，最新在前）。 */
  readonly commits: readonly WorktreeCommit[];
}

/** 面板一次渲染所需的仓库与 worktree 事实。 */
export interface WorktreeSnapshot {
  /** 解析工作目录得到的会话 cwd；用于空态提示。 */
  readonly sessionDirectory: string;
  /** 主 worktree 的仓库根；非 Git 目录时为 null。 */
  readonly repositoryRoot: string | null;
  /** 仓库目录名；非 Git 目录时为 null。 */
  readonly repositoryName: string | null;
  readonly note: WorktreeNote | null;
  readonly worktrees: readonly WorktreeEntry[];
  readonly updatedAt: number;
}

/** 新建请求：name 省略时自动生成，base 省略时用 HEAD。 */
export interface WorktreeCreateRequest {
  readonly name?: string;
  readonly base?: string;
}

/** 新建结果：新 worktree 的视图与刷新后的完整快照。 */
export interface WorktreeCreateResult {
  readonly worktree: WorktreeEntry;
  readonly snapshot: WorktreeSnapshot;
}

/* ------------------------------------------------------------------ */
/* 内部结构                                                            */
/* ------------------------------------------------------------------ */

/** `git worktree list --porcelain` 的单条记录。 */
export interface WorktreeRow {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: string | null;
  prunable: string | null;
}

/** 校验后的新建输入；`undefined` 表示使用默认值。 */
interface CreateInput {
  readonly name: string | undefined;
  readonly base: string | undefined;
}

/** 执行器端口 + 会话目录解析 + 可选路径探针；Cordis 依赖留在 {@link WorktreesService}。 */
export interface WorktreeCatalogueOptions {
  readonly executor: CommandExecutor;
  /**
   * 存活会话的工作目录；返回 undefined 表示该 sessionId 没有可归属的会话。
   * 抛错按 undefined 处理（不可归属）。
   */
  readonly sessionDirectory: (sessionId: string) => string | undefined;
  /** 目标路径是否已存在；不可判定时返回 false，让 Git 给出真实错误。 */
  readonly pathExists?: (path: string) => Promise<boolean>;
  /** 测试注入的时钟；默认 `Date.now`。 */
  readonly now?: () => number;
}

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

/** 单条 Git 命令的墙钟上限；创建 checkout 可能比只读命令慢。 */
const GIT_TIMEOUT_MS = 120_000;
/** 每条 Git argv 都带的隔离设置；与 `src/workspace.ts` 保持一致。 */
const GIT_ISOLATION_ARGV: readonly string[] = [
  '--no-lazy-fetch',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=false',
  '-c',
  'submodule.recurse=false',
];
/** 新建 worktree 的固定父目录（相对仓库根）。 */
const WORKTREE_PARENT = join('.agents', 'worktrees');
/** unborn 仓库在 porcelain 里报告的 HEAD。 */
const ZERO_SHA = /^0+$/;
/** 只用单目录分量的安全分支名；比 Git 更窄，避免路径穿越与嵌套目录。 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** 空白与控制字符会改变 argv 解析或 ref 语义，一律拒绝。 */
const UNSAFE_REF_CHARS = /[\u0000-\u0020\u007f]/;

/** 新建请求的边界形状；语义（Git ref 规则、base 可解析）在下面单独校验。 */
const createRequestSchema = z.strictObject({
  name: z.string().trim().max(WORKTREE_LIMITS.nameChars).optional(),
  base: z.string().trim().max(WORKTREE_LIMITS.baseChars).optional(),
});

/* ------------------------------------------------------------------ */
/* 解析与格式化                                                        */
/* ------------------------------------------------------------------ */

/** 截断到上限字符并去掉首尾空白；空串折算为 null。 */
function boundedText(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (text === '') return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** 把平台分隔符统一成 `/`，便于 UI 展示。 */
function toPosix(value: string): string {
  return sep === '/' ? value : value.split(sep).join('/');
}

/** 路径比较只做词法规整；两边都来自 Git 的绝对路径或本模块 join 的结果。 */
function samePath(left: string, right: string): boolean {
  return resolvePath(left) === resolvePath(right);
}

/**
 * 解析 `git worktree list --porcelain`。
 *
 * @param stdout - 命令输出。
 * @returns 记录数组，顺序与 Git 输出一致（主 worktree 在前）。
 */
export function parseWorktreePorcelain(stdout: string): WorktreeRow[] {
  const rows: WorktreeRow[] = [];
  let current: WorktreeRow | null = null;
  const finish = (): void => {
    if (current !== null) rows.push(current);
    current = null;
  };
  for (const line of stdout.split(/\r?\n/)) {
    if (line === '') {
      finish();
      continue;
    }
    if (line.startsWith('worktree ')) {
      finish();
      current = {
        path: line.slice('worktree '.length).trim(),
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: null,
        prunable: null,
      };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim() || null;
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim();
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    } else if (line === 'detached') {
      current.detached = true;
    } else if (line === 'bare') {
      current.bare = true;
    } else if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = line.slice('locked'.length).trim() || 'locked';
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.prunable = line.slice('prunable'.length).trim() || 'prunable';
    }
  }
  finish();
  return rows;
}

/**
 * 解析 `git log --format=%h%x00%s` 的输出。
 *
 * @param stdout - 每行 `shortSha\0subject`。
 * @returns 有界提交记录；无法解析的行被忽略。
 */
export function parseCommitLog(stdout: string, limit: number = WORKTREE_LIMITS.history): WorktreeCommit[] {
  const commits: WorktreeCommit[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (commits.length >= limit) break;
    const separator = line.indexOf('\u0000');
    if (separator <= 0) continue;
    const shortSha = boundedText(line.slice(0, separator), 16);
    if (shortSha === null) continue;
    // 空标题提交（--allow-empty-message）保留为显式空串，不折叠成“没有提交”。
    const subject = boundedText(line.slice(separator + 1), WORKTREE_LIMITS.subjectChars) ?? '';
    commits.push({ shortSha, subject });
  }
  return commits;
}

/** 新分支名的语义校验；返回空数组表示合法。 */
export function worktreeNameIssues(name: string): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (!NAME_PATTERN.test(name)) {
    issues.push({
      path: 'name',
      message: 'use a single name made of letters, digits, dot, dash or underscore, starting with a letter or digit',
    });
  }
  if (name.includes('..')) issues.push({ path: 'name', message: 'must not contain ".."' });
  if (name.includes('@{')) issues.push({ path: 'name', message: 'must not contain "@{"' });
  if (name.endsWith('.')) issues.push({ path: 'name', message: 'must not end with "."' });
  if (name.endsWith('.lock')) issues.push({ path: 'name', message: 'must not end with ".lock"' });
  if (name === 'HEAD') issues.push({ path: 'name', message: 'must not be HEAD' });
  return issues;
}

/** base ref 的语法校验；可解析性由 Git 判定。 */
export function baseRefIssues(base: string): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (base.startsWith('-')) issues.push({ path: 'base', message: 'must not start with "-"' });
  if (UNSAFE_REF_CHARS.test(base)) {
    issues.push({ path: 'base', message: 'must not contain whitespace or control characters' });
  }
  if (base === '') issues.push({ path: 'base', message: 'must not be empty' });
  return issues;
}

/** `worktree-YYYYMMDD-HHMMSS`（UTC），使自动名可复现且不含平台分隔符。 */
function automaticName(now: number): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `worktree-${day}-${time}`;
}

function badRequest(issues: { path: string; message: string }[]): RemoteError<'swarm-worktrees/bad-request'> {
  const summary = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
  return new RemoteError('swarm-worktrees/bad-request', `invalid worktree request: ${summary}`, { issues });
}

function forbiddenError(sessionId: string): RemoteError<'swarm-worktrees/forbidden'> {
  return new RemoteError(
    'swarm-worktrees/forbidden',
    `session ${JSON.stringify(sessionId)} has no live working directory; the Worktrees tab only reads the calling session's own repository`,
    { sessionId },
  );
}

/** 边界校验：形状 + name/base 语法；`undefined`/空串使用默认值。 */
function parseCreateRequest(request: unknown): CreateInput {
  const parsed = createRequestSchema.safeParse(request ?? {});
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.') || 'request', message: issue.message })),
    );
  }
  const name = parsed.data.name === undefined || parsed.data.name === '' ? undefined : parsed.data.name;
  const base = parsed.data.base === undefined || parsed.data.base === '' ? undefined : parsed.data.base;
  const issues: { path: string; message: string }[] = [];
  if (name !== undefined) issues.push(...worktreeNameIssues(name));
  if (base !== undefined) issues.push(...baseRefIssues(base));
  if (issues.length > 0) throw badRequest(issues);
  return { name, base };
}

/* ------------------------------------------------------------------ */
/* 可测试的 catalogue（无 Cordis 依赖）                                */
/* ------------------------------------------------------------------ */

/**
 * Worktree 列表与创建的实现核心。
 *
 * 只依赖 `CommandExecutor` 与会话目录解析，因此测试可以在临时仓库里直接驱动，
 * 不需要 Cordis、模型或真实用户工作区。
 */
export class WorktreeCatalogue {
  private readonly executor: CommandExecutor;
  private readonly sessionDirectory: (sessionId: string) => string | undefined;
  private readonly pathExists: ((path: string) => Promise<boolean>) | undefined;
  private readonly now: () => number;

  constructor(options: WorktreeCatalogueOptions) {
    this.executor = options.executor;
    this.sessionDirectory = options.sessionDirectory;
    this.pathExists = options.pathExists;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * 读取会话仓库的全部已注册 worktree。
   *
   * @param sessionId - 调用方会话 id；必须能解析到存活工作目录。
   * @returns 有界快照；非 Git 目录、unborn 或空仓库返回带 `note` 的空列表。
   * @throws {RemoteError} `swarm-worktrees/forbidden`（会话不可归属）或
   *   `swarm-worktrees/git-failed`（无法读取列表）。
   */
  async list(sessionId: string): Promise<WorktreeSnapshot> {
    const directory = this.resolveSession(sessionId);
    return this.readSnapshot(directory, sessionId);
  }

  /**
   * 在 `<仓库根>/.agents/worktrees/<name>` 新建分支与 checkout。
   *
   * @param sessionId - 调用方会话 id；Git 命令以它的沙箱策略执行。
   * @param request - 可选 name（默认自动生成）与 base（默认 HEAD）。
   * @returns 新 worktree 视图与刷新后的快照。
   * @throws {RemoteError} forbidden / bad-request / not-a-repository / conflict /
   *   sandbox-denied / git-failed。
   */
  async create(sessionId: string, request: WorktreeCreateRequest): Promise<WorktreeCreateResult> {
    const directory = this.resolveSession(sessionId);
    const input = parseCreateRequest(request);
    const repositoryRoot = await this.resolveRepository(directory, sessionId);
    if (repositoryRoot === null) {
      throw new RemoteError(
        'swarm-worktrees/not-a-repository',
        `${JSON.stringify(directory)} is not a Git working tree; open the Worktrees tab from a session whose working directory is inside a Git repository`,
        { directory },
      );
    }
    const rows = await this.readRows(repositoryRoot, sessionId);
    // 以主 worktree 为仓库根：在 linked worktree 中打开时也写入同一仓库。
    const root = rows[0]?.path ?? repositoryRoot;
    const baseRef = input.base ?? 'HEAD';
    const baseCommit = await this.resolveCommit(root, baseRef, sessionId);
    const name = input.name ?? (await this.allocateAutomaticName(root, rows, sessionId));
    const targetPath = join(root, WORKTREE_PARENT, name);
    if (input.name !== undefined) {
      await this.assertAvailable(root, rows, name, targetPath, sessionId);
    }
    const filterArgs = await this.filterIsolationArgs(root, sessionId);
    const argv = [
      'git',
      ...GIT_ISOLATION_ARGV,
      ...filterArgs,
      'worktree',
      'add',
      '-b',
      name,
      targetPath,
      baseCommit,
    ];
    const result = await this.run(argv, root, sessionId);
    if (result.exitCode !== 0) {
      // 预检已排除确定性冲突；剩余失败按真实 Git 结果报告，不猜测本地化消息。
      throw this.gitFailure(argv, result);
    }
    const snapshot = await this.readSnapshot(directory, sessionId);
    const created = snapshot.worktrees.find((entry) => samePath(entry.path, targetPath));
    if (created === undefined) {
      throw new RemoteError(
        'swarm-worktrees/git-failed',
        `git worktree add reported success but ${JSON.stringify(targetPath)} is not in the refreshed worktree list`,
        { command: argv.join(' '), exitCode: 0, stderr: '' },
      );
    }
    return { worktree: created, snapshot };
  }

  /** 解析 sessionId → 存活会话的工作目录；不可归属时抛 forbidden。 */
  private resolveSession(sessionId: unknown): string {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      throw badRequest([{ path: 'sessionId', message: 'must be a non-empty string' }]);
    }
    if (sessionId.length > WORKTREE_LIMITS.sessionIdChars) {
      throw badRequest([
        { path: 'sessionId', message: `must be at most ${String(WORKTREE_LIMITS.sessionIdChars)} characters` },
      ]);
    }
    let directory: string | undefined;
    try {
      directory = this.sessionDirectory(sessionId);
    } catch {
      directory = undefined;
    }
    if (directory === undefined || directory === '') throw forbiddenError(sessionId);
    return directory;
  }

  /** 工作目录所在的 Git 仓库根；不在工作树内返回 null（由 Git 退出码判定，不解析本地化文本）。 */
  private async resolveRepository(directory: string, actor: string): Promise<string | null> {
    const result = await this.run(['git', ...GIT_ISOLATION_ARGV, 'rev-parse', '--show-toplevel'], directory, actor);
    if (result.exitCode !== 0) return null;
    const root = result.stdout.split(/\r?\n/)[0]?.trim() ?? '';
    return root === '' ? null : root;
  }

  /** `git worktree list --porcelain` 的原始记录。 */
  private async readRows(root: string, actor: string): Promise<WorktreeRow[]> {
    const argv = ['git', ...GIT_ISOLATION_ARGV, 'worktree', 'list', '--porcelain'];
    const result = await this.run(argv, root, actor);
    if (result.exitCode !== 0) throw this.gitFailure(argv, result);
    return parseWorktreePorcelain(result.stdout);
  }

  /** 读取所有 worktree 的公开视图；失败保持显式。 */
  private async readSnapshot(directory: string, actor: string): Promise<WorktreeSnapshot> {
    const repositoryRoot = await this.resolveRepository(directory, actor);
    const updatedAt = this.now();
    if (repositoryRoot === null) {
      return {
        sessionDirectory: directory,
        repositoryRoot: null,
        repositoryName: null,
        note: 'not-a-repository',
        worktrees: [],
        updatedAt,
      };
    }
    const rows = await this.readRows(repositoryRoot, actor);
    if (rows.length === 0) {
      return {
        sessionDirectory: directory,
        repositoryRoot,
        repositoryName: basename(repositoryRoot) || repositoryRoot,
        note: 'empty',
        worktrees: [],
        updatedAt,
      };
    }
    const root = rows[0]?.path ?? repositoryRoot;
    const mainHead = rows[0]?.head ?? null;
    const unborn = mainHead !== null && ZERO_SHA.test(mainHead);
    const worktrees: WorktreeEntry[] = [];
    for (const [index, row] of rows.slice(0, WORKTREE_LIMITS.worktrees).entries()) {
      const isMain = index === 0;
      const unbornHead = row.head === null || ZERO_SHA.test(row.head);
      const history = unbornHead || row.head === null ? [] : await this.readHistory(root, row.head, actor);
      const head = unbornHead ? null : boundedText(row.head, WORKTREE_LIMITS.shaChars);
      const headShort = history[0]?.shortSha ?? null;
      const relativePath = isMain ? '.' : toPosix(relative(root, row.path)) || '.';
      worktrees.push({
        path: row.path,
        relativePath: boundedText(relativePath, WORKTREE_LIMITS.pathChars) ?? '.',
        branch: boundedText(row.branch, WORKTREE_LIMITS.branchChars),
        detached: row.detached,
        head,
        headShort,
        subject: history[0]?.subject ?? null,
        isMain,
        isBare: row.bare,
        locked: boundedText(row.locked, WORKTREE_LIMITS.diagnosticChars),
        prunable: boundedText(row.prunable, WORKTREE_LIMITS.diagnosticChars),
        commits: history,
      });
    }
    return {
      sessionDirectory: directory,
      repositoryRoot: root,
      repositoryName: basename(root) || root,
      note: unborn ? 'unborn' : null,
      worktrees,
      updatedAt,
    };
  }

  /** 某个 HEAD 的最近提交；unborn/无效 SHA 由调用方跳过。 */
  private async readHistory(root: string, rev: string, actor: string): Promise<WorktreeCommit[]> {
    const argv = [
      'git',
      ...GIT_ISOLATION_ARGV,
      'log',
      '-n',
      String(WORKTREE_LIMITS.history),
      '--format=%h%x00%s',
      rev,
      '--',
    ];
    const result = await this.run(argv, root, actor);
    if (result.exitCode !== 0) throw this.gitFailure(argv, result);
    return parseCommitLog(result.stdout);
  }

  /** 分支是否已存在；退出码 1 只是“没有该 ref”。 */
  private async branchExists(root: string, branch: string, actor: string): Promise<boolean> {
    const argv = ['git', ...GIT_ISOLATION_ARGV, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`];
    const result = await this.run(argv, root, actor);
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1) return false;
    throw this.gitFailure(argv, result);
  }

  /** 目标路径是否已存在；探针失败按“不存在”处理，让 Git 报告真实错误。 */
  private async probePathExists(path: string): Promise<boolean> {
    if (this.pathExists === undefined) return false;
    try {
      return await this.pathExists(path);
    } catch {
      return false;
    }
  }

  /** 分支名或目标路径冲突时抛 conflict（先到先报，消息含可操作建议）。 */
  private async assertAvailable(
    root: string,
    rows: readonly WorktreeRow[],
    name: string,
    targetPath: string,
    actor: string,
  ): Promise<void> {
    if (await this.branchExists(root, name, actor)) {
      throw new RemoteError(
        'swarm-worktrees/conflict',
        `branch ${JSON.stringify(name)} already exists; pick another name or delete the branch first`,
        { kind: 'branch', branch: name, path: targetPath },
      );
    }
    const registered = rows.some((row) => samePath(row.path, targetPath));
    if (registered || (await this.probePathExists(targetPath))) {
      throw new RemoteError(
        'swarm-worktrees/conflict',
        `${JSON.stringify(targetPath)} already exists; pick another name or remove that directory first`,
        { kind: 'path', branch: name, path: targetPath },
      );
    }
  }

  /** 自动名：固定时间戳；已被占用时追加 -2、-3…，最多到 -99。 */
  private async allocateAutomaticName(
    root: string,
    rows: readonly WorktreeRow[],
    actor: string,
  ): Promise<string> {
    const stamp = automaticName(this.now());
    for (let index = 1; index <= 99; index += 1) {
      const candidate = index === 1 ? stamp : `${stamp}-${String(index)}`;
      const targetPath = join(root, WORKTREE_PARENT, candidate);
      if (await this.branchExists(root, candidate, actor)) continue;
      if (rows.some((row) => samePath(row.path, targetPath))) continue;
      if (await this.probePathExists(targetPath)) continue;
      return candidate;
    }
    throw new RemoteError(
      'swarm-worktrees/bad-request',
      'could not allocate a unique automatic worktree name; pass an explicit name',
      { issues: [{ path: 'name', message: 'automatic names exhausted' }] },
    );
  }

  /** base ref → 本地 commit SHA；不可解析或形状不符时抛 bad-request。 */
  private async resolveCommit(root: string, base: string, actor: string): Promise<string> {
    const argv = [
      'git',
      ...GIT_ISOLATION_ARGV,
      'rev-parse',
      '--verify',
      '--quiet',
      '--end-of-options',
      `${base}^{commit}`,
    ];
    const result = await this.run(argv, root, actor);
    const sha = result.stdout.trim();
    if (result.exitCode !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
      throw badRequest([
        {
          path: 'base',
          message: `${JSON.stringify(base)} does not resolve to a local commit in this repository; create a commit first or use a local branch, tag or commit SHA`,
        },
      ]);
    }
    return sha;
  }

  /** 读取仓库已声明的 filter driver，并在本次 checkout 中禁用它们（不写用户配置）。 */
  private async filterIsolationArgs(root: string, actor: string): Promise<string[]> {
    const probe = await this.run(
      ['git', ...GIT_ISOLATION_ARGV, 'config', '--get-regexp', '^filter\\.'],
      root,
      actor,
    );
    // 退出码 1 表示没有 filter 配置；其他失败留给真正的 Git 命令报出更准确的错误。
    if (probe.exitCode !== 0) return [];
    const drivers = new Set<string>();
    for (const line of probe.stdout.split(/\r?\n/)) {
      const key = line.trim().split(/\s+/)[0] ?? '';
      const match = /^filter\.(.+)\.[^.]+$/.exec(key);
      if (match?.[1] !== undefined) drivers.add(match[1]);
    }
    const args: string[] = [];
    for (const driver of drivers) {
      args.push(
        '-c',
        `filter.${driver}.clean=`,
        '-c',
        `filter.${driver}.smudge=`,
        '-c',
        `filter.${driver}.process=`,
        '-c',
        `filter.${driver}.required=false`,
      );
    }
    return args;
  }

  /** 把执行器抛出的权限/基础设施失败折算成稳定的 Remote 错误。 */
  private runFailure(error: unknown, argv: readonly string[], actor: string): RemoteError {
    const command = boundedText(argv.join(' '), WORKTREE_LIMITS.diagnosticChars) ?? argv.join(' ');
    if (isSwarmError(error) && error.code === 'SWARM_FORBIDDEN') {
      // 执行器在会话消失时也报 SWARM_FORBIDDEN；归属失败与沙箱拒绝必须分开。
      if (error.details?.['reason'] === 'unknown-actor') return forbiddenError(actor);
      const detail =
        boundedText(error.message, WORKTREE_LIMITS.diagnosticChars) ?? 'the sandbox denied this command';
      const mode = typeof error.details?.['sandboxMode'] === 'string' ? error.details['sandboxMode'] : 'restricted';
      return new RemoteError(
        'swarm-worktrees/sandbox-denied',
        `the sandbox rejected this Git command under mode ${mode}; the Worktrees tab needs write access to the session repository (switch the permission mode or choose a writable workspace)`,
        { mode, command, detail },
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    return new RemoteError(
      'swarm-worktrees/git-failed',
      `could not run ${JSON.stringify(command)}: ${boundedText(detail, WORKTREE_LIMITS.diagnosticChars) ?? 'unknown error'}`,
      {
        command,
        exitCode: null,
        stderr: boundedText(detail, WORKTREE_LIMITS.diagnosticChars) ?? 'unknown error',
      },
    );
  }

  /** 非零退出的 Git 失败；stderr 有界保留，消息可直接展示。 */
  private gitFailure(argv: readonly string[], result: CommandResult): RemoteError<'swarm-worktrees/git-failed'> {
    const command = boundedText(argv.join(' '), WORKTREE_LIMITS.diagnosticChars) ?? argv.join(' ');
    const stderr = boundedText(result.stderr, WORKTREE_LIMITS.diagnosticChars) ?? '(no stderr)';
    const reason = result.timedOut
      ? `timed out after ${String(GIT_TIMEOUT_MS)} ms`
      : `exit ${result.exitCode === null ? 'unknown' : String(result.exitCode)}`;
    return new RemoteError(
      'swarm-worktrees/git-failed',
      `Git command failed (${reason}): ${command}: ${stderr}`,
      { command, exitCode: result.exitCode, stderr },
    );
  }

  /** 统一执行入口：只接受字面 argv，全部经 Host 执行器。 */
  private async run(argv: string[], cwd: string, actor: string): Promise<CommandResult> {
    try {
      return await this.executor.run({ argv, cwd, timeoutMs: GIT_TIMEOUT_MS, actorSessionId: actor });
    } catch (error) {
      throw this.runFailure(error, argv, actor);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Host Remote 服务                                                    */
/* ------------------------------------------------------------------ */

/** Host 侧 Worktree 服务；服务键与 Remote 命名空间均为 `swarmWorktrees`。 */
export class WorktreesService extends TypertRemoteService<never> {
  static inject = ['agents', 'workingDirectory', 'fs'];

  private readonly catalogue: WorktreeCatalogue;

  /**
   * @param ctx - Host 上下文，提供 `agents` / `workingDirectory` / `fs`。
   * @param executor - 已经接好 sandbox/subprocess 的命令执行器。
   * @param options - 测试注入的时钟。
   */
  constructor(ctx: Context, executor: CommandExecutor, options: { now?: () => number } = {}) {
    super(ctx, 'swarmWorktrees');
    this.catalogue = new WorktreeCatalogue({
      executor,
      sessionDirectory: (sessionId) => {
        const agent = ctx.agents.get(SessionId(sessionId));
        if (agent === undefined) return undefined;
        try {
          return ctx.workingDirectory.get(agent.session);
        } catch {
          return undefined;
        }
      },
      pathExists: async (path) => {
        try {
          return (await ctx.fs.lstat(path)) !== undefined;
        } catch {
          return false;
        }
      },
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  /** 会话仓库的全部已注册 worktree。 */
  list(sessionId: string): Promise<WorktreeSnapshot> {
    return this.catalogue.list(sessionId);
  }

  /** 新建分支与 checkout；不改变调用方 cwd。 */
  create(sessionId: string, request: WorktreeCreateRequest): Promise<WorktreeCreateResult> {
    return this.catalogue.create(sessionId, request);
  }
}

// 模块加载时安装标记（幂等）。SRC 方法名来自真实参数名，因此 list/create 必须保持
// 简单具名参数：list(sessionId)、create(sessionId, request)。
markRemoteMethod(WorktreesService.prototype, 'list');
markRemoteMethod(WorktreesService.prototype, 'create');

/** 构造后即可用的 Worktree 服务；调用方负责生命周期（无自有资源）。 */
export function registerWorktrees(
  ctx: Context,
  executor: CommandExecutor,
  options: { now?: () => number } = {},
): WorktreesService {
  return new WorktreesService(ctx, executor, options);
}

/** 供接线与测试核对：当前导出的 Remote 方法标记。 */
export function worktreeRemoteMethods(): readonly {
  readonly method: string;
  readonly mode?: 'stream';
}[] {
  const instance = Object.create(WorktreesService.prototype) as object;
  return remoteMethods(instance).map((marker) => ({
    method: marker.method,
    ...(marker.mode === undefined ? {} : { mode: marker.mode }),
  }));
}
