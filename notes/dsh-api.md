# DSH 0.2.1-rc.4 真实 API 核验（Swarm 接线依据）

核验日期 2026-10-28。核验对象是**当前安装的 DSH 0.2.1-rc.4**，手段只有三种：Host `cordis_inspect_query`
（`Service` / `Event` / `Config` / `Tool`）、安装包 `<packageDir>/README.md` 与 `<packageDir>/lib/types/**/*.d.ts`、
以及只读的 `dsh --profile web --dump-config`。

本文只写**核验过的事实**。凡本文说"不支持"，都是因为签名或实现里确实没有该参数/方法，不是没找到。
与 [ARCHITECTURE.md](<../ARCHITECTURE.md>) 冲突之处集中在 §11。
worktree / sandbox / Git 执行细节已由 [workspace-api.md](<../notes/workspace-api.md>) 深入核验，
本文只在必要处交叉引用，不重复。

`<packageDir>` 一律指 `cordis_inspect_query(host, Config, listConfigs, { name })` 返回的字段；本文不放任何绝对安装路径。
所有 `@deepseek-ai/*` 包由 dsh 安装提供，bundle 不需要声明为依赖。

---

## 0. 先读这一节：怎么判断"当前真实可用"

`Service` / `Event` 目录是**类型声明目录，不是运行时挂载表**。反例在本 profile 已核实：

- `Service` 目录里有 `worktrees`、`browserUse`、`speechToText`、`webhookRuntime`、`workflowEngine`，
  但 `Config.listConfigs({ name: '@deepseek-ai/dsh-experimental-worktree' })` 返回 `total: 0`，
  `dsh --profile web --dump-config` 里也没有该行。**即 `ctx.worktrees` 在当前 profile 不存在。**
- 只看 Service 目录会把"已安装但未挂载"当成"可用"。

判据优先级（低 → 高）：

| 证据 | 能证明什么 | 不能证明什么 |
|---|---|---|
| `Service` 目录里有该 key | 类型声明存在、签名可引用 | 插件是否挂载 |
| `Config.listConfigs` 有该 `name` 的行 | Host Loader 里有该行 | 是否激活成功 |
| `dsh --dump-config` | 合成后的完整行表（含 bundle 层） | 运行时激活结果 |
| `ctx.get('x')` 返回非 `undefined` | 该服务在本进程真的可用 | — |

Host 插件必须用 `ctx.get(name)` 自行验证并在缺失时**尽早明确失败**（AGENTS §5），不要假设。

`Config.listConfigs` 的 `status` 语义（本 profile 实测推断）：

- `schema` = 已挂载且该包声明了 `Config`；
- `absent` = 已挂载但该包没有 `Config` 声明（`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-storage`、
  `@deepseek-ai/dsh-subprocess-local`、`@deepseek-ai/dsh-commands` 都是 `absent`，但它们的服务确实在跑）；
- `inactive` = 行存在但当前未激活（如 `tool-bash`、`tool-jobs` 的 Host 行；worker 的工具来自 preset 内的行，不是这些）。

### 0.1 本 profile（`web`）与 Swarm 相关的挂载事实

| 需求 | 服务 | 状态 | 依据 |
|---|---|---|---|
| run 存储 | `storageDomain` + `storage`(hub) + `storage-json`(backend `json`) | ✅ 可用，`storage-domain.config.backend = json` | dump 第 164-167 行 |
| 子会话管理 | `subagents` + `agents` + `agentLoop` | ✅ | `include:subagent` schema |
| 原生 spawn provider | `@deepseek-ai/dsh-subagent-spawn-in-process`，provider 名 **`spawn`** | ✅ | dump 第 347-350 行 |
| （fork provider 名 `fork`，本方案不用） | — | ✅ | dump 第 351-354 行 |
| Agent preset 注册 | `agentPresets` + 现有 `preset-standard/ptc/minimal/cordis` | ✅ | `include:agent-preset-registry` schema |
| 人类命令 | `commands` | ✅ | `include:commands` absent(已挂载) |
| 工具注册 | `tools` | ✅ | `include:tools` schema |
| 系统提示 | `systemPrompt` | ✅ | `include:system-prompt` schema |
| 会话目录 | `workingDirectory` | ✅ | `include:working-directory` |
| 后台作业 | `jobs` | ✅ | `include:jobs` schema |
| 子进程 | `subprocess` | ✅ | `include:subprocess` absent(已挂载) |
| **worktree** | `worktrees` | ❌ **未挂载** | Config 无该行、dump 无该行 |

结论：**本插件 bundle 必须自己插入 `worktrees` 服务行**（§10.2），否则 ARCHITECTURE §5.3 的创建顺序无法执行。
详见 §11.1。

---

## 1. `subagents.startActivation` —— 精确契约

包：`@deepseek-ai/dsh-subagent`。类型位置：`<packageDir>/lib/types/index.d.ts`（服务类）
与 `.../types.d.ts`（`SubagentActivationSpec` 等）。服务 key `subagents`。

```ts
startActivation(spec: SubagentActivationSpec & { readonly childId: SessionId }):
  Promise<SubagentActivation & { readonly messageId: MessageId }>
startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>
```

```ts
interface SubagentActivationSpec {
  readonly provider: string                       // 'spawn'
  readonly label: string
  readonly childId?: SessionId                    // 提供即走本地 backend，且保证返回 messageId
  readonly request: Omit<SubagentStartRequest, 'label' | 'signal'>
  readonly signal: AbortSignal                    // 只取消"未发布"阶段
  readonly delivery: 'parent' | 'caller'
}

interface SubagentStartRequest {
  readonly cwd?: string                // 相对路径按父 agent 当前目录解析；省略=拷贝父当前目录
  readonly agentPreset?: string         // 只有 spawn 支持独立 preset
  readonly label?: string
  readonly prompt: ContentBlock[]       // 必填
  readonly parent: Agent                // 必填，必须是 exact live Agent
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions  // provider/model/reasoningEffort/maxTokens
  readonly outputSchema?: ObjectJsonSchema
  readonly maxDepth?: number            // 对"子 agent 深度"的绝对上限
}

interface SubagentActivation {
  readonly childId: SessionId
  readonly messageId?: MessageId
  readonly result: Promise<SubagentResult>
  dispose(): Promise<void>
}
```

### 1.1 逐项确认（任务点名的四个词）

| ARCHITECTURE 的说法 | 真实情况 |
|---|---|
| 指定 `childId` | ✅ `spec.childId`。提供时走本地 backend，"Start a local child under its reserved identity"，返回类型收紧为带 `messageId` 的重载。id 已被占用则启动失败（安装包实现 `assertChildIdAvailable` → `DUPLICATE_CHILD`）。 |
| 指定 `parent` | ✅ `request.parent: Agent`。必须是**当前 live 的 exact Agent 对象**；缺失或被替换报 `UNAUTHORIZED`。`ctx.agents.get(sessionId)` 是取到该对象的正确方式。 |
| 指定 `agentPreset` | ✅ `request.agentPreset`。只有 spawn 支持；fork 与外部 backend 拒绝（`UNSUPPORTED_CAPABILITY`）。显式 id 会挂载**当前可用 revision**，即使与父相同。省略则加入父的当前 revision。 |
| `permission` 参数 | ❌ **不存在**。见 §1.2。 |
| `delivery: 'caller'` | ✅ 字面量。`'parent'` 会额外给父模型一条完成通知；`'caller'` 不给通知，由调用方 await `activation.result`。**本地 child 用 `'caller'` 时允许临时（无持久化）session；本地 `'parent'` delivery 必须有 session 持久化。** |

### 1.2 permission：没有入参，只有继承规则（重要限制）

