# DSH Swarm v0.1：单机对等 Agent 协作插件实施方案

文档修订：R5 · 2026-10-28（追加式 owner 目标）

状态：待实现的架构规格，不是已实现功能说明。

读者：没有参与前期讨论、需要理解并实现这个插件的开发者或 AI。

> 本文自包含。理解方案不需要阅读历史聊天、Agensh/DeLM 论文或其他文件。末尾链接只提供来源和实现时的 API 核验入口。

## 0. 先建立正确的心智模型

我们要开发一个 **DSH 插件**：用户给出一个编码目标，插件启动 2 个对等 AI worker；每个 worker 有自己的对话和 Git worktree。它们自行提出、认领和完成子任务，通过共享知识和消息协作。插件把各自提交的代码串行合并、运行验证，最终交付一个结果分支。

这里没有“经理 LLM”。**worker 决定做什么；普通程序负责状态一致性、消息投递、资源停止和代码集成。**

```text
用户会话（目标、启动、暂停、恢复、停止、查看结果）
                      |
                      v
            Swarm Host Service（普通程序）
            /         |          \
       Worker A    共享协作数据    Worker B
       DSH 会话    任务/发现/消息  DSH 会话
       worktree A                worktree B
            \                      /
             提交不可变 Git commit
                      |
                      v
              串行 Integration Queue
              专用集成 worktree 中合并、测试
                      |
                      v
              验证通过的 result 分支
```

必须分清以下四件事：

1. 一个 worker 的一次对话结束，不等于它的任务完成。
2. 任务已经认领，不等于它涉及的文件被加锁。
3. worker 已经提交候选代码，不等于代码已经集成。
4. 所有 worker 空闲，不等于用户目标已经完成。

最终产物是 **result 分支的 commit SHA、相对基线的 diff、验证结果和目标验收说明**。插件不自动把结果覆盖到用户原工作区。

## 1. 术语、范围与明确不做的事

### 1.1 术语

| 术语 | 本文中的唯一含义 |
|---|---|
| DSH Host | 当前运行 DSH 的单个宿主进程，已有模型调用、工具、Session 和权限机制 |
| Agent / worker | 会调用模型和工具的执行者；本插件创建的 Agent 称 worker |
| Session | worker 的持久对话身份与日志；恢复后仍使用同一个 Session ID |
| turn / step | turn 是一次输入引发的对话运行；其中可以有多个模型/工具 step |
| run | 用户发起的一整次 Swarm 工作，包含多个 worker、任务、候选提交 |
| owner | 启动 run 的用户 Agent；是生命周期和权限来源，不负责逐项分派任务 |
| worktree | 同一 Git 仓库的独立文件 checkout；文件隔离，但共享 Git 对象和部分元数据 |
| Task | 一个有输出和验收标准的工作项，不是一条聊天消息 |
| Finding | 可复用发现或失败经验，不是完整聊天记录 |
| Proposal | worker 提交给集成队列的一份不可变候选 commit |
| acceptedHead | 最近一次已被接受的公共 commit SHA；worker 只能把它当作已集成成果 |
| CAS | 比较并更新：只有 expectedRevision 与当前 revision 相等才允许修改 |
| seq | 一个 run 内业务事件的递增序号，供增量读取和等待使用；不是 DSH Session seq |

### 1.2 v0.1 固定选择

- 一台机器、一个 DSH Host 进程；默认 2 个 worker，允许配置 2–4 个。owner 可在成员页签或 `/swarm worker add` 动态追加至 4 个；running 立即走原生初始化，paused 仅预约并在显式 resume 后启动。准备/收尾/终态不接受新增成员。每个成员保存随机、可读且轮内不重复的名字，身份、Session ID 和 Git 分支仍使用稳定 ID。
- 使用 DSH 原生、本地、可续跑的子会话。首版不支持外部 CLI worker。
- 每个 worker 一个私有 worktree；另有一个插件专用集成 worktree。
- 一个 run 只有一个 result 分支；以 gitCommonDir 标识仓库，同一仓库同时只允许一个非终态 run，paused 也占用此名额，必须 stop 后才能启动新的 run。
- worker 使用同一套协作指令，自主发现任务；没有固定 planner、reviewer 或 integrator LLM。
- 单进程 Host 服务集中保存协作数据、串行更新和串行集成。这不违反“无经理 LLM”。
- 首版面向有本地 Git 基线、可配置验证命令的编码任务，不面向任意非编码研究任务。
- 原始 goal/acceptanceCriteria 与验证配置在启动后保留不变；owner 可通过 Agent 工具、slash 和面板共用的 Host 操作追加 GoalRecord，不覆盖历史。普通聊天不自动成为目标；调用真实 owner Session 的追加入口才会持久化。当前权限范围是同一 owner 会话、当前 run 的仓库。
- preparing/running 追加纳入当前轮并发出全员 goal 事件；paused 追加纳入当前轮但不唤醒。draining/quiescing/终态的追加保存为 deferred 下一轮待办，不进入已受理的 finish。暂停收尾期间的 deferred 在显式 resume 时激活；终态必须显式 continue，沿 acceptedHead 新建 run，保留 continuedFromRunId/continuedInRunId 关联，旧 stopped/failed 不复活。
- 工程 run 默认不设墙钟截止：省略 budgetMinutes 或设为 0 时，deadline=null，不启动到期 timer；持续至目标完成、用户停止，或因故障/无进展暂停。只有用户明确要求限时，才接受正整数 budgetMinutes；以下预算到期规则仅适用于这种显式限时运行。单条命令的 timeoutMs 保留。
- 暂停期间截止时间仍然推进，但已暂停的 run 不因时间经过自动变成 stopped。恢复过期的 paused run 必须明确追加预算；completed/stopped/failed 都是终态，不能 resume。预算已耗尽而进入 stopped 的工作，要以当前 acceptedHead 为基线新建 run。

### 1.3 不在 v0.1 做

不部署 Gitea、Mattermost、MySQL、Redis；不做多机、跨进程锁、worker 自主扩容、递归子 Agent、向量检索、自动全量聊天总结、自动更新用户主分支、自动删除 worktree。

worktree 不是安全沙箱。worker 仍遵守 DSH 的权限与工具策略。首版是可信本地协作，不宣称能阻止恶意 worker 通过 Bash 改写其他分支或访问已有权限范围内的文件。

## 2. 参考项目如何映射到 DSH

以 Agensh 为主，保留它的循环：**读上下文 → 自主认领 → 实施并分享 → 验证 → 整合 → 再找工作**。这个循环由 worker 指令表达，不重写 DSH 的模型/工具循环。

| Agensh 中的职责 | 本插件的实现 |
|---|---|
| 多个持久 worker | DSH 原生子会话 |
| 私有 checkout + Git 平台 | 本地 worktree + result 分支 |
| Issues / 工作声明 | 插件 Task 数据 |
| 公共频道 / 私信 | Finding + 插件 Message 数据 |
| 共享 context board | 追加式 Finding + 增量读取 / 搜索 |
| 每个 worker 的事件 router | Host 内的 Delivery 模块 |
| PR 整合 | 本地 Proposal + 串行集成队列 |

两项有意的工程差异：

1. Agensh 的 CLAIM 主要是软声明。本插件借鉴 DeLM，用 CAS 保证同一个 Task 只能有一个 owner；不同 Task 的范围重叠仍需 worker 协商。
2. Agensh 的公开实现不等于强制 CI。本插件明确要求验证通过才能推进 result 分支；这是我们的产品规则，不是对论文的转述。

不直接建立在 `agentTeams` 上：当前 Teams 以 Lead 和共享 checkout 为语义，不能假装它已经支持独立工作树和集成队列。我们复用更底层的 DSH 服务。

## 3. 模块划分：谁做什么

只发布一个 bundle，内部模块如下。表中的路径是计划创建的源码，不是已存在实现。

