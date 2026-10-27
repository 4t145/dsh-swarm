/**
 * DSH 宿主命令执行器：把 Swarm 的 `CommandExecutor` 端口接到真实的
 * `ctx.subprocess`、`ctx.sandbox` 与 `ctx.sandboxPolicy`。
 *
 * 边界（架构 §5.2 / notes/workspace-api.md §6.2）：
 * - 只接受字面 argv，不经过 shell；可执行文件由 `subprocess.resolveExecutable` 在
 *   provider 的脱敏执行世界里解析。
 * - 策略由调用方的真实 Agent session 解析，本类不猜 session、不升级模式：
 *   `danger-full-access` 不进入 confiner，其余模式必须成功 confine 才 spawn。
 * - 子进程环境只携带 Git 选择器清理与 Git 非交互开关；父进程环境由 subprocess
 *   provider 自己脱敏，本类不转发 `process.env`。
 * - 沙箱拒绝（denial）是权限事实，转成 `SWARM_FORBIDDEN`；runner 失效属于基础设施
 *   故障，转成带 `SANDBOX_UNAVAILABLE` 诊断的 `SWARM_INTERNAL`；两者都不算命令失败。
 *   普通非零退出原样返回，交给调用方判定。
 */

import {
  classifyRunnerFailure,
  isRunnerSpawnFailure,
  matchesSignature,
} from '@deepseek-ai/dsh-sandbox';
import type { ConfinedArgv, SandboxExecutionPolicy, SandboxPolicy } from '@deepseek-ai/dsh-sandbox';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess';
import { MAX_TIMER_DELAY_MS, deadline, timeoutOf } from '@deepseek-ai/dsh-timeout';

import { SwarmError } from './errors.ts';
import type { CommandExecutor, CommandResult } from './ports.ts';
import type { CommandSpec } from './types.ts';

/** 本次执行器消费的最小 Agent 面；真实 `Agent` 结构上满足它。 */
export interface DshCommandExecutorAgent {
  readonly session: Session;
}

/**
 * 执行器消费的 Host 服务窄接口。
 *
 * 真实 Cordis `Context` 可直接传入：`agents`、`sandboxPolicy`、`sandbox`、
 * `subprocess` 的服务签名都满足这里的结构要求。
 */
export interface DshCommandExecutorServices {
  readonly agents: { get(id: SessionId): DshCommandExecutorAgent | undefined };
  readonly sandboxPolicy: {
    resolve(request: { session: Session }): SandboxExecutionPolicy;
  };
  readonly sandbox: {
    confine(argv: readonly string[], policy: SandboxPolicy, signal?: AbortSignal): Promise<ConfinedArgv>;
  };
  readonly subprocess: {
    resolveExecutable(
      command: string,
      env?: Readonly<Record<string, string>>,
      signal?: AbortSignal,
    ): Promise<string>;
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
  };
}

/** 执行器的进程资源上限；两者都必须为正整数。 */
export interface DshCommandExecutorOptions {
  /** provider 终止与流排空的宽限时间，默认 3000ms。 */
  graceMs?: number;
  /** stdout/stderr 各自的在内存上限（字节），默认 65536。 */
  maxOutputBytes?: number;
}

/** 本执行器自有的超时码，只用于把自己设置的 deadline 与上游取消区分开。 */
const TIMEOUT_CODE = 'SWARM_CMD_TIMEOUT';
const DEFAULT_GRACE_MS = 3_000;
const DEFAULT_MAX_OUTPUT_BYTES = 65_536;
const DIAGNOSTIC_LIMIT = 4_000;

/**
 * Git 选择器变量：父环境里的继承值会让命令作用到错误的仓库/索引/配置，
 * 因此一律显式置为 undefined（tombstone），只对本次子进程生效。
 */
const GIT_SELECTOR_KEYS: readonly string[] = [
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
];

/** 只为本次子进程构造的 Git 环境：清理选择器，并禁止交互式提示与懒加载。 */
function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of GIT_SELECTOR_KEYS) {
    env[key] = undefined;
  }
  env['GIT_TERMINAL_PROMPT'] = '0';
  env['GIT_LFS_SKIP_SMUDGE'] = '1';
  env['GIT_NO_LAZY_FETCH'] = '1';
  return env;
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > MAX_TIMER_DELAY_MS) {
    throw new SwarmError('SWARM_INVALID_INPUT', `dsh-executor: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`, {
      details: { option: name, value: resolved },
    });
  }
  return resolved;
}

