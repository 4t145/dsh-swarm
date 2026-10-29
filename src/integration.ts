/**
 * Proposal 与最终验证的串行集成队列（架构 §8、§8.3、§8.5）。
 *
 * - Git 与命令只经 `WorkspacePort` / `ArtifactPort`；本模块不 spawn 进程、不调用模型。
 * - 同一 run 的 `process` / `recover` / `interrupt` 经 `KeyedSerialQueue` 串行；重复触发只会
 *   重新扫描持久状态，不会重复合并或重复发布。
 * - `PublicationGate` 只包住发布临界区（复查 → ref CAS → domain 补齐）和 finish 收尾的短
 *   domain 更新，不包住候选构造与测试。
 * - `interrupt` 同步中止在途信号，再在同一 run 队列里收束未接受候选与未完成验证；返回时域
 *   记录已静止。它不修改 Git ref、不启动测试。
 */

import { randomUUID } from 'node:crypto';
import { SwarmError, assert, isSwarmError, normalizeError } from './errors.ts';
import { appendEvent } from './events.ts';
import {
  verificationFingerprint,
  type ArtifactPort,
  type CandidateResult,
  type Clock,
  type VerificationOutcome,
  type WorkspacePort,
} from './ports.ts';
import { recordProposalRejection } from './proposal-state.ts';
import { KeyedSerialQueue, type PublicationGate } from './serial.ts';
import type { StateStore } from './store.ts';
import type {
  AttemptId,
  CommitSha,
  FindingRecord,
  IntegrationAttempt,
  ProposalId,
  ProposalRecord,
  ProposalRejectionReason,
  Run,
  RunId,
  TaskRecord,
  VerificationId,
  VerificationRecord,
} from './types.ts';

/** `interrupt` 的三种控制来源，映射到 Proposal.rejectionReason。 */
export type InterruptReason = 'pause' | 'stop' | 'budget';

/** 构造参数：时钟与 id 可替换，便于确定性测试。 */
export interface IntegrationOptions {
  /** 返回毫秒时间戳；优先于 `clock`。默认 `Date.now`。 */
  now?: () => number;
  /** Host 的 Clock 端口；`now` 未提供时使用其 `now()`。 */
  clock?: Clock;
  /** 生成 attempt / verification / repair task / finding 的 id；默认随机 UUID。 */
  id?: () => string;
  /** 非业务失败（存储、publish、ref 不确定）的上报通道；业务拒绝不经过它。 */
  onFailure?: (runId: string, error: unknown) => void;
}

const REJECTION_FOR: Record<InterruptReason, ProposalRejectionReason> = {
  pause: 'interrupted_by_pause',
  stop: 'interrupted_by_stop',
  budget: 'interrupted_by_budget',
};

/** 控制目标优先级：stop > budget > pause（架构 §10.1）。 */
const INTERRUPT_PRIORITY: Record<InterruptReason, number> = { pause: 1, budget: 2, stop: 3 };

function preferInterrupt(current: InterruptReason | null, next: InterruptReason): InterruptReason {
  if (current === null || INTERRUPT_PRIORITY[next] > INTERRUPT_PRIORITY[current]) {
    return next;
  }
  return current;
}

/** 进程内控制状态：中止信号与已记录的控制原因。 */
interface RunControl {
  abort: AbortController;
  interrupt: InterruptReason | null;
}

interface RejectAttemptInput {
  proposalId: ProposalId;
  attemptId: AttemptId;
  /** attempt 的终态：merge_conflict / rejected / interrupted。 */
  attemptStatus: 'merge_conflict' | 'rejected' | 'interrupted';
  attemptDiagnosticsRef: string | null;
  proposalReason: ProposalRejectionReason;
  proposalDiagnosticsRef?: string | null;
  verification?: {
    id: VerificationId;
    status: 'failed' | 'interrupted';
    diagnosticsRef: string | null;
    exitCode: number | null;
    timedOut: boolean;
  };
}

/** 一次已确认发布所需的精确凭据组合（架构 §8.3 表第 2 行）。 */
interface PublicationEvidence {
  proposal: ProposalRecord;
  attempt: IntegrationAttempt;
  verification: VerificationRecord;
}

/**
 * 串行集成队列。
 *
 * 构造后由 runtime 调用 `process` 消费队列；重启核对调用 `recover`；控制门禁关闭后调用
 * `interrupt`。三个入口互不重叠地作用于同一 run 的持久记录。
 */
export class IntegrationQueue {
  private readonly store: StateStore;
  private readonly workspace: WorkspacePort;
  private readonly artifacts: ArtifactPort;
  private readonly gate: PublicationGate;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly onFailure: ((runId: string, error: unknown) => void) | undefined;
  private readonly queues = new KeyedSerialQueue();
  /** 每个 run 最近一次入队操作的完成点，供 `idle` 使用。 */
  private readonly tails = new Map<RunId, Promise<void>>();
  private readonly controls = new Map<RunId, RunControl>();

  constructor(
    store: StateStore,
    workspace: WorkspacePort,
    artifacts: ArtifactPort,
    gate: PublicationGate,
    options: IntegrationOptions = {},
  ) {
    this.store = store;
    this.workspace = workspace;
    this.artifacts = artifacts;
    this.gate = gate;
    const clock = options.clock;
    this.now = options.now ?? (clock === undefined ? () => Date.now() : () => clock.now());
    this.createId = options.id ?? (() => randomUUID());
    this.onFailure = options.onFailure;
  }

