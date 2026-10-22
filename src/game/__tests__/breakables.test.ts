import { describe, expect, it } from 'vitest';
import { BUFF_IDS, damageBreakable, grantBuff, rollBuff, spawnBreakable, updateBreakables, updateBuffs, updatePickups } from '../breakables';
import { hurtPlayer, damageEnemy, updateShots } from '../combat';
import { BREAKABLES, BUFFS, PICKUPS, SNAKE, SPELLS } from '../config';
import { spawnEnemy } from '../enemies';
import { computeReward, emptyMetaLevels } from '../progression';
import { Snake } from '../snake';
import { castSpell, tickCooldowns, updateBolts } from '../spells';
import { createWorld, type Breakable, type World } from '../world';

const DT = 1 / 120;
const newWorld = (seed = 21): World => createWorld(emptyMetaLevels(), () => undefined, seed);

/** Clears the map's breakables and puts one of the given size at (x, y). */
function only(w: World, size: 'small' | 'large', x: number, y: number): Breakable {
  w.map.slots = [{ x, y, size }];
  w.breakables.length = 0;
  w.refills.length = 0;
  return spawnBreakable(w, 0);
}

describe('breakables on the Sunken Ruins', () => {
  it('fill every large slot and about 70% of the small ones at the start', () => {
    const w = newWorld();
    const small = w.map.slots.filter((s) => s.size === 'small').length;
    const large = w.map.slots.filter((s) => s.size === 'large').length;
    expect(large).toBeGreaterThanOrEqual(20);
    expect(small).toBeGreaterThanOrEqual(120);
    expect(w.breakables.filter((b) => b.size === 'large')).toHaveLength(large);
    const filled = w.breakables.filter((b) => b.size === 'small').length / small;
    expect(filled).toBeGreaterThan(0.55);
    expect(filled).toBeLessThan(0.85);
  });

  it('an urn shatters when the head runs into it and drops a little XP', () => {
    const w = newWorld();
    const urn = only(w, 'small', 3200, 1700);
    w.snake.reset(3200, 1700 + SNAKE.headRadius + urn.r - 2, -Math.PI / 2);
    updateBreakables(w, DT);
    expect(w.breakables).toHaveLength(0);
    expect(w.recap.breakables).toBe(1);
    const xp = w.crystals.reduce((s, c) => s + c.value, 0);
    expect(xp).toBeGreaterThanOrEqual(BREAKABLES.small.xp[0]);
    expect(xp).toBeLessThanOrEqual(BREAKABLES.small.xp[1]);
    expect(w.recap.breakableXp).toBe(xp);
  });

  it('a reliquary bounces the head off unhurt, and takes about three bolts to break', () => {
    const w = newWorld();
    const rel = only(w, 'large', 3200, 1700);
    w.invuln = 0;
    const hp = w.hp;
    w.snake.reset(3200, 1700 + SNAKE.headRadius + rel.r - 3, -Math.PI / 2);
    updateBreakables(w, DT);
    expect(w.hp).toBe(hp);
    expect(Math.sin(w.snake.heading)).toBeGreaterThan(0.5);
    expect(w.snake.steerLock).toBeGreaterThan(0);
    expect(w.breakables).toHaveLength(1);
    const bolt = SPELLS.bolt.damage;
    damageBreakable(w, rel, bolt);
    damageBreakable(w, rel, bolt);
    expect(w.breakables).toHaveLength(1);
    damageBreakable(w, rel, bolt);
    expect(w.breakables).toHaveLength(0);
    // Its XP, and always a buff.
    expect(w.crystals.reduce((s, c) => s + c.value, 0)).toBe(BREAKABLES.large.xp);
    expect(w.pickups.some((p) => p.kind !== 'heal' && p.kind !== 'bigHeal')).toBe(true);
  });

  it('lets bolts pass through urns without using them up, on to the foe behind', () => {
    const w = newWorld();
    only(w, 'small', 3200, 1800);
    w.spawnAcc = -1e9;
    const e = spawnEnemy(w, 'chaser', 3200, 1650);
    e.elite = null;
    e.shield = 0;
    const hp = e.hp;
    w.bolts.push({ x: 3200, y: 1900, vx: 0, vy: -SPELLS.bolt.speed, r: SPELLS.bolt.radius, damage: 5, pierce: 0, life: 1, hit: [], seek: false, bounces: 0 });
    for (let i = 0; i < 30; i++) updateBolts(w, DT);
    expect(w.breakables).toHaveLength(0);
    expect(e.hp).toBeLessThan(hp);
  });

  it('stops hostile shots at reliquaries, which foes never break', () => {
    const w = newWorld();
    only(w, 'large', 3200, 1800);
    w.shots.push({ x: 3200, y: 1700, vx: 0, vy: 300, r: 8, damage: 5, life: 5, spin: 0, source: { kind: 'caster', attack: 'shot' }, look: 'orb' });
    for (let i = 0; i < 60 && w.shots.length; i++) updateShots(w, DT);
    expect(w.shots).toHaveLength(0);
    expect(w.breakables[0].hp).toBe(w.breakables[0].maxHp);
  });

  it('refills a broken slot after its time, but only well out of sight', () => {
    const w = newWorld();
    const urn = only(w, 'small', 3200, 1700);
    damageBreakable(w, urn, 1);
    expect(w.breakables).toHaveLength(0);
    w.snake.reset(3200, 2100, 0);
    w.time += BREAKABLES.small.refill + 1;
    updateBreakables(w, DT);
    expect(w.breakables).toHaveLength(0);
    w.snake.reset(600, 600, 0);
    updateBreakables(w, DT);
    expect(w.breakables).toHaveLength(1);
  });
});

