import { describe, expect, it } from 'vitest';
import { ELITE, HEAT } from '../config';
import { difficulty, eliteChance } from '../enemies';
import { grimoireSetup, playableHeat, startMaps, unlockBlocker, UNLOCK_IDS, UNLOCKS, type UnlockId } from '../grimoire';
import { buyUnlock, commitRunResult, defaultSave, sanitizeSave, type SaveData } from '../persistence';
import { computeReward, emptyMetaLevels, KNOWN_DUOS } from '../progression';
import { KNOWN_RELICS } from '../relics';
import { createWorld, WAYSTONE_LEVELS } from '../world';

const rich = (more: Partial<SaveData> = {}): SaveData => ({ ...defaultSave(), currency: 10000, ...more });

describe('the Grimoire (M1)', () => {
  it('sells 20 one-time unlocks for several thousand shards', () => {
    const count = (kind: string) => UNLOCKS.filter((u) => u.kind === kind).length;
    expect([count('relic'), count('duo'), count('tool'), count('waystone'), count('ultimate')]).toEqual([8, 3, 5, 3, 1]);
    const total = UNLOCKS.reduce((s, u) => s + u.cost, 0);
    expect(total).toBeGreaterThan(5000);
    expect(new Set(UNLOCK_IDS).size).toBe(UNLOCK_IDS.length);
  });

  it('buys an unlock once, for its price, in order, and waystones only to maps reached', () => {
    let save = rich();
    save = buyUnlock(save, 'relic:echoStone')!;
    expect(save.grimoire).toEqual(['relic:echoStone']);
    expect(save.currency).toBe(10000 - 250);
    expect(buyUnlock(save, 'relic:echoStone')).toBeNull();
    expect(unlockBlocker('reroll2', save.grimoire, save.records.maps)).toMatch(/Second Thoughts/);
    expect(buyUnlock(save, 'reroll2')).toBeNull();
    save = buyUnlock(save, 'reroll1')!;
    expect(buyUnlock(save, 'reroll2')).not.toBeNull();
    expect(buyUnlock(save, 'way:catacombs')).toBeNull();
    save = { ...save, records: { ...save.records, maps: ['ruins', 'hollows', 'catacombs'] } };
    expect(buyUnlock(save, 'way:catacombs')).not.toBeNull();
    expect(buyUnlock({ ...save, currency: 10 }, 'fourthCard')).toBeNull();
  });

  it('adds its unlocks to every run', () => {
    const owned: UnlockId[] = ['reroll1', 'reroll2', 'banish1', 'fourthCard', 'duo:bulwark', 'relic:hourglass', 'ultReady'];
    const g = grimoireSetup(owned);
    expect([g.rerolls, g.banishes, g.fourthCard, g.ultReady]).toEqual([2, 1, true, true]);
    expect(g.duos).toEqual([...KNOWN_DUOS, 'bulwark']);
    expect(g.relics).toEqual([...KNOWN_RELICS, 'hourglass']);
    const w = createWorld(emptyMetaLevels(), () => undefined, 1, { wizard: 'arcanist', curses: [], grimoire: g });
    expect([w.rerolls, w.banishes, w.cardCount]).toEqual([4, 2, 4]);
    expect(w.relicPool).toContain('hourglass');
    expect(w.duoPool).toContain('bulwark');
  });
});

describe('waystones (M2)', () => {
  it('starts on any map whose waystone is learned, with a catch-up draft', () => {
    expect(startMaps([])).toEqual(['ruins']);
    expect(startMaps(['way:catacombs'])).toEqual(['ruins', 'catacombs']);
    const w = createWorld(emptyMetaLevels(), () => undefined, 3, { wizard: 'arcanist', curses: [], startDepth: 3, waystone: true });
    expect(w.map.def.id).toBe('catacombs');
    expect(w.draft).toEqual({ relics: 2, levels: 2 * WAYSTONE_LEVELS });
    // A development start (?depth=N) skips the catch-up.
    expect(createWorld(emptyMetaLevels(), () => undefined, 3, { wizard: 'arcanist', curses: [], startDepth: 3 }).draft).toBeNull();
  });
});

describe('heat (M3)', () => {
  it('makes foes tougher and elites commoner, and pays more', () => {
    expect(difficulty(100, 2, 3).hp).toBeCloseTo(difficulty(100, 2).hp * (1 + 3 * HEAT.hp), 6);
    expect(difficulty(100, 2, 3).damage).toBeCloseTo(difficulty(100, 2).damage * (1 + 3 * HEAT.damage), 6);
    expect(eliteChance(2, false, 2)).toBeCloseTo(ELITE.baseChance + 2 * HEAT.elite, 6);
    const run = { time: 600, kills: 200, level: 30, bossKills: 2 };
    expect(computeReward({ ...run, heat: 4 })).toBe(Math.floor(computeReward(run) * (1 + 4 * HEAT.shards)));
    expect(playableHeat(7, 3)).toBe(3);
    expect(createWorld(emptyMetaLevels(), () => undefined, 1, { wizard: 'arcanist', curses: [], heat: 2 }).heat).toBe(2);
  });

  it('unlocks the next heat when a run reaches the loop at the current one', () => {
    const run = { runId: 'a', time: 1500, kills: 900, level: 40, bossKills: 4, reward: 0, depth: 5, heat: 0 };
    let save = commitRunResult(defaultSave(), run).save;
    expect([save.records.heatUnlocked, save.records.heatCleared]).toEqual([1, 0]);
    save = commitRunResult(save, { ...run, runId: 'b', depth: 4, heat: 1 }).save;
    expect([save.records.heatUnlocked, save.records.heatCleared]).toEqual([1, 0]);
    save = commitRunResult(save, { ...run, runId: 'c', heat: 1 }).save;
    expect([save.records.heatUnlocked, save.records.heatCleared]).toEqual([2, 1]);
    save = commitRunResult({ ...save, records: { ...save.records, heatUnlocked: HEAT.max } }, { ...run, runId: 'd', heat: HEAT.max }).save;
    expect(save.records.heatUnlocked).toBe(HEAT.max);
  });
});

describe('saves (M4)', () => {
  it('keeps old saves working and cleans bad Grimoire fields', () => {
    const old = sanitizeSave({ currency: 50, meta: { health: 2 }, records: { bestTime: 90 }, settings: { wizard: 'arcanist' } });
    expect(old.grimoire).toEqual([]);
    expect([old.records.heatUnlocked, old.records.heatCleared]).toEqual([0, -1]);
    expect([old.settings.heat, old.settings.startMap]).toEqual([0, 'ruins']);
    const odd = sanitizeSave({ grimoire: ['relic:quill', 'nonsense', 4, 'relic:quill'], settings: { heat: 99, startMap: 'moon' }, records: { heatUnlocked: -3 } });
    expect(odd.grimoire).toEqual(['relic:quill']);
    expect(odd.settings.heat).toBe(HEAT.max);
    expect(odd.settings.startMap).toBe('ruins');
    expect(odd.records.heatUnlocked).toBe(0);
  });
});
