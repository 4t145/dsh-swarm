# 模块契约（src/types.ts / src/errors.ts / src/spec.ts / src/schema.ts / src/store.ts）

本文固定基础模块对外签名，供 runtime / collaboration / delivery / integration / commands 直接对接。
这里只写已经实现并自测过的形状；DSH 宿主接口（storageDomain、subagents、worktrees…）不在本文猜测范围。

## 1. 类型边界（src/types.ts）

- 只依赖标准库；**不 import 任何 DSH/Cordis 类型**，不持有 Agent 句柄、Promise、Date、Map/Set。
- 所有记录都是 JSON 普通数据：时间为毫秒时间戳（number），可空字段用 `null`（不用 `undefined`），
  以便 `JSON.stringify` 往返后仍然完全一致。
- 实体与架构 §4.2 一一对应：`Run` `WorkerRecord` `TaskRecord` `FindingRecord` `MessageRecord`
  `ProposalRecord` `IntegrationAttempt` `VerificationRecord` `FinishRequest` `SwarmEvent`
  `MutationReceipt`；另有 `RunSpec` `SwarmRuntimeConfig` `CommandSpec` `VerificationConfig`。
- 三种“顺序”在类型上分开：`TaskRecord.revision`（CAS）、`SwarmEvent.seq`（读取/唤醒）、
  `CommitSha`（Git 版本）。`acceptedHead` 只表示已集成成果。
- `createRun(input)` 是唯一的聚合构造入口：`phase='preparing'`、`revision=0`、`nextSeq=1`、
  `acceptedHead=baseCommit`、各类 map 为空、`workers` 为空（runtime 负责登记预留 worker）。
  它不做校验也不访问 Git；校验在 `schema.ts` 的 `parseRun`。

### 1.1 SwarmEvent 判别字段

`kind` 判别，每条事件都带 `audience`（`{kind:'all'}` 或 `{kind:'workers', workerIds}`）：

| kind | 载荷 | 对应架构 objectId | §7.2 唤醒用途 |
|---|---|---|---|
| `task` | taskId, status, ownerWorkerId | taskId | open 可领取 / 指定 taskId 的状态变化 |
| `finding` | findingId, taskId, findingKind | findingId | 其他 worker 的 Finding（selected 时按 taskId） |
| `message` | messageId, targetWorkerId | messageId | 发给自己的直接消息恒匹配 |
| `proposal` | proposalId, taskId, status | proposalId | 自己 proposal 的接受/拒绝恒匹配 |
| `head` | acceptedHead, proposalId | proposalId | acceptedHead 更新（selected 时按 proposalId） |
| `run` | phase, target, reason | runId | **不用于唤醒**（控制状态） |

`Run.events` 是追加式索引，`nextSeq` 是下一个待分配 seq。事件 seq 有空洞是正常的（私信对第三方不可见），
永不重排。

### 1.2 RuntimeConfig 与 RunSpec 分开

`RunSpec` 是启动输入（绝对路径、已解析），`SwarmRuntimeConfig` 是 Host 插件配置项
（`workerCountMin=2`、`workerCountMax=4`、`defaultWorkerCount=2`、`eventPageSize=20`）。
run 一旦创建，目标/验收/验证配置固定，修改需停止旧 run。

## 2. 错误约定（src/errors.ts）

```ts
class SwarmError extends Error {
  readonly code: SwarmErrorCode;
  readonly details: JsonObject | null;
  constructor(code: SwarmErrorCode, message: string, options?: { details?: JsonObject; cause?: unknown });
  toJSON(): { name, code, message, details }   // 可直接作为工具结果
}
function assert(condition: unknown, code: SwarmErrorCode, message: string, details?: JsonObject): asserts condition
function assertNever(value: never, context: string): never            // 穷尽检查
function normalizeError(error: unknown, fallbackCode?, context?): SwarmError
function isSwarmError(value: unknown): value is SwarmError
```

固定错误码（共享词表，新增需 Lead 同步）：

| 码 | 含义 |
|---|---|
| `SWARM_INVALID_SPEC` | spec 字段缺失/类型错/constraint 不满足；`details.issues` 为字段诊断 |
| `SWARM_INVALID_INPUT` | 其他输入形状错误（含非绝对 specPath） |
| `SWARM_NOT_FOUND` | run 不存在（或事件过滤目标不存在） |
| `SWARM_ALREADY_EXISTS` | runId 重复创建 |
| `SWARM_STORE_CLOSED` | store 已 close |
| `SWARM_STORE_CORRUPT` | 后端返回的记录不符合 schema |
| `SWARM_STORE_WRITE_FAILED` | 后端 put/update 失败 |
| `SWARM_INVALID_REDUCER` | reducer 返回 Promise 或非对象（违反“纯同步”） |
| `SWARM_STALE_REVISION` | CAS 失败（Task.revision / expected_revision 不匹配） |
| `SWARM_TASK_ALREADY_CLAIMED` | 认领竞争落败 |
| `SWARM_TASK_NOT_CLAIMABLE` | 当前状态不允许该操作 |
| `SWARM_NOT_RUNNING` | draining/paused/终态下的普通写入 |
| `SWARM_STALE_HEAD` | finish 等引用旧 acceptedHead / 发布前 H 已变 |
| `SWARM_INVALID_CURSOR` | `after_seq` 越界或非法（无副作用拒绝） |
| `SWARM_WORKER_BUSY` | 本 Session 还有未结束后台 job，不能 wait |
| `SWARM_FORBIDDEN` | 调用者不是该 run/任务的授权者 |
| `SWARM_BUDGET_EXHAUSTED` | 活动预算已耗尽 |
| `SWARM_INVALID_STATE` | 其他状态机拒绝 |
| `SWARM_INTERNAL` | 不应发生的内部不一致 |

