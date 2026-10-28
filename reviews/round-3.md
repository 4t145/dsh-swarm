# Round 3 冷读评审：DSH Swarm v0.1 架构文档

> 本评审为一次独立冷读。作者未提供任何口头补充，评审者不读取历史评审、不联网、不读其他仓库文档，只以 `ARCHITECTURE.md` 为唯一依据。凡本文档未写明而评审者自行推断的地方，下文都会标注“推断”。

## 1. 评审记录

| 项 | 值 |
|---|---|
| 被评审文件 | `../ARCHITECTURE.md` |
| 文档修订号 | **R3 · 2026-10-27**（正文第 3 行；自称“待实现的架构规格，不是已实现功能说明”） |
| 文档规模 | 640 行，14 个一级章节（§0–§13） |
| 使用模型 | deepseek-v4.1-flash-1017（DSH 会话） |
| 实际读取范围 | `ARCHITECTURE.md` 全文，分两段读完：第 1–613 行、第 614–640 行，无截断残留、无跳读 |
| 未读取 | `reviews/README.md`、`round-1.md`、`round-2.md` 及任何其他文件；未检索网络；未运行任何 DSH Inspect 查询去“补背景” |
| 结论先行 | **NEEDS_REVISION**，理解信心 **78/100**（详见 §7） |

说明：本次只读了目录列表（确认 `reviews/` 下存在 round-1/round-2 两个文件），未打开其内容，不构成背景输入。

## 2. 用不超过 250 字复述：系统要做什么

DSH 插件：用户给编码目标，单机拉起 2–4 个对等 worker，各有子会话与 worktree。没有经理 LLM——**worker 自己决定做什么**：读目标、自提任务、CAS 抢占、自行实现、发布发现、消息协商，做完提交不可变 commit。**程序只守边界**：Host 管 run 状态机、revision、seq、预算与停启；Delivery 管增量投递与唤醒去重；集成队列串行合并并跑验证，通过才推进 result。**交付 result SHA、diff、验证记录与逐条验收说明**，不动用户工作区。

## 3. 一次 run 的端到端时序（含两条传播链）

### 3.1 主时序

| 步 | 发生什么 | 依据 | run 状态 |
|---|---|---|---|
| 0 用户输入 spec | goal、acceptanceCriteria、repository、baseRef、workers(2–4)、budgetMinutes、allowDirtyBaseline、verification.setup/test（argv+timeoutMs，test 非空）。脏工作区默认拒绝，或用户显式 `allowDirtyBaseline=true` 且回执重复声明“未提交内容不进入 worker”。baseRef 被解析成**一次性固定的 baseCommit SHA** | §5.1、§12.1 | — |
| 1 落盘与预埋 | 一个 `table.update` 写 Run 聚合记录、为每个 worker 预留 Session ID、注册只匹配这些 ID 的初始化监听器 | §5.3.1、§4.1 | `preparing` |
| 2 materialize | `subagents.startActivation(spawn, preset=swarm-worker, delivery='caller')`；`agent/created`（串行、会被等待）里创建 worktree 并把 worker cwd 切过去；第一个 worker 顺带建集成 worktree，再把 cwd 切回源仓库建自己的；`resultRef → baseCommit`；初始化数据落盘后放行第一个 worker | §5.3.2–6、§9 表 | `preparing` |
| 3 工作循环 | 每个 worker 独立跑：读目标+增量 → 自建或 CAS 认领任务 → 实施 → 发 Finding → 本地检查 → commit → `swarm_submit` | §6.1、§2、§6.3 | 首个 worker 就绪即 `running` |
| 4 集成 | 串行队列：`integrating` → 集成 worktree 以 H 为基合并 C 得候选 M → 冲突/测试失败则 `rejected`、Task 回 `claimed`；通过则先持久化 `validated(M,H,receipt)` | §8.1、§8.2.1–5 | `running` |
| 5 发布临界区 | 持 `publicationGate`：复查 admission/phase/acceptedHead/预算/未中止 → **Git ref CAS H→M** → 同一门内一次 domain 更新写 `acceptedHead=M`、Proposal `accepted`、Task `done` | §8.2.6–7、§8.4 | `running` |
| 6 传播 | 见 §3.2 | §8.2.8、§7 | `running` |
| 7 finish 受理 | 任一 worker `swarm_finish`：结构条件（引用当前 acceptedHead、逐条对应原始 acceptanceCriteria、全 worker 已初始化、所有 Task done 或有理由 cancelled、无未处理 Proposal/有效缺陷/在途启动）→ 原子写 `finishRequest` 并转 `draining` | §10.2、§6.2 | `running`→`draining` |
| 8 最终验证 | acceptedHead 有匹配配置的成功记录则复用，否则建 `Verification(purpose=finish, commit=H, queued)`，在集成 worktree checkout H 跑 setup/test | §10.2、§8.5 | `draining` |
| 9 收尾 | 通过 → 复查 finishRequest 仍有效/H 未变/无 stop-pause → `quiescing`（target=completed）→ 关 admission、停模型与集成进程、核对资源与 Git 静止 → 写 `completed` 并交付 | §10.1、§10.2、§10.3 | `quiescing`→`completed` |

