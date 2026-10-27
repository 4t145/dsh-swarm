# Round 4 冷读评审：DSH Swarm v0.1 架构文档

## 0 元信息

- 文档修订：R4 · 2026-10-28，状态自述"待实现的架构规格，不是已实现功能说明"。
- 评审模型：deepseek-v4.1-flash-1017（DeepSeek Harness）。
- 实际读取范围：仅 `ARCHITECTURE.md` 全文 653 行 / 58,463 字节，分三段（1–220、221–440、441–653）读完；另仅 `ls` 了 reviews/ 目录以确认报告落点，未打开 round-1..3、README、任何源码、Inspect 或网络资料。以下全部结论只来自该文档文本。

## 1 复述（目标、责任、交付物）

用户给一个编码目标，插件在同一 DSH Host 内起 2–4 个对等 worker：各自一个原生子会话和私有 git worktree，自行提出、认领、实施子任务，用追加式 Finding 与定向消息共享知识。没有经理 LLM：worker 决定做什么；普通程序只负责状态一致性（CAS、单调 seq、幂等 receipt）、消息投递与唤醒、资源停止、代码集成。交付物是 result 分支的 commit SHA、相对基线的 diff、验证记录与逐条验收说明，不覆盖用户原工作区。

## 2 启动到交付的时序（知识 / 代码两条链分开）

1. `/swarm start --spec`：解析 spec，把 baseRef 一次性解析成 baseCommit，检查脏工作区（§5.1、§12.1）。
2. 持久化 Run、预留 worker Session ID、注册只匹配这些 ID 的初始化监听器（§5.3.1）。
3. `startActivation` 本地 spawn，`swarm-worker` preset，`delivery:'caller'`（§5.3.2）；`agent/created` 串行，在首个模型请求前建 worktree 并切 cwd（§5.3.3–5）；resultRef←baseCommit（§5.3.6）。
4. 首个 worker 先 `swarm_sync` 取目标：目标正文经工具结果进入 Session，不是偷偷改内存 prompt（§4.4、§5.3.6）。
5. 协作循环：`task_create`/`claim`(CAS)、`publish`(Finding)、`message`、`wait(after_seq)`（§6、§7）。知识只走"业务事件 seq → offered/observed cursor → 有界摘要进模型"这条链。
6. 编码：worker 在自己 worktree 提交不可变 SHA，`submit` 固定到插件 proposal ref（§8.1）。代码只走 Git 分支与集成 worktree，与 seq 无关。
7. 集成：attempt(expectedHead=H) → 集成 worktree 合出 M → setup/test → `validated(M,H,receipt)` → publicationGate 内 ref CAS H→M → 同一次 domain 更新写 acceptedHead/Proposal/Task（§8.2）。
8. 其他 worker 由 seq 事件得知 M 的 SHA，再自己显式 merge M；`sync` 不做 `git pull`，知识传播不搬代码（§8.2.8）。
9. `swarm_finish` → 结构条件 → 复用或新建 finish Verification → draining → 通过后 quiescing(target=completed) → 资源与 Git 核对静止 → completed，交付 SHA/diff/验证/验收（§10.2、§8.5）。
10. 控制面（pause/stop/预算）随时按 §8.4 的两种临界区插入，改变 4–9 的走向，但不改写已完成的 Git 事实。

## 3 情景题

**a 同 revision 抢同一 Task**（§6.3、§4.3、§12.3.1）：在同一个 `table.update` 内对 `Task.revision` 做 CAS。先到者把 open→claimed、写 owner、revision+1；后到者 expected_revision 已不匹配或状态已是 claimed，返回 stale/claimed 错误且不写入。不会两人都成功，也不需要文件锁——任务认领与文件锁在 §0 就明确分开了。

**b inactive 仍有任务**（§6.3、§8.4）：inactive、turn 结束、普通等待都不释放 owner，v0.1 无租约回收。解除占有只有一条路：用户 pause → 等资源静止 → `/swarm task release <id> --revision <n> --reason`，以 Run.ownerSessionId 验权、CAS 后转 open、清 owner、追加带理由事件；若任务是 proposed，先按 §8.4 把候选中止回 claimed。resume 后任何已有 worker（含原 owner）都可用最新 revision 认领：release 只解除占有，**不保证换人**，v0.1 没有指定接管者或替换 worker 的命令。