| 计划模块 | 唯一主要职责 | 不负责 |
|---|---|---|
| `src/runtime.ts` | run 状态、worker 创建/恢复、预算、暂停/停止 | 让 LLM 分配任务 |
| `src/store.ts` | 持久记录、CAS、业务事件 seq、幂等 mutation | 调用模型、执行 Git |
| `src/collaboration.ts` | Task / Finding / Message 的业务规则 | 改文件、唤醒 Agent |
| `src/delivery.ts` | 增量通知、等待条件、唤醒去重 | 重新规划工作 |
| `src/workspace.ts` | worktree 初始化、路径和 Git 身份核对 | 自动覆盖用户 checkout |
| `src/integration.ts` | Proposal 队列、候选合并、验证、推进 result | 用 LLM 自动解决冲突 |
| `src/tools.ts` | worker 工具，身份取自实际 Agent 上下文 | 信任模型自报 workerId |
| `src/commands.ts` | 用户 start/status/pause/resume/stop，以及暂停后的任务释放 | 给 worker 提供扩容权 |
| `src/client.tsx` | 后续只读看板 | 在浏览器折叠完整会话日志 |

Host 挂共享服务；专用 `swarm-worker` preset 挂读写文件、搜索、shell、jobs、协作工具和固定指令。不要直接沿用包含 Teams 的整套当前 preset，以免把“共享目录”指令带给私有 worktree worker。

worker 不获得插件管理、Swarm 启动控制或递归创建 Agent 的工具。已有权限不会因为插件执行而自动扩大。

## 4. 持久数据与三种不同的“顺序”

### 4.1 存储选择

使用 `ctx.storageDomain` 打开插件独有 domain。v0.1 每个 run 是一个 `runs[runId]` 聚合记录，包含任务、发现、消息、worker 映射、proposal、集成尝试及简短事件索引。

一次业务变更必须在一个 `table.update(runId, reducer)` 内完成：检查条件、更新对象、增加 revision、追加事件、增加 seq。这样不依赖跨表事务。

reducer 是纯同步函数，不得在里面 await Git、模型、网络或工具。DSH 单进程写队列负责将一次更新持久化后再公布。

大日志不内嵌聚合记录：保存为 run 所属不可变 artifact，数据中仅留引用和摘要。v0.1 不做历史剪裁，不悄悄删除旧 Finding；容量超出配置时暂停并说明原因。

### 4.2 最小数据模型（示意，不是可直接编译的完整类型）

```text
Run
  id, ownerSessionId, repositoryRoot, gitCommonDir
  goal, acceptanceCriteria[], goals{}, goalRevision, continuedFromRunId?, verificationConfig, deadline
  phase, reason?, quiesceTarget?, revision, nextSeq, baseCommit, acceptedHead
  resultRef, integrationWorktree, workers{}, tasks{}, findings{}
  messages{}, proposals{}, integrationAttempts{}, activeAttemptId?, verifications{}, finishRequest?, finishHistory[]
  events[], mutationReceipts{}

Worker
  id, sessionId, branch, worktreePath, initializationState
  observedSeq, offeredSeq, waitRegistration?, wakeTargetSeq?, notifiedSeq?

Verification
  id, purpose(proposal|finish), commit, expectedHead, sourceCommit?, proposalId?, attemptId?
  configFingerprint, status(queued|running|passed|failed|interrupted), receiptRef?

Task
  id, revision, createdByWorkerId?, kind(code|research), subject, acceptance, scope[]
  status(open|claimed|proposed|done|blocked|cancelled), ownerWorkerId?
  proposalId?, resultFindingId?, blockReason?, cancellationReason?

Finding
  id, seq, authorWorkerId, taskId?, kind
  summary, scope[], evidenceRefs[], supersedesId?
  blockingRepairTaskId?  // 只有具体未修复缺陷才引用修复任务

Message
  id, seq, authorWorkerId, targetWorkerId, body

Proposal
  id, taskId, authorWorkerId, sourceCommit, resultRefAtSubmission
  status(queued|integrating|accepted|rejected)
  acceptedCommit?, diagnosticsRef?

Event
  seq, kind, objectId, audience, authorWorkerId?
```

`validated(M,H,receipt)` 是简写，权威记录是持久化 passed Verification：`commit=M, expectedHead=H, sourceCommit=C, proposalId, attemptId, configFingerprint, receiptRef`。H 是本次开始集成时的 acceptedHead，**不是** Proposal.resultRefAtSubmission；提交之后公共分支可能已变化。每次 attempt 独立保存在 integrationAttempts 中，activeAttemptId 只作指针，不覆盖旧记录。用于恢复的 Verification 字段一旦 passed 就不可改写；取消未发布候选不会抹掉已完成测试的真实凭据。purpose=finish 时 commit=expectedHead=H，无 sourceCommit/proposalId；两种 purpose 的 passed 记录都可在 commit/配置匹配时复用于 finish。

追加目标记录含 id/seq/text/acceptanceCriteria/status(active|deferred|completed)、完成 commit/时间与下一轮关联。当前轮的有效验收是原始验收加 active 目标验收（去重）；worker sync 返回有效验收、goalRevision 与有界目标页，read 可按 ID/文本展开；goal 事件进入正常通知、等待和工具边界上下文。它是 owner 需求，不是 peer 建议，不需要 owner 指派 Task。

finish 调用携带 goal_revision（省略仅代表旧协议的 revision=0），受理与 Verification 保存 goalRevision，最终收尾复查版本；旧目标版本的验证不能复用，finish 的原子写也重查目标版本。每次受理的验收说明追加到 finishHistory，即使中断也保留。当前轮完成仅将 active 目标标为 completed，deferred 保持待办，绝不能因旧凭据被标为完成。旧数据缺少这些字段时按空追加列表、revision=0、空历史加载。

运行时 Agent 句柄、进程句柄和互斥锁不序列化。Agent 的 running/inactive 来自 DSH 实际状态，不把上次保存的 running 当作重启后仍在运行的证据。

### 4.3 三个数字不要混用

- `Task.revision`：保护一个任务的修改。旧 owner 不能结束已经转派的任务。
- `Event.seq`：通知和增量读取的顺序。读取位置不代表测试通过。
- Git SHA：具体代码版本。`acceptedHead` 不是任务 revision，也不是最新 worker HEAD。

处理 mutation 时，先验证实际调用者身份与 run 归属，再查幂等 receipt/已有相同 Proposal；命中只返回已有结果，不产生写入。只有新变更才继续检查 phase、任务状态与 revision，避免已经 done 的提交重试被误当成新提交。重复提交同一个 DSH 工具调用时，以 `(workerSessionId, toolCallId)` 作为 mutation receipt 的幂等键。新调用提交相同 task/sourceCommit 时：已有 queued/integrating/accepted Proposal 则返回它；若上次已经 rejected，允许用最新 task revision 新建尝试，即使代码 SHA 未变（例如上次只是被用户暂停中断）。

### 4.4 与 DSH Session 日志的关系

插件 domain 保存协作业务数据；模型真正看到的摘要通过正常工具结果、steer/inbox 进入该模型的 Session 日志。不能只改内存中的 prompt，导致恢复后无法重建看到过的内容。

不得自行向 DSH Session 追加未知的 `swarm/*` 事件类型。Swarm Event 是插件 domain 内的数据，不是 DSH SessionEvent 扩展。两者明确分开。

## 5. 启动和 worktree 布局

### 5.1 用户启动时必须确定的输入

- goal：完整目标；acceptanceCriteria：可检查的交付要求。
- repository：本地仓库；baseCommit：明确的本地 commit SHA。
- workers：2–4；budgetMinutes：可选，默认 0（不限时），正整数仅用于用户明确要求的限时运行。
- verificationConfig：用户或项目配置提供的 setup 与 test 命令及超时。

验证命令不是从 worker 消息中随意挑选执行。setup 用于在独立 checkout 安装依赖，test 用于决定候选是否能发布。所有命令沿用 DSH 的权限与 sandbox，不保证任意依赖都自动存在。

若仓库有 staged / unstaged / untracked 修改，默认拒绝启动并解释。用户可以明确选择“仅以已提交基线运行”；此时必须显示未提交内容不会进入 worker，不能自动 stash 或替用户 commit。

