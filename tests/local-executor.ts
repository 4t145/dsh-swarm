/**
 * 测试专用本地命令执行器。
 *
 * 只有测试夹具可以用真实 `child_process` 在临时目录执行 `git`/`node`；生产代码必须注入
 * Host 侧经过 sandbox/permission 适配的 `CommandExecutor`。本文件不属于 `src/`，不得被打包。
 */

import { spawn, spawnSync } from 'node:child_process';

import type { CommandExecutor, CommandResult } from '../src/ports.ts';
import type { CommandSpec } from '../src/types.ts';

/** 测试执行器接受的请求：与 `CommandExecutor.run` 的形状一致，另可显式指定 env。 */
export interface LocalCommandRequest {
  argv: readonly string[];
  cwd: string;
  timeoutMs: number;
  actorSessionId?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

/** 与 `spawnSync` 的结果对齐，供夹具断言失败的命令。 */
export interface LocalProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * 不经 shell 直接 spawn 一条 argv 命令。
 *
 * 永不 reject：启动失败、超时和被取消都折算成 `CommandResult`。超时由本函数自己的计时器
 * 标记（`timedOut: true`），取消只杀进程并返回实际终止信号。
 */
export function runLocalCommand(request: LocalCommandRequest): Promise<CommandResult> {
  return new Promise((resolve) => {
    const [command, ...args] = request.argv;
    if (command === undefined) {
      resolve({ exitCode: null, stdout: '', stderr: 'argv must not be empty', signal: null, timedOut: false });
      return;
    }
    if (request.signal?.aborted === true) {
      resolve({ exitCode: null, stdout: '', stderr: '', signal: 'SIGKILL', timedOut: false });
      return;
    }

    const stdout: string[] = [];
    const stderr: string[] = [];
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    const child = spawn(command, args, {
      cwd: request.cwd,
      env: request.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: CommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      request.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = (): void => {
      child.kill('SIGKILL');
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, request.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => stdout.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => stderr.push(chunk));

    child.on('error', (error: Error) => {
      finish({
        exitCode: null,
        stdout: stdout.join(''),
        stderr: `${stderr.join('')}${error.message}`,
        signal: null,
        timedOut,
      });
    });
    child.on('close', (code, signal) => {
      finish({
        exitCode: code,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        signal: signal ?? null,
        timedOut,
      });
    });
  });
}

/** 测试用的 `CommandExecutor`：把端口调用原样交给本地 spawn。 */
export class LocalCommandExecutor implements CommandExecutor {
  run(request: CommandSpec & { cwd: string; actorSessionId: string; signal?: AbortSignal }): Promise<CommandResult> {
    return runLocalCommand(request);
  }
}

/** 夹具同步执行一条命令；非零退出或启动失败直接抛错，让测试立即失败。 */
export function runLocalSync(argv: readonly string[], cwd: string): LocalProcessResult {
  const [command, ...args] = argv;
  if (command === undefined) {
    throw new Error('argv must not be empty');
  }
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new Error(`failed to start ${command} in ${cwd}: ${result.error.message}`);
  }
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** 夹具执行 `git` 并返回 stdout；非零退出抛错（含 stderr）。 */
export function gitSync(args: readonly string[], cwd: string): string {
  const result = runLocalSync(['git', ...args], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd} (exit ${String(result.exitCode)}): ${result.stderr}`);
  }
  return result.stdout;
}

/** 探针式 `git`：非零退出返回 null，供断言“某命令确实失败”。 */
export function tryGitSync(args: readonly string[], cwd: string): string | null {
  const result = runLocalSync(['git', ...args], cwd);
  return result.exitCode === 0 ? result.stdout : null;
}