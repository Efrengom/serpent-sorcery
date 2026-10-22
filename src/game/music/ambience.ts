import type { AmbienceId } from './score';
import { createReverb, playVoice, type Instruments, type Voice } from './synth';

/**
 * The bed of sound under a deeper map's music: a continuous layer (cave air, wind, the rumble of
 * lava) with small events scattered over it at random (drips and spore puffs, ice tinkles,
 * bubbles and crackles). Events come from a fixed-seed random stream so offline renders repeat.
 */

/** B minor pentatonic in the seventh octave, for ice tinkles (the Catacombs' key). */
const TINKLE_NOTES = [95, 98, 100, 102, 105];
const TINKLE: Voice = {
  wave: 'sine',
  gain: 1,
  fm: { ratio: 3.5, index: 0.8, decay: 0.2 },
  attack: 0.002,
  sustain: 0.2,
  decay: 0.4,
  hold: 1,
  release: 0.3,
};

export class AmbienceBed {
  readonly output: GainNode;
  /** Semitones the pitched events are raised by, to follow the music on deeper loops. */
  transpose = 0;
  /** Until when events keep being scheduled after the bed was faded out. */
  audibleUntil = 0;
  private next = -Infinity;
  private seed: number;
  /** Events go here: straight out, and into the bed's own room if it has one. */
  private readonly events: GainNode;

  constructor(
    private readonly ins: Instruments,
    readonly id: AmbienceId,
    start: number,
  ) {
    const ctx = ins.ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.events = ctx.createGain();
    this.events.connect(this.output);
    this.seed = id === 'cave' ? 0x9e3779b9 : id === 'wind' ? 0x85ebca6b : 0xc2b2ae35;
    const room = id === 'cave' ? 1.4 : id === 'wind' ? 2.5 : 0;
    if (room > 0) {
      const send = ctx.createGain();
      send.gain.value = 0.35;
      this.events.connect(send).connect(createReverb(ctx, room)).connect(this.output);
    }
    this.buildBed(start);
  }

  private rand(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  private between(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rand();
  }

  /** A slow sine wobble added to `param`. */
  private lfo(param: AudioParam, rate: number, depth: number, start: number): void {
    const ctx = this.ins.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g).connect(param);
    osc.start(start);
  }

  /** Looping noise through a filter, at a level that drifts. */
  private noiseLayer(type: BiquadFilterType, freq: number, q: number, level: number, start: number): BiquadFilterNode {
    const ctx = this.ins.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.ins.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(f).connect(g).connect(this.output);
    src.start(start);
    if (level > 0.1) this.lfo(g.gain, 0.05 + this.rand() * 0.05, level * 0.4, start);
    return f;
  }

  private buildBed(start: number): void {
    if (this.id === 'cave') {
      // Still, damp air and a faint far-off hiss.
      this.noiseLayer('lowpass', 220, 0.7, 0.55, start);
      this.noiseLayer('bandpass', 1100, 4, 0.05, start);
    } else if (this.id === 'wind') {
      // Wind through the crypts: a band of noise whose pitch and strength wander.
      const band = this.noiseLayer('bandpass', 520, 1.1, 0.7, start);
      this.lfo(band.frequency, 0.071, 220, start);
      this.lfo(band.frequency, 0.13, 120, start);
      this.noiseLayer('highpass', 3000, 0.7, 0.05, start);
    } else {
      // The low roar of lava, and a hotter rumble over it.
      this.noiseLayer('lowpass', 180, 0.7, 1, start);
      this.noiseLayer('bandpass', 320, 1, 0.16, start);
    }
  }

  /** Schedules every event that starts before `until`; after a pause it picks up from `now`. */
  pump(now: number, until: number): void {
    if (this.next < now - 0.2) this.next = now + this.rand() * 0.4;
    while (this.next < until) this.next += this.event(this.next);
  }

  /** Plays one event at `t` and returns the gap to the next. */
  private event(t: number): number {
    if (this.id === 'cave') {
      if (this.rand() < 0.8) {
        this.drip(t, this.between(1300, 2600), this.between(0.5, 1));
        if (this.rand() < 0.3) this.drip(t + this.between(0.09, 0.2), this.between(1100, 2000), this.between(0.3, 0.6));
      } else this.puff(t);
      return this.between(0.35, 2);
    }
    if (this.id === 'wind') {
      const n = 1 + Math.floor(this.rand() * 3);
      let at = t;
      for (let i = 0; i < n; i++) {
        const midi = TINKLE_NOTES[Math.floor(this.rand() * TINKLE_NOTES.length)] + this.transpose;
        playVoice(this.ins, this.events, at, 0.6, midi, TINKLE, this.between(0.15, 0.3));
        at += this.between(0.1, 0.18);
      }
      return this.between(2.5, 7);
    }
    if (this.rand() < 0.6) {
      this.bubble(t);
      if (this.rand() < 0.5) this.burst(t + 0.1, 'bandpass', 1400, 0.3, 0.015);
    } else {
      let at = t;
      const n = 3 + Math.floor(this.rand() * 5);
      for (let i = 0; i < n; i++) {
        this.burst(at, 'highpass', 2800, this.between(0.15, 0.45), 0.006);
        at += this.between(0.015, 0.07);
      }
    }
    return this.between(0.5, 2.2);
  }

  /** A water drop: a sine plink whose pitch leaps upward. */
  private drip(t: number, freq: number, gain: number): void {
    const ctx = this.ins.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.7, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * 0.5, t);
    g.gain.setTargetAtTime(0, t + 0.003, 0.03);
    osc.connect(g).connect(this.events);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /** A soft puff of spores: band-passed noise that swells and fades. */
  private puff(t: number): void {
    const ctx = this.ins.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.ins.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.25);
    g.gain.setTargetAtTime(0, t + 0.3, 0.2);
    src.connect(f).connect(g).connect(this.events);
    src.start(t, this.rand());
    src.stop(t + 1.4);
  }

  /** A lava bubble: a low sine swooping up as it bursts. */
  private bubble(t: number): void {
    const ctx = this.ins.ctx;
    const f0 = this.between(55, 95);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 2.8, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.01);
    g.gain.setTargetAtTime(0, t + 0.04, 0.05);
    osc.connect(g).connect(this.events);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  private burst(t: number, type: BiquadFilterType, freq: number, gain: number, decay: number): void {
    const ctx = this.ins.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.ins.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.setTargetAtTime(0, t + 0.001, decay);
    src.connect(f).connect(g).connect(this.events);
    src.start(t, this.rand());
    src.stop(t + decay * 8 + 0.02);
  }
}
