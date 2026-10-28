# workspace 层核验：worktree 初始化、Git 身份、CommandExecutor 与 sandbox/permission 适配

只读核验记录。基线：DSH `0.2.1-rc.4`，安装根
`/nix/store/an75q8mv8px3l5nqv13fcy6xwnwd0mys-dsh-0.2.1-rc.4/lib/node_modules/@deepseek-ai/dsh/`（下文简称 `$DSH`）。
核验时间：2026-10-28。本文只写被 Inspect 或安装包 declarations/source 直接证实的契约；推断都标了「推断」。
未修改任何 profile，未安装、未运行任何 Git 破坏性操作。

与 `notes/contracts.md` 的边界：那里只依赖标准库、把 `gitCommonDir` 留给 workspace 层；
本文就是这一层的契约。`RunSpec.baseRef`（spec 字段）经解析得到不可变 `baseCommit`，见 §4。

---

## 0. 结论摘要

1. **Inspect 的 Service 目录是静态超集，不是 liveness 证明。** 目录里同时列出本 profile 完全没安装的
   `ssh` 服务（`$DSH/node_modules/@deepseek-ai/` 下没有任何 ssh 包），也列出本 profile 没有挂载的
   `worktrees`。判定「真正可用」必须看三处：Loader 条目（`listConfigs`）、**agent preset 的 plugins 列表**
   （root 条目 `inactive` 只表示根条目被禁用，preset 会重新挂一份）、以及包 `exports` 里的 types 路径。
2. **`worktrees` 服务在本 profile 未挂载。** 没有任何 Loader 条目挂
   `@deepseek-ai/dsh-experimental-worktree`，`dsh-web-app/presets/{standard,minimal,ptc}.patch.yml`
   也都不含 worktree 包。要用它必须由 Swarm bundle 或 profile 显式挂载（§2.6）。
3. **`worktrees.create` 的 cwd 语义与 sandbox root 不一致，且这个不一致是好消息也是陷阱。**
   `create` 只是 `workingDirectory.set`（写一条 `working-directory/change`），
   `session.header.cwd` 永不改变；而 `sandboxPolicy.resolve()` 用的正是 **`session.header.cwd`**。
   所以 worker 必须在**源仓库根**创建 session，再被 `create` 移进自己的 worktree，
   否则 `workspace-write` 的 root 会是 worktree 本身，写 `<repo>/.git` 被拒（§3）。
4. **worktree 池永远在仓库内部**（`directory` 默认 `.agents/worktrees`，`relativePath()` 拒绝 `..`、
   绝对名和反斜杠），因此 `workspace-write` root = 仓库根时天然覆盖 worktree 与其共享 `.git`。
5. **hooks/filters 默认关闭是真实存在的实现，不是文档承诺**：`-c core.hooksPath=/dev/null`、
   `-c core.fsmonitor=false`、`GIT_ENV` 清空 15 个选择器、`reset --hard` 时用 `GIT_CONFIG_COUNT/KEY_n/VALUE_n`
   把 `filter.<d>.{clean,smudge,process,required}` 全部清零（§5）。我们自己的 Git 命令必须沿用同一套。
6. **原 `ctx.subprocess.spawn` 确实不带任何策略**（`SubprocessSpawnSpec` 只有 argv/cwd/stdio/graceMs/signal/env），
   但它**正是** DSH 自己生产 Git 路径的用法：`resolveExecutable` → `sandbox.confine` → `spawn`。
   推荐 CommandExecutor 走这条(**subprocess + sandbox + sandboxPolicy**)，理由见 §6.4；
   `ctx.shell` 只在需要模型可见 bash 语义时用，且它只能吃 shell 字符串（无 argv 入口）。
7. **worker 不能请求批准，也不能自我升级权限。** in-process 委派把子会话 `approval/policy` 固定成
   `'never'`，只把父 session 的**显式** sandbox override 种子进子会话；而且
   `ApprovalService.request` 要求请求时**有打开的 turn**。所以插件发起的长命令没有审批通道：
   必须预检 + 早失败，不能静默降级（§7）。
8. 两处文档/类型漂移：`dsh-shell` README 声称导出 `SHELL_SETTINGS_NAMESPACE`，构建产物未导出（§8）。

---

## 1. 可用性判据（怎么查「真正可用」）

### 1.1 三处证据

| 判据 | 命令/入口 | 说明 |
|---|---|---|
| Loader 条目 | `cordis_inspect_query(platform=host, provider=Config, method=listConfigs)` | 202 条；`include:*` 是根条目，`ba158af7` 等是 profile patch 插入项 |
| preset 组合 | `$DSH/node_modules/@deepseek-ai/dsh-web-app/presets/*.patch.yml` | 根条目 `inactive` 的包常在这里被逐 Agent 重新挂载（例：`tool-bash`、`tool-fs`、`tool-jobs`） |
| 包与类型 | `$DSH/node_modules/@deepseek-ai/<pkg>/{package.json,lib/types}` | `exports["."].types` 决定可 import 的 d.ts |

`cordis_inspect_query(Service, listService)` 的输出**只**用于拿签名与声明，不用于判断挂载。

### 1.2 本 profile 已挂载（与 workspace 层相关）

