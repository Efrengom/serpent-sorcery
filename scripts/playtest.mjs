// End-to-end play-test with real browser input.
//
// Starts its own Vite dev server, drives a headless Edge/Chrome through the Chrome DevTools
// Protocol (keys are genuinely held while the mouse draws many-point strokes), plays an
// autopilot run, and checks the full loop: steering, drawing, aiming, cooldowns, pause/focus/
// resize handling, music and sound, the boss theme and hit-stop, level-ups, death and its
// recap, rewards, restart, the shop and save persistence.
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
  page.evaluate(() => {
    const g = window.__serpent;
    const overlay = document.querySelector('.overlay-title')?.textContent ?? null;
    if (!g) return { phase: 'none', overlay };
    const w = g.debug().world;
    const r = g.renderer;
    const s = w.snake;
    const scr = (p) => r.worldToScreen(p);
    return {
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
    return { scene: a.musicScene, theme: a.musicTheme, playing: a.musicPlaying, time: +a.musicTime.toFixed(2) };
  });
const readSave = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), SAVE_KEY);
const screenToWorld = (p) => page.evaluate((p) => window.__serpent.renderer.screenToWorld(p), p);
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
  scribble: (x, y) => {
    const z = [[0, 0], [30, 55], [60, 0], [90, 55], [120, 0], [150, 55]];
    const pts = [];
    for (let i = 1; i < z.length; i++)
      for (let k = 0; k < 6; k++)
        pts.push({ x: x + z[i - 1][0] + ((z[i][0] - z[i - 1][0]) * k) / 6, y: y + z[i - 1][1] + ((z[i][1] - z[i - 1][1]) * k) / 6 });
    return pts;
  },
};

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
    const samples = await page.evaluate(() => [window.__serpentAudio.samplesLoaded, window.__serpentAudio.samplesFailed]);
    check('every sound effect sample loads and decodes', samples[0] === 44 && samples[1] === 0 && sampleResponses.every((s) => s === 200 || s === 304), {
      loaded: samples[0],
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
    const T = await screenToWorld(P);
    await setKeys(new Set(['KeyS']));
    const atDown = await state();
    await stroke(shapes.line(P.x, P.y, 2.6, 130), 650);
    const a = await state();
    await setKeys(new Set());
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
    const back = await worldToScreen(T);
    check('mouse-to-arena mapping round-trips', Math.hypot(back.x - P.x, back.y - P.y) < 1, { P, back });
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
    const back = await worldToScreen(await screenToWorld(P));
    check('mouse mapping correct after resize', Math.hypot(back.x - P.x, back.y - P.y) < 1, { P, back });
    await page.setViewport({ width: 1280, height: 720 });
    await sleep(150);
  }

  // ============================================================== Part A2: boss music, hit-stop
  {
    const a0 = await audioState();
    check('run music plays the main theme', a0.theme === 'main' && /^run/.test(a0.scene) && a0.playing, a0);
    // Make the snake untouchable (and unable to level up mid-test), then skip ahead to just
    // before the boss warning. Part B starts a fresh run afterwards.
    await page.evaluate(() => {
      const w = window.__serpent.debug().world;
      w.invuln = 1e9;
      w.xp = -1e6;
      w.time = w.nextBossTime - 4.6;
    });
    await sleep(900);
    const warn = await audioState();
    check('music hushes when the boss warning sounds', warn.scene === 'warning' && warn.theme === 'main', warn);
    let bossUp = false;
    for (let i = 0; i < 48 && !bossUp; i++) {
      await sleep(250);
      bossUp = await page.evaluate(() => !!window.__serpent.debug().world.boss);
    }
    await sleep(800);
    const fight = await audioState();
    check('boss theme crossfades in when the boss appears', bossUp && fight.theme === 'boss' && /^boss/.test(fight.scene), { bossUp, fight });
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
        const b = g.debug().world.boss;
        if (!b) return null;
        const pts = [{ x: b.x, y: b.y }, ...b.segments].map((p) => g.renderer.worldToScreen(p));
        return pts.find((p) => p.y > 110 && p.y < 600 && p.x > 30 && p.x < 1150) ?? null;
      });
      if (aim) await stroke(shapes.line(aim.x, aim.y, -0.3, 110), 130);
      await sleep(650);
      killed = await page.evaluate(() => window.__serpent.debug().world.bossKills > 0);
    }
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
    const back = await audioState();
    check('main theme returns after the boss falls', back.theme === 'main' && /^run/.test(back.scene), back);
    const rec = await page.evaluate(() => window.__serpent.debug().world.recap.spells.bolt);
    check('the recap credits the boss kill to Arcane Bolt', rec.kills >= 1 && rec.casts >= 1, rec);
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
      window.__lastCast = { text: added[0] ?? '(ignored)', boltsAdded: w.bolts.length - bolts, multibolt: w.upgrades.multibolt };
    };
  });
  const log = { casts: { line: 0, vee: 0, circle: 0 }, outcomes: {}, levelUps: [], misfires: 0, picks: [], pickFailures: [], boltCountChecks: 0, boltCountFailures: [], scenes: {} };
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
  };
  const runSnapshot = () =>
    page.evaluate(() => {
      const w = window.__serpent.debug().world;
      return { up: { ...w.upgrades }, stats: { ...w.stats }, hp: w.hp };
    });
  const spellOf = { 'Arcane Bolt!': 'line', 'Forked Lightning!': 'vee', 'Arcane Nova!': 'circle' };
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
      const split = names.indexOf('Split Bolt');
      const i = split >= 0 ? split : pickIndex++ % names.length;
      const name = names[i];
      log.picks.push(name);
      const before = await runSnapshot();
      await page.keyboard.press(['Digit1', 'Digit2', 'Digit3'][i]);
      await sleep(80);
      const after = await runSnapshot();
      // The chosen card must raise exactly its own upgrade and change the derived stats.
      const id = UPGRADE_BY_NAME[name];
      const othersSame = Object.keys(before.up).every((k) => k === id || after.up[k] === before.up[k]);
      const applied = id
        ? after.up[id] === before.up[id] + 1 && othersSame && JSON.stringify(after.stats) !== JSON.stringify(before.stats)
        : after.hp >= before.hp;
      if (!applied) log.pickFailures.push({ name, before: before.up, after: after.up });
      continue;
    }
    if (s.phase === 'dying' || s.phase === 'gameover') break;
    if (s.phase !== 'playing') {
      await sleep(50);
      continue;
    }
    // Steering: keep off walls, dodge threats, collect crystals, otherwise orbit.
    let vx = 0;
    let vy = 0;
    const cx = 700 - s.x;
    const cy = 400 - s.y;
    const cd0 = Math.hypot(cx, cy) || 1;
    vx += (-cy / cd0) * 0.5;
    vy += (cx / cd0) * 0.5;
    if (s.x < 170) vx += 2;
    if (s.x > 1230) vx -= 2;
    if (s.y < 160) vy += 2;
    if (s.y > 640) vy -= 2;
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
    if (cast && t === 'Arcane Bolt!') {
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
  check('autopilot: first level-up around 20-30 s', firstLevel !== undefined && firstLevel >= 15 && firstLevel <= 32, { firstLevel });
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

  // ============================================================== Death, reward, restart, persistence
  for (let i = 0; i < 160 && (await state()).phase !== 'gameover'; i++) await sleep(500);
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
        shown: [...document.querySelectorAll('.recap-num')].map((n) => n.textContent),
        expected: ['bolt', 'lightning', 'nova'].map((id) => Math.round(r.spells[id].damage).toLocaleString()),
        casts: ['bolt', 'lightning', 'nova'].map((id) => r.spells[id].casts),
      };
    });
    check('game-over recap names the killing blow and shows each spell’s damage', !!recap.killedBy && /^Slain by /.test(recap.cause) &&
      recap.shown.length === 3 && recap.shown.join() === recap.expected.join() && recap.casts.every((c) => c > 0), recap);
    const calm = await audioState();
    check('music settles to the calm arrangement on the game-over screen', calm.scene === 'calm' && calm.theme === 'main', calm);
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