### 5.2 固定布局

以下是逻辑示例，具体路径采用 worktree 服务返回值：

```text
用户 checkout                       保持原文件、index、当前分支和 cwd
  .agents/worktrees/swarm-r1-w1/     worker 1，分支 swarm-r1-w1
  .agents/worktrees/swarm-r1-w2/     worker 2，分支 swarm-r1-w2
  .agents/worktrees/swarm-r1-build/  集成工作区，分支 swarm-r1-build

refs/heads/swarm-r1-result           指向 acceptedHead，不在任何 worktree checkout
```

“保护原工作区”不表示整个仓库零写入：创建 worktree 必然增加插件目录和共享 Git 对象/refs。保证的是不替用户改 tracked 文件、index、当前分支或会话 cwd。

### 5.3 原生创建顺序

1. 持久化 Run 和预留 worker Session ID，注册仅匹配这些 ID 的初始化监听器。
2. 通过 `subagents.startActivation` 的本地 spawn provider 创建 worker，选择独立 `swarm-worker` preset，`delivery: 'caller'`；不 fork 整段父对话。
3. `agent/created` 是串行且会被等待的事件：在该 worker 第一次模型请求前创建 worktree并切换其 cwd。
4. 原生 `worktrees.create(agent, ...)` 会改变调用 Agent 的 cwd，且从其当前 checkout 找仓库。因此由初始化中的 worker 调用，不对用户 owner 调用。
5. 第一个 worker 的初始化先创建集成 worktree，保存路径，然后将这个尚未开始推理的 worker cwd 切回 Run.repositoryRoot（已解析的源仓库绝对路径），再创建它自己的 worktree。初始化结束时只停留在其私有 worktree。后续 worker 从源仓库各自创建，避免把 worktree 池嵌套到另一个 worker 中。
6. 创建 resultRef 指向 baseCommit；确认初始化数据落盘后，允许第一个 worker 开始。初始输入包含 worker/run 身份和“先调用 swarm_sync 获取完整目标/验收/当前状态”的指令；目标正文由 sync 的正常工具结果进入 Session。其他 worker 随后加入，不要求全部进入同步 barrier。
7. 任何请求的 worker 初始化失败，停止本次 run 的已启动 worker，报告 failed，保留已创建目录供诊断，不悄悄改成单人成功运行。

恢复已有 worker 时走“核对并复用原 worktree”，不能再次创建同名分支。初始化半途遗留的目录必须结合记录核对；不确定时暂停，不能看到目录存在就认作初始化成功。

worktree 服务不会复制未提交/忽略文件，不会初始化 submodule 或安装依赖；首版不承诺 LFS、submodule 和外部隐式依赖项目即开即用。

## 6. Worker 协作协议与工具

### 6.1 给所有 worker 的固定工作指令

1. 先读目标和增量信息，再选择工作。没有任务时可自行提出一个具体任务，不等经理分配。
2. 任务要写输出、验收标准和 scope；尽量选择互补工作。
3. 先认领再实施；每人最多持有一个 `claimed` 或 `proposed` 任务。
4. 有可复用发现马上发布，不必等整个任务完成。只有 routine 状态变化时不发长消息。
5. 发现与同伴范围重叠，发送短消息协商；scope 不是文件锁。
6. 在自己 worktree 完成实现与本地检查，然后提交 commit 并 submit。
7. Proposal 等待期间可以读资料、回复同伴，但不开始下一项代码修改；终态后再领取下一项。这是 v0.1 简化，不是无限流水线。
8. 开始下一项编码前，将已接受的公共 commit 显式合入自己的干净分支。不得 reset 掉自己的未交付修改；冲突由自己处理。
9. 无可做事项时使用 `swarm_wait`；不要 shell sleep 或重复轮询。
10. 认为整体目标已完成时使用 `swarm_finish`，不能仅凭自己任务结束宣告整个 run 完成。

### 6.2 工具清单

下列 `swarm_*` 均为拟实现工具，不是已存在 DSH API。所有工具从 `exec.agent` 取得成员身份，所有写工具检查 run.phase。

| 工具 | 主要输入 | 返回或效果 |
|---|---|---|
| `swarm_sync` | `ack_seq?`, `limit?` | 读取业务数据、确认读取位置并解除自己的等待；不改变 Task 或代码，不执行 git pull |
| `swarm_read` | `id` 或 `query`、分页 | 展开具体条目或搜索历史，标明总数与截断 |
| `swarm_task_create` | kind、subject、acceptance、scope | 创建 open 任务；只创建目标确实需要的工作 |
| `swarm_task_update` | task_id、expected_revision、action | claim/release/block/unblock/cancel/research_complete；返回新版本 |
| `swarm_publish` | kind、summary、scope、evidence_refs、可选关联 | 追加 Finding，修正旧事实用 supersedes，不改历史 |
| `swarm_message` | target、body | 持久化定向消息；收件不代表模型已处理 |
| `swarm_submit` | task_id、expected_revision、source_commit | 固定 SHA，创建 Proposal，任务 claimed→proposed |
| `swarm_wait` | after_seq、可选 task_ids/proposal_ids | 不填 ID 时为 any；填写时为 selected。按 §7.2 匹配，有新事件立即返回；否则登记等待并结束 turn |
| `swarm_finish` | accepted_commit、逐项验收说明、证据引用 | 提议结束整个 run，受第 10 节条件约束 |

普通 Swarm 工具返回可捎带有界新事件摘要；不修改所有无关工具的返回值。默认每批最多 20 条摘要或约 2K token，详情按需展开。

### 6.3 任务状态规则

```text
open --claim(CAS)--> claimed --submit(CAS)--> proposed --集成通过--> done
                       |                        |
                       |                        +--集成拒绝--> claimed
                       +--release--> open
                       +--block--> blocked --unblock--> open
                       +--research_complete--> done（仅 research 任务）
open / claimed / blocked --cancel（授权 + CAS + 理由）--> cancelled
```

- release/block 清除 owner；unblock 要有新的输入或解决说明。
- research_complete 必须关联结果 Finding 和证据，不进入 Git 队列。
- code 任务没有“我说完成就 done”的操作；只能随 Proposal 接受而完成。
- 拒绝后的原 owner 继续修复；若要解除它的占有，用户先暂停 run，再用 owner 控制命令 `/swarm task release <id> --revision <n> --reason <text>` 释放。此命令只在 paused、该 worker 已静止、任务为 claimed 时有效；以 Run.ownerSessionId 验权，CAS 后把任务变 open 并清除 owner、追加带用户理由的事件。它不删除原 worktree、不丢弃未提交文件，也不自动移植旧代码。resume 后**任何已有 worker，包括原 owner**，都可用最新 revision 认领；release 只解除占有，不保证换人、不排除原 owner。v0.1 没有指定接管者或替换 worker 的命令。proposed 任务在暂停时先按 §8.4 中止候选、回到 claimed，才能释放。
- inactive、turn 结束和普通等待都不会自动释放 owner。v0.1 不做定时租约回收。
- FAIL 既可表示已证伪路径，也可表示未修复缺陷；只有后者关联 `blockingRepairTaskId`。旧 FAIL 的历史存在本身不阻止完成；关联修复任务必须 done，或按下述规则证明缺陷不存在/已由其他成果解决后 cancelled，才能不再阻塞。

**取消无效任务，不伪造完成：**Task 的另一种终态是 cancelled。发现任务重复、不需要或缺陷被证伪时，使用 `cancel`，而不是凑一个空 commit。

