# DSH Swarm 使用说明

单机、对等 worker、独立 worktree、验证后集成到一个结果分支。架构见 [ARCHITECTURE.md](<ARCHITECTURE.md>)，开发规则见 [AGENTS.md](<AGENTS.md>)。

> **R6 公共频道是本次结果分支的代码功能，不代表当前 GUI 已部署。** 本轮未安装插件、重启 Host 或启动替代服务器；由 owner 将结果应用到实际插件 checkout 后，按管理器要求加载新版。历史安装和模型验收不能当作这次公共协议的真实运行验收。

## 环境与当前安装

- 目标：DSH **0.2.1-rc.4**、Node **24.9+**、Linux、较新的 Git（建议 **2.46+**）。其他 DSH 版本或操作系统未验证。
- 当前 `web` profile 已安装并启用 `@local/dsh-swarm`，链接到本 checkout。首次安装已 live 生效，用户刷新后确认“协作群”空态正常。**后续 Host/worker 代码更新需要按管理器提示重启 DSH**；仅刷新网页不能替换已加载的 Host 模块。Client 更新后刷新页面。
- 依赖原生 `worktrees` 服务；当前 `web` profile 已启用 `@deepseek-ai/dsh-experimental-tool-worktree` bundle 提供它。本插件的 bundle 不再重复插入同一 provider；其他 profile 安装前须确认此服务已挂载（例如先启用该原生 bundle），否则 Swarm 将等待缺失依赖。独立 headless overlay 自带 provider，不要与 Web bundle 重复叠加。
- 是 Host 插件＋命令界面，并在 Web 对话页提供 Swarm 协作群面板（`conversation.view`，order=5）。进度读取有界公开 DTO；追加目标等写操作走原生命令和 owner 权限路径，不另起 Web 服务器。
- 原生 worker 继承启动者的模型和权限。只支持本地 spawn，不支持 Codex/Claude Code 外部 worker。
- worker 的审批策略是 `never`，不能在子会话内申请扩大权限。只读模式会拒绝启动；其他权限不足会明确失败，不自动改成 full access。
- worktree 不是安全沙箱。当前 profile 的全局 MCP 工具仍可能被 worker 继承；Swarm 不提供针对恶意 worker 的文件或网络隔离保证。

## 让 Agent 启动与控制

**默认直接和前台 Agent 对话，不需要输入命令或编写 JSON。**

- “用 Swarm 帮我做这个应用”：Agent 澄清必要的产品决定、读取项目并准备启动配置。
- “再加一个导出功能”：Agent 将明确的新需求追加到当前 Swarm，并说明它已开始处理还是正在等待。
- “再加两个人”：Agent 调用 `add_workers` 中途扩容，不停止当前 run。
- “现在进展怎么样”“暂停一下”“继续工作”：Agent 查询状态或执行相应控制，不把命令教程交给你。

owner Agent 的系统提示和 `swarm_manage` 工具描述都直接写明：启动开发就是调用 `swarm_manage {action:"start", spec:{...}}`，并附一份内联 spec 模板（repository、baseRef、goal、acceptanceCriteria、workers、allowDirtyBaseline、verification）。Agent 不需要先去找 CLI、脚本或斜杠命令；它只需读项目的构建/测试配置，填入真实的验证命令。
- 前台 Agent 组织共同目标、用户决策和交付；worker 自主拆分/认领/协商，前台不逐个派工。

这些动作仍需 Agent 实际调用 `swarm_manage`，不是关键词匹配的隐藏后台程序；咨询、讨论或未确定的想法不会被当成已授权工作。插件向普通 owner Agent 提供简洁的当前 run/目标状态，worker 和子会话不获得这套控制指令。暂停和已停止状态仍受原有授权约束。

高级/备用入口是 `/swarm start --spec <路径>` 与 `/swarm status|append|continue|pause|resume|stop`；用户可以不用它们。