### 3.2 两条传播链必须分开看

**知识传播**（便宜、自动可见、无人改文件）：

```
业务变更发生 → 同一次 table.update 内改写对象 + 增 revision + 追加 Event + 增 seq
   → 事件对全员可读（Message 正文只对作者+目标可见）
   → Delivery 按 §7.2 匹配表决定是否命中某个 waitRegistration
   → 命中则 wakeTargetSeq 升到该 seq（持久 wakePending）
   → worker 串行队列在 activation 收尾后发 owner→child 控制通知
   → worker 调 swarm_sync/read，正文摘要真正进入模型可见结果才推 offeredSeq
   → 显式 ack 才推 observedSeq
```

关键点：sync/唤醒**不执行 git pull**（§6.2 `swarm_sync`）；worker 看到 `acceptedHead=M` 之后必须**自己**把 M 显式合进自己的干净分支（§6.1.8、§8.2.8、§11 第 6 步）。私信走“插件 Message 数据 + owner→child 控制通知”的转运，不是兄弟 Agent 总线，也不得把 A 伪装成 owner（§7.5）。

**代码传播**（昂贵、串行、必须过验证）：

```
worker 分支 commit C → 固定到插件拥有的 proposal ref（此后 worker 再改分支不影响该 Proposal）
   → 集成 worktree 以 acceptedHead=H 造候选 M（result 分支仍指 H）
   → setup/test → validated(M,H) → publicationGate → ref CAS → acceptedHead=M
```

两条链的交汇点是 **acceptedHead 这一个 SHA**：它就是“代码链”的唯一对外事实，“知识链”只负责把这个事实送达。§4.3 明确要求不能把 Task.revision、Event.seq、Git SHA 三者混用。

### 3.3 状态语义

| 状态 | 含义 | 允许什么 |
|---|---|---|
| `preparing` | 公共 Git 布局与首个 worker 正在就绪 | 可 pause/stop/failed |
| `running` | 正常工作，worker 可写业务数据 | 全部业务操作 |
| `draining` | finish 已受理，**冻结 worker 新业务写入**，核验最终提交 | 只读；submit/task 写返回 `SWARM_NOT_RUNNING` |
| `quiescing` | **正在停**，不能宣称已停 | 只做核对；无法确认静止就留在此态并给诊断 |
| `completed` | 成功终态，已交付 | 只读，重复 finish 返回既有报告 |
| `paused` | 用户暂停，资源已静止；deadline 数值继续走但**不因时间自动转 stopped** | 允许读 Git、按 §8.3 补 domain 事实；禁止改 ref/跑测试/调模型 |
| `stopped` | 用户停止或预算耗尽（`reason=budget_exhausted`） | 终态，拒绝 resume；以 acceptedHead 新建 run |
| `failed` | 基础设施不可继续 | 终态 |

任务子状态：`open → claimed →(submit)→ proposed →(接受)→ done`，拒绝回 `claimed`；另有 `blocked`、`cancelled`。`code` 任务只能随 Proposal 接受而 done，`research` 任务可 `research_complete`（须挂 Finding+证据，不进 Git 队列）。Proposal：`queued → integrating → accepted | rejected`。Verification：`queued|running|passed|failed|interrupted`。

## 4. 情景题（每题给依据章节）

### a. 两个 worker 用同一 revision 领取同一任务

`§6.3 状态图`+`§2 差异 1`+`§4.3`：`open --claim(CAS)--> claimed`。CAS 比对 `expectedRevision`，只有一方成功；另一方因 revision 已变而失败，返回 stale/claimed 错误（`§12.3 测试 1` 明确“一个成功，一个得到 stale/claimed 错误”）。**不产生锁、不产生第二个 owner**；文档强调的是“任务认领 ≠ 文件加锁”（`§0` 第 2 条），范围重叠仍需 worker 之间发消息协商（`§6.1.5`）。

### b. worker inactive 但还持有任务

`§6.3`：“inactive、turn 结束和普通等待都不会自动释放 owner。v0.1 不做定时租约回收。”所以任务**继续归它**，run 不会因此推进或完成（`§0` 第 1 条）。

解除占有：**用户**先 `pause`（使 run 进入 paused 且资源静止），再执行
`/swarm task release <id> --revision <n> --reason <text>`。
生效条件（`§6.3`、`§12.1`）：仅在 paused、该 worker 已静止、任务为 `claimed` 时有效；以 `Run.ownerSessionId` 验权；CAS 后置 `open`、清 owner、追加带用户理由的事件。它**不删 worktree、不丢未提交文件、不移植旧代码**。resume 后任何已有 worker（含原 owner）都可用最新 revision 认领——release 只解除占有，不指定接管者，v0.1 也没有替换 worker 的命令。若任务是 `proposed`，必须先按 `§8.4` 中止候选回到 `claimed` 才能释放。

