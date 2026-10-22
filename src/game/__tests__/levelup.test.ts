import { describe, expect, it } from 'vitest';
import { ASPECT_FROM_LEVEL, ASPECTS, COOLDOWN_FLOOR, DUOS, DEPTH, ENEMIES, LEVEL_TOOLS, OVERCHARGE, SPELLS, type AspectId } from '../config';
import { damageEnemy, hurtPlayer, killEnemy, updateShots } from '../combat';
import { aliveCap, bossHp, difficulty, spawnEnemy } from '../enemies';
import { applyChoice, banishFromOffer, rerollOffer, rollOffer, skipLevelUp } from '../levelup';
import { mulberry32 } from '../math';
import {
  aspectChoice,
  emptyMetaLevels,
  emptyUpgradeLevels,
  KNOWN_DUOS,
  overchargeChoice,
  rollUpgradeChoices,
  spellCooldown,
  UPGRADE_IDS,
  UPGRADES,
  type ChoiceContext,
} from '../progression';
import { castSpell, regenPerSecond, updateBolts, updateFrost, updateNovas, updateWard } from '../spells';
import { createWorld, type RunSetup, type World } from '../world';

const DT = 1 / 120;
const newWorld = (setup?: RunSetup): World => createWorld(emptyMetaLevels(), () => undefined, 7, setup);
const ctx = (level: number, more: Partial<ChoiceContext> = {}): ChoiceContext => ({ known: ['bolt', 'lightning', 'nova'], evolved: {}, level, ...more });

/** A foe that holds still where it's put, with no elite tricks. */
function foe(w: World, x: number, y: number, kind: 'brute' | 'chaser' = 'brute') {
  const e = spawnEnemy(w, kind, x, y);
  e.elite = null;
  e.shield = 0;
  return e;
}

describe('the difficulty curve (C1-C2)', () => {
  it('climbs with the time on this map, not the run', () => {
    expect(difficulty(300, 3).hp).toBeGreaterThan(difficulty(0, 3).hp * 3);
    expect(difficulty(0, 3).damage).toBeLessThan(difficulty(300, 3).damage);
  });

  it('opens each deeper map easier than the last one closed', () => {
    for (let depth = 2; depth <= 6; depth++) {
      expect(difficulty(0, depth).hp).toBeLessThan(difficulty(300, depth - 1).hp);
      expect(difficulty(0, depth).hp).toBeGreaterThan(difficulty(0, depth - 1).hp);
    }
  });

  it('keeps the third map within reach: under ×15 health even at its boss', () => {
    expect(difficulty(300, 3).hp).toBeLessThan(15);
  });

  it('scales bosses by depth and order, and only eases in foes on the first map', () => {
    expect(bossHp(1, 1)).toBe(ENEMIES.boss.hp);
    expect(bossHp(3, 3)).toBeCloseTo(ENEMIES.boss.hp * (1 + 2 * ENEMIES.boss.hpPerIndex) * (1 + 2 * DEPTH.bossHpPerDepth), 6);
    expect(aliveCap(0, 1)).toBeLessThan(10);
    expect(aliveCap(0, 2)).toBeGreaterThan(20);
  });
});