- Web 对话页的“协作群”标签位于“对话”和“轨迹”之间，新版内部有六个独立页签：**Dashboard、成员列表、协作流、公共讨论、目标看板、Git 工作树**（旧 Host 保留旧视图并显示公共能力提示）。Dashboard 依次展示本轮目标、四阶段步进条、任务/验证/预算三张指标卡（任务卡带按状态分段的组成条）、当前交付与“团队现状”卡、任务板和最近公开活动；成员在所有页签中使用同一种有彩色的身份色，黑/白/灰只用于 Host 与已接受结果；成员的当前任务与工具活动在成员列表。页签支持方向键及 Home/End。切换或关闭视图不停止 run。
- “协作流”页签按泳道展示成员之间的行为：最上方是 Host/已接受结果，下面每名成员一条泳道，事件按发生顺序从左到右。私信画成从发送者弯到接收者的弧线，发现是菱形（失败报告为红色），任务是方块，提案是三角（被拒绝为红叉），结果推进是主线上的圆环，并用虚线连回作者。上方统计私信、发现、提交和结果推进次数，可按类型筛选；下方是“谁在和谁沟通”的定向私信排行和最近动态。鼠标移到泳道上的任意节点（或用 Tab 聚焦）会弹出卡片：私信显示发送者→接收者和正文，发现显示类型、正文、范围和证据，任务和提案显示任务标题与状态，结果推进显示完整 SHA。点击或回车固定卡片，Esc 或 × 关闭，滚动时卡片收起。
- “协作流”下方的“成员对话与发现”显示具体内容：私信正文（谁发给谁），以及事实、观察、失败报告、改动摘要的正文、关联任务、范围和证据。只有启动该 run 的 owner 会话能读；最新在前，每页 40 条，可加载更早内容，有新消息时自动刷新；可按类型和成员筛选。单条正文超过 8000 字符时截断并标明。最多展示最近 80 条事件。
- “Git 工作树”页签是一张**地铁式轨道图**：最上方黑/白色主线是已接受结果，下面每个 worker 一条彩色轨道，左侧固定的轨道名牌显示 worker 名、分支和当前 HEAD。提交是轨道上的站点（最新在左，更早向右）；worker 分出时曲线从主线弯下，集成时曲线汇入主线上的“换乘站”（合并提交）；带光晕的站点是该工作树当前 HEAD，最右端方块是 run 基线。画布随提交数向右延展，滚动到右端自动加载更早的提交。没有提交时显示空态；没有 run 时页签仍可用，并提供可折叠的“新建工作树”表单。
- worker 的任务归属、协作等待、提案集成与原生 running/inactive/unavailable 分开显示；inactive 不表示完成。工具仅显示名称、时间和返回状态，不显示参数、输出、命令正文或推理；私信和 finding 正文只在“协作流 → 成员对话与发现”中提供给 owner。
- 新版 Host 的会话级订阅在 run 结束后继续等待下一次 run；状态变化由事件推送，预算倒计时在浏览器本地计算，不轮询模型。连接中断保留最后快照但标为非实时，可手动重新连接。
- 旧 Host 会显示能力受限提示，继续展示旧版摘要；缺少新版执行活动和任务板不是“worker 无事可做”。如管理器要求重启，请先重启 DSH 再刷新/重新连接。
- 数据有界：目标看板与任务板各最多展示 40 条记录，另保留初始目标；公开活动最多最近 24 条；每个 worker 最多显示 16 个当前工具与 8 个最近工具。截断或不可用会显示说明，不把未展示的数据当作不存在。Git 历史使用单独的分页接口，不受最近公开活动条数限制。

可以直接对普通 owner 会话中的 Agent 说：

> 用 Swarm，在当前仓库启动 2 个 Agent 自主实现 X。验收是 Y；不限时，不要合入主分支。先整理配置给我确认，再启动。

之后可以说“查看 Swarm 状态”“暂停，保留任务”“继续 Swarm”“停止并给我结果分支”。Agent 使用上述 `swarm_manage` 工具，而不是靠聊天文本触发隐藏后台任务。`stopped` 是终态，不能直接继续，须以已接受的 SHA 开新 run。需要 DeepSeek 时先在 owner 会话选择该模型；当前同一次 run 的 worker 都继承 owner 模型，不能在 spec 中指定不同模型。

## 动态添加成员

运行中途可以随时扩容，不需要停止或重启 run。三种入口：

- 对 owner Agent 说“再加两个人”：Agent 调用 `swarm_manage {action:"add_workers", count:2}`，按顺序逐个预留成员；达到上限或中途失败时，回执列出已经加上的成员和停止原因，不会把部分成功报告成全部成功。
- 在“成员列表”顶部的团队规模卡片点击“+ 添加成员”；卡片用色块显示已占用与剩余名额。
- 直接输入 `/swarm worker add`，需要机器可读回执时用 `/swarm worker add --json`。

