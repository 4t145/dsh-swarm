import { describe, expect, it } from 'vitest';
import { StoredArtifacts, type ArtifactRecord } from '../src/artifacts.ts';

describe('run-owned diagnostics', () => {
  it('stores references, pages text, and rejects cross-run access', async () => {
    const records = new Map<string, ArtifactRecord>();
    const artifacts = new StoredArtifacts({
      get: (id) => records.get(id),
      put: async (id, record) => { records.set(id, record); },
    });
    const reference = await artifacts.save('a', 'verification', 'abcdef');
    expect(reference.startsWith('swarm-artifact:')).toBe(true);
    expect(artifacts.readForRun('a', reference, 0, 3)).toMatchObject({ text: 'abc', nextOffset: 3, truncated: true });
    expect(artifacts.readForRun('a', reference, 3, 3)).toMatchObject({ text: 'def', truncated: false });
    expect(() => artifacts.readForRun('b', reference)).toThrow('another run');
    expect(() => artifacts.readForRun('a', '../../.env')).toThrow('does not exist');
    expect(() => artifacts.readForRun('a', reference, -1)).toThrow('offset or limit');
  });
});
