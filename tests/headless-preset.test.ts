import { describe, expect, it } from 'vitest';
import { createHeadlessPreset } from '../src/headless-preset.ts';

describe('portable headless worker composition', () => {
  it('pins the worker module to the application entry, not the profile directory', () => {
    const preset = createHeadlessPreset('file:///checkout%20with%20spaces/lib/headless-preset.js');
    expect(preset.plugins.find((entry) => entry.id === 'swarm-worker-tools')?.name)
      .toBe('file:///checkout%20with%20spaces/lib/worker.js');
    expect(preset.plugins.find((entry) => entry.id === 'tool-fs-search')?.config)
      .toEqual({ sampleOverCapGlobResults: false });
    expect(preset.plugins.some((entry) => /subagent|workflow|plugin-manager/.test(entry.name))).toBe(false);
  });
});