- 每位新成员获得持久化、随机且本轮不重复的可读名字；名字显示在成员筛选、任务归属与活动中。稳定 worker ID、Session 和分支身份不变，旧记录仍有兼容显示名。
- 仅 `running` 或 `paused` 可添加，总数上限仍为 **4**。运行中立即准备独立 worktree 并开始协作；暂停时只预留成员，恢复后启动。新 worktree 以当时已接受的结果版本为基线。
- 连接中断、收尾、终态或达到上限时按钮禁用。提交失败或结果未确认时先检查成员列表，再决定是否重试。初始化失败保留诊断，不伪装为已经运行。
- 这是 owner 控制入口，不给 worker 递归创建成员或扩大权限的能力；不会停止、替换已有成员。

## 随时追加目标

在**启动 run 的同一 owner 会话**发布下一条需求，不必停工或重写启动配置：

- 面板：打开“协作群 → 目标看板”，在**代办**池的“添加新的愿望”输入框提交，可展开填写验收条件，查看回执与目标状态。
- slash：`/swarm append 增加 CSV 导入的错误行号提示`。
- Agent：调用 `swarm_manage`，参数例如：

```json
{
  "action": "append",
  "goal": "增加 CSV 导入的错误行号提示",
  "acceptance_criteria": ["无效行的错误信息包含原文件行号"]
}
```

省略验收项时，以目标正文作为验收项；需要多条验收时也可用：

```text
/swarm append --json {"goal":"增加 CSV 导入的错误行号提示","acceptanceCriteria":["无效行的错误信息包含原文件行号"]}
```

| 追加时的阶段 | 回执与后续操作 |
|---|---|
| preparing / running | `executing`：进入本轮目标；worker 经正常同步和通知自主组织工作，不表示需求已经完成 |
| paused | `paused`：已保存，恢复后处理；追加不唤醒 worker，使用 `/swarm resume` |
| draining / quiescing | `deferred`：进入下一轮待办，不计入正在收尾的旧验收；等收尾结束后再继续 |
| completed / stopped / failed | `deferred`：已保存但不执行；明确 `/swarm continue` 或 `swarm_manage {action:"continue"}` 才新开一轮 |

“继续”沿用旧 acceptedHead、仓库与验证配置启动**新 run**，只带入待继续目标，并保留旧 run 与目标的关联；不是把 stopped/failed 偷偷改回 running。若最终停在 paused，先恢复本轮。默认不限时，不因追加而引入新的截止时间。原始目标、验收、已完成记录和代码验证凭据均保留；旧完成凭据不能把后追加目标标为已处理。

目标看板有三个池，状态来自 Host，不支持手动拖拽把目标标为完成：

- **代办**：下一轮需求，以及停止/失败后未完成或已转入下一轮的历史目标；转交不等于办结。
- **办理中**：当前轮的 active 目标（暂停时仍属于本轮）。愿望在运行中提交后会自动进入此池，不需要另行派单。
- **办结**：Host 已完成验收的目标；初始目标只在 run 为 `completed` 时进入。仅有提交、局部测试通过或 worker inactive 都不算办结。

卡片可展开查看全文、验收条件和完成版本/下一轮关联。内部页签切换保留愿望草稿；提交失败保留草稿，切换 owner 会话或 run 后不沿用旧草稿。开启下一轮前须先提交或清空草稿。

当前权限范围是同一 owner Session 和该 run 的仓库，不是跨任意会话发布。普通聊天仍需 Agent 实际调用工具；工具或命令拒绝时不会显示为已接收。无需主 Agent 给 worker 逐项派单。

面板与插件资源使用原创 SVG 品牌图标。当前 DSH 的 slash 候选 API 没有自定义 SVG/icon 字段，因此命令描述仅使用简洁符号；没有伪造左侧图标槽或修改宿主 DOM。

## Git 工作树合并流

“Git 工作树”页签展示各成员 worktree 与已接受结果的真实 Git 提交合并流，同一 SHA 只显示一次；不是聊天或工具调用日志。向下滚动会自动加载更早提交，也可用键盘点击“加载更早提交”。每条记录展示可读成员名、来源分支、时间、主题与 SHA；合并提交有独立标记，可展开父提交。工作树详情列出各成员分支、路径、读取时的 HEAD 和读取失败诊断。

**来源分支表示该提交从此分支可达，不等于 Git 作者身份**；共享历史可能只显示一个来源。历史从本轮基线之后开始。分页固定在第一次读取的各分支版本，不随新提交改变页边界；点击“更新历史”重新读取当前版本。切换页签、会话或 run 会取消旧请求，回来时重新加载。旧 Host 不支持接口或 Git 读取失败会显示说明，不把失败当作空历史。

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

