/** Durable, run-owned diagnostics kept outside the coordination aggregate. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SwarmError } from './errors.ts';
import type { ArtifactPort } from './ports.ts';

/** Stored diagnostics contain no executable path selected by a model. */
export const artifactSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  name: z.string(),
  text: z.string(),
  createdAt: z.number().int().nonnegative(),
});

export type ArtifactRecord = z.infer<typeof artifactSchema>;

/** Directly satisfied by a storageDomain key/value table. */
export interface ArtifactTable {
  get(id: string): ArtifactRecord | undefined;
  put(id: string, record: ArtifactRecord): Promise<void>;
}

/** References are IDs, never arbitrary filesystem paths. */
export class StoredArtifacts implements ArtifactPort {
  constructor(private readonly table: ArtifactTable) {}

  /** Store a new immutable diagnostic after its producing command completed. */
  async save(runId: string, name: string, text: string): Promise<string> {
    const id = `swarm-artifact-${randomUUID()}`;
    await this.table.put(id, { id, runId, name, text, createdAt: Date.now() });
    return id;
  }

  /** Read an internal reference; model callers must use readForRun instead. */
  async read(reference: string): Promise<string> {
    return this.record(reference).text;
  }

  /** Enforce run ownership before returning bounded diagnostic text. */
  readForRun(runId: string, reference: string, offset = 0, limit = 12000): {
    reference: string; name: string; text: string; nextOffset: number; total: number; truncated: boolean;
  } {
    const record = this.record(reference);
    if (record.runId !== runId) throw new SwarmError('SWARM_FORBIDDEN', 'Diagnostic belongs to another run');
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 24000) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'Invalid diagnostic offset or limit');
    }
    const text = record.text.slice(offset, offset + limit);
    const nextOffset = Math.min(record.text.length, offset + text.length);
    return { reference, name: record.name, text, nextOffset, total: record.text.length, truncated: nextOffset < record.text.length };
  }

  private record(reference: string): ArtifactRecord {
    const record = this.table.get(reference);
    if (!record) throw new SwarmError('SWARM_NOT_FOUND', 'Diagnostic reference does not exist');
    return record;
  }
}
