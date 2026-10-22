import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_IDS, ACHIEVEMENTS, newAchievements } from '../achievements';
import { BEAST_IDS, bestiaryPages } from '../bestiary';
import { killEnemy } from '../combat';
import { CURSE_IDS } from '../curses';
import { dailyDate, dailyScore, dailySetup, previousDay } from '../daily';
import { spawnEnemy } from '../enemies';
import { commitRunResult, defaultSave, parseSave, type RunResult } from '../persistence';
import { computeReward, emptyMetaLevels } from '../progression';
import { WIZARD_IDS } from '../wizards';
import { createWorld } from '../world';

const run = (over: Partial<RunResult> = {}): RunResult => ({ runId: `r${Math.random()}`, time: 300, kills: 120, level: 9, bossKills: 0, reward: 0, ...over });

describe('the daily run', () => {
  it('is the same for everyone on a day, and different the next', () => {
    const a = dailySetup('2026-10-22');
    expect(dailySetup('2026-10-22')).toEqual(a);
    expect(WIZARD_IDS).toContain(a.wizard);
    expect(CURSE_IDS).toContain(a.curse);
    const week = ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'].map(dailySetup);
    expect(new Set(week.map((d) => d.seed)).size).toBe(7);
    expect(new Set(week.map((d) => d.wizard)).size).toBeGreaterThan(1);
    expect(dailyDate(new Date('2026-10-22T23:59:00Z'))).toBe('2026-10-22');
    expect(previousDay('2026-11-01')).toBe('2026-10-31');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });

  it('builds the same maps from the same seed', () => {
    const d = dailySetup('2026-10-22');
    const setup = { wizard: d.wizard, curses: [d.curse], seed: d.seed, daily: d.date };
    const a = createWorld(emptyMetaLevels(), () => undefined, d.seed, setup);
    const b = createWorld(emptyMetaLevels(), () => undefined, d.seed, setup);
    expect(a.breakables.map((x) => [x.x, x.y])).toEqual(b.breakables.map((x) => [x.x, x.y]));
    expect(a.sites.map((x) => [x.kind, x.x, x.y])).toEqual(b.sites.map((x) => [x.kind, x.x, x.y]));
  });

  it('scores time, foes, levels and Archmages, and a win most of all', () => {
    const plain = dailyScore(run());
    expect(plain).toBe(300 + 120 * 2 + 9 * 15);
    expect(dailyScore(run({ bossKills: 2 }))).toBe(plain + 600);
    expect(dailyScore(run({ won: true }))).toBe(plain + 3000);
  });

  it('keeps the day’s best and tries, and a streak of days played in a row', () => {
    let save = defaultSave();
    let out = commitRunResult(save, run({ daily: '2026-10-20', score: 800 }));
    expect(out.dailyBest).toBe(true);
    save = out.save;
    out = commitRunResult(save, run({ daily: '2026-10-20', score: 500 }));
    expect(out.dailyBest).toBe(false);
    save = out.save;
    expect(save.records).toMatchObject({ dailyDate: '2026-10-20', dailyBest: 800, dailyPlays: 2, dailyStreak: 1 });
    save = commitRunResult(save, run({ daily: '2026-10-21', score: 300 })).save;
    expect(save.records).toMatchObject({ dailyDate: '2026-10-21', dailyBest: 300, dailyPlays: 1, dailyStreak: 2 });
    // A missed day starts the streak again; an ordinary run leaves the daily alone.
    save = commitRunResult(save, run()).save;
    save = commitRunResult(save, run({ daily: '2026-10-23', score: 100 })).save;
    expect(save.records.dailyStreak).toBe(1);
  });
});

describe('achievements', () => {
  it('are earned once each, pay their shards, and survive a reload', () => {
    let save = defaultSave();
    const firstRun = run({ bossKills: 1, depth: 2 });
    const first = commitRunResult(save, firstRun);
    expect(first.achievements).toEqual(['firstBlood']);
    expect(first.achievementShards).toBe(ACHIEVEMENTS.firstBlood.reward);
    expect(first.save.currency).toBe(computeReward(firstRun) + ACHIEVEMENTS.firstBlood.reward);
    save = first.save;
    const again = commitRunResult(save, run({ bossKills: 1 }));
    expect(again.achievements).toEqual([]);
    expect(parseSave(JSON.stringify(again.save)).achievements).toEqual(['firstBlood']);
    expect(parseSave(JSON.stringify({ achievements: ['firstBlood', 'madeUp', 7] })).achievements).toEqual(['firstBlood']);
  });

  it('check feats within a run as well as lifetime records', () => {
    const records = defaultSave().records;
    const feats = run({
      won: true,
      curses: ['frenzy', 'glass', 'swarm'],
      relics: ['ouroboros', 'glassFang', 'thickHide', 'lodestar', 'hourglass', 'frenziedHeart'],
    });
    const earned = newAchievements({ ...records, wins: 1, winners: ['arcanist'] }, feats, []);
    expect(earned).toEqual(expect.arrayContaining(['ascendant', 'cursedCrown', 'hoarder']));
    expect(earned).not.toContain('fourCrowns');
    expect(newAchievements({ ...records, winners: [...WIZARD_IDS] }, run(), [])).toContain('fourCrowns');
    // Every achievement has a name, a description and a reward.
    for (const id of ACHIEVEMENT_IDS) expect(ACHIEVEMENTS[id].name && ACHIEVEMENTS[id].description && ACHIEVEMENTS[id].reward > 0).toBeTruthy();
  });
});

describe('the bestiary', () => {
  it('lists every foe and Archmage once, by map, with the Ascendant last', () => {
    const listed = bestiaryPages().flatMap((p) => p.beasts);
    expect([...listed].sort()).toEqual([...BEAST_IDS].sort());
    expect(listed.at(-1)).toBe('ascendant');
  });

  it('counts each kind a run defeats, bosses by name, into the save', () => {
    const w = createWorld(emptyMetaLevels(), () => undefined, 3);
    killEnemy(w, spawnEnemy(w, 'chaser', 1000, 1000));
    killEnemy(w, spawnEnemy(w, 'chaser', 1100, 1000));
    killEnemy(w, spawnEnemy(w, 'boss', 1200, 1000));
    expect(w.recap.slain).toEqual({ chaser: 2, ouroboros: 1 });
    let save = defaultSave();
    save = commitRunResult(save, run({ kills: 3, recap: w.recap })).save;
    save = commitRunResult(save, run({ kills: 3, recap: w.recap })).save;
    expect(save.records.bestiary).toEqual({ chaser: 4, ouroboros: 2 });
    expect(save.records.totalKills).toBe(6);
    expect(parseSave(JSON.stringify(save)).records.bestiary).toEqual({ chaser: 4, ouroboros: 2 });
    expect(parseSave(JSON.stringify({ records: { bestiary: { chaser: -3, dragon: 5 } } })).records.bestiary).toEqual({});
  });
});
