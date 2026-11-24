import { describe, expect, it } from 'vitest';
import { buffDuration, damageBreakable, grantBuff, spawnBreakable, urnBuffChance } from '../breakables';
import { hurtPlayer } from '../combat';
import { BREAKABLES, BUFFS, COOLDOWN_FLOOR, SNAKE } from '../config';
import { grimoireSetup, type UnlockId } from '../grimoire';
import { commitRunResult, defaultSave, parseSave } from '../persistence';
import {
  combineMods,
  computeReward,
  computeStats,
  emptyMetaLevels,
  emptyUpgradeLevels,
  META_IDS,
  META_TUNING,
  META_UPGRADES,
  metaMaxLevel,
  NO_MODS,
  segmentsForLevel,
  type MetaLevels,
} from '../progression';
import { PHOENIX, RELIC_TUNING, takeRelic } from '../relics';
import { runShards } from '../sites';
import { createWorld, refreshStats, type World } from '../world';

const meta = (more: Partial<MetaLevels> = {}): MetaLevels => ({ ...emptyMetaLevels(), ...more });
const stats = (more: Partial<MetaLevels>) => computeStats(emptyUpgradeLevels(), meta(more));
const world = (m: Partial<MetaLevels> = {}, owned: UnlockId[] = []): World =>
  createWorld(meta(m), () => undefined, 21, { wizard: 'arcanist', curses: [], grimoire: grimoireSetup(owned) });
const bite = { kind: 'chaser', attack: 'bite' } as const;

describe("the shop's stat lines", () => {
  it('has eleven lines, each costing more every rank and saying what every rank does', () => {
    expect(META_IDS).toHaveLength(11);
    for (const id of META_IDS) {
      const costs = META_UPGRADES[id].costs;
      for (let i = 1; i < costs.length; i++) expect(costs[i], id).toBeGreaterThan(costs[i - 1]);
      for (let l = 1; l <= metaMaxLevel(id); l++) expect(META_UPGRADES[id].describe(l), id).toMatch(/\d/);
    }
  });

  it('loads an older save with the new lines at nothing', () => {
    const old = parseSave(JSON.stringify({ ...defaultSave(), meta: { health: 2, damage: 1, pickup: 1, wisdom: 1 } }));
    expect(old.meta).toEqual(meta({ health: 2, damage: 1, pickup: 1, wisdom: 1 }));
  });

  it('Ironscale Hide softens what foes deal, on top of everything else', () => {
    expect(stats({ hide: 4 }).damageTaken).toBeCloseTo(1 - 4 * META_TUNING.hide, 6);
    const w = world({ hide: 4 });
    w.invuln = 0;
    hurtPlayer(w, 100, bite);
    expect(w.stats.maxHp - w.hp).toBe(Math.round(100 * (1 - 4 * META_TUNING.hide)));
    // Stone stings the same.
    const stone = world({ hide: 4 });
    stone.invuln = 0;
    hurtPlayer(stone, 10, { kind: 'wall', attack: 'pillar' });
    expect(stone.stats.maxHp - stone.hp).toBe(10);
  });

  it('Rune Fluency shortens cooldowns, but never past the floor', () => {
    expect(stats({ fluency: 4 }).cooldownMult).toBeCloseTo(1 - 4 * META_TUNING.fluency, 6);
    const fast = computeStats({ ...emptyUpgradeLevels(), haste: 5 }, meta({ fluency: 4 }), combineMods(NO_MODS, { cooldownMult: 0.75 }, { cooldownMult: 0.88 }));
    expect(fast.cooldownMult).toBe(COOLDOWN_FLOOR);
  });

  it('Mending Coils regenerates health, beside Shed Skin', () => {
    expect(stats({ mending: 3 }).regenPerSec).toBeCloseTo(3 * META_TUNING.mending, 6);
    expect(computeStats({ ...emptyUpgradeLevels(), regen: 1 }, meta({ mending: 1 })).regenPerSec).toBeCloseTo(0.6 + META_TUNING.mending, 6);
  });

  it('Long Coils starts the body longer and keeps the extra as it grows', () => {
    expect(segmentsForLevel(1, 9)).toBe(SNAKE.startSegments + 9);
    expect(segmentsForLevel(5, 9)).toBe(segmentsForLevel(5) + 9);
    expect(segmentsForLevel(100, 9)).toBe(SNAKE.maxSegments);
    const w = world({ length: 3 });
    expect([w.snake.segmentCount, w.snake.segmentTarget]).toEqual([SNAKE.startSegments + 9, SNAKE.startSegments + 9]);
    expect(w.snake.segments).toHaveLength(SNAKE.startSegments + 9);
    expect(world().snake.segmentCount).toBe(SNAKE.startSegments);
  });

  it('Lingering Elixirs makes timed buffs last longer', () => {
    expect(buffDuration('empower', meta({ lingering: 3 }))).toBeCloseTo(BUFFS.empower.duration * (1 + 3 * META_TUNING.lingering), 6);
    expect(buffDuration('empower')).toBe(BUFFS.empower.duration);
    const w = world({ lingering: 2 });
    grantBuff(w, 'quickening');
    expect(w.buffs.quickening).toBeCloseTo(BUFFS.quickening.duration * (1 + 2 * META_TUNING.lingering), 6);
  });

  it("Fortune's Eye finds more buffs in urns, and second ones in reliquaries", () => {
    const rate = (size: 'small' | 'large', fortune: number, n: number) => {
      const w = world({ fortune });
      let buffs = 0;
      for (let i = 0; i < n; i++) {
        w.pickups.length = 0;
        w.crystals.length = 0;
        w.map.slots = [{ x: 3200, y: 1700, size }];
        w.breakables.length = 0;
        w.refills.length = 0;
        damageBreakable(w, spawnBreakable(w, 0), 1e6);
        buffs += w.pickups.filter((p) => p.kind !== 'heal' && p.kind !== 'bigHeal').length;
      }
      return buffs / n;
    };
    expect(urnBuffChance(meta({ fortune: 3 }))).toEqual({ small: BREAKABLES.small.buff + 3 * META_TUNING.fortuneSmall, secondLarge: 3 * META_TUNING.fortuneLarge });
    expect(rate('small', 3, 4000)).toBeCloseTo(BREAKABLES.small.buff + 3 * META_TUNING.fortuneSmall, 1);
    expect(rate('large', 0, 300)).toBe(1);
    expect(rate('large', 3, 2000)).toBeCloseTo(1 + 3 * META_TUNING.fortuneLarge, 1);
  });

  it("Serpent's Hoard banks more shards from a run, and fills the merchant's purse", () => {
    // 60 for the time, 100 for kills, 57 for levels and 100 for bosses: 317.
    const run = { time: 600, kills: 200, level: 20, bossKills: 2 };
    expect(computeReward(run)).toBe(317);
    expect(computeReward({ ...run, shardBonus: 1.3 })).toBe(Math.floor(317 * 1.3));
    // A doctored bonus can't go past the top rank, or below none.
    expect(computeReward({ ...run, shardBonus: 9 })).toBe(Math.floor(317 * 1.3));
    expect(computeReward({ ...run, shardBonus: 0.1 })).toBe(317);
    expect(computeReward({ ...run, shardBonus: NaN })).toBe(317);
    const out = commitRunResult(defaultSave(), { ...run, runId: 'hoard', reward: 0, shardBonus: 1.3 });
    expect(out.save.currency - out.achievementShards).toBe(Math.floor(317 * 1.3));
    const purse = (w: World) => {
      Object.assign(w, { time: 600, kills: 200, level: 20, bossKills: 2 });
      return runShards(w);
    };
    expect(purse(world({ hoard: 3 }))).toBe(Math.floor(317 * 1.3));
    expect(purse(world())).toBe(317);
  });
});