### c. 读到 42 后登记等待，43 在 turn 结束前到达

`§7.3`：`swarm_wait(after_seq=42)` 在**同一次 run 原子更新**里完成“确认读取位置 + 登记 waitRegistration + 按 §7.2 查事件”。若 43 不存在，保存等待位置并 `exec.concludeTurn()` 让出 turn（不挂长工具调用）。随后 43 落盘时，**同一次更新**给匹配等待者设 `wakeTargetSeq=max(旧值, 43)`，这是持久 wakePending。

- **如何观测收尾**：`activation.result` 已 settled **且**收到 `subagent/end`（用 `info.id` 匹配 Session、`info.runId` 去重）；`turn/end` 与 inactive **都不是**同等证据。用户侧观测入口是 `status --details` 里的 `waitRegistration`、`observed/offered/wakeTarget/notified` 序号与 admission/在途启动字段（`§12.1`）。
- **如何避免双重恢复**：每个 worker 一条串行 Promise 队列（首次创建、冷恢复、通知发送共用）；初始 result promise 与 end 事件可能各通知一次，用同一轮“已收尾标记”合并；**收尾完成且 run 仍允许启动之后**才发 owner→child 续跑通知；同一 activation 内 `wakeTargetSeq <= notifiedSeq` 不重发（`§7.3.5–7`、`§7.4`）。

因此 43 落在“登记前／登记后收尾前／收尾后”三种时序都不丢唤醒，且不并发恢复两次（`§7.4` 末、`§12.3 测试 4`、`§11` 第 4 步是同一情形的例子）。

### d. 本地检查通过但组合代码测试失败

`§8.1`（“worker 的本地测试是有用证据，但不能替代插件对组合结果的验证”）、`§8.2.5`、`§11` 第 7 步。状态变化：

| 对象 | 变化 |
|---|---|
| `resultRef` / `acceptedHead` | **不动**，仍为 H |
| Proposal | `integrating → rejected`，带 `diagnosticsRef` |
| Task | `proposed → claimed`（原 owner 继续修复） |
| Verification(purpose=proposal) | `failed`（记录真实退出码/超时/配置指纹） |
| run.phase | **仍 `running`**，不 failed（`§10.4`：普通测试不通过只是 worker 可见反馈） |

worker 收到实际失败日志后修复并重提（C3）。候选 M 被丢弃，不发布会话外的旧 M（`§8.2.5`+`§8.3 统一规则`）。

### e. 两种情况下的崩溃恢复

依据 `§8.3` 恢复表 + `§8.3` 末段（重启后关闭 admission、未终止 run 默认 paused；paused 下允许读 Git 与补 domain 事实，**不允许改 ref/跑测试/调模型**，所以补 domain 不必先 resume）。

**（1）Git ref 已推进到 M，业务记录尚未更新就崩溃**（ref=M，Proposal 仍 integrating，Task 仍 proposed，acceptedHead 仍 H）：
恢复时核对到 **ref 已是 M 且持久 validated 记录与 M/H 精确匹配、Proposal 未收束** → 在**一次 domain 更新**中补齐 `acceptedHead=M`、`Proposal accepted`、`Task done`；**不再次合并、不再次移动 ref、不重复追加接受事件**。这是“补记已经发生的发布”，可在 paused 下完成。

**（2）已验证但未推进 ref**（validated M 已持久化，ref 仍 H）：
**一律不发布旧候选**。未接受 Proposal 记 `rejected`，`reason=interrupted_before_publish`，Task 回 `claimed`，保存现有凭据供诊断；resume 后**作者必须重新 submit**。崩溃与正常 pause/stop 都不自动续发“验证过但还没发布”的旧 M（`§8.3` 统一规则、`§8.4` 表第 2 行、`§12.3 测试 21`）。

补充：若 Proposal 已明确 rejected 却发现 ref=M，或 ref 是未知 SHA/缺匹配凭据 → 保持 paused 并报告不确定/外部修改，**不覆盖、不猜成功**（`§12.3 测试 10`）。

### f. 用户要求停止时，唤醒与集成正在进行

控制面与发布面共用同一个进程内 `publicationGate`（`§8.4`）。两种先后：

