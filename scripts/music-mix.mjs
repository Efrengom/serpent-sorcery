// Measures the soundtrack's mix: renders every map's music offline in a headless browser and
// compares it with the Sunken Ruins, whose balance was set by ear and measurement.
//
//   node scripts/music-mix.mjs            # every map, scene, layer, ambience and sting
//   node scripts/music-mix.mjs hollows    # one map (always compared with the Ruins)
//   node scripts/music-mix.mjs finale     # just the Archmage Ascendant's theme
//
// Levels are weighted RMS in dBFS (bass counts less, roughly as heard). For each map it prints
// every arrangement against the Ruins' same arrangement, each layer played alone against the
// Ruins' same layer, the ambient bed against the calm arrangement, and the victory sting.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ONLY = process.argv[2] ?? null;
const SECONDS = 24;

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

const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { port: 5198 }, logLevel: 'warn' });
await server.listen();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mix-'));
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, userDataDir: profile, args: ['--mute-audio'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', String(e)));
await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__serpentAudio);

const render = (scene, opts) =>
  page.evaluate((scene, opts) => window.__serpentAudio.renderMusic(scene, opts.seconds, opts), scene, { seconds: SECONDS, weighted: true, ...opts });

const RUN_SCENES = ['calm', 'warning', 'run0', 'run1', 'run2'];
const BOSS_SCENES = ['boss1', 'boss2'];
const LAYERS = ['lead', 'harmony', 'arp', 'bass', 'bassCalm', 'drums', 'hats'];
const { maps } = await page.evaluate(async () => {
  const { MAP_ORDER } = await import('/src/game/maps/index.ts');
  return { maps: MAP_ORDER };
});
const fmt = (n) => (n >= 0 ? '+' : '') + n.toFixed(1);

const ref = {};
const report = {};
for (const map of maps) {
  if (ONLY && map !== ONLY && map !== 'ruins') continue;
  const out = { scenes: {}, layers: { run: {}, boss: {} }, ambience: null, sting: null };
  for (const scene of [...RUN_SCENES, ...BOSS_SCENES]) out.scenes[scene] = await render(scene, { map });
  for (const [part, scene] of [
    ['run', 'run2'],
    ['boss', 'boss2'],
  ]) {
    for (const solo of LAYERS) {
      // The calm bass only plays in the run theme's quiet arrangements; boss themes have none.
      if (solo === 'bassCalm' && part === 'boss') continue;
      out.layers[part][solo] = await render(solo === 'bassCalm' ? 'calm' : scene, { map, solo });
    }
  }
  out.ambience = await render('calm', { map, ambience: 'only' });
  out.sting = await render('victory', { map, from: 'boss2', seconds: 6 });
  if (map === 'ruins') Object.assign(ref, out);
  report[map] = out;

  console.log(`\n== ${map}`);
  console.log('  arrangement   level   vs ruins   peak');
  for (const scene of [...RUN_SCENES, ...BOSS_SCENES]) {
    const r = out.scenes[scene];
    console.log(`  ${scene.padEnd(12)} ${r.rms.toFixed(1).padStart(6)}   ${fmt(r.rms - ref.scenes[scene].rms).padStart(6)}   ${r.peak.toFixed(1)}`);
  }
  for (const part of ['run', 'boss']) {
    console.log(`  layers alone (${part}), vs ruins:`);
    console.log(
      '   ' +
        LAYERS.filter((l) => !(part === 'boss' && l === 'bassCalm'))
          .map((l) => `${l} ${fmt(out.layers[part][l].rms - ref.layers[part][l].rms)}`)
          .join('  '),
    );
  }
  if (out.ambience.rms > -150) console.log(`  ambience alone ${out.ambience.rms.toFixed(1)} (calm music ${out.scenes.calm.rms.toFixed(1)}, ${fmt(out.ambience.rms - out.scenes.calm.rms)})  peak ${out.ambience.peak.toFixed(1)}`);
  const sting = out.sting.perSecond;
  console.log(`  sting, per second after the boss theme: ${sting.map((x) => x.toFixed(1)).join(' ')}  peak ${out.sting.peak.toFixed(1)}`);
}

// The Archmage Ascendant's finale, against the Ruins' boss theme (and its calm arrangement, which
// plays over the victory screen, against the Ruins' calm).
if (!ONLY || ONLY === 'finale') {
  const out = { scenes: {}, layers: {}, sting: null };
  for (const scene of ['calm', ...BOSS_SCENES]) out.scenes[scene] = await render(scene, { map: 'ember', finale: true });
  for (const solo of LAYERS.filter((l) => l !== 'bassCalm')) out.layers[solo] = await render('boss2', { map: 'ember', finale: true, solo });
  out.sting = await render('victory', { map: 'ember', finale: true, from: 'boss2', seconds: 6 });
  report.finale = out;
  console.log('\n== finale');
  console.log('  arrangement   level   vs ruins   peak');
  for (const scene of ['calm', ...BOSS_SCENES]) {
    const r = out.scenes[scene];
    console.log(`  ${scene.padEnd(12)} ${r.rms.toFixed(1).padStart(6)}   ${fmt(r.rms - ref.scenes[scene].rms).padStart(6)}   ${r.peak.toFixed(1)}`);
  }
  console.log('  layers alone (boss), vs ruins:');
  console.log('   ' + LAYERS.filter((l) => l !== 'bassCalm').map((l) => `${l} ${fmt(out.layers[l].rms - ref.layers.boss[l].rms)}`).join('  '));
  console.log(`  sting, per second after the boss theme: ${out.sting.perSecond.map((x) => x.toFixed(1)).join(' ')}  peak ${out.sting.peak.toFixed(1)}`);
}

fs.mkdirSync(path.join(ROOT, 'playtest-output'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'playtest-output', 'music-mix.json'), JSON.stringify(report, null, 1));
await browser.close();
await server.close();
