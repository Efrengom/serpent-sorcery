// The installed game, checked on the production build: `npm run offline` builds it, serves it with
// `vite preview` and opens it in headless Edge (or Chrome). It passes when Chrome finds nothing in
// the way of installing it; when, once the service worker has installed, every file of the build
// is cached and nothing was fetched from anywhere else; and when, with the network cut, the title
// (in its own fonts), the practice room and a run all load.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { preview } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')).href);

// The files the build gave the service worker (vite.config.ts writes them into dist/sw.js).
const sw = fs.readFileSync(path.join(ROOT, 'dist/sw.js'), 'utf8');
const built = JSON.parse(/const BUILD = (\{.*\});/.exec(sw)?.[1] ?? 'null');
if (!built || built.version === 'dev') throw new Error('dist/sw.js has no build list: run `vite build` first');

const server = await preview({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), preview: { port: 5197, strictPort: true }, logLevel: 'warn' });
const URL = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({
  executablePath: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p)),
  headless: true,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'serpent-offline-')),
  args: ['--mute-audio'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = {}) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const clickButton = (page, text) => page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t))?.click(), text);

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 832, height: 384, hasTouch: true, isMobile: true });
  const elsewhere = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(URL) && !r.url().startsWith('data:')) elsewhere.push(r.url());
  });
  await page.goto(URL, { waitUntil: 'networkidle0' });

  // Installable, by Chrome's own reckoning.
  const cdp = await page.createCDPSession();
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  const manifest = await cdp.send('Page.getAppManifest');
  check('Chrome finds nothing in the way of installing the game, and its manifest reads cleanly', installabilityErrors.length === 0 && manifest.errors.length === 0, {
    installabilityErrors: installabilityErrors.map((e) => e.errorId),
    manifestErrors: manifest.errors.map((e) => e.message),
  });

  // The service worker installs with every file of the build.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 }).catch(() => undefined);
  const cached = await page.evaluate(async () => {
    const out = {};
    for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname);
    return out;
  });
  const ours = cached[`serpent-sorcery-${built.version}`] ?? [];
  const missing = built.files.filter((f) => !ours.includes(f));
  const fontFiles = built.files.filter((f) => f.endsWith('.woff2'));
  check('once the service worker installs, every file of the build is cached (fonts included), and nothing came from anywhere else', missing.length === 0 && fontFiles.length > 0 && Object.keys(cached).length === 1 && elsewhere.length === 0, {
    files: built.files.length,
    cached: ours.length,
    missing,
    fontFiles: fontFiles.length,
    caches: Object.keys(cached),
    elsewhere,
  });

  // Offline from here on.
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'load' });
  await sleep(800);
  const title = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = async (font) => (await document.fonts.load(font)).some((f) => f.status === 'loaded');
    return { title: !!document.querySelector('.title-screen'), silkscreen: await loaded('700 16px Silkscreen'), pixelify: await loaded('16px "Pixelify Sans Variable"') };
  });
  await page.screenshot({ path: path.join(os.tmpdir(), 'serpent-offline-title.png') });
  await clickButton(page, 'Practice');
  await page.waitForSelector('.practice-pad', { timeout: 5000 }).catch(() => undefined);
  const practice = await page.evaluate(() => !!document.querySelector('.practice-pad'));
  await page.keyboard.press('Escape');
  await sleep(300);
  await clickButton(page, 'Play');
  await page.waitForSelector('.hud-bar', { timeout: 5000 }).catch(() => undefined);
  await sleep(800);
  const run = await page.evaluate(() => !!document.querySelector('canvas') && !!document.querySelector('.hud-bar'));
  await page.screenshot({ path: path.join(os.tmpdir(), 'serpent-offline-run.png') });
  check('with the network cut, the title (in its own fonts), the practice room and a run all load', title.title && title.silkscreen && title.pixelify && practice && run, { ...title, practice, run });
} finally {
  await browser.close();
  await server.close();
}

const passed = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
