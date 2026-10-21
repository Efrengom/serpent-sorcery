import { midiToFreq } from './score';

/**
 * Chiptune instruments built from WebAudio nodes: pulse-wave leads, a triangle bass and noise
 * drums. Every function schedules one note at an absolute time on any BaseAudioContext, so the
 * same code plays live and renders offline for tests.
 */

export interface Instruments {
  ctx: BaseAudioContext;
  noise: AudioBuffer;
  pulse(duty: number): PeriodicWave;
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
  };
}

/** Square-ish lead or arpeggio note with a short attack, gentle decay and optional vibrato. */
export function pulseNote(
  ins: Instruments,
  dest: AudioNode,
  time: number,
  dur: number,
  midi: number,
  gain: number,
  duty: number,
  vibrato = false,
): void {
  const { ctx } = ins;
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(ins.pulse(duty));
  osc.frequency.value = midiToFreq(midi);
  const g = ctx.createGain();
  const end = time + Math.max(0.03, dur * 0.92);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.005);
  g.gain.setTargetAtTime(gain * 0.62, time + 0.01, 0.09);
  g.gain.setTargetAtTime(0, end, 0.012);
  osc.connect(g).connect(dest);
  if (vibrato && dur > 0.3) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, time);
    depth.gain.linearRampToValueAtTime(16, time + 0.28);
    lfo.connect(depth).connect(osc.detune);
    lfo.start(time);
    lfo.stop(end + 0.08);
  }
  osc.start(time);
  osc.stop(end + 0.08);
}

/** Triangle-wave bass note. */
export function triNote(ins: Instruments, dest: AudioNode, time: number, dur: number, midi: number, gain: number): void {
  const { ctx } = ins;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = midiToFreq(midi);
  const g = ctx.createGain();
  const end = time + Math.max(0.03, dur * 0.94);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.004);
  g.gain.setTargetAtTime(gain * 0.85, time + 0.01, 0.2);
  g.gain.setTargetAtTime(0, end, 0.01);
  osc.connect(g).connect(dest);
  osc.start(time);
  osc.stop(end + 0.06);
}

function noiseBurst(
  ins: Instruments,
  dest: AudioNode,
  time: number,
  gain: number,
  decay: number,
  filter: BiquadFilterType,
  freq: number,
): void {
  const { ctx } = ins;
  const src = ctx.createBufferSource();
  src.buffer = ins.noise;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.setTargetAtTime(0, time + 0.002, decay / 3);
  src.connect(f).connect(g).connect(dest);
  // Start somewhere different in the noise each time so hits don't sound identical.
  src.start(time, ((time * 7.31) % 1) * 0.15);
  src.stop(time + decay * 1.6 + 0.02);
}

export function kick(ins: Instruments, dest: AudioNode, time: number, gain: number): void {
  const { ctx } = ins;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(165, time);
  osc.frequency.exponentialRampToValueAtTime(48, time + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.setTargetAtTime(0, time + 0.02, 0.06);
  osc.connect(g).connect(dest);
  osc.start(time);
  osc.stop(time + 0.35);
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

export function hat(ins: Instruments, dest: AudioNode, time: number, gain: number, open = false): void {
  noiseBurst(ins, dest, time, gain, open ? 0.16 : 0.035, 'highpass', 7200);
}

export function crash(ins: Instruments, dest: AudioNode, time: number, gain: number): void {
  noiseBurst(ins, dest, time, gain, 1.1, 'highpass', 3800);
}
