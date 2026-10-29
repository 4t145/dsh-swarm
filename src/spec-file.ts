/** Host filesystem boundary shared by the human command and owner tool. */
import path from 'node:path';
import { SwarmError } from './errors.ts';
import { parseRunSpec } from './spec.ts';
import type { RunSpec } from './types.ts';

/** Only Host-mediated reads are allowed; this loader never accesses Node fs. */
interface SpecFileSystem {
  resolve(path: string, options: { cwd: string; signal: AbortSignal }): Promise<{ readonly displayPath: string }>;
  readText(target: { readonly displayPath: string }, signal: AbortSignal): Promise<string>;
}

/**
 * Read, decode and validate a configured spec; repository paths are relative to
 * the spec's absolute location, not the session cwd or fs display label.
 *
 * `detail` retains the command's underlying error text; `summary` retains the
 * owner tool's concise message. Both preserve the cause and specPath details.
 * @throws SwarmError SWARM_INVALID_INPUT on read failure, SWARM_INVALID_SPEC on JSON/schema failure.
 */
export async function loadRunSpecFile(
  fs: SpecFileSystem,
  cwd: string,
  specPath: string,
  signal: AbortSignal,
  diagnostics: 'summary' | 'detail',
): Promise<RunSpec> {
  const absolute = path.resolve(cwd, specPath);
  const suffix = (error: unknown): string => diagnostics === 'detail'
    ? `: ${error instanceof Error ? error.message : String(error)}` : '';
  let text: string;
  try {
    const target = await fs.resolve(specPath, { cwd, signal });
    text = await fs.readText(target, signal);
  } catch (error) {
    throw new SwarmError('SWARM_INVALID_INPUT', `failed to read swarm spec ${absolute}${suffix(error)}`, {
      details: { specPath: absolute }, cause: error,
    });
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new SwarmError('SWARM_INVALID_SPEC', `swarm spec ${absolute} is not valid JSON${suffix(error)}`, {
      details: { specPath: absolute }, cause: error,
    });
  }
  return parseRunSpec(document, absolute);
}
