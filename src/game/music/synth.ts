import { midiToFreq } from './score';

/**
 * Chiptune instruments built from WebAudio nodes: pulse, triangle, sine and saw voices shaped by
 * data (see Voice), FM bells, and noise and pitched percussion. Every function schedules one note
 * at an absolute time on any BaseAudioContext, so the same code plays live and renders offline.
 */

export interface Instruments {
  ctx: BaseAudioContext;
  noise: AudioBuffer;
  pulse(duty: number): PeriodicWave;
  drive(amount: number): Float32Array<ArrayBuffer>;
}

export function createInstruments(ctx: BaseAudioContext): Instruments {
  const len = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noise.getChannelData(0);
  // Fixed-seed noise so offline renders are repeatable.
  let s = 0x2545f491;
  for (let i = 0; i < len; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  const waves = new Map<number, PeriodicWave>();
  const curves = new Map<number, Float32Array<ArrayBuffer>>();
  return {
    ctx,
    noise,
    pulse(duty) {
      let w = waves.get(duty);
      if (!w) {
        // Fourier series of a pulse train centred on t = 0 (cosine terms only).
        const n = 48;
        const real = new Float32Array(n);
        const imag = new Float32Array(n);
        for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
        w = ctx.createPeriodicWave(real, imag);
        waves.set(duty, w);
      }
      return w;
    },
    drive(amount) {
      let c = curves.get(amount);
      if (!c) {
        // A tanh soft clipper, scaled so a full-level input still peaks at 1.
        c = new Float32Array(1024);
        const norm = Math.tanh(amount);
        for (let i = 0; i < c.length; i++) c[i] = Math.tanh(((i / (c.length - 1)) * 2 - 1) * amount) / norm;
        curves.set(amount, c);
      }
      return c;
    },
  };
}

/**
 * How one instrument sounds, as data, so each map's soundtrack can bring its own band. The
 * defaults are the original chiptune lead: a quick attack, a gentle decay to 62% and a short
 * release just before the written length ends.
 */
export interface Voice {
  wave: 'pulse' | 'triangle' | 'sine' | 'sawtooth';
  gain: number;
  /** Pulse width, for the pulse wave (0.5 is square). */
  duty?: number;
  /** Seconds to full level. */
  attack?: number;
  /** Level it settles to, as a fraction of full, and the time constant of that decay. */
  sustain?: number;
  decay?: number;
  /** Fraction of the written length held before the release, and the release time constant. */
  hold?: number;
  release?: number;
  /** Vibrato depth in cents on notes longer than 0.3 s. */
  vibrato?: number;
  /** Depth (0..1) of a 6 Hz amplitude wobble on notes longer than 0.25 s. */
  tremolo?: number;
  /** A second oscillator detuned by this many cents, for a chorus shimmer. */
  detune?: number;
  /** Low-pass cutoff in Hz; `sweep` starts it that many times higher and closes it over the note. */
  filter?: number;
  sweep?: number;
  /** Soft-clip distortion amount (1 is gentle, 4 is gritty). */
  drive?: number;
  /** Semitones the pitch starts below the note before sliding up to it (a bubbling blip). */
  blip?: number;
  /** Frequency modulation for bells: modulator ratio, depth (in multiples of the note) and its decay. */
  fm?: { ratio: number; index: number; decay: number };
  /** Extra oscillators stacked on the note, as [semitones above, relative gain] (an organ's stops). */
  stack?: [number, number][];
}

const PULSE_DEFAULTS = { duty: 0.5, attack: 0.005, sustain: 0.62, decay: 0.09, hold: 0.92, release: 0.012 };

/** Plays one note of a voice into `dest`; `gain` scales the voice's own level. */
export function playVoice(
  ins: Instruments,
  dest: AudioNode,
  time: number,
  dur: number,
  midi: number,
  voice: Voice,
  gain = 1,
): void {
  const { ctx } = ins;
  const v = { ...PULSE_DEFAULTS, ...voice };
  const level = v.gain * gain;
  const freq = midiToFreq(midi);
  const end = time + Math.max(0.03, dur * v.hold);
  const stopAt = end + Math.max(0.08, v.release * 6);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(level, time + v.attack);
  env.gain.setTargetAtTime(level * v.sustain, time + Math.max(v.attack, 0.01), v.decay);
  env.gain.setTargetAtTime(0, end, v.release);

  // Source chain: oscillators → (drive) → (filter) → (tremolo) → envelope → dest.
  let into: AudioNode = env;
  if (v.tremolo && dur > 0.25) {
    const trem = ctx.createGain();
    trem.gain.value = 1 - v.tremolo / 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    const depth = ctx.createGain();
    depth.gain.value = v.tremolo / 2;
    lfo.connect(depth).connect(trem.gain);
    lfo.start(time);
    lfo.stop(stopAt);
    trem.connect(into);
    into = trem;
  }
  if (v.filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.8;
    if (v.sweep) {
      f.frequency.setValueAtTime(v.filter * v.sweep, time);
      f.frequency.setTargetAtTime(v.filter, time + 0.01, Math.max(0.05, dur * 0.3));
    } else f.frequency.value = v.filter;
    f.connect(into);
    into = f;
  }
  if (v.drive) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = ins.drive(v.drive);
    shaper.connect(into);
    into = shaper;
  }

  const vibrato =
    v.vibrato && dur > 0.3
      ? (() => {
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 5.6;
          const depth = ctx.createGain();
          depth.gain.setValueAtTime(0, time);
          depth.gain.linearRampToValueAtTime(v.vibrato, time + 0.28);
          lfo.connect(depth);
          lfo.start(time);
          lfo.stop(stopAt);
          return depth;
        })()
      : null;

  const voices: [number, number, number][] = [[0, 1, 0]];
  if (v.detune) {
    voices[0][1] = 0.7;
    voices.push([0, 0.7, v.detune]);
  }
  for (const [semis, g] of v.stack ?? []) voices.push([semis, g, 0]);
  for (const [semis, g, cents] of voices) {
    const osc = ctx.createOscillator();
    if (v.wave === 'pulse') osc.setPeriodicWave(ins.pulse(v.duty));
    else osc.type = v.wave;
    const f = freq * Math.pow(2, semis / 12);
    if (v.blip) {
      osc.frequency.setValueAtTime(f * Math.pow(2, -v.blip / 12), time);
      osc.frequency.exponentialRampToValueAtTime(f, time + 0.045);
    } else osc.frequency.value = f;
    osc.detune.value = cents;
    if (vibrato) vibrato.connect(osc.detune);
    if (v.fm) {
      const mod = ctx.createOscillator();
      mod.frequency.value = f * v.fm.ratio;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(f * v.fm.index, time);
      depth.gain.setTargetAtTime(f * v.fm.index * 0.15, time + 0.005, v.fm.decay);
      mod.connect(depth).connect(osc.frequency);
      mod.start(time);
      mod.stop(stopAt);
    }
    let out: AudioNode = osc;
    if (g !== 1) {
      const pg = ctx.createGain();
      pg.gain.value = g;
      osc.connect(pg);
      out = pg;
    }
    out.connect(into);
    osc.start(time);
    osc.stop(stopAt);
  }
  env.connect(dest);
}

