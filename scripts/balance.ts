/**
 * Balance check across the maps, without a browser: a simple bot plays each map for a few
 * minutes of game time (steering away from foes, stone and stinging ground, casting at whatever
 * is near, taking a random card at each level-up) and the damage it takes, by kind, is compared.
 *
 *   npx vite-node scripts/balance.ts [seconds=240] [seeds=3] [depth=2] [level=10]
 *
 * Every map is played at the same depth and from the same level, so the numbers show what each
 * map's foes and hazards add, not the depth scaling (which is the same everywhere). Depth 0 plays
 * each map at its own depth in a first pass through the run instead, with the level rising by
 * `level` per map, to see the whole run's curve.
 */
import { updateBreakables, updateBuffs, updatePickups } from '../src/game/breakables';
import { updateCamera } from '../src/game/camera';
import { ARENA, BUFFS, HAZARDS, SPELL_IDS, SPELLS, type SpellId } from '../src/game/config';
import { gainXp, hurtPlayer, updateContacts, updateCrystals, updateShots } from '../src/game/combat';
import { updateConstrict } from '../src/game/constrict';
import { updateDirector, updateEnemies, updatePortals } from '../src/game/enemies';
import { updateEffects } from '../src/game/effects';
import { hazardAt, onIce, updateHazards } from '../src/game/hazards';
import { MAP_ORDER } from '../src/game/maps';
import { mulberry32 } from '../src/game/math';
import { applyUpgrade, computeStats, emptyMetaLevels, rollUpgradeChoices, segmentsForLevel, spellCooldown, survivalXpRate, xpToNext } from '../src/game/progression';
import { castSpell, tickCooldowns, updateBeams, updateBolts, updateEchoes, updateFrost, updateNovas, updateWard } from '../src/game/spells';
import { aimLines, attackLane } from '../src/game/telegraph';
import { clearanceAt } from '../src/game/terrain';
import { createWorld, DEFAULT_SETUP, type World } from '../src/game/world';
import type { MapId } from '../src/game/maps/types';

const [SECONDS, SEEDS, DEPTH, LEVEL] = [240, 3, 2, 10].map((d, i) => {
  const v = Number(process.argv[2 + i]);
  return Number.isFinite(v) && process.argv[2 + i] !== undefined ? v : d;
});
const DT = 1 / 60;

/** Builds a world on the given map at DEPTH, the serpent already at LEVEL with random cards. */
function setUp(id: MapId, seed: number): World {
  const rng = mulberry32(seed * 977);
  const w = createWorld(emptyMetaLevels(), () => undefined, seed, { ...DEFAULT_SETUP, startDepth: MAP_ORDER.indexOf(id) + 1 });
  const order = MAP_ORDER.indexOf(id);
  w.depth = DEPTH || order + 1;
  const level = DEPTH ? LEVEL : LEVEL * (order + 1);
  for (let l = 1; l < level; l++) {
    w.level++;
    pickCard(w, rng);
  }
  w.snake.segmentTarget = w.snake.segmentCount = segmentsForLevel(w.level);
  w.hp = w.stats.maxHp;
  return w;
}

/** Takes a random card, as a player who doesn't plan would. */
function pickCard(w: World, rng: () => number): void {
  const choices = rollUpgradeChoices(w.upgrades, w.meta, rng, 3, { known: w.known, evolved: w.evolved, level: w.level }, w.mods);
  const c = choices[Math.floor(rng() * choices.length)];
  if (!c) return;
  if (c.kind === 'learn' && c.spell) {
    if (!w.known.includes(c.spell)) w.known.push(c.spell);
  } else if (c.kind === 'evolve' && c.spell) {
    w.evolved[c.spell] = true;
  } else if (c.upgrade) {
    w.upgrades = applyUpgrade(w.upgrades, c.upgrade);
    w.stats = computeStats(w.upgrades, w.meta, w.mods);
  }
}