`startActivation` 及其 `request` 里**没有** sandbox / approval / permission 字段。实现里唯一相关的是
`captureDelegatedPolicyOverrides(parent)`（在子会话创建窗口内写入子会话自己的日志）：

```ts
{
  permissionPreset: preset === 'auto' || preset === 'danger-full-access' ? preset : undefined,
  sandboxMode:      sandboxPolicy.overrideOf(parent.session),   // 只取父 session 的显式 override
  approvalPolicy:   approval === undefined ? undefined : 'never',
}
```

写成子会话事件：`sandbox/mode {mode, source:'delegation'}`、`approval/policy {policy:'never', source:'delegation'}`、
`permission/preset {preset}`。由此得到三条硬事实：

1. **worker 的 approval 恒为 `never`。** 子会话里任何需要审批的操作被自动拒绝，不会弹给用户。
   这与 AGENTS §3"不在插件执行中扩大权限"一致，但意味着：**worker 能做的事完全由启动时的 sandbox 模式决定**。
2. **sandbox 模式是"父 session 最后一条 `sandbox/mode` 事件"的继承，不是部署默认值的直接透传。**
   链条是三段，缺一段结果就变：
   - 父（owner）session 在 `session/created` 时被 `permissionPresets.pinInitialPermission()` 写入
     `permission/preset` + `sandbox/mode` + `approval/policy`，值取自 `permission.defaultPreset`。
     本 profile `defaultPreset = danger-full-access`，所以**正常情况下** owner 有显式
     `sandbox/mode=danger-full-access`，worker 继承到同一个值。
   - 但如果 `permission` 插件不挂载 / owner session 早于该插件创建 / owner 从未被 pin，
     `overrideOf(owner)` 为 `undefined`，子会话就没有 `sandbox/mode`，随后在 `session/created` 被
     `pinInitialPermission()` 的 else 分支补成 `ctx.shell.sandboxMode`——那来自
     `sandbox-policy.config.mode = !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`。
   - 用户把 owner 切到 `read-only` 之类的 preset，worker 就跟着变 read-only。
   **结论：不要假设 worker 是 danger-full-access。** 唯一可靠做法是读 worker/owner session 的
   `ctx.sandboxPolicy.resolve({ session })` 再决定放行，并把它显示在 status 里。
3. **插件不能给某个 worker 单独降/升权限**，也不能"临时批准一次"。这也意味着"worker 需要写权限而实际只有
   read-only"只能在启动前检测并明确失败/暂停，不能运行时补救。

可执行建议（Host 侧启动前预检）：

```ts
const policy = ctx.get('sandboxPolicy')?.resolve({ session: ownerAgent.session })
if (policy === undefined) throw new SwarmError('SANDBOX_UNAVAILABLE', '...')
if (policy.mode === 'read-only')
  throw new SwarmError('SANDBOX_READ_ONLY', 'worker 需要写权限；当前 session 的 sandbox 为 read-only')
// 把 policy.mode / policy.workspaceRoot 记进 Run 的启动诊断，status 里显示
```

另外 `childCtx.systemPrompt.context({ name: 'subagent:delegation', ... })` 会**自动**给每个子会话注入
一段 runtime context，明确告诉模型"你的权限在启动时固定、需要审批的操作会被自动拒绝"。
这段不需要我们写，但也意味着 worker 会主动报告权限受限——runtime 要把这种报告当成可能需要暂停的诊断，而不是普通失败。

### 1.3 其余字段的真实语义

- `cwd`：子会话**在 creation window 内**通过 `workingDirectory.set(child, cwd)` 落地（实现
  `applyChildComposition` 之后、`agent/created` 之前）。所以 `agent/created` 里读到的 cwd 已经是 `request.cwd`。
  传 `cwd: repositoryRoot` 即可省掉"先建集成树再把 cwd 切回源仓库"的绕行（见 §11.2）。
- `agentOptions`：覆盖 provider/model/reasoningEffort/maxTokens。其余（cwd、lineage、输出 token 上限）继承父。
  ARCHITECTURE §12.1"worker 模型路由默认继承原 owner 当前模型" = 省略 `agentOptions`。
- `maxDepth`：`resolveChildDepth(parent, maxDepth)` 里 `childDepth = parentDepth + 1`，
  `childDepth > maxDepth` 抛 `SubagentDepthError`。owner 是 depth 0，所以
  **`maxDepth: 1` 正好表示"允许创建 worker，但 worker 不能再创建孙 agent"**。这是硬约束，别只靠 preset 不给工具。
- `label`：只是展示标签，不参与授权。
- `outputSchema`：本方案不需要（worker 不用 structured output；`swarm_wait` 用 `concludeTurn`）。

### 1.4 可用片段：启动一个 worker

```ts
import { SessionId } from '@deepseek-ai/dsh-session'

const childId = SessionId(reserveWorkerSessionId())   // 无校验地打 brand；真正的冲突检查在 startActivation 内
const activation = await ctx.subagents.startActivation({
  provider: 'spawn',
  label: `swarm ${runId} worker ${workerKey}`,
  childId,
  delivery: 'caller',
  signal: runAbort.signal,
  request: {
    parent: ownerAgent,                    // ctx.agents.get(ownerSessionId)!，必须是 live 对象
    cwd: run.repositoryRoot,
    agentPreset: 'swarm-worker',
    maxDepth: 1,
    prompt: [{
      type: 'text',
      text: `You are worker ${workerKey} of Swarm run ${runId}. `
          + `Call swarm_sync first to load the goal, acceptance criteria and current state.`,
    }],
  },
})
// activation.childId === childId；activation.messageId 必有值
// 收尾信号：activation.result（见 §2）
```

`SessionId(id: string)` 来自 `@deepseek-ai/dsh-session`，仅 `brandString`，不做格式校验。

---

## 2. activation 结算与冷恢复

### 2.1 `subagent/start` / `subagent/end` 精确类型与作用域

包：`@deepseek-ai/dsh-subagent`（事件在 `lib/types/index.d.ts` 的 `declare module '@deepseek-ai/cordis'`；
运行信息类型 `SubagentRunInfo` / `SubagentRunEndInfo` 在同处 `types.ts`）。

```ts
'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void      // mode: emit
'subagent/end'  (this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void   // mode: emit

interface SubagentRunInfo {
  readonly runId: SubagentRunId
  readonly provider: string
  readonly id: SessionId          // = 子会话 id
  readonly local: boolean
}

interface SubagentRunEndInfo extends SubagentRunInfo {
  readonly stopReason: SubagentResult['stopReason']       // 'completed'|'aborted'|'error'|'max-tokens'|'refusal'
  readonly lastAssistantMessage?: readonly ContentBlock[]
}
```

**作用域**：两个事件都是 `emit` + 按"委派父"做 scope-filtered dispatch。
"Scope-filtered dispatch keys the carrier by the delegating parent, so a parent-scoped listener observes only its own delegations."
从 Host/插件全局 ctx 注册的普通监听器会收到**所有** agent 的委派事件，
所以必须自己按 `info.id ∈ run.workers` 过滤，不要靠作用域。

**关键时序事实（原样引用安装包 README）：**

- `runId` 区分同一条 Session 的多次 activation。`info.id` 相同、`runId` 不同 = 冷恢复产生的新 activation。
- turn 结束 ≠ activation 结束。同一驻留 activation 的多个 turn **不会**各发一次 `subagent/end`。
- `activation.result` 在 teardown + 通知之后结算。二者**任一到达即可结算**；两个都到用 `runId` 去重。
- 冷恢复产生的新 activation 也会发 `subagent/end`。

去重键用 `info.runId`（IMPLEMENTATION.md 已记这条），**不要**用 `childId` 或 turn 号。