function noiseBurst(
  ins: Instruments,
  dest: AudioNode,
  time: number,
  gain: number,
  decay: number,
  filter: BiquadFilterType,
  freq: number,
  q = 1,
): void {
  const { ctx } = ins;
  const src = ctx.createBufferSource();
  src.buffer = ins.noise;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  if (filter === 'bandpass') f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.setTargetAtTime(0, time + 0.002, decay / 3);
  src.connect(f).connect(g).connect(dest);
  // Start somewhere different in the noise each time so hits don't sound identical.
  src.start(time, ((time * 7.31) % 1) * 0.15);
  src.stop(time + decay * 1.6 + 0.02);
}

/** A sine that drops in pitch: the body of kicks and toms. */
function thump(ins: Instruments, dest: AudioNode, time: number, gain: number, from: number, to: number, drop: number, decay: number): void {
  const { ctx } = ins;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, time);
  osc.frequency.exponentialRampToValueAtTime(to, time + drop);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.setTargetAtTime(0, time + 0.02, decay);
  osc.connect(g).connect(dest);
  osc.start(time);
  osc.stop(time + 0.04 + decay * 6);
}

export function kick(ins: Instruments, dest: AudioNode, time: number, gain: number, from = 165, to = 48): void {
  thump(ins, dest, time, gain, from, to, 0.09, 0.06);
  noiseBurst(ins, dest, time, gain * 0.25, 0.012, 'lowpass', 3000);
}