- 运行中：worker 可取消自己持有的 claimed 任务，或自己创建的 open/blocked 任务；都须带 expected_revision、非空理由和依据。不得取消别人拥有的任务。
- 暂停且资源静止后：原 owner 用户可用 `/swarm task cancel <id> --revision <n> --reason <text>` 取消任意 open/claimed/blocked 任务，包括 Host 创建的修复任务；这不删除文件。
- proposed 不可直接取消，先暂停并按 §8.4 中止 Proposal；done/cancelled 不再修改。以上操作均为 CAS，保留历史及理由，清除 owner。
- cancelled 只表示“不再需要这个工作项”，不表示用户需求被完成。不得用取消来豁免原始 acceptanceCriteria；finish 仍须逐项给出原始目标的证据，报告中列出所有取消理由。
- 完成条件从“每项都 done”变为“每项都 done 或有理由的 cancelled”。没有取消权限且无人推进的 blocked 任务必须请求用户决定，不能静默跳过。

## 7. 消息和等待：不用忙轮询，也不要求 exactly-once

### 7.1 读过与发过的区别

- Event.seq 是全 run 的序号。Finding/Task/Proposal 事件对全员可读；Message 正文只对作者和目标 worker 可见，其他 worker 看不到它。
- `offeredSeq`：已经连续**扫描**到的位置；该区间内对当前 worker 可见的事件全部提供了，不可见事件只是跳过。返回条目的 seq 可以有空洞，不能重新编号。
- `observedSeq`：worker 明确确认这个扫描前缀中的所有**可见**事件已读，不表示读过别人的私信。
- `swarm_sync(ack_seq)` 只能确认不超过 offeredSeq 的位置。分页返回 `throughSeq`、`hasMore`；遇到因页大小无法提供的下一条可见事件时停止扫描，不能越过它推进 cursor。
- 例：41 是可见 Finding，42 是发给其他人的私信，43 是可见 Finding；页大小只容纳一条时返回 41、throughSeq=42、hasMore=true。下一页必须从 43 开始，不返回 42 的正文。
- 只有事件正文/摘要实际进入模型可见结果，才更新对应的 offeredSeq；仅送“请同步至 N”的控制通知只更新 notifiedSeq，不能把 offeredSeq 跳到 N。
- 仅拉取页面不能声称模型已处理它；下一次确认才推进 observedSeq。条目有稳定 ID/seq，恢复时可以重复送达。目标是至少一次提供，不承诺模型恰好处理一次。
- 自主协作原型增加工具返回边界的旁路知识提示：只给当前 worker 附上它可见的同伴事件摘要，经原生 additionalContexts 正常落日志；不改变工具结果、offered/observed、等待登记或运行目标。提示内 seq 不是 ack cursor，正式确认仍须先 sync。提示去重只在当前 Agent 内存中保留，恢复可重复，完整记录仍通过 sync/read 获取。

### 7.2 确定性的唤醒匹配表

`waitRegistration` 保存 `afterSeq` 与 mode。未填 task_ids/proposal_ids 时 mode=any；填了至少一个非空 ID 列表时 mode=selected。**scope 不参与投递过滤**，它只是工作范围提示。

按下列顺序判断 seq > afterSeq 的事件是否满足等待：

| 事件 | any 模式 | selected 模式 |
|---|---|---|
| 发给自己的直接消息 | 总是匹配 | 总是匹配，不受 ID 列表限制 |
| 自己 Proposal 的接受/拒绝 | 总是匹配 | 总是匹配；事件由 Host 产生，不因原作者是自己而排除 |
| 自己发出的其他普通业务事件 | 不匹配 | 不匹配 |
| 其他 worker 的 Finding | 匹配 | 仅 Finding.taskId 在 task_ids 内时匹配 |
| Task 变为可领取 open | 匹配 | 仅 taskId 在 task_ids 内时匹配 |
| 指定 Task 的其他状态变化 | 不因普通状态变化自动唤醒 | taskId 在 task_ids 内时匹配 |
| 其他 Proposal 结果 / acceptedHead 更新 | 匹配 | 仅关联 proposalId 在 proposal_ids 内时匹配 |
| cursor 确认、等待登记、通知确认 | 不生成此类业务事件 | 不生成此类业务事件 |

没有等待登记的运行中 worker，通过下一次 Swarm 工具调用读取普通增量；直接消息可以走 steering。暂停/停止是控制状态，不通过唤醒模型落实。

any 模式允许一次真正的新发现唤醒多个等待者；“无自激广播”指同一事件不反复唤醒、自己产生的普通事件不唤醒自己、纯 bookkeeping 不生成新事件，而不是禁止有意义的一对多通知。

### 7.3 `swarm_wait` 的无丢失唤醒流程

假设 worker 最后读到 seq=42：

1. `swarm_wait(after_seq=42)` 中 after_seq 同时表示“我已读到这里”：必须满足 observedSeq ≤ after_seq ≤ offeredSeq，否则返回 `SWARM_INVALID_CURSOR`，不修改任何状态。合法时在同一次 run 更新中推进 observedSeq=after_seq、清除被覆盖的 pending、登记等待并检查 §7.2 的事件；它与 sync(ack_seq) 是两种明确的确认入口，不暗中截断非法 cursor。
2. 若 43 已经存在且匹配：返回新事件，不结束 turn。
3. 若不存在：保存等待位置；工具使用 DSH `exec.concludeTurn()` 让出当前 turn，不挂一个长时间占槽的工具调用。
4. 新业务事件落盘的同一次 run 更新中，给匹配等待者设置 `wakeTargetSeq=max(旧值,事件seq)`；这就是持久的 wakePending，不是丢进一个仅在内存里的通知。
5. Delivery 模块拥有 `Map<workerId, 串行 Promise 队列>`。一个 worker 的首次创建、冷恢复和通知发送都走同一条队列；不同 worker 的队列可以并行。队列只是单进程执行锁，不持久化。
6. 收尾信号是 `startActivation()` 返回的 `activation.result`，或已核验的 `subagent/end`（info.id 匹配 Session，info.runId 区分 activation）。**任一信号到达就足够，不等待两个都到达**；二者重复时用同一轮已收尾标记去重。监听器只入队，不在事件调用栈内同步启动 Agent。
7. 收尾后队列不能直接 sendMessage，必须先调用本文新增的内部辅助接口 `runtime.admitWorkerOperation(runId, workerId, kind)`。runtime 在控制门禁内检查 phase/预算，登记在途操作并返回取消信号；Delivery 才执行原生发送/冷恢复，finally 撤销登记。首次创建允许 preparing/running；普通通知/续跑只允许 running。被拒时保留事件、observedSeq 和 pending，不调用模型；paused 等明确 resume，终态永不再投递。
8. 门禁在 materialize/发送期间关闭时，由 runtime 取消并等待已经登记的操作和其发布的子会话；不能只依赖创建信号去停止已发布 Agent。控制门禁不包住长等待，Delivery 队列也不能绕过此登记路径。

**turn 与 activation 的实际关系：**`concludeTurn()` 只请求结束当前 turn，不直接 dispose activation。当前 DSH 本地子会话管理器在 Agent 活动、pending inbox 和子孙活动全部结束并完成 Session flush/清理后才结算 activation。冷恢复建立的新 activation 也由同一管理器结算并发出 `subagent/end`；向仍驻留的 activation 发消息可能只是增加 turn，**不是每条消息、每个 turn 都有独立 end**。没有新 activation handle 的续跑路径使用 end 事件，不等待旧的 result promise。

为使 Swarm 的等待能到达这个结算点：worker 禁止递归子 Agent；wait 前若还有本 Session 未结束的后台 job，返回 `SWARM_WORKER_BUSY`，要求先收集/结束它；Swarm 不用 inject 给已等待的 worker 堆 pending inbox。登记等待后，新的协作通知先留在 domain pending，等真实 settled 再发送，不继续给这个正在收尾的 activation 塞消息。如果登记前已有 steering，DSH 会先处理这些输入，收尾信号可能延后；不能把延后误报为已经结束。

### 7.4 cursor、pending 和恢复的关系

