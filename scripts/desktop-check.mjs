// The desktop program, end to end. Packages it (npm run desktop:package), launches the real
// "Serpent Sorcery.exe" three times with a temporary data folder and the Steam stand-in, and drives
// it through Chromium's remote debugging with puppeteer-core:
//
//   - the title draws from app://, with its fonts, no service worker, and a Quit button;
//   - the save is a file (saves/save.json, with a .bak), and it loads back after a relaunch;
//   - the save's achievements go to Steam;
//   - it opens fullscreen, F11 makes it windowed, and the next launch opens windowed;
//   - Backup & Restore says the save is kept, with no reminder;
//   - the page can't navigate away or open windows; Quit closes it, leaving the save intact.
//
//   npm run desktop:check               package, then check
//   npm run desktop:check -- --no-build  check the last package
//   npm run desktop:check -- --unpacked  run from desktop/ (no packaging), for a quicker loop
//
// Screenshots go to playtest-output/desktop/. A real save is never touched.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'playtest-output', 'desktop');
const flags = new Set(process.argv.slice(2));
const unpacked = flags.has('--unpacked');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!flags.has('--no-build')) {
  execSync(unpacked ? 'npx vite build && node desktop/build.mjs' : 'npm run desktop:package', { cwd: ROOT, stdio: 'inherit' });
}
const EXE = unpacked
  ? createRequire(path.join(ROOT, 'desktop', 'package.json'))('electron')
  : path.join(ROOT, 'desktop', 'release', 'win-unpacked', 'Serpent Sorcery.exe');
const EXE_ARGS = unpacked ? [path.join(ROOT, 'desktop')] : [];
if (!fs.existsSync(EXE)) throw new Error(`No program at ${EXE}: run npm run desktop:package (or npm run desktop:install first).`);
fs.mkdirSync(OUT, { recursive: true });

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-desktop-'));
const STEAM_LOG = path.join(DATA, 'steam.log');
const SAVE = path.join(DATA, 'saves', 'save.json');
const readSaveFile = () => JSON.parse(fs.readFileSync(SAVE, 'utf8'));
const steamLines = () => (fs.existsSync(STEAM_LOG) ? fs.readFileSync(STEAM_LOG, 'utf8').split('\n').filter(Boolean) : []);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
}

let port = 9440;
/** Launches the program and connects to its window, waiting for the title. */
async function launch() {
  port += 1;
  const env = { ...process.env, SERPENT_USER_DATA: DATA, SERPENT_STEAM_LOG: STEAM_LOG };
  // A terminal from an editor built on Electron can carry this, and the program would run as Node.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(EXE, [...EXE_ARGS, `--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  let browser = null;
  for (let i = 0; i < 150 && !browser; i++) {
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
    } catch {
      await sleep(200);
    }
  }
  if (!browser) throw new Error('The program never opened its debugging port.');
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().startsWith('app://serpent/')) ?? null;
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('The program never loaded app://serpent/.');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.waitForSelector('.title-screen', { timeout: 15000 });
  await sleep(400);
  return { child, browser, page, exited, errors };
}

/** A real click on the first button whose text starts with this. */
async function clickButton(page, text) {
  const handle = await page.evaluateHandle((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text)) ?? null, text);
  const el = handle.asElement();
  if (!el) throw new Error(`No button "${text}"`);
  await el.click();
  await sleep(250);
}

/** Quits with the title's Quit button; whether the program closed within 5 s. */
async function quitFromTitle(app) {
  await app.page.click('[data-quit]').catch(() => undefined);
  const code = await Promise.race([app.exited, sleep(5000).then(() => 'still running')]);
  app.browser.disconnect().catch(() => undefined);
  if (code === 'still running') app.child.kill();
  return code !== 'still running';
}

const fullscreenNow = (page) => page.evaluate(() => window.serpentDesktop.fullscreen.get());
const minimapToggle = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.opt-toggle')].find((b) => b.textContent.includes('Minimap'))?.getAttribute('aria-checked'));

