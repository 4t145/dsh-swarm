import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts', 'src/worker.ts', 'src/headless.ts', 'src/headless-driver.ts', 'src/headless-preset.ts'],
  outdir: 'lib',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
});