- `wakeTargetSeq` 表示需要提醒的事件上界；`notifiedSeq` 表示控制通知已经被 inbox 接受的上界。它们都不等于 observedSeq。
- 同一活跃 activation 内，`wakeTargetSeq <= notifiedSeq` 不重复发送同一通知；更新可以合并成一个“请同步至至少 N”的提示。
- sync(ack_seq) 或合法 wait(after_seq) 推进 observedSeq；确认覆盖 wakeTargetSeq 后清除该 pending。
- waitRegistration 的清除触发点是确定的：成功的 swarm_sync（即主动取消等待/重新决策）、成功的 Task claim、成功的 submit、成功受理 finish，均在本次更新中清除自己的登记；失败调用不清除。单纯 publish/read 不清除。因而无需新增 cancel_wait 工具，主动取消等待就是调用 swarm_sync；清登记不删除未读事件。新的 swarm_wait 会重建登记。
- 若 activation 结束而对应事件仍未确认，保留 pending；下一次允许的续跑可以重投同一 ID。连续两轮没有任何确认或业务进展则暂停报告，而非无限重投。
- 容量不足或恢复失败保留 pending，不推进 observedSeq；等待已知容量释放事件或明确 resume，不定时调用模型。
- 重启时丢弃所有内存队列，run 默认 paused。明确 resume 后重新创建队列，以持久 waitRegistration、observedSeq 和事件重算 pending；旧 notifiedSeq 不作为重启后已处理的证明。允许重复投递，不重复业务变更。

因此“43 在等待登记前到达”“43 在登记后、activation 收尾前到达”“43 在收尾后到达”三种时序都能处理。

### 7.5 DSH 父子消息限制的适配

通用 `subagents.sendMessage` 不是兄弟 Agent 总线。A→B 的正文先进入插件 Message 数据，作者记录为 A；runtime 通过 run 的真实 owner 向其直接子会话 B 发送“有未读事件，请同步”的控制通知，B 再读到带 A 身份的消息。

这是程序转运，不需要父模型阅读后再生成消息。不得把 A 伪装成 owner 调用，或声称这次传输的原生 sender 就是 A。活跃 worker 也可由受控 Agent.steer 投递插件来源的通知；冷恢复统一走 owner→child 路径。

owner 不在线或失去可用身份时，run 暂停，等待用户从原 owner Session 恢复；不偷偷创建无权限来源的新父 Agent。

正常 turn 无故结束但仍有它负责的工作时，runtime 可以发一次明确的协议提醒。没有新状态仍反复结束则暂停该 run 并报告，不能形成无限自我续跑。

## 8. 代码提交、集成与验证

### 8.1 提交的是不可变 SHA，不是“现在这个目录”

`swarm_submit` 验证任务归属、revision、worker 的仓库身份、sourceCommit 确实是其当前提交及工作树干净。把候选 SHA 固定到插件拥有的 proposal ref，后续 worker 改分支不会改变这次 Proposal。

提交只是进队列，不能直接推进 acceptedHead。worker 的本地测试是有用证据，但不能替代插件对组合结果的验证。

### 8.2 串行集成流程

设当前 acceptedHead=H，worker 提交 C：

1. 将 Proposal 置为 integrating，持久化 attempt 的 proposalId、expectedHead=H、sourceCommit=C。
2. 在插件专用集成 worktree 中以 H 构造候选，合并 C，得到不可变候选提交 M。result 分支仍指向 H。
3. 冲突：保存诊断，不推进 result，Proposal rejected，任务回到 claimed；让作者结合最新公共提交修复并重新提交。
4. 对 M 执行配置的 setup/test，收集实际退出码、超时/取消状态、日志引用以及验证配置指纹。命令改动 tracked 文件时不能把 M 算作已通过；需要重建并验证实际候选。
5. 验证失败：同样 rejected；H 不变。正常代码失败不等于整个 run failed。
6. 验证通过：先持久化 `validated(M,H,receipt)`。再进入 §8.4 的 publicationGate，重新检查 phase=running、当前 acceptedHead=H、预算未到期且候选未被中止；满足后才用 Git ref CAS 将 resultRef 从 H 改到 M。
7. 仍持有 publicationGate，在一次 domain 更新中写入 acceptedHead=M、Proposal accepted、Task done、结果事件，之后释放 gate。Git 与 domain 之间崩溃仍按 §8.3 恢复；进程内 stop 不能穿过这个临界区。
8. 其他 worker 收到的是 M 的 SHA；它们自行显式合入自己的分支。知识同步不自动修改文件。

resultRef 不在集成 worktree checkout，避免在一个活跃 checkout 背后更新其分支。集成 worktree 只用于候选；用户 checkout 完全不参与候选重置或合并。

只允许清理/重置经路径、Git 身份和 run 记录共同确认的插件专用集成工作区；不能把这些操作套到用户 checkout 或 worker 未提交成果上。

### 8.3 Git 和 domain 不是同一事务

恢复必须处理“Git 已推进，但 domain 还没记完成”：

| 恢复观察 | 处理 |
|---|---|
| resultRef 仍是 H，无论是否已有 validated M | 一律不发布旧候选；将未接受 Proposal 记 rejected（interrupted_before_publish），Task 回 claimed，保存现有凭据供诊断。resume 后作者须重新 submit |
| resultRef 已是 M，且持久 validated 记录精确匹配 M/H，Proposal 尚未收束 | 在一次 domain 更新中补齐 acceptedHead=M、Proposal accepted、Task done；这是记录已经发生的发布，不再次合并、不再次移动 ref |
| Proposal 已 accepted 且 domain/ref 都为 M | 无操作，不重复追加接受事件 |
| Proposal 已明确 rejected，却发现 resultRef=M，或 ref 是未知 SHA/缺少匹配凭据 | 保持暂停并报告不确定/外部修改；不覆盖、不猜成功 |

**统一规则：**崩溃与正常 pause/stop 都不自动续发“验证过但还没发布”的旧 M。唯一可以补齐的是 Git 已发布且有精确凭据的事实。

重启后先关闭 admission。核对旧执行资源已静止后，未终止 run 默认 paused；无法确认静止则保持 quiescing。paused 下允许读 Git 和按表修复 domain 事实，**不允许改 Git ref、运行测试或调用模型**，因此补齐 domain 不必先 resume。全部核对通过，用户明确 resume 后才恢复未完成工作。不能复活已 rejected 的 Proposal。

### 8.4 用户停止与发布如何排序

`runtime.ts` 为每个 run 持有一个进程内 `publicationGate`。以下两类短操作共用它：

- 发布临界区：重新检查 admission → Git ref CAS → domain 补齐 accepted 状态。
- 控制临界区：持久化 quiescing、目标终态和关闭 admission。

gate **不包住模型调用、构造候选或测试**。这些长操作可以取消。stop 请求刚到达不等于已经取得 gate；界面先显示“收到停止请求，正在处理”，控制临界区完成才算停止 admission 已生效。

| stop/pause 取得控制临界区时的情况 | result 与记录的明确结果 |
|---|---|
| Proposal 仍 queued，或正在合并/测试 | 中止它，result 不推进；Proposal→rejected，reason=interrupted_by_pause/stop/budget；Task→claimed，保留原 owner |
| validated M 已持久化，但发布临界区尚未取得 gate | 同上：即使测试通过也不发布。保存凭据供诊断，Proposal rejected；恢复后作者须重新 submit，不能自动续发这次 M |
| 发布临界区已经先持有 gate | 它先完成 ref CAS 和 domain 更新，或留下可核对的错误；控制请求随后关闭 admission。已接受的 M 和 done 任务保留，不回滚。对用户仍报告 stopped/paused，不因此改称 completed |
| Proposal 原本已 accepted | 保留 accepted 和 Task done，不撤销既有结果 |

所有 queued/integrating 且未接受的 Proposal 在完成 pause/stop 收尾前按表收束；只将尚 queued/running 的 Verification 记 interrupted；已经 passed 的记录保留为真实凭据，但不能绕过被拒的 Proposal 或停止门禁去发布。用户取消不伪造代码测试失败。若 ref 结果不确定，先按 §8.3 核对，无法确认则保持 quiescing 并给诊断，不假装已经停止成功。

这里的“停止后不能发布”精确定义为：**控制临界区持久关闭 admission 之后，不能再开始或完成一个尚未取得发布临界区的发布。** 请求到达前已经取得发布临界区的提交允许先完成，所以不会出现 Git 已接受但状态被强行退回 rejected 的矛盾。

