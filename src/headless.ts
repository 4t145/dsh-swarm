/**
 * Non-GUI driver for exactly one swarm run.
 *
 * The driver starts a run through the public runtime, follows the persisted
 * run record through an injected read-only observer, and settles only after
 * the run reaches a terminal phase (`completed` / `stopped` / `failed`).
 * Worker readiness, worker inactivity and DSH agent idleness are deliberately
 * not completion signals: only the run aggregate transition counts.
 *
 * Output is newline-delimited JSON (JSONL) written through an injected sink
 * (stdout by default). Every line is a bounded public projection: task counts,
 * worker cursors and proposal/verification counts, never message bodies,
 * findings, raw events or command output. Total progress lines are capped, and
 * one oversized line degrades to a compact marker instead of growing
 * unbounded.
 *
 * The module never imports React, opens a port, spawns a process or starts a
 * model; the Host composition that owns the runtime supplies both the owner
 * session identity and the observer.
 */

import { SwarmError, normalizeError } from './errors.ts';
import type { StateStore } from './store.ts';
import type { Millis, Run, RunPhase, RunSpec, WorkerInitializationState } from './types.ts';

/** Phase values a driver may exit on; non-terminal phases never settle it. */
export type TerminalRunPhase = 'completed' | 'stopped' | 'failed';

/** Default cap on emitted progress records; further updates are only counted. */
export const DEFAULT_MAX_PROGRESS_EVENTS = 500;
/** Default byte cap for one JSONL line. */
export const DEFAULT_MAX_LINE_BYTES = 8192;
/** Observation buffer before the started run id is known. */
const MAX_BUFFERED_RECORDS = 64;

/** Read-only view of persisted run records; `StateStore` satisfies it. */
export interface HeadlessRunObserver {
  /** Latest persisted record, or undefined when the id is unknown. */
  get(runId: string): Run | undefined;
  /** Notified after each successful persist; returns an unsubscribe function. */
  subscribe(listener: (run: Run) => void): () => void;
}

/** Observer injection: an explicit port or the Host `StateStore` directly. */
export type HeadlessObservation = HeadlessRunObserver | Pick<StateStore, 'get' | 'subscribe'>;

/** Public runtime calls this driver needs; `SwarmRuntime` satisfies the shape. */
export interface SwarmHeadlessRuntime {
  start(ownerSessionId: string, spec: RunSpec): Promise<Run>;
  stop(ownerSessionId: string): Promise<Run>;
}

/** Bounded task counts copied from the run aggregate. */
export interface HeadlessTaskCounts {
  open: number;
  claimed: number;
  proposed: number;
  done: number;
  blocked: number;
  cancelled: number;
  total: number;
}

/** Bounded worker projection; no cursors, wait lists or diagnostics. */
export interface HeadlessWorkerRow {
  id: string;
  initializationState: WorkerInitializationState;
  currentTaskId: string | null;
}

/** One progress record emitted for a persisted run update. */
export interface HeadlessProgressLine {
  type: 'progress';
  index: number;
  runId: string;
  revision: number;
  phase: RunPhase;
  reason: string | null;
  deadline: Millis;
  now: Millis;
  budgetExpired: boolean;
  quiesceTarget: string | null;
  tasks: HeadlessTaskCounts;
  workers: HeadlessWorkerRow[];
  proposals: { queued: number; integrating: number; accepted: number; rejected: number };
  verifications: { queued: number; running: number; passed: number; failed: number; interrupted: number };
  finishRequested: boolean;
  acceptedHead: string;
  resultRef: string;
}

/** Emitted once when a run reaches a terminal phase. */
export interface HeadlessFinalLine {
  type: 'final';
  ok: boolean;
  runId: string;
  phase: TerminalRunPhase;
  reason: string | null;
  baseCommit: string;
  acceptedHead: string;
  resultRef: string;
  tasks: HeadlessTaskCounts;
  workers: HeadlessWorkerRow[];
  proposals: HeadlessProgressLine['proposals'];
  verifications: HeadlessProgressLine['verifications'];
  finishRequested: boolean;
  aborted: boolean;
  progressEvents: number;
  suppressedProgressEvents: number;
  exitCode: number;
  error: { code: string; message: string } | null;
}

