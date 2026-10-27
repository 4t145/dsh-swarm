/** Resolve local worker code before it crosses the preset registry's base URL. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';

export interface HeadlessPresetConfiguration {
  plugins: Array<{ id: string; name: string; config?: Record<string, unknown> }>;
}

/** The registry otherwise resolves nested relative paths against the profile. */
export function createHeadlessPreset(moduleUrl: string): HeadlessPresetConfiguration {
  return {
    plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'You are a cooperative software engineer working in your assigned private Git worktree.' } },
      { id: 'swarm-worker-tools', name: new URL('./worker.js', moduleUrl).href },
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
      { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
    ],
  };
}

export const name = 'swarm-headless-preset';
export const inject = ['agentPresets'];
/** Own one native preset revision; registration returns its awaited disposer. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return ctx.agentPresets.register({ id: 'swarm-worker', name: 'Swarm worker', ...createHeadlessPreset(import.meta.url) });
}
