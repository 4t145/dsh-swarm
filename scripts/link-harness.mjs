import { readdir, readFile, realpath, mkdir, lstat, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';

// Development-only: use the exact DSH installation being targeted, without
// persisting machine-specific paths in package.json or published source.
const argument = process.argv.slice(2).find((value) => value !== '--') ?? process.env.DSH_IMPLEMENTATION_ROOT;
if (!argument) {
  throw new Error('Pass the @deepseek-ai/dsh installation directory: pnpm link:harness -- <directory>');
}
const root = await realpath(argument);
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.name !== '@deepseek-ai/dsh') throw new Error('The supplied directory is not @deepseek-ai/dsh');
const source = path.join(root, 'node_modules', '@deepseek-ai');
const destination = path.resolve('node_modules', '@deepseek-ai');
await mkdir(destination, { recursive: true });
let linked = 0;
for (const name of await readdir(source)) {
  if (!name.startsWith('dsh-') && name !== 'schemastery' && name !== 'cordis') continue;
  const target = path.join(destination, name);
  const actualSource = await realpath(path.join(source, name));
  try {
    const current = await lstat(target);
    if (name !== 'cordis' || await realpath(target) === actualSource) continue;
    // Replace only this development symlink, never the dependency directory.
    if (!current.isSymbolicLink() || target !== path.join(destination, 'cordis')) {
      throw new Error(`Refusing to replace a non-symlink Cordis dependency at ${target}`);
    }
    console.log(`Replacing verified development symlink: ${target}`);
    await unlink(target);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await symlink(actualSource, target, 'dir');
  linked++;
}
console.log(`Linked ${linked} installed Harness packages for development against DSH ${manifest.version}.`);