/** Emitted instead of a final run line when `start` itself fails. */
export interface HeadlessFailureLine {
  type: 'final';
  ok: false;
  runId: null;
  phase: null;
  reason: null;
  acceptedHead: null;
  resultRef: null;
  tasks: null;
  workers: [];
  aborted: boolean;
  progressEvents: number;
  suppressedProgressEvents: number;
  exitCode: 1;
  error: { code: string; message: string };
}

/** Successful driver outcome: the terminal run record and its exit code. */
export interface SwarmHeadlessResult {
  runId: string;
  phase: TerminalRunPhase;
  reason: string | null;
  acceptedHead: string;
  resultRef: string;
  exitCode: number;
  aborted: boolean;
  progressEvents: number;
  suppressedProgressEvents: number;
  final: HeadlessFinalLine;
}

/** Injection points and output bounds for {@link runSwarmHeadless}. */
export interface RunSwarmHeadlessOptions {
  /**
   * Persisted-run observer (required). Pass the Host `StateStore`; terminal
   * detection never relies on polling `runtime.status`.
   */
  observe: HeadlessObservation;
  /** Cancels the driver by stopping this run; other runs are untouched. */
  signal?: AbortSignal;
  /** Receives one JSONL line without a trailing newline; defaults to stdout. */
  write?: (line: string) => void;
  /** Clock used for the `now` field; defaults to `Date.now`. */
  now?: () => Millis;
  /** Maximum progress records; extra updates only increment the suppressed count. */
  maxProgressEvents?: number;
  /** Maximum bytes per JSONL line before degrading to a compact marker. */
  maxLineBytes?: number;
}

/** Count tasks by status; mirrors the public status projection. */
function countTasks(run: Run): HeadlessTaskCounts {
  const counts: HeadlessTaskCounts = {
    open: 0,
    claimed: 0,
    proposed: 0,
    done: 0,
    blocked: 0,
    cancelled: 0,
    total: 0,
  };
  for (const task of Object.values(run.tasks)) {
    counts[task.status] += 1;
    counts.total += 1;
  }
  return counts;
}

function countProposals(run: Run): HeadlessProgressLine['proposals'] {
  const counts = { queued: 0, integrating: 0, accepted: 0, rejected: 0 };
  for (const proposal of Object.values(run.proposals)) {
    counts[proposal.status] += 1;
  }
  return counts;
}

function countVerifications(run: Run): HeadlessProgressLine['verifications'] {
  const counts = { queued: 0, running: 0, passed: 0, failed: 0, interrupted: 0 };
  for (const verification of Object.values(run.verifications)) {
    counts[verification.status] += 1;
  }
  return counts;
}

function workerRows(run: Run): HeadlessWorkerRow[] {
  return Object.values(run.workers).map((worker) => ({
    id: worker.id,
    initializationState: worker.initializationState,
    currentTaskId: worker.currentTaskId,
  }));
}

/** Narrow a run phase to the terminal set without a cast. */
export function terminalPhaseOf(phase: RunPhase): TerminalRunPhase | null {
  switch (phase) {
    case 'completed':
    case 'stopped':
    case 'failed':
      return phase;
    case 'preparing':
    case 'running':
    case 'draining':
    case 'quiescing':
    case 'paused':
      return null;
  }
}

/** Exit status convention: 0 completed, 1 failed, 130 stopped (SIGINT-like). */
function exitCodeFor(phase: TerminalRunPhase): number {
  switch (phase) {
    case 'completed':
      return 0;
    case 'stopped':
      return 130;
    case 'failed':
      return 1;
  }
}