**先后一：控制临界区先取得**
1. 持久化 `quiescing`、`target=stopped`、关闭 admission——即关闭**新任务、启动、唤醒、发布**四个入口（`§10.3`）。
2. 集成侧：Proposal 仍 `queued` 或正在合并/测试 → **中止**，result 不推进，Proposal→`rejected`，`reason=interrupted_by_stop`，Task→`claimed` 且**保留原 owner**；`validated M 已持久化但发布临界区未取得 gate` 的情形同样不发布，凭据留作诊断。
3. 唤醒侧：已持久化的 `wakePending` **不落实**——暂停/停止是控制状态，不通过唤醒模型落实（`§7.2` 末），待发通知随队列关闭；已登记的启动必须取消并等待收尾（`§8.4` 末段）。停止后不得出现新唤醒（`§12.3 测试 11`）。
4. 落点：`resultRef=H`、`acceptedHead=H`、Task=`claimed`（owner 保留）、Proposal=`rejected`。
5. **何时才能报告停止**：控制临界区完成（admission 已关）**且**资源与 Git 核对静止、真正进入 `stopped`。此前界面只能显示“收到停止请求，正在处理”（`§8.4`、`§12.1` 末）；无法确认静止就留在 `quiescing` 并给诊断（`§10.1`、`§10.3`）。

**先后二：发布临界区先持有 gate**
1. 它**先完成** Git ref CAS 与 domain 补齐（`acceptedHead=M`、`Proposal accepted`、`Task done`），或留下可核对的错误；控制请求随后才关闭 admission。
2. 已接受的 M 与 done 任务**保留、不回滚**；但**对用户仍报告 stopped/paused，不因此改称 completed**。
3. 落点：`resultRef=M`、`acceptedHead=M`、Task=`done`、Proposal=`accepted`，run 终态是 `stopped`。
4. **何时才能报告成功**：只有走完 finish → 最终验证通过 → 经 `quiescing` 写出 `completed` 才可报告成功（`§10.2` 最终成功条件）。先后二下这个 run 永远不会是 completed，所以只能说“已停止；停止前已接受 M”，不能报成功。

精确表述见 `§8.4` 末段：“控制临界区持久关闭 admission 之后，不能再开始或完成一个尚未取得发布临界区的发布。”

### g. 只有 research 任务、且 acceptedHead 没有验证记录

`§8.5` + `§10.2`。research 任务用 `research_complete` 变 `done`（挂结果 Finding 与证据，不进 Git 队列，`§6.3`），因此可能出现 H = baseCommit、一次代码提交都没有。

`swarm_finish` 的结构条件满足（acceptanceCriteria 逐条有证据）但 H 无成功记录时：Host **原子**保存 `finishRequest` + 创建 `Verification(purpose=finish, commit=H, status=queued)` 并进入 `draining`；工具返回“正在验证，verificationId=…”后让出 turn。`integration.ts` 在专用集成 worktree checkout H 跑固定 setup/test。

- 通过：`passed` → 复查 finishRequest 有效/H 未变/无 stop-pause → `quiescing` → `completed`。
- 失败：`failed` → 清 finishRequest → **原子创建一个 open 的 code 修复任务**（主题“修复 H 的最终验证失败”，验收是失败命令通过，附真实诊断）+ 追加关联 FAIL → phase 回 `running`，用任务事件唤醒 worker；修完重新提出 finish。
- 被暂停/停止/预算打断：`interrupted`，清 finishRequest，按控制请求收尾，**不伪造代码缺陷任务**。

`purpose=finish` 的关键约束：不创建假 Proposal、不移动 resultRef、不把任何 code 任务凭空标 done。

### h. paused 已过期 / 预算耗尽 stopped，能否 resume

- **paused 已过期**：能，但**必须明确追加预算**。`§1.2`：暂停期间截止时间继续推进，但不会自动变 stopped；`§10.1`：`paused + 截止时间经过 → 保持 paused、标记预算过期，resume 必须明确追加预算`；`§12.1`：`/swarm resume --budget 30m` 把新 deadline 设为“当前时间 + 指定时长”。
- **预算耗尽进 stopped**（`reason=budget_exhausted`）：**不能 resume**。`§1.2`、`§10.1` 最后一行（completed/stopped/failed 是终态，任何 resume 都拒绝）、`§12.1`（“追加预算…不复活 stopped”）。要继续只能**以当前 acceptedHead 为 baseRef 新建 run**，新 run 不继承旧目标/验收/任务/消息/deadline，预算从新启动时间算（`§10.4` 末、`§12.3 测试 13`）。

### i. 对空闲 Agent 只调用 inject

`§9` 表 `agent.inject()`：“**不会唤醒 Agent，包括空闲 Agent；空闲时只是排入待处理上下文**”。所以 agent 保持 idle，那段上下文要等到某次 `steer()/followup()` 或别的输入带来 turn 时才会被模型看到。要真正唤醒必须用 `steer`/`followup`（同样见 `§7.5`：活跃 worker 可由受控 `Agent.steer` 投递插件通知）。`§12.3 测试 17` 把这条列为必测项，说明文档有意区分“注入上下文”与“唤醒”。

### j. waiting（selected 模式）下，未关联的 Finding 与直接消息

`§7.2` 匹配表，selected 模式：