try {
  // ---------------------------------------------------------------- first launch: a fresh data folder
  {
    const app = await launch();
    const { page } = app;
    const first = await page.evaluate(async () => {
      let workers = 0;
      try {
        workers = (await navigator.serviceWorker?.getRegistrations())?.length ?? 0;
      } catch {
        // No service workers on this scheme at all.
      }
      await document.fonts.ready;
      // Both of the game's fonts drawn from the build (each loads the weights the title uses).
      const faces = [...document.fonts];
      const loaded = (family) => faces.some((f) => f.family.replace(/"/g, '') === family && f.status === 'loaded');
      return {
        url: location.href,
        bridge: typeof window.serpentDesktop === 'object',
        fonts: loaded('Silkscreen') && loaded('Pixelify Sans Variable') && !faces.some((f) => f.status === 'error'),
        workers,
        quit: !!document.querySelector('[data-quit]'),
        install: !!document.querySelector('[data-install]'),
      };
    });
    check('the title draws from app://, with its fonts, no service worker, a Quit button and no Install button', first.url.startsWith('app://serpent/') && first.bridge && first.fonts && first.workers === 0 && first.quit && !first.install, first);
    check('a first launch opens fullscreen', (await fullscreenNow(page)) === true);
    await page.screenshot({ path: path.join(OUT, '1-title-fullscreen.png') });

    // The save, as a file: turn the minimap off in Options, then mute (a second write).
    await clickButton(page, 'Options');
    await clickButton(page, 'Minimap');
    await sleep(300);
    const afterMinimap = fs.existsSync(SAVE) ? readSaveFile().settings.minimap : 'no file';
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.click('[aria-label="Toggle sound"]');
    await sleep(300);
    const second = readSaveFile();
    check('changing an option writes saves/save.json, and the next change keeps the one before as save.json.bak', afterMinimap === false && second.settings.muted === true && fs.existsSync(`${SAVE}.bak`), {
      afterMinimap,
      muted: second.settings.muted,
      bak: fs.existsSync(`${SAVE}.bak`),
    });
    const storage = await page.evaluate(() => localStorage.length);
    check('nothing goes to the browser’s storage', storage === 0, { storage });

    // The title's fullscreen button, there and back and there again: windowed for the next launch.
    // (F11 and Alt+Enter are caught before the page sees them, which keys sent over remote
    // debugging never are, so those are checked by hand.)
    const label = () => page.evaluate(() => document.querySelector('[data-fullscreen]')?.getAttribute('aria-label'));
    const labelFull = await label();
    await page.click('[data-fullscreen]');
    await sleep(900);
    const out = { on: await fullscreenNow(page), label: await label() };
    await page.click('[data-fullscreen]');
    await sleep(900);
    const back = await fullscreenNow(page);
    await page.click('[data-fullscreen]');
    await sleep(900);
    const windowed = await fullscreenNow(page);
    check('the title’s fullscreen button toggles the window, and its label follows', labelFull === 'Leave fullscreen' && out.on === false && out.label === 'Fullscreen' && back === true && windowed === false, {
      labelFull,
      out,
      back,
      windowed,
    });
    await page.screenshot({ path: path.join(OUT, '2-title-windowed.png') });
    const closed = await quitFromTitle(app);
    const saved = readSaveFile();
    check('Quit closes the program, and the save file is intact', closed && saved.settings.minimap === false && saved.settings.muted === true, { closed });
    check('no errors on the page', app.errors.length === 0, app.errors);
  }

  // ---------------------------------------------------------------- second launch: what was left
  {
    const app = await launch();
    const { page } = app;
    const windowed = await fullscreenNow(page);
    const size = await page.evaluate(() => ({ w: window.outerWidth, h: window.outerHeight, sw: screen.width, sh: screen.height }));
    check('the next launch opens windowed, as it was left', windowed === false && size.w < size.sw, { windowed, size });
    await clickButton(page, 'Options');
    const minimap = await minimapToggle(page);
    check('the save loads back from the file (the minimap is still off)', minimap === 'false', { minimap });
    await clickButton(page, 'Backup & Restore');
    const status = await page.evaluate(() => document.querySelector('[data-save=status]')?.textContent ?? '');
    check('Backup & Restore says the save is kept on this computer', status.startsWith('Your save is kept on this computer.'), { status });
    await page.screenshot({ path: path.join(OUT, '3-backup.png') });
    await page.keyboard.press('Escape');
    await sleep(250);
    await page.keyboard.press('Escape');
    await sleep(250);
    check('the save’s achievements go to Steam (none yet)', steamLines().length === 0, steamLines());
    await quitFromTitle(app);
    check('no errors on the page', app.errors.length === 0, app.errors);
  }

  // ---------------------------------------------------------------- third launch: a save with progress
  {
    const sv = readSaveFile();
    sv.achievements = ['firstBlood', 'intoTheDepths', 'throughFire'];
    sv.records.totalRuns = 6;
    sv.backup = { last: '', seen: false };
    fs.writeFileSync(SAVE, JSON.stringify(sv));
    const app = await launch();
    const { page } = app;
    await sleep(600);
    const lines = steamLines();
    check('the save’s achievements go to Steam at launch', lines.length === 3 && sv.achievements.every((id) => lines.includes(id)), lines);
    const pulse = await page.evaluate(() => document.querySelector('[data-options]')?.className ?? '');
    check('with 6 runs there’s still no backup reminder (the file is kept)', !pulse.includes('pulse'), { pulse });
    const away = await page.evaluate(async () => {
      const opened = window.open('https://example.com/');
      location.href = 'https://example.com/';
      await new Promise((r) => setTimeout(r, 800));
      return { opened: opened === null, url: location.href };
    });
    await sleep(300);
    check('the page can’t navigate away or open a window', away.opened && away.url.startsWith('app://serpent/') && app.page.url().startsWith('app://serpent/'), away);
    const closed = await quitFromTitle(app);
    const saved = readSaveFile();
    check('Quit closes it again, with the progress intact', closed && saved.achievements.length === 3 && saved.records.totalRuns === 6, { closed });
    check('no errors on the page', app.errors.length === 0, app.errors);
  }
} catch (e) {
  check(`the check ran to the end (${e instanceof Error ? e.message : String(e)})`, false);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} desktop checks passed.`);
if (failed.length === 0) fs.rmSync(DATA, { recursive: true, force: true });
else console.log(`The data folder is kept for a look: ${DATA}`);
process.exit(failed.length ? 1 : 0);