export function snare(ins: Instruments, dest: AudioNode, time: number, gain: number): void {
  const { ctx } = ins;
  noiseBurst(ins, dest, time, gain, 0.14, 'highpass', 1400);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(200, time);
  osc.frequency.exponentialRampToValueAtTime(140, time + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain * 0.6, time);
  g.gain.setTargetAtTime(0, time + 0.005, 0.025);
  osc.connect(g).connect(dest);
  osc.start(time);
  osc.stop(time + 0.15);
}

/** A dry rim click: a short knock of band-passed noise over a high ping. */
export function rim(ins: Instruments, dest: AudioNode, time: number, gain: number): void {
  noiseBurst(ins, dest, time, gain * 0.9, 0.03, 'bandpass', 2600, 2.5);
  thump(ins, dest, time, gain * 0.5, 820, 640, 0.02, 0.012);
}

/** Three quick bursts of band-passed noise smeared together, like hands. */
export function clap(ins: Instruments, dest: AudioNode, time: number, gain: number): void {
  for (const [dt, g] of [
    [0, 0.6],
    [0.011, 0.7],
    [0.023, 1],
  ] as const) {
    noiseBurst(ins, dest, time + dt, gain * g, dt === 0.023 ? 0.12 : 0.02, 'bandpass', 1300, 1.2);
  }
}

export function hat(ins: Instruments, dest: AudioNode, time: number, gain: number, open = false, cutoff = 7200): void {
  noiseBurst(ins, dest, time, gain, open ? 0.16 : 0.035, 'highpass', cutoff);
}

export function crash(ins: Instruments, dest: AudioNode, time: number, gain: number): void {
  noiseBurst(ins, dest, time, gain, 1.1, 'highpass', 3800);
}

/** A hollow wooden knock; `high` picks the upper of two blocks. */
export function woodblock(ins: Instruments, dest: AudioNode, time: number, gain: number, high: boolean): void {
  const f = high ? 1180 : 820;
  thump(ins, dest, time, gain, f * 1.15, f, 0.012, 0.022);
  noiseBurst(ins, dest, time, gain * 0.2, 0.01, 'bandpass', f * 2, 3);
}

/** A tom: a pitched drop with a breath of noise; `high` picks the upper of two drums. */
export function tom(ins: Instruments, dest: AudioNode, time: number, gain: number, high: boolean): void {
  const f = high ? 150 : 98;
  thump(ins, dest, time, gain, f * 1.8, f, 0.08, 0.09);
  noiseBurst(ins, dest, time, gain * 0.15, 0.05, 'lowpass', 1800);
}

/**
 * Hammer on an anvil: inharmonic metal partials that ring and fade at different rates, over the
 * clank of the strike.
 */
export function anvil(ins: Instruments, dest: AudioNode, time: number, gain: number): void {
  const { ctx } = ins;
  for (const [f, g, decay] of [
    [1046, 0.5, 0.22],
    [1567, 0.35, 0.15],
    [2491, 0.25, 0.09],
    [3302, 0.18, 0.05],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain * g * 0.35, time);
    env.gain.setTargetAtTime(0, time + 0.003, decay);
    osc.connect(env).connect(dest);
    osc.start(time);
    osc.stop(time + decay * 6);
  }
  noiseBurst(ins, dest, time, gain * 0.7, 0.03, 'bandpass', 3500, 1.5);
}

/** A room for the music to ring in: decaying fixed-seed noise as the impulse response. */
export function createReverb(ctx: BaseAudioContext, seconds: number): ConvolverNode {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const ir = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = ir.getChannelData(0);
  let s = 0x1b873593;
  for (let i = 0; i < len; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const t = i / len;
    // A soft 8 ms onset, then an exponential tail that is -60 dB by the end.
    const onset = Math.min(1, i / (ctx.sampleRate * 0.008));
    d[i] = (((s >>> 0) / 4294967296) * 2 - 1) * onset * Math.pow(0.001, t);
  }
  const c = ctx.createConvolver();
  c.buffer = ir;
  return c;
}