| 条目 id | 包 | 提供 |
|---|---|---|
| `include:sandbox` | `@deepseek-ai/dsh-sandbox-local` | `ctx.sandbox`（`SandboxProvider`） |
| `include:sandbox-policy` | `@deepseek-ai/dsh-sandbox-policy` | `ctx.sandboxPolicy`（`SandboxPolicyService`） |
| `include:bash-sandbox` | `@deepseek-ai/dsh-bash-sandbox` | `ctx.shell`（`SandboxBashExecutor`，confining） |
| `include:subprocess` | `@deepseek-ai/dsh-subprocess-local` | `ctx.subprocess`（`SubprocessRuntime`） |
| `include:approval` | `@deepseek-ai/dsh-user-approval` | `ctx.approval`（`ApprovalService`） |
| `include:permission` | `@deepseek-ai/dsh-permission-presets` | `ctx.permissionPresets`（`PermissionPresetService`） |
| `include:fs-sandbox` | `@deepseek-ai/dsh-fs-sandbox` | `ctx.fs`（会强制 file-effect 策略） |
| `include:working-directory` | `@deepseek-ai/dsh-working-directory` | `ctx.workingDirectory` |
| `include:jobs` | `@deepseek-ai/dsh-jobs-local` | `ctx.jobs`（`JobRegistry`） |
| `include:shell-env` | `@deepseek-ai/dsh-shell-env` | `ctx.shellEnv`（`DSH_*` 事实） |
| `include:subagent` + `-spawn-in-process` | `@deepseek-ai/dsh-subagent*` | `ctx.subagents`（`SubagentRuntime`） |
| `include:agent` + `include:agent-loop` | `@deepseek-ai/dsh-agent` / `dsh-agent-loop` | `ctx.agents` 注册表；loop 通过 `setFactory` 提供创建 |

`include:sandbox-policy` 的 Config schema 只有 `mode`（默认 `read-only`）与 `workspaceRoot`（默认
`process.cwd()`）；本 profile 的 patch 未覆盖它，**但** `include:permission` 的 patch 设了
`defaultPreset: danger-full-access`（`~/.dsh/profiles/web/cordis.patch.yml`），
而 `permission-presets` 会在每个 `session/created` 上按 `defaultPreset` 追加
`permission/preset` + `sandbox/mode` + `approval/policy`
（`dsh-permission-presets/lib/index.js` `pinInitialPermission`）。
⇒ 本机所有 session（含 worker 子会话）最终 `sandbox/mode=danger-full-access`、`approval/policy=never`。
**不要把本机现状当成契约**：插件必须在 `workspace-write` / `read-only` 下也能正确失败。

### 1.3 不可用作证据的例子

- `service=ssh`：目录里有签名，`$DSH/node_modules/@deepseek-ai/` 无对应包。
- `service=worktrees`：目录里有签名，Loader 树与 preset 都没有它。
- root 条目 `status: "inactive"`（如 `include:tool-jobs`）：不等于能力不存在，
  `presets/standard.patch.yml` 在 Agent scope 内挂的是同一包。

---

## 2. `worktrees.create` 精确契约

### 2.1 签名与值

```ts
// import type { WorktreeService, CreatedWorktree, CreateWorktreeRequest }
//   from '@deepseek-ai/dsh-experimental-worktree';
class WorktreeService extends Service {           // ctx.worktrees
  static inject = ['workingDirectory', 'fs', 'subprocess', 'sandbox', 'sandboxPolicy'];
  static Config = {
    directory: '.agents/worktrees',                // 相对仓库根
    namePrefix: 'worktree-',
    gitCommand: 'git',
    nodeCommand: 'node',
    timeoutMs: 60_000,                             // 单命令上限，<= MAX_TIMER_DELAY_MS
    graceMs: 3_000,
    maxOutputBytes: 65_536,
  };
  create(agent: Agent, request?: CreateWorktreeRequest, signal?: AbortSignal): Promise<CreatedWorktree>;
}

interface CreateWorktreeRequest { name?: string; from?: string; }   // 生成名 / 默认 HEAD
interface CreatedWorktree {
  path: string;          // fs provider 执行世界的规范化绝对路径
  branch: string;        // 新建分支名（= 相对 checkout 目录名）
  baseCommit: string;    // rev-parse --verify '<rev>^{commit}' 的结果
  repositoryRoot: string; // 源 checkout 的规范化根
}
```

要点（全部来自 `lib/index.js`）：