首次创建/续跑也先在 runtime 的控制门禁中登记为在途操作，再执行可取消的 materialize。关闭 admission 后不得登记新操作；已登记的启动必须取消并等待收尾，才可确认 paused/stopped。publicationGate 不替代每个 worker 自己的串行队列。

### 8.5 acceptedHead 没有验证记录时如何补验证

`Verification` 是独立于 Proposal 的记录，由 `integration.ts` 执行，共用同一个集成工作区串行队列：

- `purpose=proposal`：验证候选 M，有 proposalId；通过后才可能发布。
- `purpose=finish`：验证当前 acceptedHead=H，没有 proposalId，不创建假 Proposal、不移动 resultRef、不将任何 code Task 凭空标 done。

`swarm_finish` 的结构条件满足，但 H 没有成功记录时，Host 原子保存 finishRequest、创建 `Verification(purpose=finish, commit=H, status=queued)` 并进入 draining。工具返回“正在验证，verificationId=…”后让出 turn。integration.ts 在专用集成工作区 checkout H，执行固定 setup/test。

- 通过：Verification→passed；Host 重新核对 finishRequest 仍有效、H 未变、没有 stop/pause，随后进入 quiescing 收尾。
- 失败：Verification→failed；清除 finishRequest；原子创建一个 open 的 code 修复任务（主题为“修复 H 的最终验证失败”，验收是失败命令通过，附真实诊断），追加关联 FAIL，phase 回 running。任务事件唤醒 worker；修复集成后需重新提出 finish。
- 用户暂停/停止或预算到期：Verification→interrupted，清除 finishRequest，按控制请求收尾；不创建虚假的代码缺陷任务。
- 明确恢复后若仍缺记录：再次提出 finish 时新建一次 finish Verification，不自动复活已经 interrupted 的验证。

例如全程只有 research 任务、无需改代码时，H 可以等于 baseCommit。以上独立验证路径保证这类 run 仍可检查原代码并完成，不需要伪造一个代码提交。

## 9. DSH 接口接线与实现注意事项

下表是已在 DSH 0.2.1-rc.4 安装版核对的现有能力。它们不是全部自动组合好的 Swarm 功能。

| 现有能力 | 本插件如何使用 | 实际限制（均为直接陈述） |
|---|---|---|
| `subagents.startActivation(spec)` | 指定 childId、spawn、parent、cwd、agentPreset，首轮用 caller delivery | 创建信号只管未发布阶段；已发布工作须显式停止 |
| `subagents.sendMessage(owner, childId, ...)` | 控制通知、启动/冷恢复原 worker | 只支持相邻父子；收件成功不代表模型已处理 |
| `subagents.drainChildren(owner, ids)` | 仅停止并等待本 run 的子会话 | 不得 drain owner 的无关子会话 |
| `activation.result` / `subagent/end` | 观察 activation 收尾并推进 Delivery 队列 | 不是整个 Swarm run 成功的信号 |
| `agent/created`（serial） | 模型开始前准备工作树、工具、策略 | 监听器内不能等待该 Agent 自己 idle |
| `worktrees.create(agent, request)` | 创建并进入独立 checkout | 会切调用者 cwd；不会复制未提交文件 |
| `workingDirectory.set(agent, path)` | 初始化期间恢复源 cwd，再进入正确 worker cwd | 只操作初始化中的 worker，不改变用户 Agent cwd |
| `exec.concludeTurn()` | wait 工具让出 turn | 不完成 run 或 Task |
| `agent.inject()` | 添加下一步可读上下文 | **不会唤醒 Agent，包括空闲 Agent；空闲时只是排入待处理上下文** |
| `agent.steer()` / `followup()` | 提供 step/turn 输入并唤醒 Agent | 生效于模型边界，不抢占任意 OS 进程 |
| `storageDomain` 的 table.update | 单记录的串行持久变更 | 没有跨进程事务或跨表事务 |
| `jobs.list/kill/wait` | 只处理匹配 worker Session ID 的后台作业 | kill 只请求取消，还须等待静止 |
| `subprocess` 句柄 | 跟踪集成命令、取消并确认退出 | 原始 spawn 不自动提供完整 sandbox/approval 策略 |
| `sessionProjections` | 统计现有日志中的 usage/turn/tool 事实 | 不允许借此发明未知 SessionEvent |

Git 和验证执行适配器要显式使用当前 DSH sandbox/permission 组合，不能直接用 Node child_process 绕过。若权限不允许，暂停并报告；不得从 worker 内扩大权限。具体类型以当前运行时 Inspect 和安装包 declarations 为准，本文伪类型不替代类型检查。

注册、监听器、timer 和 Agent 句柄都由插件/Agent 的 Cordis effect 负责释放。Host 卸载时先关闭 admission，再停止本 run 的资源。

## 10. 完成、暂停、停止和预算

### 10.1 run 状态与完整转换表

| 当前状态 | 触发条件 | 下一状态 / 动作 |
|---|---|---|
| preparing | 首个 worker 与公共 Git 布局已准备好 | running；其他预留 worker 可继续初始化 |
| running | finish 结构条件满足 | draining；冻结 worker 新业务写入，核验最终提交 |
| draining | 最终验证失败或完成条件有缺口 | running；返回缺口或建立 §8.5 的修复任务 |
| draining | 完成条件满足 | quiescing，target=completed |
| preparing/running/draining | 用户 pause | 通过控制门禁进入 quiescing，target=paused |
| preparing/running/draining | 用户 stop 或活动预算到期 | quiescing，target=stopped，记录原因 |
| preparing/running/draining | 无法继续的基础设施错误 | quiescing，target=failed |
| quiescing | 又收到控制请求或预算到期 | 按下述优先级更新 target，不重新启动工作 |
| quiescing | 资源与 Git 状态核对完毕且已静止 | 进入 target 对应的 paused/stopped/failed/completed |
| paused | 原 owner 明确 resume，身份/代码/资源核对成功且预算有效 | running；重建队列，恢复未完成任务 |
| paused | 截止时间经过 | 保持 paused，标记预算过期；resume 必须明确追加预算 |
| paused | 用户 stop | stopped；记录用户停止 |
| completed/stopped/failed | 任何 resume | 拒绝：这些是终态。若要继续，以 acceptedHead 新建 run |

quiescing 期间的 target 优先级从高到低：**用户 stop > 基础设施失败 > 活动预算耗尽 > 用户 pause > completed**。例如完成收尾中用户 stop，会得到 stopped 而不是 completed；暂停收尾还没结束就预算到期，得到 stopped。终态已提交后不被迟到的控制请求改写。

`quiescing` 表示还在停进程，不能宣称已全部停止。若无法确认静止，保留这个状态和诊断，不跳到任何目标终态。普通候选测试失败只会拒绝 Proposal，不触发 failed。paused 不运行模型、测试或截止 timer，但绝对 deadline 数值不会冻结。

### 10.2 成功不是由“空闲”推断出来的

任意 worker 可调用 `swarm_finish`。分成“受理提议”与“最终成功”两阶段，不在工具内同步等待自身停止。

**受理条件：**提议引用当前 acceptedHead，逐条对应原始 acceptanceCriteria 并给出证据；所有预定 worker 已完成初始化；所有 Task 都 done 或按 §6.3 有理由地 cancelled；没有未处理 Proposal、未解决的有效缺陷或在途启动。Host 在一次 run 更新中保存 finishRequest 并进入 draining，与其他写入决定明确先后。条件不足就返回具体缺口，仍为 running。取消任务不减少需要回答的原始 acceptanceCriteria。

**受理后：**若当前 acceptedHead 有匹配 verificationConfig 的成功记录，则复用；没有则按 §8.5 创建独立 finish Verification，保持 draining。worker 工具收到“已受理/正在验证”后让出 turn，不是收到“成功”。验证失败按 §8.5 返回 running 并建立修复工作。