- **其他 worker 的 Finding**：仅当 `Finding.taskId ∈ task_ids` 才匹配 → 未关联的普通发现**不唤醒**（它仍留在事件流里，下次 `swarm_sync` 正常读到）。
- **发给自己的直接消息**：**总是匹配，不受 ID 列表限制**。
- 另外两条总匹配项：自己 Proposal 的接受/拒绝（Host 产生，不因原作者是自己而排除）；`taskId ∈ task_ids` 的 Task 状态变化。`scope` 不参与投递过滤，只是工作范围提示。any 模式下任何其他 worker 的 Finding、任何 Task 变 open 都匹配。

### k. 任务后发现重复不需要 / 两个 worker 并发 finish

**重复或不需要**：用 `cancel`，**不伪造完成**（`§6.3`“取消无效任务，不伪造完成”）。
- 运行中：worker 可取消自己持有的 `claimed`，或自己创建的 `open/blocked`，必须带 `expected_revision`、非空理由与依据；**不得取消别人拥有的任务**。
- paused 且资源静止后：原 owner 用户可用 `/swarm task cancel <id> --revision <n> --reason <text>` 取消任意 open/claimed/blocked（含 Host 创建的修复任务），不删文件。
- `proposed` 不可直接取消，先暂停并按 `§8.4` 中止 Proposal。done/cancelled 不再修改。
- 边界：`cancelled` 只表示“这个工作项不再需要”，**不豁免原始 acceptanceCriteria**；finish 仍须逐项给证据并列出所有取消理由。完成条件变为“每项 done 或有理由 cancelled”。

**并发 finish**（`§10.2`）：`running` 时**先原子更新成功者**获受理，返回 `{status:'accepted', finishRequestId, verificationId?}`；`draining` 中后到且引用**同一 acceptedHead** 的 finish 返回 `{status:'already_finishing', …}`，**不覆盖说明、不启动第二次验证**；引用旧 SHA 返回 `SWARM_STALE_HEAD`。`§12.3 测试 20` 要求“两个 finish 并发只生成一个 finishRequest/最终验证”。finish 工具必须**先返回/让出**，最终停止在独立控制流程执行，避免 worker 同步等待自己销毁（`§10.3` 末）。

### l. 私信不可见时的 cursor 推进；用户如何启动与查看

**cursor 例子（自拟）**：假设 seq 44 是我自己的 Finding、45 是 A→C 的私信、46 是公开 Finding，我最后确认到 43，页大小 2，`swarm_wait(after_seq=43)`。

1. 扫描：44 可见（我自己的普通事件，可见但不匹配 any 模式的自身事件），45 对我是不可见 → **跳过、不返回正文**，46 可见。
2. 一页只装两条可见事件，于是返回 44 与 46，`throughSeq=46`、`hasMore=true`。45 造成 seq 空洞，**不重编号**。
3. Delivery 只在我“真正看到正文”后推 `offeredSeq=46`；仅发“请同步至 46”的控制通知只推 `notifiedSeq=46`。
4. 我 `swarm_sync(ack_seq=46)` 才推 `observedSeq=46`；`ack_seq` 超过 `offeredSeq` 一律拒绝（`§7.1`）。

另一个更贴近文档原例的版本：41 可见、42 是给别人的私信、43 可见，页大小 1 → 返回 41、`throughSeq=42`、`hasMore=true`，下一页从 43 开始（`§7.1` 例、`§12.3 测试 19`）。要点是：**cursor 的推进取决于“连续扫描到的位置”，而不是页里最后一条可见事件的 seq**；遇到页装不下的下一条可见事件就停下，不能越过它推进。

**用户如何提供启动配置**：`/swarm start --spec ./swarm-run.json`（首版**只**支持 JSON spec，不做表单/简写）。spec 路径相对 owner 的 cwd 解析，其中 `repository` 相对 spec 所在目录解析。所有顶层字段必须显式给出：`repository`、`baseRef`、`goal`、`acceptanceCriteria[]`、`workers`(2–4)、`budgetMinutes`、`allowDirtyBaseline`、`verification.setup[]`/`test[]`（argv 数组 + 正整数 timeoutMs，setup 可为空、test 必须非空）。命令 cwd 由插件固定为待验证 worktree，**不从 worker 消息里挑选执行**；验证失败或必填缺失直接返回字段诊断，不调模型猜配置（`§5.1`、`§12.1`）。

**用户如何查看状态**：`/swarm status [--details]`。摘要至少含 runId、phase/reason/quiesceTarget、deadline 及是否过期、baseCommit、acceptedHead/resultRef、各任务状态计数（含 cancelled）、各 worker 实际 running/inactive/不可用状态与当前任务、当前 Proposal/Verification、诊断摘要。`--details` 另列每 worker 的 `waitRegistration`、`observed/offered/wakeTarget/notified`、在途启动、当前 admission、集成 attempt、resultRef 实际 SHA 与 domain 是否一致、拥有的后台 jobs 与日志引用；列表每页 ≤20 项，不输出完整聊天或无限日志。`status` **只读**，不触发模型/测试/修复，且不得把“停止请求已收到”显示成“已停止”（`§12.1`、`§12.3 测试 11`）。