### 2.2 `sendMessage`：唯一合法的父→子投递

```ts
async sendMessage(
  sender: Agent,
  targetId: SessionId,
  content: ContentBlock[],
  options: SubagentSendMessageOptions,   // { readonly signal: AbortSignal }
): Promise<MessageId>
```

包：`@deepseek-ai/dsh-subagent`。真实语义（README + 实现 `createAgentMessage`）：

- **只支持相邻**：`sender` 必须是"活着的、exact 的发送者 Agent"；每个 sender 可以发给自己的**直接 continuable child**，
  只有持有驻留 continuable activation 的 sender 才能发给自己的**直接父**。兄弟之间**不能**直发。
  → ARCHITECTURE §7.5 的 owner 中继设计是对的，而且**不是可选项**。
- running target 在最近 step 边界被 admit；idle target 会**开一个新 turn**；**缺席的直接子会话从持久化冷恢复**。
  冷恢复需要 session 持久化 + Session query（本 profile 都有）。
- 落地形态是 `user` 角色消息，`source = { kind: 'agent-message', form: 'relay', senderSessionId }`，
  正文被前置成 `` `Agent ${sender.id} sent a message: ` ``。**模型看到的是裸 SessionId，不是"Worker A"**。
  因此控制通知正文里必须自带身份提示（例如"你是 worker w1，这条来自 owner"），否则 worker 认不出是谁。
- 抛错条件：continuation 服务不可用（`CONTINUATION_UNAVAILABLE`）、相邻性被拒、消息未被 admit。
- 容量上限：`maxActiveSubagents` 默认 8，是按 activation 树计的；满时**创建或冷恢复**报
  `ACTIVATION_LIMIT_REACHED`（浏览器侧表现为 `subagent/delivery-unavailable`）。不会排队。
  本方案 2–4 worker + 1 个 owner 远低于 8，但若以后支持递归要复核。
- 收件成功 ≠ 模型已处理。这与 ARCHITECTURE §7.1 的 `notifiedSeq` 语义一致。

### 2.3 其它控制面方法（都已核验存在）

```ts
interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void
  // authority = { kind:'user', parentSessionId } | { kind:'ancestor', agent }
  // fire-and-return：只发 cancel 信号；"已请求"≠已静止
async drainChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void>
  // 只释放指定的驻留直接子会话；其它子会话不受影响；缺席/无 manager 时是 no-op
async drainDescendants(parents: readonly Agent[]): Promise<void>
async waitForChildren(parent: Agent): Promise<boolean>   // 不取消，只 join
async listChildren(parentSessionId: SessionId, signal?): Promise<SubagentCatalogEntry[]>
```

`drainChildren` 的语义正合 ARCHITECTURE：**只 drain 本 run 的子会话**，别用 `drainDescendants(owner)` 误杀用户的其它子会话。
注意 `interrupt` 不会 requeue 已被 claim 的工作，也不删 activation。"stop 干净"必须再等资源静止（`agents.get(id)?.whenIdle()`
或依赖 `subagent/end`）。

### 2.4 活跃状态与"不可用"

- `ctx.agents.get(sessionId)` → `Agent | undefined`，`agent.status` 为 `'idle' | 'running'`。
  这是**唯一**可信的活跃来源；不可把上次持久化的 `running` 当证据（ARCHITECTURE §4.2）。
- `ctx.agents.isOwnedBy(sessionId, ownerAgent)` 可用于核对归属。
- "不可用"（provider 缺失 / session 缺失 / 最近恢复失败）只能是**插件自己的诊断标签**，DSH 没有这个状态。
  与 ARCHITECTURE §12.1 的要求一致；实现时放在 Run/Worker 记录里，别伪造 `agent.status`。

---

## 3. `agent/created`：模型第一次请求前的初始化窗口

包：`@deepseek-ai/dsh-agent`（`lib/types/runtime-types.d.ts` 的 `declare module '@deepseek-ai/cordis'`）。
`mode: serial`，签名：

```ts
'agent/created'(this: Scoped<Agent>, payload: {
  agent: Agent
  source: SessionStartSource      // 'startup' | 'resume' | 'clear' | 'compact'
  signal?: AbortSignal
}): undefined | Promise<undefined>
```

已核验的时序保证（文档原文要点）：

- "listeners run in order and are awaited before creation resolves. AgentLoop holds queued input until all listeners finish."
- "A throw or rejection fails creation and skips later listeners." → 初始化失败能真正阻止 run 启动（ARCHITECTURE §5.3 第 7 点）。
- "Disposal retains the scope and session until dispatch settles; **listeners must not await `agent.whenIdle()`** or their own owner's disposal."
  → ARCHITECTURE §9 表格里"监听器内不能等待该 Agent 自己 idle"是硬约束，不是风格建议。
- 作用域：`agent/created` 也是 scope-filtered；从全局 ctx 注册会收到全部 agent，必须按 `agent.id` 过滤到 `run.workers`。

### 3.1 为什么这里能注册工具/提示，而 setup 不能用于 subagent child

`CreateAgentOptions.setup` / `ResumeAgentOptions.setup`（`@deepseek-ai/dsh-agent`）是"creation-time composition"，
在 `agentCtx` 铸造后、`session/created` 与 `agent/created` 之前 await，注册的东西全部先于第一次 prompt assembly 存在
——**但 `SubagentActivationSpec` 里没有 `setup` 透传**，我们无法给 subagent child 提供 setup。
所以 subagent child 只能用 `agent/created` + `agent.ctx`。`agent/created` 同样早于第一次 assembly，够用。

`agent.ctx` 注册的隔离性有三份安装包文档交叉确认：

- `dsh-scope` README："a tool registered through `agent.ctx` is visible only to that agent"；
- `dsh-system-prompt` README："registering through `agent.ctx` affects that agent alone and shadows a same-named global"；
- `dsh-agent` README："Registrations through `agent.ctx` can shadow prompt sections or tools and can install agent-only interceptors"。

`Agent.ctx` 的生命周期：`agent.ctx` 的贡献"are agent-local, unwind on disposal, and reject registration afterward"，
因此 agent 销毁时自动清理，插件卸载时随插件 scope 一起清理（双 owner，符合 AGENTS §3）。

### 3.2 片段：worker 初始化（worktree + 工具 + 只读提示）

```ts
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const offCreated = ctx.on('agent/created', async ({ agent, source }) => {
  const worker = lookupReservedWorker(agent.id)          // 只处理本 run 预留的 SessionId
  if (worker === undefined) return                        // 别人的 agent，立刻返回
  if (source !== 'startup') return                        // resume 走恢复路径，不重复建树

  const worktrees = ctx.get('worktrees')
  if (worktrees === undefined)
    throw new SwarmError('WORKTREE_SERVICE_MISSING', 'bundle 未插入 worktrees 服务行')
  const directory = ctx.get('workingDirectory')
  if (directory === undefined)
    throw new SwarmError('WORKING_DIRECTORY_MISSING', '缺少 ctx.workingDirectory')

  // worker 的 cwd 已经是 request.cwd（= Run.repositoryRoot），直接从这里建它的私有树
  const created = await worktrees.create(agent, { name: worker.branch, from: run.baseCommit })
  // created: { path, branch, baseCommit, repositoryRoot }；调用后 agent 的 cwd = created.path
  await markWorkerInitialized(worker.id, created.path)

  // 只给这个 worker 装的工具（工厂内部是 ctx.tools.register(defineTool(...))）
  workerTools.registerOn(agent.ctx, { runId: run.id, workerId: worker.id })
})
```

注意 `agent/created` 会 await 这个 async 监听器，**不要在里面跑 git 长测试或等模型**；只有 worktree 创建这类有限步骤。
集成 worktree 的创建见 §11.2（不需要挂在 worker 的创建窗口里）。

