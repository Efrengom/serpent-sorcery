import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Resolve the real path so builds work when the project lives behind a
// redirected/symlinked folder (e.g. Windows app-virtualized AppData paths).
const root = realpathSync.native(fileURLToPath(new URL('.', import.meta.url)));

/** The line in public/sw.js that a build replaces with its own files and version. */
const SW_BUILD_LINE = "const BUILD = { version: 'dev', files: [] };";

/**
 * Offline play for the installed game: after a build, the service worker is given every file the
 * build made and a version taken from their contents. Installing a new build then fetches all of
 * it at once (the parts of the game loaded on demand included), and replaces the old build's cache.
 */
function precacheForServiceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'serpent-precache',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = path.join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(path.relative(outDir, p).split(path.sep).join('/'));
        }
      };
      walk(outDir);
      const kept = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
      const hash = createHash('sha256');
      for (const f of kept) hash.update(f).update(readFileSync(path.join(outDir, f)));
      const swPath = path.join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      if (!sw.includes(SW_BUILD_LINE)) throw new Error(`sw.js no longer has the line the build fills in: ${SW_BUILD_LINE}`);
      const build = { version: hash.digest('hex').slice(0, 12), files: kept.filter((f) => f !== 'index.html').map((f) => `/${f}`) };
      writeFileSync(swPath, sw.replace(SW_BUILD_LINE, `const BUILD = ${JSON.stringify(build)};`));
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), precacheForServiceWorker()],
  build: {
    rollupOptions: {
      output: {
        // React in a file of its own: it changes far less often than the game, so a returning
        // player's browser keeps it across updates.
        manualChunks(id) {
          if (id.includes('node_modules')) return 'react';
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
});
