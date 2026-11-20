// Bundles the program's main process and preload script into out/, as CommonJS for Electron.
// Electron and steamworks.js (native) stay outside the bundle.
//
//   node desktop/build.mjs
import { build } from 'esbuild';
import path from 'node:path';

const here = import.meta.dirname;
await build({
  entryPoints: { main: path.join(here, 'main.ts'), preload: path.join(here, 'preload.ts') },
  outdir: path.join(here, 'out'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', 'steamworks.js'],
  logLevel: 'warning',
});