`normalizeError` 保留原 `Error` 为 `cause`，绝不吞掉；`SwarmError` 原样返回。

## 3. 持久端口：`RunTable`（Host 后续注入）

```ts
interface RunTable {
  get(id: RunId): Run | undefined;
  entries(): IterableIterator<[RunId, Run]>;
  put(id: RunId, run: Run): Promise<void>;
  update(id: RunId, fn: (run: Run) => Run): Promise<Run>;
}
```

Host 适配器把 `get` 映射到 storageDomain table 的同步读缓存/记录读取，`update` 映射为
**同一个** `table.update(runId, reducer)` 调用（架构 §4.1：一次业务变更一次 update）。
`put` 用于首次创建。契约细节：

- `get` 同步返回最近一次已持久化的值；不存在的 id 返回 `undefined`，不抛错。
- `update` 的 reducer 在当前记录上同步执行并返回新记录；实现需保证同一 id 的 `update` 串行、
  持久化成功后才 resolve。reducer 抛错时不得写入，错误原样 reject。
- 后端返回的记录必须能被 `schema.parseRun` 接受；不合格视为 `SWARM_STORE_CORRUPT`。

`MemoryStateStore` 单测使用内存 `RunTable`，无 DSH 依赖；将来的 domain 适配器实现同一端口。

### 3.1 与真实 storageDomain 的关系（已用 Inspect 核对，2026-10-28）

`cordis_inspect_query(host, Service, storageDomain)` 返回的 `KvTable` 是：

```ts
interface KvTable<K extends string, V> {
  get(key: K): V | undefined;
  entries(): IterableIterator<[K, V]>;
  keys(): IterableIterator<K>;
  readonly size: number;
  put(key: K, value: V): Promise<void>;
  delete(key: K): Promise<boolean>;
  update(key: K, fn: (current: V) => V): Promise<V>;
}
```

结论：**`KvTable<string, Run>` 结构上直接满足 `RunTable`**（多出的 `keys/size/delete` 无害），
Host 可以把 `domain.table('runs')` 原样当 `RunTable` 传入，不必再写适配层；
若需要收紧 key 类型或加日志，再包一层薄适配器。

两点 Host 必须自己决定的语义（不属于本模块）：

1. `DomainSpec.tables.runs.valueSchema` 可直接用 `src/schema.ts` 的 `runSchema`；
   `storageDomain.open()` 会校验**所有已存记录**，任一不合法即整次 open 失败（`invalid-record`），
   除非 spec 声明 `invalidRecords: 'backup-and-skip'`。是否启用跳过由 Host 决定。
2. `KvTable.update` 的单记录串行由 DSH 写队列保证；本 store 的 per-run 队列只保证同进程内
   多个 awaiter 的先后与“持久后发布”，两者不冲突。

## 4. `StateStore`（src/store.ts）

```ts
interface StateStore {
  create(run: Run): Promise<void>;
  get(id: RunId): Run;                              // 不存在抛 SWARM_NOT_FOUND
  list(): Run[];                                    // 快照，按后端 entries() 顺序
  update(id: RunId, reducer: (run: Run) => Run): Promise<Run>;
  subscribe(listener: (run: Run) => void): () => void;  // 返回取消订阅
  close(): Promise<void>;
}
```

语义（已实现，见 `tests/store.test.ts`）：

1. `create` 校验 schema，重复 id → `SWARM_ALREADY_EXISTS`；成功后不通知 listener（没有被修改的 run）。
2. `update` 的 reducer 必须同步返回新 `Run`；返回 Promise 或非对象 → `SWARM_INVALID_REDUCER`，
   且**不写后端**。reducer 抛错同样不写。
3. 同一 run 的 `create/update` 经 per-run 串行队列执行，第二个 reducer 看到第一个的结果；
   不同 run 互不阻塞。
4. **持久确认后才 publish**：`subscribe` 的 listener 只在后端 `put/update` resolve 之后收到持久化后的
   run 快照；listener 自身抛错不影响已完成的更新，错误交给 `onListenerError`（未提供时 `console.error`）。