describe('aspects, duos and overcharge in the roll (L4-L6)', () => {
  it('offers aspects only from their level, and only for known spells', () => {
    const rng = mulberry32(3);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const c of rollUpgradeChoices(emptyUpgradeLevels(), emptyMetaLevels(), rng, 3, ctx(ASPECT_FROM_LEVEL - 1))) expect(c.kind).not.toBe('aspect');
      for (const c of rollUpgradeChoices(emptyUpgradeLevels(), emptyMetaLevels(), rng, 3, ctx(ASPECT_FROM_LEVEL))) if (c.aspect) seen.add(c.aspect);
    }
    expect([...seen].sort()).toEqual((['conductor', 'implosion', 'overload', 'ricochet', 'seeker', 'shockwave'] as AspectId[]).sort());
  });

  it('takes one aspect per spell: the other leaves the pool', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 200; i++) {
      const ids = rollUpgradeChoices(emptyUpgradeLevels(), emptyMetaLevels(), rng, 3, ctx(10, { aspects: { bolt: 'ricochet' } })).map((c) => c.id);
      expect(ids).not.toContain('aspect-ricochet');
      expect(ids).not.toContain('aspect-seeker');
    }
  });

  it('offers a duo once both spells have evolved, if the save knows it, and only once', () => {
    const evolved = { bolt: true, lightning: true };
    const roll = (more: Partial<ChoiceContext>) => rollUpgradeChoices(emptyUpgradeLevels(), emptyMetaLevels(), mulberry32(1), 3, ctx(10, { evolved, ...more })).map((c) => c.id);
    expect(roll({})).toContain('duo-stormlance');
    expect(roll({ duoPool: [] })).not.toContain('duo-stormlance');
    expect(roll({ duos: ['stormlance'] })).not.toContain('duo-stormlance');
    expect(rollUpgradeChoices(emptyUpgradeLevels(), emptyMetaLevels(), mulberry32(1), 3, ctx(10, { evolved: { bolt: true } })).some((c) => c.kind === 'duo')).toBe(false);
    expect(KNOWN_DUOS.every((id) => DUOS[id].known)).toBe(true);
  });

  it('fills the offer with endless overcharge once every rune is mastered', () => {
    const up = emptyUpgradeLevels();
    for (const id of UPGRADE_IDS) up[id] = UPGRADES[id].maxLevel;
    const aspects = { bolt: 'seeker', lightning: 'overload', nova: 'shockwave' } as const;
    const evolved = { bolt: true, lightning: true, nova: true };
    const choices = rollUpgradeChoices(up, emptyMetaLevels(), mulberry32(2), 3, ctx(40, { aspects, evolved, duos: KNOWN_DUOS, overcharge: { power: 4 } }));
    expect(choices.map((c) => c.kind)).toEqual(['overcharge', 'overcharge', 'overcharge']);
    expect(choices.find((c) => c.overcharge === 'power')?.nextLevel).toBe(5);
  });
});

describe('putting cards into effect', () => {
  it('overcharge stacks damage, health and cooldowns, with a floor on cooldowns', () => {
    const w = newWorld();
    const dmg = w.stats.damageMult;
    applyChoice(w, overchargeChoice('power', 0));
    expect(w.stats.damageMult).toBeCloseTo(dmg * (1 + OVERCHARGE.power.damage), 6);
    w.hp = 50;
    const max = w.stats.maxHp;
    applyChoice(w, overchargeChoice('vigor', 0));
    expect(w.stats.maxHp).toBe(max + OVERCHARGE.vigor.maxHp);
    expect(w.hp).toBe(50 + OVERCHARGE.vigor.maxHp + OVERCHARGE.vigor.heal);
    for (let i = 0; i < 80; i++) applyChoice(w, overchargeChoice('focus', i));
    expect(w.stats.cooldownMult).toBeCloseTo(COOLDOWN_FLOOR, 6);
    expect(spellCooldown('nova', w.stats)).toBeGreaterThanOrEqual(SPELLS.nova.minCooldown);
  });

  it('an aspect is recorded on its spell', () => {
    const w = newWorld();
    applyChoice(w, aspectChoice('conductor'));
    expect(w.aspects.lightning).toBe('conductor');
  });
});

describe('reroll, banish and skip (L1-L3)', () => {
  it('rerolls until none are left', () => {
    const w = newWorld();
    expect(w.rerolls).toBe(LEVEL_TOOLS.rerolls);
    for (let i = 0; i < LEVEL_TOOLS.rerolls; i++) expect(rerollOffer(w, 5, Math.random)).toHaveLength(3);
    expect(rerollOffer(w, 5, Math.random)).toBeNull();
  });

  it('banishes a card for the rest of the run and puts a new one in its place', () => {
    const w = newWorld();
    w.banishes = 1;
    const offer = rollOffer(w, 5, mulberry32(9));
    const gone = offer[1];
    const next = banishFromOffer(w, offer, gone, 5, mulberry32(10))!;
    expect(next).toHaveLength(3);
    expect(next.map((c) => c.id)).not.toContain(gone.id);
    expect(next[0].id).toBe(offer[0].id);
    expect(w.banishes).toBe(0);
    const rng = mulberry32(11);
    for (let i = 0; i < 100; i++) expect(rollOffer(w, 5 + (i % 10), rng).map((c) => c.id)).not.toContain(gone.id);
    expect(banishFromOffer(w, next, next[0], 5, rng)).toBeNull();
  });

  it("can't banish overcharge, and a skip heals a tenth of max health", () => {
    const w = newWorld();
    const over = [overchargeChoice('power', 0), overchargeChoice('vigor', 0), overchargeChoice('focus', 0)];
    expect(banishFromOffer(w, over, over[0], 30, Math.random)).toBeNull();
    w.hp = 10;
    expect(skipLevelUp(w)).toBeCloseTo(w.stats.maxHp * LEVEL_TOOLS.skipHeal, 6);
  });
});

