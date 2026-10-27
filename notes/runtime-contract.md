# Runtime / Delivery / Host 固定接线

这是 Lead 的实现分工契约。基础类型以 src/types.ts 为准，禁止每个模块定义另一套 Run。

## Host-independent ports

见 src/ports.ts。WorkerHost.start(request) 在原生agent/created中准备worktree、把返回路径和initialized状态写回同一StateStore；Host adapter构造时持有store。首个worker顺带创建integration worktree。start返回表示已发布，不等于activation结算；结算通过onSettled事件。

WorkspacePort只执行Git业务，不创建原生worker；生产CommandExecutor另接DSH权限适配；ArtifactPort保存/读取日志。

## Delivery（src/delivery.ts）

```ts
interface OperationPermit { signal: AbortSignal; release(): void }
interface DeliveryOptions {
  admitWorkerOperation(runId:string,workerId:string,kind:'create'|'notify'): Promise<OperationPermit>;
  onError(runId:string,error:unknown): void;
}
class Delivery {
  constructor(store:StateStore, host:WorkerHost, options:DeliveryOptions);
  start(runId:string,workerId:string):Promise<void>;
  resume(runId:string,workerId:string):Promise<void>; // 明确用户resume，即使没有未读事件也走队列/admission唤醒
  kick(runId:string,workerId?:string):Promise<void>;
  idle():Promise<void>;
  dispose():Promise<void>;
}
```

Delivery持有每worker队列、Host.onSettled注册及store订阅。store变化只调度合适worker，不把每次cursor写回当成新业务通知。它执行Host.start/notify前必须申请permit，finally release。不在Host settled事件同步栈中重入Agent创建。wait登记存在时，新事件只置pending，等实际settled；未等待且running时只有direct message可steer。允许at-least-once；持久pending字段是Worker.wakeTargetSeq，通知记录是notifiedSeq，确认是observedSeq。

## IntegrationQueue（src/integration.ts）

```ts
new IntegrationQueue(store,workspace,artifacts,publicationGate,options)
process(runId,signal?):Promise<void>
recover(runId):Promise<void>
interrupt(runId,reason:'pause'|'stop'|'budget'):Promise<void>
idle(runId?):Promise<void>
```

process自身同run串行。runtime触发后托管其Promise（不能unhandled rejection）。finish Verification passed时integration进入quiescing/targetcompleted，runtime订阅驱动最后收尾。

## Runtime（src/runtime.ts）

```ts
class SwarmRuntime {
 constructor(store:StateStore, host:WorkerHost, workspace:WorkspacePort, artifacts:ArtifactPort,
   options?:{clock?:Clock;id?:()=>string;eventPageSize?:number});
 readonly collaboration:Collaboration;
 start(ownerSessionId:string,spec:RunSpec):Promise<Run>;
 status(ownerSessionId:string,details?:boolean):unknown;
 pause(ownerSessionId:string):Promise<Run>;
 resume(ownerSessionId:string,budgetMinutes?:number):Promise<Run>;
 stop(ownerSessionId:string):Promise<Run>;
 submit(workerSessionId:string,input:{taskId:string;expectedRevision:number;sourceCommit:string},callId:string):Promise<ProposalRecord>;
 finish(workerSessionId:string,input:{acceptedCommit:string;notes:AcceptanceNote[]},callId:string):Promise<unknown>;
 recover():Promise<void>;
 dispose():Promise<void>;
}
```

status返回JSON兼容结构（Host/command可serialize），不得触发模型。runtime可额外导出typed返回而不是unknown。start检查gitCommonDir单run（含paused）、权限owner在，保存预留worker后经delivery.start；首worker ready后running，其余创建失败即停止/failed。初始化失败不静默降级。用户pause/stop返回真正收尾后状态，不确认时保留quiescing诊断。

runtime publicationGate = KeyedSerialQueue（src/serial.ts），用于admission与control以及Integration.publish同一短gate。长test在gate外。每run active operations有AbortController/settled tracking，stop关门禁后abort再await；不能等正在调用自己的worker工具同步停止，finish先受理返回并异步收尾。

owner控制取唯一当前非终态run；终态status取最近run；pause/resume/stop/task控制不信任worker自报身份。恢复先禁止启动，核对只补事实，不自动模型/测试；停止保留用户工作树与私有成果。
