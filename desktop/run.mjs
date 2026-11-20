// Runs the program from this folder with Electron (npm run desktop, npm run desktop:dev). Clears
// ELECTRON_RUN_AS_NODE first: a terminal started by an editor built on Electron (VS Code's
// extensions, say) can carry it, and Electron would then run as plain Node.
//
//   node desktop/run.mjs [electron arguments]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const here = import.meta.dirname;
const electron = createRequire(`${here}/package.json`)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [here, ...process.argv.slice(2)], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
