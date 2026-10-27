# DSH Swarm 使用说明

单机、对等 worker、独立 worktree、验证后集成到一个结果分支。架构见 [ARCHITECTURE.md](</home/atlas/Github/4t145/dsh-swarm/ARCHITECTURE.md>)，开发规则见 [AGENTS.md](</home/atlas/Github/4t145/dsh-swarm/AGENTS.md>)。

## 环境与当前安装

- 目标：DSH **0.2.1-rc.4**、Node **24.9+**、Linux、较新的 Git（建议 **2.46+**）。其他 DSH 版本或操作系统未验证。
- 当前 `web` profile 已安装并启用 `@local/dsh-swarm`，提供 `/swarm` 命令及 `swarm-worker` preset。**当前 DSH 进程仍缓存旧 JavaScript；首次使用最终构建前请重启 DSH，不只是刷新网页。** 最后的原生检查已明确检测到这个版本差异。
- 是 Host 插件＋命令界面，没有额外网页或自定义 Swarm 看板；无需启动新 Web 服务器。
- 原生 worker 继承启动者的模型和权限。只支持本地 spawn，不支持 Codex/Claude Code 外部 worker。
- worker 的审批策略是 `never`，不能在子会话内申请扩大权限。只读模式会拒绝启动；其他权限不足会明确失败，不自动改成 full access。
- worktree 不是安全沙箱。当前 profile 的全局 MCP 工具仍可能被 worker 继承；Swarm 不提供针对恶意 worker 的文件或网络隔离保证。

## 启动一次任务

1. 准备一个有本地提交的 Git 仓库。默认要求干净工作区；插件不替你 stash、commit 或覆盖未提交修改。
2. 复制并编辑 [配置示例](</home/atlas/Github/4t145/dsh-swarm/examples/swarm-run.json>)，明确仓库路径、目标、逐项验收、worker 数量、时间和真实验证命令。
3. 在需要作为 owner 的普通 DSH 会话中，输入：

```text
/swarm start --spec /absolute/path/to/swarm-run.json
/swarm status
/swarm status --details
```

`--spec` 路径相对 owner 的当前 cwd 解析；JSON 内 `repository` 相对 spec 所在目录解析。`baseRef` 在启动时固定为一次 SHA，后续 HEAD 变化不改变这次基线。所有示例顶层字段都必须提供；workers 为 2–4，budgetMinutes 为正整数，setup 可以为空数组，test 必须非空。

`allowDirtyBaseline: true` 只表示明确接受“未提交内容不进入 worker”；不复制这些修改。命令是 argv 数组，不经 shell 拼接。setup/test 在集成工作区运行，验证前不假定已安装依赖。需要 `$HOME` 外部缓存、网络或额外系统依赖的命令可能被当前 sandbox 拒绝，应调整项目配置或由用户选择适当权限，不让 worker 绕过策略。

## 工作与交付

worker 自主创建/认领任务、交换短发现和定向消息。知识条目为 `observed`、`fact`、`fail`、`patch_summary`；更正追加而不改历史。模型看到的工具结果与输入由原生 Session 日志记录。

代码先进入 worker 私有提交，再在专用集成工作区串行合并并执行 setup/test。只有通过验证的组合提交才推进 result 分支。局部检查通过不代表集成通过；失败候选会交回作者修复。用户原工作区的 tracked 文件、index、当前分支与 cwd 不被插件切换。

`/swarm status --details` 查看当前结果 SHA、实际 ref 与记录是否一致、worker/任务状态及验证诊断。命令输出有界；完整改动可以在仓库中查看：

```sh
git diff <baseCommit> <acceptedHead>
git show <acceptedHead>
```

结果分支形如 `swarm-<run-id>-result`。由用户决定是否合入自己的分支；插件不自动更新主分支。只有 `completed` 表示整体收尾成功，`stopped` 仅表示停止并保留当前已接受结果。没有人提出 finish 时，Host 不从“大家都空闲”推断成功。

## 暂停、恢复与停止

```text
/swarm pause
/swarm resume
/swarm resume --budget 30m
/swarm stop
/swarm task release <id> --revision <n> --reason "解除当前占有"
/swarm task cancel <id> --revision <n> --reason "此项已被其他工作覆盖"
```

- pause/stop 先关闭新工作入口，再取消并等待本 run 的资源静止；`quiescing` 表示仍在停止，不能视为已经停干净。
- 暂停不释放任务。原 owner 只能在 paused 且已静止时 release/cancel；release 不保证换人，原 worker 也能以新版本再次认领。
- 暂停期间 deadline 数值照常推进；过期 paused run 必须显式追加预算才能恢复。
- `completed/stopped/failed` 为终态，不能 resume。要继续，以当前 acceptedHead 重新提供完整 spec 新建 run；不隐式继承旧目标、任务或预算。
- 一个仓库最多一个非终态 run，paused 也占名额；保留原 owner Session 才能续跑。
- worktree 和分支保留，不自动删除。若未能确认资源停止，保留现场并报告，不宣称可以安全清理。

## 开发与重新安装

```sh
pnpm install --ignore-scripts
pnpm link:harness -- <当前 @deepseek-ai/dsh 的安装目录>
pnpm typecheck
pnpm test
pnpm build
```

链接脚本只对齐本地开发的宿主声明和 Cordis 实例，不把机器路径写入源码。Zod 固定为 4.4.3，与目标 DSH storageDomain 的类型兼容。

构建后，通过当前 DSH 的 `plugin_manager install_bundle` 安装项目绝对目录。已经安装时不要反复执行 install；根据管理器提示先移除/重新安装，或重启 DSH 载入更新后的 JavaScript。仅修改源码而没有构建不会更新运行代码。

## 验证范围

- 已有状态机、CAS、消息分页、等待竞态、权限执行适配、控制/发布排序、恢复和工具注册测试。
- 真实临时 Git 仓库的端到端测试串联了实际 Runtime、Collaboration、Delivery、IntegrationQueue 和 GitWorkspace；仅原生 worker/模型边界使用 fake。
- 已在当前运行 Host 中检查 runtime ready、命令、worktree 服务和真实 worker preset 的 9 个 Swarm 工具，见 [原生加载报告](</home/atlas/Github/4t145/dsh-swarm/notes/native-smoke.json>)。该报告的 `latestWorkerFailurePauseCode: false` 表示**最新构建尚未载入当前进程，必须重启**。测试没有创建模型任务或消耗模型 API。
- **尚未执行真实模型自主编码的端到端验收**；不能把上述 fake 边界测试说成真实 DeepSeek worker 任务已完成。插件仍为实验性 v0.1。
- 插件元数据、locale 与原创 SVG 文件已检查；未对 GUI 中的最终视觉呈现做浏览器目视验证。临时加载测试 bundle 的安装与配置已移除；管理器提示当前进程还需重启完成清理。正式插件保留启用。