function defaultWrite(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Start one run and follow it to a terminal phase.
 *
 * Resolution: only after the persisted run reaches `completed`, `stopped` or
 * `failed`. Non-terminal phases (including `quiescing` and `paused`) keep the
 * driver waiting; worker inactivity is never observed as completion.
 *
 * Cancellation: an aborted `signal` calls `runtime.stop(ownerSessionId)` once
 * (this owner's run only) and then keeps waiting for the terminal phase, so the
 * driver exits with `exitCode` 130 and `aborted: true`.
 *
 * @param runtime - public runtime surface (`SwarmRuntime` satisfies it).
 * @param ownerSessionId - real owner session id; never a model-supplied value.
 * @param spec - already parsed run spec.
 * @param options - observer, cancellation, output sink and line bounds.
 * @returns the terminal run projection.
 * @throws SwarmError when the signal is already aborted, `start` rejects, or
 *   the abort-triggered stop fails; the last case may leave the run live.
 */
export function runSwarmHeadless(
  runtime: SwarmHeadlessRuntime,
  ownerSessionId: string,
  spec: RunSpec,
  options: RunSwarmHeadlessOptions,
): Promise<SwarmHeadlessResult> {
  if (ownerSessionId.trim() === '') {
    return Promise.reject(new SwarmError('SWARM_INVALID_INPUT', 'ownerSessionId must be non-empty'));
  }
  const signal = options.signal;
  if (signal?.aborted === true) {
    return Promise.reject(
      new SwarmError('SWARM_INVALID_STATE', 'headless driver was cancelled before the run started', {
        details: { ownerSessionId },
      }),
    );
  }

  const write = options.write ?? defaultWrite;
  const now = options.now ?? Date.now;
  const maxProgress = options.maxProgressEvents ?? DEFAULT_MAX_PROGRESS_EVENTS;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const observe = options.observe;

  let progressEvents = 0;
  let suppressedProgressEvents = 0;
  let activeRunId: string | null = null;
  let lastRevision = -1;
  let aborted = false;
  let stopRequested = false;
  let settled = false;

  let resolveRun: (result: SwarmHeadlessResult) => void = () => undefined;
  let rejectRun: (error: unknown) => void = () => undefined;
  const done = new Promise<SwarmHeadlessResult>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });

  // Subscribe before `start` so a terminal update published while start still
  // awaits cannot be missed; records for other runs or owners are ignored.
  const buffered: Run[] = [];
  let unsubscribe: () => void = () => undefined;

  /** Emit one bounded JSONL line; a throwing sink rejects the driver once. */
  const emit = (value: unknown): boolean => {
    let line = JSON.stringify(value);
    if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
      const compact: Record<string, unknown> =
        typeof value === 'object' && value !== null
          ? { ...(value as Record<string, unknown>), workers: [], truncated: true }
          : { type: 'progress', truncated: true };
      line = JSON.stringify(compact);
      if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
        const type =
          typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
            ? (value as { type: string }).type
            : 'progress';
        line = JSON.stringify({ type, truncated: true });
      }
    }
    try {
      write(line);
      return true;
    } catch (error) {
      // A broken sink must not corrupt the run or leave the driver pending.
      const failure = normalizeError(error, 'SWARM_INTERNAL', 'headless output sink failed');
      settled = true;
      cleanup();
      rejectRun(failure);
      return false;
    }
  };

  const projection = (run: Run, index: number): HeadlessProgressLine => {
    const timestamp = now();
    return {
      type: 'progress',
      index,
      runId: run.id,
      revision: run.revision,
      phase: run.phase,
      reason: run.reason,
      deadline: run.deadline,
      now: timestamp,
      budgetExpired: run.budgetExpiredAt !== null || (run.phase === 'paused' && timestamp >= run.deadline),
      quiesceTarget: run.quiesceTarget,
      tasks: countTasks(run),
      workers: workerRows(run),
      proposals: countProposals(run),
      verifications: countVerifications(run),
      finishRequested: run.finishRequest !== null,
      acceptedHead: run.acceptedHead,
      resultRef: run.resultRef,
    };
  };

  const finish = (run: Run, phase: TerminalRunPhase): void => {
    if (settled) {
      return;
    }
    settled = true;
    const final: HeadlessFinalLine = {
      type: 'final',
      ok: phase === 'completed',
      runId: run.id,
      phase,
      reason: run.reason,
      baseCommit: run.baseCommit,
      acceptedHead: run.acceptedHead,
      resultRef: run.resultRef,
      tasks: countTasks(run),
      workers: workerRows(run),
      proposals: countProposals(run),
      verifications: countVerifications(run),
      finishRequested: run.finishRequest !== null,
      aborted,
      progressEvents,
      suppressedProgressEvents,
      exitCode: exitCodeFor(phase),
      error: null,
    };
    const delivered = emit(final);
    cleanup();
    if (!delivered) {
      return;
    }
    resolveRun({
      runId: final.runId,
      phase,
      reason: final.reason,
      acceptedHead: final.acceptedHead,
      resultRef: final.resultRef,
      exitCode: final.exitCode,
      aborted,
      progressEvents,
      suppressedProgressEvents,
      final,
    });
  };

  const observeRun = (run: Run): void => {
    if (settled || run.id !== activeRunId) {
      return;
    }
    if (run.revision === lastRevision) {
      return;
    }
    lastRevision = run.revision;
    if (progressEvents < maxProgress) {
      const index = progressEvents;
      progressEvents += 1;
      emit(projection(run, index));
    } else {
      suppressedProgressEvents += 1;
    }
    const phase = terminalPhaseOf(run.phase);
    if (phase !== null) {
      finish(run, phase);
    }
  };

  const onAbort = (): void => {
    if (settled) {
      return;
    }
    aborted = true;
    if (activeRunId === null || stopRequested) {
      return;
    }
    stopRequested = true;
    void runtime.stop(ownerSessionId).catch((error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      const failure = normalizeError(error, 'SWARM_INTERNAL', 'stop aborted swarm run');
      emit({
        type: 'final',
        ok: false,
        runId: activeRunId,
        phase: null,
        reason: failure.code,
        acceptedHead: null,
        resultRef: null,
        tasks: null,
        workers: [],
        aborted: true,
        progressEvents,
        suppressedProgressEvents,
        exitCode: 1,
        error: { code: failure.code, message: failure.message },
      });
      cleanup();
      rejectRun(failure);
    });
  };

  const cleanup = (): void => {
    unsubscribe();
    signal?.removeEventListener('abort', onAbort);
  };

  try {
    unsubscribe = observe.subscribe((run) => {
      if (run.ownerSessionId !== ownerSessionId) {
        return;
      }
      if (activeRunId === null) {
        buffered.push(run);
        if (buffered.length > MAX_BUFFERED_RECORDS) {
          buffered.shift();
        }
        return;
      }
      observeRun(run);
    });
  } catch (error) {
    // subscribe is documented to succeed on an open store; a closed store is a
    // caller error, so surface it instead of hanging with no observation.
    return Promise.reject(normalizeError(error, 'SWARM_INTERNAL', 'headless observer subscription failed'));
  }

  signal?.addEventListener('abort', onAbort, { once: true });

  void (async () => {
    let started: Run;
    try {
      started = await runtime.start(ownerSessionId, spec);
    } catch (error) {
      if (!settled) {
        settled = true;
        const failure = normalizeError(error, 'SWARM_INTERNAL', 'headless run start failed');
        emit({
          type: 'final',
          ok: false,
          runId: null,
          phase: null,
          reason: null,
          acceptedHead: null,
          resultRef: null,
          tasks: null,
          workers: [],
          aborted,
          progressEvents,
          suppressedProgressEvents,
          exitCode: 1,
          error: { code: failure.code, message: failure.message },
        });
        cleanup();
        rejectRun(failure);
      }
      return;
    }

    activeRunId = started.id;
    try {
      observeRun(observe.get(started.id) ?? started);
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup();
        rejectRun(normalizeError(error, 'SWARM_INTERNAL', 'headless observer read failed'));
      }
      return;
    }
    for (const run of buffered.splice(0)) {
      observeRun(run);
    }
    if (aborted) {
      onAbort();
    }
  })();

  return done;
}