`--spec` 路径相对 owner 的当前 cwd 解析；JSON 内 `repository` 相对 spec 所在目录解析。`baseRef` 在启动时固定为一次 SHA。workers 为 2–4，setup 可以为空数组，test 必须非空。

**工程任务默认不限时**：省略 `budgetMinutes` 或设为 `0`，不会因墙钟时间到期被停止。面板显示运行时长而非倒计时。只有你明确要求限时，才填写正整数分钟数；Agent 不应自行选择 20/30 分钟截止。单条命令的 `timeoutMs` 仍用于避免卡死，和整个 run 的时限是两件事。

`allowDirtyBaseline: true` 只表示明确接受“未提交内容不进入 worker”；不复制这些修改。命令是 argv 数组，不经 shell 拼接。setup/test 在集成工作区运行，验证前不假定已安装依赖。需要 `$HOME` 外部缓存、网络或额外系统依赖的命令可能被当前 sandbox 拒绝，应调整项目配置或由用户选择适当权限，不让 worker 绕过策略。

## 工作与交付

worker 自主创建/认领任务，默认在公共频道线程里协商，并通过结构化 @/回应请求明确谁需要行动；只有有限可见性确有必要时才用原私信。知识条目为 `observed`、`fact`、`fail`、`patch_summary`；重要已确认结论带证据发布 Finding，再链接来源讨论。模型看到的工具结果与输入由原生 Session 日志记录。

无需另开模式：仍用 `swarm_manage start` 提供共同目标，不预先给每个 worker 指派分工。worker 自己观察缺口、认领、公开协商、提交，再寻找下一项工作。普通工具成功返回时附上有界同伴摘要，公共活动按线程合并为标题与数量，**不把全部公共正文灌给每个人**。默认最多 6 条、标题/旧事件片段 400 字符，由 worker Config 的 `peerNoticeItems` / `peerNoticeChars` 调整。明确待关注通知另按优先级展示引用。摘要不自动确认任何游标，正式事件同步仍由 swarm_sync 完成。

若 worker 只是普通结束了一个 activation，却没有明确 wait 或 finish，Host 会通过已有原生消息通道提醒它自主继续；不会指定它做哪个任务。显式等待、暂停、终态不会被这个提醒唤醒，连续无进展仍暂停，预算边界保持不变。本轮公共协议有确定性投递回归，但尚未进行新版真实模型验收。

代码先进入 worker 私有提交，再在专用集成工作区串行合并并执行 setup/test。只有通过验证的组合提交才推进 result 分支。局部检查通过不代表集成通过；失败候选会交回作者修复。用户原工作区的 tracked 文件、index、当前分支与 cwd 不被插件切换。

`/swarm status --details` 查看当前结果 SHA、实际 ref 与记录是否一致、worker/任务状态及验证诊断。命令输出有界；完整改动可以在仓库中查看：

```sh
git diff <baseCommit> <acceptedHead>
git show <acceptedHead>
```

结果分支形如 `swarm-<run-id>-result`。由用户决定是否合入自己的分支；插件不自动更新主分支。只有 `completed` 表示整体收尾成功，`stopped` 仅表示停止并保留当前已接受结果。没有人提出 finish 时，Host 不从“大家都空闲”推断成功。

## 公共频道与线程协作

新版“协作群 → **公共讨论 / Public discussion**”提供频道列表、线程/回复上下文、关联任务/Finding/提案、@对象、待回应对象、当前约定与确认/修订历史；可搜索、切换频道/线程/任务过滤、按来源 ID 跳转及翻页。保留原协作流、成员、目标和 Git 视图。公共面板是 **owner 授权只读观察**，不会替 worker 回应、确认、标已读，也不会将讨论转成正式新需求。旧 Host 没有接口时显示能力提示；请勿把网络/权限错误当作没有历史。

- 每个 run 自动带 `general`。所有成员和后来加入者都能读取公共历史，不需要先订阅；订阅只决定普通更新通知。成员可创建主题频道；仅创建者能按 revision 归档，general 永久保留。归档后不能新增/修订讨论，历史和搜索仍可读。
- 公共正文只存一份，通知带原因和引用。`mentions:[workerId]`、明确回应请求、对本人消息的回复、约定需要确认与显式全局公告优先通知。仅在正文写 `@名字` 不会触发通知。关联任务当前负责人、参与者和订阅者接收合并更新；无关普通讨论不逐条唤醒全员。
- 私信工具 `swarm_message` 及旧历史不变；不自动公开旧私信，也不允许把私信 ID 当公共回复/来源。owner 看见消息不等于它成为需求；新需求仍须经过原 `swarm_manage append` / 目标看板授权入口。

