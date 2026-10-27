import { readFile, writeFile } from 'node:fs/promises';
import { apply as checkBase } from './index.js';

export const inject = ['swarm', 'agentPresets', 'agents', 'commands', 'tools', 'worktrees'];
export async function apply(ctx) {
  await checkBase(ctx);
  const runtime = await ctx.swarm.ready;
  const output = new URL('../../notes/native-smoke.json', import.meta.url);
  const report = JSON.parse(await readFile(output, 'utf8'));
  report.latestWorkerFailurePauseCode = runtime.constructor.toString().includes('worker_activation_failed');
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  if (!report.latestWorkerFailurePauseCode) throw new Error('Host still has an older Swarm JavaScript generation; restart is required.');
}
