import { describe, expect, it } from 'vitest';
import { KeyedSerialQueue, SerialQueue } from '../src/serial.ts';

describe('serial operation ordering', () => {
  it('keeps FIFO order and lets work continue after a rejection', async () => {
    const queue = new SerialQueue();
    const values: number[] = [];
    const first = queue.run(() => { values.push(1); throw new Error('expected'); });
    const second = queue.run(() => { values.push(2); return 'ok'; });
    await expect(first).rejects.toThrow('expected');
    await expect(second).resolves.toBe('ok');
    expect(values).toEqual([1, 2]);
    await queue.idle();
  });

  it('does not block an independent key', async () => {
    const queues = new KeyedSerialQueue();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const blocked = queues.run('a', () => barrier);
    await expect(queues.run('b', () => 2)).resolves.toBe(2);
    release();
    await blocked;
    await queues.idle();
  });
});