### Worker 工具

原 9 个工具不变；新增两项实际工具仅给 worker preset，不给普通 owner 冒充成员。公共协议的新字段采用 **camelCase**（旧工具字段保持原 snake_case）：

| 工具 | 参数与效果 |
|---|---|
| `swarm_public_read` | `view` 必填：channels、threads、messages、requests、agreements、attention、activity、message_revisions、agreement_versions。可选 channelId/threadId/taskId/findingId/messageId/agreementId/query/status/cursor/limit；每页最多20条，返回截断和 nextCursor。 |
| `swarm_discuss` | `command:{action,...}`，按下表创建/修改公共对象；身份取真实 Agent。需要 revision/version 的动作必须提供最近读取的值，冲突应重读而非强行覆盖。 |

`swarm_discuss` 的 command：

| action | 主要字段 |
|---|---|
| create_channel / archive_channel | name、purpose / channelId、expectedRevision |
| create_thread / update_thread | channelId、title、taskIds? / threadId、expectedRevision、可选 title/taskIds/status/conclusionMessageId |
| post | threadId、body；可选 replyToMessageId、mentions、responseRequestedFrom、taskIds/findingIds/proposalIds、announcement |
| revise_message | messageId、expectedRevision、body、mentions/taskIds/findingIds/proposalIds（省略数组即清空当前关联，旧版保留） |
| subscribe | channelId、threadId?、mode=following 或 muted；只设置自己，不改变公共可见性 |
| request_response | messageId、targetWorkerId、taskIds?；或直接 post 的 responseRequestedFrom 一次为多人建立请求 |
| respond / withdraw_request | requestId、expectedRevision；respond 另需自己的本线程 responseMessageId |
| create_agreement | threadId、title、content、sourceMessageIds、stakeholderWorkerIds、taskIds? |
| revise_agreement / confirm_agreement | agreementId、expectedVersion、完整新版 content/sourceMessageIds/stakeholderWorkerIds/taskIds / agreementId、version |
| link_finding | threadId、findingId、expectedRevision、messageId?；先用 swarm_publish 发布有证据的 Finding |
| ack_notifications | notifications:[{id,seq}]；仅确认自己的精确通知版本，合并后旧 seq 会拒绝 |
| mark_read | channelId、messages:[{messageId,revision}]；只能确认实际提供的当前全文版本 |

例如，先 `swarm_public_read {"view":"channels"}` 获得频道 ID，再创建线程和提问（下面 ID 为工具实际返回值的占位）：

```json
{"command":{"action":"create_thread","channelId":"<channel-id>","title":"API response contract","taskIds":["<task-id>"]}}
```

```json
{"command":{"action":"post","threadId":"<thread-id>","body":"请确认分页响应字段。","mentions":["<worker-B-id>"],"responseRequestedFrom":["<worker-B-id>"]}}
```

B 用 `swarm_public_read {"view":"attention"}` 先看待回应，再用 messages/threadId 展开全文、发一条带 replyToMessageId 的公开回复，最后显式回应请求：

```json
{"command":{"action":"respond","requestId":"<request-id>","expectedRevision":1,"responseMessageId":"<B-reply-id>"}}
```

重要接口约定用 create_agreement 列明来源、任务、相关方；每位相关方执行 confirm_agreement 的**精确当前 version**。修订后旧确认只留历史，不算同意新版。不从沉默、读过或普通回复推断同意。

### 阅读不等于确认或回应

- `swarm_sync` 的 offeredSeq/observedSeq 是原全局事件扫描/ACK，保持有界分页规则；只有 sync/wait 返回的合法 cursor 可用于原 ACK。
- public activity、通知、GUI 和历史版本摘要都不是 worker 的全文阅读。只有 messages 返回的当前全文版本成为可 mark_read 的 offered 版本；旧版已读不会自动覆盖新版。
- 通知 deliveredAt 仅证明 inbox 收到，acknowledgedAt 需显式 id+seq 确认。通知 ACK 后回应请求仍可能 pending，attention 仍将其放在普通更新前。
- `snapshotSeq`/`nextCursor` 只用于公共查询分页，不可拿去推进全局 ACK。cursor 绑定 run/筛选，新增消息不会挤掉已打开分页；要看到新内容应刷新首屏。
- 新成员可依次读 channels、activity/threads、agreements 和 requests(status=pending)，然后按来源消息展开；不需要重放所有聊天到上下文。
- 普通未关闭线程、未答问题不自动阻塞 finish。真正阻塞交付要建立 Task/带修复任务的 fail Finding；讨论不能替代 Task CAS、Git 提案/验证或 owner 需求。

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
- 默认不限时的 run 暂停后可直接恢复。仅显式限时 run 的 deadline 在暂停期间仍推进；已过期时需明确追加时限才能恢复。
- `completed/stopped/failed` 为终态，不能 resume。已追加下一轮目标时，明确使用 `/swarm continue` 新建关联 run；否则以当前 acceptedHead 提供完整 spec 新建 run。不隐式复活旧 run，也不把旧任务或消息当作新一轮已处理事项。
- 一个仓库最多一个非终态 run，paused 也占名额；保留原 owner Session 才能续跑。
- worktree 和分支保留，不自动删除。若未能确认资源停止，保留现场并报告，不宣称可以安全清理。

