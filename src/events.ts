/**
 * run 内事件追加与唤醒匹配（纯同步，无 IO，不访问 DSH）。
 *
 * `appendEvent` 只修改调用方已经隔离好的可变 run 副本：分配 seq、入 events、
 * 给匹配的等待者抬高 wakeTargetSeq。它不递增 Run.revision（调用方每次 update
 * 增一次），也不启动任何运行时唤醒。
 */

import type {
  EventAudience,
  EventSeq,
  ProposalStatus,
  Run,
  SwarmEvent,
  WorkerId,
  WorkerRecord,
} from './types.ts';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 追加事件的输入：seq 与 createdAt 由 appendEvent 分配。 */
export type EventInput = DistributiveOmit<SwarmEvent, 'seq' | 'createdAt'>;

const TERMINAL_PROPOSAL_STATUSES: readonly ProposalStatus[] = ['accepted', 'rejected'];

function isTerminalProposalStatus(status: ProposalStatus): boolean {
  return TERMINAL_PROPOSAL_STATUSES.includes(status);
}

/**
 * 事件对该 worker 是否可见。
 *
 * @param event 任意带 audience 的事件（已落盘或待追加均可）
 * @param workerId 观察者
 * @returns audience=all 时恒为 true；audience=workers 时仅列表内为 true。
 *           scope 与任务归属不参与可见性判断。
 */
export function isEventVisible(event: { audience: EventAudience }, workerId: WorkerId): boolean {
  return event.audience.kind === 'all' || event.audience.workerIds.includes(workerId);
}

/**
 * 事件是否满足该 worker 已登记的等待（架构 §7.2 匹配表，按顺序判断）。
 *
 * @param run 当前 run 聚合（只读使用；proposal 作者身份从 run.proposals 取）
 * @param worker 等待者记录，waitRegistration 为 null 时直接不匹配
 * @param event 已落盘事件（无 seq 的事件无法与 afterSeq 比较）
 * @returns 是否应把该事件计入 wakeTargetSeq；本函数不修改任何状态。
 */
export function matchesWait(run: Run, worker: WorkerRecord, event: SwarmEvent): boolean {
  if (!isEventVisible(event, worker.id)) return false;

  const wait = worker.waitRegistration;
  if (wait === null || event.seq <= wait.afterSeq) return false;

  // 发给自己的直接消息：两种模式都恒匹配，不受 ID 列表限制。
  if (event.kind === 'message') return event.targetWorkerId === worker.id;

  // 自己 proposal 的终态结果由 Host 产生事件，作者本人的等待同样匹配。
  if (event.kind === 'proposal' && isTerminalProposalStatus(event.status)) {
    const proposal = run.proposals[event.proposalId];
    if (proposal?.authorWorkerId === worker.id) return true;
  }

  // 自己产生的其他普通业务事件不唤醒自己（"无自激广播"）。
  if (event.authorWorkerId === worker.id) return false;

  const isAny = wait.mode === 'any';

  switch (event.kind) {
    case 'goal':
      // Owner additions matter even to workers waiting on selected peer tasks.
      return event.status === 'active';
    case 'finding':
      // 其他作者的 finding：any 恒匹配；selected 仅 taskId 在列表内。
      return isAny || (event.taskId !== null && wait.taskIds.includes(event.taskId));
    case 'task':
      // 变为可领取的 open：any 恒匹配；其他状态变化只在 selected 且 id 匹配时匹配。
      if (event.status === 'open') return isAny || wait.taskIds.includes(event.taskId);
      return !isAny && wait.taskIds.includes(event.taskId);
    case 'proposal':
      // 其他 proposal 的结果：any 恒匹配；selected 仅 proposalId 在列表内。
      if (!isTerminalProposalStatus(event.status)) return false;
      return isAny || wait.proposalIds.includes(event.proposalId);
    case 'head':
      // acceptedHead 推进：any 恒匹配；selected 仅非空 proposalId 在列表内。
      return isAny || (event.proposalId !== null && wait.proposalIds.includes(event.proposalId));
    case 'run':
      // 控制状态变化只做审计与状态显示，永不唤醒模型。
      return false;
    default:
      // message 已在上面处理；其余未知种类保守地不唤醒。
      return false;
  }
}

/**
 * 在调用方的可变 run 副本上追加一条业务事件，并抬高匹配等待者的 wakeTargetSeq。
 *
 * @param run 调用方已隔离的可变副本；本函数写入 events / nextSeq / workers[*].wakeTargetSeq
 * @param event 事件内容，seq 与 createdAt 由本函数分配
 * @param now 事件时间戳（毫秒），由调用方提供以保持可测
 * @returns 实际入 events 的事件（带 seq 与 createdAt）
 * @throws 无；seq 分配与入 events 在同一次同步调用内完成
 *
 * 不递增 Run.revision，不修改 updatedAt，不唤醒运行时；持久化由调用方在同一 update 内完成。
 */
export function appendEvent(run: Run, event: EventInput, now: number): SwarmEvent {
  const seq: EventSeq = run.nextSeq;
  run.nextSeq = seq + 1;

  const appended: SwarmEvent = { ...event, seq, createdAt: now };
  run.events.push(appended);

  for (const worker of Object.values(run.workers)) {
    if (!(appended.kind === 'goal' && appended.status === 'active') && !matchesWait(run, worker, appended)) continue;
    worker.wakeTargetSeq = Math.max(worker.wakeTargetSeq, seq);
  }

  return appended;
}
