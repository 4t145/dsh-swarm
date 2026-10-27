/**
 * `DshCommandExecutor` 的端到端单元测试：用窄接口 fake 覆盖策略传递、confine 行为、
 * 结果分类与真实静止确认，不启动真实沙箱。
 */

import { describe, expect, it, vi } from 'vitest';

import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { ConfinedArgv, SandboxExecutionPolicy, SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox';
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import type {
  SubprocessCollectedOutputs,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputRead,
  SubprocessRuntime,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess';

import {
  DshCommandExecutor,
  type DshCommandExecutorOptions,
  type DshCommandExecutorServices,
} from '../src/dsh-executor.ts';
import { SwarmError, type SwarmErrorCode } from '../src/errors.ts';
import type { CommandResult } from '../src/ports.ts';

const SESSION = Session.create(SessionId('actor-1'));
const BASE_POLICY: SandboxExecutionPolicy = {
  mode: 'workspace-write',
  workspaceRoot: '/workspace',
  sessionId: SESSION.id,
};

/** 真实 Host 服务对象必须满足窄服务接口（只在类型层断言，不构造真实 Context）。 */
interface RealHostServices {
  agents: AgentRegistry;
  sandboxPolicy: SandboxPolicyService;
  sandbox: SandboxProvider;
  subprocess: SubprocessRuntime;
}
type RealHostProvidesExecutorServices = RealHostServices extends DshCommandExecutorServices ? true : never;
const realHostContract: RealHostProvidesExecutorServices = true;
void realHostContract;

const CONFINED: ConfinedArgv = {
  argv: ['sandbox-runner', '--', '/resolved/git', 'status'],
  enforcement: 'full',
  denialSignatures: ['read-only file system'],
  runnerFailureRules: [],
};

function outputReader(text: string): { readFrom(fromByte: number): SubprocessOutputRead } {
  return {
    readFrom(fromByte) {
      const slice = fromByte >= text.length ? '' : text.slice(fromByte);
      return { text: slice, nextOffset: text.length, lossy: false };
    },
  };
}

interface FakeHandleOptions {
  outcome?: SubprocessOutcome;
  reject?: unknown;
  stdout?: string;
  stderr?: string;
  waitForExit?: () => Promise<boolean>;
  /** 收到 spawn 的 abort 信号时才结算，用来观察真实超时路径。 */
  abortOutcome?: SubprocessOutcome;
}

class FakeHandle implements SubprocessHandle {
  readonly stdin = undefined;
  readonly stdout = undefined;
  readonly stderr = undefined;
  readonly control = undefined;
  readonly collected: SubprocessCollectedOutputs;
  readonly done: Promise<SubprocessOutcome>;
  readonly calls: string[] = [];
  terminateCount = 0;
  waitForExitCount = 0;
  private readonly waitForExitImpl: () => Promise<boolean>;
  private readonly abortOutcome: SubprocessOutcome | undefined;
  private resolveDone: ((outcome: SubprocessOutcome) => void) | undefined;

  constructor(options: FakeHandleOptions) {
    this.collected = {
      stdout: outputReader(options.stdout ?? ''),
      stderr: outputReader(options.stderr ?? ''),
    };
    this.abortOutcome = options.abortOutcome;
    if (options.abortOutcome !== undefined) {
      this.done = new Promise<SubprocessOutcome>((resolve) => {
        this.resolveDone = resolve;
      });
    } else if (options.reject !== undefined) {
      this.done = Promise.reject(options.reject);
    } else {
      this.done = Promise.resolve(options.outcome ?? { exitCode: 0, signal: null });
    }
    void this.done.catch(() => undefined);
    this.waitForExitImpl = options.waitForExit ?? (() => Promise.resolve(true));
  }

  /** 绑定执行器实际使用的取消信号；只有 `abortOutcome` 模式需要。 */
  bindSignal(signal: AbortSignal | undefined): void {
    const outcome = this.abortOutcome;
    if (outcome === undefined) {
      return;
    }
    const settle = (): void => {
      this.resolveDone?.(outcome);
    };
    if (signal === undefined || signal.aborted) {
      settle();
      return;
    }
    signal.addEventListener('abort', settle, { once: true });
  }

  terminate(): void {
    this.terminateCount += 1;
    this.calls.push('terminate');
  }

  async waitForExit(): Promise<boolean> {
    this.waitForExitCount += 1;
    this.calls.push('waitForExit');
    return this.waitForExitImpl();
  }
}

interface HarnessOptions {
  policy?: SandboxExecutionPolicy;
  confine?: (argv: readonly string[], policy: SandboxPolicy) => Promise<ConfinedArgv>;
  handle?: FakeHandle;
  executable?: string;
  executableError?: unknown;
  spawnError?: unknown;
}

interface Harness {
  executor: DshCommandExecutor;
  createExecutor: (options?: DshCommandExecutorOptions) => DshCommandExecutor;
  calls: {
    resolveSession: Session | undefined;
    confineArgs: { argv: readonly string[]; policy: SandboxPolicy } | undefined;
    resolveExecutable: { command: string; env: Readonly<Record<string, string>> | undefined } | undefined;
    spawnSpec: SubprocessSpawnSpec | undefined;
    confineCount: number;
    spawnCount: number;
  };
  handle: FakeHandle;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const handle = options.handle ?? new FakeHandle({ outcome: { exitCode: 0, signal: null } });
  const calls: Harness['calls'] = {
    resolveSession: undefined,
    confineArgs: undefined,
    resolveExecutable: undefined,
    spawnSpec: undefined,
    confineCount: 0,
    spawnCount: 0,
  };
  const services: DshCommandExecutorServices = {
    agents: {
      get: (id) => (id === SESSION.id ? { session: SESSION } : undefined),
    },
    sandboxPolicy: {
      resolve: (request) => {
        calls.resolveSession = request.session;
        return options.policy ?? BASE_POLICY;
      },
    },
    sandbox: {
      confine: async (argv, policy) => {
        calls.confineCount += 1;
        calls.confineArgs = { argv, policy };
        if (options.confine !== undefined) {
          return options.confine(argv, policy);
        }
        return CONFINED;
      },
    },
    subprocess: {
      resolveExecutable: async (command, env) => {
        calls.resolveExecutable = { command, env };
        if (options.executableError !== undefined) {
          throw options.executableError;
        }
        return options.executable ?? '/resolved/git';
      },
      spawn: (spec) => {
        calls.spawnCount += 1;
        calls.spawnSpec = spec;
        if (options.spawnError !== undefined) {
          throw options.spawnError;
        }
        handle.bindSignal(spec.signal);
        return handle;
      },
    },
  };
  return {
    executor: new DshCommandExecutor(services),
    createExecutor: (options?: DshCommandExecutorOptions) => new DshCommandExecutor(services, options),
    calls,
    handle,
  };
}

function request(overrides: { argv?: string[]; cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {}) {
  return {
    argv: overrides.argv ?? ['git', 'status', '--porcelain'],
    cwd: overrides.cwd ?? '/workspace/repo',
    actorSessionId: 'actor-1',
    timeoutMs: overrides.timeoutMs ?? 1_000,
    ...(overrides.signal === undefined ? {} : { signal: overrides.signal }),
  };
}

async function expectSwarmError(promise: Promise<unknown>, code: SwarmErrorCode): Promise<SwarmError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SwarmError);
    const swarmError = error as SwarmError;
    expect(swarmError.code).toBe(code);
    return swarmError;
  }
  throw new Error(`expected SwarmError ${code}`);
}