**最终成功条件：**验证通过、finishRequest 未被 stop/pause 取消、acceptedHead 未变、资源与 Git 状态核对完毕且静止。经过 quiescing 才写 completed 并交付。阶段转换检查 §10.1 的控制请求优先级。

**并发与重复 finish：**running 时先成功原子更新的请求获受理，返回 `{status: 'accepted', finishRequestId, verificationId?}`。draining 中后到且引用同一 acceptedHead 的 finish 只返回 `{status: 'already_finishing', finishRequestId, verificationId?}`，不覆盖说明、不启动第二次验证；引用旧 SHA 则返回 `SWARM_STALE_HEAD`。draining 中普通 submit/task 写入返回 `SWARM_NOT_RUNNING`，不产生副作用。completed 下重复 finish 只读返回已有最终报告；paused/quiescing/stopped/failed 下拒绝新 finish。

Host 可以检查这些结构条件，但验收说明的语义仍由 worker 和用户判断；测试通过不证明任意自然语言目标绝对正确。

### 10.3 暂停/停止顺序

按 §8.4 取得控制门禁并持久化关闭新任务、启动、唤醒和发布入口；再取消本 run 的未完成启动、worker、集成进程及其拥有的后台 jobs。未接受 Proposal 按 §8.4 回到 rejected/claimed，finish Verification 按 §8.5 记 interrupted；等待收尾和核对后才确认 paused/stopped。控制请求中断时不得顺手停止用户其他子会话或任务。

停止由控制面驱动，不能在某个 worker 工具调用中同步等待该 worker 自己销毁，造成自等待。finish 工具先返回/让出，最终停止在独立控制流程执行。

超时无法确认进程退出时保留工作树，报告 quiescence 未完成，不宣称已完全停止或安全删除。禁止自行创建未受管的持久服务；对超出 DSH 管理范围的任意外部进程不作绝对停止保证。

预算耗尽走 stopped，reason=budget_exhausted，交付当前已接受结果和未完成列表。暂停不释放任务，恢复前核对 owner、Session、worktree、Git refs 与未完成集成尝试。

### 10.4 故障分类：不让实现者猜重试次数

| 情况 | v0.1 的处理 |
|---|---|
| 普通工具返回错误、编译/测试不通过 | 保留为当前 worker 可见的反馈；由它修复，run 不因此 failed |
| 模型请求瞬态错误 | 仅复用 DSH 已配置的原生请求重试；插件不叠加自己的重试循环 |
| DSH 最终把 worker activation 结束为 error/拒绝/无法恢复 Session | 暂停整个 run，停止其他工作并保留任务；由用户检查后明确 resume，同一 Session 再试。不自动替换 worker |
| 普通 turn 无进展结束 | 沿用 §7 的一次提醒/连续无进展暂停规则 |
| 存储不可写、仓库身份错乱、初始化失败等无法安全继续 | 关闭 admission，停止后 failed；若无法确认停止则保持 quiescing 给诊断 |

如果所有 worker 都等待而没有人提出 finish，Host 不从空闲推断成功，也不自动找一个经理模型；可由用户介入，否则到 deadline 按 budget_exhausted 停止。stopped/failed 报告包含原因、当前 acceptedHead/resultRef、可用 diff/验证记录及未完成事项，明确没有通过整体目标验收。

终态之后所谓“以 acceptedHead 新建 run”就是普通的新 start：用户重新提供完整 spec，不自动继承任何旧目标、验收、任务、消息或 deadline。用户可复制旧 spec 并显式把 baseRef 改为旧 acceptedHead；新 run 的预算从新启动时间计算。

## 11. 一个从头到尾的例子

目标：为一个项目增加 CSV 导入和对应 CLI，项目验收命令为 `npm test`。

1. 从 H0 创建两个 worker worktree 和一个集成 worktree；result=H0。
2. A 自己创建并认领 T1“CSV 解析”；B 自己创建并认领 T2“CLI 接入”。没有经理分派这两个任务。
3. A 发布 F1：解析函数返回 `Row[]`，错误通过异常报告，附接口位置。B 读取该摘要，用它实现 CLI。
4. B 在等待解析实现时调用 wait。如果 A 恰在 B 结束 turn 前发布结果，wakePending 会保留它，收尾后再唤醒 B。
5. A 提交 C1，T1=proposed；队列构造候选 M1，测试通过，result 从 H0 推到 M1，T1=done。
6. B 通过 sync 看见 acceptedHead=M1；再自行把 M1 合入自己的分支，不是 sync 工具替它改文件。
7. B 提交 C2。若组合测试失败，result 仍是 M1，T2 回到 claimed；B 收到实际失败日志后修复重提 C3。
8. 新候选 M2 通过验证，result=M2，T2=done。
9. A 或 B 提交 finish，说明两条用户验收项如何满足。Host 检查条件，停止工作，报告 M2、diff 和测试记录。
10. 用户决定是否把结果分支合入自己的主分支；插件没有修改用户原 checkout 的 tracked 文件或 index。

F1 如果有误，B 追加 FAIL 并建立修复任务；不覆盖 F1，更不把它当作不可质疑的全局事实。

## 12. 工程交付与开发顺序

### 12.1 拟提供的用户入口

以下命令尚未实现，语法是产品目标，不是现在可以运行的命令：

```text
/swarm start --spec ./swarm-run.json
/swarm status [--details]
/swarm pause
/swarm resume [--budget 追加时长，例如 30m]
/swarm stop
/swarm task release <task-id> --revision <n> --reason <说明>
/swarm task cancel <task-id> --revision <n> --reason <说明>
```

首版**只实现 JSON spec 启动方式**，不同时实现表单或多套简写。spec 路径相对用户 owner 的 cwd 解析；其中 repository 相对 spec 所在目录解析。示例（不是已存在的配置文件）：

```json
{
  "repository": ".",
  "baseRef": "HEAD",
  "goal": "为项目增加 CSV 导入和对应 CLI",
  "acceptanceCriteria": ["CSV 导入结果正确", "CLI 可调用导入并报告错误"],
  "workers": 2,
  "allowDirtyBaseline": false,
  "verification": {
    "setup": [{"argv": ["npm", "ci"], "timeoutMs": 300000}],
    "test": [{"argv": ["npm", "test"], "timeoutMs": 300000}]
  }
}
```

上述顶层字段均须显式提供；可选 budgetMinutes 省略时不限时，只有用户要求限时才填写正整数分钟。setup 可为空数组，test 必须非空；命令使用 argv 数组且 timeoutMs 为正整数。命令 cwd 由插件固定为待验证 worktree，不从 worker 消息取得。worker 模型路由默认继承原 owner 当前模型，独立 preset 决定其工具。

start 将 baseRef 解析为一次固定的本地 baseCommit SHA；后续 HEAD 变化不改变基线。`allowDirtyBaseline=false` 时脏工作区拒绝；用户明确设置 true 才表示接受“忽略所有未提交改动、仅从提交创建”，启动回执必须重复显示这条边界。验证失败或必填项缺失直接返回字段诊断，不调用模型猜配置。

`resume` 只针对 paused；追加预算把新 deadline 设为当前时间加指定时长，不复活 stopped。`task release/cancel` 是原 owner 用户入口，只在 paused 且资源静止时可用，精确规则见 §6.3。

**status 的最小输出契约：**摘要必须有 runId、phase/reason/quiesceTarget、deadline/是否过期、baseCommit、acceptedHead/resultRef、各任务状态计数（含 cancelled）、各 worker 的实际 running/inactive/不可用状态与当前任务、当前 Proposal/Verification 和诊断摘要。`--details` 另列每 worker 的 waitRegistration、observed/offered/wakeTarget/notified 序号、在途启动、当前 admission、集成 attempt、实际 resultRef SHA 与 domain 是否一致、拥有的后台 jobs 状态和日志引用。列表每页最多 20 项，超出给分页入口；不输出完整聊天或无限日志。