5. `close()` 幂等：拒绝新调用（`SWARM_STORE_CLOSED`）、等已入队更新结束、清空 listener。
6. 返回值是持久化后的新对象；`get`/`list` 每次从后端重新校验并复制，调用方修改返回值不影响已存记录。
7. 同一 run 的串行队列复用 `src/serial.ts` 的 `KeyedSerialQueue`（与 delivery、publicationGate 同一个原语），
   不再自建一套；`close()` 即 `queue.idle() + 清空 listener`。

构造：`createMemoryStateStore(table, options?)` 或 `new MemoryStateStore(table, options?)`。
`options.onListenerError?: (error: unknown, run: Run) => void`。

内存 `RunTable`（`tests/store.test.ts` 内的 `FakeRunTable`）只用于单测，不随源码发布；
Host 适配器需要实现 `get/entries/put/update` 四个方法并把 `update` 落到同一个 `table.update`。

## 5. spec 解析（src/spec.ts）

`parseRunSpec(input: unknown, specPath: string): RunSpec`

- `specPath` 必须是**绝对路径**（相对 owner cwd 的解析是 commands.ts 的职责，本模块不猜 cwd，
  否则会静默用错目录）；否则 `SWARM_INVALID_INPUT`。
- `repository` 相对 `dirname(specPath)` 解析为绝对路径；`baseRef` 原样保留，**不执行 Git**。
- 顶层字段全部必填且禁止未知键：`repository` `baseRef` `goal` `acceptanceCriteria` `workers`
  `budgetMinutes` `allowDirtyBaseline` `verification`。
- 约束：`goal`/`baseRef` 去空白后非空；`acceptanceCriteria` 非空数组且每项非空；
  `workers` 为 2–4 的整数；`budgetMinutes` 正整数；`allowDirtyBaseline` 为 boolean；
  `verification.setup` 可为空数组，`verification.test` 必须非空；
  每条命令 `{argv: string[], timeoutMs: number}`，argv 非空且每项非空字符串，timeoutMs 正整数。
- 失败抛 `SWARM_INVALID_SPEC`，`details.issues = [{path, message}]`（path 用点号路径，如
  `verification.test[0].timeoutMs`），一次给出全部字段问题。
- 不检查路径是否存在、不读 profile、不创建 worktree。

## 6. schema（src/schema.ts）

`parseRun(value: unknown, code?: SwarmErrorCode): Run`：对持久记录做严格结构校验（含事件 union 判别），
用于 store 的 create 入口（`code='SWARM_INVALID_INPUT'`）与后端读出的每条记录（默认 `SWARM_STORE_CORRUPT`）。
除结构外还检查两个不变量：每个 map 的键等于实体自身 `id`；事件 `seq` 严格递增且 `nextSeq` 大于最大 seq。
`runSchema` 为对应 Zod 4 schema；另导出 `commandSpecSchema` `verificationConfigSchema`
`runtimeConfigSchema` `DEFAULT_RUNTIME_CONFIG`（2/4/2/20）与 `parseRuntimeConfig`。

`z.json()` 用于 `MutationReceipt.result`；未知键一律拒绝（`strictObject`），不做静默忽略。

注意：`SwarmRuntimeConfig` 是按任务要求单独定义的运行时配置类型，当前 `runtime.ts` 用的是
`{clock?, id?, eventPageSize?}` 选项对象；二者不冲突，Lead 决定是否接线或删除，本模块未擅自改 runtime。

## 6.1 spec 返回值的冻结

`parseRunSpec` 返回的 `RunSpec` 在运行时被 `Object.freeze`（含 `acceptanceCriteria`、
`verification`、每条 `argv`），防止下游把启动输入当可变状态改掉；静态类型仍是普通可读字段，
因此 `ports.ts` 的 `verificationFingerprint(spec.verification)` 之类调用不受影响。

## 7. 未定事项（需 Lead 决定，本模块未擅自实现）

- worker 的 `sessionId` 由谁生成、`gitCommonDir` 的解析来源 → runtime/workspace 负责（见 notes/workspace-api.md）。
- `eventPageSize` 与“约 2K token”上限的换算 → delivery 负责，store 不做截断。
- `SwarmRuntimeConfig` 目前没有调用方：`runtime.ts` 用 `{clock?, id?, eventPageSize?}` 选项对象。
  Lead 决定是让 runtime 接收该类型，还是把 `DEFAULT_RUNTIME_CONFIG` 作为默认值来源；本模块未改 runtime。

## 8. 已知取舍

- 每次 `update` 会完整校验两次记录（后端读入的、以及后端返回的），因为持久记录必须在入口校验。
  v0.1 事件量下开销可接受；若以后事件规模明显变大，可在 Host 适配器里缓存已校验对象，
  但不要为此在 store 里加迁移或增量校验框架。
