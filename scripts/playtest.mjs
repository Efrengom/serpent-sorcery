// End-to-end play-test with real browser input.
//
// Starts its own Vite dev server, drives a headless Edge/Chrome through the Chrome DevTools
// Protocol (keys are genuinely held while the mouse draws many-point strokes), plays an
// autopilot run, and checks the full loop: steering, drawing, aiming, cooldowns, pause/focus/
// resize handling, music and sound, the boss theme and hit-stop, learning the triangle and zigzag
// sigils, spell evolution, live sigil reading and clean casts, Constrict, descending after the
// boss, the big map (camera, pillars, spawning off-screen, the boss clearing, minimap, frame
// times), level-ups, death and its recap, rewards, restart, the shop, the wizard and curse setup
// screen, gameplay depth (relics on the way down, the Grimoire, heat, a waystone start and its
// draft, reroll, banish and skip, the ultimate), the options (comfort settings, key rebinding,
// game speed), the sigil practice room, and save persistence.
//
//   npm run playtest                       # ~5 minutes
//   AUTOPILOT_SECONDS=60 npm run playtest  # shorter autopilot run
//   PLAYTEST_BROWSER=/path/to/chrome npm run playtest
//   PLAYTEST_PIXEL=1 npm run playtest      # run everything in the pixel-art style
//
// Screenshots and results.json are written to playtest-output/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'playtest-output');
fs.mkdirSync(OUT, { recursive: true });
const AUTOPILOT_SECONDS = Number(process.env.AUTOPILOT_SECONDS ?? 150);
const SAVE_KEY = 'serpent-sorcery-save-v1';

/**
 * Where to look on each map after the first: a spot by each landmark ([name, x, y, heading]),
 * and a lane open end to end ([y, from x, to x]) to race the view along for frame times.
 */
const DEEP_TOURS = {
  hollows: {
    tour: [
      ['glowring', 3800, 2000, -Math.PI / 2],
      ['grotto', 3800, 1050, -Math.PI / 2],
      ['heartroot', 5250, 2100, 0],
      ['fallen', 2150, 1700, 0],
      ['thicket', 3800, 3350, -Math.PI / 2],
    ],
    lane: [1100, 200, 7400],
  },
  catacombs: {
    tour: [
      ['bellcourt', 4000, 2000, -Math.PI / 2],
      ['ossuary', 4000, 1000, -Math.PI / 2],
      ['kings', 4000, 3300, 0],
      ['lake', 6000, 2200, 0],
    ],
    lane: [4260, 200, 7800],
  },
  ember: {
    tour: [
      ['caldera', 1600, 2000, -Math.PI / 2],
      ['falls', 3600, 1150, -Math.PI / 2],
      ['forge', 5000, 1400, 0],
      ['spires', 5000, 2666, 0],
    ],
    lane: [2666, 200, 7000],
  },
};

function findBrowser() {
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    process.env.PLAYTEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('No Chrome/Edge found. Set PLAYTEST_BROWSER to a Chromium-based browser executable.');
  return found;
}

const results = [];
const check = (name, pass, detail = {}) => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { port: 5199 }, logLevel: 'warn' });
await server.listen();
const URL = server.resolvedUrls.local[0];
// Short temp path: a browser profile tree can exceed Windows MAX_PATH under deep folders.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pt-'));
const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  userDataDir: profile,
  defaultViewport: { width: 1280, height: 720 },
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling'],
});
const page = await browser.newPage();
const sampleResponses = [];
page.on('response', (r) => {
  if (r.url().includes('/sfx/') && r.url().includes('.ogg')) sampleResponses.push(r.status());
});
page.on('pageerror', (e) => check('no page errors', false, { error: String(e) }));
page.on('console', (m) => {
  if (m.type() === 'error') check('no console errors', false, { error: m.text() });
});
await page.goto(URL, { waitUntil: 'networkidle0' });

// ---------------------------------------------------------------- helpers

const state = () =>
  page.evaluate(async () => {
    const g = window.__serpent;
    const overlay = document.querySelector('.overlay-title')?.textContent ?? null;
    if (!g) return { phase: 'none', overlay };
    const w = g.debug().world;
    const r = g.renderer;
    const s = w.snake;
    const scr = (p) => r.worldToScreen(p);
    // The nearest stonework a little ahead of the head, for the autopilot to steer around.
    const { nearestSolid } = await import('/src/game/terrain.ts');
    const ahead = nearestSolid(w.map.index, s.x + Math.cos(s.heading) * 50, s.y + Math.sin(s.heading) * 50);
    const cam = w.camera;
    return {
      ahead: { d: ahead.d, nx: ahead.nx, ny: ahead.ny },
      cam: { x: cam.x, y: cam.y, w: cam.viewW, h: cam.viewH },
      start: w.map.start,
      fresh: w.portals.filter((p) => p.kind !== 'boss' && p.t < 0.12).map((p) => ({ x: p.x, y: p.y, seen: Math.abs(p.x - cam.x) <= cam.viewW / 2 && Math.abs(p.y - cam.y) <= cam.viewH / 2 })),
      phase: g.getPhase(),
      t: w.time,
      hp: w.hp,
      level: w.level,
      kills: w.kills,
      heading: s.heading,
      x: s.x,
      y: s.y,
      segs: s.segments.length,
      drawing: g.input.isDrawing,
      dir: g.input.direction(),
      target: g.gesture.target,
      cd: { ...w.cooldowns },
      enemies: w.enemies.map((e) => ({ kind: e.kind, x: e.x, y: e.y, s: scr(e), state: e.state })),
      shots: w.shots.map((p) => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy })),
      crystals: w.crystals.map((c) => ({ x: c.x, y: c.y })),
      bolts: w.bolts.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy })),
      novas: w.novas.map((n) => ({ x: n.x, y: n.y })),
      texts: w.floaters.filter((f) => f.screen).map((f) => f.text),
      upgrades: { ...w.upgrades },
      cssW: r.cssW,
      overlay,
      scene: window.__serpentAudio.musicScene,
    };
  });
const audioState = () =>
  page.evaluate(() => {
    const a = window.__serpentAudio;
    return { scene: a.musicScene, map: a.musicMap, theme: a.musicTheme, transpose: a.musicTranspose, playing: a.musicPlaying, time: +a.musicTime.toFixed(2) };
  });
const readSave = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), SAVE_KEY);
const worldToScreen = (p) => page.evaluate((p) => window.__serpent.renderer.worldToScreen(p), p);
const metaSum = (m) => Object.values(m).reduce((a, b) => a + b, 0);

let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const jitter = () => (rand() - 0.5) * 3;
const shapes = {
  line: (x, y, a = -0.35, len = 140) =>
    Array.from({ length: 16 }, (_, i) => ({ x: x + Math.cos(a) * (len / 15) * i + jitter(), y: y + Math.sin(a) * (len / 15) * i + jitter() })),
  vee: (x, y, s = 1) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push({ x: x + i * 4.5 * s + jitter(), y: y + i * 9 * s + jitter() });
    for (let i = 1; i <= 10; i++) pts.push({ x: x + (45 + i * 4.5) * s + jitter(), y: y + (90 - i * 9) * s + jitter() });
    return pts;
  },
  circle: (x, y, r = 45, dir = 1) =>
    Array.from({ length: 33 }, (_, i) => {
      const a = (dir * i * Math.PI * 2) / 32;
      return { x: x + Math.cos(a) * r + jitter(), y: y + Math.sin(a) * r + jitter() };
    }),
  scribble: (x, y) =>
    Array.from({ length: 60 }, (_, i) => {
      const t = i / 59;
      const a = t * Math.PI * 7;
      return { x: x + Math.cos(a) * (14 + t * 60), y: y + Math.sin(a) * (14 + t * 60) };
    }),
  triangle: (x, y, r = 70) => {
    const corners = [0, 1, 2, 3].map((i) => ({ x: x + Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 3) * r, y: y + Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 3) * r }));
    const pts = [];
    for (let i = 1; i < corners.length; i++)
      for (let k = 0; k < 12; k++)
        pts.push({ x: corners[i - 1].x + ((corners[i].x - corners[i - 1].x) * k) / 12 + jitter(), y: corners[i - 1].y + ((corners[i].y - corners[i - 1].y) * k) / 12 + jitter() });
    pts.push(corners[3]);
    return pts;
  },
  zigzag: (x, y) => {
    const z = [[0, 0], [35, 80], [70, 0], [105, 80]];
    const pts = [];
    for (let i = 1; i < z.length; i++)
      for (let k = 0; k < 10; k++)
        pts.push({ x: x + z[i - 1][0] + ((z[i][0] - z[i - 1][0]) * k) / 10 + jitter(), y: y + z[i - 1][1] + ((z[i][1] - z[i - 1][1]) * k) / 10 + jitter() });
    pts.push({ x: x + 105, y: y + 80 });
    return pts;
  },
};
const SIGIL_OF = { ward: 'triangle', frost: 'zigzag' };
const SPELL_NAME = { ward: 'Arcane Ward', frost: 'Frost Field' };

async function stroke(points, durationMs = 300, midHook) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  const dt = durationMs / Math.max(1, points.length - 1);
  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(points[i].x, points[i].y);
    if (midHook && i === Math.floor(points.length / 2)) await midHook();
    await sleep(dt);
  }
  await page.mouse.up();
}

const held = new Set();
async function setKeys(want) {
  for (const k of [...held]) if (!want.has(k)) {
    await page.keyboard.up(k);
    held.delete(k);
  }
  for (const k of want) if (!held.has(k)) {
    await page.keyboard.down(k);
    held.add(k);
  }
}

async function clickButton(text) {
  const handle = await page.evaluateHandle(
    (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t) && !b.disabled) ?? null,
    text,
  );
  const el = handle.asElement();
  if (!el) return false;
  await el.click();
  return true;
}

