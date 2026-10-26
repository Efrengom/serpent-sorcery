import { describe, expect, it } from 'vitest';
import { BEAST_IDS } from '../bestiary';
import { SPELL_IDS } from '../config';
import { createStage, defaultOptions, focusOf, hitSubject, killSubject, resetStage, stepStage, SUBJECTS } from '../inspect';
import { MAP_ORDER } from '../maps';
import { ULTIMATES } from '../ultimates';
import { WIZARD_IDS } from '../wizards';

const run = (stage: ReturnType<typeof createStage>, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) stepStage(stage, 1 / 60);
};

describe('the inspector', () => {
  it('lists every foe, Archmage, wizard, spell, ultimate and map once', () => {
    const ids = SUBJECTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const of = (prefix: string) => ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
    expect([...of('foe:'), ...of('boss:')].sort()).toEqual([...BEAST_IDS].sort());
    expect(of('serpent:').sort()).toEqual([...WIZARD_IDS].sort());
    expect(of('spell:').sort()).toEqual([...SPELL_IDS].sort());
    expect(of('ult:').sort()).toEqual(Object.keys(ULTIMATES).sort());
    expect(of('floor:').sort()).toEqual([...MAP_ORDER].sort());
  });

  it('puts every subject on its stage and runs it, idle and live, without losing it', { timeout: 30_000 }, () => {
    for (const subject of SUBJECTS) {
      for (const live of [false, true]) {
        const stage = createStage(subject, { ...defaultOptions(), live });
        run(stage, 1.5);
        const f = focusOf(stage);
        expect(Number.isFinite(f.x) && Number.isFinite(f.y), subject.id).toBe(true);
        if (subject.group === 'Foes' || subject.group === 'Archmages') expect(stage.foe && !stage.foe.dead, subject.id).toBeTruthy();
        if (subject.group === 'Spells' || subject.group === 'Ultimates') expect(stage.dummies.every((d) => !d.dead), subject.id).toBe(true);
      }
    }
  });

  it('holds an idle foe still and posed, and lets a live one move', () => {
    const viper = SUBJECTS.find((s) => s.id === 'foe:burrowViper')!;
    const idle = createStage(viper, { ...defaultOptions(), statuses: ['frozen', 'burrowed'], heading: 1 });
    const at = { x: idle.foe!.x, y: idle.foe!.y };
    run(idle, 2);
    expect({ x: idle.foe!.x, y: idle.foe!.y }).toEqual(at);
    expect(idle.foe!.frozen > 0 && idle.foe!.hidden && idle.foe!.heading === 1).toBe(true);

    const chaser = createStage(SUBJECTS.find((s) => s.id === 'foe:chaser')!, { ...defaultOptions(), live: true });
    const from = { x: chaser.foe!.x, y: chaser.foe!.y };
    run(chaser, 2);
    expect(Math.hypot(chaser.foe!.x - from.x, chaser.foe!.y - from.y)).toBeGreaterThan(20);
  });

  it('hits without killing, and puts back what was killed or broken', () => {
    const brute = createStage(SUBJECTS.find((s) => s.id === 'foe:brute')!);
    for (let i = 0; i < 30; i++) expect(hitSubject(brute)).toBe(true);
    expect(brute.foe!.dead).toBe(false);
    expect(brute.foe!.hp).toBeGreaterThanOrEqual(1);
    const first = brute.foe;
    expect(killSubject(brute)).toBe(true);
    run(brute, 2);
    expect(brute.foe).not.toBe(first);
    expect(brute.foe!.dead).toBe(false);

    const urn = createStage(SUBJECTS.find((s) => s.id === 'breakable:reliquary')!);
    expect(killSubject(urn)).toBe(true);
    expect(urn.world.breakables).toHaveLength(0);
    run(urn, 2);
    expect(urn.world.breakables).toHaveLength(1);
  });

  it('gives a chosen elite modifier, and the Ascendant the phase asked for', () => {
    const stage = createStage(SUBJECTS.find((s) => s.id === 'foe:caster')!, { ...defaultOptions(), elite: 'shielded' });
    expect(stage.foe!.elite).toBe('shielded');
    expect(stage.foe!.shield).toBeGreaterThan(0);
    const asc = createStage(SUBJECTS.find((s) => s.id === 'boss:ascendant')!, { ...defaultOptions(), phase: 2 });
    run(asc, 0.5);
    expect(asc.foe!.bossId).toBe('ascendant');
    expect(asc.foe!.phase).toBe(2);
    asc.options = { ...asc.options, live: true };
    resetStage(asc);
    run(asc, 0.5);
    expect(asc.foe!.phase).toBe(2);
  });
});
