/** Per-command Git isolation policy; never writes repository or user configuration. */

/** Requires Git ≥ 2.46: disable lazy fetching, hooks, fsmonitor and automatic maintenance. */
export const GIT_ISOLATION_ARGV: readonly string[] = [
  '--no-lazy-fetch',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=false',
  '-c',
  'submodule.recurse=false',
];

/**
 * Converts successful `git config --get-regexp ^filter\.` output into command-local
 * driver overrides. Callers own probe failures, execution, cancellation and caching.
 */
export function disabledGitFilterArgs(stdout: string): string[] {
  const drivers = new Set<string>();
  for (const line of stdout.split('\n')) {
    const key = line.trim().split(/\s+/)[0] ?? '';
    const match = /^filter\.(.+)\.[^.]+$/.exec(key);
    if (match?.[1] !== undefined) drivers.add(match[1]);
  }
  const args: string[] = [];
  for (const driver of drivers) {
    args.push(
      '-c',
      `filter.${driver}.clean=`,
      '-c',
      `filter.${driver}.smudge=`,
      '-c',
      `filter.${driver}.process=`,
      '-c',
      `filter.${driver}.required=false`,
    );
  }
  return args;
}
