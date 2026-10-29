/**
 * Live-view rules for `claim` Findings.
 *
 * A claim announces the scope a worker is about to touch; it is never a lock (Task CAS stays the
 * authority). Claims leave live views and pushed notices once older than the TTL, and a newer claim
 * by the same author on the same task replaces the earlier one there. History and search keep all.
 */
import type { FindingRecord, Run } from './types.ts';

/** True when this finding should appear in live views; non-claim findings are always live. */
export function isLiveFinding(run: Run, finding: FindingRecord, now: number, ttlMs: number): boolean {
  if (finding.kind !== 'claim') return true;
  if (now - finding.createdAt >= ttlMs) return false;
  if (finding.taskId === null) return true;
  for (const other of Object.values(run.findings)) {
    if (other.kind === 'claim' && other.authorWorkerId === finding.authorWorkerId
      && other.taskId === finding.taskId && other.seq > finding.seq) return false;
  }
  return true;
}

/** Current live claims, oldest first. */
export function liveClaims(run: Run, now: number, ttlMs: number): FindingRecord[] {
  return Object.values(run.findings)
    .filter((finding) => finding.kind === 'claim' && isLiveFinding(run, finding, now, ttlMs))
    .sort((left, right) => left.seq - right.seq);
}

/** Pushed/live projections never carry `details`; callers expand it through swarm_read by id. */
export function withoutDetails(finding: FindingRecord): FindingRecord & { hasDetails: boolean } {
  const { details, ...rest } = finding;
  return { ...rest, hasDetails: details !== undefined };
}