/** Distance from (px, py) to the segment from (ax, ay) along angle `a` for `len`. */
function offLine(px: number, py: number, ax: number, ay: number, a: number, len: number): number {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const t = Math.max(0, Math.min(len, (px - ax) * dx + (py - ay) * dy));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Which way to steer: away from foes, stone, stinging ground and telegraphed lines, toward open courts. */
function steer(w: World): { x: number; y: number } {
  const s = w.snake;
  // The lines and lanes foes are about to fire or charge down.
  const lines: { x: number; y: number; a: number; len: number }[] = [];
  for (const e of w.enemies) {
    if (e.dead || e.state !== 'windup') continue;
    const fan = aimLines(e);
    if (fan) for (const a of fan.angles) lines.push({ x: e.x, y: e.y, a, len: fan.length });
    const lane = attackLane(e);
    if (lane) lines.push({ x: e.x, y: e.y, a: e.aim, len: lane.length });
  }
  // The nearest boss clearing: open ground to drift toward.
  const court = w.map.clearings.reduce(
    (best, c) => {
      const x = (c.x0 + c.x1) / 2;
      const y = (c.y0 + c.y1) / 2;
      const d = Math.hypot(x - s.x, y - s.y);
      return d < best.d ? { x, y, d } : best;
    },
    { x: s.x, y: s.y, d: Infinity },
  );
  let best = { x: Math.cos(s.heading), y: Math.sin(s.heading) };
  let bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let score = 0;
    for (const reach of [80, 160, 260]) {
      const px = s.x + dx * reach;
      const py = s.y + dy * reach;
      const c = clearanceAt(w.map.index, px, py);
      if (c < 40) score -= (40 - c) * 0.6;
      if (hazardAt(w, px, py, 20)) score -= 60;
      if (onIce(w, px, py)) score -= 8;
      for (const e of w.enemies) {
        if (e.dead || e.hidden || e.pile > 0) continue;
        const d = Math.hypot(e.x - px, e.y - py);
        if (d < 260) score -= (260 - d) * 0.08;
      }
      for (const b of w.blasts) if (Math.hypot(b.x - px, b.y - py) < b.r + 30) score -= 40;
      for (const l of lines) if (offLine(px, py, l.x, l.y, l.a, l.len) < 45) score -= 30;
    }
    // Keep turning gently rather than zig-zagging; a small pull toward the nearest open court.
    score += Math.cos(a - s.heading) * 6;
    if (court.d > 300) score += (((court.x - s.x) * dx + (court.y - s.y) * dy) / court.d) * 10;
    if (score > bestScore) {
      bestScore = score;
      best = { x: dx, y: dy };
    }
  }
  return best;
}

/** Casts whatever is ready at whatever is worth it, as a fair-to-middling player would (clean casts). */
function cast(w: World): void {
  const s = w.snake;
  const foes = w.enemies.filter((e) => !e.dead && !e.hidden);
  if (foes.length === 0) return;
  const near = (r: number) => foes.filter((e) => Math.hypot(e.x - s.x, e.y - s.y) < r);
  const nearest = foes.reduce((a, b) => (Math.hypot(a.x - s.x, a.y - s.y) < Math.hypot(b.x - s.x, b.y - s.y) ? a : b));
  const want: Partial<Record<SpellId, { x: number; y: number } | null>> = {};
  if (Math.hypot(nearest.x - s.x, nearest.y - s.y) < 600) want.bolt = { x: nearest.x, y: nearest.y };
  if (near(450).length > 0) want.lightning = { x: nearest.x, y: nearest.y };
  if (near(160).length >= 3 || near(90).length > 0) want.nova = null;
  if (w.hp < w.stats.maxHp * 0.6 && near(300).length > 0) want.ward = null;
  const pack = near(420);
  if (pack.length >= 3) want.frost = { x: pack.reduce((t, e) => t + e.x, 0) / pack.length, y: pack.reduce((t, e) => t + e.y, 0) / pack.length };
  for (const id of SPELL_IDS) {
    if (!(id in want) || !w.known.includes(id) || w.cooldowns[id] > 0) continue;
    castSpell(w, id, want[id] ?? null, 1.15);
    const cd = spellCooldown(id, w.stats);
    w.cooldowns[id] = cd;
    w.cooldownTotals[id] = cd;
  }
}

