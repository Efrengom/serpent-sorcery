import { describe, expect, it } from 'vitest';
import { clampCamera } from '../camera';
import { damageEnemy, updateContacts } from '../combat';
import { BOSS_MOVES, DIRECTOR, ENEMIES, HAZARDS, SNAKE } from '../config';
import { spawnEnemy, updateDirector, updateEnemies } from '../enemies';
import { burnFoe, hazardAt, onIce, updateHazards } from '../hazards';
import { MAP_ORDER } from '../maps';
import { refreshFlowField } from '../nav';
import { emptyMetaLevels } from '../progression';
import { describeHurt, hurtKey } from '../recap';
import { Snake } from '../snake';
import { aimLines } from '../telegraph';
import { clearanceAt } from '../terrain';
import { createWorld, DEFAULT_SETUP, type Enemy, type World } from '../world';

const DT = 1 / 120;
const HOLLOWS = MAP_ORDER.indexOf('hollows') + 1;
const CATACOMBS = MAP_ORDER.indexOf('catacombs') + 1;
const newWorld = (depth: number, seed = 8): World => createWorld(emptyMetaLevels(), () => undefined, seed, { ...DEFAULT_SETUP, startDepth: depth });

/** Puts the serpent (and the camera) at (x, y) and refreshes the paths to it. */
function placeSerpent(w: World, x: number, y: number, heading = 0): void {
  w.snake.reset(x, y, heading);
  w.camera.x = x;
  w.camera.y = y;
  clampCamera(w.camera, w.map.width, w.map.height);
  refreshFlowField(w.flow, x, y);
}

/** An open stretch of each map with the serpent in its middle, and no spawns or vents to get in the way. */
function arena(depth: number): World {
  const w = newWorld(depth);
  placeSerpent(w, w.map.start.x, w.map.start.y - 300);
  w.spawnAcc = -1e9;
  w.vents.length = 0;
  w.invuln = 1e9;
  return w;
}

function foe(w: World, kind: Enemy['kind'], dx: number, dy: number): Enemy {
  const e = spawnEnemy(w, kind, w.snake.x + dx, w.snake.y + dy);
  e.elite = null;
  e.shield = 0;
  return e;
}

/** Steps the clock, the foes and the hazards (the engine's step, without the serpent). */
function tick(w: World): void {
  w.time += DT;
  updateEnemies(w, DT);
  updateHazards(w, DT);
}

describe('the run’s maps', () => {
  it('go stone, then brambles and spores, then ice, then lava', () => {
    expect(MAP_ORDER).toEqual(['ruins', 'hollows', 'catacombs', 'ember']);
    expect(newWorld(HOLLOWS).map.def.roster).toEqual(['sporeling', 'puffcap', 'thornback', 'burrowViper']);
    expect(newWorld(CATACOMBS).map.def.roster).toEqual(['rattler', 'frostArcher', 'golem', 'wraith']);
  });
});

