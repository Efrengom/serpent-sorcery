/**
 * Balance check across the maps, without a browser: a simple bot plays each map for a few
 * minutes of game time (steering away from foes, stone and stinging ground, casting at whatever
 * is near, taking a random card at each level-up) and the damage it takes, by kind, is compared.
 *
 *   npx vite-node scripts/balance.ts [seconds=240] [seeds=3] [depth=2] [level=10] [shop=none]
 *
 * Every map is played at the same depth and from the same level, so the numbers show what each
 * map's foes and hazards add, not the depth scaling (which is the same everywhere).
 *
 * Depth 0 plays whole runs instead (C4): from level 1 on the first map, the bot levels as it goes
 * and steps down to the next map when the boss clock runs out (it doesn't fight bosses), for
 * `level` maps (5 by default: the four and the first again, deeper). `seconds` is ignored there.
 * `shop` is "none" or "max": the permanent upgrades the serpent starts with.
 */
import { updateBreakables, updateBuffs, updatePickups } from '../src/game/breakables';
import { updateCamera } from '../src/game/camera';
import { leaveForNextMap } from '../src/game/descent';
import { afterSigil, hasRelic, offerRelics, updateRelics } from '../src/game/relics';
import { refreshStats } from '../src/game/world';
import { castUltimate, updateUltimate } from '../src/game/ultimates';
import { ARENA, BUFFS, HAZARDS, SPELL_IDS, SPELLS, type SpellId } from '../src/game/config';
import { gainXp, hurtPlayer, updateContacts, updateCrystals, updateShots } from '../src/game/combat';
import { updateConstrict } from '../src/game/constrict';
import { updateDirector, updateEnemies, updatePortals } from '../src/game/enemies';
import { updateEffects } from '../src/game/effects';
import { hazardAt, onIce, updateHazards } from '../src/game/hazards';
import { MAP_ORDER } from '../src/game/maps';
import { mulberry32 } from '../src/game/math';
import { applyChoice, rollOffer } from '../src/game/levelup';
import { emptyMetaLevels, segmentsForLevel, spellCooldown, survivalXpRate, xpToNext } from '../src/game/progression';
import { castSpell, regenPerSecond, spawnBolt, tickCooldowns, updateBeams, updateBolts, updateEchoes, updateFrost, updateNovas, updateWard } from '../src/game/spells';
import { aimLines, attackLane } from '../src/game/telegraph';
import { clearanceAt } from '../src/game/terrain';
import { createWorld, DEFAULT_SETUP, type World } from '../src/game/world';
import type { MapId } from '../src/game/maps/types';

const [SECONDS, SEEDS, DEPTH, LEVEL] = [240, 3, 2, 0].map((d, i) => {
  const v = Number(process.argv[2 + i]);
  return Number.isFinite(v) && process.argv[2 + i] !== undefined ? v : d;
});
const SHOP = process.argv[6] === 'max' ? { health: 5, damage: 5, pickup: 3, wisdom: 3 } : emptyMetaLevels();
/** Maps a whole run plays (depth 0), or the level every map starts from (fixed depth). */
const MAPS_PER_RUN = LEVEL || 5;
const START_LEVEL = LEVEL || 10;
const DT = 1 / 60;

/** Builds a world on the given map at DEPTH, the serpent already at START_LEVEL with random cards. */
function setUp(id: MapId, seed: number): World {
  const rng = mulberry32(seed * 977);
  const w = createWorld(SHOP, () => undefined, seed, { ...DEFAULT_SETUP, startDepth: MAP_ORDER.indexOf(id) + 1 });
  w.depth = DEPTH;
  for (let l = 1; l < START_LEVEL; l++) {
    w.level++;
    pickCard(w, rng);
  }
  w.snake.segmentTarget = w.snake.segmentCount = segmentsForLevel(w.level);
  w.hp = w.stats.maxHp;
  return w;
}

/** Takes a random card, as a player who doesn't plan would. */
function pickCard(w: World, rng: () => number): void {
  const choices = rollOffer(w, w.level, rng);
  const c = choices[Math.floor(rng() * choices.length)];
  if (c) applyChoice(w, c);
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
  // The ultimate: into a crowd, or when hurt with foes close.
  if (w.ult.cooldown <= 0 && (near(450).length >= 8 || (w.hp < w.stats.maxHp * 0.4 && near(250).length > 0))) castUltimate(w);
  const pack = near(420);
  if (pack.length >= 3) want.frost = { x: pack.reduce((t, e) => t + e.x, 0) / pack.length, y: pack.reduce((t, e) => t + e.y, 0) / pack.length };
  for (const id of SPELL_IDS) {
    if (!(id in want) || !w.known.includes(id) || w.cooldowns[id] > 0) continue;
    castSpell(w, id, want[id] ?? null, 1.15);
    const cd = spellCooldown(id, w.stats);
    w.cooldowns[id] = cd;
    w.cooldownTotals[id] = cd;
    afterSigil(w, id, false, () => castSpell(w, id, want[id] ?? null, 1.15));
  }
}