describe('drop tables', () => {
  it('drop heals and buffs at their rates, heals twice as often when hurt', () => {
    const rates = (size: 'small' | 'large', low: boolean, n: number) => {
      const w = newWorld(5);
      const counts = { heal: 0, bigHeal: 0, buff: 0 };
      for (let i = 0; i < n; i++) {
        w.hp = low ? w.stats.maxHp * 0.2 : w.stats.maxHp;
        w.pickups.length = 0;
        w.crystals.length = 0;
        const b = only(w, size, 3200, 1700);
        damageBreakable(w, b, 1e6);
        for (const p of w.pickups) {
          if (p.kind === 'heal') counts.heal++;
          else if (p.kind === 'bigHeal') counts.bigHeal++;
          else counts.buff++;
        }
      }
      return { heal: counts.heal / n, bigHeal: counts.bigHeal / n, buff: counts.buff / n };
    };
    const small = rates('small', false, 3000);
    expect(small.heal).toBeCloseTo(BREAKABLES.small.heal, 1);
    expect(small.buff).toBeCloseTo(BREAKABLES.small.buff, 1);
    expect(rates('small', true, 3000).heal).toBeCloseTo(BREAKABLES.small.heal * 2, 1);
    const large = rates('large', false, 600);
    expect(large.buff).toBe(1);
    expect(large.heal).toBeCloseTo(BREAKABLES.large.heal, 1);
    const lowLarge = rates('large', true, 600);
    expect(lowLarge.heal).toBe(0);
    expect(lowLarge.bigHeal).toBeCloseTo(BREAKABLES.large.heal, 1);
  });

  it('roll each buff by its weight', () => {
    const w = newWorld(8);
    const n = 20000;
    const counts = Object.fromEntries(BUFF_IDS.map((id) => [id, 0])) as Record<string, number>;
    for (let i = 0; i < n; i++) counts[rollBuff(w)]++;
    const total = BUFF_IDS.reduce((s, id) => s + BUFFS[id].weight, 0);
    for (const id of BUFF_IDS) expect(counts[id] / n, id).toBeCloseTo(BUFFS[id].weight / total, 1);
  });
});

describe('pickups', () => {
  it('leave heals on the ground while health is full, and heal when it isn’t', () => {
    const w = newWorld();
    w.pickups.push({ id: 1, kind: 'heal', x: w.snake.x, y: w.snake.y, vx: 0, vy: 0, t: 0, magnet: false });
    updatePickups(w, DT);
    expect(w.pickups).toHaveLength(1);
    w.hp = 50;
    updatePickups(w, DT);
    expect(w.pickups).toHaveLength(0);
    expect(w.hp).toBe(50 + PICKUPS.smallHeal);
    expect(w.recap.healed).toBe(PICKUPS.smallHeal);
    w.hp = 10;
    w.pickups.push({ id: 2, kind: 'bigHeal', x: w.snake.x, y: w.snake.y, vx: 0, vy: 0, t: 0, magnet: false });
    updatePickups(w, DT);
    expect(w.hp).toBe(10 + Math.round(w.stats.maxHp * PICKUPS.largeHeal));
  });
});