describe('brambles and ice', () => {
  it('brambles sting through Stoneskin, and burn every foe but the Hollows’ own', () => {
    // (Probes sit in the middle of a hazard cell: on a cell's edge the distance is 0, not inside.)
    const w = newWorld(HOLLOWS);
    expect(hazardAt(w, 1000, 2300)).toBe('bramble');
    placeSerpent(w, 1000, 2300);
    w.vents.length = 0;
    w.invuln = 0;
    w.buffs.stoneskin = 20;
    const hp = w.hp;
    updateHazards(w, DT);
    expect(w.hp).toBe(hp - HAZARDS.bramble.damage);
    expect(w.buffs.stoneskin).toBe(20);
    expect(describeHurt(Object.keys(w.recap.taken)[0])).toBe('brambles');

    const native = spawnEnemy(w, 'puffcap', 1000, 2300);
    const stranger = spawnEnemy(w, 'chaser', 1000, 2280);
    const before = [native.hp, stranger.hp];
    for (let i = 0; i < 1 / DT; i++) {
      burnFoe(w, native, DT);
      burnFoe(w, stranger, DT);
    }
    expect(native.hp).toBe(before[0]);
    expect(stranger.hp).toBeLessThan(before[1]);
  });

  it('ice never hurts, but halves the turn rate, so turns are wider', () => {
    const w = newWorld(CATACOMBS);
    expect(onIce(w, 6700, 2300)).toBe(true);
    expect(hazardAt(w, 6700, 2300, SNAKE.hitRadius)).toBeNull();
    const quarterTurn = (turnMult: number) => {
      // (Without a map it keeps to the old one-screen arena, so start in the middle of that.)
      const s = new Snake(700, 400, 0);
      s.turnMult = turnMult;
      let t = 0;
      while (s.heading < Math.PI / 2 - 0.02 && t < 3) {
        s.update(DT, 0, 1, null);
        t += DT;
      }
      return t;
    };
    expect(quarterTurn(HAZARDS.ice.turn)).toBeCloseTo(quarterTurn(1) * 2, 1);
  });

  it('each map’s vents make their own burst: spores in the Hollows, icicles in the Catacombs', () => {
    for (const [depth, look, name] of [
      [HOLLOWS, 'spores', 'a spore vent'],
      [CATACOMBS, 'icicle', 'falling icicles'],
    ] as const) {
      const w = newWorld(depth);
      const v = w.vents[0];
      placeSerpent(w, v.x + 150, v.y);
      v.next = w.time;
      updateHazards(w, DT);
      const b = w.blasts.find((x) => x.x === v.x && x.y === v.y)!;
      expect(b.look).toBe(look);
      expect(b.delay).toBeGreaterThanOrEqual(0.6);
      expect(describeHurt(hurtKey(b.source))).toBe(name);
    }
  });
});

describe('the Hollows’ foes', () => {
  it('Sporelings arrive in packs', () => {
    const w = newWorld(HOLLOWS);
    placeSerpent(w, w.map.start.x, w.map.start.y);
    w.time = DIRECTOR.firstSpawn + 0.5;
    w.spawnAcc = 0.99;
    for (let i = 0; i < 10 && w.portals.length === 0; i++) updateDirector(w, DT);
    expect(w.portals.every((p) => p.kind === 'sporeling')).toBe(true);
    expect(w.portals.length).toBeGreaterThanOrEqual(ENEMIES.sporeling.pack[0]);
    expect(w.portals.length).toBeLessThanOrEqual(ENEMIES.sporeling.pack[1]);
  });

  it('a Puffcap roots itself and swells, then puffs a fan of three slow spores', () => {
    const w = arena(HOLLOWS);
    const p = foe(w, 'puffcap', 0, -300);
    p.attackTimer = 0;
    for (let i = 0; i < 1 / DT && p.state !== 'windup'; i++) tick(w);
    expect(p.state).toBe('windup');
    const at = { x: p.x, y: p.y };
    const lines = aimLines(p)!;
    expect(lines.angles).toHaveLength(3);
    expect(lines.spores).toBe(true);
    for (let i = 0; i < 2 / DT && w.shots.length === 0; i++) tick(w);
    expect(Math.hypot(p.x - at.x, p.y - at.y)).toBeLessThan(2);
    expect(w.shots).toHaveLength(3);
    expect(w.shots.every((s) => s.look === 'spore' && s.life > 6)).toBe(true);
  });

  it('a Thornback’s charge leaves brambles', () => {
    const w = arena(HOLLOWS);
    const t = foe(w, 'thornback', -300, 0);
    Object.assign(t, { state: 'attack', stateTime: 0, aim: Math.PI / 2 });
    for (let i = 0; i < ENEMIES.thornback.chargeTime / DT; i++) tick(w);
    expect(w.groundFx.filter((g) => g.kind === 'bramble').length).toBeGreaterThan(3);
  });

  it('a Burrow Viper dives out of reach, marks where it will erupt, and comes up there', () => {
    const w = arena(HOLLOWS);
    const v = foe(w, 'burrowViper', 0, -260);
    v.attackTimer = 0;
    for (let i = 0; i < 1 / DT && !v.hidden; i++) tick(w);
    expect(v.hidden).toBe(true);
    const mark = w.blasts.find((b) => b.look === 'burrow')!;
    expect(mark.delay).toBeGreaterThanOrEqual(0.6);
    const hp = v.hp;
    damageEnemy(w, v, 50, 'bolt', '#fff');
    expect(v.hp).toBe(hp);
    // Underground it can't bite either.
    v.x = w.snake.x;
    v.y = w.snake.y;
    w.invuln = 0;
    updateContacts(w);
    expect(w.hp).toBe(w.stats.maxHp);
    w.invuln = 1e9;
    for (let i = 0; i < 1.2 / DT && v.hidden; i++) tick(w);
    expect(v.hidden).toBe(false);
    expect([v.x, v.y]).toEqual([mark.x, mark.y]);
    damageEnemy(w, v, 10, 'bolt', '#fff');
    expect(v.hp).toBe(hp - 10);
  });

  it('Sporemaw fans spores, then burrows down its lane and erupts at the end', () => {
    const w = arena(HOLLOWS);
    const boss = foe(w, 'boss', 0, -320);
    expect(boss.bossId).toBe('sporemaw');
    boss.attackTimer = 0;
    let fan = 0;
    for (let i = 0; i < 3 / DT && w.shots.length === 0; i++) {
      tick(w);
      if (boss.state === 'windup') fan = aimLines(boss)?.angles.length ?? 0;
    }
    expect(fan).toBe(BOSS_MOVES.spores.count);
    expect(w.shots.filter((s) => s.look === 'spore')).toHaveLength(BOSS_MOVES.spores.count);

    w.shots.length = 0;
    Object.assign(boss, { state: 'move', attackTimer: 0, moveIndex: 1 });
    for (let i = 0; i < 3 / DT && !boss.hidden; i++) tick(w);
    expect(boss.bossMove).toBe('burrow');
    expect(boss.hidden).toBe(true);
    const mark = w.blasts.find((b) => b.look === 'burrow')!;
    expect(describeHurt(hurtKey(mark.source))).toBe('Sporemaw bursting from below');
    for (let i = 0; i < 2 / DT && boss.hidden; i++) tick(w);
    expect(boss.hidden).toBe(false);
    expect(Math.hypot(boss.x - mark.x, boss.y - mark.y)).toBeLessThan(1);
  });
});

