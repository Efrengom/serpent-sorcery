import { describe, expect, it } from 'vitest';
import { BUFFS, SPELLS, ULTIMATE } from '../config';
import { damageEnemy, hurtPlayer } from '../combat';
import { spawnEnemy } from '../enemies';
import { grimoireSetup } from '../grimoire';
import { emptyMetaLevels } from '../progression';
import { takeRelic } from '../relics';
import { enemyTimeScale } from '../spells';
import { castUltimate, ULTIMATE_IDS, ULTIMATES, ultimateCooldown, ultimateFor, updateUltimate } from '../ultimates';
import { WIZARD_IDS, WIZARDS, type WizardId } from '../wizards';
import { createWorld, refreshStats, type World } from '../world';

const DT = 1 / 120;
function newWorld(wizard: WizardId = 'arcanist'): World {
  const w = createWorld(emptyMetaLevels(), () => undefined, 11, { wizard, curses: [] });
  w.ult.cooldown = 0;
  return w;
}
function foe(w: World, dx: number, dy: number, kind: 'brute' | 'chaser' | 'boss' = 'brute') {
  const e = spawnEnemy(w, kind, w.snake.x + dx, w.snake.y + dy);
  e.elite = null;
  e.shield = 0;
  return e;
}
function run(w: World, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) {
    w.time += DT;
    updateUltimate(w, DT);
  }
}

describe('one ultimate per wizard (U1-U2)', () => {
  it('gives each wizard its own, on a long cooldown', () => {
    expect(WIZARD_IDS.map((id) => WIZARDS[id].ultimate).sort()).toEqual([...ULTIMATE_IDS].sort());
    for (const id of WIZARD_IDS) expect(ultimateFor(id)).toBe(WIZARDS[id].ultimate);
    for (const id of ULTIMATE_IDS) expect(ULTIMATES[id].cooldown).toBeGreaterThanOrEqual(60);
  });

  it('starts 30 s from ready, or ready with the Grimoire, and recharges after a cast', () => {
    const fresh = createWorld(emptyMetaLevels(), () => undefined, 1, { wizard: 'arcanist', curses: [] });
    expect(fresh.ult.cooldown).toBe(ULTIMATE.start);
    expect(castUltimate(fresh)).toBe(false);
    const primed = createWorld(emptyMetaLevels(), () => undefined, 1, { wizard: 'arcanist', curses: [], grimoire: grimoireSetup(['ultReady']) });
    expect(primed.ult.cooldown).toBe(0);
    expect(castUltimate(primed)).toBe(true);
    expect(primed.ult.cooldown).toBe(ULTIMATES.starfall.cooldown);
    expect(primed.recap.spells.ultimate.casts).toBe(1);
  });

  it('recharges faster with Quickened Runes, Quickening and the Hourglass, down to a floor', () => {
    const w = newWorld();
    w.upgrades.haste = 5;
    takeRelic(w, 'hourglass');
    refreshStats(w);
    expect(ultimateCooldown(w)).toBe(ULTIMATE.minCooldown);
    const q = newWorld();
    castUltimate(q);
    q.buffs.quickening = 100;
    const before = q.ult.cooldown;
    run(q, 1);
    expect(before - q.ult.cooldown).toBeCloseTo(BUFFS.quickening.cooldownRate, 3);
  });

  it('says once when it is ready again', () => {
    const sounds: string[] = [];
    const w = createWorld(emptyMetaLevels(), (s) => sounds.push(s), 2, { wizard: 'arcanist', curses: [] });
    run(w, ULTIMATE.start + 1);
    expect(w.ult.ready).toBe(true);
    expect(sounds.filter((s) => s === 'ultReady')).toHaveLength(1);
  });
});

describe('the four ultimates (U3)', () => {
  it('Starfall rains 36 stars on foes in view over 3 s', () => {
    const w = newWorld('arcanist');
    const near = [foe(w, 200, 0), foe(w, -250, 100), foe(w, 0, -220)];
    const far = foe(w, 3000, 0);
    castUltimate(w);
    run(w, ULTIMATES.starfall.duration + 1);
    expect(w.stars).toHaveLength(0);
    expect(w.ult.left).toBe(0);
    for (const e of near) expect(e.dead || e.hp < e.maxHp).toBe(true);
    expect(far.hp).toBe(far.maxHp);
    expect(w.recap.spells.ultimate.damage).toBeGreaterThan(0);
  });

  it('Absolute Zero freezes everything in view, slows a boss, makes the frozen brittle and shatters shots', () => {
    const w = newWorld('frostcoil');
    const e = foe(w, 300, 0);
    e.hp = e.maxHp = 1e6;
    const boss = foe(w, -300, 0, 'boss');
    const far = foe(w, 3000, 0);
    w.shots.push({ x: w.snake.x + 100, y: w.snake.y, vx: 0, vy: 0, r: 8, damage: 10, life: 3, spin: 0, source: { kind: 'caster', attack: 'shot' }, look: 'orb' });
    castUltimate(w);
    expect(e.frozen).toBeCloseTo(ULTIMATES.absoluteZero.duration, 6);
    expect(boss.frozen).toBe(0);
    expect(enemyTimeScale(w, boss, DT)).toBeCloseTo(ULTIMATES.absoluteZero.bossSlow, 6);
    expect(far.frozen).toBe(0);
    expect(w.shots).toHaveLength(0);
    // The blow: flat damage plus a tenth of max health (a boss takes the flat part only).
    expect(e.maxHp - e.hp).toBeCloseTo((ULTIMATES.absoluteZero.damage * w.stats.damageMult + e.maxHp * ULTIMATES.absoluteZero.share) * ULTIMATES.absoluteZero.brittle, 0);
    const hp = e.hp;
    damageEnemy(w, e, 10, 'bolt', '#fff');
    expect(hp - e.hp).toBeCloseTo(10 * ULTIMATES.absoluteZero.brittle, 6);
  });

  it('Bastion heals, turns aside every blow (stone too), and burns what touches the body', () => {
    const w = newWorld('wardscale');
    w.hp = 20;
    w.invuln = 0;
    castUltimate(w);
    expect(w.hp).toBeCloseTo(20 + w.stats.maxHp * ULTIMATES.bastion.heal, 6);
    expect(hurtPlayer(w, 50, { kind: 'chaser', attack: 'bite' })).toBe(false);
    expect(hurtPlayer(w, 50, { kind: 'wall', attack: 'pillar' })).toBe(false);
    const toucher = foe(w, 10, 0);
    toucher.hp = toucher.maxHp = 1e6;
    run(w, 1);
    expect(toucher.hp).toBeLessThan(toucher.maxHp);
    run(w, ULTIMATES.bastion.duration);
    w.invuln = 0;
    expect(hurtPlayer(w, 5, { kind: 'chaser', attack: 'bite' })).toBe(true);
  });

  it('Maelstrom strikes foes around the head for 6 s, and none beyond it', () => {
    const w = newWorld('stormtongue');
    const near = foe(w, 250, 0);
    near.hp = near.maxHp = 1e6;
    const far = foe(w, ULTIMATES.maelstrom.radius + SPELLS.lightning.chainRange + 200, 0);
    castUltimate(w);
    run(w, ULTIMATES.maelstrom.duration + 0.5);
    const strikes = Math.round((near.maxHp - near.hp) / (ULTIMATES.maelstrom.damage * w.stats.damageMult + near.maxHp * ULTIMATES.maelstrom.share));
    expect(strikes).toBeGreaterThanOrEqual(25);
    expect(far.hp).toBe(far.maxHp);
    expect(w.ult.active).toBe(0);
  });
});
