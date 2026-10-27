# ARCHITECTURE.md 冷读评审（Round 2）

## 1. 本次评审的记录

- 文档：`ARCHITECTURE.md`，文档修订 **R2 · 2026-10-27**（第 3 行），584 行。
- 评审模型：`deepseek-v4.1-flash-1017`（本节记录由执行本次冷读的模型给出）。
- 实际读取范围：只读了 `ARCHITECTURE.md` 全文，分三次读完第 1–200、201–400、401–584 行，无截断、无跳读。**未** 联网、未读 `reviews/` 下任何其他评审、未读其他项目或运行时文档、未向作者提问。本文所有判断只来自这 584 行文字。
- 结论性质：只判断"仅凭这份文档能否一次读懂架构与关键执行流程并照着实现"。

## 2. 复述（不超过 250 字）

插件在单机一个 DSH Host 内用 2–4 个对等 worker 完成一个编码目标，每人一个 Session 加一个私有 Git worktree。没有经理模型：worker 自己提出、用 CAS 认领并完成子任务，靠 Finding 与 Message 传播知识。普通程序只保证状态一致、消息投递与唤醒、资源停止和串行集成（构造候选、跑测试、推进 result 分支）。交付物是 result 分支 SHA、相对基线的 diff、验证记录与验收说明，不改用户原工作区。

（按字符计约 237，含英文字母与数字；不超过 250 字）

## 3. 一次 run 的时序：知识传播 vs 代码传播

两条链必须分开看：**知识链**（Finding/Message/Event.seq → 谁的模型看见了什么）与**代码链**（commit → Proposal → 候选 M → result 分支 → 各 worker 自行合并）。文档反复强调两者不互相触发（§0 第 37–40 行、§8.2 第 8 步、§11 第 6 步）。

| # | 阶段 | 知识传播 | 代码传播 | 状态含义 |
|---|---|---|---|---|
| 0 | 启动输入（§5.1） | 无 | 无 | 用户必须给出 goal、acceptanceCriteria、repository、baseCommit、workers 2–4、budget、verificationConfig；工作区脏则默认拒绝启动 |
| 1 | `preparing`（§5.3） | 预留 worker Session ID，先注册只匹配这些 ID 的初始化监听器 | 第一个 worker 在其首次模型请求前创建**集成 worktree**，切回源仓库，再建自己的 worktree；随后各 worker 从源仓库各自创建；`resultRef = baseCommit` | 布局与隔离尚未就绪。任何 worker 初始化失败即停止已启动 worker、报 failed，不降级成单人 run |
| 2 | `running`（§6、§7、§8.2） | 业务事件按 `seq` 追加；worker 用 `swarm_sync(ack_seq)` 推进 `observedSeq`；投递推进 `offeredSeq`；等待登记 `waitRegistration{afterSeq,mode}`，事件命中后置 `wakeTargetSeq`，控制通知被 inbox 接受后置 `notifiedSeq`；消息正文先落插件 Message 数据，再由 runtime 以 owner→child 控制通知带出（§7.5） | worker 在私有 worktree 实现并本地检查 → 提交**不可变 SHA** → `swarm_submit` 把 SHA 钉到 proposal ref、Task→`proposed` → 串行队列在集成 worktree 以 acceptedHead=H 合并 C 得候选 M（result 仍指 H）→ 跑 setup/test → 通过后 ref CAS H→M，再在一次 domain 更新写 acceptedHead、Proposal accepted、Task done → 其他 worker 收到 M 后**自行**合入自己分支 | 正常协作与集成；代码推进只由集成队列决定，本地测试通过不代表集成 |
| 3 | `draining`（§10.2） | 冻结 worker 新业务写入；只读工具仍可用 | 冻结新提交；finish 受理条件核对（引用当前 acceptedHead、逐条对应验收并给证据、所有 worker 已初始化、所有 Task 都 done、无未处理 Proposal/修复任务/在途启动）；若无匹配验证则创建 `Verification(purpose=finish, commit=H)` | "已受理提议"不等于成功；工具返回"正在验证"后让出 turn |
| 4 | `quiescing`（§10.3） | 关闭 admission：不再登记新的启动、唤醒、任务、发布 | 取消未完成启动、worker、集成进程与匹配的后台 jobs；未接受 Proposal 按 §8.4 收束；取消的 Verification 记 `interrupted`；核对 Git ref 与 domain | **还在停**，不能宣称已停止；无法确认静止就保留该状态并给诊断 |
| 5 | 终态（§10.1） | 不再唤醒 | result 分支定格 | `completed`：finish 验证通过 + finishRequest 有效 + acceptedHead 未变 + 已静止；`paused`：不跑模型/测试，deadline 数值仍推进；`stopped`：用户 stop 或预算耗尽，交付已接受结果与未完成列表；`failed`：基础设施不可继续。其中 `paused` 是唯一可 resume 的状态；`completed`/`stopped`/`failed` 都是终态 |

