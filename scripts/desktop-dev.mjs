// The desktop program on the Vite dev server, with live reloading of the game (npm run
// desktop:dev). A change to desktop/ itself needs a restart. It plays with the real desktop save,
// in %APPDATA%\Serpent Sorcery\saves.
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(ROOT, 'desktop', 'build.mjs')], { stdio: 'inherit' });
const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { port: 5190 } });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`Serpent Sorcery (desktop) on ${url}`);
// Anything after `--` goes to Electron (say, --remote-debugging-port=9333).
const child = spawn(process.execPath, [path.join(ROOT, 'desktop', 'run.mjs'), ...process.argv.slice(2)], { env: { ...process.env, SERPENT_DEV_URL: url }, stdio: 'inherit' });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
