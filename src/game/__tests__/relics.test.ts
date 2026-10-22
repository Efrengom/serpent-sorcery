import { describe, expect, it } from 'vitest';
import { DESCENT, SPELLS } from '../config';
import { damageEnemy, hurtPlayer, killEnemy } from '../combat';
import { beginDescent, leaveForNextMap, updateDescent } from '../descent';
import { spawnEnemy } from '../enemies';
import { mulberry32 } from '../math';
import { emptyMetaLevels } from '../progression';
import {
  afterSigil,
  KNOWN_RELICS,
  offerRelics,
  RELIC_IDS,
  RELIC_TUNING,
  RELICS,
  relicShare,
  takeRelic,
  updateRelics,
  type RelicId,
} from '../relics';
import { createWorld, refreshStats, type World } from '../world';

const DT = 1 / 120;
const newWorld = (): World => createWorld(emptyMetaLevels(), () => undefined, 21);
function withRelic(id: RelicId, w = newWorld()): World {
  takeRelic(w, id);
  refreshStats(w);
  return w;
}

describe('the relic table (R4)', () => {
  it('has 18 relics, 10 known from the start, and one per map', () => {
    expect(RELIC_IDS).toHaveLength(18);
    expect(KNOWN_RELICS).toHaveLength(10);
    expect(RELIC_IDS.filter((id) => RELICS[id].map).map((id) => RELICS[id].map)).toEqual(['ruins', 'hollows', 'catacombs', 'ember']);
    // Every map's own relic is known from the start, so each map's hazards have an answer.
    expect(RELIC_IDS.filter((id) => RELICS[id].map).every((id) => RELICS[id].known)).toBe(true);
    for (const id of RELIC_IDS) expect(RELICS[id].cost > 0, id).toBe(!RELICS[id].known);
  });
});

describe('the offer on the way down (R1-R2)', () => {
  it("leads with the next map's relic, then distinct others the save knows and the run lacks", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 40; i++) {
      const w = newWorld();
      takeRelic(w, 'tailSigil');
      const offer = offerRelics(w, rng);
      expect(offer).toHaveLength(3);
      expect(offer[0]).toBe('thornhide');
      expect(new Set(offer).size).toBe(3);
      for (const id of offer) {
        expect(KNOWN_RELICS).toContain(id);
        expect(id).not.toBe('tailSigil');
      }
    }
  });

  it('leads with the Ember relic on the way to the Ember Depths, and offers locked relics only once unlocked', () => {
    const w = newWorld();
    w.mapIndex = 2;
    expect(offerRelics(w, mulberry32(1))[0]).toBe('emberwalk');
    const rng = mulberry32(2);
    for (let i = 0; i < 50; i++) expect(offerRelics(w, rng)).not.toContain('lodestar');
    w.relicPool = ['lodestar'];
    expect(offerRelics(w, rng)).toEqual(['lodestar']);
  });

  it('waits on the threshold for the choice, then takes the relic down', () => {
    const w = newWorld();
    beginDescent(w, 3200, 2000);
    w.snake.x = w.descent!.x;
    w.snake.y = w.descent!.y;
    updateDescent(w, DT);
    expect(w.relicOffer).toHaveLength(3);
    expect(w.depth).toBe(1);
    const pick = w.relicOffer![1];
    leaveForNextMap(w, pick);
    expect(w.relics).toEqual([pick]);
    expect(w.relicOffer).toBeNull();
    expect(w.depth).toBe(2);
  });

  it('heals 40% instead when the relics are left', () => {
    const w = newWorld();
    beginDescent(w, 3200, 2000);
    for (let i = 0; i < (DESCENT.pullAfter + 0.5) / DT; i++) updateDescent(w, DT);
    w.hp = 10;
    leaveForNextMap(w, null);
    expect(w.relics).toEqual([]);
    expect(w.hp).toBeCloseTo(10 + w.stats.maxHp * RELIC_TUNING.leaveHeal, 6);
    expect(w.depth).toBe(2);
  });
});

describe('relics that change the numbers', () => {
  it('Glass Fang, Thick Hide, Lodestar, Hourglass and Frenzied Heart', () => {
    const base = newWorld();
    const glass = withRelic('glassFang');
    expect(glass.stats.damageMult).toBeCloseTo(base.stats.damageMult * RELIC_TUNING.glassDamage, 6);
    expect(glass.stats.maxHp).toBe(Math.round(base.stats.maxHp * RELIC_TUNING.glassHealth));
    expect(withRelic('thickHide').stats.damageTaken).toBe(RELIC_TUNING.thickHide);
    const star = withRelic('lodestar');
    expect(RELICS.lodestar.known).toBe(false);
    expect(star.stats.pickupRadius).toBeCloseTo(base.stats.pickupRadius * 2, 6);
    expect(star.stats.xpMult).toBeCloseTo(base.stats.xpMult * RELIC_TUNING.lodestarXp, 6);
    expect(withRelic('hourglass').stats.ultimateCooldownMult).toBe(RELIC_TUNING.hourglass);
    const heart = withRelic('frenziedHeart');
    expect(heart.stats.cooldownMult).toBeCloseTo(base.stats.cooldownMult * RELIC_TUNING.frenzyCooldown, 6);
    expect(heart.effects.enemyTimeScale).toBeCloseTo(RELIC_TUNING.frenzyFoes, 6);
  });

  it('the Ouroboros Coil grows with the body', () => {
    const w = withRelic('ouroboros');
    const early = w.stats.damageMult;
    w.level = 40;
    refreshStats(w);
    expect(w.stats.damageMult).toBeGreaterThan(early);
  });

  it("Gambler's Die adds rerolls and a banish at once", () => {
    const w = newWorld();
    const [r, b] = [w.rerolls, w.banishes];
    takeRelic(w, 'gamblersDie');
    expect([w.rerolls, w.banishes]).toEqual([r + RELIC_TUNING.dieRerolls, b + RELIC_TUNING.dieBanishes]);
  });
});

