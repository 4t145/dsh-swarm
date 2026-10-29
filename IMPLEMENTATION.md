# 实现记录

> 当前团队上限规则见文末“R7 继承宿主的团队上限”与 [架构 §1.4](<ARCHITECTURE.md>)；公共频道协议见“R6 公共协作体系”与 [架构 §14](<ARCHITECTURE.md>)。此前各版本的安装、原型、测试数量和局限为历史记录，不代表本次结果分支已部署；旧 pnpm 临时环境开关方式已由项目配置替代。

## 基线

- 业务规格：[ARCHITECTURE.md](<ARCHITECTURE.md>) R4。
- 实现由 Lead 组织 `vast-internal/deepseek-v4.1-flash-1017` 分批并行完成；共享接口先固定，再展开独立模块。
- DSH 目标版本为当前安装版 0.2.1-rc.4。依赖其 experimental worktree API，未承诺其他版本兼容。
- 保留现有四轮冷读原始报告；已按用户要求删除评审 README，不新增 README。

## 工程约定

- Node 24.9+，TypeScript strict，Zod 4，Vitest 3；esbuild 只打包本项目代码，宿主包外置。
- 发布产物在 `lib/`，类型声明在 `lib/types/`；相对源码 import 使用 `.ts`。
- 开发时使用 `pnpm link:harness -- <当前 @deepseek-ai/dsh 安装目录>` 链接精确宿主声明，不把机器专属路径写入清单或运行代码。
- 状态核心依赖纯 TypeScript 端口，Host 适配层使用真实 DSH Service；测试 fake 不能进入默认生产运行路径。
- 单元测试使用临时仓库、fake Agent、可控时钟/Promise；真实宿主加载与真实模型工作另行验证和报告。

## 已固定的接线细节

以下事项在当前实现中有具体处理及测试，不再以冷读自评作为完成依据：

1. activation 收尾去重以真实 subagent runId 为键，进程内记录；重启不复用旧内存标记，从持久事件与确认位置重算通知。
2. paused 的资源静止确认与用户任务 release/cancel 使用同一控制面判据，不能仅看 inactive。
3. 无进展计数以真实 settled activation 为轮次，记录该轮前后的 observedSeq/业务进展；不是每次模型 step。
4. worker 指令要求新编码任务前合入 acceptedHead；集成仍以实际当前 acceptedHead 构造候选，不把迟到候选误判为已集成。
5. 一个 worker 最多持有一个 claimed/proposed 任务，是 Host claim 时强制检查，不仅是提示词。

## 实现与审查结果

- 已完成 state/spec/schema、事件匹配、协作业务、串行投递、Git 工作区、验证/恢复、Run 生命周期、DSH 命令执行器、原生 worker 适配、9 个工具、专用 preset、用户命令和 bundle。
- 14 个并行任务由指定的 DeepSeek 模型承担，Lead 负责共享端口、构建、资产、合并审查与接线修复。三个成员在落盘前耗尽上下文，改用更小任务、局部章节和低推理配额重派，未把失败尝试算作交付。
- Root 的 Cordis 开发 symlink 对齐实际宿主实例，避免模块增强与服务注册分裂。Zod 精确固定 4.4.3，避免与目标 storageDomain 的类型版本冲突；修正后普通 `pnpm typecheck` 不再需要 8GB 堆。
- 独立串联测试暴露并修复了缺失的 resultRef 初始化；额外修复同仓并发 start 的原子保留、暂停后无新事件 worker 的明确续跑，以及 worker 异常暂停而非错误地永久终止 run。
- Finding 类型已统一为 observed/fact/fail/patch_summary；不是基础草稿里的 info/decision。
- 原生 jobs.list 会包含 unowned 作业，停止逻辑已显式要求 job.owner 等于 worker Session，避免误杀全局或其他 Session 的作业，并有回归测试。
- 停止与发布共用门禁；只有隔离的集成工作区会被重置。worktree 与分支按设计保留。Git、测试和创建目录走原生 sandbox/permission 服务；没有生产 child_process 或供应商 API 旁路。
- 选择架构方案 A：首个 worker 初始化期间创建集成树并返回源目录，再建立私有树；不改变用户 owner 的 cwd。不采用自己重写 worktree 创建流程的方案。
- worker 权限继承原生子会话，审批为 never；不能自我升级。preset 不可用时冷恢复失败，不静默回退。当前 profile 的全局 MCP 仍可能继承，不宣称工具列表或 worktree 构成恶意代码沙箱。

