/** Test-only adapter: no generated output and no vendor HTTP requests. */
import { appendFile } from 'node:fs/promises';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject = ['llm'];
export function apply(ctx, config) {
  if (typeof config?.readyPath !== 'string') throw new Error('readyPath is required');
  class BlockingAdapter extends LlmAdapter {
    async resolveModel(provider, id) {
      return { provider, id, name: 'Blocking cancellation fixture', context: { contextWindow: 131072 }, inputModalities: ['text'], reasoning: { efforts: [{ id: 'off', name: 'Off' }] } };
    }
    async *stream(options) {
      await appendFile(config.readyPath, 'started\n');
      if (!options.signal.aborted) await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
    }
  }
  return ctx.llm.registerAdapter(['swarm-cancel-fixture'], new BlockingAdapter());
}
