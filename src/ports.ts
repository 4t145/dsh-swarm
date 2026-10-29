/** Host-independent effect ports shared by the Swarm control modules. */
import type { NotificationRecord } from './public-types.ts';
import type { CommandSpec, CommitSha, IntegrationAttempt, ProposalRecord, Run, RunSpec, VerificationConfig, WorkerRecord } from './types.ts';

/** Actual outcome of one permission-checked, managed command. */
export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: string | null;
  timedOut: boolean;
}

/** All production commands must be routed through the Host sandbox adapter. */
export interface CommandExecutor {
  run(request: CommandSpec & { cwd: string; actorSessionId: string; signal?: AbortSignal }): Promise<CommandResult>;
}

/** Canonical source checkout facts pinned before any worker is created. */
export interface RepositoryInfo {
  repositoryRoot: string;
  gitCommonDir: string;
  baseCommit: CommitSha;
  dirty: boolean;
}

/** Candidate construction never updates the public result ref. */
export type CandidateResult =
  | { kind: 'candidate'; commit: CommitSha }
  | { kind: 'conflict'; diagnostics: string };

/** Verification binds an actual command outcome to immutable code inputs. */
export interface VerificationOutcome {
  passed: boolean;
  interrupted: boolean;
  exitCode: number | null;
  timedOut: boolean;
  log: string;
}

/** Git behavior is kept behind one injectable port for deterministic race tests. */
export interface WorkspacePort {
  inspect(spec: RunSpec, actorSessionId: string, signal?: AbortSignal): Promise<RepositoryInfo>;
  initializeResult(run: Run, signal?: AbortSignal): Promise<void>;
  validateSubmission(run: Run, worker: WorkerRecord, commit: string, signal?: AbortSignal): Promise<CommitSha>;
  pinProposal(run: Run, proposal: ProposalRecord, signal?: AbortSignal): Promise<void>;
  buildCandidate(run: Run, proposal: ProposalRecord, attempt: IntegrationAttempt, signal?: AbortSignal): Promise<CandidateResult>;
  verify(run: Run, commit: CommitSha, signal?: AbortSignal): Promise<VerificationOutcome>;
  publish(run: Run, expected: CommitSha, candidate: CommitSha, signal?: AbortSignal): Promise<void>;
  resultHead(run: Run, signal?: AbortSignal): Promise<CommitSha>;
  diff(run: Run, signal?: AbortSignal): Promise<string>;
}

/** Persist full diagnostics separately from compact coordination records. */
export interface ArtifactPort {
  save(runId: string, name: string, text: string): Promise<string>;
  read(reference: string): Promise<string>;
}

/** A prepared worker still runs through the native DSH subagent manager. */
export interface WorkerStartRequest {
  run: Run;
  worker: WorkerRecord;
  signal: AbortSignal;
}

/** Minimal native lifecycle adapter; no model loop is implemented here. */
export interface WorkerHost {
  start(request: WorkerStartRequest): Promise<void>;
  /** Optional public notification references are a bounded delivered batch, never a read ACK. */
  notify(run: Run, worker: WorkerRecord, throughSeq: number, signal: AbortSignal,
    notifications?: readonly NotificationRecord[]): Promise<void>;
  stop(run: Run): Promise<void>;
  isOwnerLive(ownerSessionId: string): boolean;
  isWorkerBusy(sessionId: string): boolean;
  workerStatus(sessionId: string): 'running' | 'inactive' | 'unavailable';
  onSettled(listener: (sessionId: string, activationId: string, failed: boolean) => void): () => void;
}

/** Tiny clock allows deadlines to be tested without sleeping. */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): () => void;
}

/** Runtime-only configuration fingerprint, stable across object key order. */
export function verificationFingerprint(config: VerificationConfig): string {
  return JSON.stringify({
    setup: config.setup.map(({ argv, timeoutMs }) => ({ argv, timeoutMs })),
    test: config.test.map(({ argv, timeoutMs }) => ({ argv, timeoutMs })),
  });
}

/** Normal wall clock used by production and replaceable in unit tests. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
