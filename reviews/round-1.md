# Round 1 冷读评审：ARCHITECTURE.md

评审对象：`ARCHITECTURE.md`（唯一被读文件）
评审性质：独立冷读，无作者先前聊天背景，未提问、未联网、未读其他文档。

## 1. 记录

| 项 | 值 |
|---|---|
| 文档修订号 | 文档首行声明 `文档修订：R1 · 2026-10-27` |
| 被评审文件指纹 | `sha256 3c17f7b268df1d8b8b89ebf4fe78addda1ff005d5b92e12ba65840a3bf5bd072`，35044 字节，506 行 |
| 实际读取范围 | `ARCHITECTURE.md` 第 1–506 行（全文一次读完，无截断、无缺失段），未读仓库内其他任何文件 |
| 使用模型 | `deepseek-v4.1-flash-1017`（来自会话运行时声明；我无法自证，仅照录） |
| 未做的事 | 未联网、未检索论文/Agensh/DeLM 原文、未调用 Inspect 核对 DSH 签名、未向作者索取解释 |

阅读方式说明：先通读全文，再按第 4 节情景题逐条回查对应章节段落；第 6 节所有引用均为原文摘句。

## 2. 复述（≤250 字）

用户对本地仓库目标发起一次 run：2–4 个对等 worker 各有私有会话与工作树，自主提出任务并用 CAS 认领（一任务一 owner），边做边共享发现、提交不可变 commit。没有经理模型，worker 自己决定做什么；普通程序只负责状态一致性、协作数据、投递唤醒、工作树与 ref、串行集成验证、暂停停止与预算。候选 commit 在集成工作树与 acceptedHead 合并并跑测试，通过才用 ref CAS 推进 result 分支。交付 result 提交、diff、验证记录与逐条验收说明，不动用户 checkout。

## 3. 一次 run 从启动到交付的时序

我按文档重建的主干时序如下。"知识传播"= 只动插件 domain 数据与 Session 日志；"代码传播"= 只动 Git 对象/refs/文件。

| # | 阶段（phase / 状态） | 谁做 | 知识传播 | 代码传播 |
|---|---|---|---|---|
| 0 | 启动输入（§5.1） | 用户 + owner + Host | 目标、验收项、仓库、baseCommit、workers、预算、setup/test 写入 Run；脏工作区默认拒绝 | 无 |
| 1 | `preparing`（§5.3.1–6） | Host | 持久化 Run、预留 worker Session ID、注册初始化监听器 | 创建 worker worktree 分支、集成 worktree、`resultRef`=baseCommit（无提交） |
| 2 | `running`：协作循环（§6.1、§7） | worker 自主 | `swarm_sync` 读目标+事件增量 → `task_create` → CAS `claim` → `publish` Finding → `message` 协商 → `swarm_wait` 让出 turn、被事件唤醒 | worker 在私有 worktree 本地 commit（仅本地 Git 对象，尚未进入公共视图） |
| 3 | 提交（§8.1） | 作者 worker | Task `claimed→proposed`、Proposal `queued`，作者收到结果通知 | 候选 SHA 被固定到插件拥有的 proposal ref，作者后续改动不影响该 Proposal |
| 4 | 集成 1：候选构造（§8.2.1–3） | 集成模块（普通程序） | `integrating` + attempt(expectedHead=H, sourceCommit=C) | 集成 worktree 以 H 建候选、合并 C 得 M；result 仍指 H |
| 5 | 集成 2：验证（§8.2.4–5） | 集成模块 | 记录退出码/超时/日志引用/验证配置指纹；失败即 `rejected`、Task 回 `claimed` | H 不变；命令污染 tracked 文件则本次候选不算通过 |
| 6 | 集成 3：发布（§8.2.6–7） | 集成模块 | 先持久化 `validated(M,H,receipt)`，ref CAS 成功后一次 domain 更新写 acceptedHead=M、Proposal accepted、Task done、结果事件 | `resultRef` H→M |
| 7 | 代码再传播（§6.1.8、§8.2.8） | 各 worker 自己 | 事件只告知 M 的 SHA | worker 自行把 M 合入自己的干净分支（插件不替它改文件） |
| 8 | 收尾（§10.2） | Host 受理、控制面执行 | `draining`：冻结新任务/候选，逐条核验 acceptanceCriteria、Task 全 done、acceptedHead 有匹配验证记录、无阻塞修复任务、无新受理工作 | 无 |
| 9 | 停止（§10.3） | 控制面（不是 worker 自己） | `quiescing`：先持久关闭新任务/启动/唤醒入口，再取消启动、worker、集成进程与 jobs | 保留工作树，不删除未知目录 |
| 10 | 交付 | Host + owner | `completed` + 最终报告：SHA、diff、验证记录、逐条验收说明 | result 分支留在 refs，不在任何 worktree checkout（§5.2） |

