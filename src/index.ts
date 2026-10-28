/** Native Cordis Host entry for the single-process Swarm service. */
import { Service, type Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-experimental-worktree';
import type {} from '@deepseek-ai/dsh-working-directory';
import type {} from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-jobs';
import type {} from '@deepseek-ai/dsh-sandbox';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import type {} from '@deepseek-ai/dsh-subprocess';
import { artifactSchema, StoredArtifacts } from './artifacts.ts';
import { registerSwarmCommand } from './commands.ts';
import { DshCommandExecutor } from './dsh-executor.ts';
import { DshWorkerHost } from './dsh-worker-host.ts';
import { runSchema } from './schema.ts';
import type { Run, RunSpec } from './types.ts';
import type { ArtifactRecord } from './artifacts.ts';
import type {} from '@deepseek-ai/dsh-fs';
import type {} from '@deepseek-ai/dsh-tools';
import { MemoryStateStore, type StateStore } from './store.ts';
import { SwarmRuntime } from './runtime.ts';
import { GitWorkspace } from './workspace.ts';
import { registerOwnerTools } from './owner-tools.ts';
import { registerProgress } from './progress.ts';
import { runSwarmHeadless, type RunSwarmHeadlessOptions, type SwarmHeadlessResult } from './headless.ts';
import { HeadlessDriverLifetime } from './headless-lifetime.ts';

/** Deployment controls; goals and verification commands belong in each run spec. */
export interface SwarmConfig {
  eventPageSize: number;
  commandOutputBytes: number;
  commandGraceMs: number;
  /** Distinct CLI storage avoids recovering another live GUI process's runs. */
  storageDomainName: string;
}

function domainSpec(name: string) {
  return defineDomain({
    name,
    version: 1,
    layout: 'per-record' as const,
    tables: { runs: domainTable<string, Run>(runSchema), artifacts: domainTable<string, ArtifactRecord>(artifactSchema) },
  });
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    swarm: SwarmService;
  }
}

/** Shared service; worker preset tools wait for initialization before use. */
export class SwarmService extends Service {
  static inject = [
    'storageDomain', 'agents', 'subagents', 'worktrees', 'workingDirectory',
    'commands', 'jobs', 'tools', 'fs', 'sandbox', 'sandboxPolicy', 'subprocess', 'sessionProjections',
  ];

  static Config = Schema.object({
    eventPageSize: Schema.number().min(1).max(100).default(20),
    commandOutputBytes: Schema.number().min(4096).max(4194304).default(262144),
    commandGraceMs: Schema.number().min(100).max(30000).default(3000),
    storageDomainName: Schema.string().default('local_swarm'),
  });

  /** Initialization is explicit so preset tools never observe a partial runtime. */
  readonly ready: Promise<SwarmRuntime>;
  private artifactsValue: StoredArtifacts | undefined;
  private observerValue: Pick<StateStore, 'get' | 'subscribe'> | undefined;
  private closeResources: (() => Promise<void>) | undefined;
  private readonly headlessDrivers = new HeadlessDriverLifetime();

  constructor(ctx: Context, config: SwarmConfig) {
    super(ctx, 'swarm');
    this.ready = this.initialize(config);
    // Attach a rejection observer immediately; callers still receive the same error.
    void this.ready.catch((error: unknown) => console.error('[swarm] initialization failed', error));
    ctx.effect(() => async () => {
      try { await this.ready; } catch (error) {
        // Initialization rollback is performed at the acquisition site below.
        console.error('[swarm] unloading an uninitialized service', error);
      }
      await this.closeResources?.();
    });
  }

  /** Loader activation fails if persistence or runtime initialization fails. */
  async [Service.init](): Promise<void> {
    await this.ready;
  }

  /** Read run-owned diagnostics after the caller has resolved its membership. */
  get artifacts(): StoredArtifacts {
    if (!this.artifactsValue) throw new Error('Swarm storage is not initialized');
    return this.artifactsValue;
  }

  /** Read-only persisted-run observation shared by CLI and browser transports. */
  get observer(): Pick<StateStore, 'get' | 'subscribe'> {
    if (!this.observerValue) throw new Error('Swarm storage is not initialized');
    return this.observerValue;
  }

  /** Own the driver lifetime so provider teardown cannot close its store early. */
  runHeadless(ownerSessionId: string, spec: RunSpec, options: Omit<RunSwarmHeadlessOptions, 'observe'>): Promise<SwarmHeadlessResult> {
    return this.headlessDrivers.run(async (signal) => runSwarmHeadless(await this.ready, ownerSessionId, spec, {
      ...options, observe: this.observer, signal,
    }), options.signal);
  }

  private async initialize(config: SwarmConfig): Promise<SwarmRuntime> {
    const domain = await this.ctx.storageDomain.open(domainSpec(config.storageDomainName));
    const store = new MemoryStateStore(domain.table('runs'));
    this.observerValue = { get: (id) => store.get(id), subscribe: (listener) => store.subscribe(listener) };
    const artifacts = new StoredArtifacts(domain.table('artifacts'));
    const host = new DshWorkerHost(this.ctx, store);
    const executor = new DshCommandExecutor(this.ctx, {
      graceMs: config.commandGraceMs,
      maxOutputBytes: config.commandOutputBytes,
    });
    const workspace = new GitWorkspace(executor);
    const runtime = new SwarmRuntime(store, host, workspace, artifacts, { eventPageSize: config.eventPageSize });
    this.artifactsValue = artifacts;
    let disposeOwnerTools: (() => void) | undefined;
    let progress: { dispose(): Promise<void> } | undefined;
    this.closeResources = async () => {
      await this.headlessDrivers.close();
      disposeOwnerTools?.();
      await progress?.dispose();
      await runtime.dispose();
      await host.dispose();
      await store.close();
      await domain.close();
    };
    try {
      await runtime.recover();
      registerSwarmCommand(this.ctx, runtime, workspace);
      // Owner-only model control surface; the worker preset never loads this module.
      disposeOwnerTools = registerOwnerTools(this.ctx, runtime);
      // Read-only progress service used by the browser panel and headless observer.
      progress = registerProgress(this.ctx, runtime, store, { git: workspace });
      return runtime;
    } catch (error) {
      await this.closeResources();
      this.closeResources = undefined;
      throw error;
    }
  }
}

export default SwarmService;
