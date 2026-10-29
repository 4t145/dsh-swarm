/** Owner-scoped, read-only Git history with immutable, signed pagination cursors. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { isSwarmError, SwarmError } from './errors.ts';
import { workerDisplayName } from './worker-names.ts';
import type { Run, WorkerRecord } from './types.ts';

export const WORKTREE_HISTORY_PAGE_SIZE = 30;
const MAX_CURSOR_CHARS = 32_768;
const shaSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const laneSchema = z.object({
  workerId: z.string().nullable(), displayName: z.string().nullable(),
  branch: z.string(), worktreePath: z.string().nullable(), head: shaSchema.nullable(),
  diagnostic: z.string().nullable(),
});
const cursorSchema = z.object({
  version: z.literal(1), runId: z.string(), ownerSessionId: z.string(),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - WORKTREE_HISTORY_PAGE_SIZE),
  worktrees: z.array(laneSchema).max(17),
});
type Cursor = z.infer<typeof cursorSchema>;
export type WorktreeHistoryLane = z.infer<typeof laneSchema>;

/** A commit's source is a reachable branch, not a claim about its author. */
export interface WorktreeGitCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly subject: string;
  readonly committedAt: number;
  readonly sourceHead: string;
}
export interface WorktreeHistoryItem extends Omit<WorktreeGitCommit, 'sourceHead'> {
  readonly id: string;
  readonly workerId: string | null;
  readonly displayName: string | null;
  readonly branch: string;
  readonly worktreePath: string | null;
}
/** A commit a worker submitted as a proposal; a factual track seed, unlike `--source`. */
export interface WorktreeHistoryTip {
  readonly sha: string;
  readonly workerId: string;
}
export interface WorktreeHistoryPage {
  readonly runId: string;
  readonly items: readonly WorktreeHistoryItem[];
  readonly worktrees: readonly WorktreeHistoryLane[];
  /** Proposal source commits, newest first, so older worker commits keep their track after HEAD moves. */
  readonly tips: readonly WorktreeHistoryTip[];
  readonly nextCursor: string | null;
}
export interface WorktreeHistoryGitPort {
  readWorktreeHead(run: Run, worker: WorkerRecord, signal?: AbortSignal): Promise<string>;
  readWorktreeLog(run: Run, heads: readonly string[], offset: number, limit: number, signal?: AbortSignal): Promise<readonly WorktreeGitCommit[]>;
}
interface HistoryOptions {
  readonly status: (ownerSessionId: string) => { readonly runId: string; readonly ownerSessionId: string };
  readonly getRun: (runId: string) => Run;
  readonly git: WorktreeHistoryGitPort;
}

/** Captures heads once per traversal; refresh (null cursor) sees newly committed work. */
export class WorktreeHistory {
  private readonly key = randomBytes(32);
  private readonly requests = new Map<AbortController, Promise<void>>();
  private disposed = false;

  constructor(private readonly options: HistoryOptions) {}

