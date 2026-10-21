import { describe, expect, it } from 'vitest';
import { castPower, castTier, tierBonusLabel } from '../cast';
import { CLEAN_CAST, CONSTRICT, SNAKE, SPELLS } from '../config';
import { LOOP_SEGMENTS, pointInPolygon, updateConstrict } from '../constrict';
import { spawnEnemy } from '../enemies';
import { recognize, SIGIL_KINDS, type Pt } from '../gesture';
import { emptyMetaLevels, segmentsForLevel } from '../progression';
import { castSpell } from '../spells';
import { createWorld, type World } from '../world';

const newWorld = (): World => createWorld(emptyMetaLevels(), () => undefined, 5);

describe('clean casts', () => {
  it('grades each sigil against its own thresholds', () => {
    for (const kind of SIGIL_KINDS) {
      expect(castTier(kind, CLEAN_CAST.perfect[kind])).toBe('perfect');
      expect(castTier(kind, CLEAN_CAST.perfect[kind] - 0.001)).toBe('clean');
      expect(castTier(kind, CLEAN_CAST.clean[kind])).toBe('clean');
      expect(castTier(kind, CLEAN_CAST.clean[kind] - 0.001)).toBe('rough');
      expect(CLEAN_CAST.perfect[kind]).toBeGreaterThan(CLEAN_CAST.clean[kind]);
    }
    expect(castPower('perfect')).toBeGreaterThan(castPower('clean'));
    expect(castPower('rough')).toBe(1);
    expect(tierBonusLabel('perfect')).toBe('+35%');
    expect(tierBonusLabel('rough')).toBe('');
  });

  it('a perfectly drawn line scores perfect, a shaky one does not', () => {
    const straight: Pt[] = Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 8, y: 200 }));
    expect(castTier('line', recognize(straight).score)).toBe('perfect');
    const shaky: Pt[] = Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 8, y: 200 + Math.sin(i * 1.7) * 6 }));
    const r = recognize(shaky);
    expect(r.kind).toBe('line');
    expect(castTier('line', r.score)).not.toBe('perfect');
  });

  it('cast power scales the spell', () => {
    const w = newWorld();
    castSpell(w, 'bolt', null, castPower('perfect'));
    expect(w.bolts[0].damage).toBeCloseTo(SPELLS.bolt.damage * w.stats.damageMult * CLEAN_CAST.power.perfect, 6);
    castSpell(w, 'nova', null, castPower('clean'));
    expect(w.novas[0].damage).toBeCloseTo(SPELLS.nova.damage * w.stats.damageMult * w.stats.novaDamageMult * CLEAN_CAST.power.clean, 6);
  });

  it('reads a stroke in progress, so the trail can tint as you draw', () => {
    // The first leg of a V reads as a line; finishing it reads as the V.
    const leg1: Pt[] = Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 5, y: 100 + i * 11 }));
    const leg2: Pt[] = Array.from({ length: 12 }, (_, i) => ({ x: 160 + i * 5, y: 221 - i * 11 }));
    expect(recognize(leg1).kind).toBe('line');
    expect(recognize([...leg1, ...leg2]).kind).toBe('vee');
  });
});

describe('Constrict', () => {
  it('tests points against a loop polygon', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
  });

  it('becomes possible around level 6, once the body is long enough to loop', () => {
    const level = [...Array(20).keys()].find((l) => segmentsForLevel(l + 1) >= LOOP_SEGMENTS)! + 1;
    expect(level).toBeGreaterThanOrEqual(5);
    expect(level).toBeLessThanOrEqual(7);
  });

  /** Steers a long serpent in its tightest circle around a foe placed at the centre. */
  function circleAround(segments: number, seconds: number) {
    const w = newWorld();
    const s = w.snake;
    s.segmentCount = s.segmentTarget = segments;
    s.x = 600;
    s.y = 400;
    s.heading = 0;
    const r = SNAKE.speed / SNAKE.turnRate;
    // Turning right (clockwise on screen) puts the centre below the heading.
    const e = spawnEnemy(w, 'brute', 600, 400 + r);
    const hp = e.hp;
    const dt = 1 / 120;
    let hinted = false;
    for (let i = 0; i < seconds / dt; i++) {
      s.update(dt, Math.cos(s.heading + Math.PI / 2), Math.sin(s.heading + Math.PI / 2));
      updateConstrict(w, dt);
      if (w.coil && !w.coil.closed) hinted = true;
    }
    return { w, e, hp, hinted };
  }

  it('crushes, holds and pulls in a foe when the body closes a loop around it', () => {
    const { w, e, hp, hinted } = circleAround(30, 1.6);
    expect(hinted).toBe(true);
    expect(e.hp).toBeLessThan(hp);
    expect(hp - e.hp).toBeCloseTo(CONSTRICT.damage * w.stats.damageMult, 0);
    expect(e.stunned).toBeGreaterThan(0);
    expect(w.recap.spells.constrict.casts).toBe(1);
    expect(w.recap.spells.constrict.damage).toBeGreaterThan(0);
    expect(w.constricts.length).toBe(1);
    expect(w.constrictReady).toBe(true);
  });

  it('cannot loop with a short body, and waits out its cooldown between crushes', () => {
    const short = circleAround(12, 1.6);
    expect(short.e.hp).toBe(short.hp);
    expect(short.w.recap.spells.constrict.casts).toBe(0);
    // Keep circling: the head slides along the closed loop, but only crushes again after the cooldown.
    const long = circleAround(30, 1.6 + CONSTRICT.cooldown * 0.5);
    expect(long.w.recap.spells.constrict.casts).toBe(1);
  });
});