**c 42 已登记、43 在 turn 结束前到达**（§7.3、§7.4）：43 落盘时同一次更新写 `wakeTargetSeq=max(旧值,43)`，pending 持久化。`concludeTurn()` 只请求结束当前 turn，不 dispose activation，所以 **concludeTurn ≠ activation 结束**。真正收尾信号是 `activation.result` 或已核验的 `subagent/end`（info.id 匹配 Session、info.runId 区分 activation），任一到达即足够，不等待两个，用"同一轮已收尾"标记去重。DSH 的结算还要 Agent 活动、pending inbox、子孙活动全结束并完成 Session flush；登记前已有 steering 会延后结算，不能把延后误报成已结束。收尾后必须经 `admitWorkerOperation` 才能发送，且 `wakeTargetSeq ≤ notifiedSeq` 时不重发——因此 43 只投递一次、只恢复一次。

**d 局部测试过、组合失败**（§8.2.4–5、§0.3、§12.3.7）：result 不推进。attempt rejected、diagnosticsRef 存真实日志，Task 回 claimed，作者结合最新公共 commit 修复后重提；run 不 failed，本地测试只是有用证据。

**e 崩溃两种**（§8.3、§12.3.9/21）：ref 仍是 H（无论是否已有 validated M）→ 一律不发布旧候选，Proposal 记 rejected(interrupted_before_publish)、Task 回 claimed、保留凭据供诊断，resume 后作者必须重新 submit。ref 已是 M 且有精确匹配 M/H 的 passed 记录、Proposal 未收束 → 一次 domain 更新补齐 acceptedHead=M、accepted、done，不再合并、不再动 ref。统一规则：只补齐"Git 已发布且有精确凭据"的事实。重启先关 admission，未终止 run 默认 paused（无法确认静止则保持 quiescing）；paused 只许读 Git 和修 domain，不许改 ref、跑测试、调模型。

**f stop 与发布/唤醒两种先后**（§8.4、§10.1、§10.3）：请求到达不等于取得 gate，界面先显示"收到停止请求，正在处理"，只有控制临界区写完 quiescing、目标终态、关闭 admission 才算停止生效。发布先持 gate → ref CAS 与 domain 补齐跑完，M 与 done 保留，对用户仍报 stopped/paused，不改称 completed。控制先持 gate → 未接受的（含已验证未发布的 M）全部 rejected/claimed，queued/running Verification 记 interrupted，passed 记录保留但不能借此发布。唤醒同理：首次创建/续跑先登记为在途操作，关 admission 后不得登记新操作，已登记的要取消并等收尾；确认 stopped 的时点是 quiescing 中资源与 Git 核对静止，否则保留 quiescing 加诊断。

**g 纯 research、acceptedHead 缺验证**（§8.5、§10.2）：finish 结构条件满足但 H 无 passed 记录时，原子保存 finishRequest 并建 `Verification(purpose=finish, commit=H)`，进 draining，工具返回 verificationId 后让出 turn；集成队列在专用 worktree checkout H 跑同一套 setup/test。通过→passed，重查 finishRequest 仍有效、H 未变、无 stop/pause，再进 quiescing；失败→failed、清 finishRequest、建真实 code 修复任务并附 FAIL、回 running；被 pause/stop/预算打断→interrupted，不伪造缺陷任务。research-only 时 H 可等于 baseCommit，不需伪造代码提交。

**h 过期 paused / budget stopped**（§1.2、§10.1、§10.3、§12.1）：paused 过期只被标记，不自动变 stopped；resume 必须显式追加预算（`--budget 30m`，新 deadline=当前时间+时长）。budget 耗尽是 stopped（终态），resume 一律拒绝；只能以当前 acceptedHead 当 baseRef 新建 run，新 spec、新预算，不继承旧目标/任务/消息。

**i 空闲 Agent 的 inject**（§9 表、§12.3.17）：`agent.inject()` 只把下一步可读上下文排入待处理队列，**不唤醒**，空闲 Agent 仍然空闲；必须 `steer`/`followup`（或经 owner→child 的 sendMessage）才启动。所以 inject 只能当"补上下文"，不能当投递手段；§7.3 明确不用 inject 给已等待 worker 堆 pending inbox。

