import { describe, expect, it } from 'vitest';
import { enterNextMap } from '../descent';
import { MAP_ORDER } from '../maps';
import { arenaPressure, loopOf, musicCue, VICTORY_HOLD } from '../music/mood';
import { MusicPlayer } from '../music/player';
import {
  bassRoot,
  midiToFreq,
  MUSIC_SCENES,
  noteToMidi,
  parseBar,
  parseChord,
  parsePhrase,
  pitchClass,
  prepareTheme,
  SCENES,
  SOUNDTRACKS,
  STEPS_PER_BAR,
  stepSeconds,
  THEME_IDS,
  themeFor,
  THEMES,
  transposeFor,
} from '../music/score';
import { emptyMetaLevels } from '../progression';
import { createWorld, type World } from '../world';

const newWorld = () => createWorld(emptyMetaLevels(), () => undefined, 1234);

// ---------------------------------------------------------------- a stand-in AudioContext

/** Records what the player schedules: every oscillator's pitch and start, and looping sources. */
interface Log {
  oscillators: { freq: number; time: number; type: string }[];
  loops: number;
}

class Param {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  setTargetAtTime() {
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class Node {
  connect<T>(n: T): T {
    return n;
  }
  disconnect() {}
}

function fakeContext(): { ctx: BaseAudioContext; log: Log } {
  const log: Log = { oscillators: [], loops: 0 };
  const node = <T extends object>(extra: T) => Object.assign(new Node(), extra);
  const ctx = {
    sampleRate: 8000,
    currentTime: 0,
    createGain: () => node({ gain: new Param() }),
    createDelay: () => node({ delayTime: new Param() }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: new Param(), Q: new Param(), gain: new Param() }),
    createWaveShaper: () => node({ curve: null }),
    createConvolver: () => node({ buffer: null }),
    createPeriodicWave: () => ({}),
    createBuffer: (_ch: number, len: number, rate: number) => {
      const data = new Float32Array(len);
      return { length: len, sampleRate: rate, getChannelData: () => data };
    },
    createOscillator() {
      const o = node({
        type: 'sine',
        frequency: new Param(),
        detune: new Param(),
        setPeriodicWave() {
          o.type = 'custom';
        },
        start(time: number) {
          log.oscillators.push({ freq: o.frequency.value, time, type: o.type });
        },
        stop() {},
      });
      return o;
    },
    createBufferSource() {
      const s = node({
        buffer: null,
        loop: false,
        playbackRate: new Param(),
        start() {
          if (s.loop) log.loops++;
        },
        stop() {},
      });
      return s;
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, log };
}

/** The pitched notes a render scheduled (no LFOs or drum thumps), in start order. */
const notes = (log: Log) => log.oscillators.filter((o) => o.type === 'custom' || o.freq > 300).map((o) => o.freq);

// ---------------------------------------------------------------- the score

describe('per-map soundtracks', () => {
  it('give every map its own run and boss themes, a sting, and the boss a faster tempo', () => {
    const used = new Set<string>();
    for (const map of MAP_ORDER) {
      const s = SOUNDTRACKS[map];
      expect(THEMES[s.run]).toBeDefined();
      expect(THEMES[s.boss]).toBeDefined();
      expect(THEMES[s.boss].bpm).toBeGreaterThan(THEMES[s.run].bpm);
      used.add(s.run);
      used.add(s.boss);
      const sting = parsePhrase(s.sting.chords, s.sting.lead);
      expect(sting.bars).toBe(2);
      for (const n of sting.lead.flat()) expect(n.midi).toBeLessThanOrEqual(noteToMidi('G6'));
    }
    expect(used.size).toBe(MAP_ORDER.length * 2);
    expect([...used].sort()).toEqual([...THEME_IDS].sort());
    // The Ruins keeps its two themes; every deeper map has an ambient bed.
    expect(SOUNDTRACKS.ruins).toMatchObject({ run: 'ruins', boss: 'ruinsBoss', ambience: null });
    for (const map of MAP_ORDER.slice(1)) expect(SOUNDTRACKS[map].ambience).not.toBeNull();
  });

  it('puts each map in its own key and at its own tempo', () => {
    const keys = MAP_ORDER.map((m) => parseChord(THEMES[SOUNDTRACKS[m].run].chords[0]).root);
    const tempos = MAP_ORDER.map((m) => THEMES[SOUNDTRACKS[m].run].bpm);
    expect(new Set(keys).size).toBe(MAP_ORDER.length);
    expect(new Set(tempos).size).toBe(MAP_ORDER.length);
  });

  it('writes every melody note and chord tone from the theme’s own scale', () => {
    for (const id of THEME_IDS) {
      const theme = THEMES[id];
      const scale = new Set(theme.scale.split(' ').map(pitchClass));
      const p = prepareTheme(theme);
      const wrong: string[] = [];
      p.lead.forEach((bar, i) => {
        for (const n of bar) if (!scale.has(n.midi % 12)) wrong.push(`${id} bar ${i + 1}: ${n.midi}`);
      });
      p.chords.forEach((c, i) => {
        for (const t of c.tones) if (!scale.has((c.root + t) % 12)) wrong.push(`${id} bar ${i + 1}: ${theme.chords[i]}`);
      });
      expect(wrong).toEqual([]);
    }
  });

  it('starts each new theme’s bars on a chord tone (the Ruins’ boss theme leans on two dissonances)', () => {
    for (const id of THEME_IDS) {
      const p = prepareTheme(THEMES[id]);
      let onChord = 0;
      let bars = 0;
      p.lead.forEach((bar, i) => {
        const first = bar.find((n) => n.step === 0);
        if (!first) return;
        bars++;
        const rel = (((first.midi - p.chords[i].root) % 12) + 12) % 12;
        if (p.chords[i].tones.some((t) => t % 12 === rel)) onChord++;
      });
      expect(onChord / bars).toBeGreaterThanOrEqual(id.startsWith('ruins') ? 0.85 : 1);
    }
  });

  it('keeps every theme’s patterns a bar long, its swing gentle and its extra drum defined', () => {
    for (const id of THEME_IDS) {
      const t = THEMES[id];
      for (const pattern of [t.kick, t.snare, t.hats, t.busyHats, t.perc ?? '.'.repeat(STEPS_PER_BAR)]) {
        expect(pattern).toHaveLength(STEPS_PER_BAR);
        expect(pattern).toMatch(/^[x.hl]+$/);
      }
      if (t.perc) expect(t.band.kit.perc).toBeDefined();
      for (const [step, len] of [...t.bass, ...(t.bassCalm ?? [])]) expect(step + len).toBeLessThanOrEqual(STEPS_PER_BAR);
      expect(t.swing ?? 0).toBeGreaterThanOrEqual(0);
      expect(t.swing ?? 0).toBeLessThanOrEqual(0.34);
      expect(t.band.arp.order.every((i) => i >= 0 && i < 4)).toBe(true);
      // The echo repeats on the beat grid of its own tempo.
      expect(Number.isInteger(t.band.echo.steps)).toBe(true);
    }
  });

  it('reads the new chord qualities and places the bass root above its floor', () => {
    expect(parseChord('A#dim')).toEqual({ root: 10, tones: [0, 3, 6] });
    expect(parseChord('Aaug').tones).toEqual([0, 4, 8]);
    expect(parseChord('Dsus4').tones).toEqual([0, 5, 7]);
    expect(parseChord('Cmaj7').tones).toEqual([0, 4, 7, 11]);
    expect(() => parseChord('Cm9')).toThrow();
    // The default register is D2..C#3; the Ember's starts on C#2, so its bII (D) sits just above.
    expect(bassRoot(parseChord('Dm'))).toBe(38);
    expect(bassRoot(parseChord('C#'), 37)).toBe(37);
    expect(bassRoot(parseChord('D'), 37)).toBe(38);
    expect(parseBar('E#5:16')[0].midi).toBe(noteToMidi('F5'));
  });

  it('picks the theme by the scene’s part and raises deeper loops a semitone at a time, up to two', () => {
    expect(themeFor('catacombs', 'run2')).toBe('catacombs');
    expect(themeFor('catacombs', 'boss1')).toBe('catacombsBoss');
    expect(themeFor('ember', 'victory')).toBe('ember');
    expect([0, 1, 2, 3, 7].map(transposeFor)).toEqual([0, 1, 2, 2, 2]);
    for (const s of MUSIC_SCENES) expect(SCENES[s].ambience).toBeGreaterThanOrEqual(0);
    expect(SCENES.silent.ambience).toBe(0);
    expect(Object.keys(SCENES.victory.layers)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- choosing what plays

describe('music cue', () => {
  it('layers the map’s music by danger, hushes for the warning and plays the map’s boss theme', () => {
    const w = newWorld();
    expect(musicCue(w, 'playing', 0)).toEqual({ map: 'ruins', loop: 0, scene: 'run0' });
    expect(musicCue(w, 'playing', 2).scene).toBe('run2');
    w.bossWarned = true;
    expect(musicCue(w, 'playing', 2).scene).toBe('warning');
    w.boss = { enraged: false } as unknown as World['boss'];
    expect(musicCue(w, 'playing', 2).scene).toBe('boss1');
    w.boss = { enraged: true } as unknown as World['boss'];
    expect(musicCue(w, 'paused', 0).scene).toBe('boss2');
    expect(musicCue(w, 'dying', 0).scene).toBe('silent');
    expect(musicCue(w, 'gameover', 0)).toEqual({ map: 'ruins', loop: 0, scene: 'calm' });
  });

  it('stops for the sting when the boss falls, then plays the next map’s music on the way down', () => {
    const w = newWorld();
    w.descent = { x: 0, y: 0, t: 0 };
    expect(musicCue(w, 'playing', 1)).toEqual({ map: 'ruins', loop: 0, scene: 'victory' });
    w.descent.t = VICTORY_HOLD + 0.1;
    expect(musicCue(w, 'playing', 1)).toEqual({ map: 'hollows', loop: 0, scene: 'calm' });
    // Reaching the way down early: the relic choice gets the next map's music, not silence.
    w.descent.t = 1;
    w.relicOffer = ['thornhide'];
    expect(musicCue(w, 'relic', 1)).toEqual({ map: 'hollows', loop: 0, scene: 'calm' });
    w.relicOffer = null;
    enterNextMap(w);
    expect(musicCue(w, 'playing', 0)).toEqual({ map: 'hollows', loop: 0, scene: 'run0' });
  });

  it('counts the loops of the map order, so the second Ruins plays a semitone higher', () => {
    const w = newWorld();
    for (let i = 0; i < 4; i++) enterNextMap(w);
    expect(w.map.def.id).toBe('ruins');
    expect(musicCue(w, 'playing', 0)).toEqual({ map: 'ruins', loop: 1, scene: 'run0' });
    expect([0, 3, 4, 7, 8].map(loopOf)).toEqual([0, 0, 1, 1, 2]);
    // On the way down from the Ember Depths, the music is already the next loop's Ruins.
    const v = newWorld();
    for (let i = 0; i < 3; i++) enterNextMap(v);
    v.descent = { x: 0, y: 0, t: 99 };
    expect(musicCue(v, 'playing', 0)).toEqual({ map: 'ruins', loop: 1, scene: 'calm' });
  });

  it('builds over each map’s own clock, so a new map starts on its lightest layer', () => {
    const w = newWorld();
    w.time = 600;
    expect(arenaPressure(w)).toBeCloseTo(0.3, 6);
    enterNextMap(w);
    expect(arenaPressure(w)).toBeCloseTo(0, 6);
    w.time += 60;
    expect(arenaPressure(w)).toBeCloseTo(0.15, 6);
  });
});

// ---------------------------------------------------------------- the player

describe('music player', () => {
  it('crossfades to a new map’s theme on the next beat and lets the old one stop', () => {
    const { ctx } = fakeContext();
    const p = new MusicPlayer(ctx);
    p.cue('ruins', 0, 'run0', 0);
    p.start(0);
    p.pump(1);
    expect(p.theme).toBe('ruins');
    p.cue('hollows', 0, 'run0', 1);
    expect(p.theme).toBe('hollows');
    expect(p.map).toBe('hollows');
    p.pump(10);
    // The Ruins' next beat after 1 s is its 12th step (1.36 s); the Hollows runs from there.
    const beat = 12 * stepSeconds(THEMES.ruins);
    const steps = Math.ceil((10 - beat) / stepSeconds(THEMES.hollows));
    expect(p.position).toBeCloseTo(steps * stepSeconds(THEMES.hollows), 6);
  });

  it('plays deeper loops a semitone up', () => {
    const render = (loop: number) => {
      const { ctx, log } = fakeContext();
      const p = new MusicPlayer(ctx);
      p.solo = 'lead';
      p.cue('ruins', loop, 'run0', 0);
      p.start(0);
      p.pump(8);
      expect(p.transpose).toBe(transposeFor(loop));
      return notes(log);
    };
    const base = render(0);
    const up = render(1);
    expect(base.length).toBeGreaterThan(10);
    expect(up).toHaveLength(base.length);
    up.forEach((f, i) => expect(f / base[i]).toBeCloseTo(Math.pow(2, 1 / 12), 4));
    expect(base[0]).toBeCloseTo(midiToFreq(noteToMidi('D5')), 3);
  });

  it('swings the off-beat sixteenths of a swung theme late', () => {
    const { ctx, log } = fakeContext();
    const p = new MusicPlayer(ctx);
    p.solo = 'lead';
    p.cue('hollows', 0, 'run0', 0);
    p.start(0);
    p.pump(1);
    // "E5:3 G5:1 …": G5 starts on step 3, an off-beat, pushed 30% of a step late.
    const e5 = log.oscillators.find((o) => Math.abs(o.freq - midiToFreq(noteToMidi('E5'))) < 0.5)!;
    const g5 = log.oscillators.find((o) => Math.abs(o.freq - midiToFreq(noteToMidi('G5'))) < 0.5)!;
    const step = stepSeconds(THEMES.hollows);
    expect(g5.time - e5.time).toBeCloseTo((3 + THEMES.hollows.swing!) * step, 6);
  });

  it('plays the map’s two-bar sting once when the boss falls', () => {
    const { ctx } = fakeContext();
    const p = new MusicPlayer(ctx);
    p.cue('ruins', 0, 'boss1', 0);
    p.start(0);
    p.pump(2);
    expect(p.theme).toBe('ruinsBoss');
    const before = p.scheduled;
    p.cue('ruins', 0, 'victory', 2);
    const sting = parsePhrase(SOUNDTRACKS.ruins.sting.chords, SOUNDTRACKS.ruins.sting.lead);
    // Melody and harmony note for note, and two bass notes a bar.
    expect(p.scheduled - before).toBe(sting.lead.flat().length * 2 + 4);
    expect(p.theme).toBe('ruins');
    // Holding the scene doesn't play it again.
    const after = p.scheduled;
    p.cue('ruins', 0, 'victory', 2.5);
    expect(p.scheduled).toBe(after);
  });

  it('brings in a map’s ambient bed with its music, and none for the Ruins', () => {
    const { ctx, log } = fakeContext();
    const p = new MusicPlayer(ctx);
    p.cue('ruins', 0, 'calm', 0);
    p.start(0);
    p.pump(2);
    expect(log.loops).toBe(0);
    p.cue('ember', 0, 'calm', 2);
    p.pump(4);
    expect(log.loops).toBeGreaterThan(0);
    const loops = log.loops;
    // Coming back to it later reuses the same bed.
    p.cue('ruins', 0, 'calm', 4);
    p.cue('ember', 0, 'run1', 5);
    expect(log.loops).toBe(loops);
  });

  it('rings the Catacombs’ toll whenever a bass plays, on the first beat of every fourth bar', () => {
    const { ctx, log } = fakeContext();
    const p = new MusicPlayer(ctx);
    p.cue('catacombs', 0, 'warning', 0);
    p.start(0);
    const bar = STEPS_PER_BAR * stepSeconds(THEMES.catacombs);
    p.pump(bar * 8 + 0.01);
    // The toll is the only voice with the bell's inharmonic modulator (1.4 times the note), which
    // starts just before its note.
    const bell = log.oscillators.filter((o, i) => {
      const note = log.oscillators[i + 1];
      return note && Math.abs(o.freq / note.freq - 1.4) < 1e-6;
    });
    expect(bell.map((o) => +(o.time / bar).toFixed(3))).toEqual([0, 4, 8]);
  });
});
