import { describe, expect, it } from 'vitest';
import { randomWorkerName, workerDisplayName } from '../src/worker-names.ts';
import { workerRecordSchema } from '../src/schema.ts';

describe('readable worker names', () => {
  it('selects unused word pairs, even when all but one are occupied', () => {
    const names = new Set<string>();
    for (let index = 0; index < 256; index += 1) {
      const name = randomWorkerName(names);
      expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/u);
      expect(names.has(name)).toBe(false);
      names.add(name);
    }
    expect(() => randomWorkerName(names)).toThrow('No unused');
  });

  it('keeps persisted names and gives legacy records a stable readable fallback', () => {
    expect(workerDisplayName({ id: 'run-w1', displayName: 'Sunny Otter' })).toBe('Sunny Otter');
    const legacy = { id: 'run-w2' };
    expect(workerDisplayName(legacy)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/u);
    expect(workerDisplayName(legacy)).toBe(workerDisplayName({ ...legacy }));
  });

  it('reads legacy worker records and rejects blank or oversized persisted names', () => {
    const legacy = { id: 'w1', sessionId: 's1', branch: 'b1', worktreePath: null,
      initializationState: 'pending', initializationError: null, unavailableReason: null,
      offeredSeq: 0, observedSeq: 0, notifiedSeq: 0, wakeTargetSeq: 0,
      waitRegistration: null, currentTaskId: null, createdAt: 0 };
    expect(workerRecordSchema.parse(legacy)).toEqual(legacy);
    expect(workerRecordSchema.parse({ ...legacy, displayName: 'Sunny Otter' }).displayName).toBe('Sunny Otter');
    expect(workerRecordSchema.safeParse({ ...legacy, displayName: ' ' }).success).toBe(false);
    expect(workerRecordSchema.safeParse({ ...legacy, displayName: 'a'.repeat(81) }).success).toBe(false);
  });
});