describe('buffs', () => {
  it('time out, and picking one up again restarts its clock rather than stacking', () => {
    const w = newWorld();
    grantBuff(w, 'empower');
    expect(w.buffs.empower).toBe(BUFFS.empower.duration);
    for (let i = 0; i < 5 / DT; i++) updateBuffs(w, DT);
    expect(w.buffs.empower).toBeCloseTo(BUFFS.empower.duration - 5, 3);
    grantBuff(w, 'empower');
    expect(w.buffs.empower).toBe(BUFFS.empower.duration);
    for (let i = 0; i < (BUFFS.empower.duration + 0.5) / DT; i++) updateBuffs(w, DT);
    expect(w.buffs.empower).toBe(0);
    expect(w.recap.buffs).toBe(2);
  });

  it('Quickening speeds every cooldown up by half', () => {
    const w = newWorld();
    w.cooldowns.nova = 4;
    w.cooldowns.bolt = 4;
    grantBuff(w, 'quickening');
    for (let i = 0; i < 120; i++) tickCooldowns(w, DT);
    expect(w.cooldowns.nova).toBeCloseTo(4 - BUFFS.quickening.cooldownRate, 3);
    w.buffs.quickening = 0;
    for (let i = 0; i < 120; i++) tickCooldowns(w, DT);
    expect(w.cooldowns.nova).toBeCloseTo(4 - BUFFS.quickening.cooldownRate - 1, 3);
  });

  it('Empower multiplies spell damage, on top of a Perfect cast', () => {
    const w = newWorld();
    w.spawnAcc = -1e9;
    const e = spawnEnemy(w, 'brute', 3000, 1500);
    e.elite = null;
    e.shield = 0;
    e.hp = e.maxHp = 1e6;
    grantBuff(w, 'empower');
    damageEnemy(w, e, 10, 'bolt', '#fff');
    expect(1e6 - e.hp).toBeCloseTo(10 * BUFFS.empower.damage, 6);
    // Constrict isn't a spell.
    damageEnemy(w, e, 10, 'constrict', '#fff');
    expect(1e6 - e.hp).toBeCloseTo(10 * BUFFS.empower.damage + 10, 6);
    // A Perfect bolt (power 1.35) under Empower.
    castSpell(w, 'bolt', { x: 3000, y: 1500 }, 1.35);
    expect(w.bolts[0].damage).toBeCloseTo(SPELLS.bolt.damage * w.stats.damageMult * 1.35, 6);
  });

  it('Swiftscale speeds the serpent and its turning alike', () => {
    const a = new Snake(700, 400, 0);
    const b = new Snake(700, 400, 0);
    b.speedMult = BUFFS.swiftscale.speed;
    for (let i = 0; i < 60; i++) {
      a.update(DT, 0, 0);
      b.update(DT, 0, 0);
    }
    expect((b.x - 700) / (a.x - 700)).toBeCloseTo(BUFFS.swiftscale.speed, 6);
  });

  it('Stoneskin blocks one hit from a foe but not a wall', () => {
    const w = newWorld();
    w.invuln = 0;
    grantBuff(w, 'stoneskin');
    const hp = w.hp;
    expect(hurtPlayer(w, 8, { kind: 'wall', attack: 'pillar' })).toBe(true);
    expect(w.buffs.stoneskin).toBeGreaterThan(0);
    w.invuln = 0;
    expect(hurtPlayer(w, 20, { kind: 'chaser', attack: 'bite' })).toBe(false);
    expect(w.hp).toBe(hp - 8);
    expect(w.buffs.stoneskin).toBe(0);
    w.invuln = 0;
    expect(hurtPlayer(w, 20, { kind: 'chaser', attack: 'bite' })).toBe(true);
  });

  it('Lodestone pulls in every crystal, and Shard Caches add to the reward', () => {
    const w = newWorld();
    w.crystals.push({ x: 100, y: 100, vx: 0, vy: 0, value: 1, magnet: false, t: 0 }, { x: 6000, y: 3000, vx: 0, vy: 0, value: 1, magnet: false, t: 0 });
    grantBuff(w, 'lodestone');
    expect(w.crystals.every((c) => c.magnet)).toBe(true);
    grantBuff(w, 'shardCache');
    expect(w.bonusShards).toBe(BUFFS.shardCache.shards);
    w.depth = 3;
    grantBuff(w, 'shardCache');
    expect(w.bonusShards).toBe(2 * BUFFS.shardCache.shards + 2 * BUFFS.shardCache.perDepth);
    const run = { time: 0, kills: 0, level: 1, bossKills: 0 };
    expect(computeReward({ ...run, bonusShards: 9, shardMult: 1.5 })).toBe(Math.floor(9 * 1.5));
  });
});
