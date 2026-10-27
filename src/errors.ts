/**
 * 插件错误类型与断言工具。
 *
 * 约定：可预期的失败一律抛 `SwarmError` 并携带稳定错误码与可操作诊断；
 * 调用方按 `code` 区分“代码失败 / 用户取消 / 基础设施失败”，不解析 message 文本。
 */

import type { JsonObject } from './types.ts';

/** 固定错误码词表；新增需在 notes/contracts.md 登记，避免各模块各造一套。 */
export const SWARM_ERROR_CODES = [
  'SWARM_INVALID_SPEC',
  'SWARM_INVALID_INPUT',
  'SWARM_NOT_FOUND',
  'SWARM_ALREADY_EXISTS',
  'SWARM_STORE_CLOSED',
  'SWARM_STORE_CORRUPT',
  'SWARM_STORE_WRITE_FAILED',
  'SWARM_INVALID_REDUCER',
  'SWARM_STALE_REVISION',
  'SWARM_TASK_ALREADY_CLAIMED',
  'SWARM_TASK_NOT_CLAIMABLE',
  'SWARM_NOT_RUNNING',
  'SWARM_STALE_HEAD',
  'SWARM_INVALID_CURSOR',
  'SWARM_WORKER_BUSY',
  'SWARM_FORBIDDEN',
  'SWARM_BUDGET_EXHAUSTED',
  'SWARM_INVALID_STATE',
  'SWARM_INTERNAL',
] as const;

export type SwarmErrorCode = (typeof SWARM_ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set<string>(SWARM_ERROR_CODES);

export function isSwarmErrorCode(value: unknown): value is SwarmErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

export interface SwarmErrorOptions {
  /** 结构化诊断，必须是 JSON 可序列化数据；会原样进入工具结果。 */
  details?: JsonObject;
  /** 原始底层错误，保留用于日志；不会序列化给模型。 */
  cause?: unknown;
}

/** 插件统一错误。`toJSON` 输出可直接作为工具结果，不含 cause 与堆栈。 */
export class SwarmError extends Error {
  readonly code: SwarmErrorCode;
  readonly details: JsonObject | null;
  readonly cause: unknown;

  constructor(code: SwarmErrorCode, message: string, options: SwarmErrorOptions = {}) {
    super(message);
    this.name = 'SwarmError';
    this.code = code;
    this.details = options.details ?? null;
    this.cause = options.cause;
  }

  toJSON(): { name: string; code: SwarmErrorCode; message: string; details: JsonObject | null } {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

export function isSwarmError(value: unknown): value is SwarmError {
  return value instanceof SwarmError;
}

/** 条件不满足时抛 `SwarmError`；用于入口与状态机前置条件。 */
export function assert(
  condition: unknown,
  code: SwarmErrorCode,
  message: string,
  details?: JsonObject,
): asserts condition {
  if (!condition) {
    throw new SwarmError(code, message, details === undefined ? {} : { details });
  }
}

/** 穷尽检查：有限 union 出现未处理分支时立刻失败，而不是被归为成功。 */
export function assertNever(value: never, context: string): never {
  throw new SwarmError('SWARM_INTERNAL', `unhandled ${context}`, {
    details: { value: String(value) },
  });
}

/**
 * 把任意抛出的值收敛为 `SwarmError`：已是的原样返回，否则按 fallbackCode 包装并保留 cause。
 * 已有消息不会被吞掉，`context` 只作为前缀补充定位信息。
 */
export function normalizeError(
  error: unknown,
  fallbackCode: SwarmErrorCode = 'SWARM_INTERNAL',
  context?: string,
): SwarmError {
  if (isSwarmError(error)) {
    return error;
  }
  const raw = error instanceof Error ? error.message : String(error);
  const message = context === undefined ? raw : `${context}: ${raw}`;
  return new SwarmError(fallbackCode, message, { cause: error });
}