describe('aspects in play', () => {
  it('Ricochet bounces a spent bolt on to a second foe', () => {
    const w = newWorld();
    w.aspects.bolt = 'ricochet';
    const s = w.snake;
    const a = foe(w, s.x + 160, s.y);
    const b = foe(w, s.x + 200, s.y + 160);
    castSpell(w, 'bolt', { x: s.x + 400, y: s.y });
    for (let i = 0; i < 120; i++) updateBolts(w, DT);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(b.maxHp - b.hp).toBeCloseTo((a.maxHp - a.hp) * ASPECTS.ricochet.damage, 6);
  });

  it('Seeker bolts curve onto a foe a plain bolt would miss', () => {
    const fire = (aspect: AspectId | null) => {
      const w = newWorld();
      if (aspect) w.aspects.bolt = 'seeker';
      const s = w.snake;
      const e = foe(w, s.x + 320, s.y + 90);
      castSpell(w, 'bolt', { x: s.x + 500, y: s.y });
      for (let i = 0; i < 160; i++) updateBolts(w, DT);
      return e.hp < e.maxHp;
    };
    expect(fire(null)).toBe(false);
    expect(fire('seeker')).toBe(true);
  });

  it('Conductor chains without losing damage; Overload shocks foes into taking more', () => {
    const chain = (aspect: AspectId) => {
      const w = newWorld();
      w.aspects.lightning = aspect;
      const s = w.snake;
      const first = foe(w, s.x + 150, s.y);
      const second = foe(w, s.x + 330, s.y);
      castSpell(w, 'lightning', { x: first.x, y: first.y });
      return { w, first, second };
    };
    const c = chain('conductor');
    expect(c.second.maxHp - c.second.hp).toBeCloseTo(c.first.maxHp - c.first.hp, 6);
    const o = chain('overload');
    expect(o.first.shockUntil).toBeGreaterThan(o.w.time);
    const hp = o.first.hp;
    damageEnemy(o.w, o.first, 10, 'bolt', '#fff');
    expect(hp - o.first.hp).toBeCloseTo(10 * ASPECTS.overload.damage, 6);
  });

  it('Implosion pulls foes in, Shockwave stuns them', () => {
    const ring = (aspect: AspectId | null) => {
      const w = newWorld();
      if (aspect) w.aspects.nova = aspect;
      const e = foe(w, w.snake.x + 100, w.snake.y, 'chaser');
      e.hp = e.maxHp = 1e6;
      castSpell(w, 'nova', null);
      for (let i = 0; i < 60; i++) updateNovas(w, DT);
      return e;
    };
    expect(ring(null).kx).toBeGreaterThan(0);
    expect(ring('implosion').kx).toBeLessThan(0);
    expect(ring('shockwave').stunned).toBeCloseTo(ASPECTS.shockwave.stun, 1);
  });

  it('Mirror sends shots back without spending the Ward; Sanctuary heals and regenerates', () => {
    const w = newWorld({ wizard: 'wardscale', curses: [] });
    w.aspects.ward = 'mirror';
    castSpell(w, 'ward', null);
    const charges = w.ward!.charges;
    const hp = w.hp;
    const s = w.snake;
    w.shots.push({ x: s.x + 2, y: s.y, vx: -100, vy: 0, r: 8, damage: 20, life: 2, spin: 0, source: { kind: 'caster', attack: 'shot' }, look: 'orb' });
    updateShots(w, DT);
    expect(w.shots).toHaveLength(0);
    expect(w.hp).toBe(hp);
    expect(w.ward!.charges).toBe(charges);
    expect(w.bolts.length).toBeGreaterThan(0);

    const v = newWorld({ wizard: 'wardscale', curses: [] });
    v.aspects.ward = 'sanctuary';
    v.hp = 20;
    castSpell(v, 'ward', null);
    expect(v.hp).toBeCloseTo(20 + v.stats.maxHp * ASPECTS.sanctuary.heal, 6);
    expect(regenPerSecond(v)).toBe(ASPECTS.sanctuary.regen);
  });

  it('Shatter bursts foes that die in a field; Permafrost fields last longer and spread wider', () => {
    const w = newWorld({ wizard: 'frostcoil', curses: [] });
    w.aspects.frost = 'shatter';
    const at = { x: w.snake.x + 300, y: w.snake.y };
    castSpell(w, 'frost', at);
    const victim = foe(w, at.x, at.y);
    const neighbour = foe(w, at.x + 50, at.y);
    killEnemy(w, victim);
    expect(w.shatters).toHaveLength(1);
    const hp = neighbour.hp;
    updateFrost(w, DT);
    expect(hp - neighbour.hp).toBeGreaterThanOrEqual(victim.maxHp * ASPECTS.shatter.share);

    const p = newWorld({ wizard: 'frostcoil', curses: [] });
    const plain = newWorld({ wizard: 'frostcoil', curses: [] });
    p.aspects.frost = 'permafrost';
    castSpell(p, 'frost', at);
    castSpell(plain, 'frost', at);
    expect(p.frostFields[0].duration).toBe(plain.frostFields[0].duration * ASPECTS.permafrost.duration);
    expect(p.frostFields[0].radius).toBeCloseTo(plain.frostFields[0].radius * ASPECTS.permafrost.radius, 6);
  });
});

