/**
 * 启动 spec 的解析与校验（首个版本只有 JSON spec 一种入口）。
 *
 * 纯函数：只做结构校验与路径解析，不读文件、不碰 Git、不创建 worktree、不调用模型。
 * 路径规则（架构 §12.1）：`specPath` 由调用方相对 owner cwd 解析后传入，本模块要求绝对路径；
 * spec 内的 `repository` 相对 spec 文件所在目录解析。
 */

import path from 'node:path';
import { z } from 'zod';
import { SwarmError } from './errors.ts';
import { verificationConfigSchema, zodIssuesToDetails } from './schema.ts';
import type { CommandSpec, RunSpec, VerificationConfig } from './types.ts';

/** 架构固定：每个 run 2–4 个 worker。 */
export const MIN_WORKERS = 2;
export const MAX_WORKERS = 4;

/**
 * spec 文件结构。budgetMinutes 可省略（默认不限时）；其他顶层字段必填。未知字段拒绝；
 * `verification.setup` 可为空数组，`verification.test` 必须非空。
 */
export const runSpecSchema = z.strictObject({
  repository: z.string().trim().min(1, 'repository must be a non-empty path'),
  baseRef: z.string().trim().min(1, 'baseRef must be a non-empty ref or commit'),
  goal: z.string().trim().min(1, 'goal must be a non-empty description'),
  acceptanceCriteria: z
    .array(z.string().trim().min(1, 'acceptance criterion must be non-empty'))
    .min(1, 'acceptanceCriteria must contain at least one checkable requirement'),
  workers: z
    .number()
    .int()
    .min(MIN_WORKERS, `workers must be between ${MIN_WORKERS} and ${MAX_WORKERS}`)
    .max(MAX_WORKERS, `workers must be between ${MIN_WORKERS} and ${MAX_WORKERS}`),
  budgetMinutes: z.number().int().nonnegative('budgetMinutes must be non-negative').default(0),
  allowDirtyBaseline: z.boolean(),
  verification: verificationConfigSchema,
});

/**
 * 解析并校验启动 spec。
 *
 * @param input 已 `JSON.parse` 的 spec 内容（未知来源，必须校验）。
 * @param specPath spec 文件的绝对路径；用于解析 repository 与诊断显示。
 * @returns 校验后的 spec：`repository`/`specPath` 为绝对路径，字符串已去首尾空白。
 * @throws SwarmError `SWARM_INVALID_INPUT`（specPath 非绝对路径）或
 *   `SWARM_INVALID_SPEC`（字段缺失/类型错/约束不满足，`details.issues` 给出全部字段诊断）。
 */
export function parseRunSpec(input: unknown, specPath: string): RunSpec {
  if (!path.isAbsolute(specPath)) {
    throw new SwarmError('SWARM_INVALID_INPUT', 'specPath must be an absolute path', {
      details: { specPath },
    });
  }

  const baseDir = path.dirname(specPath);
  const result = runSpecSchema.safeParse(input);
  if (!result.success) {
    throw new SwarmError('SWARM_INVALID_SPEC', 'run spec failed validation', {
      details: zodIssuesToDetails(result.error),
    });
  }

  const spec = result.data;
  // 复制并就地冻结嵌套数组：不改变声明类型（RunSpec 仍是普通可读字段），
  // 运行时防止调用方回写解析结果。
  const acceptanceCriteria: string[] = [...spec.acceptanceCriteria];
  const setup: CommandSpec[] = spec.verification.setup.map(copyCommand);
  const test: CommandSpec[] = spec.verification.test.map(copyCommand);
  const verification: VerificationConfig = { setup, test };

  Object.freeze(acceptanceCriteria);
  Object.freeze(setup);
  Object.freeze(test);
  Object.freeze(verification);

  return Object.freeze({
    specPath: path.resolve(specPath),
    repository: path.resolve(baseDir, spec.repository),
    baseRef: spec.baseRef,
    goal: spec.goal,
    acceptanceCriteria,
    workers: spec.workers,
    budgetMinutes: spec.budgetMinutes,
    allowDirtyBaseline: spec.allowDirtyBaseline,
    verification,
  });
}

/** 复制一条命令，避免调用方后续修改 spec 输入影响已冻结的解析结果。 */
function copyCommand(command: CommandSpec): CommandSpec {
  const copy: CommandSpec = { argv: [...command.argv], timeoutMs: command.timeoutMs };
  Object.freeze(copy.argv);
  return Object.freeze(copy);
}