- `name` 同时是分支名和相对目录名，必须过 `relativePath()`（非空、无 `\`、无 `:`、每段非 `.`/`..`）
  且不能以 `-` 开头；不满足直接抛。
- 返回**不含** `gitCommonDir`。仓库身份要给 `Run.gitCommonDir` 得自己再跑一条命令（§4）。
- 失败时抛 `Error('Could not finish worktree <branch> at <path>. Any created checkout and branch are retained. …')`，
  **不会**回滚已建的分支/目录。→ 恢复必须「核对并复用」，不能看到目录就认为成功（架构 §5.3 已如此要求）。

### 2.2 内部命令序列（同一 `run()` 包装）

cwd = 调用者 `workingDirectory.ensure(agent)` 得到的目录，`policy = sandboxPolicy.resolve({session: agent.session})`：

1. `git check-ref-format refs/heads/<branch>`
2. `git rev-parse --show-toplevel` → `repositoryRoot`（经 `fs.resolve` + `fs.processPath`）
3. `git rev-parse --verify --end-of-options <rev>^{commit}` → `baseCommit`
4. `git show-ref --verify --quiet refs/heads/<branch>`（`[0,1]` 都允许）→ 存在则抛 `worktree branch already exists`
5. `fs.lstat(<pool>/<branch>)` 已存在则抛 `worktree path already exists`
6. `node --input-type=module -e <PREPARE_DIRECTORY> <poolPath> <path>`：`mkdir` 池根（首次创建时写
   `.gitignore` 内容 `*`，自忽略）+ `mkdir` 目标目录
7. `git --work-tree <repositoryRoot> worktree add --no-checkout -b <branch> -- <path> <baseCommit>`
8. `git config --null --name-only --get-regexp '^filter\.'` → 收集 driver 名
9. `git --work-tree <path> reset --hard --no-recurse-submodules <baseCommit>`，带
   `GIT_CONFIG_COUNT/KEY_n/VALUE_n` 把每个 driver 的 `clean/smudge/process` 置空、`required` 置 `false`
10. `workingDirectory.set(agent, path, signal)` → 返回的规范化路径即 `CreatedWorktree.path`

注意 6：池目录里那次 `mkdir` 由 **`node`** 子进程完成（`nodeCommand` 配置），
所以执行世界里的 `node` 必须可解析，否则初始化在「目录分配」阶段就失败。

### 2.3 「切换 cwd」的确切含义

`workingDirectory` 有两层状态，别混：

| 事实 | 来源 | 会不会被 `create` 改 |
|---|---|---|
| 原始项目目录 | `session.header.cwd`（SessionHeader，不可变） | **不会** |
| 当前有效目录 | `workingDirectory.get(session)` = 最后一条 `working-directory/change`，否则 header.cwd | 会 |
| sandbox `workspaceRoot` | `sandboxPolicy.resolve()` = `resolveWorkspaceRoot(session.header.cwd ?? config.workspaceRoot)` | **不会** |
| 命令 cwd | 显式传入；`tools`/`fs` 默认用 effective cwd | 会 |

`working-directory/change` 会以 model-visible notice（`MessageSourceMap['working-directory']`）提交，
所以初始化期间连跳三次（仓库 → 集成树 → 仓库 → 私有树）会在这名 worker 的第一条请求前留下 2–3 条
目录变更提示。属噪声，不是错误；但初始化顺序要一次算好，别反复横跳。

### 2.4 初始 agent cwd 与两棵树

**worker 树（必须）**：worker 的 `session.header.cwd` 必须是 `Run.repositoryRoot`，
然后由该 worker 自己 `create` 得到私有树。理由见 §3；顺序是
`spawn(cwd=repositoryRoot)` → 在 `agent/created` 里 `create`。

**集成树（需要决策）**：`create` 必须有一个 Agent，且会用掉它的 cwd。三种做法：

| 方案 | 精确做法 | 代价 / 约束 |
|---|---|---|
| A 架构原方案（§5.3-5） | 第一个 worker 初始化时：`create(worker,'…-build')` → `workingDirectory.set(worker, repositoryRoot)` → `create(worker,'…-w1')` | 不需要额外 Agent；但 worker 日志多 3 条 cwd notice（build → 仓库 → 私有树）；任何一步失败要能「核对并复用」 |
| B 专用 housekeeping Agent | `ctx.agents.create({ sessionId, parentAgent: owner, meta: { cwd: repositoryRoot }, setup })`，对它 `create('…-build')`，用完 `handle.dispose()` | 不污染 worker 日志；但会多一个**空 transcript 的可见 Session**（GUI 会话列表可见），且 `dispose()` 会移除该 session |
| C 自己用 CommandExecutor 跑 `git worktree add` | 复用 §5 的 argv/env 纪律 + §6 的执行器 | 不需要 Agent；但要自己实现池目录分配、`check-ref-format`、重复分支/目录拒绝、`.gitignore` —— 即复刻第 2.2 节的 9 步，风险最高 |

建议：先用 A（与架构一致、零额外 Session），把 B 记成备选。C 只在明确不想依赖 worktree 服务时考虑。
**无论哪个方案，都不要对 owner Agent 调 `create`**（会切走用户工作区）。

worker 侧的调用骨架（真实签名）：

```ts
// 1) 先付代价最小的仓库解析
const cwd = await ctx.workingDirectory.ensure(ownerAgent, signal);   // 或已知的 Run.repositoryRoot
// 2) spawn worker（首轮 caller delivery）
const activation = await ctx.subagents.startActivation({
  provider: 'spawn',
  label: `swarm ${runId} worker ${i}`,
  childId,                                   // 预留的 SessionId（有 childId 的重载会返回 messageId）
  request: {
    parent: ownerAgent,
    cwd: run.repositoryRoot,                 // 绝对路径；决定 header.cwd 与 sandbox root
    agentPreset: 'swarm-worker',
    prompt: initialBlocks,                   // 首次模型请求前由 agent/created 拦下做初始化
    agentOptions: { provider, model, reasoningEffort },   // 省略 = 继承 owner
  },
  signal,
  delivery: 'caller',
});
// 3) 在 agent/created（serial、被 await）里 create 工作树；监听器按 sessionId 过滤
```

`agent/created` 的契约：`@deepseek-ai/dsh-agent` 的 `Events['agent/created']`，
payload `{ agent, source, signal? }`，`@mode serial`，监听器抛错会让创建失败并跳过后续监听器；
**监听器内不能 `await agent.whenIdle()`**。

`startActivation` 相关限制（`SubagentRuntime`）：
`request` 是 `Omit<SubagentStartRequest,'label'|'signal'>`，必须给 `parent`、`prompt`；
`spec.signal` 只管「未发布阶段」，发布后的停止要走 `activation.dispose()` / `subagents.interrupt(...)`；
`maxDepth` 需 provider 声明 `capabilities.depthLimit`。

---

## 3. sandbox root = `session.header.cwd`：为什么顺序不能反

`SandboxPolicyService.resolve()`（`dsh-sandbox-policy/lib/index.js`）：

```js
resolve(request = {}) {
  const { session } = request;
  return {
    mode: request.mode ?? (session && this.overrideOf(session)) ?? this.defaultMode,
    workspaceRoot: resolveWorkspaceRoot(session?.header.cwd ?? this.workspaceRoot),
    ...(session === void 0 ? {} : { sessionId: session.id }),
  };
}
```

`overrideOf(session)` 读 `sessionProjections.stateOf(session,'sandboxMode')`，即最后一条 `sandbox/mode`。

于是同一台机器上：

| worker session 创建时 cwd | `workspace-write` 的可写 root | 能 `git commit` 吗 |
|---|---|---|
| `repositoryRoot`，之后 create 移进 `.agents/worktrees/<b>` | `repositoryRoot`（覆盖池 + 共享 `.git`） | 能 |
| 直接 `worktreePath` | `worktreePath` | **不能**：`<repo>/.git/worktrees/<b>/` 与 `<repo>/.git/objects` 在 root 外 |
| `repositoryRoot`，但仓库用 `--separate-git-dir` / `.git` 指到别处 | `repositoryRoot` | **不能**：gitCommonDir 在 root 外 |

推论（写进实现约束）：

- 不要为了「更隔离」把 worker 的 cwd 设成 worktree；那会破坏 commit，而不是增强隔离。
- `read-only` 下 `writableRoots(policy)` 为 `[]`：worker 无法提交，run 无法进行 → 启动即失败并给诊断（§7.3）。
- `workspace-write` 的 root 是整个源仓库，worker 仍可用 bash 写仓库里别的路径。
  **worktree 是文件隔离约定，不是 DSH sandbox 边界**（架构 §1.3 已如此声明），
  验收要靠候选 diff 检查，不能靠 sandbox 保证。

---

## 4. Git 身份识别（`Run.repositoryRoot` / `Run.gitCommonDir`）

`worktrees.create` 只给 `repositoryRoot`。身份判定要自己跑命令，建议实现为
`resolveGitIdentity(exec, cwd, signal)`：

```ts
const root = await run(['git','rev-parse','--show-toplevel'], cwd);
const common = await run(['git','rev-parse','--path-format=absolute','--git-common-dir'], cwd);
const gitDir = await run(['git','rev-parse','--path-format=absolute','--git-dir'], cwd);
```

- **身份键用 `--git-common-dir`**，不是 toplevel、不是分支、不是 worktree 路径：同一仓库的所有 worktree
  共享它（架构 §4.2 的 `gitCommonDir`）。
- `--path-format=absolute` 需要 Git ≥ 2.31；若目标环境更旧，退化为
  `path.resolve(cwd, stdout.trim())`，并显式记录这条降级（不要静默）。
- 输出要经 `ctx.fs.resolve(path, {cwd, signal})` + `ctx.fs.processPath(target)` 规范化后再比较，
  否则 symlink/`..` 会造出两个「不同」的仓库。
- 同一仓库并发非终态 run 的判据：`canonical(gitCommonDir)` 相等（paused 也占名额）。
- 不要用 `rev-parse --show-toplevel` 当唯一身份：它随 worktree 而变，`create` 之后同一个 worker
  的 toplevel 就是它自己的 worktree。
- `baseCommit` 用 `rev-parse --verify --end-of-options '<ref>^{commit}'`；**只解析本地对象**
  （包装里设了 `GIT_NO_LAZY_FETCH=1`、`GIT_TERMINAL_PROMPT=0`），远程 SHA 解析不到就是失败，不要去 fetch。

---

## 5. 「默认不得隐式执行 repo hooks/filters」

`dsh-experimental-worktree/lib/index.js` 的实际做法，逐条列出（全部只对本次调用生效，**不改 Git config**）：

| 机制 | 精确写法 | 作用 |
|---|---|---|
| hooks | 每条 git argv 前缀 `-c core.hooksPath=/dev/null` | 禁 `pre-commit`/`commit-msg`/`post-merge`/`post-checkout` 等 |
| fsmonitor | `-c core.fsmonitor=false` | 禁 fsmonitor 钩子进程 |
| 环境选择器 | `GIT_ENV`：把 `GIT_DIR`/`GIT_WORK_TREE`/`GIT_COMMON_DIR`/`GIT_INDEX_FILE`/`GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES`/`GIT_CONFIG`/`GIT_CONFIG_PARAMETERS`/`GIT_CONFIG_COUNT`/`GIT_CEILING_DIRECTORIES`/`GIT_PREFIX`/`GIT_SHALLOW_FILE`/`GIT_GRAFT_FILE`/`GIT_REPLACE_REF_BASE`/`GIT_ATTR_SOURCE` 设为 `undefined` | 清掉继承来的仓库/属性/命令行配置选择器 |
| 网络/LFS | `GIT_TERMINAL_PROMPT='0'`、`GIT_LFS_SKIP_SMUDGE='1'`、`GIT_NO_LAZY_FETCH='1'` | 不交互、不拉 LFS、不 lazy fetch |
| filters | `reset --hard` 时 `GIT_CONFIG_COUNT=<drivers*4>` + `GIT_CONFIG_KEY_n=filter.<d>.<attr>` + `GIT_CONFIG_VALUE_n`（`clean/smudge/process` → `''`，`required` → `'false'`） | 关 clean/smudge/process filter |
| 预扫描 | `git config --null --name-only --get-regexp '^filter\.'` `[0,1]` | 只清仓库里真实声明过的 driver |

我们对**自己的** Git 命令（`merge`、`commit`、`diff`、`rev-parse`、`update-ref`、`cherry-pick`）必须沿用：

```ts
const GIT_ARGV_PREFIX = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'] as const;
const GIT_ENV = { /* 上表 15 个键全部 undefined */, GIT_TERMINAL_PROMPT: '0',
                  GIT_LFS_SKIP_SMUDGE: '1', GIT_NO_LAZY_FETCH: '1' } as const;