失败分支：`paused`（停住可恢复，截止时间继续走）、`stopped`（用户停止或预算耗尽，不是成功）、`failed`（初始化/基础设施不能继续；普通候选测试失败不进入此状态）。

状态含义（§10.1 原文口径）：`preparing` 资源仍在建、尚未开始模型工作；`running` 正常协作；`draining` 已受理完成提议、写入门禁关闭、正在核验收尾条件；`quiescing` 正在停进程，**不能对外宣称已全部停止**；`paused` 已停住但可明确恢复；`stopped` 停止/预算耗尽、非成功；`failed` 基础设施级失败。附属状态：Task `open/claimed/proposed/done/blocked`（只有 code 任务随 Proposal 接受而 done，§6.3）；Proposal `queued/integrating/accepted/rejected`；`offeredSeq`=已投递给模型的上界、`observedSeq`=工具确认读过的上界（§7.1）。

## 4. 情景题

**a. 两个 worker 用同一 revision 领取同一任务（§1.1 CAS、§4.2 Task.revision、§6.3、§12.3-1）**
只有一个成功：先到者在一次 domain 更新里把 status 置 `claimed`、写入 owner、revision+1。另一个的 CAS 因 expectedRevision 不匹配失败，返回 stale/claimed 错误，不产生第二个 owner、不修改任务；它应重新 `swarm_sync` 找别的工作。文档明说"同一个 Task 只能有一个 owner"（§2）与"认领竞争仅一个成功"（§12.2 M2）。

**b. worker inactive 但还有任务（§6.3、§7.4 第三段、§12.3-3）**
不会自动释放：原文"inactive、turn 结束和普通等待都不会自动释放 owner。v0.1 不做定时租约回收"。任务保持 `claimed`（或 `proposed`），不会变 `open`；`swarm_wait` 结束 turn 也与此无关。runtime 可发**一次**明确的协议提醒；若它反复无新状态地结束 turn，则暂停该 run 并报告，不无限自我续跑。若它处于 `proposed` 等集成结果，属正常等待，不算异常。

**c. 读到 42 后登记等待，43 在 turn 结束前到达（§7.3 步骤 1/4/5、§11-4）**
登记与事件检查在同一个 run 原子更新内完成；从登记起事件处理器即可把它标 `wakePending`，本次 activation 收尾时再检查 pending 与最新 seq；**收尾完成后**才发续跑输入，且同 worker 的 materialize/wake 路径串行。结果：43 被保留并作为续跑输入投递（至少一次），不会丢，也不会因 43 在收尾前到达而并发启动两个 activation。

**d. 本地检查通过但组合代码测试失败（§8.2.5、§6.3、§12.3-7、§10.1）**
变化：Proposal `→rejected`（记录真实退出码/超时/日志引用作为诊断 artifact）；`result` 与 `acceptedHead` 仍是 H；Task `proposed→claimed`（回原 owner 继续修复）；追加被拒事件通知作者与等待者；run 保持 `running`（"正常代码失败不等于整个 run failed"）。worker 本地通过记录只作为证据，不参与任何状态推进。之后作者需先合入最新公共 commit 再重提新 Proposal（新 sourceCommit）。

**e. Git ref 已推进、业务记录未更新就崩溃（§8.3 表第 3 行、§8.2.6–7、§8.3 末段）**
重启后未终止 run 默认 `paused`。resume 时若观察 `resultRef` 已是 M 且持久 `validated` 记录精确匹配 M/H：在一次 domain 更新中补齐 `acceptedHead=M`、Proposal `accepted`、Task `done`、结果事件，**不再合并一次**、不重复验证。若 ref 仍是 H 且有 validated M：需用户明确 resume 才继续 CAS（"不得自行后台发布"）。若 ref 是其他 SHA 或无匹配凭据：暂停并报告，不覆盖不猜测。

