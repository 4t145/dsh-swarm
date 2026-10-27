import { describe, expect, it } from 'vitest';
import { HeadlessDriverLifetime } from '../src/headless-lifetime.ts';

describe('headless provider lifetime', () => {
  it('keeps shutdown pending until the aborted driver settles', async () => {
    const lifetime = new HeadlessDriverLifetime();
    let release = (): void => undefined;
    let aborted = false;
    let closed = false;
    const run = lifetime.run((signal) => new Promise<void>((resolve) => {
      release = resolve;
      signal.addEventListener('abort', () => { aborted = true; });
    }));
    const closing = lifetime.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(aborted).toBe(true);
    expect(closed).toBe(false);
    release();
    await Promise.all([run, closing]);
    expect(closed).toBe(true);
    await expect(lifetime.run(async () => undefined)).rejects.toMatchObject({ code: 'SWARM_INVALID_STATE' });
  });

  it('does not swallow driver errors or strand teardown after rejection', async () => {
    const lifetime = new HeadlessDriverLifetime();
    await expect(lifetime.run(async () => { throw new Error('driver failed'); })).rejects.toThrow('driver failed');
    await lifetime.close();
  });
});
