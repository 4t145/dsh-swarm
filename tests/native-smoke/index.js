import { writeFile } from 'node:fs/promises';

// Disposable integration fixture. No Agent is created or prompted, no profile
// data is changed, and the bundle is removed after collecting this report.
export const inject = ['swarm', 'agentPresets', 'agents', 'commands', 'tools', 'worktrees'];
export async function apply(ctx) {
  const runtime = await ctx.swarm.ready;
  const preset = await ctx.agentPresets.resolve('swarm-worker');
  const lease = await ctx.agentPresets.acquireScope('swarm-worker');
  let toolNames;
  try {
    toolNames = ctx.tools.schemas(lease.key).map((tool) => tool.name);
  } finally {
    await lease[Symbol.asyncDispose]();
  }
  const required = ['swarm_sync', 'swarm_read', 'swarm_task_create', 'swarm_task_update', 'swarm_publish', 'swarm_message', 'swarm_submit', 'swarm_wait', 'swarm_finish'];
  const missing = required.filter((name) => !toolNames.includes(name));
  if (missing.length) throw new Error(`Worker preset tools missing: ${missing.join(', ')}`);
  const unsafe = ['spawn_teammate', 'subagent', 'subagent_fork', 'workflow', 'plugin_manager'].filter((name) => toolNames.includes(name));
  if (unsafe.length) throw new Error(`Worker preset unexpectedly delegates/manages plugins: ${unsafe.join(', ')}`);
  const root = ctx.agents.roots()[0];
  const commandRegistered = root ? Boolean(ctx.commands.find(root, 'swarm')) : false;
  if (!commandRegistered) throw new Error('The human /swarm command is not registered');
  let emptyStatusCode = '';
  try { runtime.status('native-smoke-non-owner'); }
  catch (error) { emptyStatusCode = error.code ?? String(error); }
  if (emptyStatusCode !== 'SWARM_NOT_FOUND') throw new Error('Unexpected empty owner status');
  const report = {
    kind: 'native-host-load-smoke',
    checkedAt: new Date().toISOString(),
    runtimeReady: true,
    commandRegistered,
    worktreeServiceAvailable: Boolean(ctx.get('worktrees')),
    preset,
    workerTools: required,
    extraWorkerTools: toolNames.filter((name) => !required.includes(name)),
    forbiddenDelegationTools: unsafe,
    emptyStatusCode,
    modelCalls: 0,
    note: 'Actual running Host and eager worker preset were exercised; no real model coding task was run.',
  };
  await writeFile(new URL('../../notes/native-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
}