**f. 用户要求停止时唤醒与集成同时在进行（§10.3、§10.2.5、§12.3-11）**
顺序：先把"关闭新任务、启动、唤醒入口"持久化（admission 闸门），再取消本 run 未完成启动/worker/集成进程/其后台 jobs，等收尾（`quiescing`）完成才可报告 `stopped`；中途只能说"正在停止"。唤醒同理：停止写入之后不得再偷偷唤醒或发布候选。若集成的 admission 早于停止请求（已在 `integrating` 且 validated 已落盘），按持久 admission 顺序它可能先完成发布再进入 quiescing，此时报告的是 `stopped` + 已接受结果（可能是 M），而不是 `completed`——`completed` 只有在 §10.2 六条同时满足且资源静止时才可发布。若停止 admission 先，集成被取消，result 停在 H，报告 `stopped` 并说明候选未发布。

## 5. DSH 已有能力 vs 插件新增能力

**DSH 已有（§9 核对表）**：`subagents.startActivation`（指定 childId/spawn/parent/cwd/preset，caller delivery）；`subagents.sendMessage(owner, childId)`；`subagents.drainChildren`；`agent/created`（serial）；`worktrees.create(agent)`（含切 cwd，experimental）；`workingDirectory.set`；`exec.concludeTurn()`；`agent.inject()`/`steer()`/`followup()`；`storageDomain` 的 `table.update`（单记录串行）；`jobs.list/kill/wait`；`subprocess` 句柄；`sessionProjections`；Cordis effect 生命周期；DSH 的 sandbox/permission 组合；`conversation.view`（§12.1 后续看板）。另外原生子会话本身就是"可续跑的持久对话身份"（§1.2）。

**插件必须新增**：全部 `swarm_*` 工具（sync/read/task_create/task_update/publish/message/submit/wait/finish）及其身份取自 `exec.agent`、写工具检查 `run.phase`；Run 聚合记录与 CAS/revision/`seq`/`nextSeq`/mutation receipt 幂等（键 `(workerSessionId, toolCallId)`）；Task/Finding/Message 业务规则与状态机；delivery 的增量读取、等待登记、`wakePending` 与唤醒去重/串行；workspace 布局、初始化顺序、恢复核对；集成队列、候选构造、验证适配器（必须走 DSH sandbox/permission，不得直接 Node `child_process`）、`resultRef` 的 Git ref CAS；runtime 的 run 生命周期、预算、暂停/停止/恢复；用户命令 `start/status/pause/resume/stop`；bundle manifest + Cordis patch + `swarm-worker` preset；client 只读看板；以及"兄弟消息 → owner→child 控制通知"的转运通道。

**我认为最先的三个开发步骤**（遵循 §12.2 的 M1→M2 依赖）：
1. **持久层与门禁**：`storageDomain` 聚合记录、`table.update` reducer（检查条件+改对象+revision+事件+seq 一次完成）、mutation receipt 幂等；`swarm_*` 工具骨架与身份/phase 检查。用 fake Agent 做确定性单测。
2. **隔离与资源**：`preparing` 全链路——预留 Session ID、初始化监听器、`agent/created` 内建 worktree、首个 worker 建集成 worktree 后切回源仓库、`resultRef`=baseCommit、初始化失败即停；验收"第一次模型调用前隔离完成、owner cwd/index 不变、停止后无后续模型调用"（M1）。
3. **协作闭环最小集**：CAS claim/release、`sync` 分页与 `ack_seq≤offeredSeq`、`wait` 登记 + `concludeTurn` + 单一唤醒通道（串行、去重），按 §12.3-4 三种时序写测试（M2）。集成（M3）依赖上面三项的持久与隔离正确性，放在其后。

## 6. 歧义 / 矛盾 / 缺失决策

### 6.1 真正阻碍"照着实现正确流程"的（文档级缺口，必须补决策）