**j selected 等待时的无关 Finding 与直接消息**（§7.2）：selected 只对 ID 列表内的 Finding(taskId)/Task(open 或状态变化)/Proposal(proposalId) 匹配；无关 Finding 不唤醒。发给自己的直接消息"总是匹配"，不受 ID 限制；自己 Proposal 的接受/拒绝也总是匹配。scope 不参与投递过滤。

**k 无效任务取消与并发 finish**（§6.3、§10.2）：运行中只能取消自己持有的 claimed 或自己创建的 open/blocked，需 expected_revision 与非空理由，不得取消别人的；暂停静止后 owner 用户可取消任意 open/claimed/blocked（含 Host 的修复任务）。cancel 是终态、保留历史、清 owner，只表示"不再需要这个工作项"，不减原始验收项，finish 报告须列全部取消理由。与 finish 并发：两者都是单次 run 更新，cancel 先落则 finish 看到"done 或有理由 cancelled"可通过；finish 先落进 draining 后，普通 task 写入返回 `SWARM_NOT_RUNNING`（cancel 是否算"普通 task 写入"文档未点名，归入 B 类）。

**l 私信空洞分页 + 启动配置/status**（§7.1、§12.1、§12.3.19）：设 observed=59，60 是全员可见 Finding，61–62 是 B→C 私信，63 是可见 Finding，页大小 1。`sync(ack_seq=59, limit=1)` 返回 [60]，throughSeq=62（扫描越过不可见的 61/62），hasMore=true；ack 最大只能到 62（offeredSeq 边界），observed 仍停在 59 直到下次显式确认。下次 `after_seq=62` 返回 [63]、throughSeq=63、hasMore=false。61/62 正文永不出现、seq 不重排；若把 63 当"可跳过"就会丢事件（§7.1"不能越过它推进 cursor"）。启动配置：JSON spec 必填 repository/baseRef/goal/acceptanceCriteria/workers(2–4)/budgetMinutes/allowDirtyBaseline/verification（setup 可空、test 必须非空，argv+timeoutMs）；status 必含 runId、phase/reason/quiesceTarget、deadline 与是否过期、baseCommit、acceptedHead/resultRef、任务计数（含 cancelled）、每 worker 真实 running/inactive/不可用与当前任务、当前 Proposal/Verification 与诊断；`--details` 才列 waitRegistration、observed/offered/wakeTarget/notified、在途启动、admission、attempt、resultRef 与 domain 是否一致、jobs。

**m wait(after_seq)、越界、清除登记**（§7.3.1、§7.4、§6.2）：合法区间 `observedSeq ≤ after_seq ≤ offeredSeq`，否则 `SWARM_INVALID_CURSOR` 且不改任何状态。合法时在同一次更新里把 observedSeq 置为 after_seq（只前进）、清被覆盖的 pending、登记 wait、按 §7.2 判事件；after_seq 就是"我已读到这里"的断言。前置：本 Session 有未结束后台 job 时返回 `SWARM_WORKER_BUSY`。清除等待登记的确定触发点：成功 sync（即主动取消等待/重新决策）、成功 claim、成功 submit、finish 被受理，均在本次更新内清除；失败调用、单纯 publish/read 不清除；没有 cancel_wait，sync 即取消；清登记不删未读事件，新 wait 重建登记。

**n H 从哪来、投递前的控制步骤**（§4.2、§8.2、§7.3.6–8）：H 是"本次 attempt 开始集成时的 acceptedHead"，写进 integrationAttempt 的 expectedHead 与 `Verification.expectedHead`，**不是** Proposal.resultRefAtSubmission；每次 attempt 独立保存、activeAttemptId 只是指针、passed 记录不可改写；purpose=finish 时 commit=expectedHead=H。投递队列在收尾后不能直接 sendMessage，必须先 `runtime.admitWorkerOperation(runId, workerId, kind)`：runtime 在控制门禁内查 phase/预算、登记在途、返回取消信号，Delivery 才执行原生发送或冷恢复，finally 撤销登记；首次创建允许 preparing/running，普通通知/续跑只允许 running；被拒则保留事件、observedSeq 与 pending，不调模型；paused 等 resume，终态永不投递；materialize 期间门禁关闭，由 runtime 取消并等待已登记操作及其发布的子会话。

## 4 DSH 已有能力 / 插件新增能力 / 最先三步

