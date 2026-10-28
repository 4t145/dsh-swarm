# 实现记录

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