**B1（内部矛盾）用户没有释放/接管任务的入口，但协议要求它存在。**
§6.3 原文："拒绝后的原 owner 继续修复；若它已不可恢复，用户先暂停 run，再明确释放/接管任务。" 但 §12.1 用户入口只有 `/swarm start|status|pause|resume|stop`，§3 `commands.ts` 职责是"用户 start/status/pause/resume/stop 控制"，§6.2 的 `swarm_task_update` 是 worker 工具且要求 `exec.agent` 身份。于是"明确释放/接管任务"这条流程没有承载者：用什么命令、以什么身份、CAS 用哪个 revision、是否需要记录接管理由，全部缺失。这也和 §6.2"worker 不获得…管理工具"、§3"不给 worker 提供扩容权"的权限边界纠缠。

**B2 停止/暂停与"进行中的集成"的交叉语义未定义。**
§10.3 说"再取消本 run 的未完成启动、worker、集成进程及其拥有的后台 jobs"；§12.3-11 只说"先按持久 admission 顺序决定；停止后不偷偷发布候选或唤醒"；但 §8.2.6–7 是两步（先 `validated` 落盘，再 ref CAS，再 domain 更新），§8.3 只给出**崩溃/重启**的恢复表，没有给**用户停止**的中止表。缺三项决策：(i) 已被 admitted 的整合在 stop 请求后是否允许完成发布；(ii) 被中止的 Proposal 落 `integrating` 还是 `rejected`，Task 回 `claimed` 还是保持 `proposed`；(iii) 出现"H 未变但存在 validated M"时是否与 §8.3 第 2 行同构（必须显式 resume 才能继续）。这直接决定情景 f 的"何时能报告停止"和"交付了什么"。

**B3 §10.2 条件 3 的"给 acceptedHead 补验证"没有任何状态或模块承载。**
原文："当前 acceptedHead 有匹配当前 verificationConfig 的成功验证记录；没有则先安排该提交的验证，不能直接成功。" 但验证只在候选 M 上进行（§8.2.4，候选是 H 与 C 的合并结果），`integrationAttempt?` 是单数且语义绑定 proposalId/sourceCommit；Task 也不允许无 Proposal 的 `done`（§6.3"code 任务没有'我说完成就 done'的操作"）。因此当 run 里只有 research 任务、或最后一个 Proposal 被拒后仍有未验证的 acceptedHead 时，"安排验证"由谁触发（integration 模块？runtime？timer？）、以什么记录形态存在、期间 phase 是什么、失败后产生哪个可修复任务，全部未定。§10.2 又说"验证失败要产生可修复的具体工作"，但没给这类工作的实体。

**B4 §7.3 的"串行唤醒"只给结论，不给机制。**
§7.3-5："等本次 activation 的收尾完成后再发续跑输入；同一个 worker 的 materialize/wake 路径必须串行，不能同时启动两个续跑。" 但：谁持队列/锁（§4.2 明确"运行时 Agent 句柄、进程句柄和互斥锁不序列化"）；如何观测"本次 activation 收尾完成"（§9 只列出 `agent/created`（serial）与 `exec.concludeTurn()`，没有 activation 收尾事件）；`wakePending` 与 `offeredSeq`/`observedSeq` 的推进关系；重启后 pending 是否重放。实现者必须自行发明一个跨 turn 的串行通道，而这个通道正是 §12.3-4"重复通知不并发恢复两次"的判定对象。

**B5 "相关 worker 可被唤醒"缺少相关性谓词。**
§7.2："普通 Finding：…等待中的**相关** worker 可被唤醒"；"新可领取任务：可唤醒等待可用工作的 worker"。而 `swarm_wait` 只有 `after_seq` 与可选 `task_ids/proposal_ids`（§6.2）。匹配语义（scope 重叠？作者？task/proposal 成员？kind？）未定义，两种实现后果相反：按 scope 匹配会漏唤醒（scope 不是文件锁，§6.1-5），按全广播会违反 §7.2"自己发出的普通事件不唤醒自己"和 §12.2 M2"无自激广播"的验收标准。

**B6 §10.1 状态机图不完整/不可靠。**
图中 `draining` 只有 `→ quiescing → completed` 一条出边，`running` 的 `+---- quiescing ----> paused / stopped / failed` 列位置本身有歧义（右列属于 running 还是 quiescing？）；缺失：`draining` 期间用户 stop/pause 的转移、`quiescing` 期间预算耗尽、`completed/stopped/failed` 是否终态。更实质的是 `stopped` 能否回到 `running`：§1.2 说"恢复已过期 run 必须由用户明确追加时间预算"，而 `/swarm resume [--budget 追加时长]` 存在（§12.1），暗示 stopped→running 有边，但图中没有；同时 §10.3 说"预算耗尽走 stopped"并把 stopped 定义为"不是成功"，那么"预算追加后恢复的 run 最终能否 completed"没有说明。

