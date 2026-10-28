window.__ModuleLoader__.load({
	id: "@local/dsh-swarm",
	factory: (require) => {
		const React = require("react");
		const h = React.createElement;
		const NS = "swarmProgress";
		const css = `
.dshSwarm_root{box-sizing:border-box;width:100%;max-width:1040px;margin:0 auto;padding:24px 24px 40px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.55;container-type:inline-size}
.dshSwarm_root *{box-sizing:border-box}.dshSwarm_root h2,.dshSwarm_root h3,.dshSwarm_root p{margin:0}.dshSwarm_root ul,.dshSwarm_root ol{list-style:none;padding:0;margin:0}
.dshSwarm_header,.dshSwarm_row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dshSwarm_header{justify-content:space-between;align-items:flex-start}.dshSwarm_title{font-size:20px;font-weight:650;letter-spacing:-.02em;line-height:1.35}.dshSwarm_subtle{color:var(--dsw-alias-label-secondary);font-size:12px}.dshSwarm_connection{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshSwarm_dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}.dshSwarm_live .dshSwarm_dot{background:var(--dsw-alias-state-success-primary)}.dshSwarm_goal{margin-top:14px!important;white-space:pre-wrap;overflow-wrap:anywhere;max-width:82ch;color:var(--dsw-alias-label-secondary)}
.dshSwarm_badge{display:inline-flex;align-items:center;gap:5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);padding:2px 7px;font-size:11px;font-weight:550;max-width:100%;overflow-wrap:anywhere}.dshSwarm_success{color:var(--dsw-alias-state-success-primary)}.dshSwarm_warn{color:var(--dsw-alias-state-warn-primary)}.dshSwarm_error{color:var(--dsw-alias-state-error-primary)}.dshSwarm_active{color:var(--dsw-alias-brand-primary)}
.dshSwarm_button{font:inherit;font-size:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:5px 10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}.dshSwarm_button:hover{background:var(--dsw-alias-bg-layer-2)}.dshSwarm_button:disabled{cursor:wait;color:var(--dsw-alias-label-secondary)}.dshSwarm_root :is(button,summary):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.dshSwarm_notice{margin-top:14px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-inline-start:3px solid var(--dsw-alias-state-warn-primary);border-radius:6px;color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}.dshSwarm_notice strong{display:block;color:var(--dsw-alias-label-primary);margin-bottom:2px}
.dshSwarm_workflow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin-top:24px!important;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden}.dshSwarm_step{padding:14px 12px;border-inline-end:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.dshSwarm_step:last-child{border-inline-end:0}.dshSwarm_step[data-state=active]{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 2px var(--dsw-alias-brand-primary)}.dshSwarm_stepName{display:flex;align-items:center;gap:8px;font-weight:600;font-size:12px}.dshSwarm_stepIndex{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:11px}.dshSwarm_stepCount{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:5px}
.dshSwarm_kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:20px 0 26px}.dshSwarm_kpi{min-width:0;border-inline-start:2px solid var(--dsw-alias-border-l1);padding-inline-start:12px}.dshSwarm_kpi dt{font-size:11px;color:var(--dsw-alias-label-secondary)}.dshSwarm_kpi dd{margin:3px 0 0;font-size:24px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums;letter-spacing:-.03em}.dshSwarm_kpiNote{display:block;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px}
.dshSwarm_section{margin-top:24px}.dshSwarm_sectionHead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px}.dshSwarm_sectionTitle{font-size:13px;font-weight:650}.dshSwarm_workers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dshSwarm_worker{min-width:0;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_workerTop{display:flex;align-items:center;gap:8px;margin-bottom:12px}.dshSwarm_avatar{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600}.dshSwarm_workerName{font-size:12px;font-weight:650}.dshSwarm_workerTop .dshSwarm_badge{margin-inline-start:auto}.dshSwarm_taskTitle{font-size:16px;font-weight:600;line-height:1.4;overflow-wrap:anywhere;min-height:2.8em}.dshSwarm_workState{margin-top:10px;font-size:12px}.dshSwarm_tools{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.dshSwarm_tool{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:2px 6px;overflow-wrap:anywhere;max-width:100%}.dshSwarm_native{display:flex;flex-wrap:wrap;gap:5px 10px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px;margin-top:14px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshSwarm_memberHead{align-items:center;flex-wrap:wrap}.dshSwarm_memberFilters{display:flex;gap:5px;flex-wrap:wrap}.dshSwarm_memberFilter[aria-pressed=true]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}.dshSwarm_workers[data-focused=true]{grid-template-columns:minmax(0,1fr)}
.dshSwarm_worker[data-work=failed]{border-color:var(--dsw-alias-state-error-primary)}.dshSwarm_memberTaskLabel{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:5px}.dshSwarm_memberWait{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:8px!important}.dshSwarm_execution{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px;margin-top:14px;font-size:12px}
.dshSwarm_toolList{display:grid;gap:6px;margin-top:8px!important}.dshSwarm_toolRow{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;min-width:0;padding:6px 8px;border-radius:5px;background:var(--dsw-alias-bg-layer-2)}.dshSwarm_toolRow code{flex:1 1 120px;min-width:0}.dshSwarm_toolTime{font-size:10px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dshSwarm_details{margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}.dshSwarm_details summary{cursor:pointer;width:fit-content}.dshSwarm_details[open] summary{margin-bottom:10px}.dshSwarm_facts{display:grid;grid-template-columns:minmax(85px,auto) minmax(0,1fr);gap:6px 12px;margin:0}.dshSwarm_facts dt{color:var(--dsw-alias-label-secondary)}.dshSwarm_facts dd{margin:0;overflow-wrap:anywhere}.dshSwarm_root code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;overflow-wrap:anywhere}
.dshSwarm_board{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}.dshSwarm_taskRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 14px;padding:11px 13px;align-items:center;border-bottom:1px solid var(--dsw-alias-border-l1)}.dshSwarm_taskRow:last-child{border:0}.dshSwarm_taskSubject{font-size:12px;overflow-wrap:anywhere}.dshSwarm_taskMeta{display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}.dshSwarm_countRow{display:flex;flex-wrap:wrap;gap:5px 12px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:10px}.dshSwarm_timeline{border-inline-start:1px solid var(--dsw-alias-border-l1);margin-inline-start:4px!important;padding-inline-start:15px!important}.dshSwarm_event{position:relative;padding:0 0 12px;font-size:12px;overflow-wrap:anywhere}.dshSwarm_event:before{content:"";position:absolute;inset-inline-start:-19px;top:7px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-border-l2)}.dshSwarm_event time{font-variant-numeric:tabular-nums;font-size:11px;color:var(--dsw-alias-label-secondary);margin-inline-end:10px}.dshSwarm_result{border-top:1px solid var(--dsw-alias-border-l1);padding-top:16px;margin-top:24px}.dshSwarm_empty{padding:24px 0;color:var(--dsw-alias-label-secondary)}.dshSwarm_empty h3{color:var(--dsw-alias-label-primary);font-size:14px;margin-bottom:6px}
@container(max-width:620px){.dshSwarm_workers{grid-template-columns:1fr}.dshSwarm_workflow{grid-template-columns:repeat(2,minmax(0,1fr))}.dshSwarm_step:nth-child(2){border-inline-end:0}.dshSwarm_step:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.dshSwarm_kpis{gap:8px}.dshSwarm_kpi dd{font-size:21px}}
@media(max-width:540px){.dshSwarm_root{padding:16px 12px 28px}.dshSwarm_workers{grid-template-columns:1fr}.dshSwarm_header{gap:12px}.dshSwarm_workflow{grid-template-columns:repeat(2,minmax(0,1fr))}.dshSwarm_step:nth-child(2){border-inline-end:0}.dshSwarm_step:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.dshSwarm_taskRow{grid-template-columns:minmax(0,1fr)}.dshSwarm_taskRow>.dshSwarm_badge{justify-self:start}.dshSwarm_kpis{gap:8px}.dshSwarm_kpi dd{font-size:20px}}
@media(prefers-reduced-motion:reduce){.dshSwarm_root *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
		const zh = {
			"view.label": "协作群", "title": "协作群", "loading": "正在连接进度流…", "refresh": "更新连接", "unknown": "未知", "unavailable": "不可用",
			"connection.live": "实时连接", "connection.loading": "连接中", "connection.ended": "订阅已结束", "connection.error": "连接中断", "connection.unavailable": "服务不可用",
			"updated": "快照更新于 {time}", "stale.title": "非实时 · 最后已知快照", "stale.body": "连接中断后保留已知状态，工作可能仍在继续。请更新连接。", "ended.body": "当前订阅已结束。请手动更新以查看此会话的新运行。",
			"legacy.title": "Host 能力受限", "legacy.body": "当前 Host 未提供新版进度协议；执行工具、任务板与公开活动可能不可用。已兼容旧订阅，终态后不会自动发现新运行。需更新并重启 Host 后重新连接。",
			"noRun.title": "此会话尚无协作运行", "noRun.body": "请让 Agent 使用 swarm_manage action=start 并提供 spec 或 spec_path，或使用 /swarm start --spec <spec.json>。",
			"phase.preparing": "准备中", "phase.running": "协作中", "phase.draining": "交付验证中", "phase.quiescing": "资源收尾中", "phase.paused": "已暂停", "phase.completed": "已完成", "phase.stopped": "已停止", "phase.failed": "已失败",
			"workflow": "全局工作流程", "stage.prepare": "准备环境", "stage.collaborate": "协作实现", "stage.integrate": "集成验证", "stage.deliver": "交付结果",
			"stage.prepare.count": "{ready}/{total} 成员已就绪", "stage.collaborate.count": "{claimed} 进行中 · {open} 待认领", "stage.integrate.count": "{accepted} 已集成 · {pending} 待处理", "stage.deliver.count": "{done}/{total} 任务完成",
			"stage.active": "当前有工作", "stage.complete": "已就绪", "stage.pending": "等待", "tasks.kpi": "已完成任务", "tasks.note": "{blocked} 阻塞 · {cancelled} 取消（不计完成）",
			"verification.kpi": "已通过验证", "verification.note": "{running} 执行中 · {failed} 失败 · {interrupted} 中断", "budget.kpi": "预算剩余", "budget.ended": "结束时预算剩余", "budget.snapshot": "快照时预算剩余", "budget.expired": "预算已耗尽", "elapsed": "墙钟时长 {duration}", "elapsed.unknown": "Host 未提供起始时间",
			"workers.title": "成员此刻的工作", "workers.note": "任务归属与原生运行状态分别展示", "worker.name": "成员 {number}", "worker.noTask": "尚未持有任务", "worker.native": "原生状态：{status}", "worker.inactiveNote": "inactive 不代表任务完成",
			"work.initializing": "准备工作区", "work.failed": "初始化失败", "work.assigned": "持有任务", "work.coordinating": "协作与选取工作", "work.waiting": "等待协作更新", "work.integration": "等待集成结果", "work.integrating": "候选正在集成", "work.unassigned": "没有当前任务",
			"activity.running": "Turn 执行中", "activity.executing": "工具调用中 · {count} 项", "activity.executingOmitted": "工具调用中 · 部分调用未展示", "activity.idle": "当前无执行中的 turn", "activity.unavailable": "执行活动不可用", "activity.legacy": "Host 未提供执行活动", "activity.stale": "最后记录：{activity}",
			"workers.filter": "筛选成员", "workers.all": "全部 · {count}", "worker.task": "当前任务", "worker.execution": "执行活动", "worker.snapshot": "最后快照", "work.unavailable": "工作状态不可用", "wait.targets": "{tasks} 个任务 · {proposals} 个提案的更新", "tools.moreActive": "更多调用（{count}）",
			"worker.details": "工具记录与等待详情", "worker.id": "成员 ID", "worker.initialization": "初始化", "worker.turnStep": "Turn {turn} · Step {step}", "worker.wait": "等待条件", "wait.any": "任意匹配的协作更新", "wait.selected": "指定任务 / 提案更新", "wait.after": "已读至事件 {seq}", "worker.proposal": "当前提案", "tools.recent": "最近工具（非执行中）", "tool.executing": "调用中", "tool.completed": "已返回", "tool.failed": "失败", "tool.interrupted": "已中断",
			"init.pending": "待准备", "init.initializing": "准备中", "init.ready": "就绪", "init.failed": "失败", "task.open": "待认领", "task.claimed": "进行中", "task.proposed": "待集成", "task.done": "已完成", "task.blocked": "阻塞", "task.cancelled": "已取消",
			"tasks.title": "任务板", "tasks.empty": "尚未创建任务。", "tasks.missing": "当前 Host 未提供任务板。", "tasks.more": "显示 {shown}/{total} 项（优先展示活跃任务）", "tasks.unowned": "未分配", "tasks.details": "更多任务（{count}）",
			"events.title": "公开活动", "events.note": "仅任务、提案、结果与运行状态；不含私信或推理", "events.empty": "暂无公开状态变更。", "events.missing": "当前 Host 未提供公开活动。", "events.more": "更早活动（{count}）", "event.task": "任务", "event.proposal": "提案", "event.head": "结果版本", "event.run": "运行", "event.updated": "已更新", "proposal.queued": "排队中", "proposal.integrating": "集成中", "proposal.accepted": "已接受", "proposal.rejected": "已拒绝",
			"result.title": "结果与运行细节", "result.ref": "结果分支", "result.head": "已接受 SHA", "result.base": "基线 SHA", "result.run": "运行 ID", "result.verification": "验证计数", "result.proposals": "提案计数", "result.finish": "交付验证请求", "result.noFinish": "尚未请求", "result.note": "已接受版本不等于整个目标已验收；仅运行状态为“已完成”时表示交付完成。", "reason": "当前原因：{reason}", "detail.error": "部分详情不可用：{message}",
			"verification.summary": "排队 {queued} · 执行 {running} · 通过 {passed} · 失败 {failed} · 中断 {interrupted}", "proposal.summary": "排队 {queued} · 集成 {integrating} · 接受 {accepted} · 拒绝 {rejected}"
		};
		const en = {
			"view.label": "Swarm", "title": "Swarm", "loading": "Connecting to progress…", "refresh": "Reconnect", "unknown": "Unknown", "unavailable": "Unavailable",
			"connection.live": "Live", "connection.loading": "Connecting", "connection.ended": "Subscription ended", "connection.error": "Disconnected", "connection.unavailable": "Service unavailable",
			"updated": "Snapshot updated {time}", "stale.title": "Not live · Last known snapshot", "stale.body": "The connection was lost; work may still be continuing. Reconnect to update this view.", "ended.body": "This subscription has ended. Reconnect manually to see a new run in this session.",
			"legacy.title": "Limited Host capabilities", "legacy.body": "This Host does not provide the new progress protocol. Tool activity, task board and public activity may be unavailable. Using the legacy subscription; it cannot discover a new run after completion. Update and restart the Host, then reconnect.",
			"noRun.title": "No Swarm run in this session", "noRun.body": "Ask the Agent to use swarm_manage action=start with spec or spec_path, or use /swarm start --spec <spec.json>.",
			"phase.preparing": "Preparing", "phase.running": "Collaborating", "phase.draining": "Verifying delivery", "phase.quiescing": "Quiescing resources", "phase.paused": "Paused", "phase.completed": "Completed", "phase.stopped": "Stopped", "phase.failed": "Failed",
			"workflow": "Overall workflow", "stage.prepare": "Prepare", "stage.collaborate": "Collaborate", "stage.integrate": "Integrate & verify", "stage.deliver": "Deliver",
			"stage.prepare.count": "{ready}/{total} workers ready", "stage.collaborate.count": "{claimed} claimed · {open} open", "stage.integrate.count": "{accepted} accepted · {pending} pending", "stage.deliver.count": "{done}/{total} tasks done",
			"stage.active": "Work in progress", "stage.complete": "Ready", "stage.pending": "Waiting", "tasks.kpi": "Tasks completed", "tasks.note": "{blocked} blocked · {cancelled} cancelled (not done)",
			"verification.kpi": "Verifications passed", "verification.note": "{running} running · {failed} failed · {interrupted} interrupted", "budget.kpi": "Budget remaining", "budget.ended": "Budget remaining at end", "budget.snapshot": "Budget at last snapshot", "budget.expired": "Budget exhausted", "elapsed": "Wall-clock time {duration}", "elapsed.unknown": "Start time unavailable from Host",
			"workers.title": "What workers are doing", "workers.note": "Task ownership and native execution are separate", "worker.name": "Worker {number}", "worker.noTask": "No task currently held", "worker.native": "Native status: {status}", "worker.inactiveNote": "inactive does not mean the task is done",
			"work.initializing": "Preparing workspace", "work.failed": "Initialization failed", "work.assigned": "Task held", "work.coordinating": "Coordinating / selecting work", "work.waiting": "Waiting for collaboration", "work.integration": "Waiting for integration", "work.integrating": "Candidate being integrated", "work.unassigned": "No current task",
			"activity.running": "Turn running", "activity.executing": "Tool calls in progress · {count}", "activity.executingOmitted": "Tool calls in progress · some calls omitted", "activity.idle": "No turn currently executing", "activity.unavailable": "Execution activity unavailable", "activity.legacy": "Host does not expose execution activity", "activity.stale": "Last recorded: {activity}",
			"workers.filter": "Filter workers", "workers.all": "All · {count}", "worker.task": "Current task", "worker.execution": "Execution", "worker.snapshot": "Last snapshot", "work.unavailable": "Work status unavailable", "wait.targets": "Updates to {tasks} tasks · {proposals} proposals", "tools.moreActive": "More calls ({count})",
			"worker.details": "Tool history & wait details", "worker.id": "Worker ID", "worker.initialization": "Initialization", "worker.turnStep": "Turn {turn} · Step {step}", "worker.wait": "Waiting for", "wait.any": "Any matching collaboration update", "wait.selected": "Selected task / proposal updates", "wait.after": "Acknowledged through event {seq}", "worker.proposal": "Current proposal", "tools.recent": "Recent tools (not executing)", "tool.executing": "Call in progress", "tool.completed": "Returned", "tool.failed": "Failed", "tool.interrupted": "Interrupted",
			"init.pending": "Pending", "init.initializing": "Initializing", "init.ready": "Ready", "init.failed": "Failed", "task.open": "Open", "task.claimed": "Claimed", "task.proposed": "Proposed", "task.done": "Done", "task.blocked": "Blocked", "task.cancelled": "Cancelled",
			"tasks.title": "Task board", "tasks.empty": "No tasks created yet.", "tasks.missing": "Task board is unavailable from this Host.", "tasks.more": "Showing {shown}/{total} tasks (active first)", "tasks.unowned": "Unassigned", "tasks.details": "More tasks ({count})",
			"events.title": "Public activity", "events.note": "Task, proposal, result and run states only; no private messages or reasoning", "events.empty": "No public state changes yet.", "events.missing": "Public activity is unavailable from this Host.", "events.more": "Earlier activity ({count})", "event.task": "Task", "event.proposal": "Proposal", "event.head": "Result revision", "event.run": "Run", "event.updated": "Updated", "proposal.queued": "Queued", "proposal.integrating": "Integrating", "proposal.accepted": "Accepted", "proposal.rejected": "Rejected",
			"result.title": "Result & run details", "result.ref": "Result branch", "result.head": "Accepted SHA", "result.base": "Base SHA", "result.run": "Run ID", "result.verification": "Verification counts", "result.proposals": "Proposal counts", "result.finish": "Finish verification", "result.noFinish": "Not requested", "result.note": "An accepted revision is not acceptance of the whole goal. Delivery is complete only when the run is Completed.", "reason": "Current reason: {reason}", "detail.error": "Some details are unavailable: {message}",
			"verification.summary": "Queued {queued} · running {running} · passed {passed} · failed {failed} · interrupted {interrupted}", "proposal.summary": "Queued {queued} · integrating {integrating} · accepted {accepted} · rejected {rejected}"
		};

		const stringCodec = Object.freeze({ mode: "strict", typeSymbol: "string", create: () => ({ parse(value) { if (typeof value !== "string") throw new TypeError("Session id must be a string"); return value; } }), jsonSchema: { type: "string" } });
		const unknownCodec = Object.freeze({ mode: "strict", typeSymbol: "unknown", create: () => ({ parse: (value) => value }), jsonSchema: {} });
		const SESSION_PARAMETER = Object.freeze({ name: "sessionId", wire: "sessionId", source: "json", codec: stringCodec });
		const REMOTE_CONTRIBUTION = Object.freeze({
			package: "@local/dsh-swarm",
			descriptors: Object.freeze(["snapshot", "watch", "watchSession"].map((method) => Object.freeze({
				id: "@local/dsh-swarm#swarmProgress/" + method, service: "swarmProgress", namespace: "swarmProgress", method,
				invocation: Object.freeze({ kind: "direct" }), parameters: Object.freeze([SESSION_PARAMETER]), result: unknownCodec,
				...(method === "snapshot" ? {} : { mode: "stream", cancellation: Object.freeze({ parameter: "signal" }) })
			})))
		});
		const terminal = (phase) => ["completed", "stopped", "failed"].includes(phase);
		const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
		const finite = (value) => typeof value === "number" && Number.isFinite(value);
		const count = (value) => Number.isSafeInteger(value) && value >= 0;
		const textOrNull = (value) => value === null || typeof value === "string";
		const validTime = (value) => finite(value) && Math.abs(value) <= 8.64e15;
		const timeOrNull = (value) => value === null || validTime(value);
		const countOrNull = (value) => value === null || count(value);
		const countsValid = (value, keys) => object(value) && keys.every((key) => count(value[key]));
		const taskValid = (task) => object(task) && typeof task.id === "string" && typeof task.subject === "string" && typeof task.status === "string" && count(task.revision);
		const toolValid = (tool) => object(tool) && typeof tool.id === "string" && typeof tool.name === "string" && ["executing", "completed", "failed", "interrupted"].includes(tool.status) && timeOrNull(tool.startedAt) && timeOrNull(tool.finishedAt);

		/** Validate the unknown-codec boundary before replacing a useful last snapshot. */
		function readFrame(item) {
			const p = item?.progress;
			if (!object(item) || !count(item.seq) || !(p === null || object(p))) throw new TypeError("Invalid Swarm progress frame");
			if (p === null) return null;
			if (typeof p.runId !== "string" || typeof p.phase !== "string" || !validTime(p.now) || !validTime(p.deadline) || !validTime(p.updatedAt) || !finite(p.remainingMs)
				|| !textOrNull(p.reason) || !textOrNull(p.detailError) || !textOrNull(p.quiesceTarget)
				|| ![p.acceptedHead, p.baseCommit, p.resultRef].every((value) => typeof value === "string")
				|| !(p.finishRequest === null || (object(p.finishRequest) && typeof p.finishRequest.id === "string" && typeof p.finishRequest.acceptedHead === "string" && textOrNull(p.finishRequest.verificationId)))
				|| !countsValid(p.tasks, ["open", "claimed", "proposed", "done", "blocked", "cancelled", "total"])
				|| !countsValid(p.proposals, ["queued", "integrating", "accepted", "rejected"])
				|| !countsValid(p.verifications, ["queued", "running", "passed", "failed", "interrupted"])
				|| !Array.isArray(p.workers) || !p.workers.every((w) => object(w) && typeof w.id === "string" && typeof w.nativeStatus === "string" && typeof w.initializationState === "string" && textOrNull(w.diagnostic) && (w.currentTask === null || taskValid(w.currentTask)))) {
				throw new TypeError("Invalid Swarm progress snapshot");
			}
			if (p.protocolVersion >= 2 && (!textOrNull(p.goal) || !timeOrNull(p.createdAt)
				|| !object(p.taskBoard) || !count(p.taskBoard.total) || !Array.isArray(p.taskBoard.items) || !p.taskBoard.items.every((task) => taskValid(task) && textOrNull(task.ownerWorkerId) && textOrNull(task.proposalId))
				|| !Array.isArray(p.recentEvents) || !p.recentEvents.every((event) => object(event) && count(event.seq) && ["task", "proposal", "head", "run"].includes(event.kind) && typeof event.objectId === "string" && typeof event.status === "string" && validTime(event.createdAt) && textOrNull(event.authorWorkerId))
				|| !p.workers.every((w) => object(w.activity) && ["idle", "running", "executing", "unavailable"].includes(w.activity.status) && textOrNull(w.activity.diagnostic) && countOrNull(w.activity.turn) && countOrNull(w.activity.step) && timeOrNull(w.activity.startedAt) && timeOrNull(w.activity.updatedAt) && Array.isArray(w.activity.activeTools) && w.activity.activeTools.every(toolValid) && Array.isArray(w.activity.recentTools) && w.activity.recentTools.every(toolValid)
					&& (w.wait === null || (object(w.wait) && ["any", "selected"].includes(w.wait.mode) && count(w.wait.afterSeq) && Array.isArray(w.wait.taskIds) && w.wait.taskIds.every((id) => typeof id === "string") && Array.isArray(w.wait.proposalIds) && w.wait.proposalIds.every((id) => typeof id === "string")))
					&& (w.currentProposal === null || (object(w.currentProposal) && typeof w.currentProposal.id === "string" && ["queued", "integrating"].includes(w.currentProposal.status)))))) {
				throw new TypeError("Invalid Swarm v2 progress details");
			}
			if (!(p.protocolVersion >= 2)) {
				// A v1 Host has no contract for v2 additions; do not render unchecked extras.
				return { ...p, goal: null, createdAt: null, taskBoard: undefined, recentEvents: undefined, workers: p.workers.map((w) => ({ ...w, activity: undefined, wait: null, currentProposal: null })) };
			}
			return p;
		}

		function initialState(sessionId, available = true) {
			return { sessionId, status: available ? "loading" : "unavailable", progress: null, hasSnapshot: false, receivedAt: null, stoppedAt: null, legacy: false, message: null };
		}
		/** A changed session never renders the preceding session, even before effects commit. */
		function visibleState(state, sessionId, available) {
			return state.sessionId === sessionId ? state : initialState(sessionId, available);
		}
		function missingSessionWatch(error) {
			return object(error) && error.details?.endpoint === "swarmProgress/watchSession"
				&& ["gateway/invocation-unavailable", "gateway/method-unavailable"].includes(error.code);
		}
		/** Own exactly one stream; fallback once only for an absent endpoint, never retry on a timer. */
		function subscribeProgress(options) {
			const now = options.now ?? Date.now;
			let state = options.previous?.sessionId === options.sessionId ? { ...options.previous, status: "loading", stoppedAt: options.previous.stoppedAt ?? now(), message: null } : initialState(options.sessionId);
			let cancelled = false;
			let handle = null;
			const controller = new AbortController();
			const publish = (patch) => { if (!cancelled) { state = { ...state, ...patch }; options.onChange(state); } };
			const release = () => {
				const owned = handle;
				handle = null;
				if (typeof owned?.dispose === "function") owned.dispose();
			};
			publish({});
			const done = (async () => {
				let modern = true;
				let received = false;
				try {
					for (;;) {
						try {
							handle = modern ? options.watchSession(options.sessionId, controller.signal) : options.watch(options.sessionId, controller.signal);
							for await (const item of handle) {
								if (cancelled) break;
								const progress = readFrame(item);
								received = true;
								publish({ status: "live", progress, hasSnapshot: true, receivedAt: now(), stoppedAt: null, legacy: !modern || (progress !== null && progress.protocolVersion !== 2), message: null });
							}
							publish({ status: "ended", stoppedAt: now() });
							break;
						} catch (error) {
							if (cancelled) break;
							if (modern && !received && missingSessionWatch(error)) {
								release();
								modern = false;
								publish({ legacy: true });
								continue;
							}
							throw error;
						}
					}
				} catch (error) {
					publish({ status: "error", stoppedAt: now(), message: error instanceof Error ? error.message : String(error) });
				} finally {
					release();
				}
			})();
			return { done, dispose() { if (cancelled) return; cancelled = true; controller.abort(); release(); } };
		}

		function deriveWorkflow(p) {
			const ready = p.workers.filter((worker) => worker.initializationState === "ready").length;
			const active = ["preparing", "running", "draining", "quiescing"].includes(p.phase);
			const pending = p.proposals.queued + p.proposals.integrating;
			return [
				{ id: "prepare", state: ready === p.workers.length && ready > 0 ? "complete" : p.phase === "preparing" ? "active" : "pending", counts: { ready, total: p.workers.length } },
				{ id: "collaborate", state: p.phase === "running" ? "active" : "pending", counts: p.tasks },
				{ id: "integrate", state: active && (pending + p.verifications.queued + p.verifications.running > 0 || p.phase === "draining") ? "active" : "pending", counts: { accepted: p.proposals.accepted, pending } },
				{ id: "deliver", state: p.phase === "completed" ? "complete" : active && (p.finishRequest || p.quiesceTarget === "completed") ? "active" : "pending", counts: p.tasks }
			];
		}
		function deriveWorker(worker) {
			// Old Hosts may retain a completed task pointer. Never present it as current work.
			const task = worker.currentTask && !["done", "cancelled"].includes(worker.currentTask.status) ? worker.currentTask : null;
			const work = worker.initializationState === "failed" ? "failed" : ["pending", "initializing"].includes(worker.initializationState) ? "initializing" : worker.initializationState !== "ready" ? "unavailable"
				: worker.currentProposal?.status === "integrating" ? "integrating"
					: worker.currentProposal || task?.status === "proposed" ? "integration"
						: worker.wait ? "waiting" : task ? "assigned" : "unassigned";
			const recordedActivity = worker.activity?.status ?? "legacy";
			// Unavailable evidence stays unavailable; native liveness cannot fill that gap.
			const activity = ["legacy", "unavailable"].includes(recordedActivity) ? recordedActivity
				: worker.nativeStatus === "inactive" ? "idle" : worker.nativeStatus !== "running" ? "unavailable" : recordedActivity;
			const activeTools = worker.nativeStatus === "running" && activity === "executing" ? (worker.activity?.activeTools ?? []).filter((tool) => tool.status === "executing") : [];
			return { task, work, activity, activeTools };
		}
		/** Advance Host-relative time locally; freeze terminal or disconnected snapshots. */
		function deriveClock(state, localNow) {
			const p = state.progress;
			if (!p) return { remainingMs: 0, elapsedMs: null };
			const endEvent = terminal(p.phase) ? (p.recentEvents ?? []).filter((e) => e.kind === "run" && e.status === p.phase).at(-1) : null;
			const end = endEvent?.createdAt ?? p.now;
			const clockNow = terminal(p.phase) ? end : p.now + Math.max(0, (state.status === "live" ? localNow : state.stoppedAt ?? state.receivedAt) - state.receivedAt);
			return { remainingMs: Math.max(0, p.deadline - clockNow), elapsedMs: finite(p.createdAt) ? Math.max(0, clockNow - p.createdAt) : null };
		}
		/** One presentation timer only; it never reads Host state or reconnects. */
		function startClock(state, onTick) {
			if (state.status !== "live" || !state.progress || terminal(state.progress.phase)) return undefined;
			onTick(Date.now());
			const timer = setInterval(() => onTick(Date.now()), 1000);
			return () => clearInterval(timer);
		}
		function budgetKey(p) {
			if (!terminal(p.phase)) return "budget.kpi";
			return (p.recentEvents ?? []).some((event) => event.kind === "run" && event.status === p.phase) ? "budget.ended" : "budget.snapshot";
		}
		const duration = (ms) => { const seconds = Math.max(0, Math.floor(ms / 1000)); return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0"); };
		function label(t, prefix, value) { const key = prefix + "." + value; return Object.hasOwn(en, key) ? t(key, {}) : String(value ?? t("unknown", {})); }
		function timeLabel(time) { return new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
		function timeElement(time, text) { return h("time", { dateTime: new Date(time).toISOString(), title: new Date(time).toLocaleString() }, text ?? timeLabel(time)); }
		function badge(text, tone = "") { return h("span", { className: "dshSwarm_badge " + tone }, text); }
		function fact(name, value) { return [h("dt", { key: name + "-label" }, name), h("dd", { key: name }, value)]; }
		function notice(title, body) { return h("div", { className: "dshSwarm_notice" }, h("strong", {}, title), body); }
		function tone(status) { return ["completed", "done", "accepted", "passed"].includes(status) ? "dshSwarm_success" : ["failed", "blocked", "rejected"].includes(status) ? "dshSwarm_error" : ["paused", "stopped", "interrupted"].includes(status) ? "dshSwarm_warn" : ""; }

		/** Keep a member filter local to its run and preserve worker numbering when focused. */
		function selectWorkers(progress, selection) {
			const selectedId = selection?.runId === progress.runId && progress.workers.some((worker) => worker.id === selection.workerId) ? selection.workerId : null;
			return { selectedId, items: progress.workers.map((worker, index) => ({ worker, number: index + 1 })).filter(({ worker }) => !selectedId || worker.id === selectedId) };
		}
		function WorkersSection({ t, progress, stale }) {
			const [selection, setSelection] = React.useState(null);
			const focused = selectWorkers(progress, selection);
			const filter = (workerId, text) => h("button", { key: workerId ?? "all", type: "button", className: "dshSwarm_button dshSwarm_memberFilter", "aria-pressed": focused.selectedId === workerId, onClick: () => setSelection({ runId: progress.runId, workerId }) }, text);
			return h("section", { className: "dshSwarm_section", "aria-label": t("workers.title", {}) },
				h("div", { className: "dshSwarm_sectionHead dshSwarm_memberHead" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("workers.title", {})),
					h("div", { className: "dshSwarm_memberFilters", role: "group", "aria-label": t("workers.filter", {}) }, filter(null, t("workers.all", { count: progress.workers.length })), progress.workers.map((worker, index) => filter(worker.id, t("worker.name", { number: index + 1 }))))),
				h("ul", { className: "dshSwarm_workers", "data-focused": !!focused.selectedId }, focused.items.map(({ worker, number }) => h(WorkerCard, { key: worker.id, worker, number, t, stale }))));
		}
		function WorkerCard({ t, worker, number, stale }) {
			const view = deriveWorker(worker);
			const omitted = view.activity === "executing" && (!view.activeTools.length || worker.activity?.activeToolsTruncated);
			const activity = t("activity." + (omitted ? "executingOmitted" : view.activity), { count: view.activeTools.length });
			const workTone = view.work === "failed" ? "dshSwarm_error" : ["waiting", "integration", "unavailable"].includes(view.work) ? "dshSwarm_warn" : view.work === "integrating" ? "dshSwarm_active" : "";
			const tools = (items) => h("ul", { className: "dshSwarm_toolList" }, items.map((tool) => h("li", { key: tool.id, className: "dshSwarm_toolRow" },
				h("code", {}, tool.name), badge(label(t, "tool", tool.status), tool.status === "executing" ? "dshSwarm_active" : tone(tool.status)),
				h("span", { className: "dshSwarm_toolTime" }, tool.startedAt !== null ? timeElement(tool.startedAt) : null, tool.finishedAt !== null ? h(React.Fragment, {}, " → ", timeElement(tool.finishedAt)) : null))));
			const diagnostics = [...new Set([worker.diagnostic, worker.activity?.diagnostic].filter(Boolean))];
			return h("li", { className: "dshSwarm_worker", "data-work": view.work },
				h("div", { className: "dshSwarm_workerTop" }, h("span", { className: "dshSwarm_avatar", "aria-hidden": true }, "W" + number), h("span", { className: "dshSwarm_workerName" }, t("worker.name", { number })), badge(t("work." + view.work, {}), workTone)),
				h("div", { className: "dshSwarm_memberTaskLabel" }, h("span", {}, t("worker.task", {})), view.task ? badge(label(t, "task", view.task.status), tone(view.task.status)) : null),
				h("h3", { className: "dshSwarm_taskTitle" }, view.task?.subject || t("worker.noTask", {})),
				worker.wait && view.work === "waiting" ? h("p", { className: "dshSwarm_memberWait" }, t(worker.wait.mode === "any" ? "wait.any" : "wait.targets", { tasks: worker.wait.taskIds.length, proposals: worker.wait.proposalIds.length })) : null,
				h("div", { className: "dshSwarm_execution" }, h("div", { className: "dshSwarm_memberTaskLabel" }, h("span", {}, t("worker.execution", {})), stale ? badge(t("worker.snapshot", {}), "dshSwarm_warn") : null),
					h("p", { className: ["unavailable", "legacy"].includes(view.activity) || omitted ? "dshSwarm_warn" : "" }, activity),
					view.activeTools.length ? tools(view.activeTools.slice(0, 2)) : null,
					view.activeTools.length > 2 ? h("details", { className: "dshSwarm_details" }, h("summary", {}, t("tools.moreActive", { count: view.activeTools.length - 2 })), tools(view.activeTools.slice(2))) : null),
				h("div", { className: "dshSwarm_native" }, h("span", { className: worker.nativeStatus === "unavailable" ? "dshSwarm_warn" : "" }, t("worker.native", { status: worker.nativeStatus })), worker.activity?.turn != null ? h("span", {}, t("worker.turnStep", { turn: worker.activity.turn, step: worker.activity.step ?? "—" })) : null),
				diagnostics.map((diagnostic) => h("p", { key: diagnostic, className: "dshSwarm_subtle dshSwarm_warn" }, diagnostic)),
				h("details", { className: "dshSwarm_details" }, h("summary", {}, t("worker.details", {})),
					h("dl", { className: "dshSwarm_facts" }, fact(t("worker.id", {}), h("code", {}, worker.id)), fact(t("worker.initialization", {}), label(t, "init", worker.initializationState)),
						view.task ? fact(t("worker.task", {}), h("code", {}, view.task.id)) : null,
						worker.wait ? fact(t("worker.wait", {}), h("div", {}, t("wait." + worker.wait.mode, {}), h("div", {}, t("wait.after", { seq: worker.wait.afterSeq })), h("code", {}, [...worker.wait.taskIds, ...worker.wait.proposalIds].join(" · ")))) : null,
						worker.currentProposal ? fact(t("worker.proposal", {}), h("code", {}, worker.currentProposal.id + " · " + label(t, "proposal", worker.currentProposal.status))) : null),
					worker.activity?.recentTools.length ? h("div", { className: "dshSwarm_section" }, h("p", {}, t("tools.recent", {})), tools(worker.activity.recentTools)) : null));
		}

		function TaskBoard({ t, progress }) {
			const board = progress.taskBoard;
			const names = new Map(progress.workers.map((worker, index) => [worker.id, t("worker.name", { number: index + 1 })]));
			const rows = (items) => h("ul", { className: "dshSwarm_board" }, items.map((task) => h("li", { key: task.id, className: "dshSwarm_taskRow" }, h("div", {}, h("div", { className: "dshSwarm_taskSubject" }, task.subject), h("div", { className: "dshSwarm_taskMeta" }, h("code", {}, task.id), h("span", {}, names.get(task.ownerWorkerId) ?? task.ownerWorkerId ?? t("tasks.unowned", {})))), badge(label(t, "task", task.status), tone(task.status)))));
			return h("section", { className: "dshSwarm_section", "aria-label": t("tasks.title", {}) }, h("div", { className: "dshSwarm_sectionHead" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("tasks.title", {})), h("span", { className: "dshSwarm_subtle" }, progress.tasks.done + " / " + progress.tasks.total)),
				h("div", { className: "dshSwarm_countRow" }, ["open", "claimed", "proposed", "blocked", "cancelled"].map((status) => h("span", { key: status }, label(t, "task", status), " ", progress.tasks[status]))),
				!board ? h("p", { className: "dshSwarm_subtle" }, t("tasks.missing", {})) : !board.items.length ? h("p", { className: "dshSwarm_subtle" }, t("tasks.empty", {})) : h(React.Fragment, {}, rows(board.items.slice(0, 6)), board.items.length > 6 ? h("details", { className: "dshSwarm_details" }, h("summary", {}, t("tasks.details", { count: board.items.length - 6 })), rows(board.items.slice(6))) : null,
					board.truncated ? h("p", { className: "dshSwarm_subtle" }, t("tasks.more", { shown: board.items.length, total: board.total })) : null));
		}
		function describeEvent(progress, event) {
			const tasks = [...(progress.taskBoard?.items ?? []), ...progress.workers.map((worker) => worker.currentTask).filter(Boolean)];
			const task = event.kind === "task" ? tasks.find((task) => task.id === event.objectId) : event.kind === "proposal" ? tasks.find((task) => task.proposalId === event.objectId) : null;
			return { subject: task?.subject ?? (event.kind === "run" ? null : event.objectId.slice(0, 12)), workerNumber: progress.workers.findIndex((worker) => worker.id === event.authorWorkerId) + 1 };
		}
		function Timeline({ t, progress }) {
			const events = progress.recentEvents;
			const rows = (items) => h("ol", { className: "dshSwarm_timeline" }, items.map((event) => {
				const description = describeEvent(progress, event);
				return h("li", { className: "dshSwarm_event", key: event.seq }, timeElement(event.createdAt), label(t, "event", event.kind), " · ", description.subject ? h("span", { title: event.objectId }, description.subject, " · ") : null,
					event.kind === "head" ? t("event.updated", {}) : label(t, event.kind === "run" ? "phase" : event.kind, event.status), description.workerNumber ? h("span", { className: "dshSwarm_subtle" }, " · ", t("worker.name", { number: description.workerNumber })) : null);
			}));
			const newest = events ? [...events].reverse() : [];
			return h("section", { className: "dshSwarm_section", "aria-label": t("events.title", {}) }, h("div", { className: "dshSwarm_sectionHead" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("events.title", {}))), h("p", { className: "dshSwarm_subtle", style: { marginBottom: 12 } }, t("events.note", {})),
				!events || !events.length ? h("p", { className: "dshSwarm_subtle" }, t(events ? "events.empty" : "events.missing", {})) : h(React.Fragment, {}, rows(newest.slice(0, 6)), newest.length > 6 ? h("details", { className: "dshSwarm_details" }, h("summary", {}, t("events.more", { count: newest.length - 6 })), rows(newest.slice(6))) : null));
		}
		function RunBody({ t, state, now }) {
			const p = state.progress;
			const clock = deriveClock(state, now);
			const kpi = (name, value, note) => h("div", { className: "dshSwarm_kpi" }, h("dt", {}, name), h("dd", {}, value, h("span", { className: "dshSwarm_kpiNote" }, note)));
			return h(React.Fragment, {},
				p.goal ? h("p", { className: "dshSwarm_goal" }, p.goal) : null,
				p.reason ? notice(t("reason", { reason: p.reason }), p.phase === "quiescing" && p.quiesceTarget ? label(t, "phase", p.quiesceTarget) : null) : null,
				h("ol", { className: "dshSwarm_workflow", "aria-label": t("workflow", {}) }, deriveWorkflow(p).map((stage, index) => h("li", { key: stage.id, className: "dshSwarm_step", "data-state": stage.state, "aria-label": t("stage." + stage.id, {}) + ": " + t("stage." + stage.state, {}) }, h("div", { className: "dshSwarm_stepName" }, h("span", { className: "dshSwarm_stepIndex", "aria-hidden": true }, String(index + 1).padStart(2, "0")), t("stage." + stage.id, {})), h("div", { className: "dshSwarm_stepCount" }, t("stage." + stage.id + ".count", stage.counts))))),
				h("dl", { className: "dshSwarm_kpis" }, kpi(t("tasks.kpi", {}), p.tasks.done + " / " + p.tasks.total, t("tasks.note", p.tasks)), kpi(t("verification.kpi", {}), p.verifications.passed, t("verification.note", p.verifications)), kpi(t(budgetKey(p), {}), duration(clock.remainingMs), clock.elapsedMs === null ? t("elapsed.unknown", {}) : t("elapsed", { duration: duration(clock.elapsedMs) }))),
				clock.remainingMs === 0 && !terminal(p.phase) ? h("p", { className: "dshSwarm_subtle dshSwarm_warn" }, t("budget.expired", {})) : null,
				h(WorkersSection, { t, progress: p, stale: state.status !== "live" }),
				p.detailError ? notice(t("unavailable", {}), t("detail.error", { message: p.detailError })) : null,
				h(TaskBoard, { t, progress: p }), h(Timeline, { t, progress: p }),
				h("details", { className: "dshSwarm_details dshSwarm_result" }, h("summary", {}, t("result.title", {})), h("dl", { className: "dshSwarm_facts" },
					fact(t("result.ref", {}), h("code", {}, p.resultRef)), fact(t("result.head", {}), h("code", {}, p.acceptedHead)), fact(t("result.base", {}), h("code", {}, p.baseCommit)), fact(t("result.run", {}), h("code", {}, p.runId)),
					fact(t("result.proposals", {}), t("proposal.summary", p.proposals)), fact(t("result.verification", {}), t("verification.summary", p.verifications)), fact(t("result.finish", {}), p.finishRequest?.verificationId ?? (p.finishRequest ? p.finishRequest.id : t("result.noFinish", {})))), h("p", { style: { marginTop: 12 } }, t("result.note", {}))));
		}

		function SwarmProgressView(props) {
			const { t, sessionId } = props;
			const available = props.progressAvailable === true;
			const [state, setState] = React.useState(() => initialState(sessionId, available));
			const [attempt, setAttempt] = React.useState(0);
			const [now, setNow] = React.useState(Date.now);
			const last = React.useRef(state);
			const current = visibleState(state, sessionId, available);
			last.current = current;
			React.useEffect(() => {
				if (!available) { setState(initialState(sessionId, false)); return undefined; }
				const subscription = subscribeProgress({ sessionId, watchSession: props.watchSessionProgress, watch: props.watchProgress, previous: last.current, onChange: setState });
				return () => subscription.dispose();
			}, [available, sessionId, props.watchSessionProgress, props.watchProgress, attempt]);
			React.useEffect(() => startClock(current, setNow), [sessionId, current.status, current.progress?.runId, current.progress?.phase]);
			return h("section", { className: "dshSwarm_root", "aria-label": t("title", {}) }, h("style", {}, css),
				h("header", { className: "dshSwarm_header" }, h("div", { className: "dshSwarm_row" }, h("h2", { className: "dshSwarm_title" }, t("title", {})), current.progress ? badge(label(t, "phase", current.progress.phase), tone(current.progress.phase)) : null),
					h("div", { className: "dshSwarm_connection " + (current.status === "live" ? "dshSwarm_live" : "") }, h("span", { role: "status", "aria-live": "polite" }, h("span", { className: "dshSwarm_dot", "aria-hidden": true }), " ", t("connection." + current.status, {})), h("button", { type: "button", className: "dshSwarm_button", disabled: !available || current.status === "loading", onClick: () => setAttempt((value) => value + 1) }, t("refresh", {})))),
				current.progress ? h("p", { className: "dshSwarm_subtle", style: { marginTop: 6 } }, timeElement(current.progress.updatedAt, t("updated", { time: timeLabel(current.progress.updatedAt) }))) : null,
				current.status !== "live" && current.hasSnapshot ? notice(t("stale.title", {}), t(current.status === "ended" ? "ended.body" : "stale.body", {})) : null,
				current.message || (!available && props.progressError) ? h("p", { role: "alert", className: "dshSwarm_notice" }, current.message || props.progressError) : null,
				current.legacy ? notice(t("legacy.title", {}), t("legacy.body", {})) : null,
				current.progress ? h(RunBody, { t, state: current, now }) : current.hasSnapshot ? h("div", { className: "dshSwarm_empty" }, h("h3", {}, t("noRun.title", {})), h("p", {}, t("noRun.body", {}))) : h("p", { className: "dshSwarm_empty" }, t(current.status === "loading" ? "loading" : "unavailable", {})));
		}

		async function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-swarm: dictionaries");
			const t = ctx.locale.bind(NS);
			// Own asynchronous activation too: an unmounted plugin must not register a late slot.
			await ctx.effect(async () => {
				let disposed = false;
				let unmount = null;
				let removeSlot = null;
				const cleanup = ctx.effect(() => () => { disposed = true; removeSlot?.(); }, "dsh-swarm: view lifetime");
				let available = false;
				let progressError = null;
				// Mounted namespaces are traced child Services. Keep ctx.get: ctx.remote.<ns>
				// violates Cordis injection ownership even though $mount succeeded.
				const progressRemote = () => ctx.get("remote.swarmProgress");
				try {
					if (typeof ctx.remote?.$mount !== "function") throw new Error("Remote client unavailable");
					unmount = await ctx.remote.$mount(REMOTE_CONTRIBUTION);
					available = typeof progressRemote()?.watch === "function" && typeof progressRemote()?.watchSession === "function";
					if (!available) progressError = "remote.swarmProgress was not installed";
				} catch (error) {
					progressError = error instanceof Error ? error.message : String(error);
					console.warn("[dsh-swarm] failed to mount swarmProgress Remote", error);
				}
				if (!disposed && ctx.fiber?.uid !== null) {
					const watchProgress = (sessionId, signal) => progressRemote().watch(sessionId, signal);
					const watchSessionProgress = (sessionId, signal) => progressRemote().watchSession(sessionId, signal);
					removeSlot = ctx.slots.inject("conversation.view", () => ctx.slots.register({ name: "conversation.view", id: "swarm-progress", order: 5, locale: NS, label: () => t("view.label", {}), inject: () => ({ progressAvailable: available, progressError, watchProgress, watchSessionProgress }) }, SwarmProgressView));
				}
				return async () => { cleanup(); await unmount?.(); };
			}, "dsh-swarm: progress panel");
		}
		// Pure derivations and the stream owner are also exercised without emulating a browser.
		return { apply, inject: ["slots", "locale", "remote"], progressClient: { readFrame, initialState, visibleState, subscribeProgress, deriveWorkflow, deriveWorker, selectWorkers, deriveClock, startClock, budgetKey, describeEvent, duration, dictionaries: { zh, en } } };
	}
});