  /**
   * 处理该 run 当前可执行的集成工作：`running` 下按提交顺序处理 queued Proposal，
   * `draining` 下处理 queued finish Verification。全部完成后 resolve；业务拒绝不算失败。
   *
   * @param signal 外部取消；中止后不会再开始新的候选，并在途尝试按中止收束（不伪造测试失败）。
   * @throws 存储、Git 或 publish 等基础设施错误（同时上报 `onFailure`）。
   */
  async process(runId: RunId, signal?: AbortSignal): Promise<void> {
    // resume 后同一实例再次被调度：清掉上一次控制留下的中止信号。
    this.resetControlIfActive(runId);
    const control = this.controlFor(runId);
    const combined = combineSignals(signal, control.abort.signal);
    await this.enqueue(runId, async () => {
      try {
        while (!combined.aborted) {
          const progressed = await this.step(runId, combined);
          if (!progressed) {
            return;
          }
        }
      } catch (error) {
        this.reportFailure(runId, error);
        throw error;
      }
    });
  }

  /**
   * 崩溃/重启后的 Git 与 domain 核对：只读 resultRef，按架构 §8.3 补齐已发生的发布或拒绝
   * 未发布候选；从不移动 ref、不运行测试、不调用模型。
   *
   * @throws `SWARM_INVALID_STATE` 当 ref 是未知 SHA、缺少精确 passed 凭据，或已 rejected 的
   * Proposal 却发现 ref 已指向候选；此时不修改记录，由调用方保持暂停并报告。
   */
  async recover(runId: RunId): Promise<void> {
    await this.enqueue(runId, async () => {
      try {
        await this.reconcile(runId);
      } catch (error) {
        this.reportFailure(runId, error);
        throw error;
      }
    });
  }

  /**
   * 控制门禁已关闭（phase=quiescing）后收束集成域状态：所有未接受 Proposal→rejected，
   * 对应 Task 回 claimed；queued/running Verification→interrupted；passed 记录不改写。
   *
   * @param reason 控制来源，决定 Proposal.rejectionReason 与是否清除 finishRequest。
   */
  async interrupt(runId: RunId, reason: InterruptReason): Promise<void> {
    const control = this.controlFor(runId);
    control.interrupt = preferInterrupt(control.interrupt, reason);
    // 先同步中止在途的合并/测试；等待该 run 队列静止后再落 domain 收束。
    control.abort.abort();
    await this.enqueue(runId, async () => {
      try {
        // 并发控制请求按优先级取最终原因（stop > budget > pause）。
        const active = this.controlFor(runId).interrupt ?? reason;
        await this.settlePending(runId, REJECTION_FOR[active]);
      } catch (error) {
        this.reportFailure(runId, error);
        throw error;
      }
    });
  }

  /**
   * 等待该 run 已入队的集成操作完成；`runId` 省略时等待所有 run。
   * 只观察已入队工作，不登记新操作。
   */
  async idle(runId?: RunId): Promise<void> {
    if (runId !== undefined) {
      const tail = this.tails.get(runId);
      if (tail !== undefined) {
        await tail;
      }
      return;
    }
    await Promise.all([...this.tails.values()]);
  }

  /* ------------------------------------------------------------------ */
  /* 队列驱动                                                            */
  /* ------------------------------------------------------------------ */

