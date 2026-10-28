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

## 最后实际执行的验证

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
- Client 只依赖宿主 React，style 随组件卸载，使用 strict descriptor 挂载 Remote；包声明 `immediately=true`。重启 DSH 后实测：标签位于“对话”与“轨迹”之间，但面板报“未接线”。原因是 `$mount` 安装的是独立的 `remote.swarmProgress` 服务，经 `ctx.remote.swarmProgress` 读取会触发 Cordis 的 inject 检查而抛错；mock 测试未覆盖。现改用 `ctx.get('remote.swarmProgress')`，失败时显示真实错误，并新增 `tests/client-remote.test.ts`，用真实 typert-registry 与 api-gateway Client 回归。修复后的页面渲染需刷新后再确认。
- 最后完整检查：typecheck、23 文件 / **267 项测试**、build 全部通过。`pnpm test:native-headless` 在全新临时 DSH_HOME 中验证缺失路由提前失败、两个原生 worker 的 SIGINT→持久 stopped→退出 130，原 checkout 不变；该脚本使用阻塞测试 adapter，不调用付费模型 API。所有临时 Web probe bundle 已移除，正式包保留启用；管理器仍明确要求重启完成代码代际切换。