## 4. 情景题

**a. 两个 worker 用同一 revision 领取同一任务**（§6.3 状态图与 CAS、§4.3、§12.3-1）
只有一个能成功；另一个拿到 stale/claimed 错误。CAS 以 `expected_revision` 比较，成功后 `Task.revision` 递增，因此"同一 revision 第二个 claim"必然失败。没有自动重新分派。

**b. worker inactive 但仍有任务**（§6.3 第 283 行与第 282 行的 release 规则、§7.5、§10.3、§12.1）
inactive、turn 结束、普通等待**都不会**释放 owner，v0.1 无租约回收。若它是"无故结束 turn 却仍持有工作"，runtime 可以发一次明确协议提醒；没有新状态仍反复结束则暂停该 run 并报告。于是顺序是：run 进入 paused 且该 worker 已静止 → 由 `Run.ownerSessionId` 验权的用户执行 `/swarm task release <id> --revision <n> --reason <说明>` → CAS 把任务变 `open`、清 owner、追加带用户理由的事件（不删 worktree、不丢未提交文件、不移植旧代码）→ `resume` 后由另一个已有 worker 自主认领。若任务是 `proposed`，须先按 §8.4 中止候选回到 `claimed` 才能释放。**注意**：文档断言"另一个 worker 认领"，但没有排除原 owner 再次认领的机制（见 6.B2）。

**c. 读到 42 后登记等待，43 在 turn 结束前到达**（§7.3 步骤 4–7、§7.4）
`wakeTargetSeq = max(旧值, 43)` 与事件落盘在**同一次** run 更新中完成，因此这是持久 pending，不是内存通知；`swarm_wait` 已 `concludeTurn` 让出。Delivery 模块为每个 worker 维护串行 Promise 队列，用 `activation.result` **和** 已核验的 `subagent/end`（`info.id` 匹配 Session、`info.runId` 去重）确认这一轮真的 settled 之后，才发 owner→child 的续跑通知。所以 43 不丢。
观测：`waitRegistration`、`wakeTargetSeq`、`notifiedSeq`、`observedSeq` 四个游标加上事件日志。避免双重恢复：同一 worker 队列串行 + 同一轮 settled 标记合并 `activation.result` 与 `end` 的两次通知 + 活跃 activation 内 `wakeTargetSeq <= notifiedSeq` 不重复发。确认覆盖后清 pending；若 activation 结束仍未被 ack，保留 pending 供下次重投，连续两轮无确认或无进展则暂停报告。**可观测性的缺口**见 6.B6：`/swarm status` 要暴露哪些字段没有定义。

**d. 本地检查通过但组合代码测试失败**（§8.2 第 4–5 步、§8.4 表第 1 行、§12.3-7）
`resultRef`/`acceptedHead` 仍是 H，不推进；Proposal → `rejected` 并保存诊断（`diagnosticsRef`）；`Verification.status=failed`；Task 回到 `claimed`、保留原 owner 继续修复并重提；run 仍是 `running`，**不** 变 failed（"正常代码失败不等于整个 run failed"）。若失败发生在 pause/stop 已取得控制临界区之后，则不是代码失败，记 `interrupted`、`reason=interrupted_by_*`。

**e. Git ref 已推进但业务记录未更新就崩溃**（§8.3 表第 3 行、§10.1 末行）
重启后未终止 run 默认 paused。恢复时若观察到 "resultRef 已是 M" **且** 存在精确匹配 M/H 的持久 `validated` 记录，则补齐 acceptedHead、Proposal accepted、Task done —— 在**一次**记录更新里完成，**不再合并一次**。若缺少匹配凭据或 resultRef 是别的 SHA，暂停并报告外部修改/不确定，不覆盖、不猜成功。边界歧义见 6.B3。

