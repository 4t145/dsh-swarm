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
.dshSwarm_tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--dsw-alias-border-l1);margin-top:20px;padding-bottom:0}.dshSwarm_tab{flex:none;border:0;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;background:transparent;padding:10px 14px;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer}.dshSwarm_tab[aria-selected=true]{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);font-weight:600}.dshSwarm_tabpanel{padding-top:18px}.dshSwarm_tabpanel[hidden]{display:none}.dshSwarm_tabpanel>.dshSwarm_section{margin-top:0}
.dshSwarm_kanban{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px;align-items:start}.dshSwarm_lane{min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_laneTitle{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px!important;margin-bottom:12px!important}.dshSwarm_lane[data-lane=doing]{border-top:2px solid var(--dsw-alias-brand-primary)}.dshSwarm_lane[data-lane=done]{border-top:2px solid var(--dsw-alias-state-success-primary)}.dshSwarm_lane .dshSwarm_goalList{border:0;display:grid;gap:10px}.dshSwarm_lane .dshSwarm_goalEntry{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);padding:10px}.dshSwarm_lane .dshSwarm_composer{padding:10px;margin-top:0}.dshSwarm_lane .dshSwarm_publishRow{align-items:stretch}.dshSwarm_lane .dshSwarm_publishRow>.dshSwarm_row{width:100%}.dshSwarm_laneEmpty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:10px 0}.dshSwarm_addWorker{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}.dshSwarm_addWorker .dshSwarm_receipt{margin-top:0!important}
@container(max-width:760px){.dshSwarm_collaboration{grid-template-columns:1fr;gap:0}.dshSwarm_kanban{grid-template-columns:1fr}}
@media(max-width:760px){.dshSwarm_collaboration{grid-template-columns:1fr;gap:0}.dshSwarm_kanban{grid-template-columns:1fr}}
@container(max-width:620px){.dshSwarm_workers{grid-template-columns:1fr}.dshSwarm_workflow{grid-template-columns:repeat(2,minmax(0,1fr))}.dshSwarm_step:nth-child(2){border-inline-end:0}.dshSwarm_step:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.dshSwarm_kpis{gap:8px}.dshSwarm_kpi dd{font-size:21px}}
@media(max-width:540px){.dshSwarm_root{padding:16px 12px 28px}.dshSwarm_workers{grid-template-columns:1fr}.dshSwarm_header{gap:12px}.dshSwarm_workflow{grid-template-columns:repeat(2,minmax(0,1fr))}.dshSwarm_step:nth-child(2){border-inline-end:0}.dshSwarm_step:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.dshSwarm_taskRow{grid-template-columns:minmax(0,1fr)}.dshSwarm_taskRow>.dshSwarm_badge{justify-self:start}.dshSwarm_kpis{gap:8px}.dshSwarm_kpi dd{font-size:20px}}
.dshSwarm_gitScroll{max-height:68vh;min-height:180px;overflow:auto;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:0;margin-top:10px;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_gitList{border-inline-start:2px solid var(--dsw-alias-border-l1);margin-inline-start:5px!important;padding-inline-start:20px!important}.dshSwarm_gitCommit{position:relative;padding:0 0 22px;min-width:0}.dshSwarm_gitCommit:before{content:"";position:absolute;inset-inline-start:-26px;top:7px;width:10px;height:10px;border:2px solid var(--dsw-alias-brand-primary);border-radius:50%;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_gitCommit[data-merge=true]:before{border-radius:2px;transform:rotate(45deg)}.dshSwarm_gitSubject{font-size:13px;font-weight:600;overflow-wrap:anywhere;margin-top:5px!important}.dshSwarm_gitMeta{display:flex;gap:5px 10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.dshSwarm_gitFooter{display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:12px 0}.dshSwarm_gitSentinel{height:1px}.dshSwarm_gitWorktrees{display:grid;gap:8px;margin-top:10px!important}.dshSwarm_gitWorktree{padding:10px 12px;background:var(--dsw-alias-bg-layer-2);border-radius:6px;overflow-wrap:anywhere}.dshSwarm_gitWorktree code{display:block;margin-top:3px}.dshSwarm_gitScroll:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dshSwarm_trackRow{display:flex;align-items:flex-start;width:max-content;min-width:100%}.dshSwarm_trackRow .dshSwarm_gitSentinel{align-self:stretch;width:1px;height:auto}.dshSwarm_laneHeads{position:sticky;left:0;z-index:2;flex:none;width:168px;padding-inline:14px 12px;background:var(--dsw-alias-bg-layer-1);border-inline-end:1px solid var(--dsw-alias-border-l1)}.dshSwarm_laneHead{display:flex;flex-direction:column;justify-content:center;gap:3px;min-width:0;padding-inline-start:12px;border-inline-start:4px solid var(--dsw-alias-border-l2);border-radius:2px}.dshSwarm_laneName{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshSwarm_laneName i{flex:none;width:8px;height:8px;border-radius:50%}.dshSwarm_laneHead[data-trunk=true] .dshSwarm_laneName i{border-radius:2px}.dshSwarm_laneBranch,.dshSwarm_laneHeadSha{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshSwarm_laneHeadSha code{font-weight:600}.dshSwarm_trackCanvas{position:relative;flex:none}.dshSwarm_trackEdges{position:absolute;inset:0;pointer-events:none;overflow:visible}.dshSwarm_trackBand{fill:transparent}.dshSwarm_trackBand[data-odd=true]{fill:var(--dsw-alias-bg-layer-2);opacity:.45}.dshSwarm_trackLabel{position:absolute;display:flex;flex-direction:column;gap:2px;min-width:0;padding-inline-start:2px}.dshSwarm_trackLabel[data-side=above]{flex-direction:column-reverse}.dshSwarm_trackSubject{font-size:12px;font-weight:600;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}.dshSwarm_trackMeta{display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px}.dshSwarm_trackMeta code{font-size:10px}.dshSwarm_trackTag{flex:none;padding:0 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:9px;line-height:13px;font-weight:600}.dshSwarm_trackTag[data-head=true]{color:var(--dsw-alias-bg-layer-1)}.dshSwarm_trackLegend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;margin-top:10px;font-size:11px;color:var(--dsw-alias-label-secondary)}.dshSwarm_trackLegend>span{display:inline-flex;align-items:center;gap:5px}.dshSwarm_trackAxis{margin-inline-start:auto}.dshSwarm_create{margin-top:14px}
/* Members and goal board redesign. */
.dshSwarm_memberHead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px}.dshSwarm_memberIntro{display:grid;gap:3px;min-width:0}.dshSwarm_memberIntro .dshSwarm_sectionTitle{font-size:15px}
.dshSwarm_capacity{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_capacityInfo{display:grid;grid-template-columns:auto auto;align-items:center;gap:2px 10px}.dshSwarm_capacityLabel{grid-column:1/-1;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}.dshSwarm_capacityCount{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.dshSwarm_capacityCount strong{font-size:18px;color:var(--dsw-alias-label-primary)}
.dshSwarm_seats{display:flex;gap:4px}.dshSwarm_seat{width:10px;height:10px;border-radius:3px;border:1.5px dashed var(--dsw-alias-border-l2)}.dshSwarm_seat[data-filled=true]{border-style:solid}
.dshSwarm_capacityAction{display:grid;gap:3px;justify-items:start}.dshSwarm_capacityAction .dshSwarm_subtle{font-size:11px}.dshSwarm_addButton{display:inline-flex;align-items:center;gap:6px;padding:6px 12px}.dshSwarm_plus{font-size:14px;line-height:1;font-weight:700}.dshSwarm_capacity .dshSwarm_receipt{flex-basis:100%;margin-top:0!important}
.dshSwarm_memberFilters{margin-bottom:14px}.dshSwarm_memberFilter{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 11px}.dshSwarm_filterDot{width:7px;height:7px;border-radius:50%}
.dshSwarm_workers{gap:14px}.dshSwarm_worker{position:relative;display:flex;flex-direction:column;padding:16px 16px 12px;border-radius:12px;border-top:3px solid var(--dsw-alias-border-l2);transition:border-color .2s}.dshSwarm_worker:hover{border-inline-color:var(--dsw-alias-border-l2);border-bottom-color:var(--dsw-alias-border-l2)}
.dshSwarm_workerTop{gap:10px;margin-bottom:14px}.dshSwarm_avatar{width:36px;height:36px;border:0;border-radius:10px;color:var(--dsw-alias-bg-layer-1);font-size:12px;font-weight:700;letter-spacing:.02em}.dshSwarm_workerIdentity{display:grid;min-width:0;line-height:1.3}.dshSwarm_workerName{font-size:14px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshSwarm_workerSub{font-size:10px;color:var(--dsw-alias-label-secondary)}.dshSwarm_workerSub code{font-size:10px}
.dshSwarm_workPill{margin-inline-start:auto;flex:none;display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}.dshSwarm_workPill[data-tone=active]{color:var(--dsw-alias-state-business-primary)}.dshSwarm_workPill[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}.dshSwarm_workPill[data-tone=error]{color:var(--dsw-alias-state-error-primary)}.dshSwarm_workPill[data-tone=info]{color:var(--dsw-alias-state-idle-primary)}
.dshSwarm_pulse{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.55}.dshSwarm_pulse[data-live=true]{opacity:1;animation:dshSwarm_pulse 1.6s ease-out infinite}@keyframes dshSwarm_pulse{0%{box-shadow:0 0 0 0 currentColor}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}
.dshSwarm_workerTask{padding:12px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}.dshSwarm_taskTitle{font-size:15px;min-height:0}.dshSwarm_taskTitle[data-empty=true]{font-weight:500;color:var(--dsw-alias-label-secondary)}
.dshSwarm_execution{border-top:0;padding-top:0;margin-top:12px}.dshSwarm_native{margin-top:auto;padding-top:10px}.dshSwarm_worker .dshSwarm_native{margin-top:12px}
.dshSwarm_goalSummary{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}.dshSwarm_goalSummary .dshSwarm_memberIntro{max-width:62ch}
.dshSwarm_goalProgress{display:grid;gap:6px;min-width:220px}.dshSwarm_goalProgressText{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.dshSwarm_goalProgressText strong{font-size:18px;font-variant-numeric:tabular-nums}
.dshSwarm_meter{display:flex;height:6px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}.dshSwarm_meter span{height:100%}.dshSwarm_meter [data-pool=done]{background:var(--dsw-alias-state-success-primary)}.dshSwarm_meter [data-pool=doing]{background:var(--dsw-alias-state-business-primary)}.dshSwarm_meter [data-pool=todo]{background:var(--dsw-alias-border-l2)}
.dshSwarm_kanban{gap:14px;margin-top:18px}.dshSwarm_lane{padding:12px;border:0;border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.dshSwarm_lane[data-lane]{border-top:0}
.dshSwarm_laneTitle{padding:2px 2px 0}.dshSwarm_poolName{display:inline-flex;align-items:center;gap:7px;font-weight:650}.dshSwarm_laneDot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-secondary)}.dshSwarm_lane[data-lane=doing] .dshSwarm_laneDot{background:var(--dsw-alias-state-business-primary)}.dshSwarm_lane[data-lane=done] .dshSwarm_laneDot{background:var(--dsw-alias-state-success-primary)}.dshSwarm_laneCount{min-width:22px;padding:1px 7px;border-radius:999px;text-align:center;font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.dshSwarm_lane .dshSwarm_goalList{gap:8px;margin-top:10px!important}.dshSwarm_lane .dshSwarm_goalEntry{position:relative;padding:0;border:1px solid var(--dsw-alias-border-l1);border-inline-start:3px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);transition:border-color .2s}.dshSwarm_lane .dshSwarm_goalEntry:hover{border-color:var(--dsw-alias-border-l2)}
.dshSwarm_goalEntry[data-state=active]{border-inline-start-color:var(--dsw-alias-state-business-primary)!important}.dshSwarm_goalEntry[data-state=completed]{border-inline-start-color:var(--dsw-alias-state-success-primary)!important}.dshSwarm_goalEntry[data-state=deferred],.dshSwarm_goalEntry[data-state=continued]{border-inline-start-color:var(--dsw-alias-state-warn-primary)!important}
.dshSwarm_goalEntry summary{display:grid;gap:7px;padding:11px 12px;list-style:none;font-weight:500}.dshSwarm_goalEntry summary::-webkit-details-marker{display:none}.dshSwarm_goalHead{display:flex;align-items:center;justify-content:space-between;gap:8px}.dshSwarm_goalEntry summary .dshSwarm_badge{margin:0}.dshSwarm_goalSeq{font-size:10px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dshSwarm_goalText{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;font-size:13px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}.dshSwarm_goalEntry[open] .dshSwarm_goalText{display:none}.dshSwarm_goalEntry[data-state=completed] .dshSwarm_goalText{color:var(--dsw-alias-label-secondary)}
.dshSwarm_goalFoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10px;color:var(--dsw-alias-label-secondary)}.dshSwarm_goalFoot:empty{display:none}.dshSwarm_goalChip{padding:1px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2)}.dshSwarm_goalFoot code{font-size:10px}
.dshSwarm_goalBody{padding:0 12px 12px}.dshSwarm_goalBody .dshSwarm_goalFull{margin-top:0!important;font-size:13px;font-weight:600}.dshSwarm_goalBody .dshSwarm_taskMeta{margin-top:10px}
.dshSwarm_lane .dshSwarm_composer{padding:12px;border-style:dashed;border-radius:8px}.dshSwarm_lane .dshSwarm_composer .dshSwarm_input{background:var(--dsw-alias-bg-layer-1);min-height:64px}.dshSwarm_laneEmpty{margin-top:10px!important;padding:18px 10px;text-align:center;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px}
.dshSwarm_flowStats{display:flex;gap:8px;flex-wrap:wrap}.dshSwarm_flowStat{display:grid;min-width:76px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_flowStat strong{font-size:18px;line-height:1.2;font-variant-numeric:tabular-nums}.dshSwarm_flowStat span{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshSwarm_flowScroll{max-height:none}.dshSwarm_flowScroll .dshSwarm_laneHeads{width:150px}.dshSwarm_flowTick{font-size:10px;fill:var(--dsw-alias-label-secondary)}.dshSwarm_flowMark{cursor:default}.dshSwarm_flowMark:hover{filter:brightness(1.15)}
.dshSwarm_flowKey{display:inline-block;width:10px;height:10px;border:2px solid var(--dsw-alias-label-secondary);border-radius:50%}.dshSwarm_flowKey[data-k=message]{width:16px;height:4px;border:0;border-radius:2px;background:var(--dsw-alias-label-secondary)}.dshSwarm_flowKey[data-k=finding]{width:9px;height:9px;border-radius:1.5px;transform:rotate(45deg)}.dshSwarm_flowKey[data-k=task]{border-radius:3px}.dshSwarm_flowKey[data-k=proposal]{width:0;height:0;border:0;border-inline:6px solid transparent;border-bottom:10px solid var(--dsw-alias-label-secondary);border-radius:0}.dshSwarm_flowKey[data-k=head]{border-width:3px}
.dshSwarm_flowBottom{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:14px;margin-top:14px}@container(max-width:760px){.dshSwarm_flowBottom{grid-template-columns:1fr}}
.dshSwarm_flowPanel{padding:14px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);min-width:0}.dshSwarm_flowPanelTitle{font-size:12px;font-weight:650;margin-bottom:10px!important}
.dshSwarm_pairs{display:grid;gap:9px}.dshSwarm_pair{display:grid;grid-template-columns:minmax(0,1fr) 72px auto;align-items:center;gap:10px;font-size:12px}.dshSwarm_pairNames{display:flex;align-items:center;gap:5px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshSwarm_pairNames i{flex:none;width:8px;height:8px;border-radius:50%}.dshSwarm_pairArrow{color:var(--dsw-alias-label-secondary)}.dshSwarm_pairBar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.dshSwarm_pairBar span{display:block;height:100%;border-radius:999px}.dshSwarm_pairCount{font-variant-numeric:tabular-nums;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshSwarm_flowFeed{display:grid;gap:2px}.dshSwarm_flowItem{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;padding:5px 6px;border-radius:6px;font-size:12px}.dshSwarm_flowItem:hover{background:var(--dsw-alias-bg-layer-1)}.dshSwarm_flowItem>i{width:8px;height:8px;border-radius:50%}.dshSwarm_flowItem[data-kind=finding]>i{border-radius:1.5px;transform:rotate(45deg)}.dshSwarm_flowItem[data-kind=task]>i{border-radius:2px}.dshSwarm_flowText{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshSwarm_flowItem time{font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
/* Dashboard redesign. */
.dshSwarm_goalBox{position:relative;margin-top:16px;padding:18px 20px 18px 24px;border:0;border-radius:14px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}.dshSwarm_goalBox:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--dsw-alias-state-business-primary)}.dshSwarm_goalBox summary{font-size:11px;letter-spacing:.04em}.dshSwarm_goalBox .dshSwarm_goalPreview{font-size:16px}
.dshSwarm_workflow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin-top:22px!important;border:0;border-radius:0;overflow:visible}
.dshSwarm_step{position:relative;display:grid;align-content:start;gap:9px;padding:0 14px 0 0;border:0!important;background:none!important;box-shadow:none!important}.dshSwarm_step:not(:last-child):after{content:"";position:absolute;top:13px;left:38px;right:6px;height:2px;border-radius:2px;background:var(--dsw-alias-border-l1)}.dshSwarm_step[data-state=complete]:not(:last-child):after{background:var(--dsw-alias-state-success-primary)}
.dshSwarm_stepNode{position:relative;z-index:1;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);font-size:11px;font-weight:700;color:var(--dsw-alias-label-secondary)}.dshSwarm_step[data-state=complete] .dshSwarm_stepNode{border-color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-bg-layer-1)}.dshSwarm_step[data-state=active] .dshSwarm_stepNode{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.dshSwarm_stepNode .dshSwarm_pulse{width:9px;height:9px;opacity:1}
.dshSwarm_stepBody{min-width:0}.dshSwarm_step .dshSwarm_stepName{font-size:13px;font-weight:650}.dshSwarm_step .dshSwarm_stepCount{margin-top:2px}.dshSwarm_stepState{margin-top:3px;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}.dshSwarm_step[data-state=active] .dshSwarm_stepState{color:var(--dsw-alias-state-business-primary)}.dshSwarm_step[data-state=complete] .dshSwarm_stepState{color:var(--dsw-alias-state-success-primary)}
.dshSwarm_kpis{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0 0}.dshSwarm_kpi{padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_kpi dd{display:grid;gap:8px;margin-top:6px}.dshSwarm_kpiValue{font-size:26px;font-weight:650;line-height:1.1;letter-spacing:-.03em}.dshSwarm_kpi .dshSwarm_kpiNote{margin-top:0}
.dshSwarm_kpiBar{display:flex;gap:2px;height:6px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}.dshSwarm_kpiBar span{min-width:4px}.dshSwarm_kpiLegend{display:flex;flex-wrap:wrap;gap:3px 10px;font-size:10px;font-weight:400;letter-spacing:0;color:var(--dsw-alias-label-secondary)}.dshSwarm_kpiLegend i{display:inline-block;width:7px;height:7px;border-radius:2px;margin-inline-end:4px}
.dshSwarm_root [data-seg=done]{background:var(--dsw-alias-state-success-primary)}.dshSwarm_root [data-seg=proposed]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, var(--dsw-alias-bg-layer-1))}.dshSwarm_root [data-seg=claimed]{background:var(--dsw-alias-state-business-primary)}.dshSwarm_root [data-seg=open]{background:var(--dsw-alias-border-l2)}.dshSwarm_root [data-seg=blocked]{background:var(--dsw-alias-state-warn-primary)}.dshSwarm_root [data-seg=cancelled]{background:var(--dsw-alias-label-secondary);opacity:.5}
.dshSwarm_kpiFlag{justify-self:start;padding:1px 7px;border-radius:5px;font-size:10px;font-weight:600;letter-spacing:0;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2)}
.dshSwarm_dashGrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:12px;margin:12px 0 0}.dshSwarm_dashGrid .dshSwarm_delivery{margin:0;padding:16px 18px;border-radius:12px}.dshSwarm_dashGrid .dshSwarm_deliveryRevision>code{font-size:20px}
.dshSwarm_teamCard{min-width:0;padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_teamCard .dshSwarm_deliveryTop{justify-content:space-between}.dshSwarm_teamList{display:grid;gap:2px}.dshSwarm_teamRow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:6px;border-radius:8px}.dshSwarm_teamRow:hover{background:var(--dsw-alias-bg-layer-2)}
.dshSwarm_avatarSmall{width:28px;height:28px;border-radius:8px;font-size:10px}.dshSwarm_teamName{display:grid;min-width:0;line-height:1.35}.dshSwarm_teamName strong{font-size:12px;font-weight:650}.dshSwarm_teamTask{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshSwarm_teamTask[data-empty=true]{color:var(--dsw-alias-label-secondary)}
.dshSwarm_collaboration{gap:12px;margin-top:12px}.dshSwarm_collaboration>.dshSwarm_section{margin-top:0;padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.dshSwarm_timeline{border-inline-start:2px solid var(--dsw-alias-border-l1)}.dshSwarm_event:before{display:none}.dshSwarm_eventDot{position:absolute;inset-inline-start:-20px;top:6px;width:8px;height:8px;border-radius:50%;box-shadow:0 0 0 3px var(--dsw-alias-bg-layer-1)}.dshSwarm_event[data-kind=run] .dshSwarm_eventDot{border-radius:2px}.dshSwarm_event[data-kind=proposal] .dshSwarm_eventDot{border-radius:2px;transform:rotate(45deg)}
@container(max-width:760px){.dshSwarm_dashGrid,.dshSwarm_kpis{grid-template-columns:1fr}.dshSwarm_collaboration{gap:12px}}@container(max-width:620px){.dshSwarm_workflow{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:18px}.dshSwarm_step:nth-child(2):after{display:none}}
.dshSwarm_conv{margin-top:28px}.dshSwarm_convDivider{width:1px;align-self:stretch;margin:2px 4px;background:var(--dsw-alias-border-l1)}
.dshSwarm_convList{display:grid;gap:10px}.dshSwarm_convItem{padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-inline-start:3px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dshSwarm_convItem[data-kind=finding]{background:var(--dsw-alias-bg-layer-2)}.dshSwarm_convItem[data-finding=fail]{box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent)}
.dshSwarm_convHead{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px}.dshSwarm_convWho{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;font-size:12px;font-weight:600}.dshSwarm_convPerson{display:inline-flex;align-items:center;gap:5px}.dshSwarm_convPerson i{width:7px;height:7px;border-radius:50%}
.dshSwarm_convTag{padding:1px 7px;border-radius:5px;font-size:10px;font-weight:650;color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-1)}.dshSwarm_convTag[data-finding=fact]{color:var(--dsw-alias-state-success-primary)}.dshSwarm_convTag[data-finding=fail]{color:var(--dsw-alias-state-error-primary)}.dshSwarm_convTag[data-finding=patch_summary]{color:var(--dsw-alias-state-warn-primary)}
.dshSwarm_convMeta{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.dshSwarm_convMeta code{font-size:10px}
.dshSwarm_convBody{margin:9px 0 0 38px!important;font-size:13px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.dshSwarm_convItem>.dshSwarm_subtle{margin-inline-start:38px!important}
.dshSwarm_convRefs{display:flex;flex-wrap:wrap;gap:5px;margin:9px 0 0 38px}.dshSwarm_convRef{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 7px;border-radius:5px;font-size:10px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}.dshSwarm_convRef code{font-size:10px;color:var(--dsw-alias-label-primary)}
.dshSwarm_flowStage{position:relative}.dshSwarm_flowHit{fill:transparent;pointer-events:all}.dshSwarm_flowMark{cursor:pointer;outline:none}.dshSwarm_flowMark:focus-visible .dshSwarm_flowHit,.dshSwarm_flowMark[data-active=true] .dshSwarm_flowHit{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-state-business-primary);stroke-width:1.5}
.dshSwarm_hoverCard{position:absolute;z-index:5;display:grid;gap:8px;max-height:min(420px,70vh);overflow:auto;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-top:3px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 32px -12px color-mix(in srgb, var(--dsw-alias-label-primary) 35%, transparent);pointer-events:none;transform:translateY(-14px)}
.dshSwarm_hoverCard[data-above=true]{transform:translateY(calc(-100% + 14px))}.dshSwarm_hoverCard[data-pinned=true]{pointer-events:auto}
.dshSwarm_hoverHead{display:flex;align-items:center;gap:8px}.dshSwarm_hoverHead .dshSwarm_convTag{background:var(--dsw-alias-bg-layer-2)}.dshSwarm_hoverHead .dshSwarm_convMeta{margin-inline-start:auto}.dshSwarm_hoverClose{font:inherit;font-size:15px;line-height:1;padding:0 4px;border:0;border-radius:4px;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer}.dshSwarm_hoverClose:hover{background:var(--dsw-alias-bg-layer-2)}
.dshSwarm_hoverTitle{font-size:12px;font-weight:650}.dshSwarm_hoverBody{margin:0!important;font-size:13px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.dshSwarm_hoverRefs{margin:0}.dshSwarm_hoverHint{font-size:10px;color:var(--dsw-alias-label-secondary)}
@media(prefers-reduced-motion:reduce){.dshSwarm_root *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
		const worktreeCss = `.dshSwarm_wtHead{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-bottom:10px}.dshSwarm_wtTitle{font-size:14px;line-height:20px;font-weight:600}.dshSwarm_wtRepo{color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;overflow-wrap:anywhere}.dshSwarm_wtList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}.dshSwarm_wtItem{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px}.dshSwarm_wtTop{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px}.dshSwarm_wtPath{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:600;overflow-wrap:anywhere}.dshSwarm_wtBadge{border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);padding:1px 6px;font-size:11px}.dshSwarm_wtBranch{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}.dshSwarm_wtMeta{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:4px}.dshSwarm_wtSubject{overflow-wrap:anywhere;margin-top:4px}.dshSwarm_wtCommits{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:2px}.dshSwarm_wtCommit{display:flex;gap:8px;font-size:11px;min-width:0}.dshSwarm_wtSha{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary);flex:none}.dshSwarm_wtNote{border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;margin-bottom:10px;color:var(--dsw-alias-label-secondary)}.dshSwarm_form{border-top:1px solid var(--dsw-alias-border-l1);margin-top:14px;padding-top:10px;display:flex;flex-direction:column;gap:8px}.dshSwarm_formRow{display:flex;flex-wrap:wrap;gap:10px}.dshSwarm_field{display:flex;flex-direction:column;gap:3px;flex:1;min-width:160px}.dshSwarm_label{font-size:11px;color:var(--dsw-alias-label-secondary)}.dshSwarm_input{box-sizing:border-box;width:100%;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}.dshSwarm_success{color:var(--dsw-alias-state-success-primary);overflow-wrap:anywhere}`;
		const zh = {
			"view.label": "◈ 协作群", "title": "Swarm 协作群",
			"tabs.flow": "协作流", "flow.title": "成员之间在做什么", "flow.note": "每条泳道是一名成员，最上方是 Host 与已接受结果；事件按发生顺序从左到右。鼠标移到任意节点上即可看到发生了什么，私信和发现会显示正文；点击可固定卡片。", "flow.host": "Host · 结果", "flow.hostNote": "集成与验收", "flow.filter": "按事件类型筛选", "flow.chart": "成员协作时间线", "flow.axis": "← 更早 · 最新 →", "flow.empty": "还没有成员之间的协作事件", "flow.unavailable": "当前 Host 未提供协作事件；重启 DSH 后可用", "flow.kind.all": "全部", "flow.kind.message": "私信", "flow.kind.finding": "发现", "flow.kind.task": "任务", "flow.kind.proposal": "提交与集成", "flow.legend.head": "结果推进", "flow.stat.message": "条私信", "flow.stat.finding": "条发现", "flow.stat.proposal": "次提交", "flow.stat.head": "次结果推进", "flow.pairs": "谁在和谁沟通", "flow.noPairs": "还没有成员互发私信", "flow.to": "发给", "flow.feed": "最近动态", "flow.say.message": "{actor} 给 {peer} 发了私信", "flow.say.finding": "{actor} 发布了{kind}", "flow.say.task": "{peer} 的任务「{task}」→ {status}", "flow.say.proposal": "{actor} 的提案（{task}）→ {status}", "flow.say.head": "{peer} 的结果已合入 {id}", "flow.say.headHost": "结果推进到 {id}", "flow.finding.observed": "观察", "flow.finding.fact": "事实", "flow.finding.fail": "失败报告", "flow.finding.patch_summary": "改动摘要", "dash.team": "团队现状", "dash.teamNote": "{busy} 执行中 · {waiting} 等待", "dash.noWorkers": "还没有成员", "conv.title": "成员对话与发现", "conv.note": "仅 run owner 可读：成员之间私信的正文，以及发布的事实、观察、失败报告和改动摘要（含范围与证据）。最新在前，有新消息时自动刷新。", "conv.refresh": "刷新", "conv.filter": "按类型和成员筛选", "conv.kind.all": "全部", "conv.kind.message": "私信", "conv.kind.finding": "发现", "conv.empty": "还没有私信或发现", "conv.noMatch": "已加载内容中没有匹配项", "conv.loading": "正在读取…", "conv.more": "加载更早的内容", "conv.end": "已加载全部 {count} 条", "conv.failed": "读取失败", "conv.invalid": "Host 返回了无法识别的对话数据", "conv.unavailable": "当前 Host 不提供对话读取；重启 DSH 后可用", "conv.truncated": "正文过长，已截断显示", "conv.task": "任务", "conv.scope": "范围", "conv.evidence": "证据", "conv.supersedes": "取代", "hover.pin": "点击固定卡片 · Esc 关闭", "hover.close": "关闭", "hover.noBody": "当前 Host 不提供正文；重启 DSH 后可在这里看到内容", "hover.failed": "正文读取失败，见下方“成员对话与发现”", "tabs.label": "协作视图", "tabs.dashboard": "Dashboard", "tabs.members": "成员列表", "tabs.goals": "目标看板", "tabs.worktrees": "Git 工作树",
			"goals.todo": "代办", "goals.doing": "办理中", "goals.done": "办结", "goals.wish": "添加新的愿望", "goals.laneEmpty": "此池暂无目标", "goals.flowNote": "愿望提交后自动加入本轮办理；暂停时保留目标，收尾后存入代办等待下一轮。办结仅代表 Host 已完成验收。",
			"workers.add": "添加成员", "workers.adding": "正在添加…", "workers.addUnavailable": "当前 Host 不支持添加成员", "workers.addLimit": "已达到 {count} 名成员上限", "workers.addPhase": "仅协作中或暂停时可添加成员", "workers.addPaused": "新成员将在恢复后启动", "workers.added.started": "已添加 {name}", "workers.added.paused": "已添加 {name} · 恢复后启动", "workers.addFailed": "添加结果未确认，请检查成员列表后重试", "workers.addReceipt": "成员回执不完整，请检查列表后再重试。", "workers.addReady": "为新成员创建独立工作树与随机可读名字", "workers.capacity": "团队规模", "workers.summary": "{total} 名成员 · {busy} 名执行中 · {waiting} 名等待协作或集成", "goals.criteriaCount": "{count} 条验收", "goals.doneCount": "个目标已办结",
			"git.title": "Git 工作树", "git.note": "各成员工作树与已接受结果的合并历史流 · 同一提交只显示一次。来源分支表示可达关系，不代表作者。", "git.refresh": "更新历史", "git.loading": "正在读取 Git 历史…", "git.more": "加载更早提交", "git.end": "已到达历史起点", "git.empty": "当前没有可显示的提交。", "git.unavailable": "当前 Host 不支持工作树历史，请更新 Host 后重连。", "git.failed": "Git 历史读取失败", "git.retry": "重试", "git.loaded": "已显示 {count} 个提交", "git.worktrees": "工作树与版本快照", "git.result": "已接受结果", "git.source": "来源分支", "git.merge": "合并提交", "git.parents": "父提交", "git.commit": "完整提交 SHA", "git.details": "提交详情", "git.snapshot": "分页固定于首次读取的版本；更新历史可查看最新提交。", "git.missingRun": "运行已变化或不可用，请重新连接。", "git.invalid": "Host 返回了无效的 Git 历史。", "git.worktreeMissing": "工作树尚未准备完成", "git.base": "Run 基线", "git.legendCommit": "提交", "git.legendMerge": "合并（换乘站）", "git.legendHead": "工作树当前 HEAD", "git.axis": "← 最新 · 更早 →",
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
			"verification.summary": "排队 {queued} · 执行 {running} · 通过 {passed} · 失败 {failed} · 中断 {interrupted}", "proposal.summary": "排队 {queued} · 集成 {integrating} · 接受 {accepted} · 拒绝 {rejected}",
			"wt.title": "Git 工作树", "wt.loading": "正在读取工作树…", "wt.error": "读取工作树失败：{message}", "wt.unavailable": "工作树连接失败：{message}", "wt.repo": "仓库：{name}", "wt.directory": "会话目录：{directory}", "wt.notRepo": "当前会话目录不是 Git 仓库", "wt.notRepoBody": "读取 {directory} 所在的仓库；初始化 Git 仓库后刷新即可。", "wt.unborn": "仓库还没有提交", "wt.unbornBody": "还没有可显示的工作树提交记录；先创建第一个提交，再刷新。", "wt.empty": "没有已登记的工作树", "wt.emptyBody": "git worktree list 没有返回任何工作树。", "wt.main": "主工作树", "wt.detached": "分离 HEAD @ {sha}", "wt.head": "HEAD {sha}", "wt.noHead": "尚无提交", "wt.locked": "已锁定：{reason}", "wt.prunable": "已失效：{reason}", "wt.commits": "最近提交", "wt.noCommits": "没有额外提交", "wt.limit": "仅显示最近 {count} 条", "wt.refresh": "刷新", "wt.create.title": "新建工作树", "wt.create.hint": "在会话仓库的 .agents/worktrees/ 下创建独立分支和检出；不会切换当前会话的工作目录，也不会改动当前检出。", "wt.create.name": "名称（可选）", "wt.create.namePlaceholder": "自动生成，例如 worktree-20260101-120000", "wt.create.base": "基准 ref（可选）", "wt.create.basePlaceholder": "HEAD", "wt.create.submit": "创建工作树", "wt.create.pending": "正在创建…", "wt.create.success": "已创建工作树 {name}", "wt.create.error": "创建失败：{message}"
		};
		const en = {
			"view.label": "◈ Swarm", "title": "Swarm",
			"tabs.flow": "Collaboration flow", "flow.title": "What members are doing together", "flow.note": "Each swimlane is a member; the top lane is the Host and accepted result. Events run left to right in order. Hover any point to see what happened, including message and finding bodies; click to pin the card.", "flow.host": "Host · result", "flow.hostNote": "Integration and acceptance", "flow.filter": "Filter by event type", "flow.chart": "Member collaboration timeline", "flow.axis": "← Older · Newest →", "flow.empty": "No collaboration events between members yet", "flow.unavailable": "This Host does not provide collaboration events; restart DSH to enable it", "flow.kind.all": "All", "flow.kind.message": "Messages", "flow.kind.finding": "Findings", "flow.kind.task": "Tasks", "flow.kind.proposal": "Proposals & integration", "flow.legend.head": "Result advanced", "flow.stat.message": "messages", "flow.stat.finding": "findings", "flow.stat.proposal": "proposals", "flow.stat.head": "result advances", "flow.pairs": "Who talks to whom", "flow.noPairs": "No direct messages between members yet", "flow.to": "to", "flow.feed": "Latest activity", "flow.say.message": "{actor} messaged {peer}", "flow.say.finding": "{actor} posted a {kind}", "flow.say.task": "{peer}'s task “{task}” → {status}", "flow.say.proposal": "{actor}'s proposal ({task}) → {status}", "flow.say.head": "{peer}'s result merged at {id}", "flow.say.headHost": "Result advanced to {id}", "flow.finding.observed": "observation", "flow.finding.fact": "fact", "flow.finding.fail": "failure report", "flow.finding.patch_summary": "patch summary", "dash.team": "Team now", "dash.teamNote": "{busy} executing · {waiting} waiting", "dash.noWorkers": "No members yet", "conv.title": "Conversations and findings", "conv.note": "Run owner only: the bodies of members' direct messages and their published facts, observations, failure reports and patch summaries, with scope and evidence. Newest first; refreshes when new ones arrive.", "conv.refresh": "Refresh", "conv.filter": "Filter by type and member", "conv.kind.all": "All", "conv.kind.message": "Messages", "conv.kind.finding": "Findings", "conv.empty": "No messages or findings yet", "conv.noMatch": "Nothing loaded matches this filter", "conv.loading": "Loading…", "conv.more": "Load older", "conv.end": "All {count} loaded", "conv.failed": "Could not load", "conv.invalid": "The Host returned conversation data this panel cannot read", "conv.unavailable": "This Host cannot serve conversations; restart DSH to enable it", "conv.truncated": "Body is long and shown truncated", "conv.task": "Task", "conv.scope": "Scope", "conv.evidence": "Evidence", "conv.supersedes": "Supersedes", "hover.pin": "Click to pin · Esc to close", "hover.close": "Close", "hover.noBody": "This Host does not serve bodies; restart DSH to see the content here", "hover.failed": "Could not load the body; see “Conversations and findings” below", "tabs.label": "Collaboration views", "tabs.dashboard": "Dashboard", "tabs.members": "Members", "tabs.goals": "Goal board", "tabs.worktrees": "Git worktrees",
			"goals.todo": "To do", "goals.doing": "In progress", "goals.done": "Done", "goals.wish": "Add a wish", "goals.laneEmpty": "No goals in this pool", "goals.flowNote": "Submitted wishes join this round automatically. Paused goals stay in this round; closing runs save new wishes for the next round. Only Host-verified goals are done.",
			"workers.add": "Add worker", "workers.adding": "Adding…", "workers.addUnavailable": "This Host cannot add workers", "workers.addLimit": "Maximum of {count} workers reached", "workers.addPhase": "Workers can be added while running or paused", "workers.addPaused": "New workers start after resume", "workers.added.started": "Added {name}", "workers.added.paused": "Added {name} · Starts after resume", "workers.addFailed": "Addition not confirmed; check the member list before retrying", "workers.addReceipt": "Incomplete worker receipt. Check the list before retrying.", "workers.addReady": "Create a private worktree and a random readable name", "workers.capacity": "Team size", "workers.summary": "{total} members · {busy} executing · {waiting} waiting on collaboration or integration", "goals.criteriaCount": "{count} criteria", "goals.doneCount": "goals done",
			"git.title": "Git worktrees", "git.note": "Merged history of worker worktrees and accepted results · Each commit appears once. Source branch means reachability, not authorship.", "git.refresh": "Refresh history", "git.loading": "Reading Git history…", "git.more": "Load earlier commits", "git.end": "Beginning of history reached", "git.empty": "No commits to display yet.", "git.unavailable": "This Host does not support worktree history. Update the Host and reconnect.", "git.failed": "Could not read Git history", "git.retry": "Retry", "git.loaded": "Showing {count} commits", "git.worktrees": "Worktrees & revision snapshot", "git.result": "Accepted result", "git.source": "Source branch", "git.merge": "Merge commit", "git.parents": "Parent commits", "git.commit": "Full commit SHA", "git.details": "Commit details", "git.snapshot": "Pages are pinned to the first read. Refresh history to see newer commits.", "git.missingRun": "The run changed or is unavailable. Reconnect to update.", "git.invalid": "Host returned invalid Git history.", "git.worktreeMissing": "Worktree is not ready yet", "git.base": "Run base", "git.legendCommit": "Commit", "git.legendMerge": "Merge (interchange)", "git.legendHead": "Worktree HEAD", "git.axis": "← Newest · Older →",
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
			"verification.summary": "Queued {queued} · running {running} · passed {passed} · failed {failed} · interrupted {interrupted}", "proposal.summary": "Queued {queued} · integrating {integrating} · accepted {accepted} · rejected {rejected}",
			"wt.title": "Git worktrees", "wt.loading": "Reading worktrees…", "wt.error": "Failed to read worktrees: {message}", "wt.unavailable": "Could not connect to worktrees: {message}", "wt.repo": "Repository: {name}", "wt.directory": "Session directory: {directory}", "wt.notRepo": "The session directory is not a Git repository", "wt.notRepoBody": "This view reads the repository containing {directory}; initialize Git, then refresh.", "wt.unborn": "The repository has no commits yet", "wt.unbornBody": "There are no worktree commit records to show yet; create the first commit, then refresh.", "wt.empty": "No registered worktrees", "wt.emptyBody": "git worktree list returned no worktrees.", "wt.main": "main worktree", "wt.detached": "detached HEAD @ {sha}", "wt.head": "HEAD {sha}", "wt.noHead": "no commits yet", "wt.locked": "locked: {reason}", "wt.prunable": "prunable: {reason}", "wt.commits": "Recent commits", "wt.noCommits": "No extra commits", "wt.limit": "Showing the latest {count}", "wt.refresh": "Refresh", "wt.create.title": "New worktree", "wt.create.hint": "Creates a branch and checkout under the session repository's .agents/worktrees/; it never changes this session's working directory or the current checkout.", "wt.create.name": "Name (optional)", "wt.create.namePlaceholder": "Generated, e.g. worktree-20260101-120000", "wt.create.base": "Base ref (optional)", "wt.create.basePlaceholder": "HEAD", "wt.create.submit": "Create worktree", "wt.create.pending": "Creating…", "wt.create.success": "Created worktree {name}", "wt.create.error": "Create failed: {message}"
		};

		Object.assign(zh, {
			"tabs.public": "公共讨论", "public.title": "公共频道与线程", "public.note": "同一运行的所有成员均可阅读；订阅只影响通知。此只读视图不发布 owner 新需求，也不替成员确认已读、回应或同意。",
			"public.channels": "频道", "public.threads": "线程", "public.messages": "消息", "public.requests": "回应请求", "public.agreements": "当前约定", "public.attention": "待关注", "public.activity": "线程动态", "public.message_revisions": "消息修订", "public.agreement_versions": "约定版本",
			"public.allChannels": "全部频道", "public.allWorkers": "所有成员", "public.search": "搜索正文或标题", "public.taskFilter": "关联任务 ID（可选）", "public.workerFilter": "请求对象 / 通知接收者", "public.apply": "搜索", "public.clear": "清除筛选", "public.back": "返回线程", "public.openThread": "查看线程", "public.locate": "定位消息", "public.previous": "上一页", "public.next": "下一页", "public.page": "第 {page} 页 · 共 {total} 条", "public.truncated": "当前仅显示有界分页；继续翻页查看其余记录。", "public.empty": "此范围没有记录", "public.loading": "正在读取公共历史…", "public.failed": "读取失败", "public.invalid": "Host 返回了无效的公共记录", "public.unavailable": "当前 Host 不提供公共频道协议，请更新 Host 后重连。",
			"public.status.active": "可讨论", "public.status.archived": "已归档 · 历史可查", "public.status.open": "未解决", "public.status.resolved": "已解决", "public.status.pending": "待回应", "public.status.responded": "已回应", "public.status.withdrawn": "已撤回", "public.reply": "回复来源", "public.mentions": "提及", "public.author": "发起者", "public.participants": "参与者", "public.tasks": "任务", "public.findings": "发现", "public.proposals": "成果提案", "public.conclusion": "结论", "public.revision": "修订 {version}", "public.history": "查看修订历史", "public.version": "版本 {version}", "public.stakeholders": "相关方", "public.confirmed": "已明确确认此版本", "public.unconfirmed": "尚未确认此版本", "public.source": "来源讨论", "public.requestedBy": "请求者", "public.requestedFrom": "待回应对象", "public.response": "回应消息", "public.delivered": "通知已送达", "public.notDelivered": "通知未送达", "public.acknowledged": "通知已确认（不代表回应）", "public.notAcknowledged": "通知未确认", "public.announcement": "全局公告", "public.refresh": "刷新当前范围", "public.newActivity": "有新的公共动态。当前分页保持不变；刷新可读取最新记录。",
			"public.reason.mention": "提及", "public.reason.response_request": "明确回应请求", "public.reason.reply": "收到回复", "public.reason.task_owner": "负责任务", "public.reason.participant": "参与线程", "public.reason.subscription": "订阅更新", "public.reason.announcement": "全局公告", "public.reason.agreement_confirmation": "约定需确认"
		});
		Object.assign(en, {
			"tabs.public": "Public discussion", "public.title": "Public channels & threads", "public.note": "All run members can read this history; subscriptions only affect notifications. This read-only view does not add owner requirements, acknowledge worker reads, respond or consent for anyone.",
			"public.channels": "Channels", "public.threads": "Threads", "public.messages": "Messages", "public.requests": "Response requests", "public.agreements": "Current agreements", "public.attention": "Attention", "public.activity": "Thread activity", "public.message_revisions": "Message revisions", "public.agreement_versions": "Agreement versions",
			"public.allChannels": "All channels", "public.allWorkers": "All members", "public.search": "Search text or title", "public.taskFilter": "Linked task ID (optional)", "public.workerFilter": "Request target / notification recipient", "public.apply": "Search", "public.clear": "Clear filters", "public.back": "Back to thread", "public.openThread": "Open thread", "public.locate": "Locate message", "public.previous": "Previous page", "public.next": "Next page", "public.page": "Page {page} · {total} records", "public.truncated": "This is a bounded page; continue paging to read remaining records.", "public.empty": "No records in this scope", "public.loading": "Reading public history…", "public.failed": "Read failed", "public.invalid": "Host returned invalid public records", "public.unavailable": "This Host does not provide the public channel protocol. Update the Host and reconnect.",
			"public.status.active": "Active", "public.status.archived": "Archived · history retained", "public.status.open": "Open", "public.status.resolved": "Resolved", "public.status.pending": "Awaiting response", "public.status.responded": "Responded", "public.status.withdrawn": "Withdrawn", "public.reply": "Reply source", "public.mentions": "Mentions", "public.author": "Creator", "public.participants": "Participants", "public.tasks": "Tasks", "public.findings": "Findings", "public.proposals": "Proposals", "public.conclusion": "Conclusion", "public.revision": "Revision {version}", "public.history": "Revision history", "public.version": "Version {version}", "public.stakeholders": "Stakeholders", "public.confirmed": "Explicitly confirmed this version", "public.unconfirmed": "Not confirmed for this version", "public.source": "Source discussion", "public.requestedBy": "Requested by", "public.requestedFrom": "Response requested from", "public.response": "Response message", "public.delivered": "Notification delivered", "public.notDelivered": "Notification not delivered", "public.acknowledged": "Notification acknowledged (not a response)", "public.notAcknowledged": "Notification not acknowledged", "public.announcement": "Global announcement", "public.refresh": "Refresh this scope", "public.newActivity": "New public activity is available. This page stays pinned; refresh to read the latest records.",
			"public.reason.mention": "Mention", "public.reason.response_request": "Explicit response request", "public.reason.reply": "Reply received", "public.reason.task_owner": "Task ownership", "public.reason.participant": "Thread participant", "public.reason.subscription": "Subscription", "public.reason.announcement": "Global announcement", "public.reason.agreement_confirmation": "Agreement confirmation requested"
		});
		const publicCss = `.dshSwarm_publicLayout{display:grid;grid-template-columns:minmax(160px,220px) minmax(0,1fr);gap:16px;margin-top:16px}.dshSwarm_publicChannels{border-inline-end:1px solid var(--dsw-alias-border-l1);padding-inline-end:14px}.dshSwarm_publicChannels button{width:100%;text-align:start;margin:4px 0}.dshSwarm_publicChannels button[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.dshSwarm_publicCard{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-1)}.dshSwarm_publicCard h3{font-size:14px}.dshSwarm_publicBody{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px!important}.dshSwarm_publicCards{display:grid;gap:10px}.dshSwarm_publicFilters{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}.dshSwarm_publicFilters label{display:grid;gap:4px;flex:1;min-width:140px;font-size:11px;color:var(--dsw-alias-label-secondary)}.dshSwarm_publicFilters input,.dshSwarm_publicFilters select{font:inherit;padding:7px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;min-width:0}.dshSwarm_publicFilters :is(input,select):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dshSwarm_publicRefs{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.dshSwarm_publicRefs button{max-width:100%;overflow-wrap:anywhere;font-size:10px}.dshSwarm_publicStatus{margin-top:8px!important;color:var(--dsw-alias-label-secondary);font-size:11px}@container(max-width:620px){.dshSwarm_publicLayout{grid-template-columns:1fr}.dshSwarm_publicChannels{border-inline-end:0;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:12px}}`;

		const stringCodec = Object.freeze({ mode: "strict", typeSymbol: "string", create: () => ({ parse(value) { if (typeof value !== "string") throw new TypeError("Session id must be a string"); return value; } }), jsonSchema: { type: "string" } });
		const unknownCodec = Object.freeze({ mode: "strict", typeSymbol: "unknown", create: () => ({ parse: (value) => value }), jsonSchema: {} });
		const SESSION_PARAMETER = Object.freeze({ name: "sessionId", wire: "sessionId", source: "json", codec: stringCodec });
		const cursorCodec = Object.freeze({ mode: "strict", typeSymbol: "string | null", create: () => ({ parse(value) { if (value !== null && typeof value !== "string") throw new TypeError("History cursor must be a string or null"); return value; } }), jsonSchema: { anyOf: [{ type: "string" }, { type: "null" }] } });
		const worktreeRequestCodec = Object.freeze({ mode: "strict", typeSymbol: "WorktreeCreateRequest", create: () => ({ parse(value) { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Worktree request must be an object"); const request = {}; if (value.name !== undefined) { if (typeof value.name !== "string") throw new TypeError("Worktree name must be a string"); request.name = value.name; } if (value.base !== undefined) { if (typeof value.base !== "string") throw new TypeError("Worktree base must be a string"); request.base = value.base; } return request; } }), jsonSchema: { type: "object" } });
		const seqCodec = Object.freeze({ mode: "strict", typeSymbol: "number | null", create: () => ({ parse(value) { if (value !== null && !(Number.isSafeInteger(value) && value > 0)) throw new TypeError("beforeSeq must be a positive integer or null"); return value; } }), jsonSchema: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] } });
		const publicQueryCodec = Object.freeze({ mode: "strict", typeSymbol: "PublicQuery", create: () => ({ parse: publicQueryInput }), jsonSchema: { type: "object" } });
		const WORKTREE_REQUEST_PARAMETER = Object.freeze({ name: "request", wire: "request", source: "json", codec: worktreeRequestCodec });
		const REMOTE_CONTRIBUTION = Object.freeze({
			package: "@local/dsh-swarm",
			descriptors: Object.freeze(["snapshot", "watch", "watchSession"].map((method) => Object.freeze({
				id: "@local/dsh-swarm#swarmProgress/" + method, service: "swarmProgress", namespace: "swarmProgress", method,
				invocation: Object.freeze({ kind: "direct" }), parameters: Object.freeze([SESSION_PARAMETER]), result: unknownCodec,
				...(method === "snapshot" ? {} : { mode: "stream", cancellation: Object.freeze({ parameter: "signal" }) })
			})).concat(Object.freeze({
				id: "@local/dsh-swarm#swarmProgress/worktreeHistory", service: "swarmProgress", namespace: "swarmProgress", method: "worktreeHistory",
				invocation: Object.freeze({ kind: "direct" }), parameters: Object.freeze([SESSION_PARAMETER, Object.freeze({ name: "cursor", wire: "cursor", source: "json", codec: cursorCodec })]),
				result: unknownCodec, cancellation: Object.freeze({ parameter: "signal" })
			}), Object.freeze({
				id: "@local/dsh-swarm#swarmProgress/conversation", service: "swarmProgress", namespace: "swarmProgress", method: "conversation",
				invocation: Object.freeze({ kind: "direct" }), parameters: Object.freeze([SESSION_PARAMETER, Object.freeze({ name: "beforeSeq", wire: "beforeSeq", source: "json", codec: seqCodec })]),
				result: unknownCodec
			}), Object.freeze({
				id: "@local/dsh-swarm#swarmProgress/publicDiscussion", service: "swarmProgress", namespace: "swarmProgress", method: "publicDiscussion",
				invocation: Object.freeze({ kind: "direct" }), parameters: Object.freeze([SESSION_PARAMETER,
					Object.freeze({ name: "runId", wire: "runId", source: "json", codec: stringCodec }),
					Object.freeze({ name: "query", wire: "query", source: "json", codec: publicQueryCodec })]), result: unknownCodec, cancellation: Object.freeze({ parameter: "signal" })
			}), Object.freeze({
				id: "@local/dsh-swarm#swarmWorktrees/list", service: "swarmWorktrees", namespace: "swarmWorktrees", method: "list",
				invocation: Object.freeze({ kind: "direct" }), parameters: Object.freeze([SESSION_PARAMETER]), result: unknownCodec
			}), Object.freeze({
				id: "@local/dsh-swarm#swarmWorktrees/create", service: "swarmWorktrees", namespace: "swarmWorktrees", method: "create",
				invocation: Object.freeze({ kind: "direct" }), parameters: Object.freeze([SESSION_PARAMETER, WORKTREE_REQUEST_PARAMETER]), result: unknownCodec
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
			if (p.protocolVersion >= 2 && ((p.workerControls != null && (!object(p.workerControls) || typeof p.workerControls.canAdd !== "boolean" || !count(p.workerControls.maxWorkers)))
				|| p.workers.some((worker) => worker.displayName !== undefined && typeof worker.displayName !== "string"))) throw new TypeError("Invalid Swarm worker controls");
			if (p.protocolVersion >= 2 && p.interactions !== undefined && (!Array.isArray(p.interactions) || !p.interactions.every(interactionValid))) throw new TypeError("Invalid Swarm interactions");
			if (p.protocolVersion >= 2 && p.publicActivity != null && (!object(p.publicActivity) || p.publicActivity.protocolVersion !== 1 || !countsValid(p.publicActivity, ["latestSeq", "channels", "threads", "pendingRequests", "agreements"]))) throw new TypeError("Invalid Swarm public activity");
			if (!(p.protocolVersion >= 2)) {
				// A v1 Host has no contract for v2 additions; do not render unchecked extras.
				return { ...p, publicActivity: null, goal: null, goalBoard: null, acceptanceCriteria: undefined, originalGoalTruncated: false, createdAt: null, taskBoard: undefined, recentEvents: undefined, interactions: undefined, workerControls: undefined, workers: p.workers.map((w) => ({ ...w, displayName: undefined, activity: undefined, wait: null, currentProposal: null })) };
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
		function workerName(t, worker, number) { return typeof worker?.displayName === "string" && worker.displayName.trim() ? worker.displayName : t("worker.name", { number }); }
		function addWorkerState(progress, connected) {
			if (!progress.workerControls) return "unavailable";
			if (!connected) return "disconnected";
			if (progress.workers.length >= progress.workerControls.maxWorkers) return "limit";
			if (!["running", "paused"].includes(progress.phase) || !progress.workerControls.canAdd) return "phase";
			return "ready";
		}
		function workerReceipt(text, runId) {
			const parsed = JSON.parse(text);
			if (!object(parsed) || parsed.runId !== runId || typeof parsed.workerId !== "string" || !parsed.workerId || typeof parsed.displayName !== "string" || !parsed.displayName.trim() || !["started", "paused"].includes(parsed.disposition)) throw new Error("Invalid worker receipt");
			return parsed;
		}
		/** Member identity color; same roster order and palette as the Git worktree tracks. */
		function workerColor(index) { return TRACK_COLORS[index % TRACK_COLORS.length]; }
		function initials(name) {
			const words = String(name).trim().split(/\s+/u).filter(Boolean);
			return (words.length > 1 ? words[0][0] + words[1][0] : String(name).trim().slice(0, 2)).toUpperCase();
		}
		/** Status pill tone for one derived work state. */
		function workTone(work) { return work === "failed" ? "error" : ["waiting", "integration", "unavailable"].includes(work) ? "warn" : work === "integrating" || work === "assigned" ? "active" : work === "initializing" ? "info" : "idle"; }
		function AddWorkerControl({ t, progress, connected, sessionId, executeCommand }) {
			const [pending, setPending] = React.useState(false);
			const [receipt, setReceipt] = React.useState(null);
			const request = React.useRef(null);
			React.useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
			const availability = addWorkerState(progress, connected);
			const add = async () => {
				if (request.current || availability !== "ready" || typeof executeCommand !== "function") return;
				const controller = new AbortController(); request.current = controller; setPending(true); setReceipt(null);
				try {
					const text = await executeGoalCommand(executeCommand, sessionId, "/swarm worker add --json", controller.signal);
					if (controller.signal.aborted) return;
					let parsed; try { parsed = workerReceipt(text, progress.runId); } catch { throw new Error(t("workers.addReceipt", {})); }
					setReceipt({ ok: true, text: t("workers.added." + parsed.disposition, { name: parsed.displayName }) });
				} catch (error) {
					if (!controller.signal.aborted) setReceipt({ ok: false, text: error instanceof Error ? error.message : String(error) });
				} finally {
					if (request.current === controller) { request.current = null; if (!controller.signal.aborted) setPending(false); }
				}
			};
			const note = availability === "disconnected" ? "stale.title" : availability === "unavailable" ? "workers.addUnavailable" : availability === "limit" ? "workers.addLimit" : availability === "phase" ? "workers.addPhase" : progress.phase === "paused" ? "workers.addPaused" : "workers.addReady";
			const max = Math.max(progress.workerControls?.maxWorkers ?? 0, progress.workers.length);
			// Seats make the remaining mid-run capacity visible before anyone clicks.
			const seats = Array.from({ length: max }, (_, index) => {
				const worker = progress.workers[index];
				return h("span", { key: index, className: "dshSwarm_seat", "data-filled": !!worker, title: worker ? workerName(t, worker, index + 1) : undefined, style: worker ? { background: workerColor(index), borderColor: workerColor(index) } : undefined });
			});
			return h("div", { className: "dshSwarm_capacity" },
				h("div", { className: "dshSwarm_capacityInfo" },
					h("span", { className: "dshSwarm_capacityLabel" }, t("workers.capacity", {})),
					h("span", { className: "dshSwarm_capacityCount" }, h("strong", {}, String(progress.workers.length)), max ? " / " + max : ""),
					max ? h("span", { className: "dshSwarm_seats", "aria-hidden": true }, seats) : null),
				h("div", { className: "dshSwarm_capacityAction" },
					h("button", { type: "button", className: "dshSwarm_button dshSwarm_primary dshSwarm_addButton", disabled: pending || availability !== "ready" || typeof executeCommand !== "function", onClick: () => void add() }, h("span", { "aria-hidden": true, className: "dshSwarm_plus" }, "+"), t(pending ? "workers.adding" : "workers.add", {})),
					h("span", { className: "dshSwarm_subtle" }, t(note, { count: progress.workerControls?.maxWorkers }))),
				receipt ? h("p", { className: "dshSwarm_receipt " + (receipt.ok ? "dshSwarm_success" : "dshSwarm_error"), role: receipt.ok ? "status" : "alert" }, receipt.ok ? receipt.text : t("workers.addFailed", {}) + ": " + receipt.text) : null);
		}
		function WorkersSection({ t, progress, stale, sessionId, executeCommand }) {
			const [selection, setSelection] = React.useState(null);
			const focused = selectWorkers(progress, selection);
			const views = progress.workers.map(deriveWorker);
			const busy = views.filter((view) => ["executing", "running"].includes(view.activity)).length;
			const waiting = views.filter((view) => ["waiting", "integration", "integrating"].includes(view.work)).length;
			const filter = (workerId, text, color) => h("button", { key: workerId ?? "all", type: "button", className: "dshSwarm_button dshSwarm_memberFilter", "aria-pressed": focused.selectedId === workerId, onClick: () => setSelection({ runId: progress.runId, workerId }) }, color ? h("i", { className: "dshSwarm_filterDot", "aria-hidden": true, style: { background: color } }) : null, text);
			return h("section", { className: "dshSwarm_section dshSwarm_members", "aria-label": t("workers.title", {}) },
				h("div", { className: "dshSwarm_memberHead" },
					h("div", { className: "dshSwarm_memberIntro" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("workers.title", {})),
						h("p", { className: "dshSwarm_subtle" }, t("workers.summary", { busy, waiting, total: progress.workers.length }))),
					h(AddWorkerControl, { t, progress, connected: !stale, sessionId, executeCommand })),
				h("div", { className: "dshSwarm_memberFilters", role: "group", "aria-label": t("workers.filter", {}) }, filter(null, t("workers.all", { count: progress.workers.length })), progress.workers.map((worker, index) => filter(worker.id, workerName(t, worker, index + 1), workerColor(index)))),
				h("ul", { className: "dshSwarm_workers", "data-focused": !!focused.selectedId }, focused.items.map(({ worker, number }) => h(WorkerCard, { key: worker.id, worker, number, t, stale }))));
		}
		function WorkerCard({ t, worker, number, stale }) {
			const view = deriveWorker(worker);
			const name = workerName(t, worker, number);
			const color = workerColor(number - 1);
			const omitted = view.activity === "executing" && (!view.activeTools.length || worker.activity?.activeToolsTruncated);
			const activity = t("activity." + (omitted ? "executingOmitted" : view.activity), { count: view.activeTools.length });
			const live = !stale && ["executing", "running"].includes(view.activity);
			const tools = (items) => h("ul", { className: "dshSwarm_toolList" }, items.map((tool) => h("li", { key: tool.id, className: "dshSwarm_toolRow" },
				h("code", {}, tool.name), badge(label(t, "tool", tool.status), tool.status === "executing" ? "dshSwarm_active" : tone(tool.status)),
				h("span", { className: "dshSwarm_toolTime" }, tool.startedAt !== null ? timeElement(tool.startedAt) : null, tool.finishedAt !== null ? h(React.Fragment, {}, " → ", timeElement(tool.finishedAt)) : null))));
			const diagnostics = [...new Set([worker.diagnostic, worker.activity?.diagnostic].filter(Boolean))];
			return h("li", { className: "dshSwarm_worker", "data-work": view.work, style: { borderTopColor: color } },
				h("div", { className: "dshSwarm_workerTop" },
					h("span", { className: "dshSwarm_avatar", "aria-hidden": true, style: { background: color } }, initials(name)),
					h("div", { className: "dshSwarm_workerIdentity" }, h("span", { className: "dshSwarm_workerName" }, name), h("span", { className: "dshSwarm_workerSub" }, "W" + number + " · ", h("code", {}, worker.id))),
					h("span", { className: "dshSwarm_workPill", "data-tone": workTone(view.work) }, h("i", { className: "dshSwarm_pulse", "data-live": live, "aria-hidden": true }), t("work." + view.work, {}))),
				h("div", { className: "dshSwarm_workerTask" },
					h("div", { className: "dshSwarm_memberTaskLabel" }, h("span", {}, t("worker.task", {})), view.task ? badge(label(t, "task", view.task.status), tone(view.task.status)) : null),
					h("h3", { className: "dshSwarm_taskTitle", "data-empty": !view.task }, view.task?.subject || t("worker.noTask", {})),
					worker.wait && view.work === "waiting" ? h("p", { className: "dshSwarm_memberWait" }, t(worker.wait.mode === "any" ? "wait.any" : "wait.targets", { tasks: worker.wait.taskIds.length, proposals: worker.wait.proposalIds.length })) : null),
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

		/** Validate the paginated unknown-codec boundary independently of progress frames. */
		function readHistoryPage(page, runId) {
			if (page === null || (object(page) && page.runId !== runId)) throw Object.assign(new Error("Run changed or is unavailable"), { code: "history/run-changed" });
			const sha = (value) => typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
			const lane = (value) => object(value) && textOrNull(value.workerId) && textOrNull(value.displayName) && typeof value.branch === "string" && textOrNull(value.worktreePath);
			if (!object(page) || typeof page.runId !== "string" || !(page.nextCursor === null || (typeof page.nextCursor === "string" && page.nextCursor.length > 0))
				|| !Array.isArray(page.items) || !page.items.every((item) => lane(item) && typeof item.id === "string" && item.id.length > 0 && sha(item.sha) && Array.isArray(item.parents) && item.parents.every(sha) && typeof item.subject === "string" && validTime(item.committedAt))
				|| !Array.isArray(page.worktrees) || !page.worktrees.every((tree) => lane(tree) && (tree.head === null || sha(tree.head)) && textOrNull(tree.diagnostic))
				|| !(page.tips === undefined || (Array.isArray(page.tips) && page.tips.every((tip) => object(tip) && sha(tip.sha) && typeof tip.workerId === "string")))) throw Object.assign(new Error("Invalid Git history page"), { code: "history/invalid" });
			return page;
		}
		async function executeHistoryRead(read, sessionId, cursor, signal) {
			const reply = await read(sessionId, cursor, signal);
			if (!object(reply) || reply.ok !== true) throw Object.assign(new Error(reply?.error?.message || "Invalid history response"), { code: reply?.error?.code ?? "history/invalid" });
			return reply.value;
		}
		/** Unwrap one Remote reply; tolerate transports that already return the value. */
		async function readRemoteValue(call) {
			const reply = await call();
			if (object(reply) && reply.ok === false) throw Object.assign(new Error(reply.error?.message || "Remote call failed"), { code: reply.error?.code ?? "gateway/internal" });
			return object(reply) && reply.ok === true ? reply.value : reply;
		}
		function initialHistory(sessionId, runId) {
			return { sessionId, runId, items: [], worktrees: [], tips: [], nextCursor: null, started: false, loading: false, error: null };
		}
		/** One cancellable page request at a time; late results never cross run/session boundaries. */
		function createHistoryPager({ sessionId, runId, loadHistory, onChange }) {
			let state = initialHistory(sessionId, runId);
			let request = null;
			let disposed = false;
			const cursors = new Set();
			const publish = (patch) => { if (!disposed) { state = { ...state, ...patch }; onChange(state); } };
			const loadMore = async () => {
				if (disposed || request || (state.started && state.nextCursor === null)) return;
				const controller = new AbortController();
				request = controller;
				const cursor = state.nextCursor;
				publish({ loading: true, error: null });
				try {
					const page = readHistoryPage(await loadHistory(sessionId, cursor, controller.signal), runId);
					if (disposed || controller.signal.aborted || request !== controller) return;
					if (page.nextCursor !== null && (page.nextCursor === cursor || cursors.has(page.nextCursor))) throw Object.assign(new Error("History cursor did not advance"), { code: "history/invalid" });
					const known = new Set(state.items.map((item) => item.id));
					const added = page.items.filter((item) => { if (known.has(item.id)) return false; known.add(item.id); return true; });
					if (cursor !== null) cursors.add(cursor);
					publish({ items: [...state.items, ...added], worktrees: page.worktrees, tips: page.tips ?? [], nextCursor: page.nextCursor, started: true });
				} catch (error) {
					if (!disposed && !controller.signal.aborted && request === controller) publish({ error: { code: error?.code ?? null, message: error instanceof Error ? error.message : String(error) } });
				} finally {
					if (request === controller) { request = null; if (!controller.signal.aborted) publish({ loading: false }); }
				}
			};
			return { loadMore, refresh() { if (disposed) return; request?.abort(); request = null; cursors.clear(); state = initialHistory(sessionId, runId); return loadMore(); }, dispose() { disposed = true; request?.abort(); request = null; } };
		}
		/** IntersectionObserver is only an enhancement; the load-more button always remains. */
		function observeHistoryEnd(root, target, loadMore) {
			if (!target || typeof IntersectionObserver !== "function") return undefined;
			const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore(); }, { root, rootMargin: "0px 0px 240px 0px" });
			observer.observe(target);
			return () => observer.disconnect();
		}
		const GRAPH_LANE_WIDTH = 18;
		const GRAPH_ROW_HEIGHT = 44;

		/**
		 * Lay out one children-before-parents history page.
		 *
		 * `above` is the lane state before this commit and `below` after its parents
		 * are placed; `incoming` lists lanes that converge on this commit and `edges`
		 * the extra parent lanes. Lanes are dense: a closed lane is reused.
		 */
		function computeGraph(items) {
			const lanes = [];
			const rows = [];
			const allocate = () => {
				const free = lanes.indexOf(null);
				if (free >= 0) return free;
				lanes.push(null);
				return lanes.length - 1;
			};
			for (const item of items) {
				let lane = lanes.indexOf(item.sha);
				if (lane < 0) lane = allocate();
				const above = lanes.slice();
				const incoming = [];
				for (let index = 0; index < above.length; index += 1) {
					if (index !== lane && above[index] === item.sha) incoming.push(index);
				}
				for (const index of incoming) lanes[index] = null;
				const edges = [];
				const parents = Array.isArray(item.parents) ? item.parents : [];
				if (parents.length === 0) {
					lanes[lane] = null;
				} else {
					const first = parents[0];
					const existing = lanes.indexOf(first);
					if (existing >= 0 && existing !== lane) {
						edges.push({ from: lane, to: existing });
						lanes[lane] = null;
					} else {
						lanes[lane] = first;
					}
					for (const parent of parents.slice(1)) {
						let target = lanes.indexOf(parent);
						if (target < 0) {
							target = allocate();
							lanes[target] = parent;
						}
						edges.push({ from: lane, to: target });
					}
				}
				rows.push({ id: item.id, sha: item.sha, lane, above, below: lanes.slice(), incoming, edges, commit: item });
			}
			let maxLanes = 1;
			for (const row of rows) maxLanes = Math.max(maxLanes, row.above.length, row.below.length);
			return { rows, maxLanes, laneWidth: GRAPH_LANE_WIDTH, rowHeight: GRAPH_ROW_HEIGHT };
		}

		/*
		 * Metro-style worktree tracks. One horizontal track per worktree (accepted result
		 * first as the trunk, then workers in roster order), newest on the left. A commit
		 * sits on the first track whose first-parent chain claims it: the trunk from its HEAD,
		 * then worker HEADs, then proposal tips (the commits each worker submitted). `--source`
		 * only means reachability, so it is the last fallback. Cross-track curves
		 * always bend in the label-free gutter beside a station:
		 * - first parent on another track (branch-off): ride the child's track, bend just
		 *   before the parent station;
		 * - extra parents (merge): ride the parent's track, bend just after the merge station,
		 *   and the merge label flips away from the incoming curve.
		 */
		const TRACK = Object.freeze({ column: 196, lane: 84, pad: 22, label: 150, bend: 40, tail: 56 });
		const TRACK_TRUNK = "var(--dsw-alias-label-primary)";
		/*
		 * Member identity colors: chromatic theme tokens only. DSH maps brand-primary and
		 * idle to neutral black/white/gray, which would read as the Host trunk or as
		 * "inactive", so members never use them. Extra hues are mixes of two chromatic
		 * tokens; error red comes last so it is not read as failure in small teams.
		 */
		const TRACK_COLORS = Object.freeze([
			"var(--dsw-alias-state-business-primary)",
			"var(--dsw-alias-state-success-primary)",
			"var(--dsw-alias-state-warn-primary)",
			"color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, var(--dsw-alias-state-error-primary))",
			"color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-state-success-primary))",
			"color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-state-error-primary))",
			"var(--dsw-alias-state-error-primary)",
		]);
		const laneKey = (value) => value.workerId === null ? "result:" + value.branch : "worker:" + value.workerId;

		/** Tracks from the pinned worktree snapshot, plus any source seen only in commits. */
		function trackLanes(worktrees, items) {
			const lanes = [];
			const seen = new Set();
			const add = (tree) => { const key = laneKey(tree); if (seen.has(key)) return; seen.add(key); lanes.push({ key, workerId: tree.workerId, displayName: tree.displayName, branch: tree.branch, worktreePath: tree.worktreePath, head: tree.head ?? null, diagnostic: tree.diagnostic ?? null }); };
			for (const tree of worktrees) if (tree.workerId === null) add(tree);
			for (const tree of worktrees) if (tree.workerId !== null) add(tree);
			for (const item of items) add(item);
			let worker = 0;
			return lanes.map((lane, index) => ({ ...lane, index, trunk: lane.workerId === null, color: lane.workerId === null ? TRACK_TRUNK : TRACK_COLORS[worker++ % TRACK_COLORS.length] }));
		}

		/**
		 * Pure geometry for one loaded history prefix.
		 *
		 * @param items commits in Git date order (children before parents).
		 * @param worktrees lane snapshot from the history page.
		 * @param tips proposal source commits with their author worker, newest first.
		 * @param more whether older pages exist; missing parents then fade out to the right,
		 *   otherwise they meet the run base terminus.
		 */
		function trackLayout(items, worktrees, tips, more) {
			const lanes = trackLanes(worktrees, items);
			const laneOf = new Map(lanes.map((lane) => [lane.key, lane]));
			const itemOf = new Map(items.map((item) => [item.sha, item]));
			const claimed = new Map();
			const claim = (lane, start) => { for (let sha = start; lane && sha && itemOf.has(sha) && !claimed.has(sha); sha = itemOf.get(sha).parents[0]) claimed.set(sha, lane); };
			for (const lane of lanes) claim(lane, lane.head);
			for (const tip of tips) claim(laneOf.get("worker:" + tip.workerId), tip.sha);
			const x = (column) => TRACK.pad + 8 + column * TRACK.column;
			const y = (lane) => TRACK.pad + lane * TRACK.lane + TRACK.lane / 2;
			const nodes = items.map((item, column) => {
				const lane = claimed.get(item.sha) ?? laneOf.get(laneKey(item));
				return { column, item, lane, x: x(column), y: y(lane.index), merge: item.parents.length > 1, head: lane.head === item.sha, labelAbove: false };
			});
			const bySha = new Map(nodes.map((node) => [node.item.sha, node]));
			const missing = nodes.some((node) => node.item.parents.some((parent) => !bySha.has(parent)));
			const base = !more && missing ? { x: x(items.length), y: y(0), lane: lanes[0] } : null;
			const width = TRACK.pad * 2 + (items.length + (base ? 1 : 0)) * TRACK.column + (more ? TRACK.tail : 0);
			const height = TRACK.pad * 2 + Math.max(1, lanes.length) * TRACK.lane;
			const edges = [];
			for (const node of nodes) {
				node.item.parents.forEach((parent, order) => {
					const target = bySha.get(parent) ?? base;
					if (target === null) {
						if (order === 0) edges.push({ key: node.item.id + ":open", kind: "open", color: node.lane.color, path: `M ${node.x} ${node.y} H ${width - TRACK.pad / 2}` });
						return;
					}
					const key = node.item.id + ":" + parent;
					if (target.y === node.y) { edges.push({ key, kind: "track", color: node.lane.color, path: `M ${node.x} ${node.y} H ${target.x}` }); return; }
					const half = TRACK.bend / 2;
					if (order === 0) {
						const start = Math.max(node.x, target.x - TRACK.bend);
						edges.push({ key, kind: "branch", color: node.lane.color, path: `M ${node.x} ${node.y} H ${start} C ${start + half} ${node.y}, ${target.x - half} ${target.y}, ${target.x} ${target.y}` });
					} else {
						const end = Math.min(target.x, node.x + TRACK.bend);
						edges.push({ key, kind: "merge", color: target.lane.color, path: `M ${node.x} ${node.y} C ${node.x + half} ${node.y}, ${end - half} ${target.y}, ${end} ${target.y} H ${target.x}` });
						if (target.y > node.y) node.labelAbove = true;
					}
				});
			}
			// Cross-track curves under same-track rails so stations read as joined to their own line.
			const rank = { open: 0, branch: 1, merge: 1, track: 2 };
			edges.sort((a, b) => rank[a.kind] - rank[b.kind]);
			return { lanes, nodes, edges, base, width, height };
		}

		/** Station glyph: plain stop, interchange ring for merges, halo for a live HEAD. */
		function station(node) {
			const color = node.lane.color;
			return h("g", { key: "s" + node.item.id, className: "dshSwarm_station" },
				node.head ? h("circle", { cx: node.x, cy: node.y, r: 12, style: { fill: color, opacity: 0.16 } }) : null,
				h("circle", { cx: node.x, cy: node.y, r: node.merge ? 8 : 6, strokeWidth: 3, style: { fill: "var(--dsw-alias-bg-layer-1)", stroke: color } }),
				node.merge ? h("circle", { cx: node.x, cy: node.y, r: 2.5, style: { fill: color } }) : null,
				node.head && !node.merge ? h("circle", { cx: node.x, cy: node.y, r: 2.5, style: { fill: color } }) : null);
		}

		/** Sticky track legend: which worktree each colored line belongs to. */
		function renderLaneHeads(t, lanes, name) {
			return h("div", { className: "dshSwarm_laneHeads", role: "list", "aria-label": t("git.worktrees", {}), style: { paddingTop: TRACK.pad + "px" } },
				lanes.map((lane) => h("div", { key: lane.key, role: "listitem", className: "dshSwarm_laneHead", "data-trunk": lane.trunk, style: { height: TRACK.lane + "px", borderInlineStartColor: lane.color }, title: lane.worktreePath ?? undefined },
					h("span", { className: "dshSwarm_laneName" }, h("i", { "aria-hidden": true, style: { background: lane.color } }), lane.trunk ? t("git.result", {}) : name(lane)),
					h("code", { className: "dshSwarm_laneBranch", title: t("git.source", {}) + " " + lane.branch }, lane.branch),
					h("span", { className: "dshSwarm_laneHeadSha" }, lane.head ? h("code", { style: { color: lane.color } }, "HEAD " + lane.head.slice(0, 7)) : lane.diagnostic ?? t("git.worktreeMissing", {})))));
		}

		/** Track canvas for the loaded prefix; a later page appends more stations to the right. */
		function renderCommitTrack(t, items, worktrees, tips, more) {
			const { lanes, nodes, edges, base, width, height } = trackLayout(items, worktrees, tips, more);
			const rails = lanes.map((lane) => h("line", { key: "rail" + lane.key, x1: TRACK.pad / 2, y1: TRACK.pad + lane.index * TRACK.lane + TRACK.lane / 2, x2: width - TRACK.pad / 2, y2: TRACK.pad + lane.index * TRACK.lane + TRACK.lane / 2, strokeWidth: 8, strokeLinecap: "round", style: { stroke: lane.color, opacity: 0.08 } }));
			const bands = lanes.map((lane) => h("rect", { key: "band" + lane.key, x: 0, y: TRACK.pad + lane.index * TRACK.lane, width, height: TRACK.lane, className: "dshSwarm_trackBand", "data-odd": lane.index % 2 === 1 }));
			const labels = nodes.map((node) => {
				const item = node.item;
				const tip = [item.subject, item.sha, node.lane.branch, item.parents.length ? t("git.parents", {}) + ": " + item.parents.map((parent) => parent.slice(0, 7)).join(", ") : null].filter(Boolean).join("\n");
				return h("div", {
					key: item.id, className: "dshSwarm_trackLabel", "data-side": node.labelAbove ? "above" : "below", title: tip,
					style: { left: node.x - 6 + "px", top: (node.labelAbove ? node.y - 44 : node.y + 13) + "px", width: TRACK.label + "px" },
				},
					h("div", { className: "dshSwarm_trackSubject" }, item.subject || item.sha.slice(0, 7)),
					h("div", { className: "dshSwarm_trackMeta" }, h("code", {}, item.sha.slice(0, 7)), timeElement(item.committedAt),
						node.merge ? h("span", { className: "dshSwarm_trackTag", style: { borderColor: node.lane.color, color: node.lane.color } }, t("git.merge", {})) : null,
						node.head ? h("span", { className: "dshSwarm_trackTag", "data-head": true, style: { background: node.lane.color, borderColor: node.lane.color } }, node.lane.trunk ? t("git.result", {}) : "HEAD") : null));
			});
			return h("div", { className: "dshSwarm_trackCanvas", style: { width: width + "px", height: height + "px" } },
				h("svg", { className: "dshSwarm_trackEdges", width, height, viewBox: `0 0 ${width} ${height}`, "aria-hidden": true },
					bands, rails,
					edges.map((edge) => h("path", { key: edge.key, d: edge.path, fill: "none", strokeWidth: edge.kind === "track" ? 4 : 3, strokeLinecap: "round", strokeLinejoin: "round", strokeDasharray: edge.kind === "open" ? "2 7" : undefined, style: { stroke: edge.color, opacity: edge.kind === "open" ? 0.5 : edge.kind === "track" ? 1 : 0.85 } })),
					nodes.map(station),
					base ? h("rect", { x: base.x - 7, y: base.y - 7, width: 14, height: 14, rx: 3, strokeWidth: 3, style: { fill: "var(--dsw-alias-bg-layer-1)", stroke: base.lane.color } }) : null),
				base ? h("div", { className: "dshSwarm_trackLabel", "data-side": "below", style: { left: base.x - 6 + "px", top: base.y + 13 + "px", width: TRACK.label + "px" } }, h("div", { className: "dshSwarm_trackSubject" }, t("git.base", {}))) : null,
				labels);
		}

		/** Symbol key and time direction, so the drawing reads without prior Git-graph experience. */
		function renderTrackLegend(t) {
			const glyph = (kind) => h("svg", { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": true },
				kind === "head" ? h("circle", { cx: 9, cy: 9, r: 8, style: { fill: "var(--dsw-alias-label-secondary)", opacity: 0.2 } }) : null,
				h("circle", { cx: 9, cy: 9, r: kind === "merge" ? 6 : 4.5, strokeWidth: 2.2, style: { fill: "var(--dsw-alias-bg-layer-1)", stroke: "var(--dsw-alias-label-secondary)" } }),
				kind === "commit" ? null : h("circle", { cx: 9, cy: 9, r: 2, style: { fill: "var(--dsw-alias-label-secondary)" } }));
			return h("div", { className: "dshSwarm_trackLegend" },
				h("span", {}, glyph("commit"), t("git.legendCommit", {})),
				h("span", {}, glyph("merge"), t("git.legendMerge", {})),
				h("span", {}, glyph("head"), t("git.legendHead", {})),
				h("span", { className: "dshSwarm_trackAxis" }, t("git.axis", {})));
		}

		function GitStreamSection({ t, progress, sessionId, loadHistory }) {
			const [state, setState] = React.useState(() => initialHistory(sessionId, progress.runId));
			const pager = React.useRef(null);
			const scroll = React.useRef(null);
			const sentinel = React.useRef(null);
			const current = state.sessionId === sessionId && state.runId === progress.runId ? state : initialHistory(sessionId, progress.runId);
			const available = typeof loadHistory === "function";
			React.useEffect(() => {
				if (!available) return undefined;
				const owned = createHistoryPager({ sessionId, runId: progress.runId, loadHistory, onChange: setState });
				pager.current = owned;
				void owned.loadMore();
				return () => { owned.dispose(); if (pager.current === owned) pager.current = null; };
			}, [sessionId, progress.runId, loadHistory, available]);
			React.useEffect(() => {
				if (current.loading || current.error || !current.started || current.nextCursor === null) return undefined;
				return observeHistoryEnd(scroll.current, sentinel.current, () => void pager.current?.loadMore());
			}, [sessionId, progress.runId, current.loading, current.error, current.started, current.nextCursor]);
			const name = (item) => item.workerId === null ? t("git.result", {}) : item.displayName || progress.workers.find((worker) => worker.id === item.workerId)?.displayName || item.workerId;
			const missing = !available || ["gateway/invocation-unavailable", "gateway/method-unavailable"].includes(current.error?.code);
			const errorText = current.error?.code === "history/run-changed" ? t("git.missingRun", {}) : current.error?.code === "history/invalid" ? t("git.invalid", {}) : current.error?.message;
			return h("section", { className: "dshSwarm_section", "aria-label": t("git.title", {}) },
				h("div", { className: "dshSwarm_sectionHead" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("git.title", {})), h("button", { type: "button", className: "dshSwarm_button", disabled: !available || current.loading, onClick: () => { if (scroll.current) { scroll.current.scrollTop = 0; scroll.current.scrollLeft = 0; } void pager.current?.refresh(); } }, t("git.refresh", {}))),
				h("p", { className: "dshSwarm_scopeNote" }, t("git.note", {})),
				h("p", { className: "dshSwarm_scopeNote" }, t("git.snapshot", {})),
				missing ? h("p", { className: "dshSwarm_notice", role: "status" }, t("git.unavailable", {})) : null,
				current.items.length ? renderTrackLegend(t) : null,
				h("div", { className: "dshSwarm_gitScroll", ref: scroll, tabIndex: 0, role: "region", "aria-label": t("git.title", {}), "aria-busy": current.loading },
					current.items.length
						? h("div", { className: "dshSwarm_trackRow" },
							renderLaneHeads(t, trackLanes(current.worktrees, current.items), name),
							renderCommitTrack(t, current.items, current.worktrees, current.tips ?? [], current.nextCursor !== null),
							h("div", { ref: sentinel, className: "dshSwarm_gitSentinel", "aria-hidden": true }))
						: current.started ? h("p", { className: "dshSwarm_empty" }, t("git.empty", {})) : null,
					current.error && !missing ? h("p", { className: "dshSwarm_notice", role: "alert" }, t("git.failed", {}), ": ", errorText) : null),
				h("div", { className: "dshSwarm_gitFooter" }, h("span", { className: "dshSwarm_subtle", role: "status", "aria-live": "polite" }, t(current.loading ? "git.loading" : "git.loaded", { count: current.items.length })),
					!missing && (current.error || current.nextCursor !== null) ? h("button", { type: "button", className: "dshSwarm_button", disabled: current.loading, onClick: () => void pager.current?.loadMore() }, t(current.error ? "git.retry" : "git.more", {})) : null,
					current.started && current.nextCursor === null && !current.error ? h("span", { className: "dshSwarm_subtle" }, t("git.end", {})) : null));
		}

		/** Error text for one failed Remote call. */
		function describeError(error) {
			return error instanceof Error ? error.message : String(error);
		}

		/** Collapsible worktree creation, independent of any run; the graph stays primary. */
		function CreateWorktreeSection({ t, sessionId, createWorktree }) {
			const available = typeof createWorktree === "function";
			const [form, setForm] = React.useState({ name: "", base: "" });
			const [created, setCreated] = React.useState({ pending: false, error: null, success: null });
			const submit = () => {
				if (created.pending || !available) return;
				const request = {};
				const name = form.name.trim();
				const base = form.base.trim();
				if (name !== "") request.name = name;
				if (base !== "") request.base = base;
				setCreated({ pending: true, error: null, success: null });
				Promise.resolve().then(() => createWorktree(sessionId, request)).then((result) => {
					const worktree = result !== null && typeof result === "object" ? result.worktree : null;
					const label = worktree !== null && typeof worktree === "object" && typeof worktree.branch === "string"
						? worktree.branch.replace(/^refs\/heads\//u, "") : "—";
					setCreated({ pending: false, error: null, success: label });
					setForm({ name: "", base: "" });
				}).catch((error) => setCreated({ pending: false, error: describeError(error), success: null }));
			};
			return h("details", { className: "dshSwarm_details dshSwarm_create" },
				h("summary", {}, t("wt.create.title", {})),
				available
					? h("div", { className: "dshSwarm_form" },
						h("div", { className: "dshSwarm_formRow" },
							h("label", { className: "dshSwarm_field" }, h("span", { className: "dshSwarm_label" }, t("wt.create.name", {})),
								h("input", { className: "dshSwarm_input", value: form.name, placeholder: t("wt.create.namePlaceholder", {}), disabled: created.pending, onChange: (event) => setForm({ name: event.target.value, base: form.base }) })),
							h("label", { className: "dshSwarm_field" }, h("span", { className: "dshSwarm_label" }, t("wt.create.base", {})),
								h("input", { className: "dshSwarm_input", value: form.base, placeholder: t("wt.create.basePlaceholder", {}), disabled: created.pending, onChange: (event) => setForm({ name: form.name, base: event.target.value }) }))),
						h("button", { type: "button", className: "dshSwarm_button", disabled: created.pending, onClick: submit }, created.pending ? t("wt.create.pending", {}) : t("wt.create.submit", {})),
						h("div", { className: "dshSwarm_hint" }, t("wt.create.hint", {})),
						created.error === null ? null : h("div", { className: "dshSwarm_error" }, t("wt.create.error", { message: created.error })),
						created.success === null ? null : h("div", { className: "dshSwarm_success" }, t("wt.create.success", { name: created.success })))
					: h("p", { className: "dshSwarm_notice", role: "status" }, t("wt.unavailable", { message: "remote client unavailable" })));
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
			const names = new Map(progress.workers.map((worker, index) => [worker.id, workerName(t, worker, index + 1)]));
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
				return h("li", { className: "dshSwarm_event", key: event.seq, "data-kind": event.kind }, h("i", { className: "dshSwarm_eventDot", "aria-hidden": true, style: { background: description.workerNumber ? workerColor(description.workerNumber - 1) : TRACK_TRUNK } }), timeElement(event.createdAt), label(t, "event", event.kind), " · ", description.subject ? h("span", { title: event.objectId }, description.subject, " · ") : null,
					event.kind === "head" ? t("event.updated", {}) : label(t, event.kind === "run" ? "phase" : event.kind, event.status), description.workerNumber ? h("span", { className: "dshSwarm_subtle" }, " · ", workerName(t, progress.workers[description.workerNumber - 1], description.workerNumber)) : null);
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
		/** A transfer or stopped run is not completion; only verified goal records enter Done. */
		function goalLane(goal, phase) { const state = goalState(goal, phase); return state === "completed" ? "done" : state === "active" ? "doing" : "todo"; }
		function goalColumns(progress) {
			const columns = { todo: [], doing: [], done: [] };
			if (progress.goal) {
				const original = { id: "original", text: progress.goal, acceptanceCriteria: progress.acceptanceCriteria ?? [], status: progress.phase === "completed" ? "completed" : "active", original: true, truncated: progress.originalGoalTruncated };
				columns[goalLane(original, progress.phase)].push(original);
			}
			for (const goal of progress.goalBoard?.items ?? []) columns[goalLane(goal, progress.phase)].push(goal);
			return columns;
		}
		/** One goal ticket: state stripe, clamped text, criteria count; full facts on expand. */
		function GoalCard({ t, goal, phase }) {
			const state = goalState(goal, phase);
			const criteria = goal.acceptanceCriteria.length;
			return h("details", { className: "dshSwarm_goalEntry", "data-state": state, "data-original": !!goal.original },
				h("summary", {},
					h("div", { className: "dshSwarm_goalHead" }, badge(t(goal.original ? "goals.original" : "goal." + state, {}), state === "completed" ? "dshSwarm_success" : state === "active" ? "dshSwarm_active" : "dshSwarm_warn"),
						!goal.original && goal.seq != null ? h("span", { className: "dshSwarm_goalSeq" }, "#" + goal.seq) : null),
					h("span", { className: "dshSwarm_goalText" }, goal.text),
					h("span", { className: "dshSwarm_goalFoot" }, criteria ? h("span", { className: "dshSwarm_goalChip" }, "✓ " + t("goals.criteriaCount", { count: criteria })) : null,
						goal.completedCommit ? h("code", {}, goal.completedCommit.slice(0, 7)) : null,
						!goal.original && goal.createdAt ? timeElement(goal.createdAt) : null)),
				h("div", { className: "dshSwarm_goalBody" },
					h("p", { className: "dshSwarm_goalFull" }, goal.text),
					criteria ? h("ol", { className: "dshSwarm_criteria", "aria-label": t("goals.criteriaTitle", {}) }, goal.acceptanceCriteria.map((criterion, i) => h("li", { key: i }, criterion))) : null,
					!goal.original ? h("div", { className: "dshSwarm_taskMeta" }, h("code", {}, goal.id), goal.completedCommit ? h("span", {}, t("goals.commit", {}), " ", h("code", {}, goal.completedCommit.slice(0, 12))) : null, goal.continuedInRunId ? h("span", {}, t("goals.nextRun", {}), " ", h("code", {}, goal.continuedInRunId)) : null) : null,
					goal.truncated ? h("p", { className: "dshSwarm_subtle" }, t("goals.clipped", {})) : null));
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
			const columns = goalColumns(p);
			const composer = !supported ? h("p", { className: "dshSwarm_receipt dshSwarm_subtle" }, t("goals.unavailable", {})) : h("form", { className: "dshSwarm_composer", onSubmit: (event) => { event.preventDefault(); if (draft.trim()) void submit("append"); } },
					h("label", {}, t("goals.wish", {}), h("textarea", { className: "dshSwarm_input", value: draft, maxLength: 16000, rows: 3, placeholder: t("goals.placeholder", {}), disabled: pending, onChange: (event) => setDraft(event.target.value) })),
					h("details", { className: "dshSwarm_details" }, h("summary", {}, t("goals.criteria", {})), h("textarea", { className: "dshSwarm_input", value: criteria, rows: 3, maxLength: 64000, "aria-label": t("goals.criteria", {}), disabled: pending, onChange: (event) => setCriteria(event.target.value) })),
					h("div", { className: "dshSwarm_publishRow" }, h("span", { className: "dshSwarm_subtle" }, t(!connected ? "stale.title" : p.phase === "paused" ? "goals.paused" : ["draining", "quiescing", "completed", "stopped", "failed"].includes(p.phase) ? "goals.deferred" : "goals.scope", {})),
						h("div", { className: "dshSwarm_row" }, p.phase === "paused" || (terminal(p.phase) && deferred) ? h("button", { type: "button", className: "dshSwarm_button", disabled: pending || !connected || (p.phase !== "paused" && hasDraft), onClick: () => void submit(p.phase === "paused" ? "resume" : "continue") }, t(p.phase === "paused" ? "goals.resume" : hasDraft ? "goals.publishFirst" : "goals.continue", {})) : null,
							h("button", { type: "submit", className: "dshSwarm_button dshSwarm_primary", disabled: pending || !connected || !draft.trim() }, t(pending ? "goals.publishing" : "goals.publish", {})))),
					receipt ? h("p", { className: "dshSwarm_receipt " + (receipt.ok ? "dshSwarm_success" : "dshSwarm_error"), role: receipt.ok ? "status" : "alert" }, receipt.ok ? receipt.text : t("goals.failed", {}) + ": " + receipt.text) : null);
			const total = columns.todo.length + columns.doing.length + columns.done.length;
			return h("section", { className: "dshSwarm_goalSection", "aria-label": t("goals.title", {}) },
				h("div", { className: "dshSwarm_goalSummary" },
					h("div", { className: "dshSwarm_memberIntro" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("tabs.goals", {})), h("p", { className: "dshSwarm_subtle" }, t("goals.flowNote", {}))),
					h("div", { className: "dshSwarm_goalProgress" },
						h("div", { className: "dshSwarm_goalProgressText" }, h("strong", {}, columns.done.length + " / " + total), h("span", { className: "dshSwarm_subtle" }, t("goals.doneCount", {})), deferred ? badge(t("goals.pending", { count: deferred }), "dshSwarm_warn") : null),
						// Count composition only; no completion percentage is inferred from goal records.
						h("div", { className: "dshSwarm_meter", "aria-hidden": true },
							["done", "doing", "todo"].map((lane) => total && columns[lane].length ? h("span", { key: lane, "data-pool": lane, style: { width: columns[lane].length / total * 100 + "%" } }) : null)))),
				h("div", { className: "dshSwarm_kanban" }, Object.entries(columns).map(([lane, goals]) => h("section", { key: lane, className: "dshSwarm_lane", "data-lane": lane, "aria-label": t("goals." + lane, {}) },
					h("h3", { className: "dshSwarm_laneTitle" }, h("span", { className: "dshSwarm_poolName" }, h("i", { className: "dshSwarm_laneDot", "aria-hidden": true }), t("goals." + lane, {})), h("span", { className: "dshSwarm_laneCount" }, String(goals.length))), lane === "todo" ? composer : null,
					goals.length ? h("div", { className: "dshSwarm_goalList" }, goals.map((goal) => h(GoalCard, { key: goal.id, t, goal, phase: p.phase }))) : h("p", { className: "dshSwarm_laneEmpty" }, t("goals.laneEmpty", {}))))),
				board?.truncated ? h("p", { className: "dshSwarm_subtle" }, t("goals.more", { shown: board.items.length, total: board.total })) : null);
		}
		/** Compact roster for the dashboard: identity color, current task and work state. */
		function TeamCard({ t, progress: p, live }) {
			const views = p.workers.map(deriveWorker);
			const busy = views.filter((view) => ["executing", "running"].includes(view.activity)).length;
			const waiting = views.filter((view) => ["waiting", "integration", "integrating"].includes(view.work)).length;
			return h("section", { className: "dshSwarm_teamCard", "aria-label": t("dash.team", {}) },
				h("div", { className: "dshSwarm_deliveryTop" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("dash.team", {})), h("span", { className: "dshSwarm_subtle" }, t("dash.teamNote", { busy, waiting }))),
				p.workers.length ? h("ul", { className: "dshSwarm_teamList" }, p.workers.map((worker, index) => {
					const view = views[index];
					const name = workerName(t, worker, index + 1);
					return h("li", { key: worker.id, className: "dshSwarm_teamRow" },
						h("span", { className: "dshSwarm_avatar dshSwarm_avatarSmall", "aria-hidden": true, style: { background: workerColor(index) } }, initials(name)),
						h("span", { className: "dshSwarm_teamName" }, h("strong", {}, name), h("span", { className: "dshSwarm_teamTask", "data-empty": !view.task }, view.task?.subject ?? t("worker.noTask", {}))),
						h("span", { className: "dshSwarm_workPill", "data-tone": workTone(view.work) }, h("i", { className: "dshSwarm_pulse", "data-live": live && ["executing", "running"].includes(view.activity), "aria-hidden": true }), t("work." + view.work, {})));
				})) : h("p", { className: "dshSwarm_laneEmpty" }, t("dash.noWorkers", {})));
		}
		/** Dashboard: goal, stage stepper, KPI cards, delivery and team, then tasks and activity. */
		function DashboardPanel({ t, state, now }) {
			const p = state.progress;
			const clock = deriveClock(state, now);
			const live = state.status === "live" && !terminal(p.phase);
			const kpi = (key, name, value, note, extra) => h("div", { className: "dshSwarm_kpi", "data-kpi": key }, h("dt", {}, name), h("dd", {}, h("span", { className: "dshSwarm_kpiValue" }, value), extra ?? null, h("span", { className: "dshSwarm_kpiNote" }, note)));
			// Status composition of the task board: widths are counts, never a completion percentage.
			const segments = ["done", "proposed", "claimed", "open", "blocked", "cancelled"].filter((key) => p.tasks[key] > 0);
			const composition = p.tasks.total ? [
				h("span", { key: "bar", className: "dshSwarm_kpiBar", "aria-hidden": true }, segments.map((key) => h("span", { key, "data-seg": key, style: { flexGrow: p.tasks[key] } }))),
				h("span", { key: "legend", className: "dshSwarm_kpiLegend" }, segments.map((key) => h("span", { key }, h("i", { "data-seg": key, "aria-hidden": true }), label(t, "task", key) + " " + p.tasks[key]))),
			] : null;
			const failedChecks = p.verifications.failed + p.verifications.interrupted;
			return h(React.Fragment, {},
				h("details", { className: "dshSwarm_goalBox" }, h("summary", {}, t("overview.goal", {}), h("span", { className: "dshSwarm_goalPreview" }, p.goal ?? t("overview.goalMissing", {}))), h("p", { className: "dshSwarm_goalFull" }, p.goal)),
				p.reason ? notice(t("reason", { reason: p.reason }), p.phase === "quiescing" && p.quiesceTarget ? label(t, "phase", p.quiesceTarget) : null) : null,
				h("ol", { className: "dshSwarm_workflow", "aria-label": t("workflow", {}) }, deriveWorkflow(p).map((stage, index) => h("li", { key: stage.id, className: "dshSwarm_step", "data-state": stage.state, "aria-label": t("stage." + stage.id, {}) + ": " + t("stage." + stage.state, {}) },
					h("span", { className: "dshSwarm_stepNode", "aria-hidden": true }, stage.state === "complete" ? "✓" : stage.state === "active" ? h("i", { className: "dshSwarm_pulse", "data-live": live }) : String(index + 1)),
					h("div", { className: "dshSwarm_stepBody" },
						h("div", { className: "dshSwarm_stepName" }, t("stage." + stage.id, {})),
						h("div", { className: "dshSwarm_stepCount" }, t("stage." + stage.id + ".count", stage.counts)),
						h("div", { className: "dshSwarm_stepState" }, t("stage." + stage.state, {})))))),
				h("dl", { className: "dshSwarm_kpis" },
					kpi("tasks", t("tasks.kpi", {}), p.tasks.done + " / " + p.tasks.total, p.tasks.blocked + p.tasks.cancelled ? t("tasks.note", p.tasks) : null, composition),
					kpi("verify", t("verification.kpi", {}), String(p.verifications.passed), p.verifications.running + failedChecks ? t("verification.note", p.verifications) : null, failedChecks ? h("span", { className: "dshSwarm_kpiFlag" }, t("delivery.errors", p.verifications)) : null),
					kpi("time", t(budgetKey(p), {}), p.deadline === null ? (clock.elapsedMs === null ? "—" : duration(clock.elapsedMs)) : duration(clock.remainingMs), p.deadline === null ? t("budget.noDeadline", {}) : clock.elapsedMs === null ? t("elapsed.unknown", {}) : t("elapsed", { duration: duration(clock.elapsedMs) }))),
				clock.remainingMs === 0 && !terminal(p.phase) ? h("p", { className: "dshSwarm_subtle dshSwarm_warn" }, t("budget.expired", {})) : null,
				h("div", { className: "dshSwarm_dashGrid" }, h(DeliveryCard, { t, progress: p }), h(TeamCard, { t, progress: p, live })),
				p.detailError ? notice(t("unavailable", {}), t("detail.error", { message: p.detailError })) : null,
				h("div", { className: "dshSwarm_collaboration" }, h(TaskBoard, { t, progress: p }), h(Timeline, { t, progress: p })));
		}

		/*
		 * Collaboration flow: one swimlane per worker under a Host/result lane, events in
		 * sequence order left → right. Messages are arcs from sender to recipient, accepted
		 * results rise from the author's lane to the result lane. Metadata only: the Host
		 * never sends message bodies or finding text, so neither does this view.
		 */
		const FLOW = Object.freeze({ column: 40, lane: 58, pad: 18, axis: 26 });
		const flowKinds = ["all", "message", "finding", "task", "proposal"];
		const FINDING_KINDS = ["observed", "fact", "fail", "patch_summary"];
		const interactionValid = (item) => object(item) && count(item.seq) && ["message", "finding", "task", "proposal", "head"].includes(item.kind) && typeof item.status === "string" && textOrNull(item.actorWorkerId) && textOrNull(item.peerWorkerId) && typeof item.objectId === "string" && textOrNull(item.taskId) && validTime(item.createdAt);

		/** Lanes (Host first, then roster order, then unknown ids) and per-event geometry. */
		function flowLayout(progress, kind) {
			const lanes = [{ key: null, color: TRACK_TRUNK, host: true }];
			const index = new Map([[null, 0]]);
			progress.workers.forEach((worker, number) => { index.set(worker.id, lanes.length); lanes.push({ key: worker.id, color: workerColor(number), worker, number: number + 1 }); });
			const items = (progress.interactions ?? []).filter((item) => kind === "all" || item.kind === kind || (kind === "proposal" && item.kind === "head"));
			const laneOf = (id) => {
				if (!index.has(id)) { index.set(id, lanes.length); lanes.push({ key: id, color: workerColor(lanes.length - 1), unknown: true }); }
				return index.get(id);
			};
			const x = (column) => FLOW.pad + column * FLOW.column + FLOW.column / 2;
			const y = (lane) => FLOW.pad + lane * FLOW.lane + FLOW.lane / 2;
			const marks = items.map((item, column) => {
				// Task and proposal events sit on the owner's/author's lane (Host performs integration
				// transitions for the author); everything else on the actor's.
				const home = item.kind === "task" || item.kind === "proposal" ? laneOf(item.peerWorkerId ?? item.actorWorkerId) : item.kind === "head" ? 0 : laneOf(item.actorWorkerId);
				const target = item.kind === "message" ? laneOf(item.peerWorkerId) : item.kind === "head" && item.peerWorkerId ? laneOf(item.peerWorkerId) : null;
				return { item, column, x: x(column), y: y(home), lane: lanes[home], targetY: target === null ? null : y(target), targetLane: target === null ? null : lanes[target] };
			});
			return { lanes, marks, width: FLOW.pad * 2 + Math.max(items.length, 8) * FLOW.column, height: FLOW.pad * 2 + lanes.length * FLOW.lane + FLOW.axis, y };
		}

		/** Who talks to whom: directed message counts, busiest pairs first. */
		function messagePairs(progress) {
			const pairs = new Map();
			for (const item of progress.interactions ?? []) {
				if (item.kind !== "message") continue;
				const key = item.actorWorkerId + "→" + item.peerWorkerId;
				const pair = pairs.get(key) ?? { from: item.actorWorkerId, to: item.peerWorkerId, count: 0, last: 0 };
				pair.count += 1; pair.last = Math.max(pair.last, item.createdAt);
				pairs.set(key, pair);
			}
			return [...pairs.values()].sort((a, b) => b.count - a.count || b.last - a.last);
		}

		function flowGlyph(mark) {
			const { item, x, y, lane } = mark;
			const color = lane.color;
			const bg = "var(--dsw-alias-bg-layer-1)";
			switch (item.kind) {
				case "message": return [
					h("path", { key: "a", d: `M ${x} ${y} C ${x + FLOW.column * .7} ${y}, ${x + FLOW.column * .1} ${mark.targetY}, ${x + FLOW.column * .5} ${mark.targetY}`, fill: "none", strokeWidth: 2, strokeLinecap: "round", style: { stroke: color, opacity: .8 } }),
					h("circle", { key: "s", cx: x, cy: y, r: 4.5, style: { fill: color } }),
					h("circle", { key: "t", cx: x + FLOW.column * .5, cy: mark.targetY, r: 3.5, strokeWidth: 2, style: { fill: bg, stroke: color } })];
				case "finding": return [h("rect", { key: "d", x: x - 5, y: y - 5, width: 10, height: 10, rx: 1.5, transform: `rotate(45 ${x} ${y})`, strokeWidth: 2, style: { fill: item.status === "fail" ? "var(--dsw-alias-state-error-primary)" : bg, stroke: item.status === "fail" ? "var(--dsw-alias-state-error-primary)" : color } })];
				case "task": return [h("rect", { key: "q", x: x - 5, y: y - 5, width: 10, height: 10, rx: 3, strokeWidth: 2, style: { fill: ["done", "claimed"].includes(item.status) ? color : bg, stroke: ["blocked", "cancelled"].includes(item.status) ? "var(--dsw-alias-state-warn-primary)" : color, opacity: item.status === "cancelled" ? .5 : 1 } })];
				case "proposal": return item.status === "rejected"
					? [h("path", { key: "x", d: `M ${x - 5} ${y - 5} L ${x + 5} ${y + 5} M ${x + 5} ${y - 5} L ${x - 5} ${y + 5}`, strokeWidth: 2.5, strokeLinecap: "round", style: { stroke: "var(--dsw-alias-state-error-primary)" } })]
					: [h("path", { key: "p", d: `M ${x} ${y - 6} L ${x + 6} ${y + 5} L ${x - 6} ${y + 5} Z`, strokeWidth: 2, strokeLinejoin: "round", style: { fill: item.status === "accepted" ? color : bg, stroke: color } })];
				case "head": return [
					mark.targetY !== null ? h("path", { key: "l", d: `M ${x} ${mark.targetY} L ${x} ${y}`, strokeWidth: 2.5, strokeDasharray: "1 5", strokeLinecap: "round", style: { stroke: mark.targetLane.color } }) : null,
					h("circle", { key: "h", cx: x, cy: y, r: 7, strokeWidth: 3, style: { fill: bg, stroke: TRACK_TRUNK } }),
					h("circle", { key: "c", cx: x, cy: y, r: 2.5, style: { fill: TRACK_TRUNK } })];
				default: return [];
			}
		}

		/**
		 * Card position inside the flow stage for one mark, in stage pixels. Flips left near
		 * the right edge and above in the lower half so the card stays visible.
		 */
		function flowHoverPosition(mark, view) {
			const x = view.headWidth + mark.x - view.scrollLeft;
			const y = mark.y - view.scrollTop + view.top;
			const left = x + 18 + FLOW_CARD_WIDTH > view.width ? Math.max(8, x - 18 - FLOW_CARD_WIDTH) : x + 18;
			return { left, top: y, above: y > view.height / 2 };
		}
		const FLOW_CARD_WIDTH = 340;
		function FlowSection({ t, progress, conversation }) {
			const [kind, setKind] = React.useState("all");
			const [hover, setHover] = React.useState(null);
			const scroll = React.useRef(null);
			const stage = React.useRef(null);
			const supported = Array.isArray(progress.interactions);
			const all = progress.interactions ?? [];
			const latest = all.at(-1)?.seq ?? 0;
			// Keep the newest events in view as the run advances.
			React.useEffect(() => { const node = scroll.current; if (node) node.scrollLeft = node.scrollWidth; }, [latest, kind]);
			const names = new Map(progress.workers.map((worker, number) => [worker.id, workerName(t, worker, number + 1)]));
			const name = (id) => id === null ? t("flow.host", {}) : names.get(id) ?? id;
			const tasks = new Map((progress.taskBoard?.items ?? []).map((task) => [task.id, task.subject]));
			const describe = (item) => {
				const vars = { actor: name(item.actorWorkerId), peer: name(item.peerWorkerId), task: (item.taskId && tasks.get(item.taskId)) || item.taskId || item.objectId, id: item.objectId.slice(0, 12) };
				switch (item.kind) {
					case "message": return t("flow.say.message", vars);
					case "finding": return t("flow.say.finding", { ...vars, kind: FINDING_KINDS.includes(item.status) ? t("flow.finding." + item.status, {}) : item.status });
					case "task": return t("flow.say.task", { ...vars, status: label(t, "task", item.status) });
					case "proposal": return t("flow.say.proposal", { ...vars, actor: name(item.peerWorkerId ?? item.actorWorkerId), status: label(t, "proposal", item.status) });
					case "head": return t(item.peerWorkerId ? "flow.say.head" : "flow.say.headHost", { ...vars, id: item.objectId.slice(0, 7) });
					default: return item.kind;
				}
			};
			const stats = {
				message: all.filter((item) => item.kind === "message").length,
				finding: all.filter((item) => item.kind === "finding").length,
				proposal: all.filter((item) => item.kind === "proposal" && item.status === "queued").length,
				head: all.filter((item) => item.kind === "head").length,
			};
			const { lanes, marks, width, height, y } = flowLayout(progress, kind);
			const pairs = messagePairs(progress).slice(0, 6);
			const peak = pairs[0]?.count ?? 1;
			let lastTick = -Infinity, lastLabel = "";
			const ticks = marks.flatMap((mark) => {
				const text = new Date(mark.item.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
				if (text === lastLabel || mark.column - lastTick < 3) return [];
				lastTick = mark.column; lastLabel = text;
				return [h("text", { key: "t" + mark.item.seq, x: mark.x, y: height - 8, className: "dshSwarm_flowTick", textAnchor: "middle" }, text)];
			});
			const show = (mark, pinned) => {
				const node = scroll.current, box = stage.current;
				const position = flowHoverPosition(mark, {
					headWidth: node?.querySelector(".dshSwarm_laneHeads")?.offsetWidth ?? 150, scrollLeft: node?.scrollLeft ?? 0, scrollTop: node?.scrollTop ?? 0,
					top: node ? node.offsetTop : 0, width: box?.clientWidth ?? 1000, height: box?.clientHeight ?? 400,
				});
				setHover((value) => value?.pinned && !pinned ? value : { seq: mark.item.seq, pinned, ...position });
				if ((mark.item.kind === "message" || mark.item.kind === "finding") && conversation) conversation.loadAround(mark.item.seq);
			};
			const hide = () => setHover((value) => value?.pinned ? value : null);
			const hovered = hover ? marks.find((mark) => mark.item.seq === hover.seq) : null;
			const card = (mark) => {
				const item = mark.item;
				const body = conversation?.bodies.get(item.seq);
				const kindLabel = item.kind === "head" ? t("flow.legend.head", {}) : t("flow.kind." + item.kind, {});
				const task = item.taskId ? tasks.get(item.taskId) : null;
				const chips = body?.kind === "finding" ? [...body.scope.map((value) => [t("conv.scope", {}), value]), ...body.evidenceRefs.map((value) => [t("conv.evidence", {}), value])] : [];
				const detail = item.kind === "message" || item.kind === "finding"
					? body ? h(React.Fragment, {},
						h("p", { className: "dshSwarm_hoverBody" }, body.body),
						body.truncated ? h("p", { className: "dshSwarm_subtle" }, t("conv.truncated", {})) : null,
						chips.length ? h("div", { className: "dshSwarm_convRefs dshSwarm_hoverRefs" }, chips.slice(0, 4).map(([name, value], index) => h("span", { key: index, className: "dshSwarm_convRef" }, name, " ", h("code", {}, value))), chips.length > 4 ? h("span", { className: "dshSwarm_convRef" }, "+" + (chips.length - 4)) : null) : null)
						: h("p", { className: "dshSwarm_subtle" }, t(!conversation?.available ? "hover.noBody" : conversation.state.error ? "hover.failed" : "conv.loading", {}))
					: item.kind === "head" ? h("p", { className: "dshSwarm_hoverBody" }, h("code", {}, item.objectId))
						: h("p", { className: "dshSwarm_hoverBody" }, task ?? h("code", {}, item.taskId ?? item.objectId));
				return h("div", {
					className: "dshSwarm_hoverCard", role: hover.pinned ? "dialog" : "tooltip", "aria-label": describe(item), "data-pinned": hover.pinned, "data-above": hover.above,
					style: { left: hover.left + "px", top: hover.top + "px", width: FLOW_CARD_WIDTH + "px", borderTopColor: mark.lane.color },
				},
					h("div", { className: "dshSwarm_hoverHead" },
						h("span", { className: "dshSwarm_convTag", "data-finding": item.kind === "finding" ? item.status : undefined }, kindLabel),
						h("span", { className: "dshSwarm_convMeta" }, h("code", {}, "#" + item.seq), h("time", { dateTime: new Date(item.createdAt).toISOString() }, new Date(item.createdAt).toLocaleString())),
						hover.pinned ? h("button", { type: "button", className: "dshSwarm_hoverClose", "aria-label": t("hover.close", {}), onClick: () => setHover(null) }, "×") : null),
					h("div", { className: "dshSwarm_hoverTitle" }, describe(item)),
					detail,
					hover.pinned ? null : h("p", { className: "dshSwarm_hoverHint" }, t("hover.pin", {})));
			};
			const stat = (key, value) => h("div", { className: "dshSwarm_flowStat", key }, h("strong", {}, String(value)), h("span", {}, t("flow.stat." + key, {})));
			return h("section", { className: "dshSwarm_section dshSwarm_flow", "aria-label": t("flow.title", {}) },
				h("div", { className: "dshSwarm_memberHead" },
					h("div", { className: "dshSwarm_memberIntro" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("flow.title", {})), h("p", { className: "dshSwarm_subtle" }, t("flow.note", {}))),
					h("div", { className: "dshSwarm_flowStats" }, stat("message", stats.message), stat("finding", stats.finding), stat("proposal", stats.proposal), stat("head", stats.head))),
				!supported ? h("p", { className: "dshSwarm_notice", role: "status" }, t("flow.unavailable", {})) : null,
				supported ? h("div", { className: "dshSwarm_memberFilters", role: "group", "aria-label": t("flow.filter", {}) }, flowKinds.map((id) => h("button", { key: id, type: "button", className: "dshSwarm_button dshSwarm_memberFilter", "aria-pressed": kind === id, onClick: () => setKind(id) }, t("flow.kind." + id, {})))) : null,
				supported ? h("div", { className: "dshSwarm_trackLegend" },
					h("span", {}, h("i", { className: "dshSwarm_flowKey", "data-k": "message", "aria-hidden": true }), t("flow.kind.message", {})),
					h("span", {}, h("i", { className: "dshSwarm_flowKey", "data-k": "finding", "aria-hidden": true }), t("flow.kind.finding", {})),
					h("span", {}, h("i", { className: "dshSwarm_flowKey", "data-k": "task", "aria-hidden": true }), t("flow.kind.task", {})),
					h("span", {}, h("i", { className: "dshSwarm_flowKey", "data-k": "proposal", "aria-hidden": true }), t("flow.kind.proposal", {})),
					h("span", {}, h("i", { className: "dshSwarm_flowKey", "data-k": "head", "aria-hidden": true }), t("flow.legend.head", {})),
					h("span", { className: "dshSwarm_trackAxis" }, t("flow.axis", {}))) : null,
				supported && marks.length ? h("div", { className: "dshSwarm_flowStage", ref: stage, onKeyDown: (event) => { if (event.key === "Escape") setHover(null); } },
				h("div", { className: "dshSwarm_gitScroll dshSwarm_flowScroll", ref: scroll, tabIndex: 0, role: "region", "aria-label": t("flow.chart", {}), onScroll: () => setHover(null) },
					h("div", { className: "dshSwarm_trackRow" },
						h("div", { className: "dshSwarm_laneHeads", "aria-hidden": true, style: { paddingTop: FLOW.pad + "px" } }, lanes.map((lane) => h("div", { key: String(lane.key), className: "dshSwarm_laneHead", "data-trunk": !!lane.host, style: { height: FLOW.lane + "px", borderInlineStartColor: lane.color } },
							h("span", { className: "dshSwarm_laneName" }, h("i", { style: { background: lane.color } }), lane.host ? t("flow.host", {}) : name(lane.key)),
							h("span", { className: "dshSwarm_laneBranch" }, lane.host ? t("flow.hostNote", {}) : lane.key)))),
						h("div", { className: "dshSwarm_trackCanvas", style: { width: width + "px", height: height + "px" } },
							h("svg", { className: "dshSwarm_trackEdges", width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": t("flow.chart", {}) },
								lanes.map((lane, index) => h("rect", { key: "b" + index, x: 0, y: FLOW.pad + index * FLOW.lane, width, height: FLOW.lane, className: "dshSwarm_trackBand", "data-odd": index % 2 === 1 })),
								lanes.map((lane, index) => h("line", { key: "r" + index, x1: 0, x2: width, y1: y(index), y2: y(index), strokeWidth: lane.host ? 3 : 2, style: { stroke: lane.color, opacity: lane.host ? .25 : .18 } })),
								marks.map((mark) => h("g", {
									key: mark.item.seq, className: "dshSwarm_flowMark", tabIndex: 0, role: "button", "aria-label": describe(mark.item), "data-active": hover?.seq === mark.item.seq,
									onMouseEnter: () => show(mark, false), onMouseLeave: hide, onFocus: () => show(mark, false), onBlur: hide,
									onClick: () => show(mark, true), onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); show(mark, true); } },
								},
									// Invisible hit area so small glyphs are easy to point at.
									h("circle", { cx: mark.x, cy: mark.y, r: 14, className: "dshSwarm_flowHit" }),
									flowGlyph(mark))),
								ticks)))),
				hovered ? card(hovered) : null) : supported ? h("p", { className: "dshSwarm_empty" }, t("flow.empty", {})) : null,
				supported && all.length ? h("div", { className: "dshSwarm_flowBottom" },
					h("div", { className: "dshSwarm_flowPanel" }, h("h3", { className: "dshSwarm_flowPanelTitle" }, t("flow.pairs", {})),
						pairs.length ? h("ul", { className: "dshSwarm_pairs" }, pairs.map((pair) => {
							const fromIndex = progress.workers.findIndex((worker) => worker.id === pair.from);
							const toIndex = progress.workers.findIndex((worker) => worker.id === pair.to);
							return h("li", { key: pair.from + pair.to, className: "dshSwarm_pair" },
								h("span", { className: "dshSwarm_pairNames" }, h("i", { style: { background: workerColor(Math.max(0, fromIndex)) } }), name(pair.from), h("span", { className: "dshSwarm_pairArrow", "aria-label": t("flow.to", {}) }, "→"), h("i", { style: { background: workerColor(Math.max(0, toIndex)) } }), name(pair.to)),
								h("span", { className: "dshSwarm_pairBar", "aria-hidden": true }, h("span", { style: { width: pair.count / peak * 100 + "%", background: workerColor(Math.max(0, fromIndex)) } })),
								h("span", { className: "dshSwarm_pairCount" }, "×" + pair.count));
						})) : h("p", { className: "dshSwarm_laneEmpty" }, t("flow.noPairs", {}))),
					h("div", { className: "dshSwarm_flowPanel" }, h("h3", { className: "dshSwarm_flowPanelTitle" }, t("flow.feed", {})),
						h("ol", { className: "dshSwarm_flowFeed" }, [...all].reverse().slice(0, 14).map((item) => {
							const owner = item.kind === "task" || item.kind === "proposal" || item.kind === "head" ? item.peerWorkerId ?? item.actorWorkerId : item.actorWorkerId;
							const lane = progress.workers.findIndex((worker) => worker.id === owner);
							return h("li", { key: item.seq, className: "dshSwarm_flowItem", "data-kind": item.kind },
								h("i", { "aria-hidden": true, style: { background: lane < 0 ? TRACK_TRUNK : workerColor(lane) } }),
								h("span", { className: "dshSwarm_flowText" }, describe(item)), timeElement(item.createdAt));
						})))) : null);
		}

		/** Validate the owner conversation page at the unknown-codec boundary. */
		function readConversationPage(page, runId) {
			if (page === null || (object(page) && page.runId !== runId)) throw Object.assign(new Error("Run changed or is unavailable"), { code: "history/run-changed" });
			const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
			const item = (value) => object(value) && ["message", "finding"].includes(value.kind) && typeof value.id === "string" && count(value.seq) && typeof value.authorWorkerId === "string" && typeof value.body === "string" && typeof value.truncated === "boolean" && validTime(value.createdAt)
				&& (value.kind === "message" ? typeof value.targetWorkerId === "string" : typeof value.findingKind === "string" && textOrNull(value.taskId) && strings(value.scope) && strings(value.evidenceRefs) && textOrNull(value.supersedesId));
			if (!object(page) || typeof page.runId !== "string" || !Array.isArray(page.items) || !page.items.every(item) || !(page.nextBeforeSeq === null || count(page.nextBeforeSeq))) throw Object.assign(new Error("Invalid conversation page"), { code: "history/invalid" });
			return page;
		}
		/** Merge pages by seq, newest first; a refreshed first page never drops loaded older items. */
		function mergeConversation(current, incoming) {
			const bySeq = new Map(current.map((item) => [item.seq, item]));
			for (const item of incoming) bySeq.set(item.seq, item);
			return [...bySeq.values()].sort((a, b) => b.seq - a.seq);
		}
		const conversationKinds = ["all", "message", "finding"];
		/**
		 * Owner-only reader of what workers actually said: message bodies and findings with
		 * scope and evidence. Loaded on demand from the Host, refreshed when new
		 * message/finding events appear in the progress stream.
		 */
		/**
		 * Owner conversation bodies shared by the swimlane hover cards and the reader below.
		 * The newest page reloads when new message/finding events arrive; `loadAround`
		 * fetches the page ending at one older event without moving the reader's cursor.
		 */
		function useConversation(progress, sessionId, loadConversation) {
			const [state, setState] = React.useState({ items: [], next: null, loading: false, error: null, started: false });
			const request = React.useRef(null);
			const around = React.useRef(new Map());
			const available = typeof loadConversation === "function";
			const latest = (progress.interactions ?? []).filter((item) => item.kind === "message" || item.kind === "finding").at(-1)?.seq ?? 0;
			const load = (beforeSeq) => {
				if (!available) return;
				request.current?.abort();
				const controller = new AbortController(); request.current = controller;
				setState((value) => ({ ...value, loading: true, error: null }));
				Promise.resolve().then(() => loadConversation(sessionId, beforeSeq, controller.signal)).then((raw) => {
					if (controller.signal.aborted) return;
					const page = readConversationPage(raw, progress.runId);
					// A refresh only re-reads the newest page; keep the older-page cursor already reached.
					setState((value) => ({ items: mergeConversation(value.items, page.items), next: beforeSeq === null && value.items.length > page.items.length ? value.next : page.nextBeforeSeq, loading: false, error: null, started: true }));
				}).catch((error) => {
					if (!controller.signal.aborted) setState((value) => ({ ...value, loading: false, started: true, error: { code: error?.code ?? null, message: error instanceof Error ? error.message : String(error) } }));
				}).finally(() => { if (request.current === controller) request.current = null; });
			};
			const loadAround = (seq) => {
				if (!available || around.current.has(seq) || state.items.some((item) => item.seq === seq)) return;
				const controller = new AbortController(); around.current.set(seq, controller);
				Promise.resolve().then(() => loadConversation(sessionId, seq + 1, controller.signal)).then((raw) => {
					if (controller.signal.aborted) return;
					const page = readConversationPage(raw, progress.runId);
					setState((value) => ({ ...value, items: mergeConversation(value.items, page.items) }));
				}).catch(() => { /* The hover card falls back to metadata; the reader still reports errors. */ });
			};
			React.useEffect(() => { load(null); return () => { request.current?.abort(); request.current = null; }; }, [sessionId, progress.runId, latest, available]);
			React.useEffect(() => () => { for (const controller of around.current.values()) controller.abort(); around.current.clear(); }, [sessionId, progress.runId]);
			return { state, load, loadAround, available, bodies: new Map(state.items.map((item) => [item.seq, item])) };
		}
		/** Swimlanes and the reader share one conversation state. */
		function FlowPanel({ t, progress, sessionId, loadConversation }) {
			const conversation = useConversation(progress, sessionId, loadConversation);
			return h(React.Fragment, {}, h(FlowSection, { t, progress, conversation }), h(ConversationSection, { t, progress, conversation }));
		}
		function ConversationSection({ t, progress, conversation }) {
			const { state, load, available } = conversation;
			const [kind, setKind] = React.useState("all");
			const [member, setMember] = React.useState(null);
			const names = new Map(progress.workers.map((worker, number) => [worker.id, workerName(t, worker, number + 1)]));
			const color = (id) => { const index = progress.workers.findIndex((worker) => worker.id === id); return index < 0 ? TRACK_TRUNK : workerColor(index); };
			const name = (id) => names.get(id) ?? id;
			const tasks = new Map((progress.taskBoard?.items ?? []).map((task) => [task.id, task.subject]));
			const items = state.items.filter((item) => (kind === "all" || item.kind === kind) && (member === null || item.authorWorkerId === member || item.targetWorkerId === member));
			const person = (id) => h("span", { className: "dshSwarm_convPerson" }, h("i", { "aria-hidden": true, style: { background: color(id) } }), name(id));
			const entry = (item) => h("li", { key: item.seq, className: "dshSwarm_convItem", "data-kind": item.kind, "data-finding": item.kind === "finding" ? item.findingKind : undefined, style: { borderInlineStartColor: color(item.authorWorkerId) } },
				h("div", { className: "dshSwarm_convHead" },
					h("span", { className: "dshSwarm_avatar dshSwarm_avatarSmall", "aria-hidden": true, style: { background: color(item.authorWorkerId) } }, initials(name(item.authorWorkerId))),
					h("span", { className: "dshSwarm_convWho" }, person(item.authorWorkerId),
						item.kind === "message" ? h(React.Fragment, {}, h("span", { className: "dshSwarm_pairArrow", "aria-label": t("flow.to", {}) }, "→"), person(item.targetWorkerId))
							: h("span", { className: "dshSwarm_convTag", "data-finding": item.findingKind }, FINDING_KINDS.includes(item.findingKind) ? t("flow.finding." + item.findingKind, {}) : item.findingKind)),
					h("span", { className: "dshSwarm_convMeta" }, h("code", {}, "#" + item.seq), timeElement(item.createdAt))),
				h("p", { className: "dshSwarm_convBody" }, item.body),
				item.truncated ? h("p", { className: "dshSwarm_subtle" }, t("conv.truncated", {})) : null,
				item.kind === "finding" && (item.taskId || item.scope.length || item.evidenceRefs.length || item.supersedesId) ? h("div", { className: "dshSwarm_convRefs" },
					item.taskId ? h("span", { className: "dshSwarm_convRef" }, t("conv.task", {}), " ", tasks.get(item.taskId) ?? h("code", {}, item.taskId)) : null,
					item.scope.map((value, index) => h("span", { key: "s" + index, className: "dshSwarm_convRef" }, t("conv.scope", {}), " ", h("code", {}, value))),
					item.evidenceRefs.map((value, index) => h("span", { key: "e" + index, className: "dshSwarm_convRef" }, t("conv.evidence", {}), " ", h("code", {}, value))),
					item.supersedesId ? h("span", { className: "dshSwarm_convRef" }, t("conv.supersedes", {}), " ", h("code", {}, item.supersedesId)) : null) : null);
			const errorText = state.error?.code === "history/run-changed" ? t("git.missingRun", {}) : state.error?.code === "history/invalid" ? t("conv.invalid", {}) : state.error?.message;
			return h("section", { className: "dshSwarm_section dshSwarm_conv", "aria-label": t("conv.title", {}) },
				h("div", { className: "dshSwarm_memberHead" },
					h("div", { className: "dshSwarm_memberIntro" }, h("h2", { className: "dshSwarm_sectionTitle" }, t("conv.title", {})), h("p", { className: "dshSwarm_subtle" }, t("conv.note", {}))),
					h("button", { type: "button", className: "dshSwarm_button", disabled: !available || state.loading, onClick: () => load(null) }, t("conv.refresh", {}))),
				!available ? h("p", { className: "dshSwarm_notice", role: "status" }, t("conv.unavailable", {})) : h(React.Fragment, {},
					h("div", { className: "dshSwarm_memberFilters", role: "group", "aria-label": t("conv.filter", {}) },
						conversationKinds.map((id) => h("button", { key: id, type: "button", className: "dshSwarm_button dshSwarm_memberFilter", "aria-pressed": kind === id, onClick: () => setKind(id) }, t("conv.kind." + id, {}))),
						h("span", { className: "dshSwarm_convDivider", "aria-hidden": true }),
						h("button", { type: "button", className: "dshSwarm_button dshSwarm_memberFilter", "aria-pressed": member === null, onClick: () => setMember(null) }, t("workers.all", { count: progress.workers.length })),
						progress.workers.map((worker, number) => h("button", { key: worker.id, type: "button", className: "dshSwarm_button dshSwarm_memberFilter", "aria-pressed": member === worker.id, onClick: () => setMember(worker.id) }, h("i", { className: "dshSwarm_filterDot", "aria-hidden": true, style: { background: workerColor(number) } }), workerName(t, worker, number + 1)))),
					state.error ? h("p", { className: "dshSwarm_notice", role: "alert" }, t("conv.failed", {}), ": ", errorText) : null,
					items.length ? h("ol", { className: "dshSwarm_convList", "aria-live": "polite", "aria-busy": state.loading }, items.map(entry))
						: state.started && !state.loading ? h("p", { className: "dshSwarm_laneEmpty" }, t(state.items.length ? "conv.noMatch" : "conv.empty", {})) : null,
					h("div", { className: "dshSwarm_gitFooter" },
						state.loading ? h("span", { className: "dshSwarm_subtle", role: "status" }, t("conv.loading", {})) : null,
						state.next !== null && !state.loading ? h("button", { type: "button", className: "dshSwarm_button", onClick: () => load(state.next) }, t("conv.more", {})) : null,
						state.started && state.next === null && state.items.length ? h("span", { className: "dshSwarm_subtle" }, t("conv.end", { count: state.items.length })) : null)));
		}

		const publicViews = ["channels", "threads", "messages", "requests", "agreements", "attention", "activity", "message_revisions", "agreement_versions"];
		function publicQueryInput(value) {
			if (!object(value) || !publicViews.includes(value.view)) throw new TypeError("Invalid public query view");
			const keys = ["view", "channelId", "threadId", "taskId", "messageId", "agreementId", "findingId", "workerId", "query", "status", "cursor", "limit", "includeAcknowledged"];
			if (Object.keys(value).some((key) => !keys.includes(key))) throw new TypeError("Unknown public query field");
			for (const key of ["channelId", "threadId", "taskId", "messageId", "agreementId", "findingId", "workerId"]) if (value[key] !== undefined && !(typeof value[key] === "string" && value[key].trim() && value[key].length <= 240)) throw new TypeError("Invalid public query ID");
			if (value.query !== undefined && !(typeof value.query === "string" && value.query.length <= 200)) throw new TypeError("Invalid public search");
			if (value.cursor !== undefined && !(typeof value.cursor === "string" && value.cursor.length <= 2000)) throw new TypeError("Invalid public cursor");
			if (value.limit !== undefined && !(count(value.limit) && value.limit >= 1 && value.limit <= 20)) throw new TypeError("Invalid public page limit");
			if (value.status !== undefined && !["active", "archived", "open", "resolved", "pending", "responded", "withdrawn"].includes(value.status)) throw new TypeError("Invalid public status");
			if (value.includeAcknowledged !== undefined && typeof value.includeAcknowledged !== "boolean") throw new TypeError("Invalid acknowledgement filter");
			return { ...value };
		}
		/** Strict render boundary for public records. No trusted HTML or private-message fallback. */
		function readPublicPage(page, runId) {
			const bad = () => { throw Object.assign(new Error("Invalid public history page"), { code: "public/invalid" }); };
			if (!object(page) || page.runId !== runId) throw Object.assign(new Error("Run changed or is unavailable"), { code: "history/run-changed" });
			const txt = (value, max = 240) => typeof value === "string" && value.length <= max;
			const id = (value) => txt(value) && value.length > 0;
			const nullable = (value) => value === null || id(value);
			const ids = (value) => Array.isArray(value) && value.length <= 100 && value.every(id);
			const positive = (value) => count(value) && value > 0;
			const confirmations = (value) => Array.isArray(value) && value.length <= 100 && value.every((entry) => object(entry) && id(entry.workerId) && positive(entry.version) && validTime(entry.confirmedAt));
			const revision = (value) => object(value) && positive(value.revision) && txt(value.body, 12000) && ids(value.mentions) && ids(value.taskIds) && ids(value.findingIds) && ids(value.proposalIds) && validTime(value.editedAt);
			const version = (value) => object(value) && positive(value.version) && txt(value.content, 12000) && ids(value.sourceMessageIds) && ids(value.taskIds) && ids(value.stakeholderWorkerIds) && validTime(value.createdAt);
			const valid = (item) => {
				if (!object(item)) return false;
				const v = item[item.kind];
				switch (item.kind) {
					case "channel": return object(v) && id(v.id) && txt(v.name, 64) && txt(v.purpose, 1000) && nullable(v.createdByWorkerId) && ["active", "archived"].includes(v.status) && positive(v.revision);
					case "thread": return object(v) && id(v.id) && id(v.channelId) && txt(v.title) && id(v.createdByWorkerId) && ids(v.participantWorkerIds) && ids(v.taskIds) && ids(v.findingIds) && ["open", "resolved"].includes(v.status) && nullable(v.conclusionMessageId) && positive(v.revision);
					case "message": return revision(v) && v.kind === "public" && id(v.id) && id(v.channelId) && id(v.threadId) && id(v.authorWorkerId) && nullable(v.replyToMessageId) && typeof v.announcement === "boolean" && validTime(v.createdAt) && count(v.seq) && positive(v.revisionCount);
					case "request": return object(v) && id(v.id) && id(v.channelId) && id(v.threadId) && id(v.messageId) && id(v.requestedByWorkerId) && id(v.targetWorkerId) && nullable(v.responseMessageId) && ids(v.taskIds) && ["pending", "responded", "withdrawn"].includes(v.status) && positive(v.revision);
					case "agreement": return version(v) && id(v.id) && id(v.channelId) && id(v.threadId) && txt(v.title) && id(v.createdByWorkerId) && positive(v.versionCount) && confirmations(v.confirmations);
					case "notification": return object(v) && id(v.id) && id(v.workerId) && id(v.channelId) && nullable(v.threadId) && nullable(v.messageId) && nullable(v.requestId) && nullable(v.agreementId) && ids(v.reasons) && ["immediate", "digest"].includes(v.priority) && timeOrNull(v.deliveredAt) && timeOrNull(v.acknowledgedAt) && count(v.seq);
					case "activity": return id(item.threadId) && id(item.channelId) && txt(item.title) && ["open", "resolved"].includes(item.status) && count(item.updatedSeq) && count(item.messageCount) && count(item.pendingRequestCount) && ids(item.agreementIds) && ids(item.taskIds) && (item.agreementCount === undefined || count(item.agreementCount)) && (item.agreementsTruncated === undefined || typeof item.agreementsTruncated === "boolean");
					case "message_revision": return id(item.messageId) && revision(item.value);
					case "agreement_version": return id(item.agreementId) && version(item.value) && confirmations(item.confirmations);
					default: return false;
				}
			};
			if (!Array.isArray(page.items) || page.items.length > 20 || !page.items.every(valid) || !count(page.total) || page.total < page.items.length || !count(page.snapshotSeq) || typeof page.hasMore !== "boolean" || typeof page.truncated !== "boolean" || !(page.nextCursor === null || (txt(page.nextCursor, 2000) && page.nextCursor.length > 0)) || page.hasMore !== (page.nextCursor !== null)) bad();
			return page;
		}
		const initialPublic = (sessionId, runId, queryKey = "") => ({ sessionId, runId, queryKey, page: null, cursor: null, history: [], loading: false, error: null });
		/** Own one bounded page and request; changing scope or disposing rejects late async results. */
		function createPublicPager({ sessionId, runId, loadPublic, onChange }) {
			let state = initialPublic(sessionId, runId), request = null, disposed = false, query = { view: "channels" };
			const publish = (patch) => { if (!disposed) { state = { ...state, ...patch }; onChange(state); } };
			const load = async (cursor, history) => {
				if (disposed || request) return;
				const controller = new AbortController(); request = controller;
				publish({ loading: true, error: null });
				try {
					const raw = await loadPublic(sessionId, runId, { ...query, ...(cursor === null ? {} : { cursor }) }, controller.signal);
					if (disposed || controller.signal.aborted || request !== controller) return;
					const page = readPublicPage(raw, runId);
					if (page.nextCursor !== null && (page.nextCursor === cursor || history.includes(page.nextCursor))) throw Object.assign(new Error("Public cursor did not advance"), { code: "public/invalid" });
					publish({ page, cursor, history });
				} catch (error) { if (!disposed && !controller.signal.aborted && request === controller) publish({ error: { code: error?.code ?? null, message: error instanceof Error ? error.message : String(error) } }); }
				finally { if (request === controller) { request = null; publish({ loading: false }); } }
			};
			return {
				reset(next) { if (disposed) return; query = publicQueryInput(next); delete query.cursor; request?.abort(); request = null; state = initialPublic(sessionId, runId, JSON.stringify(query)); return load(null, []); },
				next() { if (state.page?.nextCursor) return load(state.page.nextCursor, [...state.history, state.cursor]); },
				previous() { if (state.history.length) return load(state.history.at(-1), state.history.slice(0, -1)); },
				refresh() { this.reset(query); },
				dispose() { disposed = true; request?.abort(); request = null; }
			};
		}
		function usePublicPage(sessionId, runId, loadPublic, available, query) {
			const key = JSON.stringify(query);
			const [state, setState] = React.useState(() => initialPublic(sessionId, runId, key));
			const pager = React.useRef(null);
			React.useEffect(() => {
				if (!available) return undefined;
				const owned = createPublicPager({ sessionId, runId, loadPublic, onChange: setState }); pager.current = owned; owned.reset(query);
				return () => { owned.dispose(); if (pager.current === owned) pager.current = null; };
			}, [sessionId, runId, loadPublic, available, key]);
			return { state: state.sessionId === sessionId && state.runId === runId && state.queryKey === key ? state : initialPublic(sessionId, runId, key), pager };
		}
		function PublicPagination({ t, reader }) {
			const { state, pager } = reader;
			return h("div", { className: "dshSwarm_gitFooter" },
				state.loading ? h("span", { role: "status" }, t("public.loading", {})) : null,
				state.page ? h("span", { className: "dshSwarm_subtle" }, t("public.page", { page: state.history.length + 1, total: state.page.total })) : null,
				h("button", { type: "button", className: "dshSwarm_button", disabled: state.loading || !state.history.length, onClick: () => pager.current?.previous() }, t("public.previous", {})),
				h("button", { type: "button", className: "dshSwarm_button", disabled: state.loading || !state.page?.hasMore, onClick: () => pager.current?.next() }, t("public.next", {})));
		}
		/** Render exact discussion records; buttons navigate IDs rather than guessing chat links. */
		function PublicRecord({ t, item, progress, navigate, contextMessages = [] }) {
			const names = new Map(progress.workers.map((worker, index) => [worker.id, workerName(t, worker, index + 1)]));
			const name = (id) => names.get(id) ?? id;
			const action = (text, query, key) => h("button", { key, type: "button", className: "dshSwarm_button", onClick: () => navigate(query) }, text);
			const locate = (id, label) => id ? action((label ?? t("public.locate", {})) + " · " + id, { view: "messages", messageId: id }, id) : null;
			const refs = (record) => h("div", { className: "dshSwarm_publicRefs" },
				(record.taskIds ?? []).map((id) => action(t("public.tasks", {}) + " · " + id, { view: "threads", taskId: id }, "t" + id)),
				(record.findingIds ?? []).map((id) => action(t("public.findings", {}) + " · " + id, { view: "threads", findingId: id }, "f" + id)),
				(record.proposalIds ?? []).map((id) => h("span", { key: id, className: "dshSwarm_badge" }, t("public.proposals", {}), " · ", h("code", {}, id))));
			const body = (value) => h("p", { className: "dshSwarm_publicBody" }, value);
			const replyContext = (value) => {
				const parent = contextMessages.find((message) => message.id === value.replyToMessageId);
				return parent ? h("blockquote", { className: "dshSwarm_notice" }, h("strong", {}, t("public.reply", {}), " · ", name(parent.authorWorkerId)), parent.body.slice(0, 300), parent.body.length > 300 ? "…" : "") : null;
			};
			const people = (label, ids) => ids.length ? h("p", { className: "dshSwarm_publicStatus" }, label, ": ", ids.map(name).join(" · ")) : null;
			const status = (value) => badge(t("public.status." + value, {}), value === "pending" || value === "open" ? "dshSwarm_warn" : "");
			const agreementBody = (value, confirmations) => h(React.Fragment, {}, body(value.content),
				people(t("public.stakeholders", {}), value.stakeholderWorkerIds),
				people(t("public.confirmed", {}), confirmations.filter((entry) => entry.version === value.version).map((entry) => entry.workerId)),
				people(t("public.unconfirmed", {}), value.stakeholderWorkerIds.filter((id) => !confirmations.some((entry) => entry.workerId === id && entry.version === value.version))),
				h("div", { className: "dshSwarm_publicRefs" }, confirmations.filter((entry) => entry.version === value.version).map((entry) => h("span", { key: entry.workerId, className: "dshSwarm_badge" }, name(entry.workerId), " · ", timeElement(entry.confirmedAt)))),
				h("div", { className: "dshSwarm_publicRefs" }, value.sourceMessageIds.map((id) => locate(id, t("public.source", {})))), refs(value));
			let content;
			switch (item.kind) {
				case "thread": { const v = item.thread; content = h(React.Fragment, {}, h("div", { className: "dshSwarm_row" }, h("h3", {}, v.title), status(v.status)),
					people(t("public.author", {}), [v.createdByWorkerId]), people(t("public.participants", {}), v.participantWorkerIds), refs(v),
					h("div", { className: "dshSwarm_publicRefs" }, action(t("public.openThread", {}), { view: "messages", channelId: v.channelId, threadId: v.id }), locate(v.conclusionMessageId, t("public.conclusion", {})))); break; }
				case "message": { const v = item.message; content = h(React.Fragment, {}, h("div", { className: "dshSwarm_row" }, h("strong", {}, name(v.authorWorkerId)), badge(t("public.revision", { version: v.revision })), v.announcement ? badge(t("public.announcement", {}), "dshSwarm_warn") : null, timeElement(v.createdAt)),
					replyContext(v), body(v.body), people(t("public.mentions", {}), v.mentions.map((id) => "@" + name(id))), refs(v), h("div", { className: "dshSwarm_publicRefs" },
						locate(v.replyToMessageId, t("public.reply", {})), action(t("public.openThread", {}), { view: "messages", threadId: v.threadId, channelId: v.channelId }),
						action(t("public.requests", {}), { view: "requests", threadId: v.threadId }), action(t("public.agreements", {}), { view: "agreements", threadId: v.threadId }),
						v.revisionCount > 1 ? action(t("public.history", {}), { view: "message_revisions", messageId: v.id }) : null)); break; }
				case "request": { const v = item.request; content = h(React.Fragment, {}, status(v.status), people(t("public.requestedBy", {}), [v.requestedByWorkerId]), people(t("public.requestedFrom", {}), [v.targetWorkerId]), refs(v),
					h("div", { className: "dshSwarm_publicRefs" }, locate(v.messageId, t("public.source", {})), locate(v.responseMessageId, t("public.response", {})))); break; }
				case "agreement": { const v = item.agreement; content = h(React.Fragment, {}, h("h3", {}, v.title), badge(t("public.version", { version: v.version })), agreementBody(v, v.confirmations),
					h("div", { className: "dshSwarm_publicRefs" }, action(t("public.history", {}), { view: "agreement_versions", agreementId: v.id }), action(t("public.openThread", {}), { view: "messages", threadId: v.threadId }))); break; }
				case "notification": { const v = item.notification; content = h(React.Fragment, {}, people(t("public.workerFilter", {}), [v.workerId]), body(v.reasons.map((reason) => t("public.reason." + reason, {})).join(" · ")),
					h("p", { className: "dshSwarm_publicStatus" }, t(v.deliveredAt === null ? "public.notDelivered" : "public.delivered", {}), " · ", t(v.acknowledgedAt === null ? "public.notAcknowledged" : "public.acknowledged", {})),
					h("div", { className: "dshSwarm_publicRefs" }, locate(v.messageId), v.threadId ? action(t("public.openThread", {}), { view: "messages", threadId: v.threadId }) : null,
						v.agreementId ? action(t("public.agreements", {}), { view: "agreements", agreementId: v.agreementId }) : null)); break; }
				case "activity": content = h(React.Fragment, {}, h("h3", {}, item.title), status(item.status), body(t("public.messages", {}) + ": " + item.messageCount + " · " + t("public.requests", {}) + ": " + item.pendingRequestCount + " · " + t("public.agreements", {}) + ": " + (item.agreementCount ?? item.agreementIds.length)), refs(item), h("div", { className: "dshSwarm_publicRefs" }, action(t("public.openThread", {}), { view: "messages", threadId: item.threadId }), action(t("public.agreements", {}), { view: "agreements", threadId: item.threadId })), item.agreementsTruncated ? h("p", { className: "dshSwarm_subtle" }, t("public.truncated", {})) : null); break;
				case "message_revision": content = h(React.Fragment, {}, badge(t("public.revision", { version: item.value.revision })), timeElement(item.value.editedAt), body(item.value.body), people(t("public.mentions", {}), item.value.mentions), refs(item.value), locate(item.messageId)); break;
				case "agreement_version": content = h(React.Fragment, {}, badge(t("public.version", { version: item.value.version })), timeElement(item.value.createdAt), agreementBody(item.value, item.confirmations)); break;
				default: return null;
			}
			return h("li", { className: "dshSwarm_publicCard", "data-public-kind": item.kind }, h("code", { className: "dshSwarm_subtle" }, item[item.kind]?.id ?? item.messageId ?? item.agreementId ?? item.threadId), content);
		}
		function PublicSection({ t, progress, sessionId, loadPublic }) {
			const available = progress.publicActivity?.protocolVersion === 1 && typeof loadPublic === "function";
			const [selection, setSelection] = React.useState({ view: "threads" });
			const [search, setSearch] = React.useState(""); const [task, setTask] = React.useState(""); const [member, setMember] = React.useState("");
			const latest = progress.publicActivity?.latestSeq ?? 0;
			const channels = usePublicPage(sessionId, progress.runId, loadPublic, available, { view: "channels" });
			const reader = usePublicPage(sessionId, progress.runId, loadPublic, available, selection);
			const contextThread = selection.threadId ?? (selection.messageId ? reader.state.page?.items.find((item) => item.kind === "message")?.message.threadId : undefined);
			const context = usePublicPage(sessionId, progress.runId, loadPublic, available && Boolean(contextThread) && selection.view !== "threads", { view: "threads", ...(contextThread ? { threadId: contextThread } : {}) });
			// Metadata is live; source pagination stays pinned until the reader explicitly refreshes.
			const refresh = () => { channels.pager.current?.refresh(); reader.pager.current?.refresh(); context.pager.current?.refresh(); };
			const navigate = (query) => { setSearch(""); setTask(query.taskId ?? ""); setMember(query.workerId ?? ""); setSelection(query); };
			const error = (state) => state.error ? h("p", { className: "dshSwarm_notice", role: "alert" }, t("public.failed", {}), ": ", state.error.code === "public/invalid" ? t("public.invalid", {}) : state.error.message) : null;
			const states = selection.view === "requests" ? ["pending", "responded", "withdrawn"] : ["threads", "activity"].includes(selection.view) ? ["open", "resolved"] : [];
			return h("section", { className: "dshSwarm_section", "aria-label": t("public.title", {}) },
				h("h2", { className: "dshSwarm_sectionTitle" }, t("public.title", {})), h("p", { className: "dshSwarm_subtle" }, t("public.note", {})),
				!available ? h("p", { className: "dshSwarm_notice", role: "status" }, t("public.unavailable", {})) : h("div", { className: "dshSwarm_publicLayout" },
					h("nav", { className: "dshSwarm_publicChannels", "aria-label": t("public.channels", {}) }, h("h3", { className: "dshSwarm_sectionTitle" }, t("public.channels", {})),
						h("button", { type: "button", className: "dshSwarm_button", "aria-pressed": !selection.channelId, onClick: () => navigate({ view: "threads" }) }, t("public.allChannels", {})),
						(channels.state.page?.items ?? []).filter((item) => item.kind === "channel").map(({ channel }) => h("div", { key: channel.id },
							h("button", { type: "button", className: "dshSwarm_button", "aria-pressed": selection.channelId === channel.id, onClick: () => navigate({ view: "threads", channelId: channel.id }) }, "# " + channel.name),
							h("p", { className: "dshSwarm_subtle" }, channel.purpose), h("p", { className: "dshSwarm_publicStatus" }, t("public.status." + channel.status, {})))), error(channels.state), h(PublicPagination, { t, reader: channels })),
					h("div", {}, h("div", { className: "dshSwarm_filters", role: "group", "aria-label": t("public.title", {}) }, ["threads", "messages", "requests", "agreements", "attention", "activity"].map((view) => h("button", { key: view, type: "button", className: "dshSwarm_filter", "aria-pressed": selection.view === view, onClick: () => navigate({ view, ...(selection.channelId ? { channelId: selection.channelId } : {}), ...(selection.threadId ? { threadId: selection.threadId } : {}) }) }, t("public." + view, {})))),
						h("h3", { className: "dshSwarm_sectionTitle" }, t("public." + selection.view, {})),
						selection.threadId ? h("p", { className: "dshSwarm_subtle" }, h("code", {}, selection.threadId)) : null,
						contextThread && selection.view !== "threads" ? h("ol", { className: "dshSwarm_publicCards" }, (context.state.page?.items ?? []).map((item) => h(PublicRecord, { key: item.thread?.id, t, item, progress, navigate }))) : null,
						contextThread ? error(context.state) : null,
						h("form", { className: "dshSwarm_publicFilters", onSubmit: (event) => { event.preventDefault(); const query = { ...selection }; delete query.query; delete query.taskId; delete query.workerId; if (search.trim()) query.query = search.trim(); if (task.trim()) query.taskId = task.trim(); if (member) query.workerId = member; setSelection(query); } },
							h("label", {}, t("public.search", {}), h("input", { type: "search", maxLength: 200, value: search, onChange: (event) => setSearch(event.target.value) })),
							h("label", {}, t("public.taskFilter", {}), h("input", { maxLength: 240, value: task, onChange: (event) => setTask(event.target.value) })),
							["requests", "attention"].includes(selection.view) ? h("label", {}, t("public.workerFilter", {}), h("select", { value: member, onChange: (event) => setMember(event.target.value) }, h("option", { value: "" }, t("public.allWorkers", {})), progress.workers.map((worker, index) => h("option", { key: worker.id, value: worker.id }, workerName(t, worker, index + 1))))) : null,
							h("button", { type: "submit", className: "dshSwarm_button" }, t("public.apply", {})), h("button", { type: "button", className: "dshSwarm_button", onClick: () => navigate({ view: "threads" }) }, t("public.clear", {}))),
						states.length ? h("div", { className: "dshSwarm_filters" }, ["", ...states].map((status) => h("button", { key: status, type: "button", className: "dshSwarm_filter", "aria-pressed": (selection.status ?? "") === status, onClick: () => { const query = { ...selection }; delete query.status; if (status) query.status = status; setSelection(query); } }, status ? t("public.status." + status, {}) : t("filter.all", {})))) : null,
						reader.state.page && latest > reader.state.page.snapshotSeq ? h("p", { role: "status", className: "dshSwarm_notice" }, t("public.newActivity", {})) : null,
						h("button", { type: "button", className: "dshSwarm_button", disabled: reader.state.loading, onClick: refresh }, t("public.refresh", {})), error(reader.state),
						reader.state.page && !reader.state.page.items.length ? h("p", { className: "dshSwarm_empty" }, t("public.empty", {})) : null,
						h("ol", { className: "dshSwarm_publicCards", "aria-busy": reader.state.loading, "aria-live": "polite" }, (reader.state.page?.items ?? []).map((item, index) => h(PublicRecord, { key: item.kind + ":" + (item[item.kind]?.id ?? item.messageId ?? item.agreementId ?? item.threadId ?? index) + ":" + (item.value?.version ?? item.value?.revision ?? ""), t, item, progress, navigate, contextMessages: (reader.state.page?.items ?? []).filter((entry) => entry.kind === "message").map((entry) => entry.message) }))),
						reader.state.page?.truncated ? h("p", { className: "dshSwarm_subtle" }, t("public.truncated", {})) : null, h(PublicPagination, { t, reader }))));
		}

		const viewTabs = ["dashboard", "members", "flow", "public", "goals", "worktrees"];
		function nextTab(current, key) {
			const index = Math.max(0, viewTabs.indexOf(current));
			return key === "Home" ? viewTabs[0] : key === "End" ? viewTabs.at(-1) : key === "ArrowRight" ? viewTabs[(index + 1) % viewTabs.length] : key === "ArrowLeft" ? viewTabs[(index + viewTabs.length - 1) % viewTabs.length] : null;
		}
		function RunBody({ t, state, now, sessionId, executeCommand, loadHistory, loadConversation, loadPublic, createWorktree }) {
			const p = state.progress;
			const [tab, setTab] = React.useState("dashboard");
			const prefix = "swarm-" + encodeURIComponent(sessionId + ":" + p.runId);
			const panel = (id, content) => h("div", { key: id, id: prefix + "-panel-" + id, role: "tabpanel", className: "dshSwarm_tabpanel", "aria-labelledby": prefix + "-tab-" + id, hidden: tab !== id, tabIndex: 0 }, content);
			return h(React.Fragment, {},
				h("div", { role: "tablist", className: "dshSwarm_tabs", "aria-label": t("tabs.label", {}) }, viewTabs.map((id) => h("button", {
					key: id, id: prefix + "-tab-" + id, type: "button", role: "tab", className: "dshSwarm_tab", "data-swarm-tab": id, "aria-selected": tab === id, "aria-controls": prefix + "-panel-" + id, tabIndex: tab === id ? 0 : -1, onClick: () => setTab(id),
					onKeyDown: (event) => { const next = nextTab(id, event.key); if (!next) return; event.preventDefault(); setTab(next); event.currentTarget.parentElement?.querySelector('[data-swarm-tab="' + next + '"]')?.focus(); }
				}, t("tabs." + id, {})))),
				panel("dashboard", h(DashboardPanel, { t, state, now })),
				panel("members", h(WorkersSection, { t, progress: p, stale: state.status !== "live", sessionId, executeCommand })),
				panel("flow", h(FlowPanel, { t, progress: p, sessionId, loadConversation })),
				panel("public", tab === "public" ? h(PublicSection, { t, progress: p, sessionId, loadPublic }) : null),
				// Keep drafts and in-flight owner commands mounted when switching tabs.
				panel("goals", h(GoalSection, { t, progress: p, sessionId, executeCommand, connected: state.status === "live" })),
				panel("worktrees", tab === "worktrees" ? h("div", {},
					h(GitStreamSection, { t, progress: p, sessionId, loadHistory }),
					h(CreateWorktreeSection, { t, sessionId, createWorktree })) : null));
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
			return h("section", { className: "dshSwarm_root", "aria-label": t("title", {}) }, h("style", {}, css + worktreeCss + publicCss),
				h("header", { className: "dshSwarm_header" }, h("div", { className: "dshSwarm_row" }, h(SwarmMark), h("h2", { className: "dshSwarm_title" }, t("title", {})), current.progress ? badge(label(t, "phase", current.progress.phase), tone(current.progress.phase)) : null),
					h("div", { className: "dshSwarm_connection " + (current.status === "live" ? "dshSwarm_live" : "") }, h("span", { role: "status", "aria-live": "polite" }, h("span", { className: "dshSwarm_dot", "aria-hidden": true }), " ", t("connection." + current.status, {})), h("button", { type: "button", className: "dshSwarm_button", disabled: !available || current.status === "loading", onClick: () => setAttempt((value) => value + 1) }, t("refresh", {})))),
				current.progress ? h("p", { className: "dshSwarm_subtle", style: { marginTop: 6 } }, timeElement(current.progress.updatedAt, t("updated", { time: timeLabel(current.progress.updatedAt) }))) : null,
				current.status !== "live" && current.hasSnapshot ? notice(t("stale.title", {}), t(current.status === "ended" ? "ended.body" : "stale.body", {})) : null,
				current.message || (!available && props.progressError) ? h("p", { role: "alert", className: "dshSwarm_notice" }, current.message || props.progressError) : null,
				current.legacy ? notice(t("legacy.title", {}), t("legacy.body", {})) : null,
				current.progress ? h(RunBody, { key: sessionId + ":" + current.progress.runId, t, state: current, now, sessionId, executeCommand: props.executeCommand, loadHistory: props.loadHistory, loadConversation: props.loadConversation, loadPublic: props.loadPublic, createWorktree: props.createWorktree }) : current.hasSnapshot ? h(React.Fragment, {},
					h("div", { role: "tablist", className: "dshSwarm_tabs", "aria-label": t("tabs.label", {}) },
						h("button", { type: "button", role: "tab", className: "dshSwarm_tab", "data-swarm-tab": "worktrees", "aria-selected": true }, t("tabs.worktrees", {}))),
					h("div", { role: "tabpanel", className: "dshSwarm_tabpanel" },
						h("div", { className: "dshSwarm_empty" }, h("h3", {}, t("noRun.title", {})), h("p", {}, t("noRun.body", {}))),
						h(CreateWorktreeSection, { t, sessionId, createWorktree: props.createWorktree }))) : h("p", { className: "dshSwarm_empty" }, t(current.status === "loading" ? "loading" : "unavailable", {})));
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
					const loadHistory = (sessionId, cursor, signal) => executeHistoryRead((...args) => {
						const remote = progressRemote();
						if (typeof remote?.worktreeHistory !== "function") throw Object.assign(new Error(t("git.unavailable", {})), { code: "gateway/method-unavailable" });
						return remote.worktreeHistory(...args);
					}, sessionId, cursor, signal);
					const loadConversation = (sessionId, beforeSeq, signal) => executeHistoryRead((id, cursor) => {
						const remote = progressRemote();
						if (typeof remote?.conversation !== "function") throw Object.assign(new Error(t("conv.unavailable", {})), { code: "gateway/method-unavailable" });
						return remote.conversation(id, cursor);
					}, sessionId, beforeSeq, signal);
					const loadPublic = (sessionId, runId, query, signal) => executeHistoryRead((id, request, requestSignal) => {
						const remote = progressRemote();
						if (typeof remote?.publicDiscussion !== "function") throw Object.assign(new Error(t("public.unavailable", {})), { code: "gateway/method-unavailable" });
						return remote.publicDiscussion(id, request.runId, publicQueryInput(request.query), requestSignal);
					}, sessionId, { runId, query }, signal);
					const watchProgress = (sessionId, signal) => progressRemote().watch(sessionId, signal);
					const watchSessionProgress = (sessionId, signal) => progressRemote().watchSession(sessionId, signal);
					const worktreesRemote = () => ctx.get("remote.swarmWorktrees");
					const listWorktrees = (sessionId) => {
						const remote = worktreesRemote();
						if (typeof remote?.list !== "function") throw Object.assign(new Error(t("wt.unavailable", { message: "remote method unavailable" })), { code: "gateway/method-unavailable" });
						return readRemoteValue(() => remote.list(sessionId));
					};
					const createWorktree = (sessionId, request) => {
						const remote = worktreesRemote();
						if (typeof remote?.create !== "function") throw Object.assign(new Error(t("wt.unavailable", { message: "remote method unavailable" })), { code: "gateway/method-unavailable" });
						return readRemoteValue(() => remote.create(sessionId, request));
					};
					removeSlot = ctx.slots.inject("conversation.view", () => ctx.slots.register({ name: "conversation.view", id: "swarm-progress", order: 5, locale: NS, label: () => t("view.label", {}), inject: () => ({ progressAvailable: available, progressError, watchProgress, watchSessionProgress, executeCommand, loadHistory, loadConversation, loadPublic, listWorktrees, createWorktree }) }, SwarmProgressView));
				}
				return async () => { cleanup(); await unmount?.(); };
			}, "dsh-swarm: progress panel");
		}
		// Pure derivations and the stream owner are also exercised without emulating a browser.
		return { apply, inject: ["slots", "locale", "remote"], progressClient: { publicQueryInput, readPublicPage, createPublicPager, PublicSection, PublicRecord, PublicPagination, readConversationPage, mergeConversation, ConversationSection, FlowPanel, flowHoverPosition, computeGraph, trackLanes, trackLayout, WorkersSection, FlowSection, flowLayout, messagePairs, readHistoryPage, executeHistoryRead, initialHistory, createHistoryPager, observeHistoryEnd, GitStreamSection, readFrame, initialState, visibleState, subscribeProgress, deriveWorkflow, deriveWorker, selectWorkers, deriveClock, startClock, budgetKey, describeEvent, filterTasks, filterEvents, deliveryState, duration, appendGoalLine, executeGoalCommand, appendReceipt, goalState, goalLane, goalColumns, workerName, addWorkerState, workerReceipt, nextTab, viewTabs, RunBody, GoalSection, AddWorkerControl, dictionaries: { zh, en } } };
	}
});