```

两个易错点：
- `GIT_CONFIG_COUNT` 是整体替换计数，不能与 `-c` 混用同一机制去「追加」；
  `-c` 与 `GIT_CONFIG_*` 同时出现时只有 `GIT_CONFIG_*` 那批会生效于该环境，别指望叠加。
- `filter.required=false` 必须一起清，否则缺 driver 时 Git 直接失败。

`git merge`/`git commit` 不写 `core.hooksPath` 到仓库配置，只在本次 argv 里 `-c`；
这样不会污染用户的 `.git/config`（架构 §4「不自动改用户工作区」）。

---

## 6. CommandExecutor port

### 6.1 port 形状（建议）

```ts
// src/exec/port.ts —— 只依赖标准库 + 下面列的 DSH 类型
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';

export interface CommandRequest {
  readonly argv: readonly [string, ...string[]];   // 无 shell，直接 exec
  readonly cwd: string;                              // 执行世界绝对路径
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdoutMaxBytes?: number;
  readonly allowedExitCodes?: readonly number[];     // 默认 [0]
  readonly signal?: AbortSignal;
}

export type CommandResult =
  | { kind: 'exited';  exitCode: number; stdout: string; stderr: string }
  | { kind: 'cancelled'; cause: 'timeout' | 'abort' | 'stop' }          // 已静止
  | { kind: 'denied'; mode: SandboxMode; exitCode: number; stdout: string; stderr: string }
  | { kind: 'sandbox-unavailable'; mode: SandboxMode; detail: string }   // runner 坏 / 无 runner
  | { kind: 'spawn-failed'; detail: string };