**f. 用户要求停止，同时唤醒与集成都在进行**（§8.4 全表、§10.1 优先级、§10.2、§10.3）
两类短操作共用一个进程内 `publicationGate`，但 gate **不包** 模型调用、构造候选和测试。
- 控制临界区先取得：持久化 quiescing、关 admission、定 target；正在合并/测试的候选被中止，result 不推进，Proposal→`rejected`（`reason=interrupted_by_pause/stop/budget`），Task→`claimed` 保留原 owner；已持久化 validated 但未取得发布 gate 的 M 同样不发布，恢复后作者须重新 submit。落点：Proposal=rejected、Task=claimed、Verification=interrupted。
- 发布临界区先取得：它先完成 ref CAS 与 domain 补齐（accepted M、Task done 保留，不回滚），控制请求随后关 admission 并收束其余候选；对用户仍报 `stopped`/`paused`，**不因此改称 completed**。
- 唤醒侧：admission 关闭后不得登记新启动；已登记的启动必须取消并等待收尾，否则不得确认 paused/stopped。队列里已排的续跑通知按 run 是否仍允许启动丢弃。
- 报告时机：只有 quiescing 完成、且 ref 与 domain 核对一致（或明确报告不确定）才能报"已停止"；ref 结果不确定则保持 quiescing 给诊断，不假装停成功。成功必须走到 `completed`（finish 验证通过 + finishRequest 未被取消 + acceptedHead 未变 + 资源核对静止）。

**g. 只有 research 任务、acceptedHead 没有验证记录**（§8.5、§10.2、§12.3-12）
research 任务用 `research_complete` 进 `done`，不进 Git 队列。finish 受理后若无匹配的成功记录，就创建 `Verification(purpose=finish, commit=H)`（此处 H 可以等于 baseCommit）：不建假 Proposal、不移动 resultRef、不把任何 code Task 凭空标 done，只共用集成工作区的串行队列 checkout H 跑固定 setup/test。通过 → quiescing → completed；失败 → 清 finishRequest、原子创建真实 code 修复任务并回 `running`；被 pause/stop/预算打断 → `interrupted`，不创建虚假缺陷任务。

**h. paused 已过期 vs 预算耗尽后 stopped**（§10.1、§12.1、§1.2）
paused 过期：**保持 paused**，只标记预算过期；`resume` 必须显式 `--budget` 追加时长（新 deadline = 当前时间 + 时长）。budget_exhausted 进入的 `stopped`：终态，`resume` 一律拒绝；要继续只能以当前 acceptedHead 为基线**新建 run**（新 run 是否继承 goal/验收未定义，见 6.B4）。

**i. 对空闲 Agent 只调用 inject**（§9 表 `agent.inject` 行、§12.3-17）
`agent.inject` 只把上下文排入下一步可读内容，**不会唤醒**，空闲 Agent 仍然空闲；必须再用 `agent.steer()`/`followup()` 才能启动模型。把 inject 当唤醒用会得到"任务永远不动"的静默故障。

**j. 等待指定任务时，未关联的普通发现 vs 直接消息**（§7.2 表）
selected 模式下：发给自己的直接消息**总是匹配**（不受 ID 列表限制），立即返回并唤醒；其他 worker 的 Finding 只有在 `Finding.taskId ∈ task_ids` 时才匹配 —— 未关联该任务的普通发现不匹配、不唤醒，仍作为一个事件留在日志里，等下一次 `swarm_sync` 或普通工具调用顺带读到（无等待登记的运行中 worker 也是这样读增量）。同理 `acceptedHead` 更新只有在 `proposal_ids` 命中时才唤醒。

## 5. DSH 已有能力 vs 插件需新增

**DSH 已提供**（§9 表，作者称已在 0.2.1-rc.4 核对）：`subagents.startActivation`（spawn/parent/cwd/preset/caller delivery）、`subagents.sendMessage`（仅相邻父子）、`subagents.drainChildren`、`activation.result` 与 `subagent/end`、`agent/created`（serial）、`worktrees.create`（会切调用者 cwd）、`workingDirectory.set`、`exec.concludeTurn`、`agent.inject`（不唤醒）、`agent.steer`/`followup`、`storageDomain` 的 `table.update`（单记录串行、无跨表/跨进程事务）、`jobs.list/kill/wait`、`subprocess` 句柄、`sessionProjections`；以及模型调用、工具、Session、权限/sandbox 基础设施。

**插件必须新增**：①`Run/Worker/Task/Finding/Message/Proposal/Verification/Event` 聚合模型与 CAS revision、业务 `seq`、幂等 receipt；②10 个 `swarm_*` 工具及其 phase 校验、身份取自 `exec.agent`；③Delivery：增量投递、`offeredSeq/observedSeq/wakeTargetSeq/notifiedSeq` 四游标、§7.2 匹配表、每 worker 串行 Promise 队列与 activation 收尾去重；④workspace：三处 worktree 布局、初始化顺序与 cwd 迁移、恢复时"核对并复用"；⑤integration：Proposal 队列、候选 M 构造、setup/test 执行与凭据、`publicationGate`、ref CAS、§8.3 恢复；⑥runtime：phase 机、控制门禁与 admission、quiescing、预算、worker 创建/恢复/停止；⑦`/swarm start|status|pause|resume|stop|task release` 命令与 `swarm-worker` preset、bundle/Cordis patch、后续只读看板。

