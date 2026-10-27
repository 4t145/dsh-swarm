import { describe, expect, it } from 'vitest';
import { StoredArtifacts, type ArtifactRecord } from '../src/artifacts.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json';

describe('run-owned diagnostics', () => {
  it('persists diagnostics through the actual per-record JSON backend', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'swarm-artifacts-'));
    const backend = new JsonStorageBackend(directory);
    try {
      const unit = await backend.kv.open({ name: 'artifact_test', version: 1, tables: ['artifacts'], hasGlobal: false, layout: 'per-record' });
      const cache = new Map<string, ArtifactRecord>();
      const artifacts = new StoredArtifacts({
        get: (id) => cache.get(id),
        put: async (id, record) => { await unit.putRecord('artifacts', id, record); cache.set(id, record); },
      });
      const reference = await artifacts.save('run', 'verification', 'test passed');
      expect(reference).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(artifacts.readForRun('run', reference).text).toBe('test passed');
      const persisted = await unit.loadAll();
      expect(persisted.tables['artifacts']?.[reference]).toMatchObject({ runId: 'run', text: 'test passed' });
      await expect(unit.putRecord('artifacts', 'swarm-artifact:unsafe', {})).rejects.toThrow('not path-safe');
    } finally {
      await backend.close();
      if (!path.basename(directory).startsWith('swarm-artifacts-') || path.dirname(directory) !== tmpdir()) throw new Error('Unexpected test cleanup target');
      await rm(directory, { recursive: true });
    }
  });

  it('stores references, pages text, and rejects cross-run access', async () => {
    const records = new Map<string, ArtifactRecord>();
    const artifacts = new StoredArtifacts({
      get: (id) => records.get(id),
      put: async (id, record) => { records.set(id, record); },
    });
    const reference = await artifacts.save('a', 'verification', 'abcdef');
    expect(reference.startsWith('swarm-artifact-')).toBe(true);
    // storageDomain per-record keys reject anything outside this safe path alphabet.
    expect(reference).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(artifacts.readForRun('a', reference, 0, 3)).toMatchObject({ text: 'abc', nextOffset: 3, truncated: true });
    expect(artifacts.readForRun('a', reference, 3, 3)).toMatchObject({ text: 'def', truncated: false });
    expect(() => artifacts.readForRun('b', reference)).toThrow('another run');
    expect(() => artifacts.readForRun('a', '../../.env')).toThrow('does not exist');
    expect(() => artifacts.readForRun('a', reference, -1)).toThrow('offset or limit');
  });
});
