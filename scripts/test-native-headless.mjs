/** Native CLI/Session/worktree cancellation regression; the model is explicitly fake. */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { watch, openSync, closeSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'dsh-swarm-native-headless.'));
const repository = path.join(directory, 'repository');
const home = path.join(directory, 'dsh-home');
const readyPath = path.join(directory, 'ready.log');
const specPath = path.join(directory, 'run.json');
const patchPath = path.join(directory, 'test.patch.json');
await mkdir(repository);
execFileSync('git', ['init', '-b', 'main', repository]);
await writeFile(path.join(repository, 'seed.txt'), 'seed\n');
execFileSync('git', ['-C', repository, 'add', 'seed.txt']);
execFileSync('git', ['-C', repository, '-c', 'user.name=Swarm native test', '-c', 'user.email=swarm-test@localhost', 'commit', '-m', 'test: native shutdown baseline']);
await writeFile(readyPath, '');
await writeFile(specPath, JSON.stringify({ repository, baseRef: 'main', goal: 'Cancellation regression; no generated work is expected.', acceptanceCriteria: ['Interrupted run is stopped, never completed'], workers: 2, budgetMinutes: 5, allowDirtyBaseline: false, verification: { setup: [], test: [{ argv: ['node', '-e', 'process.exit(0)'], timeoutMs: 10000 }] } }));
await writeFile(patchPath, JSON.stringify([{ insert: [{ id: 'native-cancel-test-model', name: new URL('../tests/native-smoke/blocking-model.js', import.meta.url).href, config: { readyPath } }] }]));

const environment = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
const invalid = spawnSync('dsh', ['--profile', 'headless', '--patch', path.join(source, 'cordis.headless.yml'), '--spec', specPath, '--provider', 'swarm-unregistered-fixture', '--model', 'missing', '--json'], { cwd: source, env: environment, encoding: 'utf8' });
if (invalid.error) throw invalid.error;
if (invalid.status !== 1 || !invalid.stdout.includes('"type":"error"') || !invalid.stdout.includes('no adapter registered')) throw new Error(`Missing-route preflight failed: ${invalid.stdout}\n${invalid.stderr}`);
console.log('PASS: unregistered model route fails before worker startup');

let markReady;
const ready = new Promise((resolve) => { markReady = resolve; });
const watcher = watch(directory, (_event, filename) => {
  if (filename !== 'ready.log') return;
  void readFile(readyPath, 'utf8').then((text) => {
    if (text.trim().split('\n').filter(Boolean).length >= 2) markReady();
  }, (error) => console.error(error));
});
const stdoutPath = path.join(directory, 'stdout.jsonl');
const stderrPath = path.join(directory, 'stderr.log');
const stdout = openSync(stdoutPath, 'w');
const stderr = openSync(stderrPath, 'w');
const child = spawn('dsh', ['--profile', 'headless', '--patch', path.join(source, 'cordis.headless.yml'), '--patch', patchPath, '--spec', specPath, '--provider', 'swarm-cancel-fixture', '--model', 'blocking', '--effort', 'off', '--json'], { cwd: source, env: environment, stdio: ['ignore', stdout, stderr] });
console.log('Native fixture:', directory, 'pid:', child.pid);
let ended = false;
const exit = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (code, signal) => { ended = true; resolve({ code, signal }); });
});
let timer;
try {
  await Promise.race([ready, exit.then((result) => { throw new Error(`CLI ended before two streams: ${JSON.stringify(result)}; inspect ${stderrPath}`); }), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Native streams did not start')), 30000); })]);
  child.kill('SIGINT');
  const result = await exit;
  const records = (await readFile(stdoutPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const finals = records.filter((record) => record.type === 'final');
  if (result.code !== 130 || finals.length !== 1 || finals[0].phase !== 'stopped' || finals[0].aborted !== true || finals[0].exitCode !== 130 || finals[0].error !== null) throw new Error(`Incorrect native cancellation: ${JSON.stringify({ result, finals })}`);
  if (execFileSync('git', ['-C', repository, 'status', '--short'], { encoding: 'utf8' }).trim()) throw new Error('Native fixture modified the original checkout');
  console.log('PASS: two native workers, SIGINT, persisted stopped final, exit 130, unchanged original checkout');
} finally {
  clearTimeout(timer);
  watcher.close();
  if (!ended) { child.kill('SIGTERM'); await exit; }
  closeSync(stdout);
  closeSync(stderr);
}