describe('DshCommandExecutor', () => {
  it('从真实 actor session 解析策略并把 confine 后的 argv 交给 subprocess', async () => {
    const harness = createHarness();

    const result = await harness.executor.run(request());

    expect(harness.calls.resolveSession).toBe(SESSION);
    expect(harness.calls.confineCount).toBe(1);
    expect(harness.calls.confineArgs?.argv).toEqual(['/resolved/git', 'status', '--porcelain']);
    expect(harness.calls.confineArgs?.policy.mode).toBe('workspace-write');
    expect(harness.calls.confineArgs?.policy.workspaceRoot).toBe('/workspace');
    expect(harness.calls.spawnSpec?.argv).toEqual(CONFINED.argv);
    expect(harness.calls.spawnSpec?.cwd).toBe('/workspace/repo');
    expect(result).toEqual<CommandResult>({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });
  });

  it('danger-full-access 不调用 confine，也不改写 argv', async () => {
    const harness = createHarness({ policy: { ...BASE_POLICY, mode: 'danger-full-access' } });

    await harness.executor.run(request());

    expect(harness.calls.confineCount).toBe(0);
    expect(harness.calls.spawnSpec?.argv).toEqual(['/resolved/git', 'status', '--porcelain']);
  });

  it('普通非零退出原样返回事实，不抛错', async () => {
    const harness = createHarness({
      handle: new FakeHandle({
        outcome: { exitCode: 7, signal: null },
        stdout: 'partial output\n',
        stderr: 'fatal: not a git repository\n',
      }),
    });

    const result = await harness.executor.run(request());

    expect(result).toEqual<CommandResult>({
      exitCode: 7,
      stdout: 'partial output\n',
      stderr: 'fatal: not a git repository\n',
      signal: null,
      timedOut: false,
    });
  });

  it('沙箱拒绝抛 SWARM_FORBIDDEN 而不是命令失败', async () => {
    const harness = createHarness({
      handle: new FakeHandle({
        outcome: { exitCode: 1, signal: null },
        stderr: 'touch: cannot touch \'x\': Read-only file system\n',
      }),
    });

    const error = await expectSwarmError(harness.executor.run(request()), 'SWARM_FORBIDDEN');

    expect(error.details?.['sandboxMode']).toBe('workspace-write');
    expect(error.details?.['exitCode']).toBe(1);
  });

  it('runner 故障优先于 denial，并保留 SANDBOX_UNAVAILABLE 诊断', async () => {
    const harness = createHarness({
      confine: async () => ({
        ...CONFINED,
        denialSignatures: ['read-only file system'],
        runnerFailureRules: [{ fatalSignatures: ['bwrap: Failed to create namespace'] }],
      }),
      handle: new FakeHandle({
        outcome: { exitCode: 1, signal: null },
        stderr: 'bwrap: Failed to create namespace\nread-only file system\n',
      }),
    });

    const error = await expectSwarmError(harness.executor.run(request()), 'SWARM_INTERNAL');

    expect(error.details?.['code']).toBe('SANDBOX_UNAVAILABLE');
    expect(String(error.details?.['detail'])).toContain('bwrap');
  });

  it('runner 证据不足的非零退出按事实返回', async () => {
    const harness = createHarness({
      confine: async () => ({
        ...CONFINED,
        runnerFailureRules: [{ fatalSignatures: ['bwrap: Failed to create namespace'] }],
      }),
      handle: new FakeHandle({
        outcome: { exitCode: 1, signal: null },
        stderr: 'error: could not lock config file\n',
      }),
    });

    const result = await harness.executor.run(request());

    expect(result.exitCode).toBe(1);
  });

  it('等待真实静止：先 terminate 再 waitForExit，且未静止前不返回', async () => {
    let release: (value: boolean) => void = () => undefined;
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const handle = new FakeHandle({
      outcome: { exitCode: 0, signal: null },
      waitForExit: () => gate,
    });
    const harness = createHarness({ handle });

    let settled = false;
    const running = harness.executor.run(request()).then((value) => {
      settled = true;
      return value;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(handle.terminateCount).toBe(1);
    expect(handle.calls).toEqual(['terminate', 'waitForExit']);

    release(true);
    await running;
    expect(settled).toBe(true);
  });

  it('子进程环境只含 Git 选择器清理与非交互开关，不转发 process.env', async () => {
    const harness = createHarness();

    await harness.executor.run(request());

    const env = harness.calls.spawnSpec?.env ?? {};
    expect(Object.keys(env).sort()).toEqual(
      [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_COMMON_DIR',
        'GIT_INDEX_FILE',
        'GIT_CONFIG',
        'GIT_CONFIG_COUNT',
        'GIT_CONFIG_PARAMETERS',
        'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
        'GIT_CEILING_DIRECTORIES',
        'GIT_PREFIX',
        'GIT_SHALLOW_FILE',
        'GIT_GRAFT_FILE',
        'GIT_REPLACE_REF_BASE',
        'GIT_ATTR_SOURCE',
        'GIT_TERMINAL_PROMPT',
        'GIT_LFS_SKIP_SMUDGE',
        'GIT_NO_LAZY_FETCH',
      ].sort(),
    );
    expect(env['GIT_DIR']).toBeUndefined();
    expect(env['GIT_CONFIG_COUNT']).toBeUndefined();
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
    expect(env['GIT_LFS_SKIP_SMUDGE']).toBe('1');
    expect(env['GIT_NO_LAZY_FETCH']).toBe('1');
    expect(env['PATH']).toBeUndefined();
  });

  it('输出上限与宽限时间进入 spawn 规格', async () => {
    const handle = new FakeHandle({ outcome: { exitCode: 0, signal: null } });
    const harness = createHarness({ handle });
    const executor = harness.createExecutor({ graceMs: 250, maxOutputBytes: 128 });

    await executor.run(request());

    expect(harness.calls.spawnSpec?.graceMs).toBe(250);
    expect(harness.calls.spawnSpec?.stdio.stdout).toEqual({ maxBytes: 128 });
    expect(harness.calls.spawnSpec?.stdio.stderr).toEqual({ maxBytes: 128 });
    expect(harness.calls.spawnSpec?.stdio.stdin).toBe('ignore');
  });

  it('未知 actor 在解析策略前被拒绝', async () => {
    const harness = createHarness();

    await expectSwarmError(harness.executor.run({ ...request(), actorSessionId: 'ghost' }), 'SWARM_FORBIDDEN');

    expect(harness.calls.resolveSession).toBeUndefined();
    expect(harness.calls.spawnCount).toBe(0);
  });

  it('已取消的调用不 spawn，返回取消事实', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    controller.abort();

    const result = await harness.executor.run(request({ signal: controller.signal }));

    expect(harness.calls.spawnCount).toBe(0);
    expect(result).toEqual<CommandResult>({ exitCode: null, stdout: '', stderr: '', signal: null, timedOut: false });
  });

  it('超时返回 timedOut 事实并已确认静止', async () => {
    const handle = new FakeHandle({
      abortOutcome: { exitCode: null, signal: 'SIGTERM' },
      stdout: 'partial',
    });
    const harness = createHarness({ handle });
    const executor = harness.createExecutor({ graceMs: 10 });

    vi.useFakeTimers();
    try {
      const running = executor.run(request({ timeoutMs: 5, argv: ['node', '-e', 'setInterval(() => {}, 1000)'] }));
      await vi.advanceTimersByTimeAsync(5);
      const result = await running;

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
      expect(result.stdout).toBe('partial');
      expect(handle.terminateCount).toBe(1);
      expect(handle.waitForExitCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('spawn 失败（非 runner 证据）抛 SWARM_INTERNAL', async () => {
    const harness = createHarness({ spawnError: new Error('spawn EACCES') });

    const error = await expectSwarmError(harness.executor.run(request()), 'SWARM_INTERNAL');

    expect(error.details?.['argv']).toEqual(['sandbox-runner', '--', '/resolved/git', 'status']);
  });

  it('confine 故障抛 SWARM_INTERNAL 并标记 SANDBOX_UNAVAILABLE', async () => {
    const harness = createHarness({
      confine: async () => {
        throw new Error('no usable sandbox backend');
      },
    });

    const error = await expectSwarmError(harness.executor.run(request()), 'SWARM_INTERNAL');

    expect(error.details?.['code']).toBe('SANDBOX_UNAVAILABLE');
    expect(harness.calls.spawnCount).toBe(0);
  });
});