  /** 执行一步可做的集成工作；返回 true 表示状态有推进、应继续扫描。 */
  private async step(runId: RunId, signal: AbortSignal): Promise<boolean> {
    const run = this.store.get(runId);
    if (signal.aborted || (run.deadline !== null && this.now() >= run.deadline)) {
      return false;
    }
    if (run.phase === 'running') {
      const proposal = nextQueuedProposal(run);
      if (proposal !== null) {
        return this.integrateProposal(runId, proposal.id, signal);
      }
      return false;
    }
    if (run.phase === 'draining') {
      const verification = nextQueuedFinishVerification(run);
      if (verification !== null) {
        return this.runFinishVerification(runId, verification.id, signal);
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Proposal 集成                                                       */
  /* ------------------------------------------------------------------ */

  private async integrateProposal(runId: RunId, proposalId: ProposalId, signal: AbortSignal): Promise<boolean> {
    const attemptId = this.newId();
    const claimedAt = this.now();
    const claimed = await this.store.update(runId, (run) => {
      const proposal = run.proposals[proposalId];
      if (proposal === undefined || proposal.status !== 'queued' || run.phase !== 'running') {
        return run;
      }
      const task = run.tasks[proposal.taskId];
      assert(task !== undefined, 'SWARM_INTERNAL', `proposal ${proposalId} references unknown task`, {
        runId,
        taskId: proposal.taskId,
      });
      assert(task.status === 'proposed', 'SWARM_INTERNAL', `task ${task.id} is ${task.status}, expected proposed`, {
        runId,
        taskId: task.id,
      });
      const attempt: IntegrationAttempt = {
        id: attemptId,
        proposalId,
        expectedHead: run.acceptedHead,
        sourceCommit: proposal.sourceCommit,
        candidateCommit: null,
        status: 'merging',
        diagnosticsRef: null,
        createdAt: claimedAt,
        updatedAt: claimedAt,
      };
      run.integrationAttempts[attemptId] = attempt;
      run.proposals[proposalId] = {
        ...proposal,
        status: 'integrating',
        attemptIds: [...proposal.attemptIds, attemptId],
        updatedAt: claimedAt,
      };
      run.activeAttemptId = attemptId;
      run.revision += 1;
      run.updatedAt = claimedAt;
      return run;
    });

    if (claimed.proposals[proposalId]?.status !== 'integrating' || claimed.activeAttemptId !== attemptId) {
      return false;
    }

    const run = this.store.get(runId);
    const proposal = run.proposals[proposalId];
    const attempt = run.integrationAttempts[attemptId];
    if (proposal === undefined || attempt === undefined) {
      return false;
    }

    if (signal.aborted) {
      await this.abortAttempt(runId, proposalId, attemptId, null);
      return true;
    }

    let candidate: CandidateResult;
    try {
      candidate = await this.workspace.buildCandidate(run, proposal, attempt, signal);
    } catch (error) {
      if (signal.aborted) {
        await this.abortAttempt(runId, proposalId, attemptId, null);
        return true;
      }
      await this.recordAttemptError(runId, proposalId, attemptId, error, 'merge');
      throw error;
    }
    if (signal.aborted) {
      await this.abortAttempt(runId, proposalId, attemptId, null);
      return true;
    }

    if (candidate.kind === 'conflict') {
      const diagnosticsRef = await this.artifacts.save(
        runId,
        `integration/${proposalId}/${attemptId}/merge-conflict.log`,
        candidate.diagnostics,
      );
      await this.rejectAttempt(runId, {
        proposalId,
        attemptId,
        attemptStatus: 'merge_conflict',
        attemptDiagnosticsRef: diagnosticsRef,
        proposalReason: 'merge_conflict',
        proposalDiagnosticsRef: diagnosticsRef,
      });
      return true;
    }

    const verificationId = this.newId();
    const startedAt = this.now();
    const verification: VerificationRecord = {
      id: verificationId,
      purpose: 'proposal',
      commit: candidate.commit,
      expectedHead: attempt.expectedHead,
      sourceCommit: proposal.sourceCommit,
      proposalId,
      attemptId,
      configFingerprint: verificationFingerprint(run.verification),
      goalRevision: run.goalRevision,
      status: 'running',
      receiptRef: null,
      diagnosticsRef: null,
      exitCode: null,
      timedOut: false,
      createdAt: startedAt,
      startedAt,
      finishedAt: null,
    };
    const marking = await this.store.update(runId, (current) => {
      const record = current.integrationAttempts[attemptId];
      if (record === undefined || record.status !== 'merging') {
        return current;
      }
      current.integrationAttempts[attemptId] = {
        ...record,
        candidateCommit: candidate.commit,
        status: 'verifying',
        updatedAt: startedAt,
      };
      current.verifications[verificationId] = verification;
      current.revision += 1;
      current.updatedAt = startedAt;
      return current;
    });
    if (marking.verifications[verificationId] === undefined) {
      return false;
    }

    const verifyingRun = this.store.get(runId);
    let outcome: VerificationOutcome;
    try {
      outcome = await this.workspace.verify(verifyingRun, candidate.commit, signal);
    } catch (error) {
      if (signal.aborted) {
        await this.abortAttempt(runId, proposalId, attemptId, verificationId);
        return true;
      }
      await this.recordAttemptError(runId, proposalId, attemptId, error, 'verification');
      throw error;
    }

    if (signal.aborted || outcome.interrupted) {
      await this.abortAttempt(runId, proposalId, attemptId, verificationId);
      return true;
    }

    if (!outcome.passed) {
      const diagnosticsRef = await this.artifacts.save(
        runId,
        `integration/${proposalId}/${attemptId}/verification.log`,
        verificationLog({ ...verification, status: 'failed' }, outcome),
      );
      await this.rejectAttempt(runId, {
        proposalId,
        attemptId,
        attemptStatus: 'rejected',
        attemptDiagnosticsRef: diagnosticsRef,
        proposalReason: 'verification_failed',
        proposalDiagnosticsRef: diagnosticsRef,
        verification: {
          id: verificationId,
          status: 'failed',
          diagnosticsRef,
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut,
        },
      });
      return true;
    }

    const receiptRef = await this.artifacts.save(
      runId,
      `integration/${proposalId}/${attemptId}/verification.log`,
      verificationLog({ ...verification, status: 'passed' }, outcome),
    );
    const finishedAt = this.now();
    const persisted = await this.store.update(runId, (current) => {
      const record = current.verifications[verificationId];
      if (record === undefined || record.status !== 'running') {
        return current;
      }
      current.verifications[verificationId] = {
        ...record,
        status: 'passed',
        receiptRef,
        exitCode: outcome.exitCode,
        timedOut: outcome.timedOut,
        finishedAt,
      };
      const attemptRecord = current.integrationAttempts[attemptId];
      if (attemptRecord !== undefined && attemptRecord.status === 'verifying') {
        current.integrationAttempts[attemptId] = {
          ...attemptRecord,
          status: 'verified',
          updatedAt: finishedAt,
        };
      }
      current.revision += 1;
      current.updatedAt = finishedAt;
      return current;
    });
    if (persisted.verifications[verificationId]?.status !== 'passed') {
      // 停止先到达：已通过的记录不算失败，也不发布。
      await this.abortAttempt(runId, proposalId, attemptId, verificationId);
      return true;
    }

    await this.publishCandidate(runId, proposalId, attemptId, verificationId, candidate.commit, signal);
    return true;
  }

  /** 发布临界区：复查门禁条件 → ref CAS → 一次 domain 更新写 accepted / done / events。 */
  private async publishCandidate(
    runId: RunId,
    proposalId: ProposalId,
    attemptId: AttemptId,
    verificationId: VerificationId,
    candidate: CommitSha,
    signal: AbortSignal,
  ): Promise<void> {
    await this.gate.run(runId, async () => {
      const run = this.store.get(runId);
      const reason = this.publicationBlock(runId, run, proposalId, attemptId, verificationId, signal);
      if (reason !== null) {
        await this.rejectAttempt(runId, {
          proposalId,
          attemptId,
          attemptStatus: 'interrupted',
          attemptDiagnosticsRef: null,
          proposalReason: reason,
          verification: {
            id: verificationId,
            status: 'interrupted',
            diagnosticsRef: null,
            exitCode: null,
            timedOut: false,
          },
        });
        return;
      }
      const attempt = run.integrationAttempts[attemptId];
      if (attempt === undefined) {
        throw new SwarmError('SWARM_INTERNAL', `attempt ${attemptId} disappeared before publish`, {
          details: { runId, attemptId },
        });
      }
      // 发布临界区已持有短门禁：ref CAS 与 domain 更新不被迟到的控制请求打断
      // （架构 §8.4：先取得发布临界区的提交允许完成）。
      await this.workspace.publish(run, attempt.expectedHead, candidate);
      await this.acceptProposal(runId, proposalId, attemptId, candidate);
    });
  }

  /** 发布前的复查；返回 null 表示可以发布，否则返回拒绝原因（不移动 ref）。 */
  private publicationBlock(
    runId: RunId,
    run: Run,
    proposalId: ProposalId,
    attemptId: AttemptId,
    verificationId: VerificationId,
    signal: AbortSignal,
  ): ProposalRejectionReason | null {
    const control = this.controls.get(runId);
    if (control !== undefined && control.interrupt !== null) {
      return REJECTION_FOR[control.interrupt];
    }
    if (signal.aborted) {
      return 'interrupted_before_publish';
    }
    if (run.phase !== 'running') {
      return phaseRejection(run);
    }
    const attempt = run.integrationAttempts[attemptId];
    if (attempt === undefined || run.acceptedHead !== attempt.expectedHead) {
      return 'interrupted_before_publish';
    }
    const proposal = run.proposals[proposalId];
    if (proposal === undefined || proposal.status !== 'integrating') {
      return 'interrupted_before_publish';
    }
    const verification = run.verifications[verificationId];
    if (verification === undefined || verification.status !== 'passed') {
      return 'interrupted_before_publish';
    }
    if ((run.deadline !== null && this.now() >= run.deadline)) {
      return 'interrupted_by_budget';
    }
    return null;
  }

  /** 记录一次已经发生的发布：acceptedHead、Proposal、Task、attempt 与三个业务事件。 */
  private async acceptProposal(
    runId: RunId,
    proposalId: ProposalId,
    attemptId: AttemptId,
    candidate: CommitSha,
  ): Promise<void> {
    const now = this.now();
    await this.store.update(runId, (run) => {
      const proposal = run.proposals[proposalId];
      const attempt = run.integrationAttempts[attemptId];
      if (proposal === undefined || attempt === undefined) {
        return run;
      }
      if (proposal.status === 'accepted' && run.acceptedHead === candidate && proposal.acceptedCommit === candidate) {
        return run;
      }
      if (proposal.status === 'accepted' || proposal.status === 'rejected') {
        return run;
      }
      const task = run.tasks[proposal.taskId];
      run.proposals[proposalId] = {
        ...proposal,
        status: 'accepted',
        acceptedCommit: candidate,
        rejectionReason: null,
        diagnosticsRef: null,
        updatedAt: now,
      };
      run.integrationAttempts[attemptId] = {
        ...attempt,
        status: 'published',
        candidateCommit: candidate,
        updatedAt: now,
      };
      run.acceptedHead = candidate;
      if (run.activeAttemptId === attemptId) {
        run.activeAttemptId = null;
      }
      if (task !== undefined) {
        run.tasks[task.id] = {
          ...task,
          status: 'done',
          proposalId: proposalId,
          revision: task.revision + 1,
          updatedAt: now,
        };
        // Retain task authorship, but clear active work in the same acceptance update.
        const owner = task.ownerWorkerId === null ? undefined : run.workers[task.ownerWorkerId];
        if (owner !== undefined && owner.currentTaskId === task.id) {
          run.workers[owner.id] = { ...owner, currentTaskId: null };
        }
      }
      appendEvent(
        run,
        {
          kind: 'proposal',
          proposalId,
          taskId: proposal.taskId,
          status: 'accepted',
          authorWorkerId: null,
          audience: { kind: 'all' },
        },
        now,
      );
      appendEvent(
        run,
        { kind: 'head', acceptedHead: candidate, proposalId, authorWorkerId: null, audience: { kind: 'all' } },
        now,
      );
      if (task !== undefined) {
        appendEvent(
          run,
          {
            kind: 'task',
            taskId: task.id,
            status: 'done',
            ownerWorkerId: task.ownerWorkerId,
            authorWorkerId: null,
            audience: { kind: 'all' },
          },
          now,
        );
      }
      run.revision += 1;
      run.updatedAt = now;
      return run;
    });
  }

  /** 中止在途尝试：不伪造测试失败；Proposal 按控制原因拒绝，Task 回 claimed。 */
  private async abortAttempt(
    runId: RunId,
    proposalId: ProposalId,
    attemptId: AttemptId,
    verificationId: VerificationId | null,
  ): Promise<void> {
    const reason = this.controls.get(runId)?.interrupt ?? null;
    await this.rejectAttempt(runId, {
      proposalId,
      attemptId,
      attemptStatus: 'interrupted',
      attemptDiagnosticsRef: null,
      proposalReason: reason === null ? 'interrupted_before_publish' : REJECTION_FOR[reason],
      verification:
        verificationId === null
          ? undefined
          : { id: verificationId, status: 'interrupted', diagnosticsRef: null, exitCode: null, timedOut: false },
    });
  }

  /** 统一记录拒绝：attempt 终态、verification 终态（仅 queued/running）、Proposal、Task、事件。 */
  private async rejectAttempt(runId: RunId, input: RejectAttemptInput): Promise<void> {
    const now = this.now();
    await this.store.update(runId, (run) => {
      const proposal = run.proposals[input.proposalId];
      if (proposal === undefined || proposal.status === 'accepted' || proposal.status === 'rejected') {
        return run;
      }
      const attempt = run.integrationAttempts[input.attemptId];
      if (attempt !== undefined && attempt.status !== 'published') {
        run.integrationAttempts[input.attemptId] = {
          ...attempt,
          status: input.attemptStatus,
          diagnosticsRef: input.attemptDiagnosticsRef,
          updatedAt: now,
        };
      }
      if (input.verification !== undefined) {
        const record = run.verifications[input.verification.id];
        if (record !== undefined && (record.status === 'queued' || record.status === 'running')) {
          run.verifications[input.verification.id] = {
            ...record,
            status: input.verification.status,
            diagnosticsRef: input.verification.diagnosticsRef,
            exitCode: input.verification.exitCode,
            timedOut: input.verification.timedOut,
            finishedAt: now,
          };
        }
      }
      if (run.activeAttemptId === input.attemptId) {
        run.activeAttemptId = null;
      }
      recordProposalRejection(run, proposal, input.proposalReason, now, input.proposalDiagnosticsRef);
      run.revision += 1;
      run.updatedAt = now;
      return run;
    });
  }

  /** 基础设施错误：保存诊断并标记 attempt，错误本身继续上抛，不当作测试失败。 */
  private async recordAttemptError(
    runId: RunId,
    proposalId: ProposalId,
    attemptId: AttemptId,
    error: unknown,
    phase: 'merge' | 'verification',
  ): Promise<void> {
    const message = isSwarmError(error) ? `${error.code}: ${error.message}` : String(error);
    let diagnosticsRef: string | null = null;
    try {
      diagnosticsRef = await this.artifacts.save(
        runId,
        `integration/${proposalId}/${attemptId}/${phase}-error.log`,
        `${phase} failed: ${message}\n`,
      );
    } catch {
      diagnosticsRef = null;
    }
    const now = this.now();
    try {
      await this.store.update(runId, (run) => {
        const attempt = run.integrationAttempts[attemptId];
        if (attempt === undefined || attempt.status === 'published') {
          return run;
        }
        run.integrationAttempts[attemptId] = {
          ...attempt,
          status: 'rejected',
          diagnosticsRef,
          updatedAt: now,
        };
        run.revision += 1;
        run.updatedAt = now;
        return run;
      });
    } catch {
      // 诊断写入失败不能掩盖原始错误。
    }
  }

  /* ------------------------------------------------------------------ */
  /* finish Verification                                                 */
  /* ------------------------------------------------------------------ */

  private async runFinishVerification(
    runId: RunId,
    verificationId: VerificationId,
    signal: AbortSignal,
  ): Promise<boolean> {
    const snapshot = this.store.get(runId);
    if (snapshot.phase !== 'draining') {
      return false;
    }
    const record = snapshot.verifications[verificationId];
    if (record === undefined || record.purpose !== 'finish' || record.status !== 'queued') {
      return false;
    }
    const finish = snapshot.finishRequest;
    if (
      finish === null ||
      finish.verificationId !== verificationId ||
      finish.acceptedHead !== snapshot.acceptedHead ||
      (finish.goalRevision ?? 0) !== snapshot.goalRevision ||
      (record.goalRevision ?? 0) !== snapshot.goalRevision ||
      record.commit !== snapshot.acceptedHead
    ) {
      // 失配的 finish 验证不会执行；标记 interrupted 以免永久排队。
      await this.abortFinish(runId, verificationId);
      return true;
    }

    const startedAt = this.now();
    const claimed = await this.store.update(runId, (run) => {
      const current = run.verifications[verificationId];
      if (current === undefined || current.status !== 'queued' || run.phase !== 'draining') {
        return run;
      }
      run.verifications[verificationId] = { ...current, status: 'running', startedAt };
      run.revision += 1;
      run.updatedAt = startedAt;
      return run;
    });
    if (claimed.verifications[verificationId]?.status !== 'running') {
      return false;
    }

    const verifyingRun = this.store.get(runId);
    let outcome: VerificationOutcome;
    try {
      outcome = await this.workspace.verify(verifyingRun, record.commit, signal);
    } catch (error) {
      if (signal.aborted) {
        await this.abortFinish(runId, verificationId);
        return true;
      }
      throw error;
    }

    if (signal.aborted || outcome.interrupted) {
      await this.abortFinish(runId, verificationId);
      return true;
    }

    if (!outcome.passed) {
      await this.failFinish(runId, verificationId, outcome);
      return true;
    }

    const receiptRef = await this.artifacts.save(
      runId,
      `integration/finish-${verificationId}/verification.log`,
      verificationLog({ ...record, status: 'passed' }, outcome),
    );
    const finishedAt = this.now();
    const persisted = await this.store.update(runId, (run) => {
      const current = run.verifications[verificationId];
      if (current === undefined || current.status !== 'running') {
        return run;
      }
      run.verifications[verificationId] = {
        ...current,
        status: 'passed',
        receiptRef,
        exitCode: outcome.exitCode,
        timedOut: outcome.timedOut,
        finishedAt,
      };
      run.revision += 1;
      run.updatedAt = finishedAt;
      return run;
    });
    if (persisted.verifications[verificationId]?.status !== 'passed') {
      return true;
    }

    // 最终成功的交接：复查 finishRequest 仍有效后进入 quiescing(target=completed)；
    // 真正的资源停止与 completed 由 runtime 订阅收尾。
    await this.gate.run(runId, async () => {
      const now = this.now();
      await this.store.update(runId, (run) => {
        if (signal.aborted) {
          return run;
        }
        const control = this.controls.get(runId);
        if (control !== undefined && control.interrupt !== null) {
          return run;
        }
        const current = run.verifications[verificationId];
        const activeFinish = run.finishRequest;
        if (current === undefined || current.status !== 'passed') {
          return run;
        }
        if (run.phase !== 'draining' || activeFinish === null) {
          return run;
        }
        if (
          activeFinish.verificationId !== verificationId ||
          activeFinish.acceptedHead !== run.acceptedHead ||
          (activeFinish.goalRevision ?? 0) !== run.goalRevision ||
          (current.goalRevision ?? 0) !== run.goalRevision ||
          current.commit !== run.acceptedHead
        ) {
          return run;
        }
        if (run.deadline !== null && now >= run.deadline) {
          return run;
        }
        run.phase = 'quiescing';
        run.quiesceTarget = 'completed';
        run.reason = 'finish_verified';
        appendEvent(
          run,
          { kind: 'run', phase: 'quiescing', target: 'completed', reason: 'finish_verified', authorWorkerId: null, audience: { kind: 'all' } },
          now,
        );
        run.revision += 1;
        run.updatedAt = now;
        return run;
      });
    });
    return true;
  }

  /** finish 验证被中止：只记录 interrupted 并清除 finishRequest，不创建缺陷任务。 */
  private async abortFinish(runId: RunId, verificationId: VerificationId): Promise<void> {
    const now = this.now();
    await this.store.update(runId, (run) => {
      const record = run.verifications[verificationId];
      if (record === undefined || (record.status !== 'queued' && record.status !== 'running')) {
        return run;
      }
      run.verifications[verificationId] = { ...record, status: 'interrupted', finishedAt: now };
      if (run.finishRequest !== null && run.finishRequest.verificationId === verificationId) {
        run.finishRequest = null;
      }
      run.revision += 1;
      run.updatedAt = now;
      return run;
    });
  }

  /** finish 验证失败：建立真实的 open code 修复任务与 FAIL，phase 回 running（§8.5）。 */
  private async failFinish(runId: RunId, verificationId: VerificationId, outcome: VerificationOutcome): Promise<void> {
    const run = this.store.get(runId);
    const record = run.verifications[verificationId];
    if (record === undefined) {
      return;
    }
    const diagnosticsRef = await this.artifacts.save(
      runId,
      `integration/finish-${verificationId}/verification.log`,
      verificationLog(record, outcome),
    );
    const repairTaskId = this.newId();
    const findingId = this.newId();
    const now = this.now();
    await this.store.update(runId, (current) => {
      const verification = current.verifications[verificationId];
      if (verification === undefined || verification.status !== 'running') {
        return current;
      }
      current.verifications[verificationId] = {
        ...verification,
        status: 'failed',
        diagnosticsRef,
        exitCode: outcome.exitCode,
        timedOut: outcome.timedOut,
        finishedAt: now,
      };
      const finish = current.finishRequest;
      if (finish === null || finish.verificationId !== verificationId) {
        // finishRequest 已被并发清除：只记录真实的验证失败。
        current.revision += 1;
        current.updatedAt = now;
        return current;
      }
      current.finishRequest = null;
      const task: TaskRecord = {
        id: repairTaskId,
        revision: 0,
        createdByWorkerId: null,
        kind: 'code',
        subject: `修复最终验证失败（${shortCommit(verification.commit)}）`,
        acceptance: '集成 worktree 中最终验证命令通过',
        scope: [],
        status: 'open',
        ownerWorkerId: null,
        proposalId: null,
        resultFindingId: null,
        blockReason: null,
        cancellationReason: null,
        createdAt: now,
        updatedAt: now,
      };
      current.tasks[repairTaskId] = task;
      appendEvent(
        current,
        {
          kind: 'task',
          taskId: repairTaskId,
          status: 'open',
          ownerWorkerId: null,
          authorWorkerId: null,
          audience: { kind: 'all' },
        },
        now,
      );
      const findingEvent = appendEvent(
        current,
        {
          kind: 'finding',
          findingId,
          taskId: null,
          findingKind: 'fail',
          authorWorkerId: finish.requestedByWorkerId,
          audience: { kind: 'all' },
        },
        now,
      );
      const finding: FindingRecord = {
        id: findingId,
        seq: findingEvent.seq,
        authorWorkerId: finish.requestedByWorkerId,
        taskId: null,
        kind: 'fail',
        summary: `最终验证失败（${shortCommit(verification.commit)}）：${
          outcome.timedOut ? '命令超时' : `exitCode=${String(outcome.exitCode)}`
        }`,
        scope: [],
        evidenceRefs: [diagnosticsRef],
        supersedesId: null,
        blockingRepairTaskId: repairTaskId,
        createdAt: now,
      };
      current.findings[findingId] = finding;
      current.phase = 'running';
      current.quiesceTarget = null;
      current.reason = 'finish_verification_failed';
      appendEvent(
        current,
        { kind: 'run', phase: 'running', target: null, reason: 'finish_verification_failed', authorWorkerId: null, audience: { kind: 'all' } },
        now,
      );
      current.revision += 1;
      current.updatedAt = now;
      return current;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 恢复与收束                                                          */
  /* ------------------------------------------------------------------ */

  private async reconcile(runId: RunId): Promise<void> {
    const run = this.store.get(runId);
    const resultRef = await this.workspace.resultHead(run);
    if (resultRef === run.acceptedHead) {
      // 架构 §8.3 表第 1 行：ref 仍是 H，一律不发布旧候选。
      await this.settlePending(runId, 'interrupted_before_publish');
      return;
    }

    const evidence = findPublicationEvidence(run, resultRef);
    if (evidence === null) {
      throw new SwarmError('SWARM_INVALID_STATE', 'result ref does not match any recorded publication', {
        details: { runId, acceptedHead: run.acceptedHead, resultRef },
      });
    }
    if (evidence.proposal.status === 'accepted') {
      // domain 已 accepted 时 acceptedHead 必须同步等于 ref；否则是外部改动或记录错乱。
      throw new SwarmError('SWARM_INVALID_STATE', 'accepted proposal does not match the domain head', {
        details: {
          runId,
          proposalId: evidence.proposal.id,
          acceptedHead: run.acceptedHead,
          acceptedCommit: evidence.proposal.acceptedCommit,
          resultRef,
        },
      });
    }
    if (evidence.proposal.status === 'rejected') {
      throw new SwarmError('SWARM_INVALID_STATE', 'rejected proposal has a published candidate', {
        details: { runId, proposalId: evidence.proposal.id, resultRef },
      });
    }
    // 架构 §8.3 表第 2 行：ref 已是 M 且凭据精确匹配，只补 domain，不动 ref、不再验证。
    await this.acceptProposal(runId, evidence.proposal.id, evidence.attempt.id, resultRef);
  }

  /**
   * 拒绝所有未接受 Proposal、收束未完成 Verification；passed 记录保留。
   *
   * pause/stop/budget 与重启核对都会取消尚未最终交付的 finishRequest（架构 §10.2），但已
   * passed 的验证凭据保留，resume 后重新提出 finish 时仍可复用。
   */
  private async settlePending(runId: RunId, reason: ProposalRejectionReason): Promise<void> {
    const snapshot = this.store.get(runId);
    const hasPending =
      snapshot.finishRequest !== null ||
      Object.values(snapshot.proposals).some(
        (proposal) => proposal.status === 'queued' || proposal.status === 'integrating',
      ) ||
      Object.values(snapshot.verifications).some(
        (verification) => verification.status === 'queued' || verification.status === 'running',
      );
    if (!hasPending) {
      return;
    }
    const now = this.now();
    await this.store.update(runId, (run) => {
      let changed = false;
      for (const proposal of Object.values(run.proposals)) {
        if (proposal.status !== 'queued' && proposal.status !== 'integrating') {
          continue;
        }
        for (const attemptId of proposal.attemptIds) {
          const attempt = run.integrationAttempts[attemptId];
          if (attempt !== undefined && (attempt.status === 'merging' || attempt.status === 'verifying')) {
            run.integrationAttempts[attemptId] = { ...attempt, status: 'interrupted', updatedAt: now };
          }
        }
        recordProposalRejection(run, proposal, reason, now);
        changed = true;
      }
      for (const verification of Object.values(run.verifications)) {
        if (verification.status !== 'queued' && verification.status !== 'running') {
          continue;
        }
        if (verification.purpose === 'proposal') {
          const proposal = verification.proposalId === null ? undefined : run.proposals[verification.proposalId];
          if (proposal !== undefined && proposal.status === 'accepted') {
            continue;
          }
        }
        run.verifications[verification.id] = { ...verification, status: 'interrupted', finishedAt: now };
        if (verification.purpose === 'finish' && run.finishRequest?.verificationId === verification.id) {
          run.finishRequest = null;
        }
        changed = true;
      }
      if (run.activeAttemptId !== null) {
        const active = run.integrationAttempts[run.activeAttemptId];
        if (active === undefined || active.status === 'interrupted') {
          run.activeAttemptId = null;
          changed = true;
        }
      }
      if (run.finishRequest !== null) {
        // 控制请求取消尚未交付的 finish 提议；已完成验证的凭据仍保留供 resume 后复用。
        run.finishRequest = null;
        changed = true;
      }
      if (changed) {
        run.revision += 1;
        run.updatedAt = now;
      }
      return run;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 内部工具                                                            */
  /* ------------------------------------------------------------------ */

  private controlFor(runId: RunId): RunControl {
    let control = this.controls.get(runId);
    if (control === undefined) {
      control = { abort: new AbortController(), interrupt: null };
      this.controls.set(runId, control);
    }
    return control;
  }

  /**
   * 已 pause/stop 的 run 在 resume 后重新进入 running/draining 时，清除上一次控制留下的
   * 中止信号；否则后续 `process` 会立刻以为已取消而不再集成。
   */
  private resetControlIfActive(runId: RunId): void {
    const control = this.controls.get(runId);
    if (control === undefined || control.interrupt === null) {
      return;
    }
    const run = this.store.get(runId);
    if (run.phase === 'running' || run.phase === 'draining') {
      control.abort = new AbortController();
      control.interrupt = null;
    }
  }

  private newId(): string {
    return this.createId();
  }

  private enqueue<T>(runId: RunId, operation: () => Promise<T>): Promise<T> {
    const result = this.queues.run(runId, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(runId, tail);
    void tail.then(() => {
      if (this.tails.get(runId) === tail) {
        this.tails.delete(runId);
      }
    });
    return result;
  }

  private reportFailure(runId: RunId, error: unknown): void {
    if (this.onFailure !== undefined) {
      this.onFailure(runId, normalizeError(error));
    }
  }
}

/* ------------------------------------------------------------------ */
/* 查询 helper（导出给 finish 复用判断与测试）                           */
/* ------------------------------------------------------------------ */

/**
 * 找一条可用于 `commit` 的持久 passed 验证凭据（架构 §4.2：两种 purpose 都可复用于 finish）。
 *
 * @param fingerprint 验证配置指纹；省略时取 run 当前配置。
 * @returns 最新完成的匹配记录；没有则 null。只读，不修改 run。
 */
export function selectPassedVerification(
  run: Run,
  commit: CommitSha,
  fingerprint: string = verificationFingerprint(run.verification),
): VerificationRecord | null {
  let best: VerificationRecord | null = null;
  for (const verification of Object.values(run.verifications)) {
    if (verification.status !== 'passed' || verification.commit !== commit) {
      continue;
    }
    if (verification.configFingerprint !== fingerprint || (verification.goalRevision ?? 0) !== run.goalRevision) {
      continue;
    }
    if (best === null) {
      best = verification;
      continue;
    }
    const bestAt = best.finishedAt ?? best.createdAt;
    const candidateAt = verification.finishedAt ?? verification.createdAt;
    if (candidateAt > bestAt || (candidateAt === bestAt && verification.id > best.id)) {
      best = verification;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 纯函数工具                                                          */
/* ------------------------------------------------------------------ */

function nextQueuedProposal(run: Run): ProposalRecord | null {
  let best: ProposalRecord | null = null;
  for (const proposal of Object.values(run.proposals)) {
    if (proposal.status !== 'queued') {
      continue;
    }
    if (
      best === null ||
      proposal.createdAt < best.createdAt ||
      (proposal.createdAt === best.createdAt && proposal.id < best.id)
    ) {
      best = proposal;
    }
  }
  return best;
}

function nextQueuedFinishVerification(run: Run): VerificationRecord | null {
  let best: VerificationRecord | null = null;
  for (const verification of Object.values(run.verifications)) {
    if (verification.purpose !== 'finish' || verification.status !== 'queued') {
      continue;
    }
    if (
      best === null ||
      verification.createdAt < best.createdAt ||
      (verification.createdAt === best.createdAt && verification.id < best.id)
    ) {
      best = verification;
    }
  }
  return best;
}

/** 按 resultRef 反查“已发布且凭据精确匹配”的 Proposal/attempt/Verification。 */
function findPublicationEvidence(run: Run, resultRef: CommitSha): PublicationEvidence | null {
  const fingerprint = verificationFingerprint(run.verification);
  let best: PublicationEvidence | null = null;
  for (const verification of Object.values(run.verifications)) {
    if (verification.status !== 'passed' || verification.purpose !== 'proposal') {
      continue;
    }
    if (verification.commit !== resultRef || verification.expectedHead !== run.acceptedHead) {
      continue;
    }
    if (verification.configFingerprint !== fingerprint) {
      continue;
    }
    if (verification.proposalId === null || verification.attemptId === null) {
      continue;
    }
    const proposal = run.proposals[verification.proposalId];
    const attempt = run.integrationAttempts[verification.attemptId];
    if (proposal === undefined || attempt === undefined) {
      continue;
    }
    if (proposal.sourceCommit !== verification.sourceCommit) {
      continue;
    }
    if (attempt.proposalId !== proposal.id || attempt.expectedHead !== run.acceptedHead) {
      continue;
    }
    if (attempt.sourceCommit !== proposal.sourceCommit || attempt.candidateCommit !== resultRef) {
      continue;
    }
    if (best === null) {
      best = { proposal, attempt, verification };
    }
  }
  return best;
}

/** phase/quiesceTarget → 未发布候选的拒绝原因。 */
function phaseRejection(run: Run): ProposalRejectionReason {
  if (run.phase === 'quiescing' || run.phase === 'paused' || run.phase === 'stopped') {
    if (run.quiesceTarget === 'stopped' || run.phase === 'stopped') {
      return 'interrupted_by_stop';
    }
    if (run.quiesceTarget === 'paused' || run.phase === 'paused') {
      return 'interrupted_by_pause';
    }
  }
  return 'interrupted_before_publish';
}

function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const present: AbortSignal[] = [];
  for (const signal of signals) {
    if (signal !== undefined) {
      present.push(signal);
    }
  }
  const [first, ...rest] = present;
  if (first === undefined) {
    return new AbortController().signal;
  }
  if (rest.length === 0) {
    return first;
  }
  return AbortSignal.any([first, ...rest]);
}

function verificationLog(record: VerificationRecord, outcome: VerificationOutcome): string {
  const header = [
    `verification: ${record.id}`,
    `purpose: ${record.purpose}`,
    `commit: ${record.commit}`,
    `expectedHead: ${record.expectedHead}`,
    `status: ${record.status}`,
    `exitCode: ${outcome.exitCode === null ? 'null' : String(outcome.exitCode)}`,
    `timedOut: ${String(outcome.timedOut)}`,
    '--- log ---',
  ];
  return `${header.join('\n')}\n${outcome.log}\n`;
}

function shortCommit(commit: CommitSha): string {
  return commit.length > 12 ? commit.slice(0, 12) : commit;
}