try {
  // ============================================================== Part A: controls
  if (process.env.PLAYTEST_PIXEL) {
    await page.keyboard.press('KeyP');
    await sleep(100);
  }
  await page.keyboard.press('Enter');
  await sleep(700);
  let s = await state();
  check('Enter on title starts a run', s.phase === 'playing', { phase: s.phase });

  {
    const a = await state();
    const t0 = Date.now();
    await sleep(1000);
    const b = await state();
    const ratio = (b.t - a.t) / ((Date.now() - t0) / 1000);
    check('simulation runs in real time', Math.abs(ratio - 1) < 0.15, { ratio: +ratio.toFixed(2) });
  }

  // Music: starts after the first key press, respects mute, ducks on pause, can be turned off.
  {
    const music = () =>
      page.evaluate(() => {
        const a = window.__serpentAudio;
        return { playing: a.musicPlaying, volume: a.musicVolume, time: a.musicTime };
      });
    const m0 = await music();
    await sleep(800);
    const m1 = await music();
    const samples = await page.evaluate(() => [window.__serpentAudio.samplesLoaded, window.__serpentAudio.samplesFailed, window.__serpentAudio.samplesTotal]);
    check('every sound effect sample loads and decodes', samples[0] === samples[2] && samples[1] === 0 && sampleResponses.every((s) => s === 200 || s === 304), {
      loaded: samples[0],
      total: samples[2],
      failed: samples[1],
      responses: sampleResponses.length,
    });
    check('music plays after the first key press and advances', m0.playing && m1.time > m0.time, { m0, m1 });
    await page.keyboard.press('KeyM');
    await sleep(150);
    const muted = await music();
    await page.keyboard.press('KeyM');
    await sleep(300);
    const unmuted = await music();
    check('mute stops the music and unmute resumes it', !muted.playing && unmuted.playing, { muted, unmuted });
    await page.keyboard.press('Escape');
    await sleep(150);
    const paused = await music();
    check('music gets quieter while paused', paused.playing && paused.volume < unmuted.volume * 0.6, {
      playingVolume: unmuted.volume,
      pausedVolume: paused.volume,
    });
    // Volume sliders in the pause menu, driven with a real click and the keyboard.
    const focusSlider = async (label) => {
      const h = await page.evaluateHandle((l) => document.querySelector(`input[aria-label="${l}"]`), label);
      await h.asElement().click();
    };
    await focusSlider('Music volume');
    await page.keyboard.press('Home');
    await sleep(150);
    const off = await music();
    check('music slider at 0 stops the music and saves it', !off.playing && (await readSave()).settings.musicVolume === 0, { off });
    await page.keyboard.press('End');
    await sleep(300);
    const loud = await music();
    check('music slider at 100% plays it louder', loud.playing && (await readSave()).settings.musicVolume === 1 && loud.volume > paused.volume, {
      pausedBefore: paused.volume,
      pausedAtMax: loud.volume,
    });
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await sleep(100);
    const afterArrows = await readSave();
    const dirAfterArrows = (await state()).dir;
    check('arrow keys adjust a focused slider', afterArrows.settings.musicVolume === 0.9, { musicVolume: afterArrows.settings.musicVolume });
    check('slider arrow keys are not taken as steering', dirAfterArrows.x === 0 && dirAfterArrows.y === 0, { dir: dirAfterArrows });
    await focusSlider('Effects volume');
    await page.keyboard.press('Home');
    await sleep(100);
    const fx0 = (await readSave()).settings.volume;
    await page.keyboard.press('End');
    await sleep(100);
    const fx1 = (await readSave()).settings.volume;
    check('effects slider saves its level', fx0 === 0 && fx1 === 1, { fx0, fx1 });
    await page.keyboard.press('Escape');
    await sleep(200);
    const resumed = await music();
    const s1 = await state();
    check('music returns to full level on resume', s1.phase === 'playing' && resumed.volume > paused.volume * 2, { resumed });
  }

  {
    const h0 = (await state()).heading;
    await setKeys(new Set(['KeyD']));
    await sleep(120);
    const mid = (await state()).heading;
    await sleep(500);
    await setKeys(new Set());
    const h1 = (await state()).heading;
    await sleep(400);
    const h2 = (await state()).heading;
    check('held D turns gradually (limited turn rate)', angDiff(mid, h0) > 0.1 && angDiff(mid, 0) > 0.1, { h0, mid });
    check('held D reaches heading east', angDiff(h1, 0) < 0.06, { h1 });
    check('releasing keys keeps heading', angDiff(h2, h1) < 1e-6, { h1, h2 });
  }

  {
    await setKeys(new Set(['KeyS', 'KeyD']));
    await sleep(600);
    const h = (await state()).heading;
    await setKeys(new Set());
    check('S+D held steers diagonally (south-east)', angDiff(h, Math.PI / 4) < 0.06, { h });
  }

  {
    await setKeys(new Set(['KeyD']));
    await sleep(400);
    await setKeys(new Set());
    const a = await state();
    await setKeys(new Set(['KeyA']));
    await sleep(900);
    await setKeys(new Set());
    const b = await state();
    check('reversing makes a curved U-turn', Math.abs(Math.cos(b.heading) + 1) < 0.02 && Math.abs(b.y - a.y) > 40, {
      to: b.heading,
      lateralShift: +Math.abs(b.y - a.y).toFixed(1),
    });
  }

  {
    await setKeys(new Set(['KeyW']));
    const before = await state();
    const wall0 = Date.now();
    let mid = null;
    await stroke(shapes.vee(260, 200), 700, async () => {
      mid = await state();
      await page.screenshot({ path: path.join(OUT, '01-drawing-vee-while-steering.png') });
    });
    await sleep(60);
    const after = await state();
    await setKeys(new Set());
    const gameDt = after.t - before.t;
    const wallDt = (Date.now() - wall0) / 1000;
    check('drawing is active mid-stroke with a target marker', mid?.drawing && !!mid?.target, { drawing: mid?.drawing });
    check('steering with held W works while drawing', angDiff(mid.heading, before.heading) > 0.15 && angDiff(after.heading, -Math.PI / 2) < 0.1, {
      before: before.heading,
      mid: mid.heading,
      after: after.heading,
    });
    check('game keeps full speed while drawing', gameDt / wallDt > 0.85, { gameDt: +gameDt.toFixed(2), wallDt: +wallDt.toFixed(2) });
    check('real V stroke casts Forked Lightning', after.cd.lightning > 0 && after.texts.includes('Forked Lightning!'), { texts: after.texts });
  }

  {
    await setKeys(new Set(['KeyD']));
    await stroke(shapes.circle(1050, 560, 45, -1), 500);
    await sleep(30);
    const a = await state();
    await setKeys(new Set());
    const nova = a.novas[0];
    check('real circle stroke (counter-clockwise) casts Arcane Nova', a.cd.nova > 0 && a.texts.includes('Arcane Nova!'), { texts: a.texts });
    check('Nova originates on the snake, not where the circle was drawn', nova && Math.hypot(nova.x - a.x, nova.y - a.y) < 25, {
      nova,
      snake: { x: a.x, y: a.y },
    });
    await page.screenshot({ path: path.join(OUT, '02-nova.png') });
  }

  {
    await sleep(500);
    const P = { x: 1080, y: 170 };
    // Nothing nearby to catch the bolt before it is measured: no foes, and no reliquary in the way.
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.enemies.length = 0;
      w.portals.length = 0;
      w.breakables = w.breakables.filter((b) => Math.hypot(b.x - w.snake.x, b.y - w.snake.y) > 600);
    });
    await setKeys(new Set(['KeyS']));
    const atDown = await state();
    // The camera scrolls while the stroke is drawn, so the aim is whatever was recorded at the press.
    let pressed = null;
    const line = shapes.line(P.x, P.y, 2.6, 130);
    await page.mouse.move(line[0].x, line[0].y);
    await page.mouse.down();
    pressed = await page.evaluate((p) => ({ target: window.__serpent.gesture.target, under: window.__serpent.renderer.screenToWorld(p) }), line[0]);
    for (let i = 1; i < line.length; i++) {
      await page.mouse.move(line[i].x, line[i].y);
      await sleep(650 / (line.length - 1));
    }
    await page.mouse.up();
    const T = pressed.target;
    const a = await state();
    await setKeys(new Set());
    const drift = await worldToScreen(T);
    check('the aim is the world point under the cursor at the press, and stays put while the view scrolls', Math.hypot(T.x - pressed.under.x, T.y - pressed.under.y) < 8 && Math.hypot(drift.x - line[0].x, drift.y - line[0].y) > 10, {
      target: { x: Math.round(T.x), y: Math.round(T.y) },
      under: { x: Math.round(pressed.under.x), y: Math.round(pressed.under.y) },
      scrolledPx: Math.round(Math.hypot(drift.x - line[0].x, drift.y - line[0].y)),
    });
    const b = a.bolts[a.bolts.length - 1];
    const boltAngle = b ? Math.atan2(b.vy, b.vx) : NaN;
    const towardTarget = b ? Math.atan2(T.y - b.y, T.x - b.x) : NaN;
    const fromOldHead = Math.atan2(T.y - atDown.y, T.x - atDown.x);
    check('real line stroke casts Arcane Bolt', a.texts.includes('Arcane Bolt!') && a.cd.bolt > 0, { texts: a.texts });
    check('bolt flies toward the recorded mouse-down target', angDiff(boltAngle, towardTarget) < 0.03, {
      boltAngle: +boltAngle.toFixed(3),
      towardTarget: +towardTarget.toFixed(3),
    });
    check('aim uses the head position at release (snake moved during the stroke)', Math.hypot(a.x - atDown.x, a.y - atDown.y) > 80 && angDiff(boltAngle, fromOldHead) > 0.03, {
      headMoved: +Math.hypot(a.x - atDown.x, a.y - atDown.y).toFixed(0),
    });
    const back = await page.evaluate((p) => window.__serpent.renderer.worldToScreen(window.__serpent.renderer.screenToWorld(p)), P);
    check('mouse-to-map mapping round-trips', Math.hypot(back.x - P.x, back.y - P.y) < 1, { P, back });
  }

  {
    await sleep(700);
    await stroke(shapes.line(400, 500, -0.3), 150);
    await stroke(shapes.line(400, 560, -0.3), 150);
    const a = await state();
    check('recognized spell on cooldown shows recharge feedback', a.texts.some((t) => t.includes('recharging')), { texts: a.texts });
  }

  {
    await sleep(1300);
    const a = await state();
    await stroke(shapes.scribble(500, 420), 400);
    await sleep(30);
    const b = await state();
    const jumped = (k) => b.cd[k] > a.cd[k] + 0.01;
    check('real scribble shows "Sigil unclear" and costs no cooldown', b.texts.includes('Sigil unclear') && !jumped('bolt') && !jumped('lightning') && !jumped('nova'), {
      texts: b.texts,
    });
    await sleep(1000);
    const c = await state();
    await page.mouse.click(640, 480);
    await sleep(50);
    const d = await state();
    check('real single click never casts', d.texts.length <= c.texts.length && !(d.cd.bolt > c.cd.bolt + 0.01), { textsAfter: d.texts });
  }

  {
    const a = await state();
    await clickButton('🔊');
    await sleep(50);
    const b = await state();
    check('clicking a HUD button does not start a sigil', !b.drawing && b.texts.length <= a.texts.length, { drawing: b.drawing });
    await clickButton('🔇');
  }

  {
    await setKeys(new Set(['KeyD']));
    await sleep(100);
    await page.keyboard.press('Escape');
    await sleep(100);
    const a = await state();
    check('Escape pauses', a.phase === 'paused' && a.overlay === 'Paused', { phase: a.phase });
    check('pausing clears held input', a.dir.x === 0 && a.dir.y === 0, { dir: a.dir });
    await setKeys(new Set());
    await page.keyboard.press('Escape');
    await sleep(100);
    check('Escape resumes', (await state()).phase === 'playing');
  }

  {
    const other = await browser.newPage();
    await other.bringToFront();
    await sleep(300);
    const a = await state();
    check('losing focus/visibility pauses', a.phase === 'paused', { phase: a.phase });
    await other.close();
    await page.bringToFront();
    await sleep(200);
    await page.keyboard.press('Escape');
    await sleep(100);
  }

  {
    await setKeys(new Set(['KeyA']));
    await page.mouse.move(500, 400);
    await page.mouse.down();
    await page.mouse.move(530, 420);
    await page.mouse.move(560, 440);
    await page.setViewport({ width: 1100, height: 680 });
    await sleep(150);
    const a = await state();
    await page.mouse.up();
    await setKeys(new Set());
    check('resize cancels an unfinished gesture', !a.drawing && a.target === null, { drawing: a.drawing });
    check('resize clears held keys', a.dir.x === 0 && a.dir.y === 0, { dir: a.dir });
    check('renderer follows the new size', a.cssW === 1100, { cssW: a.cssW });
    const P = { x: 300, y: 300 };
    const back = await page.evaluate((p) => window.__serpent.renderer.worldToScreen(window.__serpent.renderer.screenToWorld(p)), P);
    check('mouse mapping correct after resize', Math.hypot(back.x - P.x, back.y - P.y) < 1, { P, back });
    await page.setViewport({ width: 1280, height: 720 });
    await sleep(150);
  }

  // ============================================================== Part A2: boss music, hit-stop
  {
    const a0 = await audioState();
    check('run music plays the Ruins theme', a0.theme === 'ruins' && a0.map === 'ruins' && /^run/.test(a0.scene) && a0.playing, a0);
    // The development jukebox plays any map's music over the game's, until released.
    await page.evaluate(() => window.__serpentAudio.jukebox({ map: 'ember', loop: 1, scene: 'run2' }));
    await sleep(700);
    const jb = await audioState();
    await page.evaluate(() => window.__serpentAudio.jukebox(null));
    await sleep(700);
    const jbOff = await audioState();
    check('the jukebox plays a chosen map, loop and arrangement, then hands back to the game', jb.theme === 'ember' && jb.transpose === 1 && jb.scene === 'run2' && jbOff.theme === 'ruins' && /^run/.test(jbOff.scene), { jb, jbOff });
    // Make the snake untouchable (and unable to level up mid-test), then skip ahead to just
    // before the boss warning. Part B starts a fresh run afterwards.
    // Back to the start in the Rune Plaza, so the boss arrives in that clearing, in view.
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.invuln = 1e9;
      w.xp = -1e6;
      w.snake.reset(w.map.start.x, w.map.start.y, -Math.PI / 2);
      w.time = w.nextBossTime - 4.6;
    });
    await sleep(900);
    const warn = await audioState();
    check('music hushes when the boss warning sounds', warn.scene === 'warning' && warn.theme === 'ruins', warn);
    let bossUp = false;
    for (let i = 0; i < 48 && !bossUp; i++) {
      await sleep(250);
      bossUp = await page.evaluate(() => !!window.__serpent.debug().world.boss);
    }
    // The boss came out in the clearing; bring the serpent in range of it (toward the plaza's middle).
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      const b = w.boss;
      if (!b) return;
      const plaza = w.map.landmarks.find((l) => l.kind === 'plaza');
      const d = Math.hypot(plaza.x - b.x, plaza.y - b.y) || 1;
      w.snake.reset(b.x + ((plaza.x - b.x) / d) * 450, b.y + ((plaza.y - b.y) / d) * 450, Math.atan2(b.y - plaza.y, b.x - plaza.x));
    });
    await sleep(800);
    const fight = await audioState();
    check('the Ruins’ boss theme crossfades in when the boss appears', bossUp && fight.theme === 'ruinsBoss' && /^boss/.test(fight.scene), { bossUp, fight });
    await page.screenshot({ path: path.join(OUT, '07-boss-fight.png') });

    // Clear the field, leave the boss on 1 HP and record sim time against real time.
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.enemies = w.enemies.filter((e) => e.kind === 'boss');
      w.portals = [];
      w.boss.hp = 1;
      window.__timeline = [];
      const rec = () => {
        window.__timeline.push([performance.now(), w.time, window.__serpent.getPhase()]);
        if (window.__timeline.length < 1500) requestAnimationFrame(rec);
      };
      requestAnimationFrame(rec);
    });
    // Finish it with real bolt strokes aimed at any visible part of the boss.
    let killed = false;
    for (let i = 0; i < 10 && !killed; i++) {
      const aim = await page.evaluate(() => {
        const g = window.__serpent;
        const w = g.debug().world;
        const b = w.boss;
        if (!b) return null;
        // Side-on and well clear of it, so the serpent isn't already on the way down when it falls.
        const a = Math.atan2(w.snake.y - b.y, w.snake.x - b.x);
        w.snake.reset(b.x + Math.cos(a) * 420, b.y + Math.sin(a) * 420, a + Math.PI / 2);
        const pts = [{ x: b.x, y: b.y }, ...b.segments].map((p) => g.renderer.worldToScreen(p));
        return pts.find((p) => p.y > 110 && p.y < 600 && p.x > 30 && p.x < 1150) ?? null;
      });
      if (aim) await stroke(shapes.line(aim.x, aim.y, -0.3, 110), 130);
      await sleep(650);
      killed = await page.evaluate(() => window.__serpent.debug().world.bossKills > 0);
    }
    // Turn away from where it fell, so the serpent doesn't slide into the way down while we watch the slow motion.
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      const d = w.descent;
      if (d) w.snake.reset(Math.max(w.map.bounds.minX + 200, d.x - 700), d.y, Math.PI);
    });
    await sleep(2600);
    const tl = await page.evaluate(() => window.__timeline);
    // The longest stretch of real time during which the simulation clock stood still while playing.
    let freeze = 0;
    let freezeEndAt = 0;
    let start = null;
    for (let i = 1; i < tl.length; i++) {
      if (tl[i][2] === 'playing' && tl[i][1] === tl[i - 1][1]) {
        start ??= tl[i - 1][0];
        if (tl[i][0] - start > freeze) {
          freeze = tl[i][0] - start;
          freezeEndAt = tl[i][0];
        }
      } else start = null;
    }
    const rate = (fromMs, toMs) => {
      const a = tl.find((r) => r[0] >= freezeEndAt + fromMs);
      const b = [...tl].reverse().find((r) => r[0] <= freezeEndAt + toMs);
      return a && b && b[0] > a[0] ? +((b[1] - a[1]) / ((b[0] - a[0]) / 1000)).toFixed(2) : null;
    };
    const slow = rate(50, 850);
    const after = rate(1400, 2200);
    check('killing the boss freezes the action for a moment', killed && freeze >= 350 && freeze <= 700, { killed, freezeMs: Math.round(freeze) });
    check('then plays out in slow motion before returning to full speed', slow !== null && slow < 0.5 && after !== null && after > 0.85, { slow, after });
    // The band stops for the Ruins' victory sting; then the way down plays the Hollows' music.
    const heard = [];
    for (let i = 0; i < 30; i++) {
      const a = await audioState();
      const k = `${a.scene}:${a.theme}`;
      if (heard.at(-1) !== k) heard.push(k);
      if (k === 'calm:hollows') break;
      await sleep(200);
    }
    check('after the boss falls, the Ruins’ sting plays, then the Hollows’ music rises on the way down', heard.includes('victory:ruins') && heard.at(-1) === 'calm:hollows', { heard });
    // A way down opens where the boss fell: off-screen it gets an arrow; steering into it with a real key descends.
    const way = await page.evaluate(() => {
      const g = window.__serpent;
      const w = g.debug().world;
      const d = w.descent;
      if (!d) return null;
      // Well to its left, heading up, so the arrow shows; then just left of it.
      w.snake.reset(Math.max(w.map.bounds.minX + 200, d.x - 1500), d.y, -Math.PI / 2);
      return { x: d.x, y: d.y, depth: w.depth, alive: w.enemies.filter((e) => !e.dead).length };
    });
    await sleep(500);
    const arrow = await page.evaluate(() => {
      const g = window.__serpent;
      return g.renderer.arrows(g.debug().world).map((a) => a.p.label);
    });
    check('the boss falls: the field clears and a way down opens, with an arrow while it is off-screen', !!way && way.depth === 1 && way.alive === 0 && arrow.includes('Way down'), { way, arrow });
    await page.evaluate((d) => {
      const w = window.__serpent.debug().world;
      if (d) w.snake.reset(d.x - 260, d.y + 40, -Math.PI / 2);
    }, way);
    await setKeys(new Set(['KeyD']));
    // On the threshold the way down offers three relics, led by the next map's own.
    let offer = null;
    for (let i = 0; i < 20 && !offer; i++) {
      await sleep(100);
      offer = await page.evaluate(() =>
        window.__serpent.getPhase() === 'relic' ? { relics: [...document.querySelectorAll('.upgrade-card.relic')].map((c) => c.dataset.relic), sub: document.querySelector('.relic-offer .overlay-sub')?.textContent } : null,
      );
    }
    await setKeys(new Set());
    check('stepping into the way down offers three relics, led by the Hollows’ own', !!offer && offer.relics.length === 3 && offer.relics[0] === 'thornhide' && /Depth 2: Mycelium Hollows/.test(offer.sub ?? ''), { offer });
    await page.screenshot({ path: path.join(OUT, '08a-relics.png') });
    await sleep(600);
    if (offer) await page.click(`.upgrade-card.relic[data-relic="${offer.relics[1]}"]`);
    let deeper = null;
    for (let i = 0; i < 20 && !deeper; i++) {
      await sleep(100);
      deeper = await page.evaluate(() => {
        const w = window.__serpent.debug().world;
        return w.depth > 1 ? { depth: w.depth, map: w.map.def.id, area: w.area, banner: w.banner?.text ?? null, relics: [...w.relics] } : null;
      });
    }
    await sleep(700);
    const hud = await page.evaluate(() => `${document.querySelector('.kills')?.textContent ?? ''} / ${document.querySelector('.map-name')?.textContent ?? ''}`);
    check(
      'steering into the way down descends to Depth 2, the Mycelium Hollows, with its banner',
      !!deeper && deeper.depth === 2 && deeper.map === 'hollows' && deeper.banner === 'Depth 2: Mycelium Hollows' && /Depth 2/.test(hud) && /Mycelium Hollows/i.test(hud),
      { deeper, hud },
    );
    await page.screenshot({ path: path.join(OUT, '08-depth-2.png') });
    const deepMusic = await audioState();
    check('the Hollows plays its own theme, on its first loop', deepMusic.theme === 'hollows' && deepMusic.map === 'hollows' && deepMusic.transpose === 0 && /^run/.test(deepMusic.scene) && deepMusic.playing, deepMusic);
    const chip = await page.evaluate(() => [...document.querySelectorAll('.relic-chip')].map((c) => c.dataset.relic));
    check('a relic picked with a real click is carried down and shown on the HUD', !!deeper && deeper.relics.length === 1 && deeper.relics[0] === offer?.relics[1] && chip.join() === deeper.relics.join(), { relics: deeper?.relics, chip });
    const rec = await page.evaluate(() => window.__serpent.debug().world.recap.spells.bolt);
    check('the recap credits the boss kill to Arcane Bolt', rec.kills >= 1 && rec.casts >= 1, rec);
  }

  // ============================================================== Part A3: new sigils, learning, evolution
  {
    await page.evaluate(() => window.__serpent.restart());
    await sleep(300);
    const known0 = await page.evaluate(() => [...window.__serpent.debug().world.known]);
    check('the Arcanist starts with Bolt, Lightning and Nova', known0.join() === 'bolt,lightning,nova', { known: known0 });
    await page.evaluate(() => (window.__serpent.debug().world.invuln = 1e9));
    await stroke(shapes.triangle(900, 380), 450);
    await sleep(40);
    let t = await state();
    const noWard = await page.evaluate(() => window.__serpent.debug().world.ward === null);
    check('a real triangle before learning it says the sigil is not learned yet', noWard && t.texts.some((x) => x.includes('Arcane Ward not learned')), { texts: t.texts });

    // Level-ups teach the missing sigils: a learn card is guaranteed at level 3 and level 6.
    const learnAt = async (level) => {
      await page.evaluate((level) => {
        const w = window.__serpent.debug().world;
        w.level = level - 1;
        // Exactly one level's worth (the XP curve from config.PROGRESSION).
        const l = w.level - 1;
        w.xp = Math.floor(16 + 7 * l + l * l) + 0.5;
      }, level);
      for (let i = 0; i < 20 && (await state()).phase !== 'levelup'; i++) await sleep(50);
      await sleep(520);
      const cards = await page.evaluate(() => [...document.querySelectorAll('.upgrade-card')].map((c) => ({ learn: c.classList.contains('learn'), name: c.querySelector('.card-name')?.textContent })));
      const i = cards.findIndex((c) => c.learn);
      if (i >= 0) await page.keyboard.press(['Digit1', 'Digit2', 'Digit3'][i]);
      await sleep(120);
      // Further level-ups queued by the big XP grant: take the first card.
      await page.evaluate(() => (window.__serpent.debug().world.xp = 0));
      for (let k = 0; k < 30 && (await state()).phase === 'levelup'; k++) {
        await sleep(480);
        await page.keyboard.press('Digit1');
        await sleep(80);
      }
      return { cards, picked: i >= 0 ? cards[i].name : null };
    };
    const castNew = async (spell) => {
      await page.evaluate((spell) => (window.__serpent.debug().world.cooldowns[spell] = 0), spell);
      if (spell === 'ward') await stroke(shapes.triangle(900, 380), 450);
      else await stroke(shapes.zigzag(250, 260), 450);
      await sleep(40);
      return page.evaluate(() => {
        const w = window.__serpent.debug().world;
        return { ward: w.ward ? w.ward.charges : 0, frost: w.frostFields.length, texts: w.floaters.filter((f) => f.screen).map((f) => f.text) };
      });
    };
    const first = await learnAt(3);
    const known1 = await page.evaluate(() => [...window.__serpent.debug().world.known]);
    const learned1 = known1.find((k) => k === 'ward' || k === 'frost');
    check('level 3 offers a new sigil card, and picking it teaches the sigil', !!first.picked && !!learned1 && first.picked === SPELL_NAME[learned1], { first, known: known1 });
    await page.screenshot({ path: path.join(OUT, '09-learned-sigil.png') });
    const c1 = learned1 ? await castNew(learned1) : null;
    check(`a real ${SIGIL_OF[learned1] ?? 'new'} stroke now casts ${SPELL_NAME[learned1] ?? 'it'}`, !!c1 && c1.texts.includes(`${SPELL_NAME[learned1]}!`) && (learned1 === 'ward' ? c1.ward > 0 : c1.frost > 0), c1 ?? {});
    const second = await learnAt(6);
    const known2 = await page.evaluate(() => [...window.__serpent.debug().world.known]);
    const learned2 = known2.find((k) => (k === 'ward' || k === 'frost') && k !== learned1);
    check('level 6 teaches the other new sigil', !!learned2 && known2.length === 5, { second, known: known2 });
    const c2 = learned2 ? await castNew(learned2) : null;
    check(`a real ${SIGIL_OF[learned2] ?? 'new'} stroke casts ${SPELL_NAME[learned2] ?? 'it'}`, !!c2 && c2.texts.includes(`${SPELL_NAME[learned2]}!`) && (learned2 === 'ward' ? c2.ward > 0 : c2.frost > 0), c2 ?? {});
    t = await state();
    const hudCards = await page.evaluate(() => document.querySelectorAll('.spell-card').length);
    check('the HUD shows all five learned spells', hudCards === 5, { hudCards });

    // The ward blocks a real hit: drop a chaser on the head with no invulnerability.
    if (!(await page.evaluate(() => !!window.__serpent.debug().world.ward))) await castNew('ward');
    const block = await page.evaluate(async () => {
      const w = window.__serpent.debug().world;
      w.invuln = 0;
      const hp = w.hp;
      w.portals.push({ x: w.snake.x, y: w.snake.y, kind: 'chaser', t: 0, duration: 0.01 });
      await new Promise((r) => setTimeout(r, 250));
      return { hpBefore: hp, hpAfter: w.hp, blocked: w.recap.blocked };
    });
    check('Arcane Ward blocks a real hit', block.blocked >= 1 && block.hpAfter === block.hpBefore, block);
    await page.evaluate(() => (window.__serpent.debug().world.invuln = 1e9));

    // Frost slows a foe standing in it.
    if (!(await page.evaluate(() => window.__serpent.debug().world.frostFields.length > 0))) await castNew('frost');
    const chill = await page.evaluate(async () => {
      const w = window.__serpent.debug().world;
      const f = w.frostFields[0];
      const e = w.enemies.find((e) => e.kind !== 'boss');
      if (!f || !e) return { chilled: false };
      e.x = f.x;
      e.y = f.y;
      await new Promise((r) => setTimeout(r, 120));
      return { chilled: e.chill === 1, scale: w.stats.frostSlow };
    });
    check('Frost Field slows a foe inside it', chill.chilled, chill);
    await page.screenshot({ path: path.join(OUT, '10-ward-and-frost.png') });

    // Evolution: max Piercing Bolt, two ranks of Potency, then a level-up offers Arcane Lance.
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.upgrades.pierce = 4;
      w.upgrades.potency = 2;
      const l = w.level - 1;
      w.xp = Math.floor(16 + 7 * l + l * l) + 0.5;
    });
    for (let i = 0; i < 20 && (await state()).phase !== 'levelup'; i++) await sleep(50);
    await sleep(520);
    const evoCards = await page.evaluate(() => [...document.querySelectorAll('.upgrade-card')].map((c) => ({ evolve: c.classList.contains('evolve'), name: c.querySelector('.card-name')?.textContent })));
    await page.screenshot({ path: path.join(OUT, '11-evolution-card.png') });
    const ei = evoCards.findIndex((c) => c.evolve);
    if (ei >= 0) await page.keyboard.press(['Digit1', 'Digit2', 'Digit3'][ei]);
    await sleep(120);
    await page.evaluate(() => (window.__serpent.debug().world.xp = 0));
    for (let k = 0; k < 30 && (await state()).phase === 'levelup'; k++) {
      await sleep(480);
      await page.keyboard.press('Digit1');
      await sleep(80);
    }
    check('maxed upgrades offer the Arcane Lance evolution card', ei >= 0 && evoCards[ei].name === 'Arcane Lance', { evoCards });
    await page.evaluate(() => (window.__serpent.debug().world.cooldowns.bolt = 0));
    await stroke(shapes.line(1000, 250, -0.3, 120), 140);
    await sleep(20);
    const lance = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      return { evolved: w.evolved.bolt, beams: w.beams.length, texts: w.floaters.filter((f) => f.screen).map((f) => f.text) };
    });
    await page.screenshot({ path: path.join(OUT, '12-arcane-lance.png') });
    check('a real line stroke fires an Arcane Lance beam once evolved', lance.evolved && lance.beams > 0 && lance.texts.includes('Arcane Lance!'), lance);
  }

  // ============================================================== Part A4: live sigil reading, clean casts, Constrict
  {
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.invuln = 1e9;
      w.cooldowns.lightning = 0;
    });
    // A slow, careful V: the trail reads the first leg as a line, then the whole stroke as a V.
    const vee = [];
    for (let i = 0; i <= 12; i++) vee.push({ x: 820 + i * 5, y: 250 + i * 11 });
    for (let i = 1; i <= 12; i++) vee.push({ x: 880 + i * 5, y: 382 - i * 11 });
    const readings = [];
    const before = await page.evaluate(() => ({ ...window.__serpent.debug().world.recap.casts }));
    await page.mouse.move(vee[0].x, vee[0].y);
    await page.mouse.down();
    for (let i = 1; i < vee.length; i++) {
      await page.mouse.move(vee[i].x, vee[i].y);
      await sleep(25);
      if (i === 10 || i === vee.length - 1) {
        await sleep(120);
        readings.push(await page.evaluate(() => window.__serpent.gesture.reading?.kind ?? null));
      }
    }
    await page.mouse.up();
    await sleep(40);
    const cast = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      return { texts: w.floaters.filter((f) => f.screen).map((f) => f.text), casts: { ...w.recap.casts } };
    });
    check('while drawing, the trail reads the first leg as a line, then the finished stroke as a V', readings[0] === 'line' && readings[1] === 'vee', { readings });
    const graded = cast.texts.some((t) => /^(Perfect|Clean) \+\d+%$/.test(t));
    const counted = cast.casts.perfect + cast.casts.clean > before.perfect + before.clean;
    check('a careful real V casts as Perfect or Clean, with its bonus shown and counted', cast.texts.includes('Tempest!') || cast.texts.includes('Forked Lightning!') ? graded && counted : false, cast);

    // Constrict: a long serpent circles a brute with real WASD, closing a loop around it.
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.enemies.length = 0;
      w.portals.length = 0;
      w.shots.length = 0;
      w.spawnAcc = -1e9;
      w.frostFields.length = 0;
      const s = w.snake;
      s.segmentCount = s.segmentTarget = 30;
      s.x = 560;
      s.y = 330;
      s.heading = 0;
      w.portals.push({ x: 560, y: 330 + 190 / 4.4, kind: 'brute', t: 0, duration: 0.05 });
    });
    await sleep(150);
    const bruteHp = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      const b = w.enemies.find((e) => e.kind === 'brute');
      b.speed = 0;
      b.attackTimer = 1e9;
      b.elite = null;
      b.shield = 0;
      w.snake.x = 560;
      w.snake.y = 330;
      w.snake.heading = 0;
      return b.hp;
    });
    let hinted = false;
    let crushed = false;
    const keys = ['KeyS', 'KeyA', 'KeyW', 'KeyD', 'KeyS'];
    for (let k = 0; k < keys.length && !crushed; k++) {
      await page.keyboard.down(keys[k]);
      if (k > 0) await page.keyboard.up(keys[k - 1]);
      const t0 = Date.now();
      while (Date.now() - t0 < 330) {
        const st = await page.evaluate(() => {
          const w = window.__serpent.debug().world;
          return { coil: w.coil, casts: w.recap.spells.constrict.casts };
        });
        if (st.coil && !st.coil.closed && st.coil.enclosed > 0) hinted = true;
        if (st.casts > 0) {
          crushed = true;
          await page.screenshot({ path: path.join(OUT, '15-constrict.png') });
          break;
        }
        await sleep(15);
      }
    }
    for (const k of keys) await page.keyboard.up(k);
    const crush = await page.evaluate((hp) => {
      const w = window.__serpent.debug().world;
      const b = w.enemies.find((e) => e.kind === 'brute');
      return { loops: w.recap.spells.constrict.casts, damage: Math.round(w.recap.spells.constrict.damage), hpLost: b ? Math.round(hp - b.hp) : 'killed', stunned: b ? +b.stunned.toFixed(2) : null };
    }, bruteHp);
    check('the loop hint shows the gap before the body closes around a foe', hinted, { hinted });
    check('circling a brute with real keys closes a loop that Constricts it', crushed && crush.loops >= 1 && (crush.hpLost === 'killed' || crush.hpLost > 0) && (crush.stunned === null || crush.stunned > 0), crush);
  }

  // ============================================================== Part M: the big map
  {
    await page.evaluate(() => window.__serpent.restart());
    await sleep(200);
    // Nothing to fight: just the serpent and the Sunken Ruins.
    const calm = () =>
      page.evaluate(() => {
        const w = window.__serpent.debug().world;
        w.spawnAcc = -1e9;
        w.enemies.length = 0;
        w.portals.length = 0;
        w.shots.length = 0;
        w.xp = -1e6;
      });
    const headInView = () =>
      page.evaluate(() => {
        const g = window.__serpent;
        const r = g.renderer;
        const head = r.worldToScreen(g.debug().world.snake);
        const mid = { x: r.ox + (r.viewW * r.scale) / 2, y: r.oy + (r.viewH * r.scale) / 2 };
        return { off: Math.hypot(head.x - mid.x, head.y - mid.y), scale: r.scale };
      });
    await calm();

    const c0 = await state();
    await setKeys(new Set(['KeyD']));
    await sleep(1500);
    await setKeys(new Set());
    const c1 = await state();
    const follow = await headInView();
    check('the camera follows the serpent across the map, looking a little ahead of it', Math.hypot(c1.cam.x - c0.cam.x, c1.cam.y - c0.cam.y) > 200 && follow.off > 10 && follow.off < 150 * follow.scale, {
      cameraMoved: Math.round(Math.hypot(c1.cam.x - c0.cam.x, c1.cam.y - c0.cam.y)),
      headFromMiddlePx: Math.round(follow.off),
    });

    await page.evaluate(() => window.__serpent.setOptions({ ...window.__serpent.options, steadyCamera: true }));
    await sleep(300);
    const steady = await headInView();
    await page.evaluate(() => window.__serpent.setOptions({ ...window.__serpent.options, steadyCamera: false }));
    check('Steady camera keeps the serpent in the middle of the view', steady.off < 3.5, { headFromMiddlePx: +steady.off.toFixed(1) });

    // Steer straight up into the colonnade's middle pillar with a real key.
    const pillar = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      const p = w.map.solids.find((s) => s.name === 'pillar' && s.shape === 'circle' && Math.abs(s.x - 3200) < 40 && Math.abs(s.y - 780) < 40);
      // No urn on the way whose heart could heal the bump.
      w.breakables = w.breakables.filter((b) => Math.hypot(b.x - p.x, b.y - p.y) > 500);
      w.pickups.length = 0;
      w.snake.reset(p.x, p.y + p.r + 15 + 150, -Math.PI / 2);
      w.invuln = 0;
      return { hp: w.hp };
    });
    await setKeys(new Set(['KeyW']));
    await sleep(950);
    await setKeys(new Set());
    await sleep(100);
    const bonk = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      return { hp: w.hp, taken: w.recap.taken['wall:pillar'] ?? 0, heading: +w.snake.heading.toFixed(2) };
    });
    check('steering into a pillar bounces the serpent back and costs 8 health, recorded as the pillar', pillar.hp - bonk.hp === 8 && bonk.taken === 8 && Math.sin(bonk.heading) > 0.5, { ...bonk, before: pillar.hp });

    // Between the colonnade's rows, half a minute before the boss: its clearing is marked, off-screen.
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.snake.reset(3000, 590, 0);
      w.invuln = 1e9;
      w.time = w.nextBossTime - 29;
    });
    await sleep(500);
    const mark = await page.evaluate(() => {
      const g = window.__serpent;
      const w = g.debug().world;
      const c = w.bossClearing >= 0 ? w.map.clearings[w.bossClearing] : null;
      const arrows = g.renderer.arrows(w).map((a) => ({ label: a.p.label, x: Math.round(a.x), y: Math.round(a.y), a: +a.a.toFixed(2) }));
      const r = g.renderer;
      const mid = { x: r.camLeft + r.viewW / 2, y: r.camTop + r.viewH / 2 };
      return {
        clearing: c,
        arrows,
        toward: c ? +Math.atan2((c.y0 + c.y1) / 2 - mid.y, (c.x0 + c.x1) / 2 - mid.x).toFixed(2) : null,
        inside: arrows.every((a) => a.x > r.camLeft && a.x < r.camLeft + r.viewW && a.y > r.camTop && a.y < r.camTop + r.viewH),
        hud: document.querySelector('.boss-incoming')?.textContent ?? null,
      };
    });
    await page.screenshot({ path: path.join(OUT, '20-boss-clearing-arrow.png') });
    check(
      'half a minute before the boss, its clearing is marked and an arrow at the edge of the view points to it',
      !!mark.clearing && mark.arrows.length === 1 && mark.arrows[0].label === 'Boss clearing' && mark.inside && angDiff(mark.arrows[0].a, mark.toward) < 0.05 && /arrives in/.test(mark.hud ?? ''),
      mark,
    );
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.nextBossTime = w.time + 1e4;
      w.bossClearing = -1;
      w.bossWarned = false;
    });

    // The minimap, turned off and on again from the pause menu's options with real clicks.
    const minimapPixels = () =>
      page.evaluate(() => {
        const r = window.__serpent.renderer;
        const c = document.querySelector('.game-canvas');
        const dpr = c.width / c.clientWidth;
        const w = 220;
        const h = Math.round((220 * 3600) / 6400);
        const x = Math.round(r.ox + r.viewW * r.scale - w - 10);
        const y = Math.round(r.oy + r.viewH * r.scale - h - 10);
        const data = c.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.round(w * dpr), Math.round(h * dpr)).data;
        // The outline of the visible area is the only near-white there.
        let n = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) n++;
        return n;
      });
    const toggleMinimap = async () => {
      await page.keyboard.press('Escape');
      await sleep(150);
      await clickButton('Options');
      await sleep(150);
      await clickButton('Minimap');
      await sleep(60);
      await page.keyboard.press('Escape');
      await sleep(150);
      await page.keyboard.press('Escape');
      await sleep(250);
    };
    const shown = await minimapPixels();
    await toggleMinimap();
    const hidden = await minimapPixels();
    const savedOff = (await readSave()).settings.minimap;
    await toggleMinimap();
    const again = await minimapPixels();
    check('the minimap draws the visible area, and the Minimap option hides it (saved)', shown > 60 && hidden < 10 && again > 60 && savedOff === false && (await readSave()).settings.minimap === true, {
      shown,
      hidden,
      again,
      savedOff,
    });

    // Each landmark, in both styles, and the slowest frames while the view races across the map.
    const landmarks = [
      ['plaza', 3200, 2100, -Math.PI / 2],
      ['colonnade', 2600, 590, 0],
      ['hall', 700, 1900, 0],
      ['colossus', 5150, 2470, -0.4],
      ['gate', 3200, 3350, -Math.PI / 2],
    ];
    const frameTimes = {};
    for (let pass = 0; pass < 2; pass++) {
      const pixel = await page.evaluate(() => document.querySelector('.app').classList.contains('pixel'));
      const name = pixel ? 'pixel' : 'classic';
      for (const [id, x, y, h] of landmarks) {
        await page.evaluate(
          ([x, y, h]) => {
            const w = window.__serpent.debug().world;
            w.snake.reset(x, y, h);
            w.invuln = 0;
            w.hp = w.stats.maxHp;
          },
          [x, y, h],
        );
        await sleep(450);
        await page.screenshot({ path: path.join(OUT, `21-map-${id}-${name}.png`) });
      }
      frameTimes[name] = await page.evaluate(async () => {
        const w = window.__serpent.debug().world;
        w.invuln = 1e9;
        w.snake.reset(200, 960, 0);
        const times = [];
        let last = performance.now();
        await new Promise((done) => {
          const tick = (t) => {
            times.push(t - last);
            last = t;
            // About three times the serpent's own speed, along a lane that is open end to end.
            w.snake.x += 7;
            w.snake.y = 960;
            w.snake.heading = 0;
            if (w.snake.x < 6100 && times.length < 1200) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame(tick);
        });
        times.shift();
        times.sort((a, b) => a - b);
        return { frames: times.length, median: +times[Math.floor(times.length / 2)].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1), max: +times[times.length - 1].toFixed(1) };
      });
      // Switch art style (the second switch puts it back).
      await page.keyboard.press('KeyP');
      await sleep(300);
    }
    check('frame times stay smooth while the view races across the whole map, in both styles', Object.values(frameTimes).every((f) => f.p95 < 34 && f.max < 120), frameTimes);

    // The deeper maps: each one's landmarks in both styles, and frame times across each.
    const tours = (
      await page.evaluate(async () => {
        const { MAP_ORDER } = await import('/src/game/maps/index.ts');
        return MAP_ORDER.slice(1);
      })
    ).map((id) => ({ id, tour: DEEP_TOURS[id]?.tour ?? [], lane: DEEP_TOURS[id]?.lane ?? null }));
    const deepTimes = {};
    const deepThemes = {};
    for (const { id, tour, lane } of tours) {
      await page.evaluate(async (id) => {
        const { enterNextMap } = await import('/src/game/descent.ts');
        const w = window.__serpent.debug().world;
        while (w.map.def.id !== id) enterNextMap(w);
        w.invuln = 1e9;
        w.spawnAcc = -1e9;
        w.fade = 0;
        w.banner = null;
      }, id);
      await sleep(900);
      deepThemes[id] = (await audioState()).theme;
      for (let pass = 0; pass < 2; pass++) {
        const pixel = await page.evaluate(() => document.querySelector('.app').classList.contains('pixel'));
        const name = pixel ? 'pixel' : 'classic';
        for (const [spot, x, y, h] of tour) {
          await page.evaluate(([x, y, h]) => window.__serpent.debug().world.snake.reset(x, y, h), [x, y, h]);
          await sleep(450);
          await page.screenshot({ path: path.join(OUT, `24-${id}-${spot}-${name}.png`) });
        }
        if (pass === 0 && id === 'catacombs') {
          // On the Frozen Lake the head turns at half rate; off it, at full.
          const ice = await page.evaluate(async () => {
            const w = window.__serpent.debug().world;
            w.snake.reset(6700, 2200, 0);
            await new Promise((r) => setTimeout(r, 150));
            const on = w.snake.turnMult;
            w.snake.reset(4000, 2000, -Math.PI / 2);
            await new Promise((r) => setTimeout(r, 150));
            return { on, off: w.snake.turnMult };
          });
          check('ice on the Catacombs halves the serpent’s turn rate, and only on the ice', ice.on === 0.5 && ice.off === 1, ice);
        }
        if (pass === 0 && id === 'hollows') {
          // Brambles sting (recorded by name) even with the serpent otherwise untouchable by foes.
          const thorns = await page.evaluate(async () => {
            const w = window.__serpent.debug().world;
            w.invuln = 0;
            const hp = w.hp;
            w.snake.reset(1000, 2300, Math.PI / 2);
            await new Promise((r) => setTimeout(r, 250));
            const out = { lost: Math.round(hp - w.hp), taken: w.recap.taken['wall:bramble'] ?? 0 };
            w.invuln = 1e9;
            w.hp = w.stats.maxHp;
            return out;
          });
          check('brambles in the Hollows sting on touch, and the recap names them', thorns.lost === 5 && thorns.taken === 5, thorns);
        }
        if (lane) {
          deepTimes[`${id}-${name}`] = await page.evaluate(async ([y, x0, x1]) => {
            const w = window.__serpent.debug().world;
            w.snake.reset(x0, y, 0);
            const times = [];
            let last = performance.now();
            await new Promise((done) => {
              const tick = (t) => {
                times.push(t - last);
                last = t;
                w.snake.x += 7;
                w.snake.y = y;
                w.snake.heading = 0;
                if (w.snake.x < x1 && times.length < 1400) requestAnimationFrame(tick);
                else done();
              };
              requestAnimationFrame(tick);
            });
            times.shift();
            times.sort((a, b) => a - b);
            return { frames: times.length, median: +times[Math.floor(times.length / 2)].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1), max: +times[times.length - 1].toFixed(1) };
          }, lane);
        }
        await page.keyboard.press('KeyP');
        await sleep(300);
      }
    }
    check('every deeper map plays its own theme', Object.entries(deepThemes).every(([id, theme]) => theme === id), deepThemes);
    check(
      'every deeper map has a landmark tour, and frame times stay smooth racing across each, in both styles',
      tours.every((t) => t.tour.length >= 3 && t.lane) && Object.values(deepTimes).every((f) => f.p95 < 34 && f.max < 120),
      { maps: tours.map((t) => t.id), deepTimes },
    );
  }

  // ============================================================== Part N: breakables, pickups and buffs
  {
    await page.evaluate(() => window.__serpent.restart());
    await sleep(200);
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.spawnAcc = -1e9;
      w.xp = -1e6;
      w.invuln = 1e9;
    });

    // Run into an urn: approach from the open side, away from the stone it stands by.
    const urn = await page.evaluate(async () => {
      const { nearestSolid } = await import('/src/game/terrain.ts');
      const w = window.__serpent.debug().world;
      const u = w.breakables.find((b) => b.size === 'small' && nearestSolid(w.map.index, b.x, b.y).d > 30);
      const n = nearestSolid(w.map.index, u.x, u.y);
      w.snake.reset(u.x + n.nx * 130, u.y + n.ny * 130, Math.atan2(-n.ny, -n.nx));
      return { x: u.x, y: u.y, smashed: w.recap.breakables, crystals: w.crystals.length };
    });
    await sleep(900);
    const smashed = await page.evaluate((u) => {
      const w = window.__serpent.debug().world;
      return { smashed: w.recap.breakables, xp: w.recap.breakableXp, near: w.crystals.filter((c) => Math.hypot(c.x - u.x, c.y - u.y) < 160).length + w.recap.breakableXp };
    }, urn);
    check('running into an urn smashes it and drops experience crystals', smashed.smashed === urn.smashed + 1 && smashed.xp >= 2 && smashed.xp <= 3, smashed);

    // Break the reliquary at the plaza's west way in with real Bolt strokes.
    const rel = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      const r = w.breakables.find((b) => b.size === 'large' && Math.abs(b.x - 2300) < 5 && Math.abs(b.y - 1800) < 5);
      w.snake.reset(2620, 2000, -Math.PI / 2);
      return r ? { id: r.id, hp: r.hp } : null;
    });
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, '22-reliquary.png') });
    let broken = false;
    let strokes = 0;
    for (let i = 0; i < 8 && !broken; i++) {
      const aim = await page.evaluate((id) => {
        const g = window.__serpent;
        const w = g.debug().world;
        w.cooldowns.bolt = 0;
        // Stay beside it (the serpent never stops moving), so it stays on screen.
        w.snake.reset(2620, 1950, -Math.PI / 2);
        const r = w.breakables.find((b) => b.id === id);
        return r ? g.renderer.worldToScreen(r) : null;
      }, rel?.id);
      if (!aim) {
        broken = true;
        break;
      }
      await stroke(shapes.line(aim.x + 40, aim.y + 25, -2.6, 120), 130);
      strokes++;
      await sleep(350);
    }
    const loot = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      return { pickups: w.pickups.map((p) => p.kind), smashed: w.recap.breakables };
    });
    check('real Bolt strokes break a reliquary, which drops a buff', !!rel && broken && strokes >= 2 && loot.pickups.some((k) => k !== 'heal' && k !== 'bigHeal'), { strokes, ...loot });

    // Collect its buff (made a Quickening here, to measure): the HUD counts it down and cooldowns recover faster.
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      const p = w.pickups.find((k) => k.kind !== 'heal' && k.kind !== 'bigHeal') ?? w.pickups[w.pickups.push({ id: 999998, kind: 'quickening', x: w.snake.x, y: w.snake.y, vx: 0, vy: 0, t: 0, magnet: true }) - 1];
      p.kind = 'quickening';
      p.magnet = true;
    });
    await sleep(1200);
    const chip1 = await page.evaluate(() => document.querySelector('.buff-chip[data-buff="quickening"]')?.textContent ?? null);
    const cd = await page.evaluate(async () => {
      const w = window.__serpent.debug().world;
      w.cooldowns.nova = 6;
      const t0 = w.time;
      await new Promise((r) => setTimeout(r, 1000));
      return { recovered: 6 - w.cooldowns.nova, gameTime: w.time - t0, left: w.buffs.quickening };
    });
    const chip2 = await page.evaluate(() => document.querySelector('.buff-chip[data-buff="quickening"]')?.textContent ?? null);
    check('the buff shows on the HUD counting down, and Quickening makes cooldowns recover 50% faster', /Quickening/.test(chip1 ?? '') && chip1 !== chip2 && Math.abs(cd.recovered / cd.gameTime - 1.5) < 0.1, { chip1, chip2, ...cd });
    await page.screenshot({ path: path.join(OUT, '23-buff-chip.png') });

    const healed = await page.evaluate(async () => {
      const w = window.__serpent.debug().world;
      w.hp = 50;
      w.pickups.push({ id: 999999, kind: 'heal', x: w.snake.x, y: w.snake.y, vx: 0, vy: 0, t: 0, magnet: false });
      await new Promise((r) => setTimeout(r, 300));
      return { hp: w.hp, healed: w.recap.healed, text: w.floaters.map((f) => f.text).find((t) => /health/.test(t)) ?? null };
    });
    check('a health pickup heals the serpent', healed.hp === 70 && healed.healed === 20 && healed.text === '+20 health', healed);
  }

  // ============================================================== Part B: autopilot run
  await page.evaluate(() => window.__serpent.restart());
  await sleep(200);
  // Record exactly what each finished stroke produced (null = stroke was cancelled, e.g. by a level-up).
  await page.evaluate(() => {
    const g = window.__serpent;
    const orig = g['endGesture'].bind(g);
    g['endGesture'] = (pts) => {
      const w = g.debug().world;
      const before = new Set(w.floaters);
      const bolts = w.bolts.length;
      orig(pts);
      const added = w.floaters.filter((f) => f.screen && !before.has(f)).map((f) => f.text);
      window.__lastCast = { text: added[0] ?? '(ignored)', boltsAdded: w.bolts.length - bolts, multibolt: w.upgrades.multibolt, lance: w.evolved.bolt };
    };
  });
  const log = {
    casts: { line: 0, vee: 0, circle: 0 },
    outcomes: {},
    levelUps: [],
    misfires: 0,
    picks: [],
    pickFailures: [],
    boltCountChecks: 0,
    boltCountFailures: [],
    scenes: {},
    spawns: 0,
    spawnsInView: 0,
    pressureSamples: 0,
    nearShare: [],
  };
  const UPGRADE_BY_NAME = {
    'Arcane Potency': 'potency',
    'Split Bolt': 'multibolt',
    'Piercing Bolt': 'pierce',
    'Forked Chains': 'chains',
    'Nova Expanse': 'novaRadius',
    'Quickened Runes': 'haste',
    'Serpent Vitality': 'vitality',
    'Crystal Magnetism': 'magnet',
    'Shed Skin': 'regen',
    'Warding Runes': 'wardRunes',
    'Deep Frost': 'deepFrost',
  };
  const runSnapshot = () =>
    page.evaluate(() => {
      const w = window.__serpent.debug().world;
      return { up: { ...w.upgrades }, stats: { ...w.stats }, hp: w.hp, known: [...w.known], evolved: { ...w.evolved }, aspects: { ...w.aspects }, duos: [...w.duos], over: { ...w.overcharge } };
    });
  const spellOf = { 'Arcane Bolt!': 'line', 'Forked Lightning!': 'vee', 'Arcane Nova!': 'circle', 'Arcane Lance!': 'line', 'Tempest!': 'vee', 'Supernova!': 'circle' };
  const LEARN_BY_NAME = { 'Arcane Ward': 'ward', 'Frost Field': 'frost' };
  const EVOLVE_BY_NAME = { 'Arcane Lance': 'bolt', Tempest: 'lightning', Supernova: 'nova', Aegis: 'ward', Glacier: 'frost' };
  let pickIndex = 0;
  const t0 = Date.now();
  const shots = { levelup: false, busy: false };
  while ((Date.now() - t0) / 1000 < AUTOPILOT_SECONDS) {
    s = await state();
    if (s.phase === 'playing' && !(s.scene in log.scenes)) log.scenes[s.scene] = +s.t.toFixed(1);
    if (s.phase === 'levelup') {
      await setKeys(new Set());
      if (!shots.levelup) {
        await sleep(500);
        await page.screenshot({ path: path.join(OUT, '03-levelup.png') });
        shots.levelup = true;
      }
      log.levelUps.push(+s.t.toFixed(1));
      await sleep(520);
      // Prefer Split Bolt when offered so its visible effect gets exercised; otherwise rotate.
      const names = await page.evaluate(() => [...document.querySelectorAll('.upgrade-card .card-name')].map((n) => n.textContent));
      const kinds = await page.evaluate(() => [...document.querySelectorAll('.upgrade-card')].map((c) => c.dataset.card));
      const split = names.indexOf('Split Bolt');
      const i = split >= 0 ? split : pickIndex++ % names.length;
      const name = names[i];
      log.picks.push(name);
      const before = await runSnapshot();
      await page.keyboard.press(['Digit1', 'Digit2', 'Digit3', 'Digit4'][i]);
      await sleep(80);
      const after = await runSnapshot();
      const card = kinds[i] ?? '';
      // The chosen card must raise exactly its own upgrade and change the derived stats.
      const id = UPGRADE_BY_NAME[name];
      const othersSame = Object.keys(before.up).every((k) => k === id || after.up[k] === before.up[k]);
      const applied = card.startsWith('aspect-')
        ? Object.values(after.aspects).includes(card.slice(7)) && !Object.values(before.aspects).includes(card.slice(7))
        : card.startsWith('duo-')
          ? after.duos.includes(card.slice(4)) && !before.duos.includes(card.slice(4))
          : card.startsWith('over-')
            ? after.over[card.slice(5)] === before.over[card.slice(5)] + 1
            : id
        ? after.up[id] === before.up[id] + 1 && othersSame && JSON.stringify(after.stats) !== JSON.stringify(before.stats)
        : LEARN_BY_NAME[name]
          ? after.known.includes(LEARN_BY_NAME[name]) && !before.known.includes(LEARN_BY_NAME[name])
          : EVOLVE_BY_NAME[name]
            ? after.evolved[EVOLVE_BY_NAME[name]] && !before.evolved[EVOLVE_BY_NAME[name]]
            : after.hp >= before.hp;
      if (!applied) log.pickFailures.push({ name, before: before.up, after: after.up });
      continue;
    }
    if (s.phase === 'dying' || s.phase === 'gameover') break;
    if (s.phase !== 'playing') {
      await sleep(50);
      continue;
    }
    // Steering: keep off stonework, dodge threats, collect crystals, otherwise orbit in the Rune Plaza.
    for (const p of s.fresh) {
      log.spawns++;
      if (p.seen) log.spawnsInView++;
    }
    log.pressureSamples++;
    const nearby = s.enemies.filter((e) => Math.hypot(e.x - s.x, e.y - s.y) < 1.5 * Math.hypot(s.cam.w, s.cam.h)).length;
    if (s.enemies.length > 0) log.nearShare.push(nearby / s.enemies.length);
    let vx = 0;
    let vy = 0;
    const home = { x: 3200, y: 1800 };
    const cx = home.x - s.x;
    const cy = home.y - s.y;
    const cd0 = Math.hypot(cx, cy) || 1;
    vx += (-cy / cd0) * 0.5;
    vy += (cx / cd0) * 0.5;
    if (s.x < home.x - 480) vx += 2;
    if (s.x > home.x + 480) vx -= 2;
    if (s.y < home.y - 330) vy += 2;
    if (s.y > home.y + 330) vy -= 2;
    if (s.ahead.d < 110) {
      const k = (1 - Math.max(0, s.ahead.d) / 110) * 3;
      vx += s.ahead.nx * k;
      vy += s.ahead.ny * k;
    }
    for (const e of s.enemies) {
      const d = Math.hypot(e.x - s.x, e.y - s.y);
      const danger = e.kind === 'chaser' ? 170 : 230;
      if (d < danger) {
        const k = (1 - d / danger) * (e.state === 'windup' || e.state === 'attack' ? 3 : 1.6);
        vx -= ((e.x - s.x) / d) * k;
        vy -= ((e.y - s.y) / d) * k;
      }
    }
    for (const p of s.shots) {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      if (Math.hypot(dx, dy) < 220 && dx * p.vx + dy * p.vy < 0) {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const side = Math.sign(-dx * p.vy + dy * p.vx) || 1;
        vx += (-p.vy / sp) * side * 1.5;
        vy += (p.vx / sp) * side * 1.5;
      }
    }
    let best = null;
    let bd = 380;
    for (const c of s.crystals) {
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) {
      vx += ((best.x - s.x) / bd) * 0.9;
      vy += ((best.y - s.y) / bd) * 0.9;
    }
    const want = new Set();
    const vl = Math.hypot(vx, vy) || 1;
    if (vx / vl > 0.38) want.add('KeyD');
    if (vx / vl < -0.38) want.add('KeyA');
    if (vy / vl > 0.38) want.add('KeyS');
    if (vy / vl < -0.38) want.add('KeyW');
    await setKeys(want);

    // Casting with the real mouse; steering keys stay held during each stroke.
    const near = s.enemies
      .map((e) => ({ ...e, d: Math.hypot(e.x - s.x, e.y - s.y) }))
      .filter((e) => e.s.y > 110 && e.s.y < 600 && e.s.x > 30 && e.s.x < 1150)
      .sort((a, b) => a.d - b.d)[0];
    let intent = null;
    if (s.cd.nova <= 0 && near && near.d < 170) intent = 'circle';
    else if (s.cd.lightning <= 0 && near && near.d < 520) intent = 'vee';
    else if (s.cd.bolt <= 0 && near) intent = 'line';
    if (!intent) {
      await sleep(40);
      continue;
    }
    log.casts[intent]++;
    await page.evaluate(() => (window.__lastCast = null));
    if (intent === 'circle') await stroke(shapes.circle(140, 600, 38, rand() < 0.5 ? 1 : -1), 220);
    else if (intent === 'vee') await stroke(shapes.vee(near.s.x, near.s.y, 0.85), 240);
    else await stroke(shapes.line(near.s.x, near.s.y, -0.3, 110), 130);
    const cast = await page.evaluate(() => window.__lastCast);
    const t = cast ? cast.text : '(cancelled)';
    const label = spellOf[t] ? (spellOf[t] === intent ? 'ok' : `MISFIRE as ${spellOf[t]}`) : t.includes('recharging') ? 'recharging' : t;
    log.outcomes[`${intent}:${label}`] = (log.outcomes[`${intent}:${label}`] ?? 0) + 1;
    if (spellOf[t] && spellOf[t] !== intent) log.misfires++;
    if (cast && t === 'Arcane Bolt!' && !cast.lance) {
      // Split Bolt must visibly add projectiles: each cast fires 1 + level bolts.
      log.boltCountChecks++;
      if (cast.boltsAdded !== 1 + cast.multibolt) log.boltCountFailures.push(cast);
    }
    if (!shots.busy && s.enemies.length >= 12) {
      await page.screenshot({ path: path.join(OUT, '04-busy-combat.png') });
      shots.busy = true;
    }
  }
  await setKeys(new Set());
  s = await state();
  log.end = { phase: s.phase, t: +s.t.toFixed(1), level: s.level, kills: s.kills, segs: s.segs, upgrades: s.upgrades };
  console.log('AUTOPILOT', JSON.stringify(log));
  const firstLevel = log.levelUps[0];
  // On the big map foes die at range and their crystals wait where they fell until the serpent
  // passes, so the first level comes later than in the old one-screen arena: 20-40 s here, and a
  // median of 44 s for the balance bot (which never goes for crystals) over 20 seeds.
  check('autopilot: first level-up within 15-45 s', firstLevel !== undefined && firstLevel >= 15 && firstLevel <= 45, { firstLevel });
  check('autopilot: level-ups resume play', log.levelUps.length >= 2 && s.phase !== 'levelup', { levelUps: log.levelUps.length });
  check('autopilot: no stroke cast the wrong spell', log.misfires === 0, { outcomes: log.outcomes });
  check('autopilot: snake grew with levels', s.segs > 6, { segs: s.segs, level: s.level });
  check('autopilot: every level-up pick applied exactly its upgrade', log.picks.length >= 2 && log.pickFailures.length === 0, {
    picks: log.picks,
    failures: log.pickFailures,
  });
  check('autopilot: every bolt cast fired 1 + Split Bolt level projectiles', log.boltCountChecks > 20 && log.boltCountFailures.length === 0, {
    checked: log.boltCountChecks,
    failures: log.boltCountFailures.slice(0, 3),
  });
  const climbed = log.scenes.run1 ?? log.scenes.run2;
  check('autopilot: music adds layers as the arena fills', log.scenes.run0 !== undefined && climbed !== undefined && climbed > log.scenes.run0, {
    scenes: log.scenes,
  });
  check('autopilot: foes spawn just outside the view, never on screen', log.spawns > 20 && log.spawnsInView === 0, { spawns: log.spawns, inView: log.spawnsInView });
  const xpShare = await page.evaluate(async () => {
    const { xpToNext } = await import('/src/game/progression.ts');
    const w = window.__serpent.debug().world;
    let earned = Math.max(0, w.xp);
    for (let l = 1; l < w.level; l++) earned += xpToNext(l);
    return { fromBreakables: w.recap.breakableXp, earned: Math.round(earned), smashed: w.recap.breakables, share: earned > 0 ? +(w.recap.breakableXp / earned).toFixed(3) : 0 };
  });
  check('autopilot: breakables are a side source of XP (at most 15%)', xpShare.share <= 0.15, xpShare);
  const nearShare = log.nearShare.reduce((a, b) => a + b, 0) / Math.max(1, log.nearShare.length);
  check('autopilot: the fight stays around the serpent (foes within 1.5 views of it)', nearShare > 0.9, { share: +nearShare.toFixed(2), samples: log.nearShare.length });

  // ============================================================== Death, reward, restart, persistence
  // If the autopilot outlived its time, let the run end: keep taking level-up cards, and after
  // 30 s leave the serpent on 1 health so the next real hit kills it.
  for (let i = 0; i < 160; i++) {
    const phase = (await state()).phase;
    if (phase === 'gameover') break;
    if (phase === 'levelup') {
      await sleep(520);
      await page.keyboard.press('Digit1');
    }
    if (i === 60) await page.evaluate(() => (window.__serpent.debug().world.hp = 1));
    await sleep(500);
  }
  s = await state();
  const overText = await page.evaluate(() => document.querySelector('.overlay-inner')?.innerText.replace(/\n+/g, ' | '));
  const sv1 = await readSave();
  await page.screenshot({ path: path.join(OUT, '05-gameover.png') });
  check('death leads to the game-over screen with stats', s.phase === 'gameover' && /Run Over/.test(overText ?? ''), { overText });
  {
    const recap = await page.evaluate(() => {
      const r = window.__serpent.debug().world.recap;
      return {
        killedBy: r.killedBy,
        cause: document.querySelector('.recap-cause')?.textContent ?? '',
        shown: ['bolt', 'lightning', 'nova'].map((id) => document.querySelector(`.recap-row[data-source="${id}"] .recap-num`)?.textContent),
        expected: ['bolt', 'lightning', 'nova'].map((id) => Math.round(r.spells[id].damage).toLocaleString()),
        quality: document.querySelector('.recap')?.textContent.match(/Sigils: [^·]+· [^·]+?of \d+/)?.[0] ?? null,
        casts: ['bolt', 'lightning', 'nova'].map((id) => r.spells[id].casts),
      };
    });
    check('game-over recap names the killing blow and shows each spell’s damage', !!recap.killedBy && /^Slain by /.test(recap.cause) &&
      recap.shown.join() === recap.expected.join() && recap.casts.every((c) => c > 0) && !!recap.quality, recap);
    const calm = await audioState();
    check('music settles to the calm arrangement of the map on the game-over screen', calm.scene === 'calm' && calm.theme === calm.map, calm);
  }
  check('reward banked exactly once', sv1?.records.totalRuns === 1 && Number(/\+(\d+)/.exec(overText ?? '')?.[1]) === sv1?.currency, {
    currency: sv1?.currency,
    runs: sv1?.records.totalRuns,
  });
  await sleep(3000);
  const sv1b = await readSave();
  check('no second payout appears later', sv1b.currency === sv1.currency && sv1b.records.totalRuns === 1, { currency: sv1b.currency });
  await page.keyboard.press('KeyR');
  await sleep(500);
  s = await state();
  check('R restarts instantly with run upgrades cleared', s.phase === 'playing' && s.level === 1 && s.t < 1 && Object.values(s.upgrades).every((v) => v === 0), {
    level: s.level,
  });
  await page.keyboard.press('Escape');
  await sleep(100);
  await clickButton('End run');
  await sleep(800);
  await clickButton('Title');
  await sleep(300);
  const sv2 = await readSave();
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);
  const titleShards = await page.evaluate(() => document.querySelector('.shards')?.textContent);
  check('currency and records survive a reload', parseInt(titleShards ?? '', 10) === sv2.currency && sv2.records.totalRuns === 2, {
    titleShards,
    runs: sv2.records.totalRuns,
  });

  // ============================================================== Part C: shop
  await clickButton('Permanent Upgrades');
  await sleep(300);
  const shopBefore = await readSave();
  const bought = await clickButton('Learn ·');
  await sleep(150);
  const shopAfter = await readSave();
  check('one real click buys exactly one rank', bought && metaSum(shopAfter.meta) === metaSum(shopBefore.meta) + 1 && shopAfter.currency < shopBefore.currency, {
    before: shopBefore.meta,
    after: shopAfter.meta,
  });
  await page.screenshot({ path: path.join(OUT, '06-shop.png') });
  for (let i = 0; i < 48; i++) {
    await page.keyboard.press(['Enter', 'Space', 'Digit1', 'Digit2', 'Digit3', 'KeyR'][i % 6]);
    await sleep(15);
  }
  const fuzzed = await readSave();
  check('48 key presses in the shop buy nothing', JSON.stringify(fuzzed.meta) === JSON.stringify(shopAfter.meta) && fuzzed.currency === shopAfter.currency, {
    meta: fuzzed.meta,
  });
  await page.reload({ waitUntil: 'networkidle0' });
  check('purchase persists across reload', JSON.stringify((await readSave()).meta) === JSON.stringify(shopAfter.meta));
  await page.keyboard.press('Enter');
  await sleep(500);
  const stats = await page.evaluate(() => window.__serpent.debug().world.stats);
  check('permanent upgrade applies to the next run', stats.maxHp > 100 || stats.damageMult > 1 || stats.pickupRadius > 110 || stats.xpMult > 1, {
    maxHp: stats.maxHp,
  });

  // ============================================================== Part E: wizard and curse setup
  {
    await page.evaluate((k) => {
      const sv = JSON.parse(localStorage.getItem(k));
      sv.records.bestTime = Math.max(sv.records.bestTime, 200);
      // As if a run had reached the Hollows (the atlas reveals what's been reached).
      sv.records.maps = ['ruins', 'hollows'];
      sv.records.breakables = Math.max(sv.records.breakables, 12);
      localStorage.setItem(k, JSON.stringify(sv));
    }, SAVE_KEY);
    await page.reload({ waitUntil: 'networkidle0' });
    await clickButton('Wizard');
    await sleep(300);
    const atlas = await page.evaluate(() =>
      [...document.querySelectorAll('.atlas-card')].map((c) => {
        const canvas = c.querySelector('canvas');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let light = 0;
        for (let i = 0; i < data.length; i += 4) light += (data[i] + data[i + 1] + data[i + 2]) / 3;
        return { map: c.dataset.map, name: c.querySelector('.atlas-name')?.textContent, unknown: c.classList.contains('unknown'), size: [canvas.width, canvas.height], light: Math.round(light / (data.length / 4)) };
      }),
    );
    check(
      'the setup screen’s atlas shows the four maps in order, the ones not yet reached as dark silhouettes',
      atlas.map((a) => a.map).join() === 'ruins,hollows,catacombs,ember' &&
        atlas.filter((a) => !a.unknown).map((a) => a.name).join() === 'Sunken Ruins,Mycelium Hollows' &&
        atlas.filter((a) => a.unknown).every((a) => a.name === 'Undiscovered') &&
        atlas.every((a) => a.size[0] > 100 && a.size[1] > 50) &&
        Math.min(...atlas.filter((a) => !a.unknown).map((a) => a.light)) > Math.max(...atlas.filter((a) => a.unknown).map((a) => a.light)),
      { atlas },
    );
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('.wizard-card')].map((c) => ({ name: c.querySelector('.wizard-name')?.textContent, locked: c.disabled })),
    );
    check('the setup screen locks wizards until their records are met', cards.find((c) => c.name === 'Frostcoil')?.locked === false && cards.find((c) => c.name === 'Stormtongue')?.locked === true, { cards });
    const pickCard = await page.evaluateHandle(() => [...document.querySelectorAll('.wizard-card')].find((c) => c.textContent.includes('Frostcoil')));
    await pickCard.asElement().click();
    const curse = await page.evaluateHandle(() => [...document.querySelectorAll('.curse')].find((c) => c.textContent.includes('Glass Scales')));
    await curse.asElement().click();
    await sleep(150);
    await page.screenshot({ path: path.join(OUT, '13-setup.png') });
    const chosen = (await readSave()).settings;
    check('picking a wizard and a curse with real clicks saves them', chosen.wizard === 'frostcoil' && chosen.curses.join() === 'glass', { wizard: chosen.wizard, curses: chosen.curses });
    await page.keyboard.press('Enter');
    await sleep(600);
    const run = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      return { wizard: w.wizard, known: [...w.known], maxHp: w.stats.maxHp, curses: [...w.curses] };
    });
    check('the run starts as Frostcoil with Frost Field and the curse applied', run.wizard === 'frostcoil' && run.known.includes('frost') && !run.known.includes('lightning') && run.maxHp < 100, run);
    await page.screenshot({ path: path.join(OUT, '14-frostcoil-run.png') });
    const before = (await readSave()).currency;
    await sleep(2500);
    await page.keyboard.press('Escape');
    await sleep(150);
    await clickButton('End run');
    await sleep(900);
    const over = await page.evaluate(() => document.querySelector('.overlay-inner')?.innerText.replace(/\n+/g, ' | '));
    const gained = Number(/\+(\d+)/.exec(over ?? '')?.[1]);
    const after = (await readSave()).currency;
    check('the curse multiplies the shards the run banks', /×1\.30 from curses/.test(over ?? '') && after - before === gained, { over, before, after });
    await clickButton('Title');
    await sleep(300);
  }

  // ============================================================== Part H: gameplay depth
  {
    // Shards to spend, the Catacombs reached and heat unlocked, as if after many runs.
    await page.evaluate((k) => {
      const sv = JSON.parse(localStorage.getItem(k));
      sv.currency = 5000;
      sv.records.maps = ['ruins', 'hollows', 'catacombs'];
      sv.records.heatUnlocked = 2;
      sv.settings.wizard = 'arcanist';
      sv.settings.curses = [];
      localStorage.setItem(k, JSON.stringify(sv));
    }, SAVE_KEY);
    await page.reload({ waitUntil: 'networkidle0' });

    // The Grimoire, with real clicks.
    await clickButton('Permanent Upgrades');
    await sleep(250);
    await page.click('[data-tab="grimoire"]');
    await sleep(200);
    for (const id of ['relic:echoStone', 'way:catacombs', 'reroll1']) {
      await page.click(`[data-unlock="${id}"] button`);
      await sleep(150);
    }
    await page.screenshot({ path: path.join(OUT, '17-grimoire.png') });
    const g = await readSave();
    const echo = await page.$eval('[data-unlock="relic:echoStone"] button', (b) => ({ text: b.textContent, disabled: b.disabled }));
    check(
      'the Grimoire sells unlocks with real clicks, each once, for its price',
      g.grimoire.join() === 'relic:echoStone,way:catacombs,reroll1' && g.currency === 5000 - 250 - 450 - 120 && echo.text === 'Learned' && echo.disabled,
      { grimoire: g.grimoire, currency: g.currency, echo },
    );
    await page.keyboard.press('Escape');
    await sleep(250);

    // Setup: heat only as high as unlocked, and the Catacombs as the start.
    await clickButton('Wizard');
    await sleep(250);
    for (let i = 0; i < 3; i++) {
      const more = await page.$('[aria-label="More heat"]:not([disabled])');
      if (more) await more.click();
      await sleep(80);
    }
    await page.click('[data-start="catacombs"]');
    await sleep(150);
    const set = (await readSave()).settings;
    const heatShown = await page.$eval('.heat-level', (n) => n.textContent);
    const ultLine = await page.evaluate(() => [...document.querySelectorAll('.wizard-ult')].map((n) => n.textContent));
    check('heat rises only as far as unlocked, and a waystone picks the start; both are saved', set.heat === 2 && heatShown === '2' && set.startMap === 'catacombs', { heat: set.heat, heatShown, startMap: set.startMap });
    await sleep(700);
    const menuMusic = await audioState();
    check('the menu music follows the start map: the Catacombs’ calm arrangement', menuMusic.theme === 'catacombs' && menuMusic.scene === 'calm', menuMusic);
    // The atlas plays a reached map's music with a real click, and stops back to the start map's.
    const themeLine = await page.$eval('.atlas-card[data-map="hollows"] .atlas-theme', (n) => n.textContent.trim());
    await page.click('[data-listen="hollows"]');
    await sleep(800);
    const listen = await audioState();
    const listenLabel = await page.$eval('[data-listen="hollows"]', (b) => b.textContent);
    await page.click('[data-listen="hollows"]');
    await sleep(800);
    const listenOff = await audioState();
    const unknownListen = await page.$('[data-listen="ember"]');
    check(
      'the atlas names each reached map’s theme and plays it with Listen, then Stop returns to the start map’s',
      /Glowcap Hollow/.test(themeLine) && listen.theme === 'hollows' && listen.scene === 'run2' && listenLabel === 'Stop' && listenOff.theme === 'catacombs' && listenOff.scene === 'calm' && !unknownListen,
      { themeLine, listen, listenLabel, listenOff, unknownListen: !!unknownListen },
    );
    check('each unlocked wizard card names its ultimate', ultLine.some((t) => /Starfall/.test(t)) && ultLine.some((t) => /Absolute Zero/.test(t)), { ultLine });
    await page.screenshot({ path: path.join(OUT, '18-setup-heat.png') });
    await page.keyboard.press('Enter');
    await sleep(800);

    // A waystone start catches up: a relic for each map skipped (the Catacombs' own first), then a draft.
    const relic1 = await page.evaluate(() => ({
      phase: window.__serpent.getPhase(),
      relics: [...document.querySelectorAll('.upgrade-card.relic')].map((c) => c.dataset.relic),
      eyebrow: document.querySelector('.relic-offer .eyebrow')?.textContent,
    }));
    check('a waystone start offers a relic for each map skipped, the Catacombs’ own first', relic1.phase === 'relic' && relic1.relics.length === 3 && relic1.relics[0] === 'rimewalker' && /relic 1 of 2/.test(relic1.eyebrow ?? ''), relic1);
    await page.click('.upgrade-card.relic[data-relic="rimewalker"]');
    await sleep(800);
    await page.keyboard.press('Digit1');
    await sleep(800);
    const offerIds = () => page.evaluate(() => [...document.querySelectorAll('.levelup .upgrade-card')].map((c) => c.dataset.card));
    const tools = () =>
      page.evaluate(() => {
        const w = window.__serpent.debug().world;
        return { phase: window.__serpent.getPhase(), rerolls: w.rerolls, banishes: w.banishes, banished: [...w.banished], relics: [...w.relics], hp: w.hp, eyebrow: document.querySelector('.levelup .eyebrow')?.textContent };
      });
    const d0 = await tools();
    check('then it drafts the level-ups through the usual panel', d0.phase === 'levelup' && /Waystone draft · 1 of 24/.test(d0.eyebrow ?? '') && d0.relics.length === 2 && d0.relics[0] === 'rimewalker', d0);
    await page.screenshot({ path: path.join(OUT, '19-draft.png') });

    // Reroll, banish and skip on a real offer.
    const c0 = await offerIds();
    await page.click('[data-tool="reroll"]');
    await sleep(550);
    const c1 = await offerIds();
    const d1 = await tools();
    check('Reroll draws a fresh offer and spends one of three rerolls', d1.rerolls === d0.rerolls - 1 && d0.rerolls === 3 && c1.length === 3 && c1.join() !== c0.join(), { c0, c1, rerolls: [d0.rerolls, d1.rerolls] });
    await page.click('[data-tool="banish"]');
    await sleep(80);
    const gone = c1[1];
    await page.click(`.levelup .upgrade-card[data-card="${gone}"]`);
    await sleep(550);
    const c2 = await offerIds();
    const d2 = await tools();
    check('Banish takes a card out of the run and puts a new one in its place', d2.banishes === d1.banishes - 1 && d2.banished.includes(gone) && !c2.includes(gone) && c2[0] === c1[0] && c2.length === 3, { gone, c1, c2, banished: d2.banished });
    await page.evaluate(() => (window.__serpent.debug().world.hp = 40));
    await page.keyboard.press('KeyX');
    await sleep(550);
    const d3 = await tools();
    check('Skip takes no card, heals a little, and moves on to the next draft pick', d3.hp > 40 && /2 of 24/.test(d3.eyebrow ?? ''), { hp: d3.hp, eyebrow: d3.eyebrow });
    await page.click('[data-tool="auto"]');
    await sleep(500);
    const run = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      return { phase: window.__serpent.getPhase(), map: w.map.def.id, depth: w.depth, level: w.level, heat: w.heat, time: w.time, picked: Object.values(w.upgrades).reduce((a, b) => a + b, 0) + w.known.length - 3 + Object.keys(w.aspects).length };
    });
    check('Auto-pick finishes the draft: play starts in the Catacombs at level 25 and heat 2', run.phase === 'playing' && run.map === 'catacombs' && run.depth === 3 && run.level === 25 && run.heat === 2 && run.time < 1 && run.picked >= 15, run);
    const startMusic = await audioState();
    check('a waystone start plays the Catacombs’ theme from the first step', startMusic.theme === 'catacombs' && /^run/.test(startMusic.scene), startMusic);

    // The ultimate, from the real Space key, into a crowd.
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.ult.cooldown = 0;
      w.invuln = 30;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        w.portals.push({ x: w.snake.x + Math.cos(a) * 260, y: w.snake.y + Math.sin(a) * 200, kind: 'brute', t: 0, duration: 0.01 });
      }
    });
    await sleep(300);
    await page.keyboard.press('Space');
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, '20-starfall.png') });
    const u1 = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      return { active: w.ult.active, casts: w.recap.spells.ultimate.casts, stars: w.stars.length + (36 - w.ult.left), hud: document.querySelector('.ult-card .ult-state')?.textContent };
    });
    check('Space casts the ultimate: Starfall rains on the crowd and the HUD card says so', u1.active > 0 && u1.casts === 1 && u1.stars > 5 && /Unleashed/.test(u1.hud ?? ''), u1);
    await sleep(3000);
    const u2 = await page.evaluate(async () => {
      const { ultimateCooldown } = await import('/src/game/ultimates.ts');
      const w = window.__serpent.debug().world;
      return { damage: Math.round(w.recap.spells.ultimate.damage), cooldown: w.ult.cooldown, full: ultimateCooldown(w), hud: document.querySelector('.ult-card .ult-state')?.textContent };
    });
    await page.keyboard.press('Space');
    await sleep(100);
    const denied = await page.evaluate(() => window.__serpent.debug().world.floaters.map((f) => f.text).filter((t) => /recharging/.test(t)));
    // The drafted build may have Quickened Runes, which shortens the cooldown (to no less than 45 s).
    check('Starfall hurts the foes, then the ultimate recharges and says so when pressed early', u2.damage > 500 && u2.full >= 45 && u2.cooldown > u2.full - 6 && /^\d+s$/.test(u2.hud ?? '') && denied.some((t) => /Starfall recharging/.test(t)), { ...u2, denied });
    await page.evaluate(() => (window.__serpent.debug().world.ult.cooldown = 0));
    await sleep(250);
    await page.click('.ult-card');
    await sleep(150);
    const clicked = await page.evaluate(() => window.__serpent.debug().world.recap.spells.ultimate.casts);
    check('clicking the HUD card casts the ultimate too', clicked === 2, { casts: clicked });
    await page.keyboard.press('Escape');
    await sleep(150);
    const pauseRelics = await page.evaluate(() => [...document.querySelectorAll('.relic-list li')].map((l) => l.dataset.relic));
    check('the pause menu lists the relics carried', pauseRelics.length === 2 && pauseRelics[0] === 'rimewalker', { pauseRelics });
    await clickButton('End run');
    await sleep(900);
    const recap = await page.evaluate(() => ({
      ult: document.querySelector('.recap-row[data-source="ultimate"] .recap-name')?.textContent ?? null,
      relics: document.querySelectorAll('.recap-relics .relic-icon').length,
      shards: document.querySelector('.reward-total')?.textContent ?? '',
    }));
    check('the recap gives the ultimate its own row, shows the relics carried and the heat bonus', /Starfall/.test(recap.ult ?? '') && recap.relics === 2 && /×1\.30 from heat 2/.test(recap.shards), recap);
    await page.screenshot({ path: path.join(OUT, '21-depth-recap.png') });
    // Back to a plain first-map start for the parts after this.
    await page.evaluate((k) => {
      const sv = JSON.parse(localStorage.getItem(k));
      sv.settings.startMap = 'ruins';
      sv.settings.heat = 0;
      localStorage.setItem(k, JSON.stringify(sv));
    }, SAVE_KEY);
    await page.reload({ waitUntil: 'networkidle0' });
  }

  // ============================================================== Part F: options
  {
    await clickButton('Options');
    await sleep(250);
    await clickButton('Reduce flashing');
    await clickButton('Colorblind-safe warnings');
    const slide = async (label, presses) => {
      const el = await page.$(`input[aria-label="${label}"]`);
      await el.focus();
      for (let i = 0; i < presses; i++) await page.keyboard.press('ArrowLeft');
    };
    await slide('Game speed', 5);
    await slide('Screen shake', 10);
    // Rebind Steer up to I, then take D for its second key (D leaves Steer right).
    await page.click('.key-btn[data-action="up"][data-slot="0"]');
    const waiting = await page.$eval('.key-btn[data-action="up"][data-slot="0"]', (b) => b.textContent);
    await page.keyboard.press('KeyI');
    await page.click('.key-btn[data-action="up"][data-slot="1"]');
    await page.keyboard.press('KeyD');
    await sleep(60);
    const note = await page.$eval('.key-note', (n) => n.textContent);
    // Esc while a key button waits only cancels the wait.
    await page.click('.key-btn[data-action="mute"][data-slot="1"]');
    await page.keyboard.press('Escape');
    await sleep(60);
    const stillOptions = !!(await page.$('.screen.options'));
    const set = (await readSave()).settings;
    check(
      'options set with real clicks and keys are saved',
      set.reduceFlashing && set.safeWarnings && set.gameSpeed === 0.5 && set.shake === 0 && set.bindings.up.join() === 'KeyI,KeyD' && set.bindings.right[0] === null,
      { reduceFlashing: set.reduceFlashing, safeWarnings: set.safeWarnings, gameSpeed: set.gameSpeed, shake: set.shake, up: set.bindings.up, right: set.bindings.right },
    );
    check('a key taken from another action says so, and Esc only cancels a rebind', waiting === 'Press a key…' && /Steer right lost it/.test(note) && stillOptions, { waiting, note, stillOptions });
    await page.screenshot({ path: path.join(OUT, '16-options.png') });
    await page.click('.key-btn[data-action="right"][data-slot="0"]');
    await page.keyboard.press('KeyD');
    await page.click('.key-btn[data-action="up"][data-slot="1"]');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Escape');
    await sleep(200);
    check('Esc leaves the options screen', !!(await page.$('.title-screen')));

    await page.keyboard.press('Enter');
    await sleep(600);
    const view = await page.evaluate(() => {
      const v = window.__serpent.renderer.view;
      return { shake: v.shake, reduceFlashing: v.reduceFlashing, safeWarnings: v.safeWarnings, gameSpeed: v.gameSpeed };
    });
    check('the run uses the saved options', view.shake === 0 && view.reduceFlashing && view.safeWarnings && view.gameSpeed === 0.5, view);
    const clear = () =>
      page.evaluate(() => {
        const w = window.__serpent.debug().world;
        w.invuln = 1e9;
        w.xp = -1e6;
        w.spawnAcc = -1e9;
        w.enemies.length = 0;
        w.portals.length = 0;
        w.shots.length = 0;
        w.snake.x = 640;
        w.snake.y = 420;
        w.snake.heading = 0;
      });
    await clear();
    await setKeys(new Set(['KeyI']));
    await sleep(700);
    await setKeys(new Set());
    const headingI = (await state()).heading;
    await clear();
    await setKeys(new Set(['KeyW']));
    await sleep(700);
    await setKeys(new Set());
    const headingW = (await state()).heading;
    check('steering follows the new key, and the old one no longer steers', angDiff(headingI, -Math.PI / 2) < 0.6 && angDiff(headingW, 0) < 0.05, {
      headingI: +headingI.toFixed(2),
      headingW: +headingW.toFixed(2),
    });
    {
      const a = await state();
      const t0 = Date.now();
      await sleep(1500);
      const b = await state();
      const ratio = (b.t - a.t) / ((Date.now() - t0) / 1000);
      check('at 50% game speed the run advances half as fast', Math.abs(ratio - 0.5) < 0.08, { ratio: +ratio.toFixed(2) });
    }

    // Pixels on the canvas: a struck brute, and a brute winding up a charge, with time frozen.
    const freezeFoes = async (setup) => {
      await clear();
      await page.evaluate(() => {
        const w = window.__serpent.debug().world;
        w.portals.push({ x: 380, y: 300, kind: 'brute', t: 0, duration: 0.01 });
      });
      await sleep(250);
      return page.evaluate((setup) => {
        const g = window.__serpent;
        const w = g.debug().world;
        const b = w.enemies.find((e) => e.kind === 'brute');
        b.attackTimer = 1e9;
        b.speed = 0;
        b.elite = null;
        b.heading = 0;
        if (setup === 'struck') {
          b.state = 'move';
          b.flash = 5;
        } else {
          b.state = 'windup';
          b.stateTime = 0.6;
          b.aim = 0;
        }
        w.hitStop = 1e9;
        return { x: b.x, y: b.y, r: b.r };
      }, setup);
    };
    const countPixels = (box, kind) =>
      page.evaluate(
        (box, kind) => {
          const g = window.__serpent;
          const c = document.querySelector('.game-canvas');
          const dpr = c.width / c.clientWidth;
          const a = g.renderer.worldToScreen({ x: box.x0, y: box.y0 });
          const b = g.renderer.worldToScreen({ x: box.x1, y: box.y1 });
          const x = Math.round(a.x * dpr);
          const y = Math.round(a.y * dpr);
          const data = c.getContext('2d').getImageData(x, y, Math.round((b.x - a.x) * dpr), Math.round((b.y - a.y) * dpr)).data;
          let n = 0;
          for (let i = 0; i < data.length; i += 4) {
            const [r, gr, bl] = [data[i], data[i + 1], data[i + 2]];
            if (kind === 'white' ? r > 235 && gr > 235 && bl > 235 : r > 200 && gr > 160 && bl < 90) n++;
          }
          return n;
        },
        box,
        kind,
      );
    const setView = (patch) => page.evaluate((patch) => (window.__serpent.renderer.view = { ...window.__serpent.renderer.view, ...patch }), patch);
    const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    let b = await freezeFoes('struck');
    const body = { x0: b.x - b.r, y0: b.y - b.r, x1: b.x + b.r, y1: b.y + b.r };
    await frame();
    const quietWhite = await countPixels(body, 'white');
    await setView({ reduceFlashing: false });
    await frame();
    const flashWhite = await countPixels(body, 'white');
    await setView({ reduceFlashing: true });
    check('with reduced flashing a struck foe keeps its colours instead of flashing white', flashWhite > 40 && quietWhite < flashWhite / 4, { flashWhite, quietWhite });

    await page.evaluate(() => (window.__serpent.debug().world.hitStop = 0));
    b = await freezeFoes('windup');
    const lane = { x0: b.x + b.r + 10, y0: b.y - b.r * 0.8, x1: b.x + b.r + 140, y1: b.y + b.r * 0.8 };
    await frame();
    const safeYellow = await countPixels(lane, 'yellow');
    await page.screenshot({ path: path.join(OUT, '17-safe-warnings.png') });
    await setView({ safeWarnings: false });
    await frame();
    const redYellow = await countPixels(lane, 'yellow');
    await setView({ safeWarnings: true });
    check('colorblind-safe warnings paint the charge lane in hazard yellow', safeYellow > 200 && redYellow < 20, { safeYellow, standard: redYellow });

    // A vent's circle (a burst hazard) is warned the same way.
    const vent = await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      const at = { x: w.camera.x - 380, y: w.camera.y + 180 };
      w.blasts.push({ ...at, r: 90, t: 0.8, delay: 1, damage: 0, hitsFoes: false, source: { kind: 'hazard', attack: 'vent' }, after: null, look: 'vent', from: null });
      return at;
    });
    const ventBox = { x0: vent.x - 45, y0: vent.y - 45, x1: vent.x + 45, y1: vent.y + 45 };
    await frame();
    const ventSafe = await countPixels(ventBox, 'yellow');
    await setView({ safeWarnings: false });
    await frame();
    const ventStandard = await countPixels(ventBox, 'yellow');
    await setView({ safeWarnings: true });
    await page.evaluate(() => (window.__serpent.debug().world.blasts.length = 0));
    check('colorblind-safe warnings stripe a vent’s circle in hazard yellow too', ventSafe > 200 && ventStandard < 20, { ventSafe, standard: ventStandard });

    // Esc in the pause menu's options steps back to the pause menu, then resumes.
    await page.evaluate(() => (window.__serpent.debug().world.hitStop = 0));
    await page.keyboard.press('Escape');
    await sleep(150);
    await clickButton('Options');
    await sleep(150);
    const inOverlay = !!(await page.$('.options-overlay'));
    await page.keyboard.press('Escape');
    await sleep(150);
    const back = await state();
    await page.keyboard.press('Escape');
    await sleep(150);
    const resumed = await state();
    check('Esc in the pause menu options goes back to the pause menu, then resumes', inOverlay && back.overlay === 'Paused' && back.phase === 'paused' && resumed.phase === 'playing', {
      inOverlay,
      back: back.overlay,
      resumed: resumed.phase,
    });
    await page.keyboard.press('Escape');
    await sleep(150);
    await clickButton('End run');
    await sleep(900);
    const over = await page.evaluate(() => document.querySelector('.reward-total')?.textContent ?? '');
    check('the run summary says it was played at 50% speed', /played at 50% speed/.test(over), { over });
    await clickButton('Title');
    await sleep(300);
  }

  // ============================================================== Part G: sigil practice room
  {
    await clickButton('Practice Sigils');
    await sleep(300);
    const pad = await page.$eval('.practice-canvas', (c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const at = (u, v) => ({ x: pad.x + pad.w * u, y: pad.y + pad.h * v });
    const along = (corners, per) => {
      const out = [];
      for (let i = 1; i < corners.length; i++)
        for (let k = 0; k < per; k++)
          out.push({ x: corners[i - 1].x + ((corners[i].x - corners[i - 1].x) * k) / per, y: corners[i - 1].y + ((corners[i].y - corners[i - 1].y) * k) / per });
      out.push(corners[corners.length - 1]);
      return out;
    };
    const verdict = () =>
      page.evaluate(() => ({
        head: document.querySelector('.verdict-head')?.textContent ?? null,
        detail: document.querySelector('.verdict-detail')?.textContent ?? null,
        tier: document.querySelector('.tier-chip')?.textContent ?? null,
        scores: Object.fromEntries([...document.querySelectorAll('.shape-row')].map((r) => [r.dataset.kind, r.querySelector('.shape-score').textContent])),
        history: document.querySelector('.history-sum')?.textContent ?? null,
      }));
    let live = null;
    await stroke(along([at(0.3, 0.2), at(0.45, 0.75), at(0.6, 0.2)], 14), 600, async () => {
      await sleep(120);
      live = (await verdict()).head;
    });
    await sleep(150);
    const vee = await verdict();
    check('practice: the live reading shows while drawing, then the V reads as Forked Lightning with a grade', /^Reading: /.test(live ?? '') && vee.head === 'V: Forked Lightning' && !!vee.tier && vee.scores.vee !== '✗' && vee.scores.circle === '✗', {
      live,
      head: vee.head,
      tier: vee.tier,
      scores: vee.scores,
    });
    await page.screenshot({ path: path.join(OUT, '18-practice-vee.png') });
    await clickButton('Triangle');
    await sleep(100);
    await stroke(along([at(0.3, 0.2), at(0.6, 0.2), at(0.6, 0.8), at(0.3, 0.8), at(0.3, 0.2)], 10), 500);
    await sleep(150);
    const square = await verdict();
    check('practice: a square drawn for the triangle explains what it missed', square.head === 'Unclear' && /4 corners; a triangle has 3/.test(square.detail ?? ''), square);
    await page.screenshot({ path: path.join(OUT, '19-practice-square.png') });
    await stroke(along([at(0.45, 0.15), at(0.68, 0.8), at(0.22, 0.8), at(0.45, 0.15)], 12), 500);
    await sleep(150);
    const tri = await verdict();
    check('practice: the triangle casts Arcane Ward and the tally counts it', tri.head === 'Triangle: Arcane Ward' && /^1 of 2 cast as Triangle/.test(tri.history ?? ''), tri);
    await page.keyboard.press('Escape');
    await sleep(200);
    check('Esc leaves the practice room', !!(await page.$('.title-screen')));
  }

  // ============================================================== Part D: upgrade-integrity fuzz
  // Random keys and clicks across every screen, with plenty of shards to spend. Clicks that would
  // land on a "Learn" button are skipped, so permanent upgrades must never change.
  await page.evaluate((k) => {
    const sv = JSON.parse(localStorage.getItem(k));
    sv.currency = 5000;
    localStorage.setItem(k, JSON.stringify(sv));
  }, SAVE_KEY);
  await page.reload({ waitUntil: 'networkidle0' });
  const fuzzStart = await readSave();
  const fuzzKeys = ['Enter', 'Space', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'KeyR', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyM', 'Tab'];
  const screensSeen = new Set();
  let skippedLearnClicks = 0;
  let metaChanged = false;
  let currencyDropped = false;
  let prevCurrency = fuzzStart.currency;
  for (let i = 0; i < 400; i++) {
    const screen = await page.evaluate(() =>
      document.querySelector('.shop') ? 'shop' : document.querySelector('.howto') ? 'howto' : document.querySelector('.title-screen') ? 'title' : 'game',
    );
    screensSeen.add(screen);
    if (i % 40 === 0 && screen === 'title') await clickButton('Permanent Upgrades');
    else if (rand() < 0.5) {
      const k = fuzzKeys[Math.floor(rand() * fuzzKeys.length)];
      // Tab + Enter would be a deliberate keyboard purchase, so Tab only ever moves focus here
      // and focus is cleared again before the next action.
      await page.keyboard.press(k);
      if (k === 'Tab') await page.evaluate(() => document.activeElement?.blur());
    } else {
      const x = Math.floor(rand() * 1280);
      const y = Math.floor(rand() * 720);
      const onLearn = await page.evaluate(
        (x, y) => !!document.elementFromPoint(x, y)?.closest('button')?.textContent?.startsWith('Learn'),
        x,
        y,
      );
      if (onLearn) skippedLearnClicks++;
      else await page.mouse.click(x, y);
    }
    await sleep(20);
    const sv = await readSave();
    if (JSON.stringify(sv.meta) !== JSON.stringify(fuzzStart.meta)) metaChanged = true;
    if (sv.currency < prevCurrency) currencyDropped = true;
    prevCurrency = sv.currency;
  }
  check('400 random keys/clicks (no Learn clicks) never change permanent upgrades', !metaChanged && !currencyDropped, {
    screensSeen: [...screensSeen],
    skippedLearnClicks,
  });
} finally {
  const failed = results.filter((r) => !r.pass);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results }, null, 2));
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log('FAILED:', f.name, JSON.stringify(f.detail));
  await browser.close();
  await server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  process.exitCode = failed.length ? 1 : 0;
}