## v0.1 历史验证（当前结果见文末）

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test` | 15 个测试文件、200 项通过 |
| `pnpm build` | Host/worker ESM 与声明发射通过 |
| 真实临时 Git 仓库端到端 | 双 worker 独立提交→验证合并→finish 成功；失败候选不推进→修复重提成功；用户原 HEAD/index/status 保持 |
| 当前 Host 加载检查 | runtime ready、命令、worktree 服务、preset 9 工具可用；缺失的 search 配置已修复 |
| 最终构建加载代际检查 | **当前进程仍是旧 JavaScript，重启必需**；报告 latestWorkerFailurePauseCode=false |
| 真实模型自主编码任务 | 未执行；不把 fake WorkerHost 的测试说成真实模型端到端 |

原生检查见 [native-smoke.json](<notes/native-smoke.json>)。测试 bundle 是一次性 fixture，故未配插件展示元数据/图标；安装和配置已移除，管理器要求重启完成当前进程清理。正式插件已安装并保留启用；重启 DSH 才载入最终构建，不能靠页面刷新替代。源码和构建验证通过，不等于已完成真实模型任务或 GUI 目视验证。

## 已知 v0.1 限制

- 用户界面只有 slash commands，没有独立 Swarm 看板；成功结果以分支/SHA 和 status 报告交付，不自动合入用户主分支。
- 当前测试平台为 Linux/Node24/DSH0.2.1-rc.4；Git 使用 --no-lazy-fetch，要求较新 Git。其他平台/版本未验证。
- 恢复会核对 Git/ref/凭据并暂停，不自动调用模型或补发未发布候选；对进程外、不受 DSH 管理的残留服务不保证自动清理。
- 源代码目录最初没有 Git 元数据，因此本轮没有伪造 commit 或声称已做 git diff 审查；Lead 直接审查模块及其测试，所有破坏性 Git 测试只在临时仓库运行。
- 保留架构和冷读报告作为设计依据；最终实现事实以源码、测试和本记录为准。

## v0.2 增量（进度面板、owner 工具、headless 驱动）

- `src/progress.ts`：`ProgressService`/`registerProgress(ctx, runtime, store)` 以 `swarmProgress` 服务暴露只读 `snapshot(sessionId)` 与事件驱动 `watch(sessionId, signal)`；DTO 只含 phase、预算、task 计数、worker 原生状态/有界诊断、当前 task、proposal/验证计数与 finishRequest，不含私信、finding 正文、artifact 或事件日志。非 owner 抛 `swarm-progress/forbidden`，无 run 返回 `null`；订阅 store 与 `agent/status|disposed` 刷新，不轮询、不重复发帧、终态结束流。显式安装等价 Remote 标记，保留 source-fallback 的稳定具名参数，无需 Typert 代码生成。
- `client.js`：通过 `window.__ModuleLoader__.load({ id: '@local/dsh-swarm' })` 注册 `conversation.view` 的 `swarm-progress` 面板（order=5），用 strict codec descriptor `$mount` `swarmProgress/snapshot|watch`；展示 run 阶段/预算/task/worker/当前任务/proposal/验证，无 run 时给出 `/swarm start --spec` 与 `swarm_manage` 提示；使用 DSH 主题 token 与 zh/en 文案，不编造百分比或把 inactive 当作完成。
- `src/owner-tools.ts`：`swarm_manage` 的 start/status/pause/resume/stop；身份来自 `exec.agent`，子会话与 delegationDepth>0 一律拒绝，start 只接受显式内联 spec 或 spec_path，并与命令共用同一个 Runtime。
- `src/headless.ts`：`runSwarmHeadless(runtime, ownerSessionId, spec, options)` 只在整个 run 进入 completed/stopped/failed 后结算；输出有界 JSONL progress + final；abort 停止本 run 并等待静止；worker/agent idle 不是完成信号。
- `src/headless-args.ts`、`src/headless-driver.ts`、`cordis.headless.yml`：独立 app 入口创建 owner Session、解析 spec、调用 headless 驱动并退出；overlay 禁用自带 `headless-startup`/`headless-runner`，挂载 preset registry，使用独立 `local_swarm_headless` 存储域。
- `src/index.ts`：注入 `tools`，在 runtime ready 后注册 owner 工具与 progress 服务，并在 `closeResources` 中释放；新增只读 `observer`，供 driver 订阅持久 run。
- `package.json`：新增 `./headless`、`./headless-app`、`./client` 导出与 `dsh.client { platform: 'web', inject: [...] }`，`files` 包含 `client.js` 与 `cordis.headless.yml`。
- 修复 storageDomain per-record 键：artifact id 由 `swarm-artifact:<uuid>` 改为 `swarm-artifact-<uuid>`，冒号不在路径安全字符集内，旧格式会在真实集成保存验证诊断时把 run 判为 `infrastructure_error`。
- 早期检查为 typecheck/build 与模块测试。保存的一个 headless 流程记录显示 `completed`，但缺少其模型路由佐证，不作为真实模型验收依据；最终验证边界以下节为准。当前 Web 进程仍缓存旧 Host 类，不能把安装清单的 v0.2 版本号当成新运行代码已经加载。

## v0.2.1 收尾与真实运行发现

- 已初始化本地 Git，基线 `06ae132`。真实自举 run `69418f0e-de5c-402c-baee-3d3db3fae725` 用两个 `vast-internal/deepseek-v4.1-flash-1017` 原生 worker，各自独立 Session/worktree。它们通过消息解决了重复选题，产出 `b04e3cc`（headless/owner 工具）与 `74b52e3`（进度服务/Client）两个提交。run 因 artifact 键不兼容真实存储而失败；由 Lead 审查合入，不冒充 Swarm 自动集成成功。
- 修复该存储键，并增加实际 `JsonStorageBackend` per-record 回归测试。新增 headless JSONL revision 单调性检查，避免在当前快照之后倒放启动缓冲区。
- CLI overlay 现在可单独叠加到内置 headless profile，不要求另一个 profile 已安装此包。原生 preset registry 会以 profile 为 base URL 解释嵌套路径，因此由小型 Host 插件注册同一 worker 组合，并用 `import.meta.url` 固定 worker 入口；不把 Loader 表达式塞进不会插值的 preset `plugins` 字段。
- 模型路由按 profile 配置。实际读取原生 Session 日志确认默认 headless 的 `vast-internal` 失败原因为 `NO_ADAPTER`，没有调用付费模型。driver 已增加启动前 metadata 检查；不能凭网页里存在该路由就假定 CLI 也可用。
- 实际 SIGINT 测试暴露全局 Launcher 先卸载 domain、后完成 run.stop 的竞态。独立 headless app 现在拥有首次中断：先取消并记录本 run 终态，再调用 appExit；重复信号委托原平台处理，卸载时恢复借用的处理器。`SwarmService.runHeadless` 同时跟踪 driver 生命周期，并通过原生 initiator 边界执行；Host 不会把正常关闭的 store 提前交给活跃 driver。
- 原生中断验收 run `4971e190-8941-4062-b02f-860c2cca0991`：两个原生 worker 到达 model stream 后发送真实 SIGINT，最终记录为 `stopped`、`aborted=true`、`error=null`，记录与进程退出码均为 `130`。模型端是明确的阻塞测试 adapter；这证明退出链路，不是假称真实模型编码成功。
- Client 只依赖宿主 React，style 随组件卸载，使用 strict descriptor 挂载 Remote；包声明 `immediately=true`。重启 DSH 后实测：标签位于“对话”与“轨迹”之间，但面板报“未接线”。原因是 `$mount` 安装的是独立的 `remote.swarmProgress` 服务，经 `ctx.remote.swarmProgress` 读取会触发 Cordis 的 inject 检查而抛错；mock 测试未覆盖。现改用 `ctx.get('remote.swarmProgress')`，失败时显示真实错误，并新增 `tests/client-remote.test.ts`，用真实 typert-registry 与 api-gateway Client 回归。刷新页面后用户实测：空态正确显示“当前没有 Swarm run”。
- 最后完整检查：typecheck、23 文件 / **267 项测试**、build 全部通过。`pnpm test:native-headless` 在全新临时 DSH_HOME 中验证缺失路由提前失败、两个原生 worker 的 SIGINT→持久 stopped→退出 130，原 checkout 不变；该脚本使用阻塞测试 adapter，不调用付费模型 API。所有临时 Web probe bundle 已移除，正式包保留启用；管理器仍明确要求重启完成代码代际切换。

## 2026-10-28 当前环境安装与真实模型验收

- 重新安装开发依赖、链接精确宿主声明，初始 typecheck / 23 文件 267 项测试 / build 通过；本地 pnpm store 加入忽略规则。
- 本 checkout 通过 `plugin_manager install_bundle` 链接到当前 `web` profile。首次激活失败于重复 worktrees provider：当前 profile 已启用 `@deepseek-ai/dsh-experimental-tool-worktree`，旧 bundle 又在根 realm 注册同一服务。
- [正式 patch](<cordis.patch.yml>) 改为消费 profile 已有 provider；其他 profile 须先提供 worktrees，[独立 headless overlay](<cordis.headless.yml>) 仍自带 provider。在线尝试隔离域时失败行未恢复，没有核验干净启动下的隔离语义，不据此断言 Cordis isolate 无效。最终 reconcile 返回 applied、无 warnings，owner 工具可用。
- 用户刷新后确认“协作群”空态正常；Client Inspect 后续核验 `swarm-progress` active / order=5。
- 两次真实 `deepseek-official/deepseek-flash` 双 worker run 完成：`7288a880-e5ec-4e69-9e25-62a9a44c0971` 与 `22444773-aa43-4806-b771-a1e812be73da`。验证、SHA、模型路由和独立 Git 检查见 [验收报告](<notes/live-e2e-2026-10-28.md>)；失败重提与重复实现均如实记录，不把参与的 worker 数量等同于有效并行产出。
- 实跑发现 code task 接受后 currentTaskId 残留。[集成模块](<src/integration.ts>) 已在接受更新中清除匹配指针，保留历史 owner；[回归](<tests/integration.test.ts>) 覆盖接受、拒绝、恢复补记及不误清其他指针。[worker 指令](<src/worker-policy.ts>) 明确每次验证是 acceptedHead 合并当前 submission，不批量接受未验证的 peer proposal，遵循架构 §8.2。
- 此轮修复检查：typecheck、23 文件 / 268 项、build 与原生 headless 中断脚本均通过。原生中断使用阻塞测试 adapter，与两个真实模型场景分开。
- 新构建仍未进入现有 Host：第二次实跑仍复现旧指针，管理器随后明确返回 `restart-required / module-comparison`。须重启 DSH，不能靠刷新页面替代；没有擅自重启服务，也没有改写历史终态记录。

## 协作群面板重设计与持续进度订阅

- 本轮面板开发使用外部 DSH Agent Teams，Lead 为避免共享目录写冲突划分后端/Client 作用域；这不是 Swarm 自主拆分任务的自举验收。插件内 worker 自主创建/认领任务的协议没有更改。
- [Client 面板](<client.js>) 重设计为整体工作流、真实任务/验证/预算指标、双列 worker 卡片、任务板、公开时间线与可展开结果信息；工作流允许多个阶段同时活跃，没有把任务数转成目标完成百分比。采用主题 token、中英文文案、响应式布局、原生 details、键盘焦点和 reduced-motion 支持。
- [进度 DTO](<src/progress.ts>) 新增 protocolVersion=2、目标/起始时间、最多 40 项任务板、最近 24 条公开 task/proposal/head/run 状态事件，以及 worker 等待条件、当前提案和工具活动。私信、finding 正文、工具参数/结果、命令或推理正文不进入这些数据；旧终态任务指针在投影中隐藏，不改写历史记录。
- [原生活动投影](<src/worker-activity.ts>) 通过真实 sessionProjections 增量处理 turn/step/tool 事件；只保留工具身份、名称、状态、时间，当前工具最多 16 个、最近 8 个。超限时保守保留截断/调用中状态至 step/turn 结束，不能因列表裁剪误报空闲；native inactive 覆盖残留执行状态。Host [入口](<src/index.ts>) 显式依赖 sessionProjections，注册与监听器随插件卸载清理。
- 新增 Remote `watchSession(sessionId, signal)` 持续跟随同 owner 的后续 run；旧 `watch` 保持终态结束语义。只订阅相关 worker/业务变化，并忽略仅快照时钟变化产生的冗余帧；取消在 generator 暂停于 yield 时也会立即解除订阅。
- Client 使用持续订阅，只有确认新版 endpoint 缺失时才回退旧 watch；权限/网络错误不能伪装成兼容成功。断线、坏帧或流结束时保留最后快照并标非实时；切换 Session 立即屏蔽旧帧。倒计时只用本地 timer，无 Host 轮询；终态或断线冻结，组件卸载清 timer/stream。真实 Remote mount 的 namespace、slot、locale 与异步卸载均有生命周期回归。
- 最后实际检查：`node --check client.js`、`pnpm typecheck`、`pnpm test`（25 文件 / **308 项**）、`pnpm build`、原生 headless 缺路由与 SIGINT 回归、`git diff --check` 全部退出 0。覆盖真实 ProjectionRegistry 与 Remote client 的集成测试，但不把它们当作浏览器截图或真实模型 UI 验收。
- 构建后再次 reconcile：`restart-required / module-comparison`，无 warnings，随后用户重启 DSH 并确认面板可见。尚未进行新版面板下的新 run 实时目视验收及明暗主题/窄屏检查；未启动替代服务器或额外浏览器。

## Agensh 式自主协作原型

- 按用户要求先实现原型，不再做评审循环、全套测试或新增真实模型 run。本轮修改范围：[worker-context](<src/worker-context.ts>)、[worker 入口](<src/worker.ts>)、[协作指令](<src/worker-policy.ts>)、[Delivery](<src/delivery.ts>)、[原生消息适配](<src/dsh-worker-host.ts>) 及对应说明。
- 在专用 worker preset 的真实 `tools/post-execute` waterfall 中先调用 next，保留既有 accept/block/value/content 决策；仅在合适的成功工具边界通过 additionalContexts 附上同伴发现、工作声明、本人可见消息与结果更新。用户 owner 不挂该监听器；等待、finish、取消及非 running 状态不注入。普通工具结果不被改写，提示读取失败只给可见诊断，不把已执行工具伪装成失败重试。
- 摘要有界，默认每批 6 条、正文片段 400 字符，worker Config 可调整；私信按原 audience 过滤。WeakMap 以真实 Agent 对象记录临时去重位置，不改持久 offered/observed、不自动确认、不清除 wait。明确提示用 sync/read 展开及确认；恢复可重投，提示内容不是新的 owner 指令。
- 指令改为同权 peer 的观察→选题/认领→协商→实施/分享→验证/集成→再观察循环，空任务板不等于没工作；允许同伴自主形成评审/协调分工，但不新增经理模型。
- Delivery 在普通 activation settled 后，如未等待、没有已投递唤醒、资源空闲且 run 仍 running，则通过同一 worker 串行队列和 admission 发送自主续工提示；不分派具体任务，不使用轮询 timer，保持连续无进展暂停和停止/预算门禁。显式 wait 仍只由匹配事件恢复。
- 保留现有候选验证规则，没有借“先做原型”取消用户指定的运行时测试。也未实现任意追加新目标或跨 run 的永久 worker 池。
- 本轮实际执行 `pnpm build`（含源码声明编译）和 `git diff --check`，退出 0；没有运行新增行为测试或模型端到端，因此此前 308 项结果不代表本轮新增行为已经验收。

## Swarm 自主 UI 改造与工程默认不限时

- 用户授权将原型保存为本地基线 `1cb9c0a`，再以共同 UI 目标启动 run `34f42056-e660-4ebc-8d0c-de3c0b733cf7`。两个 worker 自行创建/认领任务、直接协商，并分别提交成员工作卡和整体交付/任务/活动视图；Lead 没有预分配模块或参与其实现。
- Host 自动接受两份提案，结果 SHA `1e357e7ef1ee99069ba0de04fd2ec5aa9d92c2a5`。此轮只配置 `node --check client.js` 作为运行时门禁，两份均通过。最终 run 在 finish 提交前因 Lead 设置的 20 分钟墙钟截止进入 stopped(budget_exhausted)，不是 completed；不伪称整体或视觉验收成功。
- 经用户再次明确确认，结果分支已快进合入 main，未推送远端。UI 增加成员聚焦、任务/活动筛选、常驻交付版本，减少重复说明文字，区分任务归属、原生状态和可证实的工具活动。
- 用户指出实验预算不应成为工程任务的默认生命周期。现改为省略 budgetMinutes 或设为 0 时 deadline=null，不注册到期 timer，启动/恢复/提交/集成/最终验证都不因墙钟截止被拒绝；正整数时限仅供用户明确选择及兼容历史记录。单命令 timeoutMs、用户停止、故障/无进展处理保持原规则。
- null 截止贯穿持久 schema、status、headless、命令和进度 DTO；Client 在不限时模式显示运行时长/无截止时间，不显示虚假的 0 秒或过期提示。旧 numeric deadline 记录不被迁移或复活，已 stopped 的历史 run 仍为终态。
- 默认示例去掉分钟数，owner 工具参数明确不让模型自行选择时限。本轮仅执行 JS 语法检查、源码构建及 diff 检查，没有新增模型 run 或运行全套测试。

## 动态成员与可读姓名

- owner 的成员面板通过现有 `commands.execute` 调用 `/swarm worker add --json`；运行时在与停止/finish 共用的门禁内预约，保持每轮上限 4。运行中走现有 Delivery 创建/admission/取消路径；暂停中只保存，显式 resume 才创建。worker、子会话、只读和已取消的命令不能使用此控制入口。
- 名字为随机英文形容词 + 动物词，保存于 WorkerRecord.displayName 并保证新成员在轮内不重名；进度 DTO 与原生子会话 label 使用同一个名字。历史记录无该字段时使用由稳定 ID 推导的可读后备名字，不修改身份或分支。新建 worktree 基于创建时的 acceptedHead，不从过期的原始基线开始。
- 并发追加严格检查人数，pending 初始化阻止过早 finish；原生创建失败沿用既有 failed 收尾语义并保留成员/目录供诊断。暂停/停止中断新增不会被错误升级为失败。错误回执提示先核对成员列表，不建议盲目重试。
- 回归覆盖名字碰撞/历史兼容、并发上限、暂停预约/恢复、owner 权限、失败和停止竞态；不声称这些 fake 测试等于当前 GUI 已部署或真实模型端到端验证。

## 持续追加目标与品牌入口

- 本轮由四个对等 Swarm worker 自主协商接口与写范围：Host/持久协议、owner 工具/命令、面板/图标、生命周期回归/说明。没有修改 DSH 源码、profile、凭据、依赖或 lockfile，也没有安装插件或启动服务器。
- [Runtime](<src/runtime.ts>) 的 `appendGoal(ownerSessionId, input, callId)` 是共同业务入口；[owner 工具](<src/owner-tools.ts>) 的 `swarm_manage action=append`、[slash 命令](<src/commands.ts>) 和[面板](<client.js>) 复用它。面板通过真实 `commands.execute` 使用当前 Session；不是伪造 SessionEvent 或绕过 permission。owner 身份来自实际调用 Agent，worker/子会话不取得控制权。
- 原始 `Run.goal` / `acceptanceCriteria` 不改写。新增目标有持久 ID、事件 seq、正文、验收项、状态与完成/后续 run 关联；缺省验收为正文。running/preparing 的追加进入本轮，paused 的追加已保存但不唤醒；draining/quiescing/终态收到的目标是 deferred，不混入旧 finish。工具与 UI 区分 executing / paused / deferred，失败直接报告，不将拒绝包装为成功。
- active 目标形成当前验收集，finish 和 Verification 绑定 `goalRevision`；有追加目标时，worker 必须用 sync 返回的当前 revision 提交 `goal_revision`，即使新增验收文字与旧验收重复也不能沿用旧请求。旧 revision 的代码验证不可冒充新目标验收。收尾只完成 active 目标；deferred 保持待继续。明确 `continue` 才从旧 acceptedHead 开新 run，保留历史目标到新 run 的关联；停止/故障不隐式复活，默认仍不限时。
- [协作同步](<src/collaboration.ts>) 支持目标的正常 sync/read/search；公开 goal 事件进入 worker 知识与唤醒路径，新增工作由 worker 自主组织，不需要 owner 给每个 worker 派单。旧记录通过 schema 默认值保持可读，原验收历史不被覆盖。
- [品牌资源](<icon.svg>) 与面板使用原创 SVG；当前宿主 `CommandDefinition` 只有 name/description/input/handler，没有自定义 icon 字段。slash 描述使用简洁符号，未修改宿主 DOM，也不声称菜单左侧支持自定义 SVG。面板沿用中英文、主题 token 和原生可展开结构。
- [目标回归](<tests/goals.test.ts>) 使用真实 Runtime、Store、Delivery、IntegrationQueue 与 fake effect ports；验证/停止竞态使用显式 Promise 屏障，不用真实模型、轮询或 sleep。16 项定向回归通过，覆盖所有追加阶段、暂停收尾后的显式恢复、continue/append 交错、旧验证与重复验收文字、持久历史和 worker wait/sync/read。此贡献同时通过 `node --check client.js`、`pnpm build` 与 `git diff --check`；未跑全项目测试或另开模型 run。原生 GUI 目视与当前进程部署仍由 Lead 另行完成，源码测试不等于已加载新 Host。

## 自然语言前台 Agent

- [owner-context](<src/owner-context.ts>) 通过正式 systemPrompt section/context 接入普通顶层 Agent；委派/worker 会话不获得前台指令，也不读取其他 owner 的运行。Host [入口](<src/index.ts>) 显式注入并在卸载时释放两项贡献。
- 前台代办目标澄清、启动 spec、追加需求、进度问答、暂停/继续及结果收集；不要求用户输入命令/JSON，不变成给各 worker 派工的经理。咨询和暂定想法不等于执行授权；命令和面板仍是备用入口。
- 当前状态由原生 prompt 管线刷新并日志化，仅包含阶段、任务计数、结果引用和最多 6 个待处理目标摘要，不搬入完整消息/事件历史，不新增轮询或模型唤醒。只在用户/现有驱动触发前台下一步时更新，不宣称新增全天候主动通知服务。ACK 协议保持原样。
- 空态文案改为直接对话引导。[关键回归](<tests/owner-context.test.ts>) 覆盖 owner/worker 边界、有界只读状态、缺失/失败区分与注册清理；本轮仅构建与定向检查，不另开模型验收。

## 工作树页签：无 run 的仓库工作树与创建

- 现象：面板的 Git 工作树历史依赖 `swarmProgress/worktreeHistory`；旧进程未加载该 Host 方法时直连报 HTTP 404。该方法在 `ac1da67` 已存在，错误来自进程仍运行 22:48 的旧代码，重启后消失；源码测试不能代替重启加载。
- [worktrees](<src/worktrees.ts>) 新增独立的 `swarmWorktrees` Remote：`list(sessionId)` 读取 `git worktree list --porcelain`，返回主树与 linked worktree 的相对路径、分支、HEAD 短 SHA/标题及最多 20 条最近提交；`create(sessionId, request)` 在 `.agents/worktrees/` 下新建分支与检出。两者只依赖会话工作目录，**不要求存在 run**；不调用 `ctx.worktrees.create`，也不调用 `workingDirectory.set`，因此不会改变 owner 会话 cwd 或用户 checkout。
- Git 命令全部经注入的 `CommandExecutor`（sandbox/subprocess 适配），不使用 shell 字符串；名称/基准 ref 在边界校验，重复分支或路径、非 Git 目录、只读 sandbox、Git 失败分别映射为稳定的 `swarm-worktrees/*` Remote 错误码。会话目录解析只接受 `ctx.agents` 中存活的 Agent，否则返回 forbidden。
- [remote-marker](<src/remote-marker.ts>) 把 `@Remote` 的显式标记安装抽成共享实现，`progress.ts` 与 `worktrees.ts` 共用，保持 source-fallback 的参数名稳定。
- [client](<client.js>) 新增 `swarmWorktrees/list|create` 描述符；创建入口改为页签底部可折叠的“新建工作树”，不再把 worktree 列表当作主视图。创建结果通过 `readRemoteValue` 统一解包 `{ok, value}`，失败显示真实错误。
- “Git 工作树”页签的主视图是**地铁式轨道图**（`trackLanes` / `trackLayout` / `renderCommitTrack`）：一条轨道对应一个工作树，已接受结果是第一条主线（`label-primary` 色），worker 按名册顺序用 alias token 着色。轨道不再按 `computeGraph` 的密集 lane 分配，而是按归属：提交属于第一个沿 first-parent 链认领它的轨道，顺序为主线 HEAD → worker HEAD → 提案 tip；`git log --source` 只表示可达性（集成后所有 worker 提交都从结果 HEAD 可达），因此只作最后兜底。为此 history 页新增 `tips`（`proposals` 的 `sourceCommit`/`authorWorkerId`，最新优先、去重、上限 200），使 worker HEAD 前进后旧提交仍留在自己的轨道上；客户端把缺失的 `tips` 当作空数组，兼容旧 Host。跨轨道曲线只在站点旁无标签的间隙里弯折：分出边沿子轨道走到父站点前再弯，合并边在合并站点后立即弯回父轨道，合并站点的标签翻到曲线对侧。合并是换乘站（双环），当前 HEAD 带光晕，最后一页时在主线末端画 run 基线终点，否则父边用虚线延伸提示还有更早历史。左侧轨道名牌 `position:sticky`，横向滚动时保持可见。颜色全部是 `--dsw-alias-*` token 并通过 inline style 应用，满足主题测试。`computeGraph` 保留为导出的纯函数与既有测试，但渲染不再使用。
- **SRC 签名修复**：`worktreeHistory(sessionId, cursor = null, signal?)` 的默认参数被 typert gateway 的 SRC 兜底发现拒绝（`gateway/signature-invalid: must use unique identifier parameters without destructuring, defaults, or rest`），端点因此不可用。现改为 `worktreeHistory(sessionId, cursor, signal?)`；客户端本来就总是传 `cursor`（可为 `null`），无需改调用。`tests/progress.test.ts` 增加对 `Function.prototype.toString` 参数名的断言，锁住 SRC 兼容性。Host 代码变更仍需重启 DSH 才生效。
- 检查：`tests/worktrees.test.ts` 30 项（临时 Git 仓库，不碰用户 checkout）、`tests/client-remote.test.ts` 新增真实 typert-registry/api-gateway 的 list/create 转发、`tests/client-dashboard.test.ts` 新增 lane/合并/复用单元测试、`tests/client-worktrees.test.ts` 更新为轨道图断言；全量 **35 文件 / 448 项测试**、typecheck、build 与 `node --check client.js` 通过。横向轨道图是纯 Client 改动，刷新页面即可；SRC 修复已在上一轮 Host 重启后生效（面板已能读到提交）。

### 成员列表 / 目标看板重设计、中途扩容与启动可发现性

- **成员列表**：顶部是标题与一句汇总（成员数、执行中、等待协作或集成），右侧是“团队规模”卡片：`已用 / 上限`、按名册顺序着色的名额色块（空位为虚线框）和“+ 添加成员”。成员颜色由 `workerColor(index)` 给出，与 Git 轨道图的 worker 轨道使用同一组 alias token，同一个人在两个页签里颜色一致。卡片顶边是成员颜色，头像显示名字缩写；状态胶囊带圆点，只有连接正常且 turn/工具确实在执行时才有脉冲动画（reduced-motion 下关闭）。当前任务放在浅底块里，没有任务时用次要色。
- **目标看板**：标题区右侧显示“已办结数 / 总数”和三段组成条（办结/办理中/代办）。组成条只表示数量组成，`aria-hidden`，不是进度百分比，遵守既有“不合成百分比”的测试约束。三个池是浅底圆角栏，计数用胶囊；目标卡片左侧色条表示状态（办理中=品牌色、办结=成功色、待下一轮/已转移=警告色），正文最多三行，底部显示验收条数、办结提交短 SHA 和时间；展开后显示全文、验收列表和 ID。愿望输入框改为虚线边框。分池逻辑 `goalColumns` 与提交流程未改。
- **中途扩容**：`swarm_manage` 新增 `add_workers` 动作（`count` 1–4，默认 1），顺序调用既有 `runtime.addWorker`，每次都是独立的原子预留。第一次就失败时直接抛错；之后的失败返回 `{added, error}`，如实报告部分成功，不重试。只读 sandbox 与子会话在调用前拒绝。成员上限仍由 runtime 的 `workerCountMax`（4）保证。
- **启动可发现性**：`SWARM_MANAGE_DESCRIPTION` 改为开宗明义“启动和控制 Swarm 的唯一入口”，并内嵌 start 的 inline spec 结构；`OWNER_POLICY` 增加直接调用 `action "start"` 的完整 JSON 模板，要求先读项目配置选真实验证命令，不去找 CLI/脚本；无 run 时的 owner state 也指向 `action=start`。owner state 新增 `workerLimit` 与 `canAddWorkers`，并在策略里说明扩容用 `add_workers`，不要停止重启。

### 协作流页签

- Host：`toProgressSnapshot` 新增 additive v2 字段 `interactions`（`PROGRESS_LIMITS.interactions = 80`，最新在后）。投影 message/finding/task/proposal/head 事件，只含 `seq/kind/status/actorWorkerId/peerWorkerId/objectId/taskId/createdAt`。私信只给出发送者与接收者，finding 只给出类型；两者的 `objectId` 置空，不暴露正文或 ID。`peerWorkerId` 对 task 是 owner，对 proposal/head 是提案作者（从 `detail.proposals` 查）。run/goal 事件已由 Dashboard 和目标看板展示，这里显式跳过；switch 穷尽检查。
- Client：`FlowSection` / `flowLayout` / `messagePairs`。泳道顺序为 Host → 名册顺序 → 未知 id，颜色与成员列表和 Git 轨道一致（`workerColor`）。task/proposal 事件放在 owner/作者泳道（Host 执行的集成状态变更也归给作者），message 画成到接收者泳道的弧线，head 放在 Host 泳道并用虚线连回作者。旧 Host 不发 `interactions` 时显示“重启 DSH 后可用”，不伪造空数据。帧校验对该字段做 additive 校验，v1 Host 时清空。
- 测试：`tests/client-flow.test.ts`（泳道、路由、筛选、私信对、双语键）；`tests/progress.test.ts` 增加私密性与顺序断言；tabs 测试改为五个页签。

### Dashboard 重设计与成员配色

- **成员配色**：DSH 的 `--dsw-alias-brand-primary` 与 `state-idle-primary` 实际映射到中性黑/白/灰，会和 Host 主线（`label-primary`）或“空闲”混淆。`TRACK_COLORS`（成员列表、协作流、Git 轨道、Dashboard 共用）改为只用有彩色的 token：`state-business-primary`（DeepSeek 蓝）、`success`、`warn`，以及它们与 `error` 的 `color-mix` 混色；`error` 红放最后。黑/白/灰只留给 Host/结果主线。我新加的成员列表、目标看板、Dashboard 样式中的强调色也从 `brand-primary` 换成 `state-business-primary`。
- **Dashboard**：目标卡片左侧有品牌色竖条；四阶段流程改为带连接线的步进条（完成=绿色对勾，进行中=蓝色脉冲点，等待=序号）；三张 KPI 卡片中，“已完成任务”带按状态组成的分段条和图例（宽度按数量，`aria-hidden`，不是百分比），验证失败时显示红色标记；“当前交付”旁新增“团队现状”卡片（`TeamCard`：头像色、当前任务、工作状态胶囊）；任务板和最近公开活动放进卡片，活动时间线的圆点用作者的成员颜色，Host 事件用主线色。`deriveWorkflow`、`deliveryState`、筛选逻辑未改。

### 成员对话与发现（owner 可观测性）

- 与此前“面板不显示私信/finding 正文”的约束相比，这是一次有意的边界调整：run owner 需要看到 worker 实际说了什么。进度流（`watch`/`snapshot`/`interactions`）仍只含元数据；正文只走单独的、按需调用的 `swarmProgress/conversation(sessionId, beforeSeq)`。
- [conversation-log](<src/conversation-log.ts>)：与 worktree history 相同的双重 owner 校验（runtime status 与持久化 run 的 `ownerSessionId` 都必须等于调用会话）；非 owner 抛 `SWARM_FORBIDDEN`，映射为 `swarm-progress/forbidden`。按 seq 倒序合并 messages 与 findings，每页 40 条，`beforeSeq` 为排他游标；正文上限 8000 字符并标 `truncated`，scope/evidence 各最多 16 条、每条 300 字符。worker 的可见性规则（`isEventVisible`）不变，这个接口不给 worker 使用。
- Client：`ConversationSection` 放在“协作流”页签下方，在 unknown-codec 边界用 `readConversationPage` 校验，按 seq 用 `mergeConversation` 去重合并；`interactions` 中出现新的 message/finding seq 时自动重新读取首页，并保留已加载的更早内容与游标。卡片左边框与头像使用成员颜色，失败报告带红色描边。
- 测试：`tests/conversation-log.test.ts`（排序、分页无重复、截断、非 owner/坏游标/无 run）、`tests/client-conversation.test.ts`（校验、合并、双语键）、`tests/progress.test.ts` 增加 `conversation` 的 Remote 标记与 SRC 裸参数断言。

### 泳道节点悬停卡片

- `FlowPanel` 用 `useConversation` 持有一份 owner 对话状态，泳道和下方阅读器共用，同一条正文只读一次。悬停 message/finding 节点时，如果已加载的页里没有这条，`loadAround(seq)` 用 `beforeSeq = seq + 1` 读取以它结尾的那一页并合并，不移动阅读器的分页游标；失败时卡片退回元数据，错误仍由阅读器报告。
- 每个节点是 `tabIndex=0` 的 `role=button`，带 14px 透明命中圈；mouseenter/focus 显示 `role=tooltip` 卡片，click/Enter/Space 固定为带关闭按钮的 `role=dialog`，Esc 或滚动关闭。`flowHoverPosition` 是纯函数：卡片默认在节点右侧，靠右边缘时翻到左侧，处于下半区时向上展开。
- 测试：`tests/client-flow.test.ts` 增加定位翻转、所有节点可聚焦且卡片显示正文、正文未到时的加载态与固定后的 dialog/关闭按钮。

## 2026-10-29 全仓对等审阅与保持行为去重

### 范围与历史文档冲突

- 基线 `005fdaacf37742109eaaa3460f56bcfb026f94f0`，run `0ad56166-e58c-405a-927e-ebc7ea6eaafc`。四个同权 worker 自选、认领并直接协商范围；最初三人同时发现 Git 重复，协商后分别覆盖核心状态、Git/按需读取、Client/进度、Host/CLI 边界。没有经理模型分派模块。
- 覆盖全部第一方源码、Client、测试（含 native fixture）、三个脚本、入口/构建/包装配置及必要说明；不把依赖、生成的 lib 或历史工作树计入覆盖。未改 owner checkout、DSH 源码、profile、凭据、依赖清单或 lockfile；不创建 README、不安装插件、不重启 Host、不另起 Web 服务、不自动合入或推送结果。
- [AGENTS](<AGENTS.md>) 旧 Lead 分工文字与本轮同权方式有历史差异，写范围由 Task/私信约定。[架构](<ARCHITECTURE.md>) 当前为 R5，但顶部“待实现”、§12“尚未实现”是初版时态；本文“基线 R4”“v0.1 无看板/无 Git”等旧段落也是历史记录，不能当作当前事实。
- [架构 §10.4](<ARCHITECTURE.md#L540>) 普通新 start“不继承旧目标”与 R5 显式 continue 是不同入口，不能据旧文字删除 continuation；[使用说明](<USAGE.md>)、[示例](<examples/swarm-run.json>) 已支持后者和默认不限时。本轮记录冲突，不重写历史规格来掩盖实现问题。

### 按模块审阅覆盖与处理结论

下表说明具体符号、共性与保留理由；“保留”不等于证明无缺陷，高风险另列。

| 模块与符号 | 发现、处理与测试依据 |
|---|---|
| [types](<src/types.ts>) createRun/activeAcceptanceCriteria、[schema](<src/schema.ts>) runSchema/parseRun、[spec](<src/spec.ts>) parseRunSpec | JSON 结构/旧记录默认值、spec 路径/冻结、领域初始化各有边界，不合成万能校验。命令/verification schema 已共享；[spec 测试](<tests/spec.test.ts>) 验证完整字段诊断/坏输入/冻结，[goals 测试](<tests/goals.test.ts>) 验证 legacy、goalRevision 与 continuation。 |
| [store](<src/store.ts>) applyUpdate/runReducer/publish、[serial](<src/serial.ts>) FIFO/key 队列、[ports](<src/ports.ts>) contracts/fingerprint | 保留持久后发布、同步 reducer、错误后队列继续；不把无 IO reducer 搬进异步层。[store 测试](<tests/store.test.ts>) 用持久屏障验证未发布/写失败/业务错误/close，[serial 测试](<tests/serial.test.ts>) 验证 FIFO/独立 key。fake table 的故障注入/复制/屏障不同，未强行统一。 |
| [collaboration](<src/collaboration.ts>) mutate/updateTask/read/collectEvents/wait、[events](<src/events.ts>) appendEvent/matchesWait | CAS、receipt、私信可见性、扫描前缀/确认与 selected/any 匹配分层保留；worker 读取不并入 owner 正文接口。[collaboration 测试](<tests/collaboration.test.ts>) 检查认领/证据/授权/私信空洞分页，[events 测试](<tests/events.test.ts>) 保留完整匹配表。 |
| [delivery](<src/delivery.ts>) selectTarget/settlePass/continueAfterSettle、[runtime](<src/runtime.ts>) admission/controlTransition/finishGaps/goalIntake | generation、waitGate、notified 与 observed 不是同一种 cursor，不压成普通消息队列。Runtime 整体拆分会跨短门禁/在途登记/持久状态，未机械搬家。[delivery 测试](<tests/delivery.test.ts>) 验证 pending/settled/重复/失败/暂停；[runtime 测试](<tests/runtime.test.ts>) mock 了 Delivery/Integration，不能充当组合验收。 |
| [integration](<src/integration.ts>) rejectAttempt/settlePending、[proposal-state](<src/proposal-state.ts>) recordProposalRejection | 两份 proposal 拒绝、proposed task 回 claimed、revision/事件顺序实现确为同一事实，抽成无 IO 专责模块。caller 仍负责 terminal guard、attempt/verification、单次 run revision 与持久化。Runtime findReusableVerification 取首条而 selectPassedVerification 取最新，未为去重改变可见 verificationId。[integration 测试](<tests/integration.test.ts#L560-L626>) 新增四路径和批量边界共5项入口回归，保留两种 gate 顺序、崩溃补记、finish 失败修复断言。 |
| [workspace](<src/workspace.ts>) GitWorkspace、[worktrees](<src/worktrees.ts>) WorktreeCatalogue、[git-isolation](<src/git-isolation.ts>) | 两处隔离 argv 与 filter driver 四项禁用解析完全重复，抽纯策略；执行器、权限/错误、Workspace 成功探针按 cwd 缓存和 Catalogue 每次扫描保留。[workspace 测试](<tests/workspace.test.ts>) 扩多 driver/含点名字/required/process/真实 checkout 内容与 config 不变；[worktrees 测试](<tests/worktrees.test.ts>) 补真实 create 的 hook/filter 与探针拒绝无分支副作用。只操作临时仓库。 |
| [conversation-log](<src/conversation-log.ts>)、[worktree-history](<src/worktree-history.ts>) owner 校验/分页 | 双重 owner 检查相似，但无 run、游标、异步取消、错误/payload 契约不同，保留独立类。[conversation 测试](<tests/conversation-log.test.ts>) 从“唯一条数”升级为混合 message/finding 全序列、seq 空洞、读间插入、双重 owner、存储失败与 refs 截断；[history 测试](<tests/worktree-history.test.ts>) 保留真实 Git pinned traversal/new commit 分页。 |
| [progress](<src/progress.ts>) snapshot/watch/watchSession/conversation/worktreeHistory、[remote-marker](<src/remote-marker.ts>) | 只合并两个按需端点相同的 SwarmError→RemoteError 映射；bounded DTO、metadata-only interactions、订阅去重/取消不混进 helper。裸参数与 Remote marker 不变。[progress 测试](<tests/progress.test.ts>) 新增真实 service/reader 的成功、坏游标、owner、存储/原异常入口；[Remote 测试](<tests/client-remote.test.ts>) 仍经真实 gateway/registry。 |
| [worker-activity](<src/worker-activity.ts>) projection reducer/registry | 截断时保守 executing 与 native liveness 覆盖是观察语义，不与任务状态混合；[activity 测试](<tests/worker-activity.test.ts>) 保留真实 ProjectionRegistry、溢出/生命周期断言。 |
| [client](<client.js>)、[client-fixture](<tests/client-fixture.ts>) | 正式单资源 ModuleLoader 工厂、CSS/双语/strict codecs、stream owner/legacy fallback/clock、五页签、trackLayout 和旧 computeGraph 导出均保留。10套测试复制读文件→VM→capture→factory，部分任意 require 或污染全局 window；抽独立 VM 正式入口 fixture，只允许 React。fakeReact 补 effect 清理；3个 tab 焦点/roving、goal 草稿/断线源码断言换真实 handler 行为，未删除有效断言。 |
| Client 测试信号 | [tabs](<tests/client-tabs.test.ts>)、[goals](<tests/client-goals.test.ts>)、[workers](<tests/client-workers.test.ts>)、[overview](<tests/client-overview.test.ts>)、[dashboard](<tests/client-dashboard.test.ts>)、[flow](<tests/client-flow.test.ts>)、[worktrees](<tests/client-worktrees.test.ts>)、[conversation](<tests/client-conversation.test.ts>) 均经正式工厂。主题/双语/资源包装/SRC 签名断言有协议价值，保留；几何/DTO 测试不冒充浏览器视觉/DOM/网络生命周期验收。 |
| [commands](<src/commands.ts>) startRun、[owner-tools](<src/owner-tools.ts>) 文件启动、[spec-file](<src/spec-file.ts>) loadRunSpecFile | 重复 resolve/readText→JSON.parse→parseRunSpec 抽取；权限仍由 caller 先检查，命令保留 cause 文本、工具保留摘要。CLI driver 错误契约不同，不并入。除原 [commands](<tests/commands.test.ts>)/[owner-tools](<tests/owner-tools.test.ts>) 测试，新 [入口回归](<tests/spec-file-entrypoints.test.ts>) 16项从已注册 command/真实 ToolRuntime 执行正常、坏 JSON/shape、resolve/read 失败、预取消/只读等边界，不只直接测 helper。 |
| [tools](<src/tools.ts>)、[owner-context](<src/owner-context.ts>)、[worker-context](<src/worker-context.ts>)、[worker-policy](<src/worker-policy.ts>)、[worker](<src/worker.ts>)、[worker-names](<src/worker-names.ts>) | JSONSchema 描述子集与运行时 Zod 作用不同，不盲目去重；front-desk identity 与 worker 被动事件提示不同，不合并授权。提示不推进 durable ACK，注册随 scope 释放。[tools](<tests/tools.test.ts>)/[owner-context](<tests/owner-context.test.ts>) 保留真实注册边界，[names 测试](<tests/worker-names.test.ts>) 实际耗尽256词对/验证 legacy schema；worker-context 专项测试仍缺。 |
| [dsh-executor](<src/dsh-executor.ts>)、[dsh-worker-host](<src/dsh-worker-host.ts>)、[errors](<src/errors.ts>) | sandbox/permission、owner→child、worktree 初始化/本 Session 资源停止不与测试执行器合并；错误码/normalizeError 保留。[executor](<tests/dsh-executor.test.ts>)/[host](<tests/dsh-worker-host.test.ts>) 覆盖权限/取消/资源屏障，不代表所有 quiescence/activation 双信号分支都覆盖。 |
| [headless](<src/headless.ts>)、[args](<src/headless-args.ts>)、[driver](<src/headless-driver.ts>)、[lifetime](<src/headless-lifetime.ts>)、[signals](<src/headless-signals.ts>)、[preset](<src/headless-preset.ts>) | subscribe-before-start、单调 revision、terminal-only、once-stop 与应用信号/生命周期分层合理，不新增框架。[headless](<tests/headless.test.ts>)/[args](<tests/headless-args.test.ts>)/[lifetime](<tests/headless-lifetime.test.ts>)/[signals](<tests/headless-signals.test.ts>)/[preset](<tests/headless-preset.test.ts>) 验证契约，原生隔离脚本另验 SIGINT。 |
| [index](<src/index.ts>)、[artifacts](<src/artifacts.ts>) | injection、回滚、资源所有权与 run-owned artifact ID/per-record 后端保留；[artifact 测试](<tests/artifacts.test.ts>) 用真实 JsonStorageBackend，不以 Map 测试冒充磁盘。卸载顺序风险另列，未以去重偷改生命周期。 |
| [e2e](<tests/e2e.test.ts>)、[local-executor](<tests/local-executor.ts>) | 真实 Runtime/Store/Delivery/Integration/GitWorkspace 组合，fake 只替外部效果，订阅状态不用 sleep。中间验证允许0/1支持分步候选，最终独立 git show 断言两文件均1，并检查 resultRef、祖先、失败不推进/重提、owner HEAD/branch/index/status。child_process 只在测试/脚本，不入生产包；FakeWorkerHost 不证明模型或原生 settled 行为。 |
| 脚本、构建、包装与文档 | [build](<scripts/build.mjs>) 五个 Node ESM 入口/声明、[link](<scripts/link-harness.mjs>) 精确宿主开发 symlink、[native-headless](<scripts/test-native-headless.mjs>) 隔离 DSH_HOME/[blocking adapter](<tests/native-smoke/blocking-model.js>)、[package](<package.json>) exports/files、[tsconfig](<tsconfig.json>)/[build config](<tsconfig.build.json>)/[vitest](<vitest.config.ts>)、[GUI patch](<cordis.patch.yml>)/[headless overlay](<cordis.headless.yml>)、[英文](<locale/en.json>)/[中文](<locale/zh.json>)/[图标](<icon.svg>)、[使用说明](<USAGE.md>)/[示例](<examples/swarm-run.json>)、[npmrc](<.npmrc>)/[忽略规则](<.gitignore>)/[许可证](<LICENSE>) 均核对。preset 重叠但 GUI compaction/headless 绝对 worker URL 不同，不制造 YAML 生成层。历史 [native 入口](<tests/native-smoke/index.js>)/[代际检查](<tests/native-smoke/check-current.js>)/[清单](<tests/native-smoke/package.json>)/[patch](<tests/native-smoke/cordis.patch.yml>) 仅审阅，本轮不安装或调用其模型路径；源码 marker 只证明代际，不替代行为测试。 |

### 明确保留的风险与延期（并非本轮新引入）

本轮是保持行为的结构优化，不偷偷改变权限/生命周期，也不声称消灭全仓缺陷。以下未改动，绿灯不覆盖这些缺口：

1. **恢复 admission**：[Runtime.recover](<src/runtime.ts#L1045-L1095>) 捕获 resultRef/凭据失败后仍写 paused，诊断只在内存；[resume](<src/runtime.ts#L603-L713>) 未再次核对 ref 即开放 admission。[unknown-ref 测试](<tests/integration.test.ts>) 只证明 IntegrationQueue recover 拒绝未知 SHA，不证明随后 Runtime resume 仍阻断；需独立恢复→resume 组合修复。
2. **卸载与长命令**：[Runtime.dispose](<src/runtime.ts#L1103-L1143>) 只等待 integration.idle，不像正常 stop 主动 interrupt；[入口](<src/index.ts>) closeResources 没有先 stop 全部 run。GUI 卸载可能等待长命令，headless driver 的 abort/stop 特例不能证明 GUI 链路快速静止。
3. **原生退出确认**：[DshCommandExecutor](<src/dsh-executor.ts#L259-L278>) 取消/超时先返回，可能掩盖 quiescenceFailure；settle 忽略 waitForExit 的 false。[测试](<tests/dsh-executor.test.ts>) 只有 true/阻塞屏障，缺 false/reject+abort，属于停止确认高风险。
4. **activation 与 jobs**：[DshWorkerHost.start](<src/dsh-worker-host.ts#L244-L251>) 成功 activation.result 未转 onSettled，依赖 subagent/end，与[架构“任一信号足够”](<ARCHITECTURE.md#L347>) 有差异；[host 测试](<tests/dsh-worker-host.test.ts>) 未覆盖双信号去重。[swarm_wait](<src/tools.ts#L456-L469>) 未如 host 过滤 jobs.owner，原生 list 含 unowned 时可能误拒等待，[tools fake](<tests/tools.test.ts>) 未验证。
5. **Git 配置探针 fail-open**：[Workspace](<src/workspace.ts>) 与 [Catalogue](<src/worktrees.ts>) 对任意非零探针退空 overrides，不区分“无配置”退出1与读取故障；Workspace 成功结果按 cwd 缓存，依赖轮内配置稳定。本轮共享原策略，不把风险包装为已修复。
6. **特殊 worktree 路径**：[Catalogue.parseWorktreePorcelain](<src/worktrees.ts>) 使用非 -z 行输出并 trim；换行、引号、首尾空格等合法路径未覆盖，不宣称任意文件名兼容。需先确定 NUL 协议与兼容行为。
7. **Client 请求生命周期**：[CreateWorktreeSection](<client.js#L787-L805>) 只用 render 闭包 pending 防重复，完成不核对 session/unmount，没有 AddWorkerControl 的 ref/abort guard。[useConversation.loadAround](<client.js#L1280-L1310>) 吞失败且 controller 留 Map，同 seq 不能重试、reader 未必报告；保留旧 cursor 以 items.length 推断，hover 插入可能干扰。本文旧“错误仍由阅读器报告”描述不完整，以此事实为准。
8. **提示/模板**：[worker-context](<src/worker-context.ts>) 无专项 waterfall/additionalContexts 行为回归，core 可见性测试不能替代。[owner 模板](<src/owner-context.ts>)/[工具模板](<src/owner-tools.ts>) 示例缺必需 timeoutMs，[schema](<src/schema.ts#L25-L33>) 拒绝，属于文案缺口，不是放宽校验的理由；[示例文件](<examples/swarm-run.json>) 参数齐全。
9. **测试设施上界**：[runtime waitFor](<tests/runtime.test.ts#L363-L378>) 是 setImmediate 有界探测，虽无 sleep 仍可改订阅消除调度依赖；[e2e teardown](<tests/e2e.test.ts>) 仅记录 dispose 失败，可能漏报清理故障；[native 脚本](<scripts/test-native-headless.mjs#L52-L64>) 两 stream 后 await exit 无独立关闭超时。通过不豁免这些失败分支。
10. **大模块仍在**：[runtime](<src/runtime.ts>)、[collaboration](<src/collaboration.ts>)、[integration](<src/integration.ts>) 与 [client](<client.js>) 仍大。只抽实际共性；Client 单资源加载不能直接拆 Node ESM，Runtime 不能绕 publicationGate；后续按控制/协议边界拆并补上述回归，不以行数为依据。

### 增量、交叉复核与最终组合验证

- 四份代码候选：核心 `dd632db`→accepted `9145649`；Git `38e307e`→`630db18`；Client/Remote `292a506`→`b2439f0`；Host/CLI `bb4b10c`→`734b475`。新模块各司其职，未改公开导出/打包清单、Client 本体、Remote 签名或五页签。
- 审阅 findings：核心 `87a26736`/`01aabb4f`、Git `7989ae15`、Client `a62bd3f9`/`fc6b1457`、Host `78bb4790`/`f4498757`/`252b5ab8`、组合夹具 `eaadf64f`。独立复核 `61a2690d`（proposal）、`df0ca76d`（Git）、`8ee19b3f`（Remote/VM）、`54709298`（spec），不只作者自称通过。
- 环境：首次 `pnpm install --frozen-lockfile` 已物化锁定依赖，但 pnpm 11 因 ignored esbuild build scripts 退出1。运行既有开发 link 脚本后，后续仅用 `pnpm_config_verify_deps_before_run=false` 防重复自动安装覆盖精确 Cordis link；没有批准脚本、改仓库配置或跳过检查。自动生成未跟踪 workspace 占位经读取核验删除，不把初次 install 说成成功。
- 在全部代码组合 `734b4752e4af32fb40aad8e0f726c8c55d5832cd` 实际串行执行如下；日志 job `bash-cdb57df8e3d94e1a`，全部退出0。文档追加不改变运行代码，接受后的最终 SHA 以结果 ref 为准。

```sh
pnpm_config_verify_deps_before_run=false pnpm typecheck
pnpm_config_verify_deps_before_run=false pnpm build
pnpm_config_verify_deps_before_run=false pnpm test
node --check client.js
pnpm_config_verify_deps_before_run=false pnpm test:native-headless
git diff --check
```

- 全量 **39 文件 / 502 项通过**。原生 headless 的内部 build 也通过；隔离 fixture `/tmp/dsh-swarm-native-headless.rBQH5K` 验证缺失路由在 worker 启动前失败、两原生 worker stream 后真实 SIGINT、一个 persisted stopped final/aborted=true/error=null、退出130、原始临时 checkout 不变。模型为明确 blocking fake adapter，没有调用付费模型。
- 真实 Git 组合/Remote registry/ProjectionRegistry 回归不等于真实模型自主编码或浏览器目视验收；本轮没有部署当前 GUI，也没有安装、重启或替代服务。测试的有效分支与未覆盖高风险均按上节报告。

## R6 公共协作体系（2026-10-29）

### 交付与协议边界

本轮两名同权 worker 自主协商领域/投递/工具/GUI 范围，复用既有 domain、事件、串行队列、admission、Task CAS 与 Git 验证。不是扩展私信 `target=all`，不从沉默推断共识，也不以“原型”删减请求或版本确认。只交付 Swarm 结果分支；未合并用户主分支、未安装插件/修改 profile/DSH、未重启 Host、未启动替代服务器。

- [公共类型](<src/public-types.ts>) 和 [schema](<src/public-schema.ts>) 在原 Run 增加八个 map：channels、threads、publicMessages、subscriptions、notifications、channelReads、responseRequests、agreements。新建 run 带 general；旧记录仅增加空公共容器和确定性 general，不复制私信、不追加伪历史。持久化边界检查 map key 与实体 id、公共引用/作者/相关方同 run，以及全文 offered/read 与确认版本一致性。
- [PublicCollaboration](<src/public-collaboration.ts>) 是同步 reducer 的业务入口；身份来自真实 Session 映射，回执 `(sessionId,callId)` 在同一次 update 保存。频道归档仅创建者、线程元数据仅创建者、消息修订仅作者、请求响应仅目标、撤回仅提出者、约定修订仅创建者、确认仅该版本列名相关方。并发操作用 revision/version CAS；不同动作复用 callId 拒绝，重放已完成操作不重复事件，即使 run 已暂停。
- [输入 schema](<src/public-input.ts>) 的 16 种动作、9 种查询视图是完整工具契约。`swarm_discuss({command:{action,...}})` 与 `swarm_public_read({...})` 使用 camelCase 公共字段，保留原 9 工具的 snake_case 与私信语义。[Runtime](<src/runtime.ts>) 提供同 store 的 publicCollaboration，[工具](<src/tools.ts>) 真实接线到 worker preset 而非 owner。通过真实 DSH ToolRuntime/Context 的注册、执行、鉴权与卸载测试。
- 实测 Zod 4 `toJSONSchema` 结果附有不可枚举 `~standard` 函数，DSH 的 lossless JSON schema gate 会拒绝；工具层仅投影可枚举 JSON schema 数据，保持实际参数校验，不绕过 Host gate。该故障由真实 registry 测试发现并修复。
- [查询投影](<src/public-query.ts>) 分离当前全文与历史版本，最多20条/页与约24K字符目标（单条完整记录受字段固定上限约束）；返回显式 total/hasMore/truncated/cursor。cursor 绑定 run/viewer/filter，稳定 keyset 排序并固定新增事件上界。可按任务/线程/频道/消息/Finding 查源，当前约定和 pending 请求供后来成员加入时读取；不承诺查询期间可变状态的历史快照隔离。
- 原私信仍只给作者/目标 worker，owner 的旧对话查看仍受旧授权；公共查询从不读取 legacy messages map。引用私信、其他 run 或不存在对象报错。Finding 不可变；讨论链接与 findingId 反查保留来源，不把讨论意见自动发布为 fact。

### 通知、阅读、回应与同意

完整矩阵见 [架构 §14](<ARCHITECTURE.md>)；实现位于 [events](<src/events.ts>)、[Delivery](<src/delivery.ts>) 和 [worker context](<src/worker-context.ts>)。

- mentions / response_request / reply / announcement / agreement_confirmation 为 immediate。任务当前负责人/参与者/following 是 digest，未确认同线程通知合并，刷新 seq 并清 deliveredAt；显式请求独立保存且排序优先，不被普通消息降级。本人不收到自己的普通通知；无关讨论只进按线程分组的有界标题/活动数量摘要，不全员正文广播。
- 通知先随业务持久化，再走每 worker 原串行 queue/admission。活跃者只处理 immediate；普通 digest 到 idle/settled。登记 wait 后不打断正在收尾的 activation。暂停不唤醒，恢复重投未确认，终态不启动；通知 id+seq 与本次实际送出的版本相符才记录 deliveredAt。
- 全局 offered/observed/shown、频道当前全文版本 offered/read、通知 delivered/acknowledged、请求 pending/responded/withdrawn、约定逐版本 confirmations 是五组独立状态。后续 Lead 修复将技术展示确认改为 Host 自动执行（见下节），旧 ack_notifications/mark_read 仅兼容历史调用；陈旧回执不能吞并发合并，全文回执只记录精确展示版本。GUI owner 阅读不推进 worker 全文 offers。
- 即使通知已 ACK，attention 仍把本人待回应请求放在普通更新前。普通发帖、全文已读、通知确认不会完成请求；只允许请求目标引用自己的同线程公开消息显式 respond。约定新版保留旧确认作为历史，但当前投影不把旧确认算成新版同意。
- 公开线程、未答请求本身不进入 finishGaps。真正阻塞的工作仍用 Task/fail Finding，完整 owner 需求、goalRevision、Proposal、验证凭据、acceptedHead 与 pause/stop 逻辑不被聊天替代。

### GUI/Remote 接口约定

本轮在[正式面板](<client.js>)扩展“公共讨论 / Public discussion”，不是独立 HTML 或替代服务器。沿用 `swarmProgress` 的 owner 会话订阅与按需 Remote：`publicDiscussion(sessionId:string, runId:string, query:PublicQuery):Promise<PublicPage>`。每次读取校验真实 owner/current run，再调用 publicCollaboration.queryForOwner；无 worker/owner 阅读状态 mutation。常规流新增的 `publicActivity` 只含 protocolVersion/latestSeq 和频道/线程/待请求/约定计数，不带公共正文或私人数据。

公共 pane 仅在选中时挂载；分页器持有 AbortController 与 session/run/query 身份，切换、卸载与旧请求返回都不能污染新页面。频道列表、线程/消息/请求/约定/attention/activity、修订历史和来源跳转有界分页，保留中英文、主题 token、原生按钮与键盘操作；旧 Host 缺端点明确说明。GUI 候选由另一 worker 独立验证/集成，其最终测试证据应与下方业务测试计数分开报告。

### pnpm 11 固定 setup 可复现性

Owner 在本轮追加的必要修复已落入[项目 workspace 配置](<pnpm-workspace.yaml>)，不是未记录的 worker shell 开关：

```yaml
verifyDepsBeforeRun: false
allowBuilds:
  esbuild: true
```

仅允许 esbuild 的平台二进制安装脚本（本项目构建工具）；没有允许所有依赖脚本。`verifyDepsBeforeRun:false` 防止 pnpm 11 在每个脚本前自动 install 覆盖精确 Harness/Cordis 链接；它**不取消**显式 frozen-lockfile 安装、类型检查、构建或测试。未改用户全局 pnpm/DSH 配置、依赖版本或 lockfile。

实际命令（安装目录由当前环境提供，不写进项目清单）：

```sh
pnpm install --frozen-lockfile
pnpm run link:harness -- <当前 @deepseek-ai/dsh 安装目录>
pnpm typecheck
pnpm build
pnpm test
```

本轮第一次 pnpm 安装曾以 ERR_PNPM_IGNORED_BUILDS 退出1，并产生不可用 workspace 占位；该失败没有被记为成功。以上项目策略集成后，同一组**无临时环境开关**的固定 argv 成功。Harness link 仅在显式 install 后执行一次，后续三项验证不再重新安装或替换 Cordis。Host 对组合候选再次执行固定 setup/test 后才接受提交。

### 已执行的业务/投递/工具验收

- 领域/投递候选 `355e48d088643b23a3fdcc9f03f894b50e97a1f0` 被 Host 接受为 `b8a7f10e124b2e8954a52bb68f7a0d42f54c3777`。
- 活工具候选 `7737a5caee68264cd53acc31005676e287468c36` 被 Host 接受为 `f1f7c4ccf9d45b773df2d1cbe4a42f87de7eb3d7`。本 worker 实际执行上述 install/link/typecheck/build/test 全部退出0；日志任务 `bash-fd1791d09b7f488a`，**41 测试文件 / 530 项通过**。后续 GUI 合并与最终组合结果另行更新，不能把该数量当作尚未运行代码的证明。
- [17 项公共业务测试](<tests/public-collaboration.test.ts>)：旧 run/私信隔离、A问B而C可读参与、频道/归档/作者权限、跨线程/跨 run/私信/原型键引用拒绝、请求授权/CAS、约定版本确认、任务负责人转移/动态成员、并发发帖/快照分页/搜索、重复 mutation、摘要/全文/通知/请求分离、陈旧通知 ACK、持久引用损坏拒绝。
- [8 项公共投递测试](<tests/public-delivery.test.ts>)：真实 Store/Collaboration/Delivery 配合 fake effect ports 和 Promise 屏障，覆盖等待登记前后、收尾、暂停/停止、冷恢复独立 ACK、投递中合并版本回执、普通噪声/优先级及上下文不泄露正文。保留原[投递](<tests/delivery.test.ts>)、[事件](<tests/events.test.ts>)与[运行时](<tests/runtime.test.ts>)回归断言。
- [工具测试](<tests/tools.test.ts>) 实测 11 工具精确注册/卸载、真实 Agent 身份、完整问答/约定调用、错误输入、以及普通未关闭线程/待回应请求不阻塞正常 finish；fixture 使用显式时钟，不 sleep 碰时序。原 Git/e2e/目标/GUI/Remote 回归仍全量运行。
- 这些是源码、构建、真实 ToolRuntime/临时 Git 与受控 effect port 的自动化证据，**不是**当前宿主已加载新代码、真实模型已使用公共协议、浏览器已完成视觉/交互验收。本轮未部署、未安装、未重启、未启动替代 Web 服务；旧章节的真实模型/GUI检查是历史版本证据，不可挪用于 R6。

## Host 自动技术回执：Lead 亲自实现（2026-10-29）

用户指出“模型为了技术 ACK 多走一轮”是不必要开销。本修复由 Lead 在独立工作树完成，不覆盖 Swarm 成员 checkout，不把程序投递确认和业务答复混为一谈。

- [凭据及原生 projection](<src/notification-receipts.ts>)：工具的 output.presentationMeta 与自有 swarm-context MessageSource 携带不要求模型输出的回执证据。对最终内容计算 SHA-256，只有真正进入原生 append surface 的成功 tool/result 或 user/message、且内容未被截断/替换时，才形成展示证据。没有新增 SessionEvent 类型，没有解析任意用户文本冒充 Host 证明。
- [生命周期适配](<src/worker-receipts.ts>)：核对当前 DSH session/event 是 post-commit 但不是落盘边界，因此先经 sessions.flush，再写 Swarm domain。失败保留可重放证据、日志给诊断，不把已执行文件操作变为失败重试；既有 pre-step/pre-execute/turn-stopping 等待自动记账，不唤醒模型来做 ACK。缺持久化能力显式失败；监听与队列受 worker/plugin effect 清理。
- [协作内核](<src/collaboration.ts>) 新增 Host-only recordShown；Worker.shownSeq 是连续摘要展示位置，保留旧 offered/observed 和显式参数兼容。正常 sync/wait/Delivery 使用有效展示位置，不要求 ack_seq/after_seq。公共 notification 只确认精确 id+seq；完整当前消息只记录实际展示 revision；正文、回应、同意状态绝不因摘要被推断。
- [Host 消息接线](<src/dsh-worker-host.ts>) 使用已核对的 DSH host-protocol steerHostSubagentPrompt 导出，保留 owner→child 身份、原生冷恢复、串行和取消边界，保存独立 Host 来源，避免伪装成 owner 模型写的聊天。
- [worker 指令](<src/worker-policy.ts>) 和[工具](<src/tools.ts>) 不再要求 ACK-only 调用，正常 wait 无必填 cursor。旧 ack_notifications/mark_read 只用于兼容；respond/confirm_agreement 仍是必要的显式业务动作。
- [自动回执测试](<tests/notification-receipts.test.ts>) 使用真实 Session/ProjectionRegistry 和受控持久化屏障，覆盖日志先于回执、失败/取消/截断/改写、存储/flush 失败恢复、分页不越界、精确合并/修订版本、权限以及回应/同意不被自动修改。[真实工具管线](<tests/tools.test.ts>) 验证 sync 结果落日志后，下一次 wait 无需任何模型 ACK；[Host 适配](<tests/dsh-worker-host.test.ts>) 核对原生 Host 消息来源。

Lead 将自身补丁与已接受的公共频道/GUI/活动修复 `8c77fd306ace19e9d74af4510950d002be41caee` 合入独立候选后，实际执行 `pnpm typecheck && pnpm build && pnpm test && node --check client.js && git diff --check`，全部退出 0（`bash-0927c506ddbd4f26`，**44 文件 / 560 项通过**）。另执行 `pnpm test:native-headless` 退出 0（`bash-59b21c4c85184074`）：隔离 DSH_HOME、明确 blocking fake 模型，验证缺失路由拒绝、两个原生 worker 启动、SIGINT、持久 stopped/退出130和原始临时 checkout 不变。该原生检查不是付费模型对话或自动 ACK 的真实模型性能测试。

面板将通知状态明确区分为 inbox 接受和技术展示回执，不能显示成业务回应/版本同意；双语渲染回归保留这些断言。本节描述已验证的源码候选，仍须由原 Swarm 集成队列验证接受；当前宿主仍需单独授权部署，未声称真实模型或浏览器已加载此补丁。最终组合发布以 Host 回执为准。

## R7 继承宿主的团队上限

### 经安装版核验的边界

目标仍为 DSH 0.2.1-rc.4。原生 SubagentRuntime 没有公开 capacity getter；`Service.resolveConfig` 是服务 intercept 配置，不是插件实例的配置。没有采用这两个不成立的读取方案，也没有访问 TypeScript private `config`。

核验到的公共路径是 Cordis `Context[Context.isolate].subagents` → `ctx.reflect.store[scope]` → `Impl.fiber.config` → `maxActiveSubagents.get()`。安装版 Cordis 的反射实现通过同一 isolation key 查找实际注入服务；Fiber 声明的 config 为已经验证的配置，Loader 的合法 volatile 更新修改同一引用，原生 subagent manager 在预约时调用同一 Volatile getter。Loader 原始配置可能保留被拒绝的编辑值，故不读取它。解析失败给明确配置诊断，不使用 schema 默认 8 或任意 fallback。读取作用域与 [原生 worker adapter](<src/dsh-worker-host.ts>) 的启动 Host 注入相同，保留真实 owner/parent 身份及原生 admission。

### 行为与兼容性

- [Host Config](<src/index.ts>) 提供可选 `workerCountMax`，没有数值 default；显式正安全整数优先，移除字段恢复继承，错误类型/0/负数/小数/非有限值明确拒绝。不会为 Swarm 改写用户 DSH 全局并发配置。
- [Runtime](<src/runtime.ts>) 统一 start/add/status 的当前上限解析；continue 是新 run，沿用旧人数也必须重新通过当前上限。上限降低不删除、终止已有成员，旧 paused run 恢复保留名册。没有把新字段写入旧 Run、复活旧终态或新增调度器。
- `SWARM_WORKER_LIMIT` 表示团队配置拒绝；`SWARM_CONFIG_UNAVAILABLE` 表示配置能力/解析失败；原生 `ACTIVATION_LIMIT_REACHED` 映射为 `SWARM_NATIVE_CAPACITY`。显式覆盖不偷偷取 min，也不绕过原生权限或运行容量；保留实际创建失败/部分添加回执。
- [owner 工具](<src/owner-tools.ts>) 的启动人数说明不再是 2–4，仍保留每次 `add_workers count` 为 1–4 的批次约束；[owner 上下文](<src/owner-context.ts>) 从当前 status 读取 `workerLimit`、来源、诊断和 `canAddWorkers`，不读静态 default。
- [无界面进度](<src/headless.ts>) 在持久事件触发的 JSONL progress/final 中读取同一 runtime status 的当前 `workerControls`，不把配置写入 Run 或轮询；旧适配器缺少 status 时给显式 unavailable。成员可读名字词库耗尽后加数字后缀，不再造成隐式 256 人上限。
- [进度](<src/progress.ts>) 透传 `workerControls`，不再把人数裁到 8。[面板](<client.js>) 验证新 DTO 的有效/不可用状态，显示继承宿主或显式覆盖；旧 v2 DTO 无来源时明确未知，不伪造继承。上限降低显示真实 `12 / 3` 而非把分母 clamp 成 12；成员色块只表示已加入成员，不按任意大 max 分配空位，更不暗示这些空位是原生可用容量。
- 进度流保留原业务/活动事件驱动机制；未伪造通用配置订阅。quiet run 在下一事件或手动重新连接时刷新，status 与实际 add 每次重新读取。使用和取消覆盖示例见 [使用说明](<USAGE.md>)。

### 实际验证与部署边界

本轮 presentation 工作树执行固定 `pnpm install --frozen-lockfile` 与 `pnpm run link:harness -- <当前安装目录>` 均退出 0（`bash-52e7234e3dba4aab`）；只链接开发依赖，不安装到用户 profile。第一次所谓定向 `pnpm test -- <files>` 在当前 pnpm/Vitest 实际运行全套，564 项通过、1 项失败（`bash-d8dd358297ce4d00`）：新 owner-tools 的 5/8/12 人断言碰到尚未合入的旧 spec 上限。该失败保留，等待 backend 合并，不删断言或冒充通过。owner context/progress/client 的新测试已通过：真实来源/null 诊断、超过八人的全名册、降低后保留、坏 DTO 拒绝、旧 DTO 兼容、按钮与真实 Host 命令路径。

随后以 `pnpm exec vitest run` 明确选择 5 个 presentation 测试文件，89 项全部通过，并且 `node --check client.js` / `git diff --check` 均退出 0（`bash-00b4a2980e82451e`）。最终组合必须再次执行固定 install/link/typecheck/build/test，结果另行补充；以上局部证据不代替 Host 组合验收。没有修改 DSH 源码/用户 profile、部署或重启 GUI，没有启动替代服务器；源码/组件单测不等于当前 URL 已生效或真实模型/browser 端到端验收。