export interface CommandHandle {
  readonly done: Promise<CommandResult>;   // 永不 reject
  terminate(): Promise<void>;              // 请求取消并等真实静止
}

export interface CommandExecutor {
  run(request: CommandRequest): CommandHandle;   // 同步返回句柄，便于 stop 抢在 await 前
}
```

对齐要求：`done` 永不 reject（失败进判别 union）、`terminate()` 幂等且 await 静止、
`kind:'denied'` 与 `kind:'exited'` 严格区分（denial 不是测试失败）、
`kind:'sandbox-unavailable'` 属基础设施失败（不能算候选不通过）。

### 6.2 推荐实现：`ctx.subprocess` + `ctx.sandbox.confine`（复刻 DSH 自己的 Git 路径）

```ts
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';
import {
  SandboxUnavailableError, classifyRunnerFailure, isRunnerSpawnFailure, matchesSignature,
} from '@deepseek-ai/dsh-sandbox';
import type { ConfinedArgv, SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess';
```

执行序列（与 `dsh-experimental-worktree` 的 `runCommand` 一一对应）：

1. `using d = deadline(req.signal, req.timeoutMs, 'SWARM_CMD_TIMEOUT'); d.signal.throwIfAborted();`
   （`deadline(upstream, ms, code)` 融合取消与超时；`ms<=0` 表示不设时器）
2. `const argv = [await ctx.subprocess.resolveExecutable(req.argv[0], req.env, d.signal), ...req.argv.slice(1)]`
   （裸名走 provider 的**已脱敏** PATH，`SENSITIVE_ENV_PATTERN` + 全部 `DSH_*` 已被剔除；
   显式 `req.env` 在脱敏之后合并，所以能覆盖）
3. `const policy = ctx.sandboxPolicy.resolve({ session })`（**由调用方按 run/worker 解析一次并传入**，不要在这里猜 session）
4. `const confined: ConfinedArgv | undefined = policy.mode === 'danger-full-access'
     ? undefined
     : await ctx.sandbox.confine(argv, { ...policy, mode: policy.mode }, d.signal);`
   （`confine` 的 `policy` 参数类型是 `SandboxPolicy`，`mode` 必须是 `ConfinedSandboxMode`；
   `policy` 变量本身仍是 `SandboxExecutionPolicy`，所以要用 `{ ...policy, mode: policy.mode }` 重建对象让
   `mode` 收窄——`worktrees` 的实现就是这么写的。`danger-full-access` 永远不进 provider。）
5. `const child = ctx.subprocess.spawn({ argv: (confined?.argv ?? argv), cwd, env: {...GIT_ENV, ...req.env},
     signal: d.signal, graceMs, stdio: { stdin: 'ignore',
       stdout: { maxBytes, spill: { maxBytes: spill } }, stderr: { maxBytes, spill: { maxBytes: spill } } } })`
6. `const outcome = await child.done;` → `{ exitCode: number|null, signal: NodeJS.Signals|null }`
   `const out = child.collected.stdout!.readFrom(0); const err = child.collected.stderr!.readFrom(0);`
   （`SubprocessOutputRead = { text, nextOffset, lossy, spillPath? }`，offset 读，多个读者互不消费）
7. 分类，按顺序：`timeoutOf(d.signal, 'SWARM_CMD_TIMEOUT')` 命中 → `cancelled/{cause:'timeout'}`；
   否则 `d.signal.aborted` → `cancelled/{cause:'abort'}`；
   `classifyRunnerFailure(exitCode, err.text, confined.runnerFailureRules)` 命中 → `sandbox-unavailable`；
   `matchesSignature(exitCode, err.text, confined.denialSignatures)` 命中 → `denied`；
   `allowedExitCodes.includes(exitCode)` → `exited`。**runner failure 优先于 denial**（命令根本没跑）。
   `timeoutOf(x, code)` 的 `code` 用来区分嵌套 deadline：外来 code 走普通取消路径。
8. `finally { child.terminate(); await child.waitForExit(); }` —— 这是「取消后真实静止」。

`spawn` 的失败面：`SubprocessHandle.done` **可能 reject**（provider 失败），
所以包装里要 `try/catch` 把它变成 `spawn-failed`，并用
`isRunnerSpawnFailure(error, confined.argv[0], cwd)` 区分「runner 坏了」与「普通 spawn 失败」。
`child.collected.stdout/stderr` 在类型上是 optional（collect 模式由 provider 保证存在），取用前判空。
`SandboxUnavailableError` 本身不必复用（它是 `bash-sandbox` 执行器的抛出物）；
port 用 `kind:'sandbox-unavailable'` 表达同一事实，但 detail 里保留 `SANDBOX_UNAVAILABLE` 字样，
便于与宿主既有诊断词表对齐。

### 6.3 对照：复用 `ctx.shell`

```ts
// ctx.shell 是 ShellExecutor；本 profile 的实现是 SandboxBashExecutor
const ex = await ctx.shell.execute(ctx.shell.resolve({
  command,                       // ← 只有字符串
  workdir: cwd,
  timeoutMs,
  onExpiry: 'kill',
  stdoutMaxBytes,
  env, signal,
  sandboxPolicy: policy,         // 省略时 resolve() 回落 ctx.sandboxPolicy.resolve()（部署默认，不是本 session）
}));
const r = await ex.result();     // ShellRunResult
```

`ShellRunResult` = `{ exitCode|null, signal, timedOut, aborted, timeoutMs,
stdout: {text,truncated,spillPath?}, stderr: 同, sandbox?: {mode, denied, enforcement?, runnerFailed?} }`；
句柄 `ShellProcess` = `{ status, exitCode, signal, done, readOutput(), observed/stdout/stderr, kill() }`。

### 6.4 选哪一个：推荐 subprocess + sandbox

| 维度 | `ctx.shell`（bash-sandbox） | `ctx.subprocess` + `ctx.sandbox.confine` |
|---|---|---|
| 入参 | **shell 字符串**，`ShellExecRequest` 无 argv | **argv**，与 port 完全同形 |
| argv 精确性 | 需自己实现 POSIX 单引号转义；换 pwsh 平台实现要另一套 | 无转义层，`--`、空格路径、`--end-of-options` 都安全 |
| hooks/filters/env 纪律 | `ENV_OVERRIDES`（`NO_COLOR/TERM=dumb/PAGER/GIT_PAGER`）会注入；我们还要塞 `GIT_ENV` 与 `-c` | 完全自控 |
| denial / runner 事实 | **免费**：`result.sandbox.denied` / `runnerFailed`，已按后端 dialect 分类 | 自己做，但可复用导出的 `classifyRunnerFailure`/`matchesSignature`/`isRunnerSpawnFailure`（各 5–10 行） |
| 超时/取消分类 | `timedOut`/`aborted`（first-cause，互斥） | 用 `dsh-timeout` 的 `deadline` + `timeoutOf`，语义相同 |
| 静止 | `kill()` + `done` | `terminate()` + `waitForExit()` |
| 依赖面 | 需要恰好一个 `ctx.shell` provider（`permissionPresets` 也软依赖它） | 需要 `ctx.subprocess` + `ctx.sandbox` + `ctx.sandboxPolicy` |
| 与 DSH 自身一致性 | 与模型 `bash` 工具一致 | 与 `dsh-experimental-worktree`（DSH 唯一的生产 Git 路径）一致 |
| 额外能力 | 输出 cap/spill 策略、`observed` 非消费读者 | 同（同一 subprocess 后端），另可 `spawnTerminal` |

**推荐 B（subprocess + sandbox）**，四条理由：

1. port 契约就是 argv，A 需要一层转义，是纯新增风险面（路径含 `'`、glob、`~`、Windows）。
2. 我们需要 Git 专有的 env/`-c` 纪律；A 会先注入 `ENV_OVERRIDES` 再叠我们的 env，语义叠层更多。
3. B 与 DSH 自己的 `worktrees.create` 走**同一组 seam**，行为一致性可以用同一套测试断言。
4. B 不要求 `ctx.shell` 存在，减少一个「profile 没挂 bash 执行器」的失败模式。

A 的合理场景只有一个：以后要把插件命令的**结果渲染成模型可见的 bash 卡**（`parseExitStatus` 标记、
denial/escalation 提示语）。当前设计里 Git/test 结果进的是 Swarm domain + 工具结果，不需要这层。

### 6.5 长测试与 `ctx.jobs`

- `JobRegistry.start` 在**没有 controller 服务该 owner** 时拒绝启动：
  `servesOwner(owner)` 要求「全局层有 controller」或「owner 的 scope 链上有 controller」。
- 唯一随包调用者是 `dsh-tool-jobs`（`ctx.jobs.attachController('tool-jobs')`），
  它在 `presets/standard.patch.yml` 里挂到每个标准 Agent scope ⇒ 标准 worker 的 owner 可被服务。
- 若 Swarm 自己的 housekeeping Agent 不带该 preset，则为它 `start` 会被拒；
  此时可 `ctx.jobs.attachController('swarm')`（返回 disposer，随 fiber 释放）。
- 结论：第一版集成/测试命令用 CommandExecutor 前台跑 + 自己的 cancel 门禁更简单；
  需要「超时后继续跑」时再接 jobs（架构 §9 的 jobs 行同理）。

---

## 7. permission / approval 适配（可实施细节）

### 7.1 三个硬事实

1. `ApprovalService.request(req)`：**要求有打开的 turn**——「an idle ask rejects before appending anything」；
   `agent` 必填，`callId?: ToolCallId`（无 callId 可省），`signal` 可撤单。
2. in-process 委派的策略种子（`dsh-subagent/lib/index.js` `captureDelegatedPolicyOverrides`）：
   - `sandbox/mode` ← **只**父 session 的**显式** override（`sandboxPolicy.overrideOf(parent.session)`），
     不种部署默认、不种一次性 grant；
   - `approval/policy` ← **恒为 `'never'`**（父是 `ask` 也一样）；
   - `permission/preset` ← 仅当父预设是 `auto` 或 `danger-full-access`。
3. 每个 `session/created` 上 `permission-presets` 按 `defaultPreset` 追加
   `permission/preset` + `sandbox/mode` + `approval/policy`。

⇒ **worker 永远无法弹出审批**；即便在打开的 turn 里，`'never'` 也会把 ask 直接判 `rejected`。
插件的后台 Git/test 更没有 open turn。所以不存在「从插件内部升级权限」的合法路径。

### 7.2 不要做的事

- 不要在 worker 或集成路径里调 `ctx.approval.request` / `approveEscalation` 试图放宽（会 `rejected` 或抛）。
- 不要用 `ctx.permissionPresets.set(session, name)` 静默改用户策略：它写
  `permission/preset`/`sandbox/mode`/`approval/policy` 三条**用户可见**事件，
  等于替用户改安全设置。只有用户在自己的启动输入里要求时才允许。
- 不要 catch 掉 `SandboxUnavailableError` 后当普通失败继续（那是「命令没跑」）。

### 7.3 可行做法：解析 → 预检 → 早失败 / 正常执行

```ts
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';

function assertWritableInside(policy: SandboxExecutionPolicy, needs: readonly string[]): void {
  if (policy.mode === 'danger-full-access') return;
  const roots = writableRoots(policy);          // read-only → []
  const outside = needs.map(canonicalPath).filter(p => !roots.some(r => p === r || p.startsWith(r + '/')));
  if (outside.length > 0) throw /* SWARM_FORBIDDEN / 新增 SANDBOX_INSUFFICIENT */;
}
// needs = [ worktreePoolDir, gitCommonDir, /* test 需要的 HOME 缓存见 7.4 */ ]
// 注意：上面只是同形预检。前缀比较要用规范化后的路径，且两侧都带尾分隔符处理
// （`/a/bc` 不能算在 `/a/b` 内）；对 FsTarget 之间也可以直接用 `ctx.fs.contains(parent, child)`。
```

诊断里必须给出可操作信息：当前 `mode`、`workspaceRoot`、被拒的绝对路径、以及
「切换到可用 preset 或用 spec 中的 `sandbox` 覆盖」的具体建议。对应架构 §9「若权限不允许，暂停并报告」。

`writableRoots(policy)` 的语义（`dsh-sandbox/roots`）：`read-only` → `[]`；`workspace-write` → `workspaceRoot`
+ 主机 `/tmp` + `os.tmpdir()`，全部**规范化**（symlink 解析）。所以比较必须用 `canonicalPath`。

`approveEscalation(request, approval)` 的正确使用面（`dsh-sandbox/escalation`）：
`{ approver, agent, callId, toolName, signal }`，`request = { requestedMode, justification, effectiveMode, subject }`；
只在**工具执行中**（有 open turn、有真实 `ToolCallId`）才有意义。
`WIDER_MODES`/`ESCALATION_TARGETS`/`validateEscalationArgs`/`sandboxDenialMarker`/`escalationHintMarker`
可复用来渲染诊断文案，但 Swarm 的 Git/test 路径不该调用 `approveEscalation`。

### 7.4 实际会踩的两类拒绝

1. **cwd 之外的 Git 目录**：`--separate-git-dir`、`.git` 为文件指向别处、submodule。
   预检 `gitCommonDir ⊂ writableRoots` 即可提前发现（§3、§4）。
2. **工具链缓存写 `$HOME`**：`workspace-write` 只额外放行平台 temp，**不放行** `~/.cache`、`~/.local/share/pnpm`、
   `~/.npm`、`~/.cargo`。`pnpm install`/`pnpm test`（带 store 写入）、`npm`、`cargo`、`go` 在
   `workspace-write` 下会失败。可实施缓解：在 `CommandRequest.env` 里把
   `PNPM_HOME`/`npm_config_cache`/`XDG_CACHE_HOME`/`CARGO_HOME`/`GOCACHE` 指到 worktree 内目录；
   高速缓存不可写就明确报告，不要静默换 `danger-full-access`。

### 7.5 `ctx.fs` 写入同样要显式策略

`dsh-fs-sandbox` 的 `writeText/editText` 第 5/6 参是 `sandboxPolicy?`，省略时
`policy = ctx.sandboxPolicy.resolve()`——**部署默认 + 部署 fallback root**，不是本 session 的 cwd。
所以插件写运行记录/报告文件（若写进仓库内）必须传
`sandboxPolicy.resolve({ session })`；否则可能写到错的 root 或被拒。
读路径 (`readText`/`listDir`/`stat`) 不接收策略。

---

## 8. 文档/类型漂移（按 AGENTS §3 报告，不擅自改）

1. `@deepseek-ai/dsh-shell` README（英/中）称 `SHELL_SETTINGS_NAMESPACE` 由该包导出，
   `lib/types/index.d.ts` 未导出（只有 `DSH_ENV_PREFIX`、`parseExitStatus` 与类型）。
   实现时不要 import 它。
2. `dsh-experimental-worktree` 的 JSDoc 写「Checkout disables configured clean, smudge, and process filters」，
   但实现里 `filter.<d>.required` 也被置 `false`（`required` 不在 clean/smudge/process 之列）。
   文档少列一项，实现更严格；以实现为准。
3. Inspect `Service` 目录会把未安装包的服务（`ssh`）一起列出。任何「某 service 可用」的结论都要
   用 §1.1 的三处证据复核。

---

## 9. 风险清单（需 Lead 决策或写进 IMPLEMENTATION.md）

| # | 风险 | 影响 | 建议 |
|---|---|---|---|
| 1 | 初次调研时 `worktrees` 未挂载；当前 profile 已提供 | 缺失会等待依赖；重复 provider 会报 `service "worktrees" has been registered` | 正式 bundle 复用 profile 已有的 provider（当前通过 `@deepseek-ai/dsh-experimental-tool-worktree` 提供），安装前检查依赖，不假设所有 Web profile 默认启用。独立 headless overlay 仍自行提供。见 [安装与验收记录](<../IMPLEMENTATION.md>)。 |
| 2 | 集成树由谁创建（§2.4 A/B/C） | 影响是否需要额外可见 Session | 先按 A；B 备选；C 只在放弃 worktree 服务时 |
| 3 | `workspace-write` root = **源仓库**，不是 worktree | 隔离是约定而非边界；worker 能写仓库其它路径 | 验收用候选 diff；架构已有声明，勿在实现里宣称更强保证 |
| 4 | 工具链缓存写 `$HOME` 被拒 | `pnpm test` 等可能在 `workspace-write` 下失败 | env 指到 worktree 内；失败即报告（§7.4） |
| 5 | `nodeCommand`/`gitCommand` 必须在**脱敏 PATH** 里可解析 | 初始化在 `mkdir` 阶段就失败 | 启动时 `resolveExecutable('git'|'node')` 预检，失败早报 |
| 6 | 初始化期 `working-directory/change` notice 进模型历史 | 方案 A 会在首请求前留下 3 条目录提示 | 一次算好顺序；或改用方案 B |
| 7 | worker preset 若含 `tool-worktree` | worker 可能再建树并切走自己的 cwd，破坏插件假设 | `swarm-worker` preset 不挂 worktree 工具；或用 `ctx.tools.restrict` |
| 8 | `danger-full-access` 是本机默认 | 本机验证会掩盖 `workspace-write` 下的失败 | 测试矩阵必须包含 `read-only`/`workspace-write` 的单元级断言 |
| 9 | 本 run 的子会话 `approval/policy='never'` | 任何「让 worker 自己申请权限」的设计都不可行 | 一律插件预检 + 早失败 |
| 10 | `Git ≥ 2.31`（`--path-format=absolute`） | 旧 Git 上身份解析出错 | 降级路径 + 显式日志 |

---

## 10. 可复现核验命令（只读）

```sh
DSH=/nix/store/an75q8mv8px3l5nqv13fcy6xwnwd0mys-dsh-0.2.1-rc.4/lib/node_modules/@deepseek-ai/dsh

# 1. 是否存在某个包 / 服务实现
ls "$DSH/node_modules/@deepseek-ai/" | grep -E 'worktree|sandbox|subprocess|shell|approval|permission'

# 2. worktree 服务契约与实现
sed -n '1,80p' "$DSH/node_modules/@deepseek-ai/dsh-experimental-worktree/lib/types/index.d.ts"
sed -n '120,400p' "$DSH/node_modules/@deepseek-ai/dsh-experimental-worktree/lib/index.js"

# 3. sandbox root 的真实来源
grep -n "resolve(request = {})" -A12 "$DSH/node_modules/@deepseek-ai/dsh-sandbox-policy/lib/index.js"

# 4. 委派时的策略种子（approval 恒 never）
grep -n "captureDelegatedPolicyOverrides" -A22 "$DSH/node_modules/@deepseek-ai/dsh-subagent/lib/index.js"

# 5. 每个 session 创建时按 defaultPreset pin
grep -n "pinInitialPermission(session) {" -A20 "$DSH/node_modules/@deepseek-ai/dsh-permission-presets/lib/index.js"

# 6. shell 执行器是否 confining（本 profile = bash-sandbox）
grep -n "static inject" -A5 "$DSH/node_modules/@deepseek-ai/dsh-bash-sandbox/lib/index.js"

# 7. preset 里到底挂了哪些工具/服务
grep -n "preset-standard" -A60 "$DSH/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml"
grep -rn "worktree" "$DSH/node_modules/@deepseek-ai/dsh-web-app/presets/"

# 8. jobs 的 controller admission
grep -n "servesOwner(owner)" -A6 "$DSH/node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js"
```

Inspect 侧：`cordis_inspect_query(host, Service, listService)` 取签名；
`cordis_inspect_query(host, Config, listConfigs)` 取 Loader 条目（判挂载）。
