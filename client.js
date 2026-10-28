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
/* Overview, goal publishing and collaboration controls. */
.dshSwarm_brand{display:block;width:36px;height:36px;flex:none;color:var(--dsw-alias-brand-primary)}.dshSwarm_composer{margin-top:16px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_composer label{display:block;font-size:12px;font-weight:600;margin-bottom:7px}.dshSwarm_input{display:block;resize:vertical;width:100%;min-height:80px;padding:10px 12px;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:7px}.dshSwarm_input::placeholder{color:var(--dsw-alias-label-secondary)}.dshSwarm_input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dshSwarm_publishRow{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}.dshSwarm_primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1);border-color:transparent;font-weight:600}.dshSwarm_primary:hover{background:var(--dsw-alias-brand-primary);opacity:.9}.dshSwarm_primary:disabled{opacity:.5;cursor:not-allowed}.dshSwarm_goalList{margin-top:12px!important;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}.dshSwarm_goalEntry{padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}.dshSwarm_goalEntry:last-child{border:0}.dshSwarm_goalEntry summary{cursor:pointer;overflow-wrap:anywhere;font-weight:550}.dshSwarm_goalEntry summary .dshSwarm_badge{margin-inline-end:8px}.dshSwarm_goalEntry .dshSwarm_goalFull{font-size:12px}.dshSwarm_criteria{list-style:decimal!important;margin:10px 0 0 20px!important;font-size:12px;color:var(--dsw-alias-label-secondary)}.dshSwarm_criteria li{padding:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}.dshSwarm_receipt{margin-top:12px!important;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.dshSwarm_goalSummary{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dshSwarm_goalSection{margin-top:20px}
.dshSwarm_goalBox{margin-top:18px;padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_goalBox summary{cursor:pointer;font-size:11px;color:var(--dsw-alias-label-secondary)}.dshSwarm_goalPreview{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;margin-top:7px;font-size:17px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}.dshSwarm_goalBox[open] .dshSwarm_goalPreview{display:none}.dshSwarm_goalFull{margin-top:10px!important;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.dshSwarm_filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.dshSwarm_filter{font:inherit;font-size:11px;padding:4px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}.dshSwarm_filter:hover{background:var(--dsw-alias-bg-layer-2)}.dshSwarm_filter[aria-pressed=true]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}.dshSwarm_filterCount{font-variant-numeric:tabular-nums;margin-inline-start:6px}.dshSwarm_taskEntry{border-bottom:1px solid var(--dsw-alias-border-l1)}.dshSwarm_taskEntry:last-child{border-bottom:0}.dshSwarm_taskEntry summary{padding:12px 14px;cursor:pointer}.dshSwarm_taskEntry summary::marker{color:var(--dsw-alias-label-secondary)}.dshSwarm_taskEntry .dshSwarm_taskSubject{font-weight:600;margin-inline-end:10px}.dshSwarm_taskEntry .dshSwarm_taskMeta{margin-inline-start:14px}.dshSwarm_taskFacts{padding:0 14px 14px 28px;font-size:11px}.dshSwarm_taskEntry details[open]{background:var(--dsw-alias-bg-layer-2)}
.dshSwarm_delivery{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:16px;margin:18px 0 24px;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_deliveryTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}.dshSwarm_deliveryRevision{display:flex;align-items:baseline;gap:8px 14px;flex-wrap:wrap;overflow-wrap:anywhere}.dshSwarm_deliveryRevision>code{font-size:18px;font-weight:600}.dshSwarm_deliveryChecks{display:flex;flex-wrap:wrap;gap:5px 14px;margin-top:10px;font-size:11px;color:var(--dsw-alias-label-secondary)}.dshSwarm_collaboration{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:24px;align-items:start}.dshSwarm_collaboration>.dshSwarm_section{min-width:0}.dshSwarm_scopeNote{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:10px!important}.dshSwarm_kpis{gap:12px;margin:14px 0}.dshSwarm_kpi dd{font-size:20px}.dshSwarm_kpiNote:empty{display:none}.dshSwarm_workflow{margin-top:16px!important}.dshSwarm_step{padding:11px 12px}
@container(max-width:760px){.dshSwarm_collaboration{grid-template-columns:1fr;gap:0}}
@media(max-width:760px){.dshSwarm_collaboration{grid-template-columns:1fr;gap:0}}
@container(max-width:620px){.dshSwarm_workers{grid-template-columns:1fr}.dshSwarm_workflow{grid-template-columns:repeat(2,minmax(0,1fr))}.dshSwarm_step:nth-child(2){border-inline-end:0}.dshSwarm_step:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.dshSwarm_kpis{gap:8px}.dshSwarm_kpi dd{font-size:21px}}
@media(max-width:540px){.dshSwarm_root{padding:16px 12px 28px}.dshSwarm_workers{grid-template-columns:1fr}.dshSwarm_header{gap:12px}.dshSwarm_workflow{grid-template-columns:repeat(2,minmax(0,1fr))}.dshSwarm_step:nth-child(2){border-inline-end:0}.dshSwarm_step:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.dshSwarm_taskRow{grid-template-columns:minmax(0,1fr)}.dshSwarm_taskRow>.dshSwarm_badge{justify-self:start}.dshSwarm_kpis{gap:8px}.dshSwarm_kpi dd{font-size:20px}}
@media(prefers-reduced-motion:reduce){.dshSwarm_root *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
		const zh = {
			"view.label": "◈ 协作群", "title": "Swarm 协作群",
			"goals.title": "目标", "goals.add": "追加目标", "goals.placeholder": "接下来还需要做什么？", "goals.criteria": "验收条件（可选，每行一项）", "goals.publish": "发布目标", "goals.publishing": "正在提交…", "goals.scope": "当前会话 · 当前仓库", "goals.original": "初始目标", "goal.active": "本轮待完成", "goal.deferred": "待下一轮", "goal.completed": "已处理", "goal.continued": "已转下一轮", "goals.paused": "追加后仍保持暂停", "goals.deferred": "本轮已收尾，追加将保存到下一轮", "goals.resume": "恢复本轮", "goals.continue": "开始下一轮", "goals.criteriaTitle": "验收条件", "goals.more": "显示 {shown}/{total} 项；其余记录已保存，暂不在面板展示", "goals.clipped": "此处内容已截断；完整内容保存在运行记录中", "goals.publishFirst": "先发布或清空草稿", "goals.unavailable": "当前 Host 不支持追加目标，请更新 Host 后重连。", "goals.sent.executing": "已发布 · 已加入本轮工作", "goals.sent.paused": "已保存 · 恢复后处理", "goals.sent.deferred": "已保存 · 等待下一轮", "goals.sent.continue": "下一轮已启动", "goals.sent.resume": "本轮已恢复", "goals.unknownReceipt": "回执不完整，请检查目标列表后再决定是否重试。", "goals.commandUnavailable": "命令服务不可用", "goals.pending": "{count} 项待下一轮", "goals.failed": "提交失败，草稿已保留", "goals.uncertain": "未确认提交结果；请检查目标列表后再重试。", "goals.nextRun": "下一轮运行", "goals.commit": "完成版本", "loading": "正在连接进度流…", "refresh": "更新连接", "unknown": "未知", "unavailable": "不可用",
			"connection.live": "实时连接", "connection.loading": "连接中", "connection.ended": "订阅已结束", "connection.error": "连接中断", "connection.unavailable": "服务不可用",
			"updated": "快照更新于 {time}", "stale.title": "非实时 · 最后已知快照", "stale.body": "连接中断后保留已知状态，工作可能仍在继续。请更新连接。", "ended.body": "当前订阅已结束。请手动更新以查看此会话的新运行。",
			"legacy.title": "Host 能力受限", "legacy.body": "当前 Host 未提供新版进度协议；执行工具、任务板与公开活动可能不可用。已兼容旧订阅，终态后不会自动发现新运行。需更新并重启 Host 后重新连接。",
			"noRun.title": "此会话尚无协作运行", "noRun.body": "在对话中告诉 Agent 你想协作开发什么，它会帮你整理目标并启动。",
			"phase.preparing": "准备中", "phase.running": "协作中", "phase.draining": "交付验证中", "phase.quiescing": "资源收尾中", "phase.paused": "已暂停", "phase.completed": "已完成", "phase.stopped": "已停止", "phase.failed": "已失败",
			"workflow": "全局工作流程", "stage.prepare": "准备环境", "stage.collaborate": "协作实现", "stage.integrate": "集成验证", "stage.deliver": "交付结果",
			"stage.prepare.count": "{ready}/{total} 成员已就绪", "stage.collaborate.count": "{claimed} 进行中 · {open} 待认领", "stage.integrate.count": "{accepted} 已集成 · {pending} 待处理", "stage.deliver.count": "{done}/{total} 任务完成",
			"stage.active": "当前有工作", "stage.complete": "已就绪", "stage.pending": "等待", "tasks.kpi": "已完成任务", "tasks.note": "{blocked} 阻塞 · {cancelled} 取消（不计完成）",
			"verification.kpi": "已通过验证", "verification.note": "{running} 执行中 · {failed} 失败 · {interrupted} 中断", "budget.kpi": "预算剩余", "budget.unlimited": "运行时长", "budget.noDeadline": "无截止时间", "budget.ended": "结束时预算剩余", "budget.snapshot": "快照时预算剩余", "budget.expired": "预算已耗尽", "elapsed": "墙钟时长 {duration}", "elapsed.unknown": "Host 未提供起始时间",
			"workers.title": "成员此刻的工作", "workers.note": "任务归属与原生运行状态分别展示", "worker.name": "成员 {number}", "worker.noTask": "尚未持有任务", "worker.native": "原生状态：{status}", "worker.inactiveNote": "inactive 不代表任务完成",
			"work.initializing": "准备工作区", "work.failed": "初始化失败", "work.assigned": "持有任务", "work.coordinating": "协作与选取工作", "work.waiting": "等待协作更新", "work.integration": "等待集成结果", "work.integrating": "候选正在集成", "work.unassigned": "没有当前任务",
			"activity.running": "Turn 执行中", "activity.executing": "工具调用中 · {count} 项", "activity.executingOmitted": "工具调用中 · 部分调用未展示", "activity.idle": "当前无执行中的 turn", "activity.unavailable": "执行活动不可用", "activity.legacy": "Host 未提供执行活动", "activity.stale": "最后记录：{activity}",
			"workers.filter": "筛选成员", "workers.all": "全部 · {count}", "worker.task": "当前任务", "worker.execution": "执行活动", "worker.snapshot": "最后快照", "work.unavailable": "工作状态不可用", "wait.targets": "{tasks} 个任务 · {proposals} 个提案的更新", "tools.moreActive": "更多调用（{count}）",
			"worker.details": "工具记录与等待详情", "worker.id": "成员 ID", "worker.initialization": "初始化", "worker.turnStep": "Turn {turn} · Step {step}", "worker.wait": "等待条件", "wait.any": "任意匹配的协作更新", "wait.selected": "指定任务 / 提案更新", "wait.after": "已读至事件 {seq}", "worker.proposal": "当前提案", "tools.recent": "最近工具（非执行中）", "tool.executing": "调用中", "tool.completed": "已返回", "tool.failed": "失败", "tool.interrupted": "已中断",
			"init.pending": "待准备", "init.initializing": "准备中", "init.ready": "就绪", "init.failed": "失败", "task.open": "待认领", "task.claimed": "已认领", "task.proposed": "待集成", "task.done": "已完成", "task.blocked": "阻塞", "task.cancelled": "已取消",
			"tasks.title": "任务板", "tasks.empty": "尚未创建任务。", "tasks.missing": "当前 Host 未提供任务板。", "tasks.more": "显示 {shown}/{total} 项（优先展示活跃任务）", "tasks.unowned": "未分配", "tasks.details": "更多任务（{count}）",
			"events.title": "公开活动", "events.note": "仅任务、提案、结果与运行状态；不含私信或推理", "events.empty": "暂无公开状态变更。", "events.missing": "当前 Host 未提供公开活动。", "events.more": "更早活动（{count}）", "event.task": "任务", "event.proposal": "提案", "event.head": "结果版本", "event.run": "运行", "event.updated": "已更新", "proposal.queued": "排队中", "proposal.integrating": "集成中", "proposal.accepted": "已接受", "proposal.rejected": "已拒绝",
			"result.title": "结果与运行细节", "result.ref": "结果分支", "result.head": "已接受 SHA", "result.base": "基线 SHA", "result.run": "运行 ID", "result.verification": "验证计数", "result.proposals": "提案计数", "result.finish": "交付验证请求", "result.noFinish": "尚未请求", "result.note": "已接受版本不等于整个目标已验收；仅运行状态为“已完成”时表示交付完成。", "reason": "当前原因：{reason}", "detail.error": "部分详情不可用：{message}",
			"overview.goal": "本轮目标 · 展开全文", "overview.goalMissing": "Host 未提供目标", "filter.all": "全部", "tasks.flow": "任务认领与推进", "tasks.noMatch": "本快照中没有此状态的任务。", "task.revision": "修订", "task.owner": "当前成员", "task.identity": "任务 ID", "task.proposal": "关联提案", "tasks.snapshot": "Host 仅提供 {shown}/{total} 项；筛选限于当前快照。",
			"events.recent": "最近公开活动", "events.scope": "最近 {count} 条", "events.noMatch": "最近活动中没有此类记录。", "events.source": "活动范围", "events.sourceNote": "仅 Host 提供的最近公开状态变更，不含完整历史、私信或推理。", "events.revision": "结果",
			"delivery.title": "当前交付", "delivery.baseline": "仍为基线", "delivery.integrated": "已集成 · 待整体验收", "delivery.verifying": "整体验证中", "delivery.closing": "交付收尾中", "delivery.completed": "交付完成", "delivery.stopped": "运行已停止", "delivery.failed": "运行失败", "delivery.accepted": "已集成 {count} 个提案", "delivery.pending": "待集成 {count}", "delivery.checks": "验证通过 {count}", "delivery.errors": "验证失败 {failed} · 中断 {interrupted}", "delivery.details": "版本与验证详情",
			"verification.summary": "排队 {queued} · 执行 {running} · 通过 {passed} · 失败 {failed} · 中断 {interrupted}", "proposal.summary": "排队 {queued} · 集成 {integrating} · 接受 {accepted} · 拒绝 {rejected}"
		};
		const en = {
			"view.label": "◈ Swarm", "title": "Swarm",
			"goals.title": "Goals", "goals.add": "Add a goal", "goals.placeholder": "What else should we work on?", "goals.criteria": "Acceptance criteria (optional, one per line)", "goals.publish": "Publish goal", "goals.publishing": "Submitting…", "goals.scope": "This session · This repository", "goals.original": "Initial goal", "goal.active": "Open this round", "goal.deferred": "Next round", "goal.completed": "Handled", "goal.continued": "Moved to next round", "goals.paused": "Adding a goal will not resume this run", "goals.deferred": "This round is closing; new goals are saved for the next round", "goals.resume": "Resume this round", "goals.continue": "Start next round", "goals.criteriaTitle": "Acceptance criteria", "goals.more": "Showing {shown}/{total}; other records are saved but not shown in this panel", "goals.clipped": "Content clipped here; the complete content is saved in the run record", "goals.publishFirst": "Publish or clear the draft first", "goals.unavailable": "This Host cannot append goals. Update the Host and reconnect.", "goals.sent.executing": "Published · Added to this round", "goals.sent.paused": "Saved · Waiting for resume", "goals.sent.deferred": "Saved · Waiting for next round", "goals.sent.continue": "Next round started", "goals.sent.resume": "This round resumed", "goals.unknownReceipt": "Incomplete receipt. Check the goal list before retrying.", "goals.commandUnavailable": "Command service unavailable", "goals.pending": "{count} goals for next round", "goals.failed": "Submission failed; draft retained", "goals.uncertain": "Submission not confirmed; check the goal list before retrying.", "goals.nextRun": "Next run", "goals.commit": "Completed revision", "loading": "Connecting to progress…", "refresh": "Reconnect", "unknown": "Unknown", "unavailable": "Unavailable",
			"connection.live": "Live", "connection.loading": "Connecting", "connection.ended": "Subscription ended", "connection.error": "Disconnected", "connection.unavailable": "Service unavailable",
			"updated": "Snapshot updated {time}", "stale.title": "Not live · Last known snapshot", "stale.body": "The connection was lost; work may still be continuing. Reconnect to update this view.", "ended.body": "This subscription has ended. Reconnect manually to see a new run in this session.",
			"legacy.title": "Limited Host capabilities", "legacy.body": "This Host does not provide the new progress protocol. Tool activity, task board and public activity may be unavailable. Using the legacy subscription; it cannot discover a new run after completion. Update and restart the Host, then reconnect.",
			"noRun.title": "No Swarm run in this session", "noRun.body": "Tell the Agent in chat what you want to build together. It will organize the goals and start the work.",
			"phase.preparing": "Preparing", "phase.running": "Collaborating", "phase.draining": "Verifying delivery", "phase.quiescing": "Quiescing resources", "phase.paused": "Paused", "phase.completed": "Completed", "phase.stopped": "Stopped", "phase.failed": "Failed",
			"workflow": "Overall workflow", "stage.prepare": "Prepare", "stage.collaborate": "Collaborate", "stage.integrate": "Integrate & verify", "stage.deliver": "Deliver",
			"stage.prepare.count": "{ready}/{total} workers ready", "stage.collaborate.count": "{claimed} claimed · {open} open", "stage.integrate.count": "{accepted} accepted · {pending} pending", "stage.deliver.count": "{done}/{total} tasks done",
			"stage.active": "Work in progress", "stage.complete": "Ready", "stage.pending": "Waiting", "tasks.kpi": "Tasks completed", "tasks.note": "{blocked} blocked · {cancelled} cancelled (not done)",
			"verification.kpi": "Verifications passed", "verification.note": "{running} running · {failed} failed · {interrupted} interrupted", "budget.kpi": "Budget remaining", "budget.unlimited": "Elapsed time", "budget.noDeadline": "No deadline", "budget.ended": "Budget remaining at end", "budget.snapshot": "Budget at last snapshot", "budget.expired": "Budget exhausted", "elapsed": "Wall-clock time {duration}", "elapsed.unknown": "Start time unavailable from Host",
			"workers.title": "What workers are doing", "workers.note": "Task ownership and native execution are separate", "worker.name": "Worker {number}", "worker.noTask": "No task currently held", "worker.native": "Native status: {status}", "worker.inactiveNote": "inactive does not mean the task is done",
			"work.initializing": "Preparing workspace", "work.failed": "Initialization failed", "work.assigned": "Task held", "work.coordinating": "Coordinating / selecting work", "work.waiting": "Waiting for collaboration", "work.integration": "Waiting for integration", "work.integrating": "Candidate being integrated", "work.unassigned": "No current task",
			"activity.running": "Turn running", "activity.executing": "Tool calls in progress · {count}", "activity.executingOmitted": "Tool calls in progress · some calls omitted", "activity.idle": "No turn currently executing", "activity.unavailable": "Execution activity unavailable", "activity.legacy": "Host does not expose execution activity", "activity.stale": "Last recorded: {activity}",
			"workers.filter": "Filter workers", "workers.all": "All · {count}", "worker.task": "Current task", "worker.execution": "Execution", "worker.snapshot": "Last snapshot", "work.unavailable": "Work status unavailable", "wait.targets": "Updates to {tasks} tasks · {proposals} proposals", "tools.moreActive": "More calls ({count})",
			"worker.details": "Tool history & wait details", "worker.id": "Worker ID", "worker.initialization": "Initialization", "worker.turnStep": "Turn {turn} · Step {step}", "worker.wait": "Waiting for", "wait.any": "Any matching collaboration update", "wait.selected": "Selected task / proposal updates", "wait.after": "Acknowledged through event {seq}", "worker.proposal": "Current proposal", "tools.recent": "Recent tools (not executing)", "tool.executing": "Call in progress", "tool.completed": "Returned", "tool.failed": "Failed", "tool.interrupted": "Interrupted",
			"init.pending": "Pending", "init.initializing": "Initializing", "init.ready": "Ready", "init.failed": "Failed", "task.open": "Open", "task.claimed": "Claimed", "task.proposed": "Proposed", "task.done": "Done", "task.blocked": "Blocked", "task.cancelled": "Cancelled",
			"tasks.title": "Task board", "tasks.empty": "No tasks created yet.", "tasks.missing": "Task board is unavailable from this Host.", "tasks.more": "Showing {shown}/{total} tasks (active first)", "tasks.unowned": "Unassigned", "tasks.details": "More tasks ({count})",
			"events.title": "Public activity", "events.note": "Task, proposal, result and run states only; no private messages or reasoning", "events.empty": "No public state changes yet.", "events.missing": "Public activity is unavailable from this Host.", "events.more": "Earlier activity ({count})", "event.task": "Task", "event.proposal": "Proposal", "event.head": "Result revision", "event.run": "Run", "event.updated": "Updated", "proposal.queued": "Queued", "proposal.integrating": "Integrating", "proposal.accepted": "Accepted", "proposal.rejected": "Rejected",
			"result.title": "Result & run details", "result.ref": "Result branch", "result.head": "Accepted SHA", "result.base": "Base SHA", "result.run": "Run ID", "result.verification": "Verification counts", "result.proposals": "Proposal counts", "result.finish": "Finish verification", "result.noFinish": "Not requested", "result.note": "An accepted revision is not acceptance of the whole goal. Delivery is complete only when the run is Completed.", "reason": "Current reason: {reason}", "detail.error": "Some details are unavailable: {message}",
			"overview.goal": "Run goal · Expand", "overview.goalMissing": "Goal unavailable from Host", "filter.all": "All", "tasks.flow": "Task ownership & progress", "tasks.noMatch": "No tasks with this status in the snapshot.", "task.revision": "Revision", "task.owner": "Current worker", "task.identity": "Task ID", "task.proposal": "Linked proposal", "tasks.snapshot": "Host provides {shown}/{total} tasks; filters use this snapshot only.",
			"events.recent": "Recent public activity", "events.scope": "Latest {count} events", "events.noMatch": "No matching events in recent activity.", "events.source": "Activity scope", "events.sourceNote": "Recent public state changes from Host only, not full history, private messages or reasoning.", "events.revision": "Results",
			"delivery.title": "Current delivery", "delivery.baseline": "Baseline only", "delivery.integrated": "Integrated · Delivery pending", "delivery.verifying": "Verifying delivery", "delivery.closing": "Closing delivery resources", "delivery.completed": "Delivery complete", "delivery.stopped": "Run stopped", "delivery.failed": "Run failed", "delivery.accepted": "{count} proposals accepted", "delivery.pending": "{count} pending integration", "delivery.checks": "{count} verifications passed", "delivery.errors": "{failed} failed · {interrupted} interrupted", "delivery.details": "Revision & verification details",
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
		const goalValid = (goal) => object(goal) && typeof goal.id === "string" && count(goal.seq) && typeof goal.text === "string" && ["active", "deferred", "completed"].includes(goal.status) && Array.isArray(goal.acceptanceCriteria) && goal.acceptanceCriteria.every((item) => typeof item === "string") && validTime(goal.createdAt) && timeOrNull(goal.completedAt) && textOrNull(goal.completedCommit) && textOrNull(goal.continuedInRunId) && typeof goal.truncated === "boolean";
		const toolValid = (tool) => object(tool) && typeof tool.id === "string" && typeof tool.name === "string" && ["executing", "completed", "failed", "interrupted"].includes(tool.status) && timeOrNull(tool.startedAt) && timeOrNull(tool.finishedAt);

		/** Validate the unknown-codec boundary before replacing a useful last snapshot. */
		function readFrame(item) {
			const p = item?.progress;
			if (!object(item) || !count(item.seq) || !(p === null || object(p))) throw new TypeError("Invalid Swarm progress frame");
			if (p === null) return null;
			if (typeof p.runId !== "string" || typeof p.phase !== "string" || !validTime(p.now) || !timeOrNull(p.deadline) || !validTime(p.updatedAt) || !(p.remainingMs === null || finite(p.remainingMs)) || ((p.deadline === null) !== (p.remainingMs === null))
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
			if (p.protocolVersion >= 2 && ((p.goalBoard != null && (!object(p.goalBoard) || !count(p.goalBoard.total) || !count(p.goalBoard.revision) || typeof p.goalBoard.truncated !== "boolean" || !Array.isArray(p.goalBoard.items) || !p.goalBoard.items.every(goalValid) || !countsValid(p.goalBoard.counts, ["active", "deferred", "completed", "continued"])))
				|| (p.acceptanceCriteria !== undefined && (!Array.isArray(p.acceptanceCriteria) || !p.acceptanceCriteria.every((item) => typeof item === "string")))
				|| (p.originalGoalTruncated !== undefined && typeof p.originalGoalTruncated !== "boolean"))) throw new TypeError("Invalid Swarm goal details");
			if (!(p.protocolVersion >= 2)) {
				// A v1 Host has no contract for v2 additions; do not render unchecked extras.
				return { ...p, goal: null, goalBoard: null, acceptanceCriteria: undefined, originalGoalTruncated: false, createdAt: null, taskBoard: undefined, recentEvents: undefined, workers: p.workers.map((w) => ({ ...w, activity: undefined, wait: null, currentProposal: null })) };
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
			return { remainingMs: p.deadline === null ? null : Math.max(0, p.deadline - clockNow), elapsedMs: finite(p.createdAt) ? Math.max(0, clockNow - p.createdAt) : null };
		}
		/** One presentation timer only; it never reads Host state or reconnects. */
		function startClock(state, onTick) {
			if (state.status !== "live" || !state.progress || terminal(state.progress.phase)) return undefined;
			onTick(Date.now());
			const timer = setInterval(() => onTick(Date.now()), 1000);
			return () => clearInterval(timer);
		}
		function budgetKey(p) {
			if (p.deadline === null) return "budget.unlimited";
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

		const taskFilters = ["all", "open", "claimed", "proposed", "blocked", "done", "cancelled"];
		function filterTasks(progress, status) {
			return (progress.taskBoard?.items ?? []).filter((task) => status === "all" || task.status === status);
		}
		function filterEvents(progress, kind) {
			return [...(progress.recentEvents ?? [])].reverse().filter((event) => kind === "all" || event.kind === kind);
		}
		function filterButton(key, name, selected, onSelect, count) {
			return h("button", { key, type: "button", className: "dshSwarm_filter", "aria-pressed": selected, onClick: () => onSelect(key) }, name, count == null ? null : h("span", { className: "dshSwarm_filterCount" }, count));
		}
		function TaskBoard({ t, progress }) {
			const [status, setStatus] = React.useState("all");
			const board = progress.taskBoard;
			const names = new Map(progress.workers.map((worker, index) => [worker.id, t("worker.name", { number: index + 1 })]));
			const items = filterTasks(progress, status);
			const rows = (tasks) => h("ul", { className: "dshSwarm_board" }, tasks.map((task) => {
				const owner = names.get(task.ownerWorkerId) ?? task.ownerWorkerId ?? t("tasks.unowned", {});
				return h("li", { key: task.id, className: "dshSwarm_taskEntry" }, h("details", {},
					h("summary", {}, h("span", { className: "dshSwarm_taskSubject" }, task.subject), badge(label(t, "task", task.status), tone(task.status)), h("span", { className: "dshSwarm_taskMeta" }, owner)),
					h("dl", { className: "dshSwarm_facts dshSwarm_taskFacts" }, fact(t("task.identity", {}), h("code", {}, task.id)), fact(t("task.owner", {}), owner), fact(t("task.revision", {}), task.revision), task.proposalId ? fact(t("task.proposal", {}), h("code", {}, task.proposalId)) : null)));
			}));
			return h("section", { className: "dshSwarm_section", "aria-label": t("tasks.flow", {}) },
				h("div", { className: "dshSwarm_sectionHead" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("tasks.flow", {}))),
				board ? h("div", { className: "dshSwarm_filters", role: "group", "aria-label": t("tasks.title", {}) }, taskFilters.map((key) => filterButton(key, key === "all" ? t("filter.all", {}) : label(t, "task", key), status === key, setStatus, key === "all" ? progress.tasks.total : progress.tasks[key]))) : null,
				board?.truncated ? h("p", { className: "dshSwarm_scopeNote dshSwarm_warn", role: "status" }, t("tasks.snapshot", { shown: board.items.length, total: board.total })) : null,
				!board ? h("p", { className: "dshSwarm_subtle" }, t("tasks.missing", {})) : !items.length ? h("p", { className: "dshSwarm_subtle" }, t(board.total === 0 ? "tasks.empty" : "tasks.noMatch", {})) : h(React.Fragment, { key: status }, rows(items.slice(0, 6)), items.length > 6 ? h("details", { className: "dshSwarm_details" }, h("summary", {}, t("tasks.details", { count: items.length - 6 })), rows(items.slice(6))) : null));
		}
		function describeEvent(progress, event) {
			const tasks = [...(progress.taskBoard?.items ?? []), ...progress.workers.map((worker) => worker.currentTask).filter(Boolean)];
			const task = event.kind === "task" ? tasks.find((task) => task.id === event.objectId) : event.kind === "proposal" ? tasks.find((task) => task.proposalId === event.objectId) : null;
			return { subject: task?.subject ?? (event.kind === "run" ? null : event.objectId.slice(0, 12)), workerNumber: progress.workers.findIndex((worker) => worker.id === event.authorWorkerId) + 1 };
		}
		function Timeline({ t, progress }) {
			const [kind, setKind] = React.useState("all");
			const events = progress.recentEvents;
			const rows = (items) => h("ol", { className: "dshSwarm_timeline" }, items.map((event) => {
				const description = describeEvent(progress, event);
				return h("li", { className: "dshSwarm_event", key: event.seq }, timeElement(event.createdAt), label(t, "event", event.kind), " · ", description.subject ? h("span", { title: event.objectId }, description.subject, " · ") : null,
					event.kind === "head" ? t("event.updated", {}) : label(t, event.kind === "run" ? "phase" : event.kind, event.status), description.workerNumber ? h("span", { className: "dshSwarm_subtle" }, " · ", t("worker.name", { number: description.workerNumber })) : null);
			}));
			const newest = filterEvents(progress, kind);
			return h("section", { className: "dshSwarm_section", "aria-label": t("events.recent", {}) },
				h("div", { className: "dshSwarm_sectionHead" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("events.recent", {})), events ? h("span", { className: "dshSwarm_subtle" }, t("events.scope", { count: events.length })) : null),
				events ? h("div", { className: "dshSwarm_filters", role: "group", "aria-label": t("events.title", {}) }, ["all", "task", "proposal", "head", "run"].map((key) => filterButton(key, t(key === "all" ? "filter.all" : key === "head" ? "events.revision" : "event." + key, {}), kind === key, setKind))) : null,
				!events || !newest.length ? h("p", { className: "dshSwarm_subtle" }, t(!events ? "events.missing" : events.length ? "events.noMatch" : "events.empty", {})) : h(React.Fragment, { key: kind }, rows(newest.slice(0, 6)), newest.length > 6 ? h("details", { className: "dshSwarm_details" }, h("summary", {}, t("events.more", { count: newest.length - 6 })), rows(newest.slice(6))) : null),
				events ? h("details", { className: "dshSwarm_details" }, h("summary", {}, t("events.source", {})), h("p", {}, t("events.sourceNote", {}))) : null);
		}
		function deliveryState(progress) {
			if (["completed", "stopped", "failed"].includes(progress.phase)) return progress.phase;
			if (progress.phase === "quiescing" && progress.quiesceTarget === "completed") return "closing";
			if (progress.phase === "draining") return "verifying";
			return progress.acceptedHead === progress.baseCommit ? "baseline" : "integrated";
		}
		function DeliveryCard({ t, progress: p }) {
			const delivery = deliveryState(p);
			return h("section", { className: "dshSwarm_delivery", "aria-label": t("delivery.title", {}) },
				h("div", { className: "dshSwarm_deliveryTop" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("delivery.title", {})), badge(t("delivery." + delivery, {}), tone(delivery))),
				h("div", { className: "dshSwarm_deliveryRevision" }, h("code", { title: p.acceptedHead, "aria-label": t("result.head", {}) + ": " + p.acceptedHead }, p.acceptedHead.slice(0, 12)), h("span", { className: "dshSwarm_subtle" }, t("result.ref", {}), " · ", h("code", {}, p.resultRef))),
				h("div", { className: "dshSwarm_deliveryChecks" }, h("span", {}, t("delivery.accepted", { count: p.proposals.accepted })), p.proposals.queued + p.proposals.integrating ? h("span", { className: "dshSwarm_active" }, t("delivery.pending", { count: p.proposals.queued + p.proposals.integrating })) : null, h("span", {}, t("delivery.checks", { count: p.verifications.passed })), p.verifications.failed + p.verifications.interrupted ? h("span", { className: "dshSwarm_warn" }, t("delivery.errors", p.verifications)) : null),
				h("details", { className: "dshSwarm_details" }, h("summary", {}, t("delivery.details", {})), h("dl", { className: "dshSwarm_facts" },
					fact(t("result.head", {}), h("code", {}, p.acceptedHead)), fact(t("result.base", {}), h("code", {}, p.baseCommit)), fact(t("result.run", {}), h("code", {}, p.runId)), fact(t("result.proposals", {}), t("proposal.summary", p.proposals)), fact(t("result.verification", {}), t("verification.summary", p.verifications)), fact(t("result.finish", {}), p.finishRequest?.verificationId ?? (p.finishRequest ? p.finishRequest.id : t("result.noFinish", {}))))));
		}
		/** Original peer-orbit mark; follows the Host theme, never patches Host DOM. */
		function SwarmMark() {
			return h("svg", { className: "dshSwarm_brand", viewBox: "0 0 40 40", fill: "none", "aria-hidden": true },
				h("rect", { x: 1, y: 1, width: 38, height: 38, rx: 11, fill: "currentColor", opacity: .1 }),
				h("path", { d: "M20 8 32 20 20 32 8 20Z", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" }),
				[[20, 8], [32, 20], [20, 32], [8, 20]].map(([cx, cy]) => h("circle", { key: cx + ":" + cy, cx, cy, r: 3.5, fill: "currentColor" })),
				h("path", { d: "m20 14 6 6-6 6-6-6Z", fill: "currentColor" }));
		}
		/** JSON is passed as command data, not through shell or the quoted-token grammar. */
		function appendGoalLine(goal, criteria) {
			const acceptanceCriteria = criteria.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
			return "/swarm append --json " + JSON.stringify({ goal: goal.trim(), ...(acceptanceCriteria.length ? { acceptanceCriteria } : {}) });
		}
		/** Native remote success only means admission; handler errors must remain errors. */
		async function executeGoalCommand(execute, sessionId, line, signal) {
			const reply = await execute(sessionId, line, [], signal);
			if (!object(reply) || reply.ok !== true) throw new Error(reply?.error ? reply.error.code + ": " + reply.error.message : "Invalid command response");
			const result = reply.value?.result;
			if (!object(result) || result.kind !== "success") throw new Error(result?.text || "Command was not accepted");
			return typeof result.text === "string" ? result.text : "";
		}
		function goalState(goal, phase) { return goal.continuedInRunId ? "continued" : goal.status === "active" && terminal(phase) ? "deferred" : goal.status; }
		function appendReceipt(text) {
			const parsed = JSON.parse(text);
			if (!object(parsed) || !["executing", "paused", "deferred"].includes(parsed.disposition) || typeof parsed.goalId !== "string" || typeof parsed.runId !== "string" || !count(parsed.goalRevision)) throw new Error("Invalid append receipt");
			return parsed;
		}
		function GoalSection({ t, progress: p, sessionId, executeCommand, connected }) {
			const [draft, setDraft] = React.useState("");
			const [criteria, setCriteria] = React.useState("");
			const [pending, setPending] = React.useState(false);
			const [receipt, setReceipt] = React.useState(null);
			const request = React.useRef(null);
			React.useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
			const board = p.goalBoard;
			const supported = !!board && typeof executeCommand === "function";
			const hasDraft = !!(draft.trim() || criteria.trim());
			const deferred = (board?.counts.deferred ?? 0) + (terminal(p.phase) ? board?.counts.active ?? 0 : 0);
			const submit = async (action) => {
				if (request.current || !supported || !connected || (action === "continue" && hasDraft)) return;
				const controller = new AbortController();
				request.current = controller;
				setPending(true); setReceipt(null);
				try {
					const text = await executeGoalCommand(executeCommand, sessionId, action === "append" ? appendGoalLine(draft, criteria) : "/swarm " + action, controller.signal);
					if (controller.signal.aborted) return;
					let disposition = action;
					if (action === "append") {
						let parsed;
						try { parsed = appendReceipt(text); } catch { throw new Error(t("goals.unknownReceipt", {})); }
						disposition = parsed.disposition;
						setDraft(""); setCriteria("");
					}
					setReceipt({ ok: true, text: t("goals.sent." + disposition, {}) });
				} catch (error) {
					if (!controller.signal.aborted) setReceipt({ ok: false, text: (error instanceof Error ? error.message : String(error)) });
				} finally {
					if (request.current === controller) { request.current = null; if (!controller.signal.aborted) setPending(false); }
				}
			};
			return h("section", { className: "dshSwarm_goalSection", "aria-label": t("goals.title", {}) },
				h("div", { className: "dshSwarm_goalSummary" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("goals.title", {})), deferred ? badge(t("goals.pending", { count: deferred }), "dshSwarm_warn") : null),
				h("details", { className: "dshSwarm_goalBox" }, h("summary", {}, t("goals.original", {}), h("span", { className: "dshSwarm_goalPreview" }, p.goal ?? t("overview.goalMissing", {}))), h("p", { className: "dshSwarm_goalFull" }, p.goal), p.originalGoalTruncated ? h("p", { className: "dshSwarm_subtle" }, t("goals.clipped", {})) : null,
					p.acceptanceCriteria?.length ? h("ol", { className: "dshSwarm_criteria" }, p.acceptanceCriteria.map((criterion, i) => h("li", { key: i }, criterion))) : null),
				!supported ? h("p", { className: "dshSwarm_receipt dshSwarm_subtle" }, t("goals.unavailable", {})) : h("form", { className: "dshSwarm_composer", onSubmit: (event) => { event.preventDefault(); if (draft.trim()) void submit("append"); } },
					h("label", {}, t("goals.add", {}), h("textarea", { className: "dshSwarm_input", value: draft, maxLength: 16000, rows: 3, placeholder: t("goals.placeholder", {}), disabled: pending, onChange: (event) => setDraft(event.target.value) })),
					h("details", { className: "dshSwarm_details" }, h("summary", {}, t("goals.criteria", {})), h("textarea", { className: "dshSwarm_input", value: criteria, rows: 3, maxLength: 64000, "aria-label": t("goals.criteria", {}), disabled: pending, onChange: (event) => setCriteria(event.target.value) })),
					h("div", { className: "dshSwarm_publishRow" }, h("span", { className: "dshSwarm_subtle" }, t(!connected ? "stale.title" : p.phase === "paused" ? "goals.paused" : ["draining", "quiescing", "completed", "stopped", "failed"].includes(p.phase) ? "goals.deferred" : "goals.scope", {})),
						h("div", { className: "dshSwarm_row" }, p.phase === "paused" || (terminal(p.phase) && deferred) ? h("button", { type: "button", className: "dshSwarm_button", disabled: pending || !connected || (p.phase !== "paused" && hasDraft), onClick: () => void submit(p.phase === "paused" ? "resume" : "continue") }, t(p.phase === "paused" ? "goals.resume" : hasDraft ? "goals.publishFirst" : "goals.continue", {})) : null,
							h("button", { type: "submit", className: "dshSwarm_button dshSwarm_primary", disabled: pending || !connected || !draft.trim() }, t(pending ? "goals.publishing" : "goals.publish", {})))),
					receipt ? h("p", { className: "dshSwarm_receipt " + (receipt.ok ? "dshSwarm_success" : "dshSwarm_error"), role: receipt.ok ? "status" : "alert" }, receipt.ok ? receipt.text : t("goals.failed", {}) + ": " + receipt.text) : null),
				board?.items.length ? h("div", { className: "dshSwarm_goalList" }, board.items.map((goal) => h("details", { key: goal.id, className: "dshSwarm_goalEntry" },
					h("summary", {}, badge(t("goal." + goalState(goal, p.phase), {}), goal.status === "completed" ? "dshSwarm_success" : goalState(goal, p.phase) === "deferred" ? "dshSwarm_warn" : "dshSwarm_active"), goal.text.length > 110 ? goal.text.slice(0, 110) + "…" : goal.text),
					h("p", { className: "dshSwarm_goalFull" }, goal.text),
					h("ol", { className: "dshSwarm_criteria", "aria-label": t("goals.criteriaTitle", {}) }, goal.acceptanceCriteria.map((criterion, i) => h("li", { key: i }, criterion))),
					h("div", { className: "dshSwarm_taskMeta" }, timeElement(goal.createdAt), h("code", {}, goal.id), goal.completedCommit ? h("span", {}, t("goals.commit", {}), " ", h("code", {}, goal.completedCommit.slice(0, 12))) : null, goal.continuedInRunId ? h("span", {}, t("goals.nextRun", {}), " ", h("code", {}, goal.continuedInRunId)) : null),
					goal.truncated ? h("p", { className: "dshSwarm_subtle" }, t("goals.clipped", {})) : null))) : null,
				board?.truncated ? h("p", { className: "dshSwarm_subtle" }, t("goals.more", { shown: board.items.length, total: board.total })) : null);
		}
		function RunBody({ t, state, now, sessionId, executeCommand }) {
			const p = state.progress;
			const clock = deriveClock(state, now);
			const kpi = (name, value, note) => h("div", { className: "dshSwarm_kpi" }, h("dt", {}, name), h("dd", {}, value, h("span", { className: "dshSwarm_kpiNote" }, note)));
			return h(React.Fragment, {},
				h(GoalSection, { t, progress: p, sessionId, executeCommand, connected: state.status === "live" }),
				p.reason ? notice(t("reason", { reason: p.reason }), p.phase === "quiescing" && p.quiesceTarget ? label(t, "phase", p.quiesceTarget) : null) : null,
				h("ol", { className: "dshSwarm_workflow", "aria-label": t("workflow", {}) }, deriveWorkflow(p).map((stage, index) => h("li", { key: stage.id, className: "dshSwarm_step", "data-state": stage.state, "aria-label": t("stage." + stage.id, {}) + ": " + t("stage." + stage.state, {}) }, h("div", { className: "dshSwarm_stepName" }, h("span", { className: "dshSwarm_stepIndex", "aria-hidden": true }, String(index + 1).padStart(2, "0")), t("stage." + stage.id, {})), h("div", { className: "dshSwarm_stepCount" }, t("stage." + stage.id + ".count", stage.counts))))),
				h("dl", { className: "dshSwarm_kpis" }, kpi(t("tasks.kpi", {}), p.tasks.done + " / " + p.tasks.total, p.tasks.blocked + p.tasks.cancelled ? t("tasks.note", p.tasks) : null), kpi(t("verification.kpi", {}), p.verifications.passed, p.verifications.running + p.verifications.failed + p.verifications.interrupted ? t("verification.note", p.verifications) : null), kpi(t(budgetKey(p), {}), p.deadline === null ? (clock.elapsedMs === null ? "—" : duration(clock.elapsedMs)) : duration(clock.remainingMs), p.deadline === null ? t("budget.noDeadline", {}) : clock.elapsedMs === null ? t("elapsed.unknown", {}) : t("elapsed", { duration: duration(clock.elapsedMs) }))),
				clock.remainingMs === 0 && !terminal(p.phase) ? h("p", { className: "dshSwarm_subtle dshSwarm_warn" }, t("budget.expired", {})) : null,
				h(DeliveryCard, { t, progress: p }),
				h(WorkersSection, { t, progress: p, stale: state.status !== "live" }),
				p.detailError ? notice(t("unavailable", {}), t("detail.error", { message: p.detailError })) : null,
				h("div", { className: "dshSwarm_collaboration" }, h(TaskBoard, { t, progress: p }), h(Timeline, { t, progress: p })));

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
				h("header", { className: "dshSwarm_header" }, h("div", { className: "dshSwarm_row" }, h(SwarmMark), h("h2", { className: "dshSwarm_title" }, t("title", {})), current.progress ? badge(label(t, "phase", current.progress.phase), tone(current.progress.phase)) : null),
					h("div", { className: "dshSwarm_connection " + (current.status === "live" ? "dshSwarm_live" : "") }, h("span", { role: "status", "aria-live": "polite" }, h("span", { className: "dshSwarm_dot", "aria-hidden": true }), " ", t("connection." + current.status, {})), h("button", { type: "button", className: "dshSwarm_button", disabled: !available || current.status === "loading", onClick: () => setAttempt((value) => value + 1) }, t("refresh", {})))),
				current.progress ? h("p", { className: "dshSwarm_subtle", style: { marginTop: 6 } }, timeElement(current.progress.updatedAt, t("updated", { time: timeLabel(current.progress.updatedAt) }))) : null,
				current.status !== "live" && current.hasSnapshot ? notice(t("stale.title", {}), t(current.status === "ended" ? "ended.body" : "stale.body", {})) : null,
				current.message || (!available && props.progressError) ? h("p", { role: "alert", className: "dshSwarm_notice" }, current.message || props.progressError) : null,
				current.legacy ? notice(t("legacy.title", {}), t("legacy.body", {})) : null,
				current.progress ? h(RunBody, { key: sessionId + ":" + current.progress.runId, t, state: current, now, sessionId, executeCommand: props.executeCommand }) : current.hasSnapshot ? h("div", { className: "dshSwarm_empty" }, h("h3", {}, t("noRun.title", {})), h("p", {}, t("noRun.body", {}))) : h("p", { className: "dshSwarm_empty" }, t(current.status === "loading" ? "loading" : "unavailable", {})));
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
					const executeCommand = (sessionId, line, attachments, signal) => {
						const commands = ctx.get("remote.commands");
						if (typeof commands?.execute !== "function") throw new Error(t("goals.commandUnavailable", {}));
						return commands.execute(sessionId, line, attachments, signal);
					};
					const watchProgress = (sessionId, signal) => progressRemote().watch(sessionId, signal);
					const watchSessionProgress = (sessionId, signal) => progressRemote().watchSession(sessionId, signal);
					removeSlot = ctx.slots.inject("conversation.view", () => ctx.slots.register({ name: "conversation.view", id: "swarm-progress", order: 5, locale: NS, label: () => t("view.label", {}), inject: () => ({ progressAvailable: available, progressError, watchProgress, watchSessionProgress, executeCommand }) }, SwarmProgressView));
				}
				return async () => { cleanup(); await unmount?.(); };
			}, "dsh-swarm: progress panel");
		}
		// Pure derivations and the stream owner are also exercised without emulating a browser.
		return { apply, inject: ["slots", "locale", "remote"], progressClient: { readFrame, initialState, visibleState, subscribeProgress, deriveWorkflow, deriveWorker, selectWorkers, deriveClock, startClock, budgetKey, describeEvent, filterTasks, filterEvents, deliveryState, duration, appendGoalLine, executeGoalCommand, appendReceipt, goalState, dictionaries: { zh, en } } };
	}
});
