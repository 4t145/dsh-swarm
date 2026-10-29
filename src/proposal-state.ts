/** Pure proposal rejection facts shared by integration, interruption and recovery. */
import { appendEvent } from './events.ts';
import type { ProposalRecord, ProposalRejectionReason, Run } from './types.ts';

/**
 * Reject a pending proposal and reclaim only its still-proposed task, in event order.
 * Mutates the reducer-owned run; the caller owns persistence and the single run revision.
 * A missing diagnostic preserves the existing reference. Worker ownership/current work stay intact.
 */
export function recordProposalRejection(
  run: Run,
  proposal: ProposalRecord,
  reason: ProposalRejectionReason,
  now: number,
  diagnosticsRef?: string | null,
): void {
  run.proposals[proposal.id] = {
    ...proposal,
    status: 'rejected',
    rejectionReason: reason,
    diagnosticsRef: diagnosticsRef ?? proposal.diagnosticsRef,
    updatedAt: now,
  };
  const task = run.tasks[proposal.taskId];
  const reclaimed = task !== undefined && task.status === 'proposed';
  if (reclaimed) {
    run.tasks[task.id] = {
      ...task,
      status: 'claimed',
      proposalId: null,
      revision: task.revision + 1,
      updatedAt: now,
    };
  }
  appendEvent(
    run,
    {
      kind: 'proposal',
      proposalId: proposal.id,
      taskId: proposal.taskId,
      status: 'rejected',
      authorWorkerId: null,
      audience: { kind: 'all' },
    },
    now,
  );
  if (reclaimed) {
    appendEvent(
      run,
      {
        kind: 'task',
        taskId: task.id,
        status: 'claimed',
        ownerWorkerId: task.ownerWorkerId,
        authorWorkerId: null,
        audience: { kind: 'all' },
      },
      now,
    );
  }
}
