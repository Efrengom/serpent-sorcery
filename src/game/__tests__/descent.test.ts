import { describe, expect, it } from 'vitest';
import { clampCamera } from '../camera';
import { damageEnemy, hurtPlayer, killEnemy } from '../combat';
import { DESCENT, DIRECTOR, ENEMIES, HAZARDS, METEORS } from '../config';
import { beginDescent, enterNextMap, leaveForNextMap, updateDescent } from '../descent';
import { flameReaches, kindWeights, spawnEnemy, updateDirector, updateEnemies, updatePortals } from '../enemies';
import { burnFoe, hazardAt, spawnBlast, updateHazards } from '../hazards';
import { MAP_ORDER, mapForIndex } from '../maps';
import { emptyMetaLevels } from '../progression';
import { describeHurt, hurtKey } from '../recap';
import { refreshFlowField } from '../nav';
import { clearanceAt } from '../terrain';
import { createWorld, DEFAULT_SETUP, type Enemy, type World } from '../world';

const DT = 1 / 120;
const newWorld = (depth = 1, seed = 5): World => createWorld(emptyMetaLevels(), () => undefined, seed, { ...DEFAULT_SETUP, startDepth: depth });
/** The depth a run first reaches the Ember Depths. */
const EMBER_DEPTH = MAP_ORDER.indexOf('ember') + 1;

/** Puts the serpent (and the camera) at (x, y) and refreshes the paths to it. */
function placeSerpent(w: World, x: number, y: number, heading = 0): void {
  w.snake.reset(x, y, heading);
  w.camera.x = x;
  w.camera.y = y;
  clampCamera(w.camera, w.map.width, w.map.height);
  refreshFlowField(w.flow, x, y);
}

function foe(w: World, kind: Enemy['kind'], x: number, y: number): Enemy {
  const e = spawnEnemy(w, kind, x, y);
  e.elite = null;
  e.shield = 0;
  return e;
}

/** Steps the clock, the foes and the hazards (the engine's step, without the serpent). */
function tick(w: World): void {
  w.time += DT;
  w.invuln = Math.max(0, w.invuln - DT);
  updateEnemies(w, DT);
  updateHazards(w, DT);
}

describe('descending after the boss', () => {
  it('clears the field and opens a way down where the boss fell; nothing new arrives', () => {
    const w = newWorld();
    placeSerpent(w, 3200, 2100);
    foe(w, 'chaser', 3000, 2000);
    foe(w, 'caster', 3400, 2000);
    w.crystals.push({ x: 600, y: 600, vx: 0, vy: 0, value: 3, t: 0, magnet: false } as World['crystals'][number]);
    killEnemy(w, spawnEnemy(w, 'boss', 3200, 2000));
    expect(w.descent).not.toBeNull();
    expect(Math.hypot(w.descent!.x - 3200, w.descent!.y - 2000)).toBeLessThan(80);
    expect(w.enemies.every((e) => e.dead)).toBe(true);
    expect(w.crystals.every((c) => c.magnet)).toBe(true);
    // Still on the first map until the serpent goes down.
    expect(w.depth).toBe(1);
    w.time = w.nextBossTime + 10;
    const before = w.enemies.length + w.portals.length;
    for (let i = 0; i < 5 / DT; i++) updateDirector(w, DT);
    expect(w.enemies.length + w.portals.length).toBe(before);
    expect(w.boss).toBeNull();
  });

  it('takes the serpent to the next map when it steers in, keeping its level and length', () => {
    const w = newWorld();
    w.level = 7;
    beginDescent(w, 3200, 2000);
    const t = w.time;
    placeSerpent(w, w.descent!.x + DESCENT.radius - 5, w.descent!.y);
    w.snake.segmentCount = w.snake.segmentTarget = 30;
    updateDescent(w, DT);
    // The threshold offers relics first; taking one goes down.
    expect(w.relicOffer).not.toBeNull();
    expect(w.depth).toBe(1);
    leaveForNextMap(w, w.relicOffer![0]);
    expect(w.descent).toBeNull();
    expect(w.map.def.id).toBe(MAP_ORDER[1]);
    expect(w.depth).toBe(2);
    expect(w.recap.depth).toBe(2);
    expect(w.recap.map).toBe(w.map.def.name);
    expect(w.level).toBe(7);
    expect(w.snake.segmentCount).toBe(30);
    expect([w.snake.x, w.snake.y]).toEqual([w.map.start.x, w.map.start.y]);
    expect(w.invuln).toBeCloseTo(1.5, 6);
    expect(w.fade).toBeCloseTo(DESCENT.fade, 6);
    expect(w.banner?.text).toBe(`Depth 2: ${w.map.def.name}`);
    expect(w.banner?.sub).toBe(w.map.def.tip);
    // A fresh boss clock and fresh breakables.
    expect(w.nextBossTime).toBeCloseTo(t + DIRECTOR.bossInterval, 6);
    expect(w.mapStart).toBe(t);
    expect(w.breakables.length).toBeGreaterThan(100);
  });

  it('pulls the serpent in after a while anyway, so the quiet can’t be farmed', () => {
    const w = newWorld();
    beginDescent(w, 3200, 2000);
    placeSerpent(w, 600, 3000);
    for (let i = 0; i < (DESCENT.pullAfter - 0.5) / DT; i++) updateDescent(w, DT);
    expect(w.depth).toBe(1);
    for (let i = 0; i < 1 / DT; i++) updateDescent(w, DT);
    expect(w.relicOffer).not.toBeNull();
    leaveForNextMap(w, null);
    expect(w.depth).toBe(2);
  });

  it('never opens the way down in lava', () => {
    const w = newWorld(EMBER_DEPTH);
    expect(w.map.def.id).toBe('ember');
    expect(hazardAt(w, 3600, 2000)).toBe('lava');
    beginDescent(w, 3600, 2000);
    const d = w.descent!;
    expect(clearanceAt(w.map.hazardIndex!, d.x, d.y)).toBeGreaterThanOrEqual(DESCENT.radius);
    expect(clearanceAt(w.map.index, d.x, d.y)).toBeGreaterThanOrEqual(60);
    expect(Math.hypot(d.x - 3600, d.y - 2000)).toBeLessThan(400);
  });

  it('goes through the maps in order, then round again, deeper', () => {
    const w = newWorld();
    const seen = [w.map.def.id];
    for (let i = 0; i < MAP_ORDER.length; i++) {
      enterNextMap(w);
      seen.push(w.map.def.id);
    }
    expect(seen).toEqual([...MAP_ORDER, MAP_ORDER[0]]);
    expect(w.depth).toBe(MAP_ORDER.length + 1);
    // The same map is laid out afresh on a repeat visit.
    expect(mapForIndex(MAP_ORDER.length).id).toBe(MAP_ORDER[0]);
  });
});

