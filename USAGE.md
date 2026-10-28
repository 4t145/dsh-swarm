# DSH Swarm 使用说明

单机、对等 worker、独立 worktree、验证后集成到一个结果分支。架构见 [ARCHITECTURE.md](<ARCHITECTURE.md>)，开发规则见 [AGENTS.md](<AGENTS.md>)。

## 环境与当前安装

- 目标：DSH **0.2.1-rc.4**、Node **24.9+**、Linux、较新的 Git（建议 **2.46+**）。其他 DSH 版本或操作系统未验证。
- 当前 `web` profile 已安装并启用 `@local/dsh-swarm`，链接到本 checkout。首次安装已 live 生效，用户刷新后确认“协作群”空态正常。**后续 Host/worker 代码更新需要按管理器提示重启 DSH**；仅刷新网页不能替换已加载的 Host 模块。Client 更新后刷新页面。
- 依赖原生 `worktrees` 服务；当前 `web` profile 已启用 `@deepseek-ai/dsh-experimental-tool-worktree` bundle 提供它。本插件的 bundle 不再重复插入同一 provider；其他 profile 安装前须确认此服务已挂载（例如先启用该原生 bundle），否则 Swarm 将等待缺失依赖。独立 headless overlay 自带 provider，不要与 Web bundle 重复叠加。
- 是 Host 插件＋命令界面，并在 Web 对话页提供一个只读的 Swarm 进度面板（`conversation.view`，order=5）。面板只读取有界公开 DTO，不另起 Web 服务器。
- 原生 worker 继承启动者的模型和权限。只支持本地 spawn，不支持 Codex/Claude Code 外部 worker。
- worker 的审批策略是 `never`，不能在子会话内申请扩大权限。只读模式会拒绝启动；其他权限不足会明确失败，不自动改成 full access。
- worktree 不是安全沙箱。当前 profile 的全局 MCP 工具仍可能被 worker 继承；Swarm 不提供针对恶意 worker 的文件或网络隔离保证。

## 让 Agent 启动与控制

在聊天里描述目标**不会**自动后台开跑。两条显式入口：

- 人类：`/swarm start --spec <绝对路径>`，以及 `/swarm status|pause|resume|stop`。
- 模型/Agent：`swarm_manage` 工具，`action=start|status|pause|resume|stop`。start 需要内联 `spec` 对象或 `spec_path`。身份取自真实 `exec.agent`；子会话与 worker 一律被拒绝，不能递归控制包含自己的 run。
- Web 对话页的“协作群”标签位于“对话”和“轨迹”之间。新版将整体流程、任务/验证/预算指标、每个 worker 的当前任务与工具活动放在首屏，下面是任务板、最近公开活动和结果分支详情。切换或关闭标签只取消读取，不停止 run。
- worker 的任务归属、协作等待、提案集成与原生 running/inactive/unavailable 分开显示；inactive 不表示完成。工具仅显示名称、时间和返回状态，不显示参数、输出、命令正文、推理、私信或 finding 正文。
- 新版 Host 的会话级订阅在 run 结束后继续等待下一次 run；状态变化由事件推送，预算倒计时在浏览器本地计算，不轮询模型。连接中断保留最后快照但标为非实时，可手动重新连接。
- 旧 Host 会显示能力受限提示，继续展示旧版摘要；缺少新版执行活动和任务板不是“worker 无事可做”。如管理器要求重启，请先重启 DSH 再刷新/重新连接。
- 数据有界：任务板最多 40 项，公开活动最多最近 24 条；每个 worker 最多显示 16 个当前工具与 8 个最近工具。截断或不可用会显示说明，不把未展示的数据当作不存在。

可以直接对普通 owner 会话中的 Agent 说：

> 用 Swarm，在当前仓库安排 2 个 Agent，30 分钟内实现 X。验收是 Y；不要合入主分支。先整理配置给我确认，再启动。

之后可以说“查看 Swarm 状态”“暂停，保留任务”“继续并追加 15 分钟预算”“停止并给我结果分支”。Agent 使用上述 `swarm_manage` 工具，而不是靠聊天文本触发隐藏后台任务。`stopped` 是终态，不能直接继续，须以已接受的 SHA 开新 run。需要 DeepSeek 时先在 owner 会话选择该模型；当前同一次 run 的 worker 都继承 owner 模型，不能在 spec 中指定不同模型。

## 无 GUI / CI：headless 驱动

本地 checkout 先按本文开发命令构建并链接宿主依赖。附带的 overlay 是完整入口，不要求把包再安装到另一个 profile，也不要同时叠加 [cordis.patch.yml](<cordis.patch.yml>)：

```sh
dsh --profile headless --patch /absolute/path/to/dsh-swarm/cordis.headless.yml \
  --spec /absolute/path/to/run.json --json

# 不启动模型，只查看参数：
dsh --profile headless --patch /absolute/path/to/dsh-swarm/cordis.headless.yml -- --help
```