describe('relics that act as things happen', () => {
  it("the map relics blunt their own map's ground and bursts", () => {
    const w = newWorld();
    expect(relicShare(w, { kind: 'wall', attack: 'pillar' })).toBe(1);
    takeRelic(w, 'stoneshaper');
    takeRelic(w, 'thornhide');
    takeRelic(w, 'rimewalker');
    takeRelic(w, 'emberwalk');
    expect(relicShare(w, { kind: 'wall', attack: 'pillar' })).toBe(0);
    expect(relicShare(w, { kind: 'wall', attack: 'lava' })).toBe(0);
    expect(relicShare(w, { kind: 'wall', attack: 'bramble' })).toBe(0);
    expect(relicShare(w, { kind: 'hazard', attack: 'spores' })).toBe(RELIC_TUNING.hazardShare);
    expect(relicShare(w, { kind: 'hazard', attack: 'icicle' })).toBe(RELIC_TUNING.hazardShare);
    expect(relicShare(w, { kind: 'chaser', attack: 'bite' })).toBe(1);
    w.invuln = 0;
    const hp = w.hp;
    expect(hurtPlayer(w, 20, { kind: 'wall', attack: 'pillar' })).toBe(false);
    expect(w.hp).toBe(hp);
  });

  it('Sacrificial Scales turn one killing blow per map into a shed skin', () => {
    const w = withRelic('sacrificialScales');
    w.snake.segmentCount = 30;
    w.invuln = 0;
    hurtPlayer(w, 1000, { kind: 'chaser', attack: 'bite' });
    expect(w.hp).toBe(Math.round(w.stats.maxHp * RELIC_TUNING.sacrificeHealth));
    expect(w.recap.killedBy).toBeNull();
    expect(w.snake.segmentCount).toBeCloseTo(20, 6);
    w.invuln = 0;
    hurtPlayer(w, 1000, { kind: 'chaser', attack: 'bite' });
    expect(w.hp).toBe(0);
  });

  it("Warden's Bell rings a Nova and safety at low health, then rests", () => {
    const w = withRelic('wardensBell');
    w.invuln = 0;
    w.hp = 30;
    hurtPlayer(w, 10, { kind: 'chaser', attack: 'bite' });
    expect(w.novas).toHaveLength(1);
    expect(w.invuln).toBeGreaterThanOrEqual(RELIC_TUNING.bellSafety);
    w.invuln = 0;
    hurtPlayer(w, 5, { kind: 'chaser', attack: 'bite' });
    expect(w.novas).toHaveLength(1);
  });

  it("Bloodglyph heals with kills, and Hunter's Mark hits elites harder", () => {
    const w = withRelic('bloodglyph');
    takeRelic(w, 'huntersMark');
    w.hp = 50;
    for (let i = 0; i < RELIC_TUNING.bloodKills; i++) killEnemy(w, spawnEnemy(w, 'chaser', w.snake.x + 300, w.snake.y));
    expect(w.hp).toBe(51);
    const elite = spawnEnemy(w, 'brute', w.snake.x + 300, w.snake.y);
    elite.elite = 'swift';
    elite.shield = 0;
    const hp = elite.hp;
    damageEnemy(w, elite, 10, 'bolt', '#fff');
    expect(hp - elite.hp).toBeCloseTo(10 * RELIC_TUNING.markDamage, 6);
  });

  it('the Tail Sigil fires from the tip of the tail at the nearest foe', () => {
    const w = withRelic('tailSigil');
    const shots: number[] = [];
    updateRelics(w, DT, (_x, _y, _a, d) => shots.push(d));
    expect(shots).toHaveLength(0);
    spawnEnemy(w, 'brute', w.snake.x + 200, w.snake.y);
    w.relicState.tail = 0;
    updateRelics(w, DT, (_x, _y, _a, d) => shots.push(d));
    expect(shots).toEqual([SPELLS.bolt.damage * w.stats.damageMult]);
    updateRelics(w, DT, (_x, _y, _a, d) => shots.push(d));
    expect(shots).toHaveLength(1);
  });

  it('the Echo Stone casts every 5th sigil twice; the Quill refunds Perfect casts', () => {
    const w = withRelic('echoStone');
    takeRelic(w, 'quill');
    let echoes = 0;
    for (let i = 0; i < 10; i++) afterSigil(w, 'bolt', false, () => echoes++);
    expect(echoes).toBe(2);
    w.cooldowns.nova = 4;
    afterSigil(w, 'nova', true, () => undefined);
    expect(w.cooldowns.nova).toBeCloseTo(2, 6);
  });
});
