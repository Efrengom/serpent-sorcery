import { describe, expect, it } from 'vitest';
import { ELITE, EVOLUTIONS, SPELL_IDS, SPELLS } from '../config';
import { damageEnemy, hurtPlayer, killEnemy } from '../combat';
import { CURSES, curseEffects, shardMultiplier } from '../curses';
import { eliteChance, spawnEnemy, updateEnemies } from '../enemies';
import { mulberry32 } from '../math';
import {
  computeReward,
  emptyMetaLevels,
  emptyUpgradeLevels,
  evolutionReady,
  LEARN_FROM_LEVEL,
  rollUpgradeChoices,
  UPGRADES,
} from '../progression';
import { castSpell, enemyTimeScale, updateEchoes, updateFrost, updateWard } from '../spells';
import { isWizardUnlocked, playableWizard, WIZARD_IDS, WIZARDS } from '../wizards';
import { createWorld, type RunSetup, type World } from '../world';

const newWorld = (setup?: RunSetup): World => createWorld(emptyMetaLevels(), () => undefined, 99, setup);
const records = (bestTime = 0, bestLevel = 0, bossKills = 0) => ({ bestTime, bestLevel, bossKills });

describe('learning sigils and evolving spells at level-up', () => {
  it('only offers upgrades for spells the serpent knows', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      const ids = rollUpgradeChoices(emptyUpgradeLevels(), emptyMetaLevels(), rng, 3, { known: ['bolt', 'lightning', 'nova'], evolved: {}, level: 2 }).map((c) => c.id);
      expect(ids).not.toContain('wardRunes');
      expect(ids).not.toContain('deepFrost');
      expect(ids.some((id) => id.startsWith('learn-'))).toBe(false);
    }
  });

  it('guarantees a new sigil at level 3 and every third level after while any are unknown', () => {
    const rng = mulberry32(4);
    for (const level of [LEARN_FROM_LEVEL, LEARN_FROM_LEVEL + 3, LEARN_FROM_LEVEL + 6]) {
      const choices = rollUpgradeChoices(emptyUpgradeLevels(), emptyMetaLevels(), rng, 3, { known: ['bolt', 'lightning', 'nova'], evolved: {}, level });
      const learn = choices.find((c) => c.kind === 'learn');
      expect(learn, `level ${level}`).toBeDefined();
      expect(['ward', 'frost']).toContain(learn!.spell);
    }
    const all = rollUpgradeChoices(emptyUpgradeLevels(), emptyMetaLevels(), rng, 3, {
      known: ['bolt', 'lightning', 'nova', 'ward', 'frost'],
      evolved: {},
      level: LEARN_FROM_LEVEL,
    });
    expect(all.some((c) => c.kind === 'learn')).toBe(false);
  });

  it('offers an evolution once the spell upgrade is maxed and the partner has two ranks', () => {
    const ctx = { known: ['bolt', 'lightning', 'nova'] as const, evolved: {}, level: 9 };
    const up = { ...emptyUpgradeLevels(), pierce: UPGRADES.pierce.maxLevel, potency: 1 };
    expect(evolutionReady('bolt', up, { ...ctx, known: [...ctx.known] })).toBe(false);
    up.potency = 2;
    expect(evolutionReady('bolt', up, { ...ctx, known: [...ctx.known] })).toBe(true);
    const choices = rollUpgradeChoices(up, emptyMetaLevels(), mulberry32(1), 3, { ...ctx, known: [...ctx.known] });
    expect(choices[0]).toMatchObject({ kind: 'evolve', spell: 'bolt', name: EVOLUTIONS.bolt.name });
    expect(evolutionReady('bolt', up, { ...ctx, known: [...ctx.known], evolved: { bolt: true } })).toBe(false);
    // Every evolution names two real upgrades, the first belonging to its own spell.
    for (const id of SPELL_IDS) {
      const [own, partner] = EVOLUTIONS[id].requires as readonly [keyof typeof UPGRADES, keyof typeof UPGRADES];
      expect(UPGRADES[own].spell, id).toBe(id);
      expect(UPGRADES[partner], id).toBeDefined();
    }
  });
});