## 5. DSH 已有能力 vs 插件需要新增的能力

### 5.1 已有、只需正确接线（`§9` 表，基线 DSH 0.2.1-rc.4）

| 能力 | 用途 | 已声明的限制 |
|---|---|---|
| `subagents.startActivation(spec)` | 创建 worker（childId/spawn/parent/cwd/agentPreset，首轮 caller delivery） | 创建信号只管未发布阶段；已发布工作须显式停止 |
| `subagents.sendMessage(owner, childId, …)` | 控制通知、启动/冷恢复 | 只支持相邻父子；收件≠模型已处理 |
| `subagents.drainChildren(owner, ids)` | 只停本 run 的子会话 | 不得波及 owner 的其他子会话 |
| `activation.result` / `subagent/end` | 观测 activation 收尾 | 不是整个 run 成功的信号 |
| `agent/created`（serial） | 首次模型请求前备 worktree/工具/策略 | 监听器内不能等该 Agent 自己 idle |
| `worktrees.create(agent, req)` | 建独立 checkout | 会切调用者 cwd；不复制未提交文件 |
| `workingDirectory.set(agent, path)` | 初始化期间切回源 cwd 再进目标 | 只对初始化中的 worker 生效 |
| `exec.concludeTurn()` | wait 让出 turn | 不完成 run 或 Task |
| `agent.inject()` | 追加下一步可读上下文 | **不唤醒**（含空闲） |
| `agent.steer()` / `followup()` | 投递 step/turn 输入并唤醒 | 生效于模型边界，不抢占 OS 进程 |
| `storageDomain` 的 `table.update` | 单记录串行持久变更 | 无跨进程/跨表事务 |
| `jobs.list/kill/wait` | 管本 run 后台作业 | kill 只请求取消，须等静止 |
| `subprocess` 句柄 | 跟踪/取消集成命令 | 裸 spawn 不带完整 sandbox/approval |
| `sessionProjections` | 统计 usage/turn/tool 事实 | 不得借此发明未知 SessionEvent |
| Cordis effect / preset / bundle 安装 | 注册释放、preset 挂载、`install_bundle` | — |

### 5.2 插件必须新增

1. **run 状态机与预算**：`preparing/running/draining/quiescing/paused/stopped/completed/failed` + target 优先级（stop > infra failed > budget > pause > completed）、admission 开关、在途操作登记、墙钟 deadline。
2. **业务数据层**：Run 单聚合 + CAS/revision/seq/事件追加/幂等 receipt `(workerSessionId, toolCallId)`，且强制“一次业务变更一个 reducer 内完成、reducer 纯同步”。
3. **协作规则层**：Task/Finding/Message 的合法转换、取消/释放/阻塞语义、完成条件口径（done 或有理由 cancelled，但不豁免原始验收）。
4. **Delivery 层**：offered/observed 双游标、分页空洞、§7.2 匹配表、waitRegistration、持久 wakePending、每 worker 串行队列与收尾合并（防双重恢复）。
5. **workspace 层**：worktree 创建顺序（首个 worker 先建集成 worktree 再切回）、路径与 Git 身份核对、恢复时“核对并复用”而非重建同名分支。
6. **integration 层**：proposal ref 固定、候选构造、冲突诊断、setup/test 执行与指纹、`publicationGate` + ref CAS、`Verification`（proposal/finish 两种 purpose）。
7. **9 个 worker 工具** + **7 个用户命令**（含 spec 解析、status 输出契约）。
8. **`swarm-worker` preset**：读写文件/搜索/shell/jobs/协作工具 + 固定指令，**不含**插件管理、Swarm 启动控制、递归建 Agent、Teams 共享目录指令。

### 5.3 我会最先做的三个开发步骤

1. **核验并钉死三个关键语义**（`§13`）：`activation.result`/`subagent/end` 在 `concludeTurn()` 之后的实际时序与续跑轮次是否同样产生 end；`worktrees.create` 对 cwd 与目标仓库的解析规则；`table.update` 的“持久化后再公布”边界。用 `cordis_inspect_list` + 安装包 declarations 核对签名，先写一个只做“建子会话→建 worktree→concludeTurn→再续跑”的探针。
2. **store + 状态机骨架**：在单 reducer 内实现 CAS/revision/seq/事件/receipt，跑 M1（bundle/preset、run、2 worker、worktree、停止），验收 owner cwd/index 不变、停止后无后续模型调用（`§12.2`）。
3. **协作闭环 M2**：CAS 认领竞争（一胜一 stale）、私信空洞分页、三种等待竞态与“只恢复一次”，先用 fake Agent + 临时仓库做确定性测试（`§12.3` 1–5、19）。

## 6. 歧义、内部矛盾与缺失决策

### 6.1 会直接阻碍“照着实现出正确流程”的项

