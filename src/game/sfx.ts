import type { SfxName } from './world';

/**
 * Sound effects: recorded and studio-made samples from Kenney's CC0 packs
 * (src/assets/sfx/LICENSE-kenney.txt), with the old synthesized versions kept as a fallback
 * for browsers that can't decode Ogg Vorbis or while the files are still loading.
 */

export interface SampleLayer {
  /** File names without ".ogg"; one is picked at random for variety. */
  files: string[];
  gain: number;
  /** Random playback-rate range (pitch and speed together). */
  rate?: [number, number];
  delay?: number;
  /** Fade the sample out after this many seconds. */
  maxDur?: number;
}

const range = (name: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${name}_${String(from + i).padStart(3, '0')}`);

export const SFX_SAMPLES: Record<SfxName, SampleLayer[]> = {
  bolt: [{ files: range('laserSmall', 0, 3), gain: 0.63, rate: [0.94, 1.08] }],
  lightning: [
    { files: ['laserLarge_003', 'laserLarge_004'], gain: 0.44, rate: [0.95, 1.05] },
    { files: ['impactGlass_light_000', 'impactGlass_light_001'], gain: 0.37, rate: [0.7, 0.8], delay: 0.03 },
  ],
  nova: [{ files: ['forceField_000', 'forceField_002', 'forceField_004'], gain: 0.34, rate: [0.95, 1.05] }],
  hit: [{ files: range('impactSoft_medium', 0, 4), gain: 0.085, rate: [0.9, 1.15] }],
  kill: [
    { files: range('impactPunch_medium', 0, 4), gain: 0.2, rate: [0.95, 1.1] },
    { files: range('impactGlass_light', 0, 2), gain: 0.08, rate: [1, 1.2], delay: 0.02 },
  ],
  pickup: [{ files: ['glass_006'], gain: 0.17 }],
  levelup: [
    { files: ['confirmation_004'], gain: 0.16 },
    { files: ['impactBell_heavy_002'], gain: 0.1, rate: [1.5, 1.5], delay: 0.05 },
  ],
  hurt: [{ files: range('impactPunch_heavy', 0, 2), gain: 0.28, rate: [0.9, 1] }],
  wall: [{ files: ['impactMining_000', 'impactMining_002', 'impactMining_004'], gain: 0.4, rate: [0.9, 1.05], maxDur: 0.45 }],
  unclear: [{ files: ['error_007'], gain: 0.1 }],
  cooldown: [{ files: ['bong_001'], gain: 0.12 }],
  enemyShot: [{ files: ['laserRetro_000', 'laserRetro_001'], gain: 0.038, rate: [0.85, 0.95] }],
  telegraph: [{ files: ['maximize_008'], gain: 0.04, rate: [0.9, 1] }],
  charge: [{ files: ['knifeSlice2'], gain: 0.14, rate: [0.65, 0.75] }],
  portal: [{ files: ['doorOpen_001'], gain: 0.088, rate: [0.55, 0.65] }],
  bossWarn: [
    { files: ['impactBell_heavy_001'], gain: 0.32, rate: [0.55, 0.55] },
    { files: ['lowFrequency_explosion_000'], gain: 0.16, rate: [0.7, 0.7], delay: 0.1 },
  ],
  bossDie: [
    { files: ['lowFrequency_explosion_000'], gain: 0.27 },
    { files: ['explosionCrunch_004'], gain: 0.18 },
    { files: ['impactBell_heavy_000'], gain: 0.2, rate: [0.8, 0.8], delay: 0.35 },
  ],
  death: [
    { files: ['lowFrequency_explosion_001'], gain: 0.6 },
    { files: ['impactBell_heavy_001'], gain: 0.55, rate: [0.45, 0.45], delay: 0.15 },
  ],
  select: [{ files: ['select_005'], gain: 0.16 }],
  ward: [
    { files: ['impactBell_heavy_003'], gain: 0.37, rate: [1.6, 1.7] },
    { files: ['forceField_001'], gain: 0.24, rate: [1.3, 1.35] },
  ],
  wardHit: [
    { files: range('impactPlate_medium', 0, 2), gain: 0.63, rate: [0.95, 1.05] },
    { files: ['impactBell_heavy_003'], gain: 0.27, rate: [1.9, 2] },
  ],
  frost: [
    { files: ['impactGlass_heavy_000', 'impactGlass_heavy_001'], gain: 0.93, rate: [0.8, 0.88] },
    { files: ['glass_004'], gain: 0.44, rate: [0.9, 1], delay: 0.04 },
  ],
  lance: [{ files: ['laserLarge_000', 'laserLarge_001'], gain: 0.44, rate: [0.72, 0.78] }],
  evolve: [
    { files: ['confirmation_002'], gain: 0.28 },
    { files: ['impactBell_heavy_000'], gain: 0.31, rate: [1.2, 1.2], delay: 0.08 },
  ],
  shieldHit: [{ files: range('impactMetal_light', 0, 2), gain: 0.126, rate: [1.1, 1.3] }],
  split: [{ files: ['slime_000'], gain: 0.7, rate: [0.9, 1.1] }],
  perfect: [
    { files: ['glass_002'], gain: 0.24, rate: [1.3, 1.4] },
    { files: ['impactBell_heavy_004'], gain: 0.18, rate: [2, 2.1], delay: 0.03 },
  ],
  constrict: [
    { files: ['impactSoft_heavy_001'], gain: 0.4, rate: [0.75, 0.85] },
    { files: ['creak1'], gain: 0.4, rate: [0.9, 1] },
  ],
  ultimate: [
    { files: ['lowFrequency_explosion_000'], gain: 0.3, rate: [0.8, 0.8] },
    { files: ['forceField_001'], gain: 0.4, rate: [0.7, 0.75] },
    { files: ['impactBell_heavy_003'], gain: 0.28, rate: [0.9, 0.9], delay: 0.06 },
  ],
  ultReady: [
    { files: ['impactBell_heavy_002'], gain: 0.2, rate: [1.6, 1.6] },
    { files: ['glass_002'], gain: 0.2, rate: [1.1, 1.2], delay: 0.05 },
  ],
  starfall: [
    { files: ['impactGlass_heavy_000', 'impactGlass_heavy_001'], gain: 0.3, rate: [1.1, 1.3] },
    { files: ['explosionCrunch_004'], gain: 0.12, rate: [1.2, 1.4] },
  ],
  descend: [
    { files: ['lowFrequency_explosion_001'], gain: 0.24, rate: [0.6, 0.6] },
    { files: ['impactBell_heavy_001'], gain: 0.24, rate: [0.7, 0.7], delay: 0.3 },
  ],
  // Breakables and what they drop.
  smash: [
    { files: ['impactMining_002', 'impactMining_004'], gain: 0.22, rate: [1.3, 1.5], maxDur: 0.3 },
    { files: range('impactGlass_light', 0, 2), gain: 0.12, rate: [0.55, 0.7], delay: 0.01 },
  ],
  smashBig: [
    { files: range('impactPlate_medium', 0, 2), gain: 0.3, rate: [0.7, 0.8] },
    { files: ['impactGlass_heavy_000', 'impactGlass_heavy_001'], gain: 0.16, rate: [0.8, 0.9], delay: 0.03 },
    { files: ['creak1'], gain: 0.2, rate: [1.2, 1.3], delay: 0.06, maxDur: 0.4 },
  ],
  bump: [{ files: range('impactSoft_medium', 0, 4), gain: 0.16, rate: [0.6, 0.7] }],
  heal: [
    { files: ['confirmation_002'], gain: 0.16, rate: [1.1, 1.1] },
    { files: ['glass_004'], gain: 0.1, rate: [1.4, 1.5], delay: 0.04 },
  ],
  buff: [
    { files: ['forceField_001'], gain: 0.26, rate: [1.15, 1.25] },
    { files: ['impactBell_heavy_003'], gain: 0.1, rate: [1.9, 2], delay: 0.05 },
  ],
  buffEnd: [{ files: ['forceField_004'], gain: 0.12, rate: [0.6, 0.65], maxDur: 0.5 }],
  // Hazards: eruptions, meteors and fireballs landing, and a salamander's flame.
  erupt: [
    { files: ['lowFrequency_explosion_000'], gain: 0.12, rate: [1.1, 1.3] },
    { files: ['explosionCrunch_004'], gain: 0.07, rate: [1.2, 1.4], delay: 0.02 },
  ],
  flame: [{ files: ['forceField_002'], gain: 0.16, rate: [0.5, 0.6], maxDur: 0.5 }],
  // The Hollows and the Catacombs: spore puffs, icicles, burrowing, a golem's slam and bones rattling.
  spores: [
    { files: ['slime_000'], gain: 0.2, rate: [0.7, 0.9], maxDur: 0.5 },
    { files: ['impactSoft_heavy_001'], gain: 0.12, rate: [1.1, 1.3], delay: 0.03 },
  ],
  icicle: [
    { files: range('impactGlass_light', 0, 2), gain: 0.2, rate: [1.3, 1.6] },
    { files: ['glass_004', 'glass_006'], gain: 0.1, rate: [1.0, 1.2], delay: 0.02, maxDur: 0.4 },
  ],
  burrow: [
    { files: ['impactMining_000', 'impactMining_002'], gain: 0.2, rate: [0.5, 0.6], maxDur: 0.4 },
    { files: ['lowFrequency_explosion_001'], gain: 0.08, rate: [1.4, 1.6], delay: 0.04 },
  ],
  slam: [
    { files: range('impactPunch_heavy', 0, 2), gain: 0.28, rate: [0.5, 0.6] },
    { files: ['impactGlass_heavy_000', 'impactGlass_heavy_001'], gain: 0.12, rate: [0.9, 1.0], delay: 0.03 },
  ],
  rattle: [{ files: range('impactPlate_medium', 0, 2), gain: 0.16, rate: [1.6, 1.9], maxDur: 0.25 }],
};

export const SFX_FILES: string[] = [...new Set(Object.values(SFX_SAMPLES).flatMap((ls) => ls.flatMap((l) => l.files)))];

/** Crystal pickups climb a minor pentatonic scale while you keep collecting. */
const PICKUP_STEPS = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34];

export function pickupRate(pitch: number): number {
  const i = Math.max(0, Math.min(PICKUP_STEPS.length - 1, Math.round(pitch)));
  return 0.8 * Math.pow(2, PICKUP_STEPS[i] / 12);
}

// ---------------------------------------------------------------- synthesized fallback

/** The original synthesized effects, used until the samples load or if they can't decode. */
export function playSynth(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  name: SfxName,
  pitch: number,
  now: number,
  rand: () => number = Math.random,
): void {
  const tone = (freq: number, endFreq: number, dur: number, wave: OscillatorType, gain: number, delay = 0) => {
    const t = now + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.015, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };
  const hiss = (dur: number, gain: number, filterFreq: number, type: BiquadFilterType = 'bandpass', delay = 0) => {
    const t = now + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, rand() * 0.2);
    src.stop(t + dur + 0.02);
  };
  switch (name) {
    case 'bolt':
      tone(1100, 380, 0.13, 'triangle', 0.22);
      tone(2200, 900, 0.07, 'sine', 0.08);
      break;
    case 'lightning':
      hiss(0.28, 0.4, 3200, 'highpass');
      tone(180, 60, 0.25, 'sawtooth', 0.12);
      hiss(0.12, 0.3, 1500, 'bandpass', 0.06);
      break;
    case 'nova':
      tone(220, 55, 0.5, 'sine', 0.45);
      tone(660, 330, 0.35, 'triangle', 0.12);
      hiss(0.35, 0.18, 900, 'lowpass');
      break;
    case 'hit':
      tone(520 + rand() * 80, 260, 0.05, 'square', 0.06);
      break;
    case 'kill':
      tone(340, 120, 0.12, 'triangle', 0.16);
      hiss(0.08, 0.12, 2400);
      break;
    case 'pickup': {
      const f = 880 * Math.pow(2, Math.min(pitch, 14) / 24);
      tone(f, f * 1.5, 0.07, 'sine', 0.12);
      break;
    }
    case 'levelup':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.18, i * 0.07));
      break;
    case 'hurt':
      tone(160, 70, 0.25, 'sawtooth', 0.28);
      hiss(0.15, 0.25, 600, 'lowpass');
      break;
    case 'wall':
      tone(120, 60, 0.15, 'square', 0.15);
      break;
    case 'unclear':
      tone(200, 150, 0.16, 'square', 0.08);
      tone(190, 140, 0.16, 'square', 0.06, 0.08);
      break;
    case 'cooldown':
      tone(420, 400, 0.06, 'sine', 0.1);
      tone(320, 300, 0.08, 'sine', 0.08, 0.06);
      break;
    case 'enemyShot':
      tone(300, 520, 0.12, 'sine', 0.07);
      break;
    case 'telegraph':
      tone(240, 300, 0.18, 'triangle', 0.05);
      break;
    case 'charge':
      hiss(0.3, 0.2, 400, 'lowpass');
      tone(90, 60, 0.3, 'sawtooth', 0.1);
      break;
    case 'portal':
      tone(140, 280, 0.25, 'sine', 0.05);
      break;
    case 'bossWarn':
      tone(110, 80, 0.8, 'sawtooth', 0.18);
      tone(165, 120, 0.8, 'sawtooth', 0.12, 0.1);
      break;
    case 'bossDie':
      tone(300, 40, 1.2, 'sawtooth', 0.3);
      hiss(1.0, 0.35, 800, 'lowpass');
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, f, 0.3, 'triangle', 0.12, 0.4 + i * 0.09));
      break;
    case 'death':
      tone(440, 55, 1.1, 'triangle', 0.3);
      tone(330, 41, 1.1, 'sine', 0.2, 0.05);
      break;
    case 'select':
      tone(660, 990, 0.1, 'triangle', 0.14);
      break;
    case 'ward':
      [880, 1320].forEach((f, i) => tone(f, f * 1.02, 0.4, 'sine', 0.26, i * 0.05));
      break;
    case 'wardHit':
      tone(1200, 900, 0.18, 'triangle', 0.21);
      hiss(0.1, 0.2, 3000);
      break;
    case 'frost':
      hiss(0.4, 0.55, 5000, 'highpass');
      tone(1800, 2400, 0.3, 'sine', 0.13);
      break;
    case 'lance':
      tone(900, 300, 0.25, 'sawtooth', 0.3);
      hiss(0.2, 0.5, 2500);
      break;
    case 'evolve':
      [523, 784, 1047, 1568].forEach((f, i) => tone(f, f, 0.3, 'triangle', 0.16, i * 0.08));
      break;
    case 'shieldHit':
      tone(1500, 1300, 0.05, 'square', 0.06);
      break;
    case 'split':
      tone(300, 600, 0.12, 'sine', 0.14);
      break;
    case 'perfect':
      [1568, 2093].forEach((f, i) => tone(f, f, 0.18, 'sine', 0.13, i * 0.05));
      break;
    case 'constrict':
      tone(110, 60, 0.3, 'square', 0.2);
      hiss(0.25, 0.27, 700, 'lowpass');
      break;
    case 'descend':
      tone(90, 45, 1.2, 'sawtooth', 0.25);
      hiss(1.0, 0.31, 500, 'lowpass');
      break;
    case 'smash':
      hiss(0.12, 0.2, 2400, 'bandpass');
      tone(420, 180, 0.08, 'square', 0.06);
      break;
    case 'smashBig':
      hiss(0.3, 0.3, 900, 'lowpass');
      tone(160, 70, 0.25, 'square', 0.12);
      break;
    case 'bump':
      tone(140, 90, 0.1, 'sine', 0.14);
      break;
    case 'heal':
      [660, 880, 1320].forEach((f, i) => tone(f, f, 0.14, 'sine', 0.1, i * 0.05));
      break;
    case 'buff':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.18, 'triangle', 0.12, i * 0.04));
      break;
    case 'buffEnd':
      tone(520, 260, 0.3, 'sine', 0.08);
      break;
    case 'erupt':
      tone(80, 40, 0.4, 'sawtooth', 0.14);
      hiss(0.35, 0.22, 800, 'lowpass');
      break;
    case 'flame':
      hiss(0.4, 0.16, 1200, 'bandpass');
      break;
    case 'spores':
      hiss(0.3, 0.14, 600, 'lowpass');
      break;
    case 'icicle':
      tone(1800, 2600, 0.12, 'triangle', 0.08);
      break;
    case 'burrow':
      hiss(0.35, 0.2, 400, 'lowpass');
      tone(90, 50, 0.3, 'sine', 0.12);
      break;
    case 'slam':
      tone(70, 35, 0.4, 'square', 0.14);
      hiss(0.25, 0.2, 700, 'lowpass');
      break;
    case 'rattle':
      tone(900, 700, 0.08, 'square', 0.06);
      break;
    case 'ultimate':
      tone(220, 55, 0.9, 'sawtooth', 0.22);
      [523, 784, 1047].forEach((f, i) => tone(f, f * 1.5, 0.5, 'triangle', 0.14, 0.05 + i * 0.07));
      hiss(0.6, 0.3, 1500, 'lowpass');
      break;
    case 'ultReady':
      [1047, 1568].forEach((f, i) => tone(f, f, 0.25, 'sine', 0.12, i * 0.08));
      break;
    case 'starfall':
      tone(1400, 300, 0.2, 'triangle', 0.1);
      hiss(0.2, 0.18, 2000, 'bandpass');
      break;
  }
}