## 开发与重新安装

```sh
pnpm install --frozen-lockfile
pnpm run link:harness -- <当前 @deepseek-ai/dsh 的安装目录>
pnpm typecheck
pnpm build
pnpm test
# 原生 CLI 回归：隔离 DSH_HOME，使用阻塞测试 adapter，不调用付费模型 API
pnpm test:native-headless
```

链接脚本只对齐本地开发的宿主声明和 Cordis 实例，不把机器路径写入源码。Zod 固定为 4.4.3，与目标 DSH storageDomain 的类型兼容。

pnpm 11 的[项目配置](<pnpm-workspace.yaml>)仅允许 esbuild 的必要平台二进制安装脚本；没有批准所有依赖脚本。`verifyDepsBeforeRun:false` 防止每次脚本前自动重装覆盖已链接的 Harness/Cordis，因此须按上面的顺序先显式 frozen-lockfile install、再 link、再检查。无需设置临时 `pnpm_config_verify_deps_before_run` 或改用户全局配置；typecheck/build/test 没有被跳过。

构建后，通过当前 DSH 的 `plugin_manager install_bundle` 安装项目绝对目录。已经安装时不要反复执行 install；根据管理器提示先移除/重新安装，或重启 DSH 载入更新后的 JavaScript。仅修改源码而没有构建不会更新运行代码。

**Swarm 的结果分支/私有 worktree 不会自动更新当前 GUI 所加载的插件目录**。本轮新增页签、动态成员和 Git 历史需要先由 owner 将已接受结果应用到实际插件 checkout、完成构建并按管理器提示重启 Host，再刷新现有 GUI。没有确认实际插件路径与构建监听器前，不承诺 HMR 自动生效；另起 Web 服务器不能更新当前 GUI。自动化源代码检查和组件测试通过，不代表当前页面已加载新版或已完成真实浏览器目视验收。

## 验证范围

- 已有状态机、CAS、消息分页、等待竞态、权限执行适配、控制/发布排序、恢复和工具注册测试。
- 真实临时 Git 仓库的端到端测试串联了实际 Runtime、Collaboration、Delivery、IntegrationQueue 和 GitWorkspace；仅原生 worker/模型边界使用 fake。
- [历史原生加载报告](<notes/native-smoke.json>) 记录早期代码代际与工具接线，不代表当前进程已经载入最新构建。更新以管理器的 `application`/`nextStep` 为准。
- **真实双 worker 编码已完成两次**：2026-10-28 用 `deepseek-official/deepseek-flash` 在两个临时仓库运行，均由插件自动验证、发布、finish 至 completed，Lead 独立复跑结果测试通过，原 checkout 保持基线。详见 [验收报告](<notes/live-e2e-2026-10-28.md>)。第一场景覆盖失败反馈与重提，第二场景有重复实现；不据此宣称协作效率或大项目可靠性。
- 两次实跑发现 code task 完成后的 currentTaskId 残留，源码已修复并补回归；真实运行仍使用更新前的 Host，该修复的重启后模型验收尚未执行，也不自动修补历史 completed 记录。
- 独立 headless 的帮助、缺失路由、两个原生 worker 的 SIGINT→持久 stopped→退出 130 已通过。中断测试使用阻塞 adapter，不是付费模型编码验收；完整真实模型 CLI 运行仍需可用路由。
- 初版 GUI 空态由用户刷新后确认，slot 注册亦经 Inspect 核验；没有自动化浏览器目视、明暗主题或布局截图验收。元数据与原创 SVG 源文件已检查，实际图标渲染未核验。插件仍为实验性实现。