status 的“不可用”是插件诊断标签（例如 provider 缺失、Session 缺失或最近恢复失败），不是伪造的 DSH 原生 Agent 状态。status 只读事实，不触发模型、测试或修复；正常暂停与崩溃核对的诊断必须标明，不把“停止请求已收到”显示成“已停止”。

v0.1 的交付包括 bundle manifest、Cordis patch、Host 模块、worker preset、工具说明、测试、英文/中文插件元数据和原创或合规图标。通过 `plugin_manager install_bundle` 安装，不手改用户 profile。

第一版 UI 可以只有命令和文本状态；后续通过 DSH `conversation.view` 添加只读 Swarm 看板，不起独立 Web 服务器。

#### 12.1.1 v0.2 看板增量：可视性与即时性

- 整体展示目标、run 阶段、任务状态计数、集成/验证流程、结果 ref/SHA；工作流中的协作与验证可并行，不伪造单一线性完成百分比。
- 每个 worker 展示当前有效任务、原生状态、等待协作或等待集成，以及从原生 Session 事件派生的有界工具调用状态。inactive 不是完成；调用返回也不是整个任务完成。done/cancelled 的历史任务不能标为当前工作。
- 工具活动由宿主 sessionProjections 增量派生；只展示名称、状态和时间，不转发工具参数/结果、命令正文或推理。任务板和最近公开状态事件有固定条数上限，显示截断信息。
- 进度流（snapshot/watch，含 `interactions`）只带私信与 finding 的元数据（谁、对谁、何时、类型）。正文只通过单独的按需接口 `swarmProgress/conversation(sessionId, beforeSeq)` 提供给 run owner：Host 双重校验调用会话就是 run 的 `ownerSessionId`，分页、有界并标注截断。worker 之间的可见性规则不变，worker 不能通过这个接口读别人的私信。
- 看板订阅以 owner 会话为生命周期，run 终态之后仍可接收同 owner 的下一次 run。旧的单 run watch 语义可保留；新增持续订阅必须在面板卸载、会话切换、取消或插件卸载时清理，不驱动模型。
- 底层只监听持久状态和相关 worker 投影变化，不轮询 Agent。预算倒计时在 Client 本地更新；没有新帧不等于断线，流结束或错误则明确显示非实时、保留最后快照并提供重新连接。
- 旧 Host 不具备新能力时明确标示并保留可用摘要，不把权限拒绝或网络错误吞为降级成功。部署生效与单测分开验收，新 Host 模块要求重启时如实报告。

### 12.2 四个有验收结果的阶段

| 阶段 | 要交付 | 通过标准 |
|---|---|---|
| M1 原生运行骨架 | bundle/preset、run、2 worker、worktree、停止 | 第一次模型调用前完成隔离；owner cwd/index 不变；停止不产生后续模型调用 |
| M2 协作闭环 | CAS 任务、知识、消息、增量、等待唤醒 | 认领竞争仅一个成功；分页无缺口；三种等待竞态均被唤醒；无自激广播 |
| M3 代码交付闭环 | Proposal、集成、验证、finish | 只有通过的组合提交推进 result；失败交回作者；一个真实双 worker 编码任务产出结果分支 |
| M4 恢复与观察 | 重启默认暂停、明确 resume、预算、状态视图 | 不重建重复 worker/worktree；不重复接受已集成提交；原目标和预算语义保持 |

M1/M2 是里程碑，不代表插件已经满足最终交付。至少 M1–M3 跑通才可称“能工作的 Swarm”；声明支持恢复之前必须通过 M4。

### 12.3 必须写的测试

1. 两个 worker 以同一 revision claim 同一 Task：一个成功，一个得到 stale/claimed 错误。
2. 旧 owner 在任务 release/reclaim 后提交旧 revision：拒绝，不修改代码集成状态。
3. worker 只结束 turn 或显示 inactive：不自动完成/释放 Task。
4. wait 前、登记后收尾前、收尾后三种发布时序：都不丢唤醒；重复通知不并发恢复两次。
5. 超过一页事件：cursor 不跳过中间未提供内容；消息重复送达不重复业务 mutation。
6. worktree 初始化失败：owner cwd 不变，不删除未知目录，不复用不确定的部分产物。
7. A 和 B 分别本地测试通过，但组合候选测试失败：result 不推进。
8. 合并冲突：Host 不调用经理 LLM 自动改代码，返回诊断，作者修复。
9. Git ref 已推进、domain 未更新就重启：匹配 validated 记录后补齐一次，不重复合并。
10. resultRef 被外部改到未知 SHA：暂停，不强行覆盖。
11. pause/stop 与 wake/submit/测试结束同时发生：分别测试控制门禁先取得、发布临界区先取得；按 §8.4 检查 result、Proposal、Task，确认停止后无新唤醒。
12. 没任务但没有完整验收/有效最终验证：不能 completed；只有 research 任务时能通过 purpose=finish 补验证，失败会生成真实修复任务。
13. 活动 deadline 到达：stopped 而非 completed；paused 过期则保持 paused，明确追加预算才恢复；stopped 拒绝 resume。
14. 原始用户文件、index、当前分支不被候选构造和失败清理改变。
15. 暂停后 owner 用正确 revision 释放 claimed 任务，resume 后别的 worker 可以领取；运行中或过期 revision 的释放请求拒绝。
16. any/selected 两种等待按 §7.2 的表匹配；同一事件和 bookkeeping 不形成通知循环。
17. 空闲 Agent 收到 inject 仍为空闲，随后 steer/followup 才能启动；不把注入和唤醒混为一谈。
18. 无效任务按授权 CAS 取消后不再阻塞 finish，但原始验收项仍必须有证据；release 后原 owner 用新 revision 可以重新认领。
19. 私信过滤造成全局 seq 空洞时，分页不泄露正文、不跳过下一条可见事件；控制通知不能推进 offeredSeq。
20. 两个 finish 并发只生成一个 finishRequest/最终验证；draining 下新 submit 返回无副作用错误。
21. 崩溃时 ref 仍 H 的 validated M 必须拒绝重提；ref 已 M 且精确凭据匹配时允许 paused 下只补 domain、不重发 Git。
22. wait 的 after_seq 越界无副作用拒绝；合法值推进 observedSeq；sync/claim 后旧 waitRegistration 被清除；存在活跃 job 时不能以 wait 遗弃工作。
23. activation 的 result 或 end 任一信号足以结算，重复信号不双重恢复；同一驻留 activation 多个 turn 不期待每个 turn 都发 end。
24. Proposal 提交后公共分支又前进时，Verification.expectedHead 记录实际集成基线，而不是提交时旧快照；历史 attempt 不被覆盖。

先用 fake Agent 和临时 Git 仓库做确定性测试；再做真实模型的端到端测试。模型说“看懂/完成了”不能替代这些实现测试。

## 13. 实现者接手时的核验入口

本文固定的是业务架构。实现前用当前 DSH Inspect 确认确切签名和配置：先 `cordis_inspect_list`，再查 Service、Event、Config；不要把工具调用名当成插件内部 Service API。

本方案 API 核验基线是 2026-10-27 的 DSH 0.2.1-rc.4；升级后尤其复核 experimental worktree、preset 挂载、子会话续跑和权限组合。确切 TypeScript import、schema 写法、工具输出渲染等是编码阶段核验事项，不要求读者凭本文伪类型猜出。

公开参考：

- [Agensh 论文：协作循环与基础设施](https://arxiv.org/html/2609.26781v1#S2)
- [Agensh 事件路由实现说明](https://github.com/microsoft/Agensh/blob/main/mini-router/README.md)
- [Agensh 共享 context 实现说明](https://github.com/microsoft/Agensh/blob/main/board-service/README.md)
- [DeLM v3：共享 context 与独占任务认领](https://arxiv.org/html/2606.10662v3#S2)
- [DeLM 产品插件：产品化协作与交付参考](https://github.com/Decentralized-LM/delm-agent-plugin/blob/main/docs/architecture.md)

最后一句：**这是“多个 worker 自主工作，普通程序保证协作与交付边界”的插件，不是“一个经理模型让几个子模型分别回答，然后拼接答案”。**