function truncate(text: string, limit: number = DIAGNOSTIC_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/** 一次子进程结算的三个互相独立的失败面。 */
interface SettledProcess {
  outcome?: SubprocessOutcome;
  failure?: unknown;
  quiescenceFailure?: unknown;
}

/** 一次执行已收集的有界输出；provider 保证 collect 模式存在，缺失时按空串处理。 */
function readCollected(child: SubprocessHandle): { stdout: string; stderr: string } {
  return {
    stdout: child.collected.stdout?.readFrom(0).text ?? '',
    stderr: child.collected.stderr?.readFrom(0).text ?? '',
  };
}

/**
 * 通过 Host 沙箱与 subprocess 服务执行一条命令。
 *
 * 超时与外部取消都折算成 `CommandResult`（`timedOut` 为真表示本执行器设置的
 * deadline 到期），沙箱拒绝与 runner 故障抛 `SwarmError`，其余结果只报告事实。
 * 返回前保证已调用 `terminate()` 并等到托管进程范围静止。
 */
export class DshCommandExecutor implements CommandExecutor {
  private readonly services: DshCommandExecutorServices;
  private readonly graceMs: number;
  private readonly maxOutputBytes: number;

  constructor(services: DshCommandExecutorServices, options: DshCommandExecutorOptions = {}) {
    this.services = services;
    this.graceMs = positiveLimit(options.graceMs, DEFAULT_GRACE_MS, 'graceMs');
    this.maxOutputBytes = positiveLimit(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 'maxOutputBytes');
  }

  async run(request: CommandSpec & { cwd: string; actorSessionId: string; signal?: AbortSignal }): Promise<CommandResult> {
    const program = request.argv[0];
    if (program === undefined || program.length === 0) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'command argv must name an executable', {
        details: { argv: [...request.argv] },
      });
    }
    if (request.cwd.length === 0) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'command working directory must not be empty', {
        details: { argv: [...request.argv] },
      });
    }
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 0) {
      throw new SwarmError('SWARM_INVALID_INPUT', 'command timeoutMs must be a non-negative integer', {
        details: { timeoutMs: request.timeoutMs },
      });
    }

    const agent = this.services.agents.get(SessionId(request.actorSessionId));
    if (agent === undefined) {
      throw new SwarmError('SWARM_FORBIDDEN', `actor session ${request.actorSessionId} is not a live agent`, {
        details: { reason: 'unknown-actor', actorSessionId: request.actorSessionId },
      });
    }
    const policy = this.services.sandboxPolicy.resolve({ session: agent.session });

    const scope = deadline(request.signal, request.timeoutMs, TIMEOUT_CODE);
    try {
      return await this.execute(request, program, policy, scope.signal);
    } catch (error) {
      if (error instanceof SwarmError) {
        throw error;
      }
      const cancelled = this.cancellationOf(scope.signal);
      if (cancelled !== undefined) {
        return cancelled;
      }
      throw new SwarmError('SWARM_INTERNAL', `failed to run ${program}`, {
        details: { argv: [...request.argv], cwd: request.cwd },
        cause: error,
      });
    } finally {
      scope[Symbol.dispose]();
    }
  }

  /** 解析、confine、spawn、分类；取消与超时在这里也返回事实而不是抛错。 */
  private async execute(
    request: CommandSpec & { cwd: string; actorSessionId: string; signal?: AbortSignal },
    program: string,
    policy: SandboxExecutionPolicy,
    signal: AbortSignal,
  ): Promise<CommandResult> {
    const resolved = await this.services.subprocess.resolveExecutable(program, undefined, signal);
    const argv = [resolved, ...request.argv.slice(1)];

    const mode = policy.mode;
    let confined: ConfinedArgv | undefined;
    if (mode !== 'danger-full-access') {
      const confinePolicy: SandboxPolicy = { ...policy, mode };
      try {
        confined = await this.services.sandbox.confine(argv, confinePolicy, signal);
      } catch (error) {
        const cancelled = this.cancellationOf(signal);
        if (cancelled !== undefined) {
          return cancelled;
        }
        throw new SwarmError('SWARM_INTERNAL', `sandbox confinement is unavailable for mode ${mode}`, {
          details: { code: 'SANDBOX_UNAVAILABLE', mode, argv, cwd: request.cwd },
          cause: error,
        });
      }
    }
    const cancelledBeforeSpawn = this.cancellationOf(signal);
    if (cancelledBeforeSpawn !== undefined) {
      return cancelledBeforeSpawn;
    }

    const spawnArgv = confined?.argv ?? argv;
    const spec: SubprocessSpawnSpec = {
      argv: spawnArgv,
      cwd: request.cwd,
      env: gitEnvironment(),
      signal,
      graceMs: this.graceMs,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: this.maxOutputBytes },
        stderr: { maxBytes: this.maxOutputBytes },
      },
    };

    let child: SubprocessHandle;
    try {
      child = this.services.subprocess.spawn(spec);
    } catch (error) {
      const cancelled = this.cancellationOf(signal);
      if (cancelled !== undefined) {
        return cancelled;
      }
      throw this.spawnFailure(error, confined, spawnArgv, request.cwd);
    }

    const settled = await this.settle(child);
    const captured = readCollected(child);
    const timedOut = timeoutOf(signal, TIMEOUT_CODE) !== undefined;
    if (timedOut || signal.aborted) {
      return {
        exitCode: settled.outcome?.exitCode ?? null,
        stdout: captured.stdout,
        stderr: captured.stderr,
        signal: settled.outcome?.signal ?? null,
        timedOut,
      };
    }
    if (settled.failure !== undefined) {
      throw this.spawnFailure(settled.failure, confined, spawnArgv, request.cwd);
    }
    if (settled.quiescenceFailure !== undefined) {
      throw new SwarmError('SWARM_INTERNAL', 'command did not confirm process quiescence', {
        details: { argv: spawnArgv, cwd: request.cwd },
        cause: settled.quiescenceFailure,
      });
    }
    const outcome = settled.outcome;
    if (outcome === undefined) {
      throw new SwarmError('SWARM_INTERNAL', 'command settled without an outcome', {
        details: { argv: spawnArgv, cwd: request.cwd },
      });
    }

    if (confined !== undefined) {
      const runnerFailure = classifyRunnerFailure(outcome.exitCode, captured.stderr, confined.runnerFailureRules);
      if (runnerFailure !== undefined) {
        throw new SwarmError(
          'SWARM_INTERNAL',
          `sandbox runner failed before executing the command: ${runnerFailure.detail}`,
          {
            details: {
              code: 'SANDBOX_UNAVAILABLE',
              mode,
              exitCode: outcome.exitCode,
              detail: truncate(runnerFailure.detail),
            },
          },
        );
      }
      if (matchesSignature(outcome.exitCode, captured.stderr, confined.denialSignatures)) {
        throw new SwarmError('SWARM_FORBIDDEN', `the sandbox denied this command under mode ${mode}`, {
          details: {
            sandboxMode: mode,
            exitCode: outcome.exitCode,
            stderr: truncate(captured.stderr),
            argv: spawnArgv,
          },
        });
      }
    }

    return {
      exitCode: outcome.exitCode,
      stdout: captured.stdout,
      stderr: captured.stderr,
      signal: outcome.signal,
      timedOut: false,
    };
  }

  /**
   * 等待子进程结果，并无论如何确认托管进程范围静止。
   *
   * `done` 的 reject 与 `waitForExit()` 的失败分别保留：前者是 spawn/provider 失败，
   * 后者是无法声明“停干净”，调用方据此保留诊断。
   */
  private async settle(child: SubprocessHandle): Promise<SettledProcess> {
    const settled: SettledProcess = {};
    try {
      settled.outcome = await child.done;
    } catch (error) {
      settled.failure = error;
    }
    child.terminate();
    try {
      await child.waitForExit();
    } catch (error) {
      settled.quiescenceFailure = error;
    }
    return settled;
  }

  /** 把 spawn 失败区分为“runner 坏了”与普通启动失败。 */
  private spawnFailure(
    error: unknown,
    confined: ConfinedArgv | undefined,
    spawnArgv: readonly string[],
    cwd: string,
  ): SwarmError {
    if (confined !== undefined && isRunnerSpawnFailure(error, spawnArgv[0], cwd)) {
      return new SwarmError('SWARM_INTERNAL', 'sandbox runner could not be started', {
        details: { code: 'SANDBOX_UNAVAILABLE', argv: [...spawnArgv], cwd },
        cause: error,
      });
    }
    return new SwarmError('SWARM_INTERNAL', 'failed to start the command', {
      details: { argv: [...spawnArgv], cwd },
      cause: error,
    });
  }

  /** 本执行器自己的 deadline 或上游取消已生效时给出取消事实，否则 `undefined`。 */
  private cancellationOf(signal: AbortSignal): CommandResult | undefined {
    if (!signal.aborted) {
      return undefined;
    }
    return {
      exitCode: null,
      stdout: '',
      stderr: '',
      signal: null,
      timedOut: timeoutOf(signal, TIMEOUT_CODE) !== undefined,
    };
  }
}