**我认为的最先三步**（与 §12.2 的 M1→M3 一致，落到可交付粒度）：
1. `store.ts` + `runtime.ts` 骨架：单 run 聚合记录、reducer 内完成"检查-修改-revision-seq-事件"、phase 转换表，用 fake Agent 验证 CAS 与"inactive ≠ 任务完成"。
2. `workspace.ts` + §5.3 初始化：在 worker 第一次模型请求前完成隔离、`resultRef=baseCommit`、owner cwd/index 不变、初始化失败不降级、停止后不再产生模型调用。
3. `collaboration.ts` + `delivery.ts`：Task/Finding/Message、`swarm_wait` 三种竞态（登记前、收尾前、收尾后到达）与"不双重恢复"。

## 6. 歧义、矛盾与缺失决策

### 6.1 真正会阻碍"照着实现正确流程"的项

**B1（最严重）任务没有作废/取消路径，而完成条件要求"所有 Task 都 done"。**
§10.2 受理条件是"所有 Task 都 done"；§6.3 状态图里 `done` 只有两条入口：code 任务随 Proposal 被接受，research 任务靠 `research_complete`。`open` 任务只能被 claim，`blocked` 只能由某人 `unblock`，`claimed` 只能由 claimer 自己 `release`。用户唯一的强制手段 `/swarm task release` 在 §6.3 被限定为"只在 paused、该 worker 已静止、任务为 claimed 时有效"。于是"某个 worker 先建了任务、后来发现不需要"或"任务被 block 后无人再碰"会让 run **永远无法满足 finish 受理条件**，且没有任何被定义的操作能解除。这不是编码细节，是成功路径上的洞。

**B2 释放后原 owner 可以再次认领，与 §6.3 的断言不一致。**
§6.3 写"resume 后由另一个已有 worker 自主认领，原 worker 同样受最新 revision 约束"。受 revision 约束只保证它拿**旧** revision 会失败；它完全可以读最新 revision 再 claim 一次。文档没有定义任何排除机制（例如 release 事件对原 owner 的可见性、或 claim 时排除指定 worker），所以情景 b 的确定性答案缺了一半。

**B3 §8.3 行 2 与 §8.4 行 2 对"已验证但未发布的 M"给出相反结局，区分只靠一句话。**
§8.3 行 2：resultRef 仍是 H、存在持久 `validated M` 时，"在明确 resume 下继续 CAS"（即可以发布这次 M）。§8.4 行 2：validated M 已持久化但发布 gate 未取得时被 pause/stop 打断，则"Proposal rejected；恢复后作者须重新 submit，不能自动续发这次 M"。§8.3 末尾用"此表针对突然崩溃；已完成 pause/stop 收尾的候选按下一节"来切分 —— 但 §8.3/§10.1 同时规定"重启后未终止 run 默认 paused"，即崩溃恢复本身也是一次 paused；到底靠 `Proposal.status` 是否为 rejected 来判别，还是靠"是否走过 quiescing"，文档没说。同一句里"补齐记录"（行 3）与"必须 resume"（行 2）的先后也未被统一定义：paused 状态下能不能先做 domain 补齐（它不动 ref）？我倾向可以，但这是我在补规则，不是文档给的。

**B4 worker 自身故障与"基础设施错误"的边界、重试策略缺失。**
§10.1 只有"无法继续的基础设施错误 → failed"，§7.4 只有"连续两轮没有任何确认或业务进展则暂停报告"，§7.5 只有"反复无故结束 turn 则暂停 run"。单个 worker 的模型报错、工具异常、Session 崩溃属于哪一类？重试几次？是否影响其它 worker 继续？没有规则。另外 run 已处于 stopped（budget_exhausted）后"以 acceptedHead 新建 run"时，新 run 是否继承原 goal/acceptanceCriteria/verificationConfig、是否重算 deadline，也未定义。

**B5 启动的结构化输入没有投递机制。**
§5.1 要求 goal、acceptanceCriteria、repository、baseCommit、workers、budget、verificationConfig 全部明确；§12.1 承认 `/swarm start --workers 2 --budget 30m <目标>` "不能仅靠上述短命令隐式猜出它们"，但没给出用户实际怎么给（结构化表单？preset 配置？第二个 JSON 参数？）。同时 §5.1 的"工作区有未提交修改时默认拒绝，用户可明确选择仅以已提交基线运行"也需要一个交互载体，文档没有。