/** One step of the engine's simulation (engine.ts step), with the bot at the keys. */
function step(w: World, rng: () => number): void {
  w.time += DT;
  gainXp(w, survivalXpRate(w.time) * DT);
  const dir = steer(w);
  w.snake.speedMult = w.buffs.swiftscale > 0 ? BUFFS.swiftscale.speed : 1;
  w.snake.turnMult = onIce(w, w.snake.x, w.snake.y) ? HAZARDS.ice.turn : 1;
  const hit = w.snake.update(DT, dir.x, dir.y, w.map);
  if (hit) hurtPlayer(w, ARENA.wallDamage, { kind: 'wall', attack: hit === 'wall' ? w.map.def.wallName : hit });
  updateBreakables(w, DT);
  updateCamera(w.camera, w.snake, w.map.width, w.map.height, DT, false);
  updateConstrict(w, DT);
  cast(w);
  updateDirector(w, DT);
  updatePortals(w, DT);
  updateEnemies(w, DT);
  updateBolts(w, DT);
  updateNovas(w, DT);
  updateFrost(w, DT);
  updateBeams(w, DT);
  updateWard(w, DT);
  updateEchoes(w);
  updateShots(w, DT);
  updateContacts(w);
  updateHazards(w, DT);
  updateCrystals(w, DT);
  updatePickups(w, DT);
  updateBuffs(w, DT);
  tickCooldowns(w, DT);
  w.invuln = Math.max(0, w.invuln - DT);
  if (w.stats.regenPerSec > 0 && w.hp > 0) w.hp = Math.min(w.stats.maxHp, w.hp + w.stats.regenPerSec * DT);
  updateEffects(w, DT);
  while (w.xp >= xpToNext(w.level)) {
    w.xp -= xpToNext(w.level);
    w.level++;
    w.snake.segmentTarget = segmentsForLevel(w.level);
    pickCard(w, rng);
  }
}

/** What each hurt counts as, from its recap key. */
function kindOf(key: string): string {
  const [who, what] = key.split(':');
  if (who === 'wall') return ['lava', 'bramble', 'fire'].includes(what) ? what : 'stone';
  if (who === 'hazard') return 'vents';
  if (['shot', 'volley', 'spore', 'icicle', 'fireball'].includes(what)) return 'shots';
  if (['meteor', 'erupt', 'slam'].includes(what)) return 'bursts';
  return 'melee';
}

const rows: Record<string, string | number>[] = [];
for (const id of MAP_ORDER) {
  const sum: Record<string, number> = {};
  let deaths = 0;
  let survived = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const w = setUp(id, seed);
    const rng = mulberry32(seed * 131);
    let taken = 0;
    while (w.time < SECONDS) {
      const hp = w.hp;
      step(w, rng);
      taken += Math.max(0, hp - w.hp);
      // A death is noted, then the bot carries on at full health so every map gets the full time.
      if (w.hp <= 0) {
        deaths++;
        w.hp = w.stats.maxHp;
      }
    }
    survived += w.time;
    for (const [k, v] of Object.entries(w.recap.taken)) sum[kindOf(k)] = (sum[kindOf(k)] ?? 0) + v;
    sum.total = (sum.total ?? 0) + taken;
    sum.kills = (sum.kills ?? 0) + w.kills;
    sum.level = (sum.level ?? 0) + w.level;
    sum.breakXp = (sum.breakXp ?? 0) + w.recap.breakableXp;
    let earned = w.xp;
    for (let l = DEPTH ? LEVEL : LEVEL * (MAP_ORDER.indexOf(id) + 1); l < w.level; l++) earned += xpToNext(l);
    sum.earned = (sum.earned ?? 0) + earned;
  }
  const perMin = (v: number | undefined) => +(((v ?? 0) / survived) * 60).toFixed(1);
  rows.push({
    map: id,
    'hurt/min': perMin(sum.total),
    melee: perMin(sum.melee),
    shots: perMin(sum.shots),
    bursts: perMin(sum.bursts),
    vents: perMin(sum.vents),
    lava: perMin(sum.lava),
    fire: perMin(sum.fire),
    bramble: perMin(sum.bramble),
    stone: perMin(sum.stone),
    deaths,
    'kills/min': perMin(sum.kills),
    level: +((sum.level ?? 0) / SEEDS).toFixed(1),
    'break xp %': +(((sum.breakXp ?? 0) / Math.max(1, sum.earned ?? 0)) * 100).toFixed(1),
  });
}
console.log(`${SECONDS} s per map, ${SEEDS} seeds, ${DEPTH ? `depth ${DEPTH}, from level ${LEVEL}` : `each at its own depth, from level ${LEVEL} per map`}; spells ${SPELL_IDS.map((s) => SPELLS[s].name).join(', ')}`);
console.table(rows);
