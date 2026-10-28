/**
 * parseRunSpec 针对性测试：字段必填、约束、路径解析与字段诊断。
 * 纯函数测试：不读文件、不碰 Git。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSwarmError, SwarmError } from '../src/errors.ts';
import { MAX_WORKERS, MIN_WORKERS, parseRunSpec } from '../src/spec.ts';

/* --------------------------- 测试夹具 --------------------------- */

const SPEC_PATH = '/work/project/plans/swarm-run.json';

function validSpec(): Record<string, unknown> {
  return {
    repository: '..',
    baseRef: 'HEAD',
    goal: '  为项目增加 CSV 导入和对应 CLI  ',
    acceptanceCriteria: [' CSV 导入结果正确 ', 'CLI 可调用导入并报告错误'],
    workers: 2,
    budgetMinutes: 30,
    allowDirtyBaseline: false,
    verification: {
      setup: [{ argv: ['npm', 'ci'], timeoutMs: 300_000 }],
      test: [{ argv: ['npm', 'test'], timeoutMs: 300_000 }],
    },
  };
}

function specWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...validSpec(), ...overrides };
}

function captureError(fn: () => unknown): SwarmError {
  try {
    fn();
  } catch (error) {
    if (isSwarmError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the call to throw');
}

/** 从错误 details 中取出字段路径列表，避免依赖 Zod 的类实例。 */
function issuePaths(error: SwarmError): string[] {
  const issues = error.details === null ? undefined : error.details['issues'];
  if (!Array.isArray(issues)) {
    return [];
  }
  const paths: string[] = [];
  for (const issue of issues) {
    if (issue !== null && typeof issue === 'object' && !Array.isArray(issue)) {
      const issuePath = issue['path'];
      if (typeof issuePath === 'string') {
        paths.push(issuePath);
      }
    }
  }
  return paths;
}

function issueDetailsJson(error: SwarmError): string {
  return JSON.stringify(error.details);
}

/* --------------------------- 正常解析 --------------------------- */

describe('parseRunSpec 正常解析', () => {
  it('解析 repository 相对 spec 目录、去空白并保留其余字段', () => {
    const spec = parseRunSpec(validSpec(), SPEC_PATH);

    expect(spec.specPath).toBe(SPEC_PATH);
    expect(spec.repository).toBe('/work/project');
    expect(spec.baseRef).toBe('HEAD');
    expect(spec.goal).toBe('为项目增加 CSV 导入和对应 CLI');
    expect(spec.acceptanceCriteria).toEqual(['CSV 导入结果正确', 'CLI 可调用导入并报告错误']);
    expect(spec.workers).toBe(2);
    expect(spec.budgetMinutes).toBe(30);
    expect(spec.allowDirtyBaseline).toBe(false);
    expect(spec.verification.setup).toEqual([{ argv: ['npm', 'ci'], timeoutMs: 300_000 }]);
    expect(spec.verification.test).toEqual([{ argv: ['npm', 'test'], timeoutMs: 300_000 }]);
  });

  it('repository 为 "." 时解析到 spec 目录，绝对路径保持原样', () => {
    expect(parseRunSpec(specWith({ repository: '.' }), SPEC_PATH).repository).toBe(
      path.dirname(SPEC_PATH),
    );
    expect(parseRunSpec(specWith({ repository: '/opt/repo' }), SPEC_PATH).repository).toBe(
      '/opt/repo',
    );
  });

  it('setup 允许为空数组，test 允许为多条命令', () => {
    const spec = parseRunSpec(
      specWith({
        verification: {
          setup: [],
          test: [
            { argv: ['npm', 'test'], timeoutMs: 1_000 },
            { argv: ['npm', 'run', 'lint'], timeoutMs: 2_000 },
          ],
        },
      }),
      SPEC_PATH,
    );
    expect(spec.verification.setup).toEqual([]);
    expect(spec.verification.test).toHaveLength(2);
  });

  it(`workers 允许 ${MIN_WORKERS}–${MAX_WORKERS} 的任意整数，allowDirtyBaseline 允许 true`, () => {
    for (const workers of [2, 3, 4]) {
      expect(parseRunSpec(specWith({ workers }), SPEC_PATH).workers).toBe(workers);
    }
    expect(parseRunSpec(specWith({ allowDirtyBaseline: true }), SPEC_PATH).allowDirtyBaseline).toBe(
      true,
    );
  });

  it('省略或显式设为 0 的 budgetMinutes 表示不限时，不隐式添加截止', () => {
    const omitted = validSpec();
    delete omitted['budgetMinutes'];
    expect(parseRunSpec(omitted, SPEC_PATH).budgetMinutes).toBe(0);
    expect(parseRunSpec(specWith({ budgetMinutes: 0 }), SPEC_PATH).budgetMinutes).toBe(0);
    expect(parseRunSpec(specWith({ budgetMinutes: 1 }), SPEC_PATH).budgetMinutes).toBe(1);
  });

  it('不访问文件系统：不存在的目录也能解析出绝对路径', () => {
    const missing = '/definitely/not/here/spec.json';
    expect(parseRunSpec(specWith({ repository: './repo' }), missing).repository).toBe(
      '/definitely/not/here/repo',
    );
  });

  it('返回冻结对象，且与输入不共享数组引用', () => {
    const input = validSpec();
    const spec = parseRunSpec(input, SPEC_PATH);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.verification)).toBe(true);

    const criteria = input['acceptanceCriteria'];
    expect(Array.isArray(criteria)).toBe(true);
    if (Array.isArray(criteria)) {
      criteria.push('后来追加的验收项');
    }
    expect(spec.acceptanceCriteria).toHaveLength(2);
  });
});

/* --------------------------- 必填与未知字段 --------------------------- */