describe('wizards and curses', () => {
  it('unlocks wizards from lifetime records and falls back to the Arcanist', () => {
    expect(isWizardUnlocked('arcanist', records())).toBe(true);
    expect(isWizardUnlocked('frostcoil', records(179))).toBe(false);
    expect(isWizardUnlocked('frostcoil', records(180))).toBe(true);
    expect(isWizardUnlocked('wardscale', records(0, 10))).toBe(true);
    expect(isWizardUnlocked('stormtongue', records(999, 99, 0))).toBe(false);
    expect(isWizardUnlocked('stormtongue', records(0, 0, 1))).toBe(true);
    expect(playableWizard('stormtongue', records())).toBe('arcanist');
  });

  it('starts each wizard with its own three sigils and perks', () => {
    for (const id of WIZARD_IDS) {
      const w = newWorld({ wizard: id, curses: [] });
      expect(w.known).toEqual(WIZARDS[id].spells);
      expect(w.known).toHaveLength(3);
    }
    expect(newWorld({ wizard: 'wardscale', curses: [] }).stats.maxHp).toBe(125);
    expect(newWorld({ wizard: 'wardscale', curses: [] }).stats.wardCharges).toBe(2);
    const storm = newWorld({ wizard: 'stormtongue', curses: [] });
    expect(storm.stats.maxHp).toBe(75);
    expect(storm.stats.damageMult).toBeCloseTo(1.2, 6);
    expect(storm.stats.chains).toBe(SPELLS.lightning.chains + 1);
  });

  it('applies curses to the run and multiplies the shard reward', () => {
    const w = newWorld({ wizard: 'arcanist', curses: ['glass', 'drain', 'impatient', 'frenzy'] });
    expect(w.stats.maxHp).toBe(60);
    expect(w.stats.cooldownMult).toBeCloseTo(1.3, 6);
    expect(w.nextBossTime).toBe(210);
    expect(w.effects.enemyTimeScale).toBe(1.25);
    expect(curseEffects(['swarm']).spawnRateMult).toBe(1.4);
    expect(shardMultiplier([])).toBe(1);
    expect(shardMultiplier(['glass', 'swarm'])).toBeCloseTo(1 + CURSES.glass.bonus + CURSES.swarm.bonus, 6);
    const run = { time: 120, kills: 40, level: 6, bossKills: 0 };
    expect(computeReward({ ...run, shardMult: 1.5 })).toBe(Math.floor(computeReward(run) * 1.5));
    // Garbage multipliers can't shrink or explode the reward.
    expect(computeReward({ ...run, shardMult: 0.1 })).toBe(computeReward(run));
    expect(computeReward({ ...run, shardMult: 99 })).toBe(Math.floor(computeReward(run) * 3));
  });
});

describe('Arcane Ward', () => {
  it('blocks enemy hits (not walls) until its charges run out, pushing foes away', () => {
    const w = newWorld({ wizard: 'wardscale', curses: [] });
    w.invuln = 0;
    castSpell(w, 'ward', null);
    expect(w.ward?.charges).toBe(2);
    const chaser = spawnEnemy(w, 'chaser', w.snake.x + 30, w.snake.y);
    const hp = w.hp;
    expect(hurtPlayer(w, 20, { kind: 'chaser', attack: 'bite' })).toBe(false);
    expect(w.hp).toBe(hp);
    expect(w.recap.blocked).toBe(1);
    updateWard(w, 1 / 120);
    expect(Math.hypot(chaser.kx, chaser.ky)).toBeGreaterThan(100);
    w.invuln = 0;
    expect(hurtPlayer(w, 5, { kind: 'wall', attack: 'wall' })).toBe(true);
    w.invuln = 0;
    hurtPlayer(w, 20, { kind: 'caster', attack: 'shot' });
    updateWard(w, 1 / 120);
    expect(w.ward).toBeNull();
    w.invuln = 0;
    expect(hurtPlayer(w, 20, { kind: 'caster', attack: 'shot' })).toBe(true);
  });
});

describe('Frost Field', () => {
  it('slows foes standing in it, damages them over time and expires', () => {
    const w = newWorld({ wizard: 'frostcoil', curses: [] });
    const target = { x: w.snake.x + 300, y: w.snake.y };
    castSpell(w, 'frost', target);
    expect(w.frostFields).toHaveLength(1);
    const inside = spawnEnemy(w, 'brute', target.x, target.y);
    const outside = spawnEnemy(w, 'brute', target.x, target.y + 400);
    expect(enemyTimeScale(w, inside, 1 / 120)).toBeCloseTo(w.stats.frostSlow, 6);
    expect(inside.chill).toBe(1);
    expect(enemyTimeScale(w, outside, 1 / 120)).toBe(1);
    const hp = inside.hp;
    for (let i = 0; i < 120; i++) updateFrost(w, 1 / 120);
    expect(inside.hp).toBeLessThan(hp);
    expect(w.recap.spells.frost.damage).toBeGreaterThan(0);
    for (let i = 0; i < 120 * SPELLS.frost.duration; i++) updateFrost(w, 1 / 120);
    expect(w.frostFields).toHaveLength(0);
  });

  it('Glacier freezes foes solid once per field and makes them brittle', () => {
    const w = newWorld({ wizard: 'frostcoil', curses: [] });
    w.evolved.frost = true;
    const target = { x: w.snake.x + 300, y: w.snake.y };
    castSpell(w, 'frost', target);
    const e = spawnEnemy(w, 'brute', target.x, target.y);
    expect(enemyTimeScale(w, e, 1 / 120)).toBe(0);
    expect(e.frozen).toBeGreaterThan(1);
    const before = e.hp;
    damageEnemy(w, e, 10, 'bolt', '#fff');
    expect(before - e.hp).toBeCloseTo(10 * EVOLUTIONS.frost.brittle, 6);
  });
});