**B6 `/swarm status` 的字段集未定义，而情景 c/f 要求"可观测"。**
§12.1 只说"v0.1 的 UI 可以只有命令和文本状态"。但 §7.4 与 §8.4 的实现正确性依赖用户/开发者能看见 `wakeTargetSeq`、`notifiedSeq`、`observedSeq`、`waitRegistration`、`quiescing` 的 target 与原因、ref 与 domain 是否一致。文档没有列 status 必须输出什么，也没有给"停止进行中"以外的进度语义（§8.4 只要求 UI 先显示"收到停止请求，正在处理"）。

**B7 finish 的并发与重复调用未定义。**
`Run.finishRequest` 是单字段，§10.2 只说"Host 在一次 run 更新中保存 finishRequest 并进入 draining"。两个 worker 同时 `swarm_finish`、或 draining 期间再次 finish、或 finish 受理后 `swarm_submit` 被 phase 拒绝时报什么错，都没有幂等/冲突规则。§6.2 也没给 `swarm_finish` 的"已受理"返回值形状（只有 §8.5 的"正在验证，verificationId=…"）。

**B8 `offeredSeq` 的"连续事件区间上界"与定向 Message 的可见性冲突未澄清。**
§7.1 把 `offeredSeq` 定义为"已通过模型可见投递提供的**连续**事件区间上界"，但 Message 有 `targetWorkerId`（§4.2），worker 不应看到别人的私信。那么每个 worker 的可见流是"过滤后仍连续"还是"原 seq 上有空洞"？`swarm_sync(ack_seq)` 的 ack 语义、分页 `throughSeq/hasMore`（§7.1）都压在这条定义上，读的时候必须自己选一种解释。

### 6.2 可以在编码时查类型 / 写测试解决的项（不阻碍理解）

- 全部 `swarm_*` 工具的确切 input/output schema、`startActivation` 的 spec 字段、`storageDomain` 的 reducer 类型、`subagent/end` 的 `info` 形状：文档已声明为编码阶段核验事项（§9 末、§13），并可 `cordis_inspect_*` 确认。
- 集成 worktree 的创建归属：§5.3 第 5 步让**第一个 worker** 先 `worktrees.create` 集成 worktree 再切回源仓库 —— 而 §9 表说 `worktrees.create` "会切调用者 cwd 且从其当前 checkout 找仓库"，`workingDirectory.set` 的生效时机是否足以让第二次 create 仍落在源仓库，属于要写测试验证的实现风险，不影响流程理解。
- 谁在何时驱动集成队列（submit 返回后事件驱动还是队列轮询）、单条聚合记录每次更新重写 `events[]` 的容量/性能、`verificationConfig` 指纹算法、setup/test 超时与取消的实际实现：属工程选择。
- run 开始时给 worker 的第一条输入文本（§5.3 第 6 步只说"允许开始"）、Finding 摘要的格式与 `swarm_sync` "任务摘要"的字段：不影响状态机正确性。
- 每批 20 条 / 约 2K token 的截断细节（§6.2 末）：可配。

## 7. verdict

**verdict: NEEDS_REVISION**
**理解信心：70 / 100**

理由：这份文档的质量明显高于一般设计稿 —— 四件事的区分（§0）、三个数字不混用（§4.3）、等待匹配表（§7.2）、stop 与发布的两种先后（§8.4）、Git 与 domain 非同一事务（§8.3）、`inject` 不唤醒（§9）都写得很硬，情景 a/c/d/f/g/h/i/j 我能**只**依据章节号给出一致答案。但我不给 UNDERSTOOD，因为成功路径上有一处实洞、一处自相矛盾的断言、一处两张表冲突且只靠一句话切分：

1. **B1** —— 任务无作废路径 + "所有 Task 都 done" 才可 finish，run 可能永久卡死且无被定义的解除手段（§10.2 vs §6.3/§6.2）。
2. **B2** —— "resume 后由另一个 worker 认领"缺少排除原 owner 的机制，情景 b 的答案不封闭（§6.3 第 282 行）。
3. **B3** —— validated M 的两种结局（§8.3 行 2 vs §8.4 行 2）区分条件未形式化，且"paused 下能否先补齐 domain"未定义；这直接决定情景 e 的恢复动作边界。
4. **B5/B6** —— 启动输入与 status 字段缺口，使"照着实现"时必须在文档之外发明用户界面契约。

其余（B4/B7/B8）属于需要补一句规则的空白，单独看不足以否掉理解。修掉 B1–B3 并补上"任务取消/放弃"动作、release 的排除机制、status 字段清单，我认为可以到 UNDERSTOOD。

（本轮为完整冷读，未接受作者解释，未据此修改结论。）