describe('parseRunSpec 必填字段', () => {
  const requiredKeys = [
    'repository',
    'baseRef',
    'goal',
    'acceptanceCriteria',
    'workers',
    'allowDirtyBaseline',
    'verification',
  ] as const;

  it('缺少任一顶层字段都拒绝并指明字段路径', () => {
    for (const key of requiredKeys) {
      const spec = validSpec();
      delete spec[key];
      const error = captureError(() => parseRunSpec(spec, SPEC_PATH));
      expect(error.code).toBe('SWARM_INVALID_SPEC');
      expect(issuePaths(error)).toContain(key);
    }
  });

  it('拒绝未知顶层字段，提示笔误而不是静默忽略', () => {
    const error = captureError(() =>
      parseRunSpec(specWith({ budget: 30 }), SPEC_PATH),
    );
    expect(error.code).toBe('SWARM_INVALID_SPEC');
    expect(issueDetailsJson(error)).toContain('budget');
  });

  it('非对象输入抛 SWARM_INVALID_SPEC 而不是 TypeError', () => {
    for (const input of [null, 42, 'spec', [], true]) {
      const error = captureError(() => parseRunSpec(input, SPEC_PATH));
      expect(error.code).toBe('SWARM_INVALID_SPEC');
    }
  });

  it('specPath 必须是绝对路径，避免静默用错 owner cwd', () => {
    const error = captureError(() => parseRunSpec(validSpec(), 'plans/swarm-run.json'));
    expect(error.code).toBe('SWARM_INVALID_INPUT');
    expect(issueDetailsJson(error)).toContain('swarm-run.json');
  });
});

/* --------------------------- 字段约束 --------------------------- */

describe('parseRunSpec 字段约束', () => {
  it('goal/baseRef 去空白后为空则拒绝', () => {
    expect(issuePaths(captureError(() => parseRunSpec(specWith({ goal: '   ' }), SPEC_PATH)))).toContain(
      'goal',
    );
    expect(issuePaths(captureError(() => parseRunSpec(specWith({ baseRef: '' }), SPEC_PATH)))).toContain(
      'baseRef',
    );
  });

  it('acceptanceCriteria 不能为空数组或含空项', () => {
    expect(
      issuePaths(captureError(() => parseRunSpec(specWith({ acceptanceCriteria: [] }), SPEC_PATH))),
    ).toContain('acceptanceCriteria');
    expect(
      issuePaths(
        captureError(() =>
          parseRunSpec(specWith({ acceptanceCriteria: ['ok', '  '] }), SPEC_PATH),
        ),
      ),
    ).toContain('acceptanceCriteria[1]');
  });

  it('workers 必须是 2–4 的整数', () => {
    for (const workers of [1, 5, 0, 2.5, '2']) {
      const error = captureError(() => parseRunSpec(specWith({ workers }), SPEC_PATH));
      expect(error.code).toBe('SWARM_INVALID_SPEC');
      expect(issuePaths(error)).toContain('workers');
    }
  });

  it('显式 budgetMinutes 必须是非负整数，拒绝非法类型和非有限值', () => {
    for (const budgetMinutes of [-30, 1.5, '30', null, false, NaN, Infinity]) {
      const error = captureError(() => parseRunSpec(specWith({ budgetMinutes }), SPEC_PATH));
      expect(issuePaths(error)).toContain('budgetMinutes');
    }
  });

  it('allowDirtyBaseline 必须是布尔值', () => {
    const error = captureError(() =>
      parseRunSpec(specWith({ allowDirtyBaseline: 'false' }), SPEC_PATH),
    );
    expect(issuePaths(error)).toContain('allowDirtyBaseline');
  });

  it('verification.test 不能为空；setup 必须是数组', () => {
    const emptyTest = captureError(() =>
      parseRunSpec(
        specWith({ verification: { setup: [], test: [] } }),
        SPEC_PATH,
      ),
    );
    expect(issuePaths(emptyTest)).toContain('verification.test');

    const missingSetup = captureError(() =>
      parseRunSpec(specWith({ verification: { test: [{ argv: ['npm', 'test'], timeoutMs: 1000 }] } }), SPEC_PATH),
    );
    expect(issuePaths(missingSetup)).toContain('verification.setup');
  });

  it('命令需要非空 argv 与正整数 timeoutMs，并给出精确路径', () => {
    const emptyArgv = captureError(() =>
      parseRunSpec(
        specWith({ verification: { setup: [], test: [{ argv: [], timeoutMs: 1000 }] } }),
        SPEC_PATH,
      ),
    );
    expect(issuePaths(emptyArgv)).toContain('verification.test[0].argv');

    const badTimeout = captureError(() =>
      parseRunSpec(
        specWith({ verification: { setup: [], test: [{ argv: ['npm', 'test'], timeoutMs: 0 }] } }),
        SPEC_PATH,
      ),
    );
    expect(issuePaths(badTimeout)).toContain('verification.test[0].timeoutMs');

    const shellString = captureError(() =>
      parseRunSpec(
        specWith({ verification: { setup: [], test: [{ argv: 'npm test', timeoutMs: 1000 }] } }),
        SPEC_PATH,
      ),
    );
    expect(issuePaths(shellString)).toContain('verification.test[0].argv');
  });

  it('一次返回全部字段问题，便于用户一次改完', () => {
    const error = captureError(() =>
      parseRunSpec(
        specWith({ goal: '', workers: 9, budgetMinutes: -1, acceptanceCriteria: [] }),
        SPEC_PATH,
      ),
    );
    const paths = issuePaths(error);
    expect(paths).toContain('goal');
    expect(paths).toContain('workers');
    expect(paths).toContain('budgetMinutes');
    expect(paths).toContain('acceptanceCriteria');
  });
});
