import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HIT_STOP } from '../config';
import { damageEnemy, hurtPlayer, killEnemy } from '../combat';
import { hitStop } from '../effects';
import { spawnEnemy } from '../enemies';
import { arenaPressure, IntensityTracker } from '../music/mood';
import {
  arpTones,
  harmonyNote,
  LAYERS,
  noteToMidi,
  parseBar,
  parseChord,
  prepareTheme,
  SCENES,
  STEPS_PER_BAR,
  THEMES,
} from '../music/score';
import { emptyMetaLevels } from '../progression';
import { describeHurt, worstHurt } from '../recap';
import { pickupRate, SFX_FILES, SFX_SAMPLES } from '../sfx';
import { createWorld } from '../world';

const newWorld = () => createWorld(emptyMetaLevels(), () => undefined, 1234);

describe('soundtrack score', () => {
  it('parses notes and chords', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C#5')).toBe(73);
    expect(noteToMidi('Bb4')).toBe(70);
    expect(parseChord('Dm')).toEqual({ root: 2, tones: [0, 3, 7] });
    expect(parseChord('A7')).toEqual({ root: 9, tones: [0, 4, 7, 10] });
    expect(parseChord('Eb').root).toBe(3);
    expect(() => parseBar('D5:6 A4:2')).toThrow();
  });

  it('fills every bar of every theme exactly, with one chord per melody bar', () => {
    for (const theme of Object.values(THEMES)) {
      const p = prepareTheme(theme);
      expect(p.bars).toBe(theme.lead.length);
      for (const bar of p.lead) {
        const end = Math.max(...bar.map((n) => n.step + n.len));
        expect(end).toBeLessThanOrEqual(STEPS_PER_BAR);
      }
      for (const pattern of [theme.kick, theme.snare, theme.hats, theme.busyHats]) expect(pattern).toHaveLength(STEPS_PER_BAR);
      for (const [step, len] of theme.bass) expect(step + len).toBeLessThanOrEqual(STEPS_PER_BAR);
    }
  });

  it('keeps the melody in a singable range and the boss loop at a whole number of 8-bar phrases', () => {
    for (const theme of Object.values(THEMES)) {
      for (const n of prepareTheme(theme).lead.flat()) {
        expect(n.midi).toBeGreaterThanOrEqual(noteToMidi('G4'));
        expect(n.midi).toBeLessThanOrEqual(noteToMidi('G6'));
      }
      expect(theme.chords.length % 8).toBe(0);
    }
  });

  it('harmonises with chord tones at least a minor third below the melody', () => {
    for (const theme of Object.values(THEMES)) {
      const p = prepareTheme(theme);
      p.harmony.forEach((bar, i) => {
        const chord = p.chords[i];
        bar.forEach((h, j) => {
          const gap = p.lead[i][j].midi - h.midi;
          expect(gap).toBeGreaterThanOrEqual(3);
          expect(gap).toBeLessThanOrEqual(9);
          expect(chord.tones.map((t) => t % 12)).toContain((((h.midi - chord.root) % 12) + 12) % 12);
        });
      });
    }
    expect(harmonyNote(noteToMidi('A5'), parseChord('Dm'))).toBe(noteToMidi('F5'));
  });

  it('builds arpeggios from the chord: root, third, fifth, octave', () => {
    const tones = arpTones(parseChord('Dm'));
    expect(tones.map((m) => m - tones[0])).toEqual([0, 3, 7, 12]);
    expect(tones[0]).toBeGreaterThanOrEqual(57);
    expect(tones[0]).toBeLessThan(69);
  });

  it('defines a mix for every scene using known layers, with the boss scenes on the boss theme', () => {
    for (const [name, mix] of Object.entries(SCENES)) {
      for (const l of Object.keys(mix.layers)) expect(LAYERS).toContain(l);
      expect(mix.part).toBe(name.startsWith('boss') ? 'boss' : 'run');
    }
    expect(Object.keys(SCENES.silent.layers)).toHaveLength(0);
    // Each run level adds to the one below it.
    const count = (s: keyof typeof SCENES) => Object.keys(SCENES[s].layers).length;
    expect(count('run1')).toBeGreaterThan(count('run0'));
    expect(count('run2')).toBeGreaterThan(count('run1'));
  });
});

describe('music intensity', () => {
  it('climbs with enemies on the field and counts heavier enemies more', () => {
    const w = newWorld();
    expect(arenaPressure(w)).toBe(0);
    spawnEnemy(w, 'chaser', 300, 300);
    const one = arenaPressure(w);
    spawnEnemy(w, 'brute', 400, 300);
    expect(arenaPressure(w) - one).toBeCloseTo(one * 3, 6);
    w.hp = w.stats.maxHp * 0.2;
    expect(arenaPressure(w)).toBeGreaterThan(one * 4);
  });

  it('builds slowly over the first two minutes even with an empty arena', () => {
    const w = newWorld();
    w.time = 60;
    expect(arenaPressure(w)).toBeCloseTo(0.15, 6);
    w.time = 600;
    expect(arenaPressure(w)).toBeCloseTo(0.3, 6);
  });

  it('changes level with hysteresis and holds each level for a few seconds', () => {
    const t = new IntensityTracker();
    expect(t.update(0.35, 0.1)).toBe(1);
    // Straight back down is refused until the hold time has passed.
    expect(t.update(0.0, 1)).toBe(1);
    expect(t.update(0.0, 3.5)).toBe(0);
    // Just under the climb threshold, nothing happens; between the marks it stays put.
    for (let i = 0; i < 50; i++) t.update(0.29, 0.2);
    expect(t.level).toBe(0);
    t.update(0.8, 5);
    expect(t.level).toBe(1);
    t.update(0.8, 5);
    expect(t.level).toBe(2);
    t.update(0.6, 5);
    expect(t.level).toBe(2);
    t.update(0.5, 5);
    expect(t.level).toBe(1);
  });
});

