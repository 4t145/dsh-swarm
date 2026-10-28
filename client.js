window.__ModuleLoader__.load({
	id: "@local/dsh-swarm",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		/* ------------------------------------------------------------------ */
		/* 样式                                                                */
		/* ------------------------------------------------------------------ */

		const css = ".dshSwarm_root{box-sizing:border-box;width:100%;max-width:820px;margin:0 auto;padding:16px 18px 28px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}.dshSwarm_head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-bottom:10px}.dshSwarm_title{font-size:14px;line-height:20px;font-weight:600}.dshSwarm_run{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,ui-monospace);font-size:11px}.dshSwarm_phase{border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);padding:1px 6px;font-size:11px}.dshSwarm_phase_completed{color:var(--dsw-alias-state-success-primary)}.dshSwarm_phase_failed{color:var(--dsw-alias-state-error-primary)}.dshSwarm_meta{display:flex;flex-wrap:wrap;gap:6px 16px;color:var(--dsw-alias-label-secondary);margin-bottom:12px}.dshSwarm_section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px;margin-top:10px}.dshSwarm_sectionTitle{color:var(--dsw-alias-label-secondary);font-size:11px;margin-bottom:6px}.dshSwarm_workers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.dshSwarm_worker{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 8px}.dshSwarm_dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-secondary);align-self:center}.dshSwarm_dot_running{background:var(--dsw-alias-state-success-primary)}.dshSwarm_dot_inactive{background:var(--dsw-alias-label-secondary)}.dshSwarm_dot_unavailable{background:var(--dsw-alias-state-error-primary)}.dshSwarm_workerId{font-family:var(--dsw-font-mono,ui-monospace);font-size:11px}.dshSwarm_workerState{color:var(--dsw-alias-label-secondary);font-size:11px}.dshSwarm_task{color:var(--dsw-alias-label-secondary);min-width:0;overflow-wrap:anywhere}.dshSwarm_diag{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary));font-size:11px;overflow-wrap:anywhere}.dshSwarm_empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:14px 16px;color:var(--dsw-alias-label-secondary)}.dshSwarm_emptyTitle{font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:4px}.dshSwarm_hint{font-family:var(--dsw-font-mono,ui-monospace);font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.dshSwarm_error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}";

		/* ------------------------------------------------------------------ */
		/* 文案（中文为源，英文键完全一致）                                     */
		/* ------------------------------------------------------------------ */

		const NS = "swarmProgress";
		const zh = {
			"view.label": "协作群",
			"title": "Swarm 运行",
			"loading": "正在读取 Swarm 进度…",
			"error": "读取进度失败：{message}",
			"unavailable": "Swarm 进度连接失败：{message}",
			"noRun.title": "当前没有 Swarm run",
			"noRun.body": "用 /swarm start --spec <spec.json> 启动，或让 Agent 调用 swarm_manage action=start 并给出 spec 对象或 spec_path。",
			"phase.preparing": "准备中",
			"phase.running": "运行中",
			"phase.draining": "收尾中",
			"phase.quiescing": "停止中",
			"phase.paused": "已暂停",
			"phase.completed": "已完成",
			"phase.stopped": "已停止",
			"phase.failed": "已失败",
			"budget.remaining": "预算剩余 {minutes} 分钟",
			"budget.expired": "预算已用尽",
			"tasks.title": "任务",
			"tasks.summary": "{done}/{total} 完成",
			"tasks.board": "待认领 {open} · 进行中 {claimed} · 待集成 {proposed} · 阻塞 {blocked} · 取消 {cancelled}",
			"workers.title": "Workers",
			"worker.running": "running",
			"worker.inactive": "inactive",
			"worker.unavailable": "unavailable",
			"worker.current": "当前：{subject}",
			"worker.noTask": "空闲",
			"proposals": "Proposal：排队 {queued} · 集成中 {integrating} · 已接受 {accepted} · 已拒绝 {rejected}",
			"verifications": "验证：排队 {queued} · 运行中 {running} · 通过 {passed} · 失败 {failed} · 中断 {interrupted}",
			"finish.pending": "交付验证已请求：{verificationId}",
			"finish.acceptedHead": "交付基线 {head}",
			"reason": "当前阶段原因：{reason}"
		};
		const en = {
			"view.label": "Swarm",
			"title": "Swarm run",
			"loading": "Reading Swarm progress…",
			"error": "Failed to read progress: {message}",
			"unavailable": "Could not connect to Swarm progress: {message}",
			"noRun.title": "No Swarm run in this session",
			"noRun.body": "Start one with /swarm start --spec <spec.json>, or ask the Agent to call swarm_manage action=start with a spec object or spec_path.",
			"phase.preparing": "preparing",
			"phase.running": "running",
			"phase.draining": "draining",
			"phase.quiescing": "stopping",
			"phase.paused": "paused",
			"phase.completed": "completed",
			"phase.stopped": "stopped",
			"phase.failed": "failed",
			"budget.remaining": "{minutes} min budget left",
			"budget.expired": "budget exhausted",
			"tasks.title": "Tasks",
			"tasks.summary": "{done}/{total} done",
			"tasks.board": "open {open} · claimed {claimed} · proposed {proposed} · blocked {blocked} · cancelled {cancelled}",
			"workers.title": "Workers",
			"worker.running": "running",
			"worker.inactive": "inactive",
			"worker.unavailable": "unavailable",
			"worker.current": "current: {subject}",
			"worker.noTask": "idle",
			"proposals": "Proposals: queued {queued} · integrating {integrating} · accepted {accepted} · rejected {rejected}",
			"verifications": "Verifications: queued {queued} · running {running} · passed {passed} · failed {failed} · interrupted {interrupted}",
			"finish.pending": "Finish requested: {verificationId}",
			"finish.acceptedHead": "Accepted head {head}",
			"reason": "Phase reason: {reason}"
		};

		/* ------------------------------------------------------------------ */
		/* 客户端 Remote 贡献                                                  */
		/* ------------------------------------------------------------------ */

		const stringCodec = Object.freeze({
			mode: "strict",
			typeSymbol: "string",
			create: () => ({ parse(value) { if (typeof value !== "string") throw new TypeError("Session id must be a string"); return value; } }),
			jsonSchema: { type: "string" }
		});
		const unknownCodec = Object.freeze({
			mode: "strict",
			typeSymbol: "unknown",
			create: () => ({ parse: (value) => value }),
			jsonSchema: {}
		});
		const SESSION_PARAMETER = Object.freeze({
			name: "sessionId",
			wire: "sessionId",
			source: "json",
			codec: stringCodec
		});
		const REMOTE_CONTRIBUTION = Object.freeze({
			package: "@local/dsh-swarm",
			descriptors: Object.freeze([
				Object.freeze({
					id: "@local/dsh-swarm#swarmProgress/snapshot",
					service: "swarmProgress",
					namespace: "swarmProgress",
					method: "snapshot",
					invocation: Object.freeze({ kind: "direct" }),
					parameters: Object.freeze([SESSION_PARAMETER]),
					result: unknownCodec
				}),
				Object.freeze({
					id: "@local/dsh-swarm#swarmProgress/watch",
					service: "swarmProgress",
					namespace: "swarmProgress",
					method: "watch",
					mode: "stream",
					invocation: Object.freeze({ kind: "direct" }),
					parameters: Object.freeze([SESSION_PARAMETER]),
					cancellation: Object.freeze({ parameter: "signal" }),
					result: unknownCodec
				})
			])
		});

		/* ------------------------------------------------------------------ */
		/* 组件                                                                */
		/* ------------------------------------------------------------------ */

		const h = React.createElement;
		function panel(...children) {
			return h("section", { className: "dshSwarm_root" }, h("style", { key: "swarm-css" }, css), ...children);
		}

		function phaseLabel(t, phase) {
			const key = "phase." + phase;
			return t(key, {});
		}

		function budgetLabel(t, progress) {
			if (progress.budgetExpired) return t("budget.expired", {});
			return t("budget.remaining", { minutes: Math.ceil(progress.remainingMs / 60000) });
		}

		function workerRow(t, worker) {
			return h("li", { key: worker.id, className: "dshSwarm_worker" },
				h("span", { className: "dshSwarm_dot dshSwarm_dot_" + worker.nativeStatus }),
				h("span", { className: "dshSwarm_workerId" }, worker.id),
				h("span", { className: "dshSwarm_workerState" }, t("worker." + worker.nativeStatus, {})),
				h("span", { className: "dshSwarm_task" }, worker.currentTask === null
					? t("worker.noTask", {})
					: t("worker.current", { subject: worker.currentTask.subject })),
				worker.diagnostic === null ? null : h("span", { className: "dshSwarm_diag" }, worker.diagnostic));
		}

		function runBody(t, progress) {
			const tasks = progress.tasks;
			const sections = [
				h("div", { key: "meta", className: "dshSwarm_meta" },
					h("span", {}, t("tasks.summary", { done: tasks.done, total: tasks.total })),
					h("span", {}, budgetLabel(t, progress)),
					progress.reason === null ? null : h("span", {}, t("reason", { reason: progress.reason }))),
				h("div", { key: "tasks", className: "dshSwarm_section" },
					h("div", { className: "dshSwarm_sectionTitle" }, t("tasks.title", {})),
					h("div", { className: "dshSwarm_hint" }, t("tasks.board", {
						open: tasks.open,
						claimed: tasks.claimed,
						proposed: tasks.proposed,
						blocked: tasks.blocked,
						cancelled: tasks.cancelled
					}))),
				h("div", { key: "workers", className: "dshSwarm_section" },
					h("div", { className: "dshSwarm_sectionTitle" }, t("workers.title", {})),
					h("ul", { className: "dshSwarm_workers" }, progress.workers.map((worker) => workerRow(t, worker)))),
				h("div", { key: "proposals", className: "dshSwarm_section" },
					h("div", {}, t("proposals", {
						queued: progress.proposals.queued,
						integrating: progress.proposals.integrating,
						accepted: progress.proposals.accepted,
						rejected: progress.proposals.rejected
					})),
					h("div", {}, t("verifications", {
						queued: progress.verifications.queued,
						running: progress.verifications.running,
						passed: progress.verifications.passed,
						failed: progress.verifications.failed,
						interrupted: progress.verifications.interrupted
					}))),
				progress.finishRequest === null ? null : h("div", { key: "finish", className: "dshSwarm_section" },
					h("div", {}, t("finish.pending", { verificationId: progress.finishRequest.verificationId === null ? "—" : progress.finishRequest.verificationId })),
					h("div", { className: "dshSwarm_hint" }, t("finish.acceptedHead", { head: progress.finishRequest.acceptedHead })))
			];
			return [
				h("div", { key: "head", className: "dshSwarm_head" },
					h("span", { className: "dshSwarm_title" }, t("title", {})),
					h("span", { className: "dshSwarm_run" }, progress.runId),
					h("span", { className: "dshSwarm_phase dshSwarm_phase_" + progress.phase }, phaseLabel(t, progress.phase))),
				...sections
			];
		}

		function emptyState(t) {
			return h("div", { className: "dshSwarm_empty" },
				h("div", { className: "dshSwarm_emptyTitle" }, t("noRun.title", {})),
				h("div", {}, t("noRun.body", {})));
		}

		function SwarmProgressView(props) {
			const t = props.t;
			const sessionId = props.sessionId;
			const available = props.progressAvailable === true;
			const [state, setState] = React.useState({ status: available ? "loading" : "unavailable", progress: null, message: null });

			React.useEffect(() => {
				if (!available || typeof props.watchProgress !== "function") return undefined;
				let cancelled = false;
				let handle = null;
				(async () => {
					try {
						handle = props.watchProgress(sessionId);
						for await (const item of handle) {
							if (cancelled) break;
							setState({ status: "ready", progress: item.progress, message: null });
						}
					} catch (error) {
						if (!cancelled) {
							setState({
								status: "error",
								progress: null,
								message: error instanceof Error ? error.message : String(error)
							});
						}
					}
				})();
				return () => {
					cancelled = true;
					if (handle !== null && typeof handle.dispose === "function") handle.dispose();
				};
			}, [available, props.watchProgress, sessionId]);

			if (state.status === "unavailable") {
				return panel( h("div", { className: "dshSwarm_empty" }, t("unavailable", { message: props.progressError ?? "Remote client unavailable" })));
			}
			if (state.status === "loading") {
				return panel( h("div", { className: "dshSwarm_hint" }, t("loading", {})));
			}
			if (state.status === "error") {
				return panel(
					h("div", { className: "dshSwarm_error" }, t("error", { message: state.message })));
			}
			if (state.progress === null) {
				return panel( emptyState(t));
			}
			return panel( runBody(t, state.progress));
		}

		/* ------------------------------------------------------------------ */
		/* 插件入口                                                            */
		/* ------------------------------------------------------------------ */

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-swarm: dictionaries");
			const t = ctx.locale.bind(NS);

			return (async () => {
				let available = false;
				let progressError = null;
				// Mounted namespaces are separate `remote.<ns>` services; reading them through
				// `ctx.remote.<ns>` trips Cordis' inject check, so use ctx.get() instead.
				const progressRemote = () => ctx.get("remote.swarmProgress");
				if (typeof ctx.remote === "object" && ctx.remote !== null && typeof ctx.remote.$mount === "function") {
					try {
						await ctx.remote.$mount(REMOTE_CONTRIBUTION);
						available = typeof progressRemote()?.watch === "function";
						if (!available) progressError = "remote.swarmProgress was not installed";
					} catch (error) {
						progressError = error instanceof Error ? error.message : String(error);
						console.warn("[dsh-swarm] failed to mount swarmProgress Remote", error);
					}
				}

				ctx.slots.inject("conversation.view", () => ctx.slots.register({
					name: "conversation.view",
					id: "swarm-progress",
					order: 5,
					locale: NS,
					label: () => t("view.label", {}),
					inject: () => ({
						progressAvailable: available,
						progressError,
						watchProgress: (sessionId) => progressRemote().watch(sessionId)
					})
				}, SwarmProgressView));
			})();
		}

		exports.apply = apply;
		exports.inject = ["slots", "locale", "remote"];
		return module.exports;
	}
});