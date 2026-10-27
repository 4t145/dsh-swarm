import { describe, expect, it } from 'vitest';
import { parseSwarmHeadlessArgs } from '../src/headless-args.ts';

describe('Swarm headless application arguments', () => {
  it('accepts help without a task or model route', () => {
    expect(parseSwarmHeadlessArgs(['--help'])).toMatchObject({ help: true, specPath: null });
  });
  it('preserves a path with spaces and an explicit native model route', () => {
    expect(parseSwarmHeadlessArgs(['--spec', '/repo with spaces/run.json', '--provider', 'vast-internal', '--model', 'deepseek-v4.1-flash-1017', '--effort', 'low', '--json']))
      .toEqual({ help: false, specPath: '/repo with spaces/run.json', provider: 'vast-internal', model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'low', json: true });
  });
  const invalid: string[][] = [
    [], ['--spec'], ['--spec', '--json'], ['--unknown'], ['a natural language prompt'],
    ['--spec', 'x', '--provider', 'p'], ['--spec', 'x', '--model', 'm'], ['--spec', 'x', '--json', '--json'],
  ];
  for (const argv of invalid) {
    it(`rejects invalid arguments ${JSON.stringify(argv)}`, () => {
      expect(() => parseSwarmHeadlessArgs(argv)).toThrow();
    });
  }
});