describe('evolved spells', () => {
  it('Arcane Lance hits every foe along the beam', () => {
    const w = newWorld();
    w.evolved.bolt = true;
    const s = w.snake;
    s.heading = 0;
    const line = [100, 220, 340].map((d) => spawnEnemy(w, 'chaser', s.x + d, s.y));
    const off = spawnEnemy(w, 'chaser', s.x + 200, s.y + 150);
    castSpell(w, 'bolt', { x: s.x + 500, y: s.y });
    expect(w.beams).toHaveLength(1);
    for (const e of line) expect(e.dead || e.hp < e.maxHp).toBe(true);
    expect(off.hp).toBe(off.maxHp);
  });

  it('Tempest and Supernova strike a second time', () => {
    const w = newWorld();
    w.evolved.lightning = true;
    w.evolved.nova = true;
    spawnEnemy(w, 'brute', w.snake.x + 150, w.snake.y);
    castSpell(w, 'lightning', null);
    castSpell(w, 'nova', null);
    expect(w.echoes).toHaveLength(2);
    w.time += 1;
    const arcs = w.arcs.length;
    const novas = w.novas.length;
    updateEchoes(w);
    expect(w.echoes).toHaveLength(0);
    expect(w.arcs.length).toBe(arcs + 1);
    expect(w.novas.length).toBe(novas + 1);
    expect(w.novas[w.novas.length - 1].maxRadius).toBeCloseTo(w.stats.novaRadius * EVOLUTIONS.nova.echoRadius, 6);
  });
});

describe('depth and elites', () => {
  it('has no elites in depth 1 unless cursed, then more each depth up to a cap', () => {
    expect(eliteChance(1, false)).toBe(0);
    expect(eliteChance(1, true)).toBe(ELITE.cursedChance);
    expect(eliteChance(2, false)).toBe(ELITE.baseChance);
    expect(eliteChance(3, false)).toBeGreaterThan(eliteChance(2, false));
    expect(eliteChance(50, true)).toBe(ELITE.maxChance);
  });

  it('descends to the Ember Depths when the boss falls', () => {
    const w = newWorld();
    killEnemy(w, spawnEnemy(w, 'boss', 600, 300));
    expect(w.depth).toBe(2);
    expect(w.area).toBe(1);
    expect(w.recap.depth).toBe(2);
    killEnemy(w, spawnEnemy(w, 'boss', 600, 300));
    expect(w.depth).toBe(3);
    expect(w.area).toBe(1);
  });

  it('shielded elites soak damage on their shield first', () => {
    const w = newWorld();
    const e = spawnEnemy(w, 'brute', 600, 300);
    e.elite = 'shielded';
    e.shield = e.shieldMax = 30;
    const hp = e.hp;
    damageEnemy(w, e, 20, 'bolt', '#fff');
    expect(e.shield).toBe(10);
    expect(e.hp).toBe(hp);
    damageEnemy(w, e, 25, 'bolt', '#fff');
    expect(e.shield).toBe(0);
    expect(e.hp).toBe(hp - 15);
  });

  it('splitting elites break into two weaker fragments that never split again', () => {
    const w = newWorld();
    const e = spawnEnemy(w, 'chaser', 600, 300);
    e.elite = 'splitting';
    e.maxHp = e.hp = e.hp * ELITE.hpMult;
    killEnemy(w, e);
    const fragments = w.enemies.filter((f) => f.fragment);
    expect(fragments).toHaveLength(2);
    for (const f of fragments) {
      expect(f.elite).toBeNull();
      expect(f.r).toBeLessThan(e.r);
      expect(f.maxHp).toBeLessThan(e.maxHp);
    }
    expect(w.recap.elitesSlain).toBe(1);
  });

  it('swift elites and the Frenzied Foes curse run on a faster clock', () => {
    const w = newWorld({ wizard: 'arcanist', curses: ['frenzy'] });
    const e = spawnEnemy(w, 'chaser', 600, 300);
    e.elite = 'swift';
    expect(enemyTimeScale(w, e, 1 / 120)).toBeGreaterThan(1.25 * 1.4);
    const plain = spawnEnemy(w, 'chaser', 900, 300);
    const x0 = plain.x;
    const y0 = plain.y;
    updateEnemies(w, 1 / 60);
    expect(Math.hypot(plain.x - x0, plain.y - y0)).toBeGreaterThan(0);
  });
});