---

## 4. 工具注册：`ToolDefinition` / `ToolRunContext` / 输出 schema / `concludeTurn`

包：`@deepseek-ai/dsh-tools`。类型位置：`<packageDir>/lib/types/index.d.ts`（`ToolDefinition`、`ToolRunContext`、
`ToolExecution*`、`ToolOutputDefinition`）与 `.../schema.d.ts`（`defineTool`、`DefineToolOptions`、`ValueSchemaSpec`）。
服务 key `tools`。

### 4.1 注册面

```ts
register(definition: ToolDefinition): () => void
restrict(filter: ToolRestriction): () => void                       // { allow?, deny? }
guard(guard: ToolGuard): () => void                                  // (exec) => string | undefined，返回字符串即拒绝
presentAs(mode: 'native' | 'ptc'): () => void                        // scoped only，一 scope 一条
get(name: string, scope?: ScopeKey): ToolDefinition | undefined
schemas(scope?: ScopeKey): ToolSchema[]
```

已核验的行为约束：

- "Scoped tools shadow globals; duplicates within one layer and the reserved `run_code` name fail."
- `register`/`restrict`/`presentAs` 的注册层由**调用方 context 的 scope** 决定
  （实现为 `ScopedLayers.effect(this.ctx, …)`，而 `ctx` 是 cordis 的 caller-tracked 属性）。
  所以：Host 插件里调 = 全局；`agent.ctx.tools.register` = 该 agent；preset 内插件里调 = 该 preset 下所有 agent。
- 工具参数在进入 `execute` 前已由 registry 校验并 deep-freeze（"losslessly snapshotted, frozen model arguments"）。
  不要重复解析已校验的同进程类型（AGENTS §2）。

### 4.2 `ToolDefinition` 精确形状（含两个 schema 概念的区别）

```ts
interface ToolDefinition extends ToolSchema {          // ToolSchema: name/description/parameters/deferLoading?
  readonly output: ToolOutputDefinition
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  projectContent?(exec, result): ContentBlock[] | undefined
  finalizeContent?(exec, result): ContentBlock[] | undefined
  timeoutMs?: number
  isConcurrencySafe?(args: unknown): boolean
  presentCall?(args: unknown): ToolCallView | undefined
  presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined
}

interface ToolOutputDefinition {
  readonly schema: JsonSchemaNode                  // 原样 JSON Schema，对"成功返回值"逐次校验
  render(args: unknown, value: JsonValue): ContentBlock[]   // 模型实际看到的 content
  presentationMeta?(args: unknown, value: JsonValue): JsonValue
}
```

**易错点：有两套 schema 语法。**

- `defineTool({ parameters, output: { schema } })` 用的是 `ValueSchemaSpec` DSL
  （`{ type:'object', properties:{...}, additionalProperties:false }`，required 写成属性上的 `required: true`）。
- 手写 `ToolDefinition` 时 `output.schema` 是 `JsonSchemaNode`（标准 JSON Schema 形状）。
- 两者都能用，**不要混写**。`output.render` 决定模型看到什么：`@deepseek-ai/dsh-tool-todo` 就是只回一句
  `Updated todo list: X pending …`，而不是把 JSON 灌进模型。ARCHITECTURE §6.2"返回可捎带有界摘要"要落在 `render` 里。

### 4.3 `ToolRunContext` 与 `concludeTurn`

```ts
interface ToolRunContext extends ToolExecution {
  deferContext(context: UserMessage): void
  concludeTurn(): void
}
interface ToolExecution extends ToolExecutionInput {
  readonly rootCallId: ToolCallId
  readonly token: ToolExecutionToken
}
interface ToolExecutionInput {
  readonly callId: ToolCallId
  readonly name: string
  readonly arguments: unknown
  readonly agent?: Agent            // ← 模型身份的唯一可信来源
  readonly signal: AbortSignal
  …
}
```

已核验的关键语义：

- `concludeTurn()` 只是把本次执行加入 `concludingExecutions`；标记最终落在
  `ToolExecutionSuccess.concludesTurn = true` 上，**只存在于成功结果**（`ToolExecutionFailure` 上是 `concludesTurn?: never`）。
  所以 `swarm_wait` 必须**成功返回**（不能抛错）才可能让出 turn。
- PTC 模式下 `concludeTurn` 由复合工具（`run_code`）从嵌套结果转发；因此 worker preset 建议用 native presentation
  （不挂 `ptc-runtime` / 不 `presentAs('ptc')`），避免多一层转发的时序问题。
- `exec.agent` 对非 agent 调用者可能 `undefined`；`swarm_*` 一律要求有 agent，否则报错（不要猜身份）。
- `exec.signal` 是调用方取消信号，长操作要转发并达到静止（AGENTS §4）。

### 4.4 片段：一个最小 `swarm_*` 工具

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