describe('hit-stop', () => {
  it('freezes on hits; small freezes are rationed, major ones always land', () => {
    const w = newWorld();
    hitStop(w, 0.05);
    expect(w.hitStop).toBe(0.05);
    w.hitStop = 0;
    hitStop(w, 0.05);
    expect(w.hitStop).toBe(0);
    hitStop(w, 0.07, true);
    expect(w.hitStop).toBe(0.07);
    // Overlapping freezes don't add up.
    hitStop(w, 0.03, true);
    expect(w.hitStop).toBe(0.07);
  });

  it('kicks in when the player is hurt, a brute dies, and longer with slow motion when the boss dies', () => {
    const w = newWorld();
    w.invuln = 0;
    hurtPlayer(w, 10, { kind: 'chaser', attack: 'bite' });
    expect(w.hitStop).toBe(HIT_STOP.hurt);

    const w2 = newWorld();
    killEnemy(w2, spawnEnemy(w2, 'brute', 300, 300));
    expect(w2.hitStop).toBe(HIT_STOP.heavyKill);

    const w3 = newWorld();
    killEnemy(w3, spawnEnemy(w3, 'chaser', 300, 300));
    expect(w3.hitStop).toBe(0);

    const w4 = newWorld();
    killEnemy(w4, spawnEnemy(w4, 'boss', 300, 300));
    expect(w4.hitStop).toBe(HIT_STOP.bossKill);
    expect(w4.slowMo).toBe(HIT_STOP.bossSlowMo);
  });
});

describe('death recap', () => {
  it('credits each spell with the damage it actually dealt and its kills', () => {
    const w = newWorld();
    const e = spawnEnemy(w, 'chaser', 300, 300);
    const hp = e.hp;
    damageEnemy(w, e, hp / 2, 'bolt', '#fff');
    damageEnemy(w, e, 1000, 'lightning', '#fff');
    expect(w.recap.spells.bolt).toEqual({ casts: 0, damage: hp / 2, kills: 0 });
    // Overkill isn't counted: lightning only gets the health that was left.
    expect(w.recap.spells.lightning.damage).toBeCloseTo(hp / 2, 6);
    expect(w.recap.spells.lightning.kills).toBe(1);
    expect(w.kills).toBe(1);
  });

  it('records damage taken by source and what landed the killing blow', () => {
    const w = newWorld();
    w.invuln = 0;
    hurtPlayer(w, 30, { kind: 'caster', attack: 'shot' });
    w.invuln = 0;
    hurtPlayer(w, 20, { kind: 'brute', attack: 'charge' });
    w.invuln = 0;
    hurtPlayer(w, 30, { kind: 'caster', attack: 'shot' });
    expect(w.recap.killedBy).toBeNull();
    w.invuln = 0;
    hurtPlayer(w, 500, { kind: 'brute', attack: 'charge' });
    expect(w.hp).toBe(0);
    expect(w.recap.taken).toEqual({ 'caster:shot': 60, 'brute:charge': 40 });
    expect(w.recap.killedBy).toBe('brute:charge');
    expect(describeHurt(w.recap.killedBy!)).toBe("a Brute's charge");
    expect(worstHurt(w.recap)).toEqual({ key: 'caster:shot', amount: 60 });
  });

  it('names every kind of blow', () => {
    for (const key of ['chaser:bite', 'caster:shot', 'brute:charge', 'rival:lunge', 'boss:volley', 'boss:charge', 'wall:wall']) {
      expect(describeHurt(key)).not.toBe(key);
    }
  });
});

describe('sound effects', () => {
  it('has samples for every effect, and every sample file is in the project', () => {
    const dir = fileURLToPath(new URL('../../assets/sfx/', import.meta.url));
    const onDisk = new Set(readdirSync(dir).filter((f) => f.endsWith('.ogg')).map((f) => f.slice(0, -4)));
    for (const f of SFX_FILES) expect(onDisk, f).toContain(f);
    expect(onDisk.size).toBe(SFX_FILES.length);
    for (const layers of Object.values(SFX_SAMPLES)) {
      for (const l of layers) {
        expect(l.gain).toBeGreaterThan(0);
        expect(l.gain).toBeLessThanOrEqual(1);
      }
    }
  });

  it('raises the crystal pickup pitch along a scale while a chain continues', () => {
    expect(pickupRate(0)).toBeCloseTo(0.8, 6);
    for (let i = 1; i < 15; i++) expect(pickupRate(i)).toBeGreaterThan(pickupRate(i - 1));
    expect(pickupRate(99)).toBe(pickupRate(14));
  });
});