describe('duos in play', () => {
  it('Thunderclap strikes foes the Nova reaches; Blizzard leaves a field', () => {
    const w = newWorld();
    w.duos.push('thunderclap', 'blizzard');
    const e = foe(w, w.snake.x + 100, w.snake.y);
    castSpell(w, 'nova', null);
    expect(w.frostFields).toHaveLength(1);
    for (let i = 0; i < 60; i++) updateNovas(w, DT);
    expect(w.arcs.length).toBeGreaterThan(0);
    expect(w.recap.spells.lightning.damage).toBeGreaterThan(0);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('Bulwark releases a Nova with every blocked hit', () => {
    const w = newWorld({ wizard: 'wardscale', curses: [] });
    w.duos.push('bulwark');
    w.invuln = 0;
    castSpell(w, 'ward', null);
    hurtPlayer(w, 10, { kind: 'chaser', attack: 'bite' });
    updateWard(w, DT);
    expect(w.novas).toHaveLength(1);
  });

  it('Rimeshot chills what bolts hit; Shatterstorm doubles lightning on chilled foes', () => {
    const w = newWorld();
    w.duos.push('rimeshot', 'shatterstorm');
    const s = w.snake;
    const e = foe(w, s.x + 150, s.y);
    castSpell(w, 'bolt', { x: e.x, y: e.y });
    for (let i = 0; i < 40; i++) updateBolts(w, DT);
    expect(e.chillUntil).toBeGreaterThan(w.time);
    const hp = e.hp;
    castSpell(w, 'lightning', { x: e.x, y: e.y });
    expect(hp - e.hp).toBeCloseTo(SPELLS.lightning.damage * w.stats.damageMult * DUOS.shatterstorm.damage, 6);
  });

  it('Stormlance arcs lightning from bolt hits', () => {
    const w = newWorld();
    w.duos.push('stormlance');
    w.rng = () => 0;
    const s = w.snake;
    const e = foe(w, s.x + 150, s.y);
    const near = foe(w, s.x + 150, s.y + 120);
    castSpell(w, 'bolt', { x: e.x, y: e.y });
    for (let i = 0; i < 40; i++) updateBolts(w, DT);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(w.recap.spells.lightning.damage).toBeGreaterThan(0);
  });
});
