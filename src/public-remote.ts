/** Owner-authorized, on-demand public history. No mutation, polling or private-message projection. */
import { assert } from './errors.ts';
import type { PublicQuery } from './public-input.ts';
import type { PublicPage } from './public-query.ts';

export interface PublicReaderPort {
  queryForOwner(ownerSessionId: string, runId: string, input: PublicQuery): PublicPage;
}

/** Check the owner/current run on every page, including cursor-based and by-message reads. */
export class PublicHistoryReader {
  private disposed = false;
  constructor(private readonly runtime: { status(sessionId: string): { runId: string; ownerSessionId: string } },
    private readonly publicReader: PublicReaderPort) {}

  page(sessionId: string, runId: string, query: PublicQuery): PublicPage {
    assert(!this.disposed, 'SWARM_STORE_CLOSED', 'Public history reader is disposed');
    assert(typeof runId === 'string' && runId.trim().length > 0 && runId.length <= 240,
      'SWARM_INVALID_INPUT', 'runId must be a non-empty bounded string');
    const current = this.runtime.status(sessionId);
    assert(current.ownerSessionId === sessionId, 'SWARM_FORBIDDEN', 'Only the original owner can read public history');
    assert(current.runId === runId, 'SWARM_INVALID_INPUT', 'Run changed; refresh the current session before reading public history');
    return this.publicReader.queryForOwner(sessionId, runId, query);
  }

  dispose(): void { this.disposed = true; }
}
