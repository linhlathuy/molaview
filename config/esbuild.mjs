import * as esbuild from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This config lives in config/, so paths are resolved against the project root.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const shared = {
  bundle: true,
  sourcemap: false,
  minify: true,
  logLevel: 'info'
};

const builds = [
  {
    ...shared,
    entryPoints: [join(root, 'src/extension.ts')],
    outfile: join(root, 'dist/extension.js'),
    platform: 'node',
    format: 'cjs',
    external: ['vscode']
  },
  {
    ...shared,
    entryPoints: [join(root, 'webview/main.ts')],
    outfile: join(root, 'dist/webview.js'),
    platform: 'browser',
    format: 'iife',
    loader: { '.css': 'css' }
  }
];

await mkdir(join(root, 'dist'), { recursive: true });
if (watch) {
  const contexts = await Promise.all(builds.map(options => esbuild.context(options)));
  await Promise.all(contexts.map(context => context.watch()));
} else {
  await Promise.all(builds.map(options => esbuild.build(options)));
}