export function registerOn(agentCtx: Context, ids: { runId: string; workerId: string }) {
  return agentCtx.tools.register(defineTool({
    name: 'swarm_sync',
    description:
      'Read the run goal, acceptance criteria and new collaboration items, then acknowledge your read position. '
      + 'Does not modify tasks or code.',
    parameters: {
      ack_seq: { type: 'integer', description: 'Advance your observed prefix to this run seq. Omit to only read.' },
      limit: { type: 'integer', description: 'Max item summaries to return (default 20, cap 50).' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          throughSeq: { type: 'integer', required: true },
          hasMore: { type: 'boolean', required: true },
          items: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
      render: (_args, value) =>
        [{ type: 'text', text: renderSyncSummary(value) }],     // 有界文本，不灌 JSON
    },
    execute: async (args, exec) => {
      if (exec.agent === undefined) throw new Error('swarm_sync requires an owning agent session')
      return services.swarm.sync(ids.runId, ids.workerId, exec.agent, args, exec.signal)
    },
  }))
}
```

---

## 5. 人类命令：`commands.register`

包：`@deepseek-ai/dsh-commands`。类型位置 `<packageDir>/lib/types/index.d.ts` 与 `.../types.d.ts`。
服务 key `commands`（本 profile 已挂载）。

```ts
interface CommandDefinition {
  readonly definitionId?: CommandDefinitionId
  readonly name: string                 // 小写，不带斜杠；实现校验 /^[a-z][a-z0-9_-]*$/
  readonly description: string
  readonly input?: CommandInputDescriptor      // { hint: string; attachments?: boolean }
  readonly recordInput?: boolean                // 默认 true；false 表示正文由自己的 domain 事件承载
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}

interface CommandInvocation {
  readonly commandId: CommandId
  readonly agent: Agent                 // 收到命令的 exact agent（= owner）
  readonly rawInput: string             // 命令名之后的原文，含分隔空白，不 trim
  readonly attachments: readonly (ImageBlock | FileBlock)[]
  readonly signal: AbortSignal
}

type CommandResult =
  | { readonly kind: 'success'; readonly text?: string; readonly sourceEventSeq?: SessionSeq }
  | { readonly kind: 'error';   readonly text: string }

interface CommandExecution { readonly commandId: CommandId; readonly result: CommandResult }
```

解析规则（`parseCommand` 实现，已核验正则 `/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/`）：

- `/swarm start --spec ./x.json` → `{ name: 'swarm', rawInput: ' start --spec ./x.json' }`。
  **`rawInput` 带前导空格，必须自己 `trim()`；参数解析完全由我们负责**，DSH 不切 argv。
- `/swarm` 单独一行 → `rawInput: ''`。
- `commands.execute(agent, line, attachments, signal)` 返回 `Promise<CommandExecution | undefined>`；
  **语法或命令名不匹配时返回 `undefined`**，不是抛错。

已核验的生命周期副作用：命中命令会写 `command/run` 与 `command/done` 两个 log-only Session 事件（不包 turn）。
`command/run` 写入失败会让整次执行失败；`command/done` 失败被吞掉以保留 handler 自身错误。
所以命令 handler **不要**被当作"不影响会话日志"的旁路。

作用域：`register` 的层由调用方 ctx 的 scope 决定。Host 插件里注册 = 全局（worker 会话也能看到这个命令列表）。
若不想让 `/swarm` 出现在 worker 会话，就把它挂到 owner 的 `agent.ctx` 上（`ctx.inject(['commands'], …)` 形态），
代价是 owner 重建后要重新注册。v0.1 建议**全局注册**，并在 handler 里用 `invocation.agent.id === run.ownerSessionId` 验权
（ARCHITECTURE §12.1 只要求 owner 验权，没要求隐藏）。

骨架：

```ts
const dispose = ctx.commands.register({
  definitionId: CommandDefinitionId('@local/dsh-swarm'),
  name: 'swarm',
  description: 'Start, inspect, pause, resume or stop a Swarm run.',
  input: { hint: 'start --spec <file> | status [--details] | pause | resume [--budget 30m] | stop' },
  recordInput: true,
  async handler({ agent, rawInput, signal }) {
    const argv = tokenize(rawInput.trim())          // 自己实现；空输入 = 用法错误
    if (argv.length === 0) return { kind: 'error', text: USAGE }
    try {
      return { kind: 'success', text: await commands.dispatch(agent, argv, signal) }
    } catch (error) {
      const known = asSwarmError(error)
      return { kind: 'error', text: known === undefined ? `swarm: ${String(error)}` : `${known.code}: ${known.message}` }
    }
  },
})
```

`CommandResult` 只有 `text`（和可选 `sourceEventSeq`），**没有结构化 payload 通道**；
`--details` 的多段输出要自己排版成受长度限制的文本（ARCHITECTURE §12.1 的"每页最多 20 项"要求仍由我们保证）。

---

## 6. `storageDomain`：`defineDomain` / `domainTable` / zod / 生命周期

包：`@deepseek-ai/dsh-storage-domain`。类型位置 `<packageDir>/lib/types/spec.d.ts`（`DomainSpec`、`defineDomain`、
`domainTable`）、`.../domain.d.ts`（`Domain`、`KvTable`）、`.../events.d.ts`（`DomainChanged`）。
服务 key `storageDomain`（`DomainFacility`）。本 profile 已挂载，`storage-domain.config.backend = json`，
backend 由 `@deepseek-ai/dsh-storage-json` 注册为 **`json`**。

```ts
async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>
get(name: string): DomainImpl | undefined
async closeAll(): Promise<void>

interface Domain<S extends DomainSpec> {
  readonly name: string
  readonly global: DomainGlobalHandleOf<S>          // spec 无 global 时为 never（不可用）
  table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>
  close(): Promise<void>
}

interface KvTable<K extends string, V> {
  get(key: K): V | undefined
  entries(): IterableIterator<[K, V]>
  keys(): IterableIterator<K>
  readonly size: number
  put(key: K, value: V): Promise<void>
  delete(key: K): Promise<boolean>
  update(key: K, fn: (current: V) => V): Promise<V>
}
```

### 6.1 六条必须知道的实现事实

1. **zod 版本是 4。** `dsh-storage-domain` 依赖 `zod@4.4.3`，`DomainTableSpec.valueSchema: ZodType<V>`。
   本项目 `dependencies.zod = ^4.1.12`，同时满足；**不要**用 zod 3 schema。
2. **只有 `open()` 会校验 schema。** `put` / `update` 的写入**不做** zod 校验（实现里 `putRecord` 直写）。
   所以写入口必须自己校验（AGENTS §2 的入口校验要求），schema 只是 reopen 时的防线。
   `open()` 会校验**每条已存记录**，任一非法 → 整次 open 失败 `invalid-record`（除非 spec 声明
   `invalidRecords: 'backup-and-skip'`，那是给可丢弃派生数据用的，**Run 聚合数据不能用**）。
3. **`update` 对不存在的 key 抛 `DomainError('missing-key')`。** 不是 upsert。
   → `create(run)` 必须 `put`，之后的业务变更才能 `update`。这条直接影响 `src/store.ts` 的 `create/update` 分工。
4. **名字必须匹配 `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/`**（domain 名与每个 table 名都校验，模块加载期就 throw）。
   `dsh-swarm` **不行**（有连字符），用 `dsh_swarm`。
5. **写入顺序保证**：每个 domain 一条写链；`await` 后端持久化 **→ 才** 改内存 **→ 才** emit `domain/changed`。
   写失败时内存不变（读与介质不会分叉），事件里带的就是当时内存值，且按写入顺序。
   → "状态持久化后才通知"（ARCHITECTURE §4）由 DSH 本身保证，插件不要自己再造一层。
6. **`get()` 返回的是存储对象本身，不做 defensive copy**，不可原地 mutate；必须 `put`/`update` 换新对象。
   reducer 必须是纯同步：`update` 的 `fn` 在写链的队列槽里同步执行，`await` 会污染整条链（AGENTS §4）。

### 6.2 片段

```ts
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { runSchema } from '../schema.ts'

export const swarmDomainSpec = defineDomain({
  name: 'dsh_swarm',
  version: 1,
  tables: {
    runs: domainTable<string, z.infer<typeof runSchema>>(runSchema),
  },
})

export async function openSwarmDomain(ctx: Context) {
  const facility = ctx.get('storageDomain')
  if (facility === undefined)
    throw new SwarmError('STORAGE_UNAVAILABLE', 'storageDomain 未挂载')
  const domain = await facility.open(swarmDomainSpec)
  ctx.effect(() => () => { void domain.close() })        // caller 拥有句柄；close 幂等
  return domain.table('runs')
}
```

`defineDomain` 是恒等函数，只在模块加载期做字段校验：名字/版本/`global.schema` 不得接受 `null`
（`null` 是"从未写入"哨兵）。`descriptorOf(spec)` 只是投影，业务代码不需要。

`Domain.close()` 语义：立即拒绝新写、排空已排队写（其事件仍 emit）、释放 backend unit、释放名字。幂等。
facility 卸载时会关闭仍开着的 domain（`closeAll`），但**所有权在调用方**，仍应显式挂 disposer（AGENTS §3）。

---

## 7. `systemPrompt.section`

包：`@deepseek-ai/dsh-system-prompt`。类型位置 `<packageDir>/lib/types/index.d.ts`。服务 key `systemPrompt`。

```ts
section(section: PromptSection): () => void
context(context: PromptContext): () => void
tools(provider: (ctx: AssembleContext) => ToolProviderResult): () => void
variable(name: string, provider: (ctx: AssembleContext) => string | undefined): () => void
getSectionOrder(name: PromptSectionOrderName): number
getContextOrder(name: PromptContextOrderName): number

interface PromptSection {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: AssembleContext) => string)
  readonly interpolate?: boolean       // false 保留字面量 {{…}}
  readonly complete?: boolean          // true = 独占整个 system prompt（不要用）
}
```

已核验要点：

- "A scoped section shadows a global section with the same name; duplicates within one layer and non-finite orders throw."
  → 同名才能在 agent scope **覆盖**全局 section（`@deepseek-ai/dsh-persona` 就是靠这个替换 `deployment:persona-prefix`）。
- 注册与释放都会 emit `system-prompt/change`。
- `getSectionOrder(name)` 只接受**中心分配的已知名字**。已核验的 `SECTION_ORDERS` 表（节选）：
  `HARNESS_IDENTITY:-1000`、`DEPLOYMENT_PERSONA_PREFIX:0`、`PLAN_POLICY:500`、`TEAM_POLICY:600`、
  `PTC_ONLY:800`、`FILE_REFERENCE:900`、`TOOL_BASH:1000`、`TOOL_READ:1100`、`TOOL_WRITE:1200`、
  `TOOL_JOBS:1600`、`TOOL_SUBAGENT:2800`、`TOOL_REPORT:2900`、`MCP_SERVERS:3100`、`TOOLS_SDK:5000`、`STRUCTURED_OUTPUT:9900`。
  **没有给我们这种第三方插件预留的槽位名**，所以自定义 section 只能自己写一个数字 `order`。
  建议取 `TOOL_REPORT`(2900) 与 `MCP_SERVERS`(3100) 之间的空档，例如 `2950`，并写清理由。
- `PromptContext`（`context()`）多一个 `required?: boolean`；本方案若要给 worker 加动态上下文，用 `context()` +
  `getContextOrder('SUBAGENT_DELEGATION')` 附近的槽位。注意 `subagents` 自己已经占用 `subagent:delegation`。
- **不要用 `complete: true`**，也不要挂在 `system-prompt/assemble` waterfall 上改整体（AGENTS §3：不劫持整个 system prompt）。

worker 的固定协作指令有两种落法，二者择一：

1. 在 `swarm-worker` preset 里挂 `@deepseek-ai/dsh-persona`（`config.prefix`）——最简单，已核验行形状见 §10.3；
2. 在 `agent/created` 里 `agent.ctx.systemPrompt.section({ name: 'swarm:worker-protocol', order: 2950, text })`。

选 1 更稳（persona 是文档化的 preset 用法），选 2 让指令随 Host 版本走。v0.1 建议 1 + 少量 2 补动态部分。

---

## 8. 插件入口、bundle 清单与 meta 图标

### 8.1 Host 插件导出形态（三选一，不要混）

```js
export function apply(ctx, config) {}                 // 可选 export const inject = ['tools', ...]; 可选 export const Config
export default class MyService extends Service {}     // 服务类形态
```

`Config` 用 `@deepseek-ai/schemastery`（`import z from '@deepseek-ai/schemastery'`），
**不是 zod**。zod 只用于 domain 记录 schema 和工具参数之外的校验。
装载时会对 `config` 做校验，`Config.listConfigs({ name })` 能读到投影后的 JSON Schema。

### 8.2 bundle 清单

`package.json`（`.dsh.bundle.patch` + 可选 `icon`）：

```json
{
  "name": "@local/dsh-swarm",
  "type": "module",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./worker": { "types": "./lib/types/worker.d.ts", "default": "./lib/worker.js" },
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["lib", "cordis.patch.yml", "locale", "icon.svg", "USAGE.md"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

（`DshBundleManifest.patch` 是 `string | string[]`，可以是按序应用的多份 patch。）

`cordis.patch.yml` 是 **顶层 YAML 数组**；每项要么 `insert: [rows]`，要么用 `id` 定位已有行改字段。
`config` 是**整体替换**，不是深合并。已安装的 bundle 用 `plugin_manager install_bundle`（`target` = 包目录），
不要手写 profile 的 `package.json` / `cordis.patch.yml`。

### 8.3 meta 标题/描述与图标（不激活就会读）

- 语言资源：`locale/en.json`、`locale/zh.json`，键路径是 `meta.title` / `meta.description`：

```json
{ "meta": { "title": "Swarm", "description": "Two peer workers with isolated worktrees and verified integration." } }
```

- 导出 `./locale/*.json` 与 `./icon`（或 package 根 `icon` 字段，优先级更高）。
- 图标约束（已核验）：SVG/PNG/JPEG/WebP，**≤ 256 KiB**，必须 realpath 后仍在包内；绝对路径、URL、指向包外的符号链接被拒。
- 缺失时回退到 `package.json` 的 `name`/`description` 与面板默认图；格式错误给诊断但保留合法文本。
- 子路径插件（如 `@local/dsh-swarm/worker`）**不是包**，不读 `package.json`，导出 `./worker/locale/*.json`
  与 `./worker/icon`。本项目的 `./worker` 只注册 worker 工具，没有独立 UI 行，可以不给它单独图标。

### 8.4 服务扩展声明（提供 Host 服务给 preset 用）

本方案推荐的接线：Host 入口提供 `swarm` 服务，preset 内的 worker 工具通过普通 `inject` 拿它。

```ts
// src/index.ts —— Host 入口
export const name = 'swarm-host'
export const inject = ['tools', 'commands', 'subagents', 'agents', 'storageDomain', 'workingDirectory']
export const Config = z.object({ /* … */ })

export function apply(ctx: Context, config: Config) {
  ctx.plugin(SwarmService, config)        // SwarmService extends Service，provide('swarm')
  // 或 class 形态 + 显式 ctx.provide('swarm')
}
```

真实约束（`dsh-agent-preset-registry` README 原文）：

> A preset service provider and its consumers must share one `cordis:group` isolation realm. Entry-local isolation does not
> propagate through the Agent registration scope: ordinary Context lookup outside the group, including `agent.ctx`, still
> selects the Host realm.

含义：**preset 里的插件解析 `ctx.swarm` 会拿到 Host realm 的那个实例**（不需要 isolate），
但如果哪天我们想在 preset 内提供/隔离服务，必须把 provider 和 consumer 放进同一个 `cordis:group` 并写 `isolate`。
`TypeScript` 侧要在我们的 d.ts 里 `declare module '@deepseek-ai/cordis' { interface Context { swarm: SwarmService } }`
才能让 preset 插件与命令用 `ctx.swarm` 而不写 `ctx.get('swarm')!`。

---

## 9. 其余会用到的服务（签名已核验）

```ts
// ctx.workingDirectory —— @deepseek-ai/dsh-working-directory
get(session: Session): string
ensure(agent: Agent, signal?): Promise<string>       // 目录消失时恢复原项目
set(agent: Agent, path: string, signal?): Promise<string>   // 路径必须已存在；不影响已有进程/权限

// ctx.jobs —— @deepseek-ai/dsh-jobs-local（抽象 seam，owner 以 SessionId 隔离）
list(caller?: SessionId): JobView[]
get(id, caller?): JobView
read(id, caller?): JobRead
kill(id, caller?, reason?): 'requested' | 'already-finished'
wait(id, timeoutMs, caller?, signal?): Promise<JobView>
// start 拒绝"owner 没有 attached controller"的作业 → 生产代码要 attachController

// ctx.agents —— @deepseek-ai/dsh-agent
get(id: SessionId): Agent | undefined
isOwnedBy(id: SessionId, owner: Agent): boolean
list(): Agent[]
currentInitiator(): Agent | undefined               // 区分"谁在驱动我"
requireInitiator(): Agent

// Agent 运行时面（declare module './types.ts' 增补）
agent.session / agent.ctx / agent.status / agent.options / agent.inbox
agent.whenIdle(): Promise<void>
agent.cancel(cause: AgentCancelCause, options?: { keepInbox?: boolean })
agent.followup(msg: UserMessage)     // 唤醒，独占一个 turn
agent.steer(msg: UserMessage)        // 唤醒，最近 step 边界
agent.inject(msg: UserMessage)       // 不唤醒；空闲时只是排队
agent.runMaintenance(task)
```

`agent.inject` 不唤醒是已核验事实（安装包原文："idle drivers leave it pending until follow-up or steering wakes them"），
与 ARCHITECTURE §9 表格一致。

给 worker 发插件来源的上下文时，**必须自己造 `UserMessage`**，且要用 `createUserMessage` 并
`declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { swarm: SwarmMessageSource } }` 增补来源类型
（`@deepseek-ai/dsh-goal` 就是这么做的：`source: { kind: 'goal', goalId, revision, round }`）。
不要用 `{ kind: 'user' }` 冒充用户输入。注意：自造 `UserMessage` 会进 Session 日志，属于模型可见的持久内容（AGENTS §4.4）。

---

## 10. Agent preset 挂载：真实包名、行形状、worker preset

### 10.1 声明行 = 普通 Loader 行

preset **只能通过 bundle patch 声明**（registry 不扫目录、不接收 YAML）。行形状（已核验，来自
`@deepseek-ai/dsh-web-app/presets/minimal.patch.yml` 与 `standard.patch.yml` 实文件）：

```yaml
- insert:
    - id: preset-swarm-worker
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: swarm-worker            # preset 身份，session 会把它记进 header.agentPreset
        name: Swarm Worker
        description: Isolated worktree worker for DSH Swarm runs.
        order: 20
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You are one of two peer workers in a Swarm run. …
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            disabled: !!js process.platform === 'win32'
          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
            disabled: !!js process.platform !== 'win32'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'
          - id: swarm-worker-tools
            name: '@local/dsh-swarm/worker'
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
```

`PresetDefinition`（`@deepseek-ai/dsh-agent-preset-registry`，`lib/types/definition.d.ts`）：

```ts
interface PresetDefinition {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly plugins: readonly (Omit<EntryOptions,'id'|'disabled'> & { id?: string; disabled?: EntryOptions['disabled'] | JsExpr })[]
}
```

**故意不挂的行**（= worker 不该有的能力，ARCHITECTURE §3）：`@deepseek-ai/dsh-tool-subagent`、
`@deepseek-ai/dsh-tool-subagent-control`、`@deepseek-ai/dsh-tool-workflow`、`@deepseek-ai/dsh-experimental-tool-worktree`、
`@deepseek-ai/dsh-plugin-manager/tools`、`@deepseek-ai/dsh-tool-cordis`、`@deepseek-ai/dsh-schedule`、
`@deepseek-ai/dsh-tool-ask-user`。递归能力还有 `request.maxDepth: 1` 兜底（§1.3）。

### 10.2 本插件 bundle patch 必须插入的 Host 行

```yaml
- insert:
    - id: worktree
      name: '@deepseek-ai/dsh-experimental-worktree'      # 提供 ctx.worktrees（当前 profile 缺失）
      config:
        directory: .agents/worktrees
        namePrefix: swarm-
    - id: swarm-host
      name: '@local/dsh-swarm'
      config: {}
```

`@deepseek-ai/dsh-experimental-worktree` 的 `inject` 是 `['workingDirectory','fs','subprocess','sandbox','sandboxPolicy']`，
本 profile 全部具备。**只插服务行，不要插 `@deepseek-ai/dsh-experimental-tool-worktree`**（那是给模型用的工具）。
它的 Config：`directory`（默认 `.agents/worktrees`）、`namePrefix`（默认 `worktree-`）、`gitCommand`、
`nodeCommand`、`timeoutMs`（默认 60000）、`graceMs`、`maxOutputBytes`。
`namePrefix` **只在 `request.name` 省略时**参与 `${prefix}${randomUUID()}`；本方案总是显式传
`name: worker.branch`（该值同时当分支名与目录名），所以 `namePrefix` 只是美观。
树落在 `<repositoryRoot>/<directory>/<name>`，且 `name` 必须是合法相对分支名、不能以 `-` 开头。
detail 见 [workspace-api.md](<../notes/workspace-api.md>)。

### 10.3 子路径插件（`@local/dsh-swarm/worker`）的形态

真实样例 `@deepseek-ai/dsh-tool-subagent-control` 的 `package.json`：`exports` 里
`"./list-agents": { "types": "./lib/types/list-agents.d.ts", "default": "./lib/types/list-agents.js" }`，
行名写作 `@deepseek-ai/dsh-tool-subagent-control/list-agents`。本 profile 的 `Config` 目录里能看到
`@deepseek-ai/dsh-plugin-manager/tools`、`@deepseek-ai/dsh-tool-subagent/model-selection-settings` 等真实行名，
说明子路径行是受支持形态。

`src/worker.ts` 里就是普通插件：

```ts
export const name = 'swarm-worker-tools'
export const inject = ['tools']                  // 注意：不要 inject 'swarm'，
                                                 // 但 ctx.swarm 的可用性靠 Host 已挂载 + Context 类型增补
export function apply(ctx: Context) {
  ctx.effect(() => () => workerTools.disposeAll())
  ctx.tools.register(...)   // 通过 preset scope 生效
}
```

**风险点（必须在 M1 首次安装时验证）**：preset 行 `@local/dsh-swarm/worker` 能否从 profile 的 node_modules
解析到。shipped preset 引用的都是 dsh 安装内的包；我们的是 profile 安装的 bundle。
若解析失败，退路是 §3.2 的 `agent.ctx.tools.register`（Host 侧注入，不依赖跨 realm 模块解析）。
两条路都能满足"worker 专属工具"，Host 注入那条不依赖 preset 行解析，**建议 M1 先用它，preset 只放 persona + 基础工具**，
等首次真实安装验证通过再决定是否迁到 preset 行。

### 10.4 冷恢复的 preset 语义（会咬人的地方）

- 独立选定的 spawn 会在第一次自己的 `subagent/descriptor` 之前记 `agent-preset/selected`，
  冷恢复据此挂载**同一个 id**，**并且不要求原 subagent provider 仍在注册**。
- "A missing or broken selected preset rejects restoration; it does not fall back to the parent or deployment default."
  → 我们的 bundle 一旦卸载或 preset 改坏，已存在的 worker 会话**恢复会失败**，不会静默降级。要在 status 里区分"diagnostic"。
- 独立冷恢复使用**当前**注册的 preset 定义，不保留历史 revision。
  → 改 worker 指令会影响**下一次**恢复的 worker，但不会影响正在跑的 agent（"A live Agent's composition stays stable"）。
  这条要写进 IMPLEMENTATION.md（用户可见语义）。

---

## 11. 与 ARCHITECTURE 不一致 / 真实 API 不支持的点

按严重度排序。第 1–4 项需要 Lead 决策并同步文档。

### 11.1 `worktrees` 在当前 profile 不存在（阻塞 M1）

ARCHITECTURE §9 表格把它列为"已核对的现有能力"。实际：包已安装，但**没有挂载**。
`Config.listConfigs({ name: '@deepseek-ai/dsh-experimental-worktree' })` → `total: 0`；
`dsh --profile web --dump-config` 无该行；`presets/*.patch.yml` 也不含它。
所以 §5.3 第 4 点"原生 `worktrees.create(agent, …)`"必须先由**我们自己的 bundle**插入服务行（§10.2）。
另外它是 `experimental`（pre-stable）包，升级可能破——IMPLEMENTATION.md 已记"未承诺其他版本兼容"，这里补一条：
**必须在 `apply` 里 `ctx.get('worktrees')` 预检并给出可操作诊断**，不能等到第一个 worker 初始化才炸。

### 11.2 "worker 创建集成 worktree 再切回源 cwd"这一步可以简化（且原写法有坑）

ARCHITECTURE §5.3 第 5 点要求第一个 worker 先建集成 worktree、把 cwd 切回 `Run.repositoryRoot`、再建自己的树。
真实 API 提供了更干净的路：`startActivation.request.cwd` 会在 creation window 内落地
（`workingDirectory.set(child, cwd)`），所以每个 worker 出生时就已在 `repositoryRoot`。
剩下的只是"用哪个 agent 去建集成树"：

- `worktrees.create(agent, …)` 的 `agent` 只用来取 `cwd` 与 `sandboxPolicy.resolve({session: agent.session})`；
- 集成树与 worker 树都在 `repositoryRoot` 下、同一个 Git 仓库；
- 因此**集成树可以用第一个 worker 的 agent 建**（此时它的 cwd 已是 repositoryRoot，建完会被切进集成树，
  需要再 `workingDirectory.set(workerAgent, repositoryRoot)` 一次，或者干脆把"建集成树"提到 worker 初始化之后、
  用该 worker 自己的树建完后再建集成树）。

建议顺序（每 worker）：`agent/created` → `worktrees.create(agent, {name: workerBranch, from: baseCommit})`
→ 记录 worker 树路径（agent cwd 已在 worker 树）。集成树交给 owner 侧在 `preparing` 阶段用
`worktrees.create(ownerAgent, …)` 建，**但**那会切走用户 owner 的 cwd（AGENTS §3 明确禁止"对用户 owner 调用以切走其工作区"）。
所以仍然只能用 worker 的 agent。这是 ARCHITECTURE 与 AGENTS 之间一个真实的张力点，需要 Lead 定：
**要么接受"第一个 worker 的创建窗口内建两棵树并做一次 cwd 往返"，要么让集成树改由 `ctx.subprocess` + `sandboxPolicy`
直接执行 `git worktree add`（workspace-api.md §6.2 已给出这条路径）。** 后者不碰任何 agent 的 cwd，我倾向后者。

### 11.3 `startActivation` 没有 tool filter / 没有 permission

- 想在启动时限制 worker 工具集：**不支持**。`SubagentActivationSpec.request` 没有 `toolFilter`；
  `composition.toolFilter` 只来自**历史 descriptor**（冷恢复用）。
  → 工具限制只能靠 preset 内容 + `agent.ctx.tools.restrict()`（在 `agent/created` 里调）。
- 想给 worker 指定权限：**不支持**，见 §1.2。这是本方案最需要 Lead 知情的一条：
  worker 的 approval 恒 `never`，sandbox 只继承 owner 的显式 override，否则落在部署/宿主默认上。
  `status` 输出必须显示每个 worker 的**实际解析后**模式，而不是我们以为的模式。

### 11.4 ARCHITECTURE §9 的 `subagents.sendMessage(owner, childId, …)` 表述要精确化

签名是 `sendMessage(sender: Agent, targetId: SessionId, content: ContentBlock[], options)`，
`sender` 必须是**活的 exact Agent**（不能是 sessionId 字符串）。`ctx.agents.get(ownerSessionId)` 可能返回 `undefined`
（owner 不在线）——这时 ARCHITECTURE §7.5 的"暂停并等用户在原 owner Session 恢复"是**唯一**选项，
不存在"用 sessionId 伪造成 owner"的路径（实现用 exact live sender 派生 durable 归属）。

另外：模型看到的是 `Agent <senderSessionId> sent a message:`，没有 worker 名字。控制通知正文必须自带映射说明。

### 11.5 `concludeTurn` 只对成功结果生效

`ToolExecutionFailure.concludesTurn?: never`。所以：
`swarm_wait` 在"cursor 非法"时抛错 → turn 继续（正确，模型必须自己修）；
在"登记等待成功"时必须**成功返回**并 `concludeTurn()`。不要把两种结局都写成抛错/都写成成功。

### 11.6 `commands` 返回通道只有文本

`CommandResult` 只有 `{ kind, text?, sourceEventSeq? }`。ARCHITECTURE §12.1 的 status 输出契约（多段、计数、诊断、分页入口）
只能自己渲染成有界文本；`sourceEventSeq` 只能指向**已有**的会话事件，不能承载任意结构化 payload。

### 11.7 `systemPrompt` 没有第三方 section 槽位名

`getSectionOrder()` 只认中心表里的名字，且表里没有 Swarm 的位置。必须自选数字 `order`（建议 2950），
并在代码注释里写清相对位置。别用 `complete: true`。

### 11.8 domain 命名与 upsert 两处细节与现有 store 契约的偏差

- 名字必须是 `^[a-z][a-z0-9_]*$` → `dsh_swarm`（不是 `dsh-swarm`）。
- `update` 不做 upsert（`missing-key`）→ `StateStore.create` 必须走 `put`。
- 写入不做 zod 校验 → 写入口自己校验。
（[contracts.md](<../notes/contracts.md>) §3.1 说 `KvTable` 结构上直接满足 `RunTable`，
这一条仍成立，但上面三点是该结论的前提条件，实现时不能漏。）

### 11.9 下面这些 ARCHITECTURE 说法**没有**真实 API 对应，都是我们自己要写的模块

不是缺陷，只是别把它们当成宿主能力去找：

- `runtime.admitWorkerOperation(runId, workerId, kind)`（§7.3 第 7 点）——**我们自己的** runtime 方法，宿主没有。
- `publicationGate`、`quiescing`、`draining`、`mutationReceipts`、`seq`/`revision`/`observedSeq`/`offeredSeq`/
  `wakeTargetSeq`/`notifiedSeq`、`acceptedHead`、`resultRef`——全是插件 domain 概念。
- `swarm_*` 工具名——拟实现，不是宿主工具。
- "SessionEvent 不追加未知 `swarm/*` 类型"仍然成立：`SessionEventMap` 是 merge-extensible，但**不要**增补业务事件；
  唯一建议的增补是 `MessageSourceMap` 的 `swarm` 变体（§9）。这与"不追加未知 SessionEvent"不冲突，但要在 IMPLEMENTATION.md 显式记一笔。

---

## 12. 可复现核验命令（全部只读）

```bash
# 0) 权威合成配置（含 bundle 层与 profile patch）
dsh --profile "$DSH_PROFILE" --dump-config > /tmp/dsh-profile-dump.yml
grep -n "worktree\|storage-domain\|subagent" -A4 /tmp/dsh-profile-dump.yml

# 1) 某服务是否真的挂载（用 Config，而不是 Service 目录）
#    cordis_inspect_query(host, Config, listConfigs, { name: '@deepseek-ai/dsh-experimental-worktree' })
#    → total: 0 表示未挂载

# 2) 精确契约
#    cordis_inspect_query(host, Service, listService, { service: 'subagents' })
#    cordis_inspect_query(host, Event,   listEvents,  { event:   'agent/created' })
#    cordis_inspect_query(host, Service, listService, { service: 'storageDomain' })

# 3) 本 Agent 当前真正能调用的工具
#    cordis_inspect_query(host, Tool, listTools)

# 4) 已挂载插件的 Config JSON Schema 与 packageDir
#    cordis_inspect_query(host, Config, listConfigs, { entry: 'include:storage-domain' })

# 5) 读安装包文档与声明（<packageDir> 来自上一步）
```

---

## 13. 给 Lead 的三条即时行动项

1. **bundle patch 加 `worktrees` 服务行**（§10.2），否则 M1 无法开始；并在 `apply` 里预检 `ctx.get('worktrees')`。
2. **决定集成 worktree 的创建者**（§11.2）：第一个 worker 的创建窗口 + cwd 往返，还是 `subprocess` + `sandboxPolicy`
   直接跑 `git worktree add`。这是 AGENTS §3"不对 owner 调用以切走其工作区"与 ARCHITECTURE §5.3 的冲突，必须选一个。
3. **把 §1.2 的权限事实写进 IMPLEMENTATION.md 与 status 输出**：worker approval 恒 `never`、sandbox 只继承显式 override。
   用户看到"部署默认是 danger-full-access"不代表 worker 就是；status 要显示实际 `sandboxPolicy.resolve({session})` 结果。