**B1. `concludeTurn()` 与 activation 收尾的关系只在暗示中成立。**
`§7.3` 第 3 步用 `exec.concludeTurn()` 让出 turn，第 6 步说“用 `startActivation()` 返回的 `activation.result` 观察完全收尾”，第 7 步说“初始 result promise 和 end 事件可能都通知一次”。但 `§9` 表对 `exec.concludeTurn()` 只写“wait 工具让出 turn / 不完成 run 或 Task”，**没有说它会结束本次 activation**；对 `subagent/end` 也只说“观察 activation 收尾”，**没说 owner→child `sendMessage` 续跑的轮次是否同样产生该事件**。整个“43 到达也不丢、且不双重恢复”的保证（`§7.3.7`、`§7.4` 末、`§11` 第 4 步）建立在这两点上：若 concludeTurn 只让出 turn 而 activation 仍活着，队列永远等不到收尾，唤醒根本不发出；若续跑轮次没有 end 事件，“收尾后才发通知”的闸门失效。这是本文对 DSH 行为最强的一个未标注假设，也是我给出 NEEDS_REVISION 的首要原因。

**B2. `waitRegistration` 的清除条件没有对应的操作定义。**
`§7.4` 只说“进入新工作/主动取消等待时清除 waitRegistration”，但 `§6.2` 工具表里没有任何“取消等待”的工具或参数，也没说 `swarm_task_update(claim)`、`swarm_submit`、`swarm_sync` 哪个算“进入新工作”。后果是行为分歧：worker 已 claim 到任务、且之前登记过等待时，一个与它无关的 Finding（any 模式）是否还会把它唤醒？实现者只能自己发明规则。

**B3. `swarm_wait` 是否推进 `observedSeq` 未定义。**
`§7.3` 第 1 步说 wait 在“同一个 run 原子更新中**确认有效读取位置**、登记条件并检查事件”，但 `§6.2` 里 wait 的参数只有 `after_seq`、没有 `ack_seq`，而 `§7.1` 又规定“只有 `swarm_sync(ack_seq)` 才能确认、且不能超过 offeredSeq”。于是三件事不明：wait 是否等价于 ack 到 `after_seq`；`after_seq > offeredSeq` 时是报错、还是夹到 offeredSeq；下一轮 sync 会不会把已 wait 过的区间重投。这直接影响 c 题里 41/42 是否会重复出现。