describe('the Phoenix Scale', () => {
  it('turns one killing blow a run into half health, a Nova and a few seconds of safety', () => {
    const w = world({}, ['phoenix']);
    expect(w.phoenix).toBe(true);
    w.invuln = 0;
    hurtPlayer(w, 1000, bite);
    expect(w.hp).toBe(Math.round(w.stats.maxHp * PHOENIX.health));
    expect([w.phoenix, w.invuln, w.novas.length, w.recap.killedBy]).toEqual([false, PHOENIX.safety, 1, null]);
    w.invuln = 0;
    hurtPlayer(w, 1000, bite);
    expect(w.hp).toBe(0);
    expect(w.recap.killedBy).not.toBeNull();
  });

  it('waits behind Sacrificial Scales, whose own moment of safety now holds', () => {
    const w = world({}, ['phoenix']);
    takeRelic(w, 'sacrificialScales');
    refreshStats(w);
    w.invuln = 0;
    hurtPlayer(w, 1000, bite);
    expect(w.hp).toBe(Math.round(w.stats.maxHp * RELIC_TUNING.sacrificeHealth));
    expect(w.phoenix).toBe(true);
    expect(w.invuln).toBeCloseTo(SNAKE.invulnTime * 1.5, 6);
    w.invuln = 0;
    hurtPlayer(w, 1000, bite);
    expect([w.phoenix, w.hp]).toEqual([false, Math.round(w.stats.maxHp * PHOENIX.health)]);
  });

  it('does nothing unless bought', () => {
    const w = world();
    expect(w.phoenix).toBe(false);
    w.invuln = 0;
    hurtPlayer(w, 1000, bite);
    expect(w.hp).toBe(0);
    expect(w.invuln).toBe(SNAKE.invulnTime);
  });
});
