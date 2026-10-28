# DSH Swarm 开发规范

本项目是单机 DSH/Cordis 插件，不是新的 Agent harness。先读 [架构规格](<ARCHITECTURE.md>)，再改自己负责的模块。实现与文档冲突时先报告，不能默默改目标或假造宿主 API。

本规范参考 [DeepSeek Harness 上游 AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md)，保留适用的 TypeScript、插件生命周期、持久化、工具和测试规则；不继承其 monorepo、SDK 双端、发布、PR 标签、官方美术、全仓覆盖率及平台矩阵流程。

## 1. 工作范围与并行协作

- 每个任务先明确允许修改的文件；只写自己负责的范围。共享类型、依赖、构建配置、lockfile、架构文档由 Lead 统一修改，除非明确委派。
- 修改前读取当前内容；遇到并发版本冲突，重读并合并，不覆盖同伴改动。
- 不替别人修代码、不跑全项目自动格式化、不重建别人的生成物；发现跨模块问题报告接口、复现方式和建议。
- 不自行安装/卸载 profile 插件、不改 DSH 源码或用户配置、不启动额外 Web 服务器。最终构建、安装和全量验证由 Lead 协调。
- 不创建 README 文件；用户已要求删除原 README。必要的使用说明放 `USAGE.md`，实现决策放 `IMPLEMENTATION.md`。
- 完成回报：修改了什么、导出的接口、实际运行的检查、剩余问题。写完文件不等于完成任务。

## 2. 技术栈与代码风格

- Node.js 24+，TypeScript strict、ESM；保持一个插件包，不拆不必要的 workspace。
- 本地相对 import 带 `.ts`，打包输出为 Node 可加载的 ESM；依赖通过包名引用，禁止在交付源码写死本机 `/nix/store` 路径。
- 避免 `any`；确实无法表达时局部说明原因。禁止 `as unknown as ...` 双重断言逃避类型检查。
- JSON、配置、文件、模型工具输入和持久记录在入口校验；已经校验的同进程类型不反复解析。
- 有限状态使用带判别字段的 union，并穷尽处理；未知外部事件显式忽略或报错，不随意归为成功。
- 公共函数写简短 JSDoc：输入、返回、错误、所有权或时序中不明显的事实。注释不复述代码，不写推理过程。
- 文件单一职责，避免巨大入口文件、重复业务逻辑、万能工具类和猜测未来需求的抽象。
- 文件以一个换行结尾；不做与任务无关的格式重排。

## 3. DSH 插件边界

- 先通过 `cordis_inspect_list` / `cordis_inspect_query` 核对真实 Service/Event/Config；有缺口再读安装包 README 与 `lib/types`，不能猜方法或把 Agent 工具名当 Host API。
- 共享服务放 Host；worker 的工具、persona 和协作指令放专用 preset/Agent scope。不要继承 Teams 的共享 checkout 指令。
- 使用原生 subagents、Session、worktree、jobs、subprocess、storageDomain；不另写模型循环，不直接调用供应商 HTTP 代替 DSH。
- 注册、监听器、timer 和句柄须有明确 owner 与 disposer；Agent scope 注册同时受插件卸载清理。
- waterfall 不拥有决策时必须 `return next()`；不要劫持整个 system prompt。增加指令用 section，模型输入使用正常日志化路径。
- `inject` 不唤醒 Agent；`steer/followup` 才会唤醒。turn 结束不是 activation 结束，activation 结束也不是 run 成功。
- 不追加未知 DSH SessionEvent；Swarm 的任务/事件存在自己的 domain，模型看到的内容通过工具结果或 inbox 记录。
- Git 和测试命令显式经过 DSH sandbox/permission 适配。生产路径不得用 Node child_process 绕过；测试夹具可在临时目录用受控本地执行器。
- worktree 是文件隔离，不是安全沙箱；创建会改变调用 Agent 的 cwd，不对用户 owner 调用来切走其工作区。

## 4. 数据、并发与失败

- 一个 run 的业务变更在一次聚合记录 update 内完成；reducer 必须纯同步，不 await Git、模型或网络。
- 分清 Task revision、Event seq、Git SHA。状态持久化后才通知；所有异步回调重新检查 run 状态和对应操作身份。
- 同 worker 的 materialize/wake 串行；公共 resultRef 发布与 pause/stop 共用短门禁；门禁不包模型或长测试。
- 保留不可变候选 SHA、验证基线与凭据。验证失败、取消、未知结果不能转成成功。
- `inactive` 不自动释放任务；重复投递不等于重复 mutation。恢复允许重投消息，不承诺 exactly-once。
- stop 先关 admission，再取消并等待本 run 的资源静止；不能误杀用户其他任务。确认失败就保留状态和诊断，不能宣称停干净。
- 不自动 stash、commit、reset 用户工作区，不删除未知 worktree/分支。所有破坏性 Git 操作只针对核对过的插件专用路径。
- 用明确错误码和可操作诊断；不空 catch、不吞掉错误后返回空成功、不无限重试。区分代码失败、用户取消、基础设施失败。
- 只增加有当前场景依据的保护；不为未知部署设计分布式锁、复杂迁移或通用扩展框架。

## 5. 工具与配置

- 工具描述说行为与结果；参数规则放参数上。默认输出有界，提供 ID/cursor 和展开入口，不把日志或全员聊天灌入模型。
- 模型身份取自实际 exec.agent 与成员映射，不接受自报 workerId 作为授权。
- 运行时可调值放经过验证的 Config 或启动 spec；协议不变量固定，不用隐藏常量冒充配置。
- 配置不完整、引用不存在或能力不支持时尽早明确失败，不静默降级或绕过权限。
- 使用正式 bundle manifest/patch、英中文元数据和合规图标；不把普通 HTML 当成当前 DSH GUI 插件。

## 6. 检查与交付

以下命令由项目提供后使用；若尚未建立脚本，报告缺口，不声称已通过。

```sh
pnpm test -- <对应测试文件>
pnpm typecheck
pnpm build
pnpm test
```

- 开发者先跑自己模块的针对性测试；Lead 最后跑 typecheck、build 和完整项目测试。测试命令必须检查退出码。
- 核心状态/并发用 fake Agent、可控 Promise/时钟；Git 用临时仓库；测试不得依赖真实用户工作区。
- 至少覆盖架构中的认领竞争、陈旧 owner、私信分页、等待竞态、停止/发布竞争、组合测试失败、崩溃补记与最终验证。
- 不使用 sleep 碰运气证明竞态；用显式屏障控制先后。不要为了绿灯删断言、吞错误、改测试绕过真实缺陷。
- 构建/单测成功与真实 DSH 加载成功分开报告；fake 测试通过不等于模型端到端成功。
- 不引入秘密到源码、fixture、日志或提交；真实模型验证使用现有路由，不复制凭证。
- 实现阶段允许补充确切类型、错误码和测试用例；会改变用户可见语义的决定写入 `IMPLEMENTATION.md` 并让 Lead 同步架构依据。