- 已有（§9）：`startActivation`、`sendMessage`、`drainChildren`、`activation.result` 与 `subagent/end`、`agent/created`(serial)、`worktrees.create`、`workingDirectory.set`、`exec.concludeTurn`、`inject`/`steer`/`followup`、`storageDomain.table.update`、jobs、subprocess、sessionProjections、sandbox/permission、`plugin_manager` 安装。
- 新增（§3）：run 状态机与预算；Task/Finding/Message/Proposal/Verification 领域规则（CAS、seq、幂等 receipt）；Delivery（waitRegistration/wakeTarget/notified 与 admitWorkerOperation）；publicationGate；串行集成与两种 purpose 的验证；worktree 布局与初始化顺序；`swarm-worker` preset 与 `swarm_*` 工具；`/swarm` 命令与 release/cancel；JSON spec 与 status 契约。
- 最先三步（按 §12.2 的可验收顺序切）：① M1 骨架——bundle/preset、Run 持久化、2 worker + worktree、首调前隔离、停止后无新模型调用（fake Agent + 临时仓库）；② M2 协作——CAS 任务、Finding、seq 分页与 cursor、wait/concludeTurn/唤醒去重；③ M3 代码闭环——Proposal、集成 worktree 合并、验证凭据、publicationGate、finish 与 §8.3 恢复表。M4 恢复/观察必须在声明支持重启前通过。

## 5 歧义分级

**A 真妨碍（需作者定，查类型解不了）**

1. §7.3.6 的"已核验的 subagent/end"没定义"核验"。对驻留 activation（"向仍驻留的 activation 发消息可能只是增加 turn"），要判断某个 end 是否属于本轮收尾；文档只说"用同一轮已收尾标记去重"，没说标记存哪（内存还是 domain）、用什么键绑定队列项。情景 c 我能给出一致答案，但两个实现者会写出不同的去重边界。
2. §6.3 的 release 要求"该 worker 已静止"，而 §10.1/§10.3 的 paused 本身已含静止核对；两个"静止"是否同一判据、命令实际查 DSH 的 running/inactive 还是只看 phase=paused，未定。§4.2 又明说 inactive 不等于可释放，命令层无法区分"inactive 但有在途工具"。
3. §7.4 的"连续两轮没有任何确认或业务进展则暂停报告"：轮的单位（两次唤醒？两个 turn？两轮 settle？）未定义，§4.2 模型也没有该计数与 pending 集合的字段，崩溃后无法延续（§7.3.7 同样要求"保留…pending"）。pending 是派生自 wakeTargetSeq 还是必须落盘，需说明。
4. §6.1.8/§8.2.8 要求下一个编码任务前显式合入 acceptedHead，但 §8.1 的 submit 只校验当前提交与工作树干净，不校验候选是否已含 acceptedHead；是有意放宽还是漏项没写，实现者会犹豫要不要加检查。
5. 措辞张力：§1.2"不面向任意非编码研究任务"与 §8.5 的 research-only 可完成，只在例子里被调和（研究任务仍须处在有 Git 基线、有测试命令的 run 内），范围章节没写这一句。

**B 查类型/写测试可解**：`worktrees.create`/`workingDirectory.set` 的签名与"从当前 checkout 找仓库"的实际行为、`subagent/end` 的 info 字段与 `activation.result` 结算时序、`swarm_*` 的 schema 与错误码全集（文档只给 4 个）、集成命令如何复用 sandbox 组合、§8.2.4"命令改动 tracked 文件"的检测方式、draining 下 cancel 返回什么码、§6.1.3"一人一个 claimed/proposed"是纯指令还是 Host 在 claim 时强制。

**C 不算问题**：未给完整类型/源码、未覆盖 LFS/submodule/多机/UI 细节——§1.3、§4.2、§12.1 已显式划界，不影响核心流程理解。

## 6 Verdict

**UNDERSTOOD**，理解信心 **82/100**。

理由：启动→认领→提交→集成→发布→finish→停止/恢复这条主链能一次读完并复述；知识传播（seq/cursor）与代码传播（SHA/merge）是两条清晰且未被混用的链；a–n 的情景我都能用文档内部条款给出一致回答，且与 §12.3 测试清单对得上。扣分点是 A1–A3：它们不阻止理解，但会让两个实现者在"双重恢复边界、release 前置判据、pending/两轮计数"上分叉，属于该在 R5 补一句定义的地方。若评审门槛是"实现细节零分叉"，我会判 NEEDS_REVISION；按"能否读懂架构与关键流程"的标准，判 UNDERSTOOD。