/** One step of the engine's simulation (engine.ts step), with the bot at the keys. */
function step(w: World, rng: () => number): void {
  w.time += DT;
  gainXp(w, survivalXpRate(w.time) * DT);
  const dir = steer(w);
  w.snake.speedMult = w.buffs.swiftscale > 0 ? BUFFS.swiftscale.speed : 1;
  w.snake.turnMult = onIce(w, w.snake.x, w.snake.y) && !hasRelic(w, 'rimewalker') ? HAZARDS.ice.turn : 1;
  const hit = w.snake.update(DT, dir.x, dir.y, w.map);
  if (hit) hurtPlayer(w, ARENA.wallDamage, { kind: 'wall', attack: hit === 'wall' ? w.map.def.wallName : hit });
  updateBreakables(w, DT);
  updateCamera(w.camera, w.snake, w.map.width, w.map.height, DT, false);
  updateConstrict(w, DT);
  updateRelics(w, DT, (x, y, a, damage) => spawnBolt(w, x, y, a, damage, 0, SPELLS.bolt.radius));
  updateUltimate(w, DT);
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
  const regen = regenPerSecond(w);
  if (regen > 0 && w.hp > 0) w.hp = Math.min(w.stats.maxHp, w.hp + regen * DT);
  updateEffects(w, DT);
  while (w.xp >= xpToNext(w.level)) {
    w.xp -= xpToNext(w.level);
    w.level++;
    w.snake.segmentTarget = segmentsForLevel(w.level);
    refreshStats(w);
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

/** What one stretch of play added up to: damage taken by kind, deaths, kills and XP. */
interface Tally {
  sum: Record<string, number>;
  deaths: number;
  survived: number;
}

function newTally(): Tally {
  return { sum: {}, deaths: 0, survived: 0 };
}

/** XP the serpent has earned since it was at `fromLevel` with no XP. */
function earnedSince(w: World, fromLevel: number): number {
  let earned = w.xp;
  for (let l = fromLevel; l < w.level; l++) earned += xpToNext(l);
  return earned;
}

/** Plays until `until` (game time), adding to the tally; a death is noted and the bot carries on at full health. */
function play(w: World, rng: () => number, until: number, t: Tally): void {
  const start = w.time;
  const startLevel = w.level;
  const startXp = w.xp;
  const startKills = w.kills;
  const startBreakXp = w.recap.breakableXp;
  const startTaken = { ...w.recap.taken };
  let taken = 0;
  while (w.time < until) {
    const hp = w.hp;
    step(w, rng);
    taken += Math.max(0, hp - w.hp);
    if (w.hp <= 0) {
      t.deaths++;
      w.hp = w.stats.maxHp;
    }
  }
  const sum = t.sum;
  t.survived += w.time - start;
  for (const [k, v] of Object.entries(w.recap.taken)) sum[kindOf(k)] = (sum[kindOf(k)] ?? 0) + v - (startTaken[k] ?? 0);
  sum.total = (sum.total ?? 0) + taken;
  sum.kills = (sum.kills ?? 0) + w.kills - startKills;
  sum.level = (sum.level ?? 0) + w.level;
  sum.breakXp = (sum.breakXp ?? 0) + w.recap.breakableXp - startBreakXp;
  sum.earned = (sum.earned ?? 0) + earnedSince(w, startLevel) - startXp;
}

function row(label: string, t: Tally): Record<string, string | number> {
  const { sum, deaths, survived } = t;
  const perMin = (v: number | undefined) => +(((v ?? 0) / survived) * 60).toFixed(1);
  return {
    map: label,
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
  };
}

const rows: Record<string, string | number>[] = [];
const shopName = process.argv[6] === 'max' ? 'shop maxed' : 'empty shop';
if (DEPTH) {
  for (const id of MAP_ORDER) {
    const t = newTally();
    for (let seed = 1; seed <= SEEDS; seed++) play(setUp(id, seed), mulberry32(seed * 131), SECONDS, t);
    rows.push(row(id, t));
  }
  console.log(`${SECONDS} s per map, ${SEEDS} seeds, depth ${DEPTH}, from level ${START_LEVEL}, ${shopName}; spells ${SPELL_IDS.map((s) => SPELLS[s].name).join(', ')}`);
} else {
  const tallies = Array.from({ length: MAPS_PER_RUN }, newTally);
  for (let seed = 1; seed <= SEEDS; seed++) {
    const w = createWorld(SHOP, () => undefined, seed, DEFAULT_SETUP);
    const rng = mulberry32(seed * 131);
    for (let i = 0; i < MAPS_PER_RUN; i++) {
      // Leave as the boss would arrive: the bot doesn't fight it.
      play(w, rng, w.nextBossTime, tallies[i]);
      if (i < MAPS_PER_RUN - 1) {
        // The bot takes a relic at random on the way down, as it takes cards.
        w.relicOffer = offerRelics(w, rng);
        leaveForNextMap(w, w.relicOffer[Math.floor(rng() * w.relicOffer.length)] ?? null);
      }
    }
  }
  tallies.forEach((t, i) => rows.push(row(`${i + 1} ${MAP_ORDER[i % MAP_ORDER.length]}`, t)));
  console.log(`Whole runs, ${SEEDS} seeds, ${MAPS_PER_RUN} maps, ${shopName}, cards picked at random`);
}
console.table(rows);