describe('each map’s foes', () => {
  it('unlock faster on later maps', () => {
    const roster = mapForIndex(1).roster;
    const first = kindWeights(30, roster, true);
    const later = kindWeights(30, roster, false);
    expect(first[1][1]).toBe(0);
    expect(later[1][1]).toBeGreaterThan(0);
    expect(kindWeights(100, roster, false).every(([, wt]) => wt > 0)).toBe(true);
  });

  it('the Ember Depths send only their own four', () => {
    const w = newWorld(EMBER_DEPTH);
    placeSerpent(w, w.map.start.x, w.map.start.y);
    w.invuln = 1e9;
    const kinds = new Set<string>();
    for (let i = 0; i < 100 / DT; i++) {
      w.time += DT;
      updateDirector(w, DT);
      updatePortals(w, DT);
      for (const e of w.enemies) kinds.add(e.kind);
      // Keep the field from filling up, so new spawns keep coming.
      if (w.enemies.length > 30) w.enemies.splice(0, 10);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    for (const k of kinds) expect(w.map.def.roster).toContain(k);
  });
});

describe('lava, fire and vents', () => {
  it('lava stings through Stoneskin and the Ward; a vent’s blast is blocked by Stoneskin', () => {
    const w = newWorld(EMBER_DEPTH);
    placeSerpent(w, 3600, 2000);
    w.vents.length = 0;
    w.invuln = 0;
    w.buffs.stoneskin = 20;
    const hp = w.hp;
    updateHazards(w, DT);
    expect(w.hp).toBe(hp - HAZARDS.lava.damage);
    expect(w.buffs.stoneskin).toBe(20);
    expect(describeHurt(Object.keys(w.recap.taken)[0])).toBe('lava');

    placeSerpent(w, 2600, 1200);
    w.invuln = 0;
    spawnBlast(w, { x: 2600, y: 1200, r: 80, delay: 0.5, damage: 14, hitsFoes: true, source: { kind: 'hazard', attack: 'vent' }, after: null, look: 'vent', from: null });
    for (let i = 0; i < 0.6 / DT; i++) updateHazards(w, DT);
    expect(w.hp).toBe(hp - HAZARDS.lava.damage);
    expect(w.buffs.stoneskin).toBe(0);
  });

  it('vents only erupt near the view, with a circle marked a second ahead', () => {
    const w = newWorld(EMBER_DEPTH);
    placeSerpent(w, 600, 600);
    const far = w.vents.filter((v) => Math.hypot(v.x - 600, v.y - 600) > 1600);
    const next = far.map((v) => v.next);
    for (let i = 0; i < 10 / DT; i++) {
      w.time += DT;
      updateHazards(w, DT);
    }
    far.forEach((v, i) => expect(v.next).toBeGreaterThan(next[i] + 9));
    expect(w.blasts.every((b) => Math.hypot(b.x - 600, b.y - 600) < 1600)).toBe(true);

    const v = w.vents[0];
    placeSerpent(w, v.x + 200, v.y);
    v.next = w.time;
    updateHazards(w, DT);
    const blast = w.blasts.find((b) => b.x === v.x && b.y === v.y);
    expect(blast?.delay).toBeGreaterThanOrEqual(0.6);
    expect(blast?.hitsFoes).toBe(true);
  });

  it('burns foes that aren’t at home in it; Ember foes walk through lava unharmed', () => {
    const w = newWorld(EMBER_DEPTH);
    const chaser = foe(w, 'chaser', 3600, 2000);
    const brute = foe(w, 'magmaBrute', 3600, 1900);
    const hp = [chaser.hp, brute.hp];
    for (let i = 0; i < 2 / DT; i++) {
      burnFoe(w, chaser, DT);
      burnFoe(w, brute, DT);
    }
    expect(chaser.hp).toBeLessThan(hp[0]);
    expect(brute.hp).toBe(hp[1]);
    expect(w.recap.spells.hazard.damage).toBeGreaterThan(0);
  });
});

describe('the Ember Depths’ foes', () => {
  /** An open spot in the Caldera, with the serpent at its middle. */
  function arena(): World {
    const w = newWorld(EMBER_DEPTH);
    placeSerpent(w, 1600, 2000);
    w.spawnAcc = -1e9;
    w.vents.length = 0;
    return w;
  }

  it('a Pyromancer marks where its fireball lands, which leaves burning ground', () => {
    const w = arena();
    const p = foe(w, 'pyromancer', 1600, 1700);
    p.attackTimer = 0;
    for (let i = 0; i < 2 / DT && w.blasts.length === 0; i++) tick(w);
    const b = w.blasts[0];
    expect(b.look).toBe('fireball');
    expect(b.delay).toBeGreaterThanOrEqual(0.6);
    expect(b.from).not.toBeNull();
    for (let i = 0; i < 1.2 / DT && w.blasts.length > 0; i++) updateHazards(w, DT);
    expect(w.groundFx.some((g) => g.kind === 'fire')).toBe(true);
  });

  it('a Magma Brute’s charge leaves a trail of lava', () => {
    const w = arena();
    const b = foe(w, 'magmaBrute', 1300, 2000);
    Object.assign(b, { state: 'attack', stateTime: 0, aim: Math.PI / 2 });
    for (let i = 0; i < ENEMIES.magmaBrute.chargeTime / DT; i++) tick(w);
    expect(w.groundFx.filter((g) => g.kind === 'lava').length).toBeGreaterThan(3);
  });

  it('a Cinder Imp crouches for a moment before it leaps', () => {
    const w = arena();
    const imp = foe(w, 'imp', 1600, 2140);
    imp.attackTimer = 0;
    let windupAt = -1;
    let leapAt = -1;
    for (let i = 0; i < 3 / DT && leapAt < 0; i++) {
      tick(w);
      if (imp.state === 'windup' && windupAt < 0) windupAt = w.time;
      if (imp.state === 'attack') leapAt = w.time;
    }
    expect(windupAt).toBeGreaterThan(0);
    expect(leapAt - windupAt).toBeGreaterThanOrEqual(0.6 - 1e-6);
  });

  it('a Salamander’s flame reaches down its cone, and stone stops it', () => {
    const w = arena();
    const s = foe(w, 'salamander', 1450, 2000);
    s.heading = 0;
    expect(flameReaches(w, s)).toBe(true);
    s.heading = Math.PI / 2;
    expect(flameReaches(w, s)).toBe(false);
    // A basalt column of the Caldera's ring, between the two.
    const col = w.map.solids.find((p) => p.name === 'basalt' && p.shape === 'circle' && Math.abs(p.y - 2306) < 20 && p.x > 2200)!;
    expect(col).toBeDefined();
    if (col.shape !== 'circle') return;
    placeSerpent(w, col.x + 80, col.y);
    s.x = col.x - 90;
    s.y = col.y;
    s.heading = 0;
    expect(flameReaches(w, s)).toBe(false);
    expect(describeHurt(hurtKey({ kind: 'salamander', attack: 'flame' }))).toBe("a Salamander's flame");
  });

  it('Pyrecoil rains meteors on marked circles, and is named in the recap', () => {
    const w = arena();
    const boss = foe(w, 'boss', 1600, 1750);
    expect(boss.bossId).toBe('pyrecoil');
    boss.attackTimer = 0;
    for (let i = 0; i < 4 / DT && !w.blasts.some((b) => b.look === 'meteor'); i++) tick(w);
    const meteors = w.blasts.filter((b) => b.look === 'meteor');
    expect(meteors.length).toBe(METEORS.count);
    expect(Math.min(...meteors.map((m) => m.delay))).toBeGreaterThanOrEqual(0.6);
    w.invuln = 0;
    hurtPlayer(w, 5, meteors[0].source);
    expect(describeHurt(Object.keys(w.recap.taken)[0])).toBe("Pyrecoil's meteors");
  });

  it('hazards can kill foes, and the recap counts it apart from your spells', () => {
    const w = arena();
    const c = foe(w, 'chaser', 1600, 1800);
    damageEnemy(w, c, c.hp + 1, 'hazard', '#f80');
    expect(c.dead).toBe(true);
    expect(w.recap.spells.hazard.kills).toBe(1);
  });
});