**B4. Delivery 队列与 `§8.4` 控制门禁之间没有调用契约。**
`§8.4` 末段要求“首次创建/**续跑**也先在 runtime 的控制门禁中登记为在途操作，再执行可取消的 materialize；关闭 admission 后不得登记新操作”。但 `§7.3` 第 5–7 步的队列是“收尾完成且 run 仍允许启动后，队列才发送 owner→child 续跑通知”——这里“仍允许启动”由谁判定、队列发通知前是否必须向 runtime 申请登记、被拒后 wakePending 是保留还是丢弃，文档都没写。f 题两种先后的实现分歧正落在这里；`§7.4`“容量不足或恢复失败保留 pending”只是旁证，不是规则。

**B5. `§8.3` 崩溃恢复所依赖的“精确凭据”缺字段。**
恢复表要求“持久 validated 记录精确匹配 M/H”，但 `§4.2` 的 `Verification` 只有 `id, purpose, commit, proposalId?, configFingerprint, status, receiptRef?`——**没有 `expectedHead`**。H 只能从 `integrationAttempt.expectedHead`（`§8.2.1` 才提到要持久化）或 `Proposal.resultRefAtSubmission` 间接取，文档没说哪个是权威、也没有说明 attempt 被后续尝试覆盖后如何取回旧 H。而“精确匹配”正是 `§8.3`/`§8.4` 全部恢复正确性的支点。

### 6.2 编码或写测试时可以自行定死、不必修订文档的项

| # | 项 | 说明 |
|---|---|---|
| C1 | **paused 是否占用“同一仓库唯一活动 run”** | `§1.2` 只说“同一仓库同一时间只允许本插件有一个活动 run”。paused 算不算活动（即 paused 时能否 `start` 新 run）未定；终态后新建 run 则明确允许（`§10.4` 末）。 |
| C2 | **没人调用 finish 时怎么结束** | 只能推断为“worker 都 wait → 直至 deadline → stopped/reason=budget_exhausted，交付已接受结果与未完成列表”（`§6.1.9`、`§1.2`、`§10.3`）。可接受，但没明写，读者容易以为会“空闲即完成”。 |
| C3 | **stopped/failed 的交付物格式** | `§0` 定义的最终产物（SHA/diff/验证/验收说明）是成功路径；stop 与 failed 下给什么报告、是否含 result 分支，只有 `§10.3` 一句“交付当前已接受结果和未完成列表”。 |
| C4 | **finish 复用验证记录的范围** | `§10.2` 说“acceptedHead 有匹配 verificationConfig 的成功记录则复用”，但 `Verification` 有 proposal/finish 两种 purpose，没说 `purpose=proposal` 且 `commit=acceptedHead` 的 passed 能否复用。 |
| C5 | **幂等 submit 与任务状态的排序** | `§4.3` 说“已有 queued/integrating/accepted Proposal 则返回它”，但 `§6.2`/`§8.1` 要求 submit 时任务是 claimed 并校验 revision；任务已 done 时先返回旧 Proposal 还是先报状态错，未定顺序。 |
| C6 | **`integrationAttempt?` 单数** | `§4.2` 是单数字段，`§4.1` 说聚合记录含“集成尝试”（历史上会有多次），结构待定。 |
| C7 | **worker 首次如何拿到 goal/acceptance** | `§4.4` 只给原则“通过正常工具结果、steer/inbox 进入 Session 日志”，没写首个 turn 是否自动注入；可推断为 preset 固定指令要求先 `swarm_sync`。 |
| C8 | **错误码只给了一半** | 全文只出现 `SWARM_STALE_HEAD`、`SWARM_NOT_RUNNING` 两个字面码；CLAIM 冲突处仅写“stale/claimed 错误”，`swarm_submit`/`swarm_wait`/`release` 的失败返回结构与码名均未定义。 |
| C9 | **源仓库绝对路径来源** | `§5.3.5` 要求把 worker cwd“切回源仓库”，路径来源应是 `Run.repositoryRoot`（spec 解析后），文档未明写。 |
| C10 | **status 里“不可用”未定义** | `§12.1` 的“running/inactive/不可用”三态，第三态判定条件未给。 |

### 6.3 经核对**不是**矛盾的易误读处（供作者参考，不必改）

- `§1.2`“暂停期间截止时间仍然推进” vs `§10.1`“paused 不运行…截止 timer”：一致——数值推进、但无 timer 自动触发转 stopped，恢复时必须显式追加预算。
- `§6.3`“运行中 worker 可取消自己创建的 open/blocked” vs `§6.2` 写工具“所有写工具检查 run.phase”：一致，前者是授权范围，后者是门禁。
- `§8.2.6` 发布前复查 `phase=running` vs finish 期间处于 `draining`：一致，`draining` 本就不再接受新候选发布。
- `§7.2`“指定 Task 的其他状态变化在 any 模式下不唤醒、selected 下匹配” vs “Task 变 open 在 any 下匹配”：是两条不同行，不冲突。
- `§1.2`“首版不面向任意非编码研究任务” vs `§8.5` 的纯 research 例子：不冲突——前者指“不保证通用研究交付”，后者指“run 内可以只有 research 任务”，且靠 `purpose=finish` 独立补验证。

## 7. 结论

**verdict: NEEDS_REVISION**

**理解信心：78/100**

理由，按重要性：

1. **核心流程确实读懂了**，而且相当扎实。§0 的四条“不等于”、§8.2 的七步集成、§8.4 的两种先后、§8.3 的四行恢复表、§7.1 的双游标加空洞分页、§10.1 的状态表与 target 优先级，构成了一套自洽且可实现的主干。12 道情景题我都能只用文档内容一致地回答，并给出一致的状态落点（a: 一胜一 stale；b: owner 不因 inactive 释放，需 paused + `/swarm task release`；f: 两种先后分别落到 `rejected/claimed/H` 与 `accepted/done/M` 但终态仍报 stopped）。
2. **但仍不能宣称“无需额外解释即可一次读懂实现”**，因为唤醒机制这一核心卖点上存在 B1–B4 四个规则级空白：一个依赖未标注的 DSH 行为假设（B1，可使机制整体失效），三个缺规则（B2 等待登记何时清、B3 wait 是否推进 observedSeq、B4 队列与 admission 门禁的调用契约）。这些不是“实现细节”，而是会让两个实现者写出不同行为的决策点。
3. **崩溃恢复的支点缺字段**（B5）：`validated 记录精确匹配 M/H` 的 H 在数据模型里没有权威来源，而恢复表的所有分支都依赖它。
4. 6.2 的十项属于“写代码时定死 + 补测试即可”，不构成理解障碍；6.3 的几处易误读经核对不矛盾。

**最小修订建议**（不改架构，只补规则，约 20–30 行）：在 `§7.3` 明确“concludeTurn 是否结束 activation、续跑轮次是否产生 `subagent/end`”，不成立时给出替代收尾信号；给 `waitRegistration` 一个明确的清除触发点（例如“任何成功的 `swarm_task_update(claim)` 或 `swarm_submit` 自动清除本 worker 的 waitRegistration”）；说明 `swarm_wait(after_seq)` 对 observedSeq 的效果与 `after_seq > offeredSeq` 的处理；写清 Delivery 队列与 runtime 控制门禁的申请/拒绝/pending 保留契约；给 `Verification` 增加 `expectedHead`（或在 `§8.3` 指明 `integrationAttempt.expectedHead` 为权威）。

补上这五处，我会给 UNDERSTOOD，信心 90+。