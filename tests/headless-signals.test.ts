import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installHeadlessSignals } from '../src/headless-signals.ts';

describe('headless application interrupts', () => {
  it('lets the run stop before launcher teardown, then preserves escalation and restoration', () => {
    const emitter = new EventEmitter();
    const launcher = vi.fn();
    const cancel = vi.fn();
    emitter.on('SIGINT', launcher);
    const restore = installHeadlessSignals(emitter, cancel);
    emitter.emit('SIGINT');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(launcher).not.toHaveBeenCalled();
    emitter.emit('SIGINT');
    expect(launcher).toHaveBeenCalledTimes(1);
    restore();
    restore();
    emitter.emit('SIGINT');
    expect(launcher).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('treats SIGTERM as a graceful run cancellation too', () => {
    const emitter = new EventEmitter();
    const launcher = vi.fn();
    const cancel = vi.fn();
    emitter.on('SIGTERM', launcher);
    const restore = installHeadlessSignals(emitter, cancel);
    emitter.emit('SIGTERM');
    expect(cancel).toHaveBeenCalledOnce();
    expect(launcher).not.toHaveBeenCalled();
    restore();
    expect(emitter.rawListeners('SIGTERM')).toEqual([launcher]);
  });
});
