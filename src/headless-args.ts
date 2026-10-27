/** Explicit CLI inputs; task execution is never inferred from arbitrary prose. */
import { SwarmError } from './errors.ts';

export interface SwarmHeadlessArgs {
  help: boolean;
  specPath: string | null;
  provider: string | null;
  model: string | null;
  reasoningEffort: string | null;
  json: boolean;
}

/** Parse only this app's argument family; no shell expansion or positional prompt. */
export function parseSwarmHeadlessArgs(argv: readonly string[]): SwarmHeadlessArgs {
  const result: SwarmHeadlessArgs = { help: false, specPath: null, provider: null, model: null, reasoningEffort: null, json: false };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!flag) throw new SwarmError('SWARM_INVALID_INPUT', 'Empty command-line argument');
    if (seen.has(flag)) throw new SwarmError('SWARM_INVALID_INPUT', `Duplicate option ${flag}`);
    seen.add(flag);
    if (flag === '--help' || flag === '-h') { result.help = true; continue; }
    if (flag === '--json') { result.json = true; continue; }
    if (!['--spec', '--provider', '--model', '--effort'].includes(flag)) {
      throw new SwarmError('SWARM_INVALID_INPUT', `Unknown option ${flag}; use --help`);
    }
    const value = argv[++index];
    if (!value?.trim() || value.startsWith('--')) throw new SwarmError('SWARM_INVALID_INPUT', `${flag} requires a value`);
    if (flag === '--spec') result.specPath = value;
    else if (flag === '--provider') result.provider = value;
    else if (flag === '--model') result.model = value;
    else result.reasoningEffort = value;
  }
  if (!result.help && !result.specPath) throw new SwarmError('SWARM_INVALID_INPUT', '--spec <path> is required');
  if (!result.help && Boolean(result.provider) !== Boolean(result.model)) {
    throw new SwarmError('SWARM_INVALID_INPUT', '--provider and --model must be supplied together');
  }
  return result;
}

export const SWARM_HEADLESS_HELP = `DSH Swarm headless

Run with the supplied headless patch over a headless profile:
  dsh --profile headless --patch /path/to/dsh-swarm/headless.patch.yml --spec /path/to/run.json [--json]

Options:
  --spec <path>       Explicit run specification (required)
  --provider <id>     Registered provider; requires --model
  --model <id>        Model for the owner and its native workers
  --effort <id>       Adapter-supported reasoning effort
  --json             Emit progress/final JSONL instead of terminal summaries
  -h, --help         Show help without starting a run

Uses a separate headless Swarm domain. Run only one Host per repository;
do not run GUI and CLI workers against the same repository concurrently.
`;