### 6.2 编码阶段查类型/写测试即可解决（不算不懂）

- C1 §4.2 明说"示意，不是可直接编译的完整类型"：`initializationState` 取值域、`Event.kind` 全集、`audience` 语义、`mutationReceipts` 的保留/清理策略（§4.1 只说不剪裁 Finding）需在写代码时定。§13 也把类型核验交回 Inspect。
- C2 §12.1 只说"还需通过配置/结构化输入确定 repository、baseCommit、acceptanceCriteria、setup/test"，未给 config schema/键名；§9/§13 明确以当前 Inspect 与 declarations 为准，属编码核验。
- C3 §8.2.4"命令改动 tracked 文件时不能把 M 算作已通过；需要重建并验证实际候选"——如何检测、如何重建、指纹怎么算，需要实现时定义，但验收标准清楚（可用测试兜住）。
- C4 §5.3.5"后续 worker 从源仓库各自创建"未写明其初始 cwd 取值（owner cwd 还是 `repositoryRoot`）；参数化即可，风险低。
- C5 §6.1-7"Proposal 等待期间…不开始下一项代码修改"是**指令层**约束，协议层没有第二任务配额校验（§6.3 只写"每人最多持有一个 claimed 或 proposed"——这其实是工具层可校验的，算半缺口，按工具校验实现即可）。
- C6 §0 要求交付"相对基线的 diff"，但没写由谁生成、以什么形态给用户（`baseCommit..acceptedHead` 的文本/diff 文件）；交付时确定即可。
- C7 §7.4"owner 不在线或失去可用身份时，run 暂停"未给 owner 永久不可恢复时的终态；§1.3 不做多机，属边缘场景。
- C8 §9 里 `agent.inject()` 描述"非唤醒的模型上下文注入，谨慎使用"与"不能误以为：它会启动空闲 Agent"两句在措辞上互相拉扯（前者像保证不唤醒，后者像保证会唤醒），但语义可还原为"它不是唤醒机制，但作用于空闲 Agent 时会把它启动"，属文案问题。

### 6.3 文档明确做对的地方（不计入问题）

"四件事不等价"（§0）、"三个数字不要混用"（§4.3）、reducer 内禁止 await（§4.1）、`(workerSessionId, toolCallId)` 幂等键（§4.3）、Git 与 domain 非同一事务的恢复表（§8.3）、验证通过才能推进 result 且**不许 LLM 自动解冲突**（§8.2、§3）、停止不得自等待（§10.3）、不宣称 worktree 是沙箱（§1.3）——这些都达到了"实现者不会走偏"的精度。

## 7. verdict

**verdict: NEEDS_REVISION**

**理解信心：84 / 100**

理由（按"核心流程是否需要额外解释"判断）：
- 主干（启动输入 → 隔离初始化 → CAS 认领 → 提交固定 SHA → 串行集成与验证 → ref CAS 发布 → 满六条件收尾 → 交付 SHA/diff/验证/验收说明）以及"知识传播 vs 代码传播"的分工，文档表达得足够清楚，情景 a–e 我都能只凭文档给出一致答案。
- 情景 f 我只能靠 §12.3-11 的"admission 顺序"和 §10.3 的顺序描述**推断**出答案，而"被中止的 Proposal/Task 落到哪个状态、validated M 能否在 stop 后发布"在文档里没有定义（B2）；B3 使"只有 research 任务或末次被拒后如何收尾"这条路走不通；B1 是一个可直接指出的内部矛盾（协议引用了不存在的用户入口）；B4/B5 决定唤醒正确性而文档只给结论。这些都不是"写代码时查类型"能解决的，需要作者补决策。
- 因此不能给 UNDERSTOOD。

置信度损失点：我未核对 DSH 实际签名与 worktree/activation 收尾事件是否存在——若这些接口本身缺失，B4 会从"缺机制"升级为"方案不可实现"，反之若存在合适的 activation 生命周期钩子，B4 可降级为编码细化。