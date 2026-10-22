// Renders the app's home-screen icons from the game's own pixel sprites: the serpent coiled into
// a ring, wizard hat and all, on the night-purple of the menus. Writes PNGs to public/icons/.
//
//   node scripts/make-icons.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'icons');

function findBrowser() {
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    process.env.PLAYTEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('No Chrome/Edge found. Set PLAYTEST_BROWSER to a Chromium-based browser executable.');
  return found;
}

const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { port: 5197 }, logLevel: 'warn' });
await server.listen();
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-icon-')) });
const page = await browser.newPage();
await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle0' });

// [file, size, art pixels of padding around the 40-pixel coil]
const sizes = [
  ['icon-192.png', 192, 4],
  ['icon-512.png', 512, 4],
  // Maskable icons are cropped to a circle or squircle: keep the coil inside the middle 80%.
  ['icon-maskable-512.png', 512, 10],
  ['apple-touch-icon.png', 180, 4],
];
const images = await page.evaluate(async (sizes) => {
  const { blit } = await import('/src/game/pixel/bake.ts');
  const { segmentFill, segmentOutline, wizardHead } = await import('/src/game/pixel/sprites.ts');
  const { PX } = await import('/src/game/pixel/palette.ts');
  const out = {};
  for (const [file, size, pad] of sizes) {
    const S = 40 + pad * 2;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1d0f33';
    ctx.fillRect(0, 0, S, S);
    // A faint rune circle behind the coil.
    ctx.fillStyle = '#2c1650';
    for (let a = 0; a < Math.PI * 2; a += 0.06) ctx.fillRect(Math.round(S / 2 + Math.cos(a) * 18), Math.round(S / 2 + Math.sin(a) * 18), 1, 1);
    // The serpent: tail at the lower right, round clockwise, head at the upper right.
    const N = 24;
    const cx = S / 2;
    const cy = S / 2 + 1;
    const R = 12;
    const a0 = Math.PI * 0.1;
    const span = Math.PI * 1.55;
    const pts = Array.from({ length: N }, (_, i) => {
      const a = a0 + (i / (N - 1)) * span;
      return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
    });
    const radius = (i) => Math.max(2, Math.round(2 + (i / (N - 1)) * 2.5));
    for (let i = 0; i < N - 1; i++) blit(ctx, segmentOutline(radius(i)), pts[i].x, pts[i].y);
    for (let i = 0; i < N - 1; i++) blit(ctx, segmentFill(radius(i), i % 4 === 2 ? 'stripe' : 'body'), pts[i].x, pts[i].y);
    const head = pts[N - 1];
    const prev = pts[N - 2];
    const heading = Math.atan2(head.y - prev.y, head.x - prev.x);
    const dir = ((Math.round((heading / (Math.PI * 2)) * 16) % 16) + 16) % 16;
    blit(ctx, wizardHead('player', dir, 0, 'normal'), head.x, head.y);
    ctx.fillStyle = PX.eye;
    for (const side of [-1, 1]) {
      const a = heading + side * 0.62;
      ctx.fillRect(Math.round(head.x + Math.cos(a) * 3.7) - 1, Math.round(head.y + Math.sin(a) * 3.7) - 1, 2, 2);
    }
    const big = document.createElement('canvas');
    big.width = big.height = size;
    const g = big.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(c, 0, 0, size, size);
    out[file] = big.toDataURL('image/png').split(',')[1];
  }
  return out;
}, sizes);

fs.mkdirSync(OUT, { recursive: true });
for (const [file, b64] of Object.entries(images)) {
  fs.writeFileSync(path.join(OUT, file), Buffer.from(b64, 'base64'));
  console.log('wrote', path.join('public', 'icons', file));
}
await browser.close();
await server.close();