  async page(sessionId: string, cursor: string | null = null, signal?: AbortSignal): Promise<WorktreeHistoryPage | null> {
    if (this.disposed) throw new SwarmError('SWARM_INVALID_STATE', 'Git history service is disposed');
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'sessionId must be a non-empty string of at most 200 characters');
    }
    // Verify membership before even decoding a cursor, and again before publishing its result.
    let run: Run;
    try {
      const status = this.options.status(sessionId);
      if (status.ownerSessionId !== sessionId) throw new SwarmError('SWARM_FORBIDDEN', 'Only the run owner may read worktree history');
      run = this.options.getRun(status.runId);
      if (run.ownerSessionId !== sessionId) throw new SwarmError('SWARM_FORBIDDEN', 'Only the run owner may read worktree history');
    } catch (error) {
      if (isSwarmError(error) && error.code === 'SWARM_NOT_FOUND' && cursor === null) return null;
      throw error;
    }
    const request = new AbortController();
    const abort = (): void => request.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let settled!: () => void;
    this.requests.set(request, new Promise<void>((resolve) => { settled = resolve; }));
    try {
      request.signal.throwIfAborted();
      const snapshot = cursor === null ? await this.capture(run, request.signal) : this.decode(cursor, run);
      const heads = [...new Set(snapshot.worktrees.flatMap((lane) => lane.head === null ? [] : [lane.head]))];
      const commits = heads.length ? await this.options.git.readWorktreeLog(run, heads, snapshot.offset, WORKTREE_HISTORY_PAGE_SIZE + 1, request.signal) : [];
      request.signal.throwIfAborted();
      const current = this.options.status(sessionId);
      if (current.ownerSessionId !== sessionId || current.runId !== run.id) {
        throw new SwarmError('SWARM_INVALID_STATE', 'The current run changed; refresh Git history');
      }
      const items = commits.slice(0, WORKTREE_HISTORY_PAGE_SIZE).map((commit): WorktreeHistoryItem => {
        const lane = snapshot.worktrees.find((item) => item.head === commit.sourceHead);
        if (!lane) throw new SwarmError('SWARM_INTERNAL', 'Git history returned an unknown source head');
        return {
          id: commit.sha, sha: commit.sha, parents: commit.parents, subject: commit.subject, committedAt: commit.committedAt,
          workerId: lane.workerId, displayName: lane.displayName, branch: lane.branch, worktreePath: lane.worktreePath,
        };
      });
      return {
        runId: run.id, items, worktrees: snapshot.worktrees, tips: proposalTips(run),
        nextCursor: commits.length > WORKTREE_HISTORY_PAGE_SIZE ? this.encode({ ...snapshot, offset: snapshot.offset + items.length }) : null,
      };
    } finally {
      signal?.removeEventListener('abort', abort);
      this.requests.delete(request);
      settled();
    }
  }

  /** Cancels and drains in-flight permission-checked Git commands on plugin unload. */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const request of this.requests.keys()) request.abort();
    await Promise.all(this.requests.values());
  }

  private async capture(run: Run, signal: AbortSignal): Promise<Cursor> {
    const worktrees: WorktreeHistoryLane[] = [];
    for (const worker of Object.values(run.workers)) {
      const displayName = workerDisplayName(worker);
      const lane: WorktreeHistoryLane = { workerId: worker.id, displayName, branch: worker.branch, worktreePath: worker.worktreePath, head: null, diagnostic: null };
      if (worker.initializationState !== 'ready' || !worker.worktreePath) {
        lane.diagnostic = `Worktree ${worker.initializationState}`;
      } else {
        try { lane.head = await this.options.git.readWorktreeHead(run, worker, signal); }
        catch (error) {
          signal.throwIfAborted();
          if (isSwarmError(error) && error.code === 'SWARM_FORBIDDEN') throw error;
          lane.diagnostic = (error instanceof Error ? error.message : String(error)).slice(0, 240);
        }
      }
      worktrees.push(lane);
    }
    worktrees.push({ workerId: null, displayName: null, branch: run.resultRef, worktreePath: run.integrationWorktree, head: run.acceptedHead, diagnostic: null });
    return cursorSchema.parse({ version: 1, runId: run.id, ownerSessionId: run.ownerSessionId, offset: 0, worktrees });
  }

  private encode(value: Cursor): string {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${body}.${createHmac('sha256', this.key).update(body).digest('base64url')}`;
    if (token.length > MAX_CURSOR_CHARS) throw new SwarmError('SWARM_INVALID_STATE', 'Worktree metadata is too large for a history cursor');
    return token;
  }

  private decode(cursor: string, run: Run): Cursor {
    if (typeof cursor !== 'string' || cursor.length > MAX_CURSOR_CHARS) throw new SwarmError('SWARM_INVALID_INPUT', 'Invalid history cursor; refresh Git history');
    const [body, signature, extra] = cursor.split('.');
    if (!body || !signature || extra !== undefined) throw new SwarmError('SWARM_INVALID_INPUT', 'Invalid history cursor; refresh Git history');
    const expected = createHmac('sha256', this.key).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new SwarmError('SWARM_INVALID_INPUT', 'History cursor expired or invalid; refresh Git history');
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    if (!parsed.success || parsed.data.runId !== run.id || parsed.data.ownerSessionId !== run.ownerSessionId) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'History cursor belongs to another run; refresh Git history');
    }
    return parsed.data;
  }
}

/** Bounded, deduplicated proposal tips; first submission of a SHA wins. */
function proposalTips(run: Run): WorktreeHistoryTip[] {
  const seen = new Set<string>();
  const tips: WorktreeHistoryTip[] = [];
  for (const proposal of Object.values(run.proposals).sort((a, b) => b.createdAt - a.createdAt)) {
    if (seen.has(proposal.sourceCommit) || !(proposal.authorWorkerId in run.workers)) continue;
    seen.add(proposal.sourceCommit);
    tips.push({ sha: proposal.sourceCommit, workerId: proposal.authorWorkerId });
    if (tips.length >= 200) break;
  }
  return tips;
}
