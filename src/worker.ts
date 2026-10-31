/**
 * `@local/dsh-swarm/worker` preset plugin.
 *
 * Installed only by the `swarm-worker` preset, so these tools and the policy
 * section exist in worker agents alone — never in the parent user session.
 * Load after the Swarm Host service resolves `ready`, then register both the
 * `swarm_*` tools and the stable collaboration policy.
 */

import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type {} from '@deepseek-ai/dsh-jobs';
import type {} from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-tools';
// Type-only: pulls in the `Context.swarm` augmentation without a runtime cycle.
import type {} from './index.ts';
import { registerWorkerTools } from './tools.ts';
import { registerWorkerReceipts } from './worker-receipts.ts';
import { WORKER_POLICY } from './worker-policy.ts';
import { registerWorkerContext, type WorkerContextConfig } from './worker-context.ts';

export const name = 'swarm-worker';

/** Preset services the plugin needs before `apply` runs. */
export const inject = ['swarm', 'tools', 'systemPrompt', 'jobs', 'sessions', 'sessionProjections'];

/** Section order in the gap between TOOL_REPORT (2900) and MCP_SERVERS (3100). */
const POLICY_SECTION_ORDER = 2950;

const DEFAULT_CONTEXT: WorkerContextConfig = { peerNoticeItems: 6, peerNoticeChars: 400 };
export const Config = Schema.object({
  peerNoticeItems: Schema.number().min(1).max(20).step(1).default(DEFAULT_CONTEXT.peerNoticeItems),
  peerNoticeChars: Schema.number().min(80).max(1000).step(1).default(DEFAULT_CONTEXT.peerNoticeChars),
});

export async function apply(ctx: Context, config: WorkerContextConfig = DEFAULT_CONTEXT): Promise<void> {
  const runtime = await ctx.swarm.ready;

  // Projection registration is asynchronous in DSH 0.2.2; await it before tools can consume receipts.
  const receipts = await registerWorkerReceipts(ctx, runtime.collaboration);
  ctx.effect(() => () => { void receipts.dispose(); });
  ctx.effect(() => registerWorkerTools(ctx, runtime, ctx.swarm.artifacts));
  ctx.effect(() => registerWorkerContext(ctx, runtime.collaboration, config));
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'swarm:worker-policy',
      order: POLICY_SECTION_ORDER,
      text: WORKER_POLICY,
    }),
  );
}