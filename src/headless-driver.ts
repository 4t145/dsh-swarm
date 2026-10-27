/** DSH application entry: owns a control Session until the Swarm run terminates. */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { AgentHandle } from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-agent-default-model';
import type {} from '@deepseek-ai/dsh-cmdline';
import type {} from '@deepseek-ai/dsh-fs';
import type {} from './index.ts';
import { parseRunSpec } from './spec.ts';
import { normalizeError, SwarmError } from './errors.ts';
import { parseSwarmHeadlessArgs, SWARM_HEADLESS_HELP, type SwarmHeadlessArgs } from './headless-args.ts';
import { installHeadlessSignals } from './headless-signals.ts';

export const name = 'swarm-headless-driver';
export const inject = ['swarm', 'agents', 'agentDefaultModel', 'cmdlineArgs', 'fs', 'sandboxPolicy', 'llm'];

/** Boot through `dsh --profile headless --patch ...`, never a second server. */
export function apply(ctx: Context): void {
  const argv = ctx.cmdlineArgs?.get();
  const exit = ctx.appExit;
  if (!argv || !exit) throw new SwarmError('SWARM_INVALID_STATE', 'The Swarm driver requires the DSH application launcher');
  let args: SwarmHeadlessArgs;
  try { args = parseSwarmHeadlessArgs(argv); }
  catch (error) {
    const failure = normalizeError(error);
    process.stderr.write(`${failure.code}: ${failure.message}\n`);
    exit(2);
    return;
  }
  if (args.help) {
    process.stdout.write(SWARM_HEADLESS_HELP);
    exit(0);
    return;
  }
  const selectedArgs = args;
  const controller = new AbortController();
  let task: Promise<void> | null = null;
  let ownerHandle: AgentHandle | null = null;
  let interrupted = false;
  const cancel = (): void => {
    interrupted = true;
    controller.abort(new Error('Headless Swarm interrupted'));
  };

  const run = async (): Promise<void> => {
    let code = 1;
    try {
      if (!selectedArgs.specPath) throw new SwarmError('SWARM_INVALID_INPUT', '--spec is required');
      const specPath = path.resolve(selectedArgs.specPath);
      const target = await ctx.fs.resolve(specPath, { signal: controller.signal });
      const source = await ctx.fs.readText(target, controller.signal);
      const spec = parseRunSpec(JSON.parse(source), specPath);
      await ctx.swarm.ready;
      const selection = ctx.agentDefaultModel.currentSelection();
      const provider = selectedArgs.provider ?? selection.provider;
      const model = selectedArgs.model ?? selection.model;
      // A new profile may not have the GUI's provider routes. Reject that before
      // starting a run whose first activation would otherwise pause indefinitely.
      await ctx.llm.resolveModelInfo(provider, model, controller.signal);
      const effort = selectedArgs.reasoningEffort ? ReasoningEffortId(selectedArgs.reasoningEffort) : (selectedArgs.provider ? undefined : selection.reasoningEffort);
      ownerHandle = await ctx.agents.create({
        sessionId: SessionId(`swarm-cli-${randomUUID()}`),
        meta: { cwd: spec.repository, origin: 'subagent', delegationDepth: 0 },
        agentOptions: { provider, model, ...(effort ? { reasoningEffort: effort } : {}) },
        signal: controller.signal,
      });
      const owner = ownerHandle.agent;
      const policy = ctx.sandboxPolicy.resolve({ session: owner.session });
      if (policy.mode === 'read-only') throw new SwarmError('SWARM_FORBIDDEN', 'Swarm needs a writable Session; no automatic permission escalation is allowed');
      const result = await ctx.agents.withInitiator(owner, () => ctx.swarm.runHeadless(String(owner.id), spec, {
        signal: controller.signal,
        write: (line: string) => {
          if (selectedArgs.json) process.stdout.write(`${line}\n`);
          else {
            const event: unknown = JSON.parse(line);
            if (typeof event !== 'object' || event === null) return;
            const record = event as Record<string, unknown>;
            if (record['type'] === 'final') process.stdout.write(`${line}\n`);
            else process.stderr.write(`swarm ${String(record['phase'] ?? '')} ${String(record['runId'] ?? '')}\n`);
          }
        },
      }));
      code = interrupted ? 130 : result.exitCode;
    } catch (error) {
      const failure = normalizeError(error);
      process.stderr.write(`${failure.code}: ${failure.message}\n`);
      if (selectedArgs.json) process.stdout.write(`${JSON.stringify({ type: 'error', code: failure.code, message: failure.message })}\n`);
      code = interrupted ? 130 : 1;
    } finally {
      if (ownerHandle) {
        try { await ownerHandle.dispose(); }
        catch (error) { process.stderr.write(`Swarm owner cleanup failed: ${String(error)}\n`); code = 1; }
      }
      exit(code);
    }
  };

  const start = (): void => { task = run(); };
  const offReady = ctx.appReady?.onReady(start);
  if (!ctx.appReady) queueMicrotask(start);
  const restoreSignals = installHeadlessSignals(process, cancel);
  ctx.effect(() => async () => {
    offReady?.();
    restoreSignals();
    controller.abort(new Error('Headless Swarm application is shutting down'));
    await task;
  });
}