需要指定模型时追加 `--provider <id> --model <id> --effort <id>`。provider/model 必须成对提供，省略时使用该 profile 的默认模型。路由必须已在所选 profile 注册，并具有可用凭据；仅加参数不会把网页 profile 的 adapter 搬过来。启动前会核验路由，缺失时明确失败，不创建挂起的 run。凭据沿用该 profile 的 adapter/环境/.env 配置，不从网页复制密钥。

overlay 禁用 `headless-startup`/`headless-runner`、挂载 Agent preset registry 与相同的 worker 工具、把存储域切到 `local_swarm_headless`（避免恢复 GUI 进程的 run），并插入 driver。worker 模块使用基于构建入口的绝对 URL，避免被错误解析到 profile 目录。driver 自己创建 owner Session，等待整个 run 进入终态才退出：

- 退出码 `0` = `completed`；`1` = `failed` 或启动错误；`2` = 参数错误；`130` = `stopped`/中断。
- `--json` 输出有界 JSONL：`progress` 行与一条 `final` 行；启动前的参数/路由错误可以输出 `error` 行。无 `--json` 时只把阶段摘要写到 stderr，final 写到 stdout。
- 首次 Ctrl-C/SIGTERM 先停止本次 run、记录终态，再退出应用；再次发送信号交回平台的强制关闭路径，此时不保证最终记录。不要同时对同一仓库运行 GUI 和 CLI worker。

## 启动一次任务

1. 准备一个有本地提交的 Git 仓库。默认要求干净工作区；插件不替你 stash、commit 或覆盖未提交修改。
2. 复制并编辑 [配置示例](<examples/swarm-run.json>)，明确仓库路径、目标、逐项验收、worker 数量、时间和真实验证命令。
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

自主协作原型不需要另开模式：仍用 `swarm_manage start` 提供共同目标，不预先给每个 worker 指派分工。worker 会自己观察缺口、认领、协商、提交，再寻找下一项工作。普通工具成功返回时，插件向该 worker 附上有界的同伴新发现/工作声明/相关消息，不必等它主动查询才看到。默认每次最多 6 条、每个正文片段 400 字符；可通过 worker 插件 Config 的 `peerNoticeItems` / `peerNoticeChars` 调整。提示不会自动确认游标，正式同步仍由 swarm_sync 完成。

若 worker 只是普通结束了一个 activation，却没有明确 wait 或 finish，Host 会通过已有原生消息通道提醒它自主继续；不会指定它做哪个任务。显式等待、暂停、终态不会被这个提醒唤醒，连续无进展仍暂停，预算边界保持不变。此原型本轮只构建，尚未跑新增行为的模型验收。

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
# 原生 CLI 回归：隔离 DSH_HOME，使用阻塞测试 adapter，不调用付费模型 API
pnpm test:native-headless
```

链接脚本只对齐本地开发的宿主声明和 Cordis 实例，不把机器路径写入源码。Zod 固定为 4.4.3，与目标 DSH storageDomain 的类型兼容。

构建后，通过当前 DSH 的 `plugin_manager install_bundle` 安装项目绝对目录。已经安装时不要反复执行 install；根据管理器提示先移除/重新安装，或重启 DSH 载入更新后的 JavaScript。仅修改源码而没有构建不会更新运行代码。

## 验证范围

- 已有状态机、CAS、消息分页、等待竞态、权限执行适配、控制/发布排序、恢复和工具注册测试。
- 真实临时 Git 仓库的端到端测试串联了实际 Runtime、Collaboration、Delivery、IntegrationQueue 和 GitWorkspace；仅原生 worker/模型边界使用 fake。
- [历史原生加载报告](<notes/native-smoke.json>) 记录早期代码代际与工具接线，不代表当前进程已经载入最新构建。更新以管理器的 `application`/`nextStep` 为准。
- **真实双 worker 编码已完成两次**：2026-10-28 用 `deepseek-official/deepseek-flash` 在两个临时仓库运行，均由插件自动验证、发布、finish 至 completed，Lead 独立复跑结果测试通过，原 checkout 保持基线。详见 [验收报告](<notes/live-e2e-2026-10-28.md>)。第一场景覆盖失败反馈与重提，第二场景有重复实现；不据此宣称协作效率或大项目可靠性。
- 两次实跑发现 code task 完成后的 currentTaskId 残留，源码已修复并补回归；真实运行仍使用更新前的 Host，该修复的重启后模型验收尚未执行，也不自动修补历史 completed 记录。
- 独立 headless 的帮助、缺失路由、两个原生 worker 的 SIGINT→持久 stopped→退出 130 已通过。中断测试使用阻塞 adapter，不是付费模型编码验收；完整真实模型 CLI 运行仍需可用路由。
- 初版 GUI 空态由用户刷新后确认，slot 注册亦经 Inspect 核验；没有自动化浏览器目视、明暗主题或布局截图验收。元数据与原创 SVG 源文件已检查，实际图标渲染未核验。插件仍为实验性实现。