describe('the Catacombs’ foes', () => {
  it('a Bone Rattler struck down by a bolt collapses and rises again; a Nova finishes it for good', () => {
    const w = arena(CATACOMBS);
    const r = foe(w, 'rattler', 0, -200);
    const kills = w.kills;
    damageEnemy(w, r, 100, 'bolt', '#fff');
    expect(r.dead).toBe(false);
    expect(r.pile).toBeGreaterThan(0);
    expect(w.kills).toBe(kills);
    expect(w.crystals).toHaveLength(0);
    expect(w.recap.spells.bolt.kills).toBe(0);
    for (let i = 0; i < (ENEMIES.rattler.riseTime + 0.1) / DT; i++) tick(w);
    expect(r.pile).toBe(0);
    expect(r.hp).toBeCloseTo(r.maxHp * ENEMIES.rattler.riseHealth, 6);

    damageEnemy(w, r, 100, 'lightning', '#fff');
    expect(r.pile).toBeGreaterThan(0);
    damageEnemy(w, r, 1, 'nova', '#fff');
    expect(r.dead).toBe(true);
    expect(w.kills).toBe(kills + 1);
    expect(w.crystals.length).toBeGreaterThan(0);
    expect(w.recap.spells.nova.kills).toBe(1);
  });

  it('a Frost Archer draws its line, then looses a fast icicle down it', () => {
    const w = arena(CATACOMBS);
    const a = foe(w, 'frostArcher', 0, -420);
    a.attackTimer = 0;
    let drawn = 0;
    let line: ReturnType<typeof aimLines> = null;
    for (let i = 0; i < 2 / DT && w.shots.length === 0; i++) {
      tick(w);
      if (a.state === 'windup') {
        drawn += DT;
        line = aimLines(a);
      }
    }
    expect(drawn).toBeGreaterThanOrEqual(0.6);
    expect(line?.angles).toHaveLength(1);
    const shot = w.shots[0];
    expect(shot.look).toBe('icicle');
    expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(ENEMIES.frostArcher.shotSpeed, 3);
    expect(Math.atan2(shot.vy, shot.vx)).toBeCloseTo(line!.angles[0], 6);
  });

  it('a Crypt Golem slams a marked ring round itself and leaves ice', () => {
    const w = arena(CATACOMBS);
    const g = foe(w, 'golem', 0, -130);
    g.attackTimer = 0;
    for (let i = 0; i < 1 / DT && g.state !== 'windup'; i++) tick(w);
    const ring = w.blasts.find((b) => b.look === 'slam')!;
    expect(ring.r).toBe(ENEMIES.golem.slamRadius);
    expect(ring.delay).toBeGreaterThanOrEqual(0.6);
    expect([ring.x, ring.y]).toEqual([g.x, g.y]);
    for (let i = 0; i < 1.2 / DT; i++) tick(w);
    expect(Math.hypot(g.x - ring.x, g.y - ring.y)).toBeLessThan(2);
    expect(onIce(w, ring.x, ring.y)).toBe(true);
    expect(describeHurt(hurtKey(ring.source))).toBe("a Crypt Golem's slam");
  });

  it('a Wraith drifts through stone, harder to hurt while inside it, and lunges after a warning', () => {
    const w = arena(CATACOMBS);
    // The Ossuary's north wall (y 400 to 600) lies between it and the serpent.
    placeSerpent(w, 4000, 1000);
    const wr = spawnEnemy(w, 'wraith', 4000, 250);
    wr.elite = null;
    wr.attackTimer = 10;
    let inside = false;
    for (let i = 0; i < 6 / DT && wr.y < 700; i++) {
      tick(w);
      if (clearanceAt(w.map.index, wr.x, wr.y) < 0) inside = true;
    }
    expect(inside).toBe(true);
    expect(wr.y).toBeGreaterThan(600);

    wr.x = 4000;
    wr.y = 500;
    const hp = wr.hp;
    damageEnemy(w, wr, 10, 'bolt', '#fff');
    expect(wr.hp).toBeCloseTo(hp - 10 * ENEMIES.wraith.phaseArmor, 6);

    Object.assign(wr, { x: 4000, y: 800, state: 'move', attackTimer: 0 });
    let windupAt = -1;
    let lungeAt = -1;
    for (let i = 0; i < 2 / DT && lungeAt < 0; i++) {
      tick(w);
      if (wr.state === 'windup' && windupAt < 0) windupAt = w.time;
      if (wr.state === 'attack') lungeAt = w.time;
    }
    expect(lungeAt - windupAt).toBeGreaterThanOrEqual(0.6 - 1e-6);
  });

  it('Rimecoil looses icicles down the lines it drew, and lays rings of ice', () => {
    const w = arena(CATACOMBS);
    const boss = foe(w, 'boss', 0, -320);
    expect(boss.bossId).toBe('rimecoil');
    boss.attackTimer = 0;
    let lines: number[] = [];
    for (let i = 0; i < 3 / DT && w.shots.length === 0; i++) {
      tick(w);
      if (boss.state === 'windup') lines = aimLines(boss)?.angles ?? [];
    }
    expect(w.shots).toHaveLength(BOSS_MOVES.icicles.count);
    w.shots.forEach((s, i) => expect(Math.atan2(s.vy, s.vx)).toBeCloseTo(lines[i], 6));
    expect(w.shots.every((s) => s.look === 'icicle')).toBe(true);

    Object.assign(boss, { state: 'move', attackTimer: 0, moveIndex: 3 });
    const sx = w.snake.x;
    const sy = w.snake.y;
    for (let i = 0; i < 3 / DT && !w.groundFx.some((g) => g.kind === 'ice'); i++) tick(w);
    expect(boss.bossMove).toBe('iceRing');
    expect(w.groundFx.filter((g) => g.kind === 'ice').length).toBeGreaterThan(10);
    const ring = w.groundFx.find((g) => g.kind === 'ice' && Math.abs(Math.hypot(g.x - sx, g.y - sy) - BOSS_MOVES.iceRing.rings[0]) < 1)!;
    expect(onIce(w, ring.x, ring.y)).toBe(true);
  });
});
