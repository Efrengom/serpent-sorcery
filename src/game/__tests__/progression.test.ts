import { describe, expect, it } from 'vitest';
import { PROGRESSION, SPELLS } from '../config';
import { mulberry32 } from '../math';
import { defaultOptions } from '../options';
import {
  UPGRADES,
  UPGRADE_IDS,
  applyUpgrade,
  computeReward,
  computeStats,
  emptyMetaLevels,
  emptyUpgradeLevels,
  rollUpgradeChoices,
  segmentsForLevel,
  spellCooldown,
  survivalXpRate,
  xpToNext,
} from '../progression';
import { SAVE_KEY, buyMeta, commitRunResult, defaultSave, loadSave, parseSave, writeSave } from '../persistence';

describe('xp curve', () => {
  it('starts small and grows monotonically', () => {
    expect(xpToNext(1)).toBe(PROGRESSION.xpBase);
    for (let l = 1; l < 50; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
  });

  it('survival alone contributes meaningfully but slower than fighting', () => {
    // ~25 seconds of survival covers a chunk of level 1, not all of it.
    const passive = survivalXpRate(0) * 25;
    expect(passive).toBeGreaterThan(xpToNext(1) * 0.25);
    expect(passive).toBeLessThan(xpToNext(1));
    expect(survivalXpRate(300)).toBeGreaterThan(survivalXpRate(0));
  });

  it('adds body segments per level up to a cap', () => {
    expect(segmentsForLevel(2)).toBeGreaterThan(segmentsForLevel(1));
    expect(segmentsForLevel(1000)).toBe(segmentsForLevel(2000));
  });
});

describe('run upgrades', () => {
  it('every upgrade changes the derived stats', () => {
    const meta = emptyMetaLevels();
    const base = computeStats(emptyUpgradeLevels(), meta);
    for (const id of UPGRADE_IDS) {
      const after = computeStats(applyUpgrade(emptyUpgradeLevels(), id), meta);
      expect(after, id).not.toEqual(base);
    }
  });

  it('caps stacking at the max level', () => {
    for (const id of UPGRADE_IDS) {
      let up = emptyUpgradeLevels();
      for (let i = 0; i < 20; i++) up = applyUpgrade(up, id);
      expect(up[id]).toBe(UPGRADES[id].maxLevel);
    }
  });

  it('respects cooldown minimums', () => {
    let up = emptyUpgradeLevels();
    for (let i = 0; i < 20; i++) up = applyUpgrade(up, 'haste');
    const stats = computeStats(up, emptyMetaLevels());
    expect(spellCooldown('bolt', stats)).toBeGreaterThanOrEqual(SPELLS.bolt.minCooldown);
    expect(spellCooldown('nova', stats)).toBeGreaterThanOrEqual(SPELLS.nova.minCooldown);
    expect(spellCooldown('nova', stats)).toBeLessThan(SPELLS.nova.cooldown);
  });

  it('rolls three distinct, non-maxed choices with current levels', () => {
    const rng = mulberry32(5);
    let up = emptyUpgradeLevels();
    up = { ...up, potency: UPGRADES.potency.maxLevel, chains: 2 };
    for (let i = 0; i < 50; i++) {
      const choices = rollUpgradeChoices(up, emptyMetaLevels(), rng);
      expect(choices).toHaveLength(3);
      expect(new Set(choices.map((c) => c.id)).size).toBe(3);
      expect(choices.some((c) => c.id === 'potency')).toBe(false);
      const chain = choices.find((c) => c.id === 'chains');
      if (chain) expect(chain.nextLevel).toBe(3);
      for (const c of choices) expect(c.description.length).toBeGreaterThan(10);
    }
  });

  it('falls back to a heal when everything is maxed', () => {
    const up = emptyUpgradeLevels();
    for (const id of UPGRADE_IDS) up[id] = UPGRADES[id].maxLevel;
    const choices = rollUpgradeChoices(up, emptyMetaLevels(), mulberry32(1));
    expect(choices.map((c) => c.id)).toContain('restore');
  });

  it('meta upgrades raise starting stats', () => {
    const base = computeStats(emptyUpgradeLevels(), emptyMetaLevels());
    const boosted = computeStats(emptyUpgradeLevels(), { health: 2, damage: 1, pickup: 1, wisdom: 1 });
    expect(boosted.maxHp).toBe(base.maxHp + 20);
    expect(boosted.damageMult).toBeGreaterThan(base.damageMult);
    expect(boosted.pickupRadius).toBeGreaterThan(base.pickupRadius);
    expect(boosted.xpMult).toBeGreaterThan(base.xpMult);
  });
});

describe('rewards and persistence', () => {
  it('rewards survival, kills, levels and bosses', () => {
    const base = computeReward({ time: 60, kills: 10, level: 3, bossKills: 0 });
    expect(base).toBe(6 + 5 + 6);
    expect(computeReward({ time: 120, kills: 10, level: 3, bossKills: 0 })).toBeGreaterThan(base);
    expect(computeReward({ time: 60, kills: 10, level: 3, bossKills: 1 })).toBe(base + 50);
    expect(computeReward({ time: -5, kills: -1, level: 0, bossKills: 0 })).toBe(0);
  });

  it('awards each run exactly once', () => {
    const run = { runId: 'run-1', time: 95, kills: 30, level: 5, bossKills: 0, reward: 0 };
    const first = commitRunResult(defaultSave(), run);
    expect(first.awarded).toBe(true);
    expect(first.save.currency).toBe(computeReward(run));
    expect(first.save.records.totalRuns).toBe(1);
    const again = commitRunResult(first.save, run);
    expect(again.awarded).toBe(false);
    expect(again.save.currency).toBe(first.save.currency);
    const next = commitRunResult(first.save, { ...run, runId: 'run-2', time: 40 });
    expect(next.save.records.bestTime).toBe(95);
    expect(next.newBestTime).toBe(false);
  });

  it('records the deepest depth, the maps reached (for the atlas) and containers smashed', () => {
    const fresh = defaultSave().records;
    expect([fresh.deepest, fresh.maps, fresh.breakables]).toEqual([1, ['ruins'], 0]);
    const run = { runId: 'deep-1', time: 700, kills: 300, level: 20, bossKills: 2, reward: 0, depth: 3, maps: ['ruins', 'hollows', 'catacombs'] as const, breakables: 40 };
    const first = commitRunResult(defaultSave(), { ...run, maps: [...run.maps] }).save.records;
    expect(first.deepest).toBe(3);
    expect(first.maps).toEqual(['ruins', 'hollows', 'catacombs']);
    expect(first.breakables).toBe(40);
    // A shallower run adds what it smashed but never forgets a deeper map.
    const next = commitRunResult({ ...defaultSave(), records: first }, { ...run, runId: 'deep-2', depth: 1, maps: ['ruins'], breakables: 5 }).save.records;
    expect(next.deepest).toBe(3);
    expect(next.maps).toEqual(['ruins', 'hollows', 'catacombs']);
    expect(next.breakables).toBe(45);
  });

  it('cleans the new records on load: old saves get defaults, junk is dropped, maps stay in run order', () => {
    const old = parseSave(JSON.stringify({ records: { bestTime: 100, totalRuns: 4 } }));
    expect([old.records.deepest, old.records.maps, old.records.breakables]).toEqual([1, ['ruins'], 0]);
    const odd = parseSave(JSON.stringify({ records: { deepest: -3, maps: ['ember', 'moon', 4, 'hollows'], breakables: 'lots' } }));
    expect(odd.records.deepest).toBe(1);
    expect(odd.records.maps).toEqual(['ruins', 'hollows', 'ember']);
    expect(odd.records.breakables).toBe(0);
  });

  it('buys capped permanent upgrades only when affordable', () => {
    let save = { ...defaultSave(), currency: 1000 };
    for (let i = 0; i < 10; i++) save = buyMeta(save, 'pickup') ?? save;
    expect(save.meta.pickup).toBe(3);
    expect(save.currency).toBe(1000 - 20 - 45 - 80);
    expect(buyMeta({ ...defaultSave(), currency: 5 }, 'health')).toBeNull();
  });

  it('recovers from missing or malformed saves', () => {
    expect(parseSave(null)).toEqual(defaultSave());
    expect(parseSave('not json {')).toEqual(defaultSave());
    expect(parseSave('[1,2,3]')).toEqual(defaultSave());
    const weird = parseSave(
      JSON.stringify({
        currency: -50,
        meta: { health: 99, damage: 'lots', pickup: 1.7 },
        records: { bestTime: Infinity, totalRuns: 3 },
        settings: { muted: 'yes', volume: 5 },
        lastRunId: 42,
      }),
    );
    expect(weird.currency).toBe(0);
    expect(weird.meta).toEqual({ health: 5, damage: 0, pickup: 1, wisdom: 0 });
    expect(weird.records.bestTime).toBe(0);
    expect(weird.records.totalRuns).toBe(3);
    expect(weird.settings).toEqual({ muted: false, volume: 1, pixelArt: false, musicVolume: 0.55, wizard: 'arcanist', curses: [], ...defaultOptions() });
    // Unknown wizards and curses are dropped; duplicates collapse.
    const odd = parseSave(JSON.stringify({ settings: { wizard: 'lich', curses: ['glass', 'nope', 'glass', 3] }, records: { bossKills: -2 } }));
    expect(odd.settings.wizard).toBe('arcanist');
    expect(odd.settings.curses).toEqual(['glass']);
    expect(odd.records.bossKills).toBe(0);
    // Older saves stored music as an on/off flag.
    expect(parseSave(JSON.stringify({ settings: { music: false } })).settings.musicVolume).toBe(0);
    expect(parseSave(JSON.stringify({ settings: { music: true } })).settings.musicVolume).toBe(0.55);
    expect(parseSave(JSON.stringify({ settings: { musicVolume: 3 } })).settings.musicVolume).toBe(1);
    expect(weird.lastRunId).toBe('');
  });

  it('only buyMeta can raise permanent upgrade levels', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 200; i++) {
      const meta = {
        health: Math.floor(rng() * 6),
        damage: Math.floor(rng() * 6),
        pickup: Math.floor(rng() * 4),
        wisdom: Math.floor(rng() * 4),
      };
      const base = { ...defaultSave(), currency: Math.floor(rng() * 500), meta };
      // Banking any run leaves upgrades untouched.
      const run = { runId: `r${i}`, time: rng() * 900, kills: Math.floor(rng() * 900), level: 1 + Math.floor(rng() * 30), bossKills: Math.floor(rng() * 3), reward: 0 };
      expect(commitRunResult(base, run).save.meta).toEqual(meta);
      // Loading never raises a level; it can only clamp invalid values down.
      const noisy = { ...base, meta: { health: meta.health + rng() * 3, damage: -rng() * 2, pickup: meta.pickup, wisdom: 'x' } };
      const loaded = parseSave(JSON.stringify(noisy)).meta;
      for (const k of Object.keys(loaded) as (keyof typeof loaded)[]) {
        expect(loaded[k]).toBeLessThanOrEqual(Math.max(0, Number(noisy.meta[k]) || 0));
      }
      // A round trip preserves levels exactly.
      expect(parseSave(JSON.stringify(base)).meta).toEqual(meta);
    }
  });

  it('round-trips through storage and survives a throwing store', () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    const save = {
      ...defaultSave(),
      currency: 77,
      settings: { ...defaultSave().settings, muted: true, volume: 0.3, pixelArt: true, musicVolume: 0.2, wizard: 'frostcoil' as const, curses: ['glass' as const] },
    };
    expect(writeSave(save, store)).toBe(true);
    expect(map.has(SAVE_KEY)).toBe(true);
    expect(loadSave(store)).toEqual(save);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadSave(broken)).toEqual(defaultSave());
    expect(writeSave(save, broken)).toBe(false);
  });
});
