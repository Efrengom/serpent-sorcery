import type { MapId } from '../maps/types';
import type { Voice } from './synth';

/**
 * The soundtrack, written as data: each map has a theme for the run and one for its boss, each
 * with its own chords, melody, patterns and band (the instruments that play it), plus a victory
 * sting and an ambient bed. Time is counted in sixteenth-note steps, 16 to a bar. Everything here
 * is pure so it can be unit-tested; music/player.ts turns it into sound.
 */

export const STEPS_PER_BAR = 16;

export type ThemeId =
  | 'ruins'
  | 'ruinsBoss'
  | 'hollows'
  | 'hollowsBoss'
  | 'catacombs'
  | 'catacombsBoss'
  | 'ember'
  | 'emberBoss'
  | 'finale';
export type LayerId = 'bassCalm' | 'bass' | 'arp' | 'lead' | 'harmony' | 'drums' | 'hats';
export const LAYERS: LayerId[] = ['bassCalm', 'bass', 'arp', 'lead', 'harmony', 'drums', 'hats'];

export interface NoteEvent {
  step: number;
  len: number;
  midi: number;
}

/** [step, length, semitones above the bar's bass root] */
type BassHit = readonly [number, number, number];

export interface Kit {
  kick: { gain: number; from: number; to: number };
  snare: 'snare' | 'rim' | 'clap';
  snareGain: number;
  hat: { gain: number; cutoff: number; open: boolean };
  /** The theme's extra drum, played from its `perc` pattern. */
  perc?: 'woodblock' | 'tom' | 'anvil';
  percGain?: number;
  /** What rolls into the end of a phrase. */
  fill: 'snare' | 'woodblock' | 'tom';
  crash: boolean;
  /** Close every phrase with a fill even in the lighter arrangements (the boss themes do). */
  alwaysFill: boolean;
}

/** The instruments that play a theme, and the space they play in. */
export interface Band {
  lead: Voice;
  harmony: Voice;
  /** Arpeggio: which chord tones in what order, one every `every` steps, `gate` long, `octave` up. */
  arp: { voice: Voice; order: number[]; every: number; gate: number; octave: number };
  bass: Voice;
  bassCalm: Voice;
  kit: Kit;
  /** Echo on the lead and arpeggio: delay in steps, feedback, its low-pass tone and send level. */
  echo: { steps: number; feedback: number; tone: number; send: number };
  /** A room for the lead, harmony, arpeggio and toll to ring in. */
  reverb?: { seconds: number; send: number };
  /** Level trims (1 = the shared mix), set by measurement so every theme sits alike. */
  trim?: Partial<Record<LayerId | 'toll', number>>;
}

export interface Theme {
  title: string;
  bpm: number;
  /** Every note name the theme uses, so the tests can catch a wrong note. */
  scale: string;
  /** One chord per bar, e.g. 'Dm', 'Bb', 'A7'. */
  chords: string[];
  /** One bar of melody per entry: "D5:6 A4:2 -:4" means note:sixteenths, '-' is a rest. */
  lead: string[];
  bass: BassHit[];
  /** The quiet arrangement's bass (BASS_CALM unless set). */
  bassCalm?: BassHit[];
  /** Lowest note of the bass register (MIDI); each chord's root goes in the octave above it. */
  bassFloor?: number;
  kick: string;
  snare: string;
  hats: string;
  busyHats: string;
  /** Extra drum hits: 'h' and 'l' for its high and low sound. */
  perc?: string;
  /** A fill closes every Nth bar. */
  fillEvery: number;
  /** How far odd sixteenths are pushed late, as a fraction of a step (0 is straight). */
  swing?: number;
  /** A bell tolled on the chord root on the first beat of every Nth bar, whenever a bass plays. */
  toll?: { every: number; voice: Voice; floor: number };
  band: Band;
}

/** Two bars of fanfare played once when a map's boss falls. */
export interface Sting {
  chords: [string, string];
  lead: [string, string];
}

export type AmbienceId = 'cave' | 'wind' | 'lava';

export interface Soundtrack {
  run: ThemeId;
  boss: ThemeId;
  sting: Sting;
  /** The bed of sound under the music (dripping caves, wind, lava), or none. */
  ambience: AmbienceId | null;
}

/** Half notes on the root and fifth, used by every theme's quiet arrangement unless it has its own. */
export const BASS_CALM: BassHit[] = [
  [0, 8, 0],
  [8, 8, 7],
];

const BASS_DRIVE: BassHit[] = [
  [0, 2, 0],
  [2, 2, 12],
  [4, 2, 0],
  [6, 2, 12],
  [8, 2, 0],
  [10, 2, 12],
  [12, 2, 7],
  [14, 2, 12],
];

const BASS_GALLOP: BassHit[] = [
  [0, 2, 0],
  [2, 1, 0],
  [3, 1, 0],
  [4, 2, 0],
  [6, 1, 0],
  [7, 1, 0],
  [8, 2, 12],
  [10, 1, 0],
  [11, 1, 0],
  [12, 2, 0],
  [14, 1, 7],
  [15, 1, 0],
];

/** Arpeggio order through arpTones: up and back down. */
export const ARP_ORDER = [0, 1, 2, 3, 2, 1];

// ---------------------------------------------------------------- shared instruments

/** The original band: pulse-wave lead, harmony and arpeggio over a triangle bass. */
const CHIP_LEAD: Voice = { wave: 'pulse', gain: 1, duty: 0.25, vibrato: 16 };
const CHIP_HARMONY: Voice = { wave: 'pulse', gain: 1, duty: 0.5 };
const CHIP_ARP: Voice = { wave: 'pulse', gain: 1, duty: 0.125 };
const TRI_BASS: Voice = { wave: 'triangle', gain: 1, attack: 0.004, sustain: 0.85, decay: 0.2, hold: 0.94, release: 0.01 };
const CHIP_KIT: Kit = {
  kick: { gain: 1, from: 165, to: 48 },
  snare: 'snare',
  snareGain: 0.8,
  hat: { gain: 1, cutoff: 7200, open: false },
  fill: 'snare',
  crash: true,
  alwaysFill: false,
};

/** A celesta: FM with a whole-number ratio keeps the pitch clear and glassy. */
const CELESTA: Voice = {
  wave: 'sine',
  gain: 1.25,
  fm: { ratio: 4, index: 1.6, decay: 0.3 },
  attack: 0.003,
  sustain: 0.28,
  decay: 0.8,
  hold: 0.98,
  release: 0.22,
};
/** A church bell: an inharmonic ratio and a long ring. */
const TOLL_BELL: Voice = {
  wave: 'sine',
  gain: 1,
  fm: { ratio: 1.4, index: 2.6, decay: 0.7 },
  attack: 0.002,
  sustain: 0.3,
  decay: 1.4,
  hold: 1,
  release: 0.6,
};
/** Saw through a soft clipper and a low-pass: the Ember's hot, buzzing tone. */
const GRIT_BASS: Voice = {
  wave: 'sawtooth',
  gain: 1,
  filter: 650,
  drive: 3,
  attack: 0.003,
  sustain: 0.85,
  decay: 0.2,
  hold: 0.85,
  release: 0.015,
};

// ---------------------------------------------------------------- Sunken Ruins

/**
 * "Sigil of the Serpent": D minor, 132 BPM, A-B-A'-B'. The A section states the motif,
 * B lifts into the relative major, and the primed sections end with new cadences.
 */
const RUINS: Theme = {
  title: 'Sigil of the Serpent',
  bpm: 132,
  scale: 'D E F G A Bb C C#',
  chords: [
    'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'Gm', 'A7',
    'Bb', 'C', 'Am', 'Dm', 'Gm', 'C', 'F', 'A7',
    'Dm', 'Bb', 'C', 'Dm', 'Bb', 'C', 'Dm', 'Dm',
    'Bb', 'C', 'Am', 'Dm', 'Gm', 'A7', 'Dm', 'A7',
  ],
  lead: [
    // A
    'D5:6 A4:2 D5:2 E5:2 F5:4',
    'F5:6 E5:2 D5:4 Bb4:4',
    'C5:6 D5:2 E5:4 G5:4',
    'F5:4 E5:2 F5:2 A5:8',
    'D5:6 A4:2 D5:2 E5:2 F5:4',
    'F5:6 G5:2 F5:2 D5:2 Bb4:4',
    'G4:2 Bb4:2 D5:2 G5:2 F5:2 E5:2 D5:2 Bb4:2',
    'A4:2 C#5:2 E5:2 A5:2 G5:4 E5:4',
    // B
    'F5:8 D5:4 F5:4',
    'G5:6 F5:2 E5:4 C5:4',
    'E5:8 A5:4 G5:4',
    'F5:6 E5:2 D5:8',
    'D5:2 G5:2 Bb5:4 A5:2 G5:2 F5:4',
    'E5:2 G5:2 C6:4 Bb5:2 A5:2 G5:4',
    'A5:6 G5:2 F5:4 C5:4',
    'E5:8 C#5:4 E5:4',
    // A'
    'D5:6 A4:2 D5:2 E5:2 F5:4',
    'F5:6 E5:2 D5:4 Bb4:4',
    'C5:6 D5:2 E5:4 G5:4',
    'F5:4 E5:2 F5:2 A5:8',
    'Bb5:6 A5:2 G5:2 F5:2 D5:4',
    'C6:6 Bb5:2 A5:2 G5:2 E5:4',
    'D6:4 A5:4 F5:4 E5:4',
    'D5:12 -:4',
    // B'
    'F5:8 D5:4 F5:4',
    'G5:6 F5:2 E5:4 C5:4',
    'E5:8 A5:4 G5:4',
    'F5:6 E5:2 D5:8',
    'D5:2 G5:2 Bb5:4 A5:2 G5:2 F5:4',
    'E5:2 G5:2 C#6:4 Bb5:2 A5:2 G5:4',
    'F5:4 A5:4 D6:4 C6:2 A5:2',
    'A5:2 G5:2 F5:2 E5:2 D5:2 C#5:2 E5:2 A4:2',
  ],
  bass: BASS_DRIVE,
  kick: 'x.....x.x.......',
  snare: '....x.......x...',
  hats: 'x.x.x.x.x.x.x.x.',
  busyHats: 'x.xxx.xxx.xxx.xx',
  fillEvery: 8,
  band: {
    lead: CHIP_LEAD,
    harmony: CHIP_HARMONY,
    arp: { voice: CHIP_ARP, order: ARP_ORDER, every: 1, gate: 0.9, octave: 0 },
    bass: TRI_BASS,
    bassCalm: TRI_BASS,
    kit: CHIP_KIT,
    echo: { steps: 3, feedback: 0.32, tone: 2400, send: 0.22 },
  },
};

/**
 * "Ouroboros": the Ruins' boss theme. Faster (150 BPM), galloping bass, four-on-the-floor kick
 * and a melody that leans on the tritone and the flat second for menace.
 */
const RUINS_BOSS: Theme = {
  title: 'Ouroboros',
  bpm: 150,
  scale: 'D E Eb F G G# A Bb C C#',
  chords: ['Dm', 'Eb', 'Dm', 'C', 'Bb', 'Eb', 'A', 'A', 'Bb', 'C', 'Dm', 'Dm', 'Eb', 'Eb', 'A7', 'A7'],
  lead: [
    'D5:2 F5:2 A5:4 G#5:2 A5:2 F5:4',
    'G5:2 Eb5:2 Bb5:4 A5:2 G5:2 Eb5:4',
    'D5:2 F5:2 A5:4 D6:4 C6:2 A5:2',
    'G5:6 E5:2 C5:4 E5:4',
    'F5:4 D5:2 F5:2 Bb5:4 A5:2 F5:2',
    'G5:4 Eb5:2 G5:2 Bb5:4 C6:2 Bb5:2',
    'A5:2 C#6:2 E6:4 D6:2 C#6:2 Bb5:4',
    'A5:12 -:4',
    'F5:4 Bb5:4 D6:8',
    'E6:6 D6:2 C6:4 G5:4',
    'A5:12 D6:4',
    'C6:2 A5:2 F5:4 D5:8',
    'G5:4 Bb5:4 Eb6:4 D6:4',
    'C6:6 Bb5:2 G5:8',
    'A5:2 Bb5:2 C#6:2 E6:2 G6:4 E6:4',
    'E6:2 D6:2 C#6:2 Bb5:2 A5:2 G5:2 F5:2 E5:2',
  ],
  bass: BASS_GALLOP,
  kick: 'x...x...x...x...',
  snare: '....x.......x...',
  hats: 'xxxxxxxxxxxxxxxx',
  busyHats: 'xxxxxxxxxxxxxxxx',
  fillEvery: 4,
  band: {
    // A square lead is brighter, the galloping bass shorter and the hats busier, so they're
    // trimmed to sit in the same balance as the run theme.
    lead: { ...CHIP_LEAD, gain: 0.6, duty: 0.5 },
    harmony: CHIP_HARMONY,
    arp: { voice: CHIP_ARP, order: ARP_ORDER, every: 1, gate: 0.9, octave: 0 },
    bass: { ...TRI_BASS, gain: 1.25 },
    bassCalm: TRI_BASS,
    kit: { ...CHIP_KIT, hat: { gain: 0.5, cutoff: 7200, open: true }, alwaysFill: true },
    echo: { steps: 3, feedback: 0.32, tone: 2400, send: 0.22 },
  },
};

// ---------------------------------------------------------------- Mycelium Hollows

/**
 * "Glowcap Hollow": E Dorian (the raised sixth, C#, is the glow), 120 BPM with a swung
 * sixteenth bounce. A soft, chorused ocarina over bubbling arpeggios, woodblocks and claps.
 */
const HOLLOWS: Theme = {
  title: 'Glowcap Hollow',
  bpm: 120,
  scale: 'E F# G A B C# D D#',
  chords: [
    'Em', 'A', 'Em', 'A', 'G', 'D', 'Em', 'Bm',
    'G', 'A', 'F#m', 'Bm', 'G', 'A', 'Em', 'B7',
    'Em', 'A', 'Em', 'A', 'D', 'A', 'Bm', 'Em',
    'G', 'A', 'F#m', 'Bm', 'G', 'A', 'Em', 'B7',
  ],
  lead: [
    // A
    'E5:3 G5:1 B5:4 A5:2 G5:2 E5:4',
    'C#6:3 B5:1 A5:4 E5:4 -:4',
    'E5:3 G5:1 B5:2 D6:2 B5:2 A5:2 G5:4',
    'A5:3 F#5:1 E5:4 C#5:8',
    'B5:3 D6:1 B5:2 G5:2 A5:2 B5:2 D6:4',
    'F#5:3 A5:1 F#5:2 D5:2 E5:2 F#5:2 A5:4',
    'G5:3 F#5:1 E5:2 D5:2 E5:4 G5:4',
    'F#5:8 D5:4 B4:4',
    // B
    'D6:6 B5:2 G5:4 B5:4',
    'C#6:6 A5:2 E5:4 A5:4',
    'A5:4 F#5:2 A5:2 C#6:4 B5:2 A5:2',
    'B5:6 A5:2 F#5:8',
    'G5:2 B5:2 D6:4 E6:2 D6:2 B5:4',
    'A5:2 C#6:2 E6:4 F#6:2 E6:2 C#6:4',
    'E6:4 D6:2 B5:2 G5:4 E5:4',
    'D#5:4 F#5:4 A5:4 B5:4',
    // A'
    'E5:3 G5:1 B5:4 A5:2 G5:2 E5:4',
    'C#6:3 B5:1 A5:4 E5:4 -:4',
    'E5:3 G5:1 B5:2 D6:2 B5:2 A5:2 G5:4',
    'A5:3 F#5:1 E5:4 C#5:8',
    'A5:3 F#5:1 A5:2 D6:2 C#6:2 A5:2 F#5:4',
    'E6:3 C#6:1 A5:2 E5:2 F#5:2 G5:2 A5:4',
    'B5:4 A5:2 G5:2 F#5:4 D5:4',
    'E5:12 -:4',
    // B'
    'D6:6 B5:2 G5:4 B5:4',
    'C#6:6 A5:2 E5:4 A5:4',
    'A5:4 F#5:2 A5:2 C#6:4 B5:2 A5:2',
    'B5:6 A5:2 F#5:8',
    'G5:2 B5:2 D6:4 E6:2 D6:2 B5:4',
    'A5:2 C#6:2 E6:4 F#6:2 E6:2 C#6:4',
    'G6:4 E6:4 B5:4 G5:4',
    'F#5:2 A5:2 B5:2 D#6:2 F#6:4 D#6:4',
  ],
  bass: [
    [0, 3, 0],
    [3, 1, 7],
    [4, 2, 12],
    [6, 2, 7],
    [8, 3, 0],
    [11, 1, 7],
    [12, 2, 12],
    [14, 2, 7],
  ],
  bassFloor: 40,
  kick: 'x..x....x.......',
  snare: '....x.......x...',
  hats: '..x...x...x...x.',
  busyHats: 'x.xxx.xxx.xxx.xx',
  perc: '..h..l.h..h..l..',
  fillEvery: 8,
  swing: 0.3,
  band: {
    lead: { wave: 'triangle', gain: 1.3, attack: 0.025, sustain: 0.7, decay: 0.25, hold: 0.9, release: 0.04, vibrato: 22, detune: 9 },
    harmony: { wave: 'sine', gain: 1.4, attack: 0.03, sustain: 0.7, decay: 0.3, hold: 0.9, release: 0.05 },
    arp: {
      voice: { wave: 'pulse', gain: 0.95, duty: 0.25, blip: 5, sustain: 0.3, decay: 0.05, hold: 0.6 },
      order: [0, 2, 1, 3, 1, 2],
      every: 2,
      gate: 0.8,
      octave: 0,
    },
    bass: TRI_BASS,
    bassCalm: TRI_BASS,
    kit: {
      kick: { gain: 0.85, from: 130, to: 45 },
      snare: 'clap',
      snareGain: 0.55,
      hat: { gain: 0.7, cutoff: 8500, open: false },
      perc: 'woodblock',
      percGain: 0.6,
      fill: 'woodblock',
      crash: false,
      alwaysFill: false,
    },
    echo: { steps: 3, feedback: 0.38, tone: 1800, send: 0.26 },
    reverb: { seconds: 1.6, send: 0.18 },
    trim: { lead: 0.64, harmony: 0.77, arp: 1.26, drums: 1.12, hats: 1.2 },
  },
};

/**
 * "Sporemaw": E minor with the flat second (F) for menace, 138 BPM in a lurching, swung
 * half-time. A growling wah lead over a distorted saw bass.
 */
const HOLLOWS_BOSS: Theme = {
  title: 'Sporemaw',
  bpm: 138,
  scale: 'E F F# G A B C D D#',
  chords: ['Em', 'F', 'Em', 'D', 'C', 'B', 'Em', 'Em', 'Am', 'F', 'Em', 'B7', 'C', 'F', 'B7', 'B7'],
  lead: [
    'E5:4 F5:2 E5:2 B5:6 -:2',
    'A5:4 G5:2 F5:2 C6:6 -:2',
    'B5:4 C6:2 B5:2 G5:4 E5:4',
    'F#5:4 A5:2 F#5:2 D5:8',
    'E5:4 G5:2 C6:2 E6:4 D6:2 C6:2',
    'D#6:6 B5:2 F#5:4 D#5:4',
    'E6:4 B5:2 G5:2 E5:4 G5:4',
    'E5:6 F5:2 E5:2 D#5:2 E5:4',
    'A5:4 C6:2 E6:2 D6:2 C6:2 B5:4',
    'C6:4 A5:2 F5:2 A5:4 C6:4',
    'B5:6 G5:2 E5:4 G5:4',
    'F#5:2 A5:2 B5:2 D#6:2 F#6:6 -:2',
    'G6:4 E6:2 C6:2 G5:4 E5:4',
    'F6:4 C6:2 A5:2 F5:4 A5:4',
    'D#6:4 F#6:4 A5:4 B5:4',
    'B5:2 A5:2 F#5:2 D#5:2 F5:2 E5:2 D#5:2 B4:2',
  ],
  bass: [
    [0, 3, 0],
    [3, 3, 0],
    [6, 2, 12],
    [8, 2, 0],
    [10, 2, 7],
    [12, 4, 0],
  ],
  bassFloor: 40,
  kick: 'x.........x.x...',
  snare: '........x.......',
  hats: 'x.x.x.x.x.x.x.x.',
  busyHats: 'xxxxxxxxxxxxxxxx',
  perc: '...h..l....h.l..',
  fillEvery: 4,
  swing: 0.2,
  band: {
    lead: { wave: 'sawtooth', gain: 0.55, filter: 1500, sweep: 3, drive: 1.5, vibrato: 20, sustain: 0.7, decay: 0.2 },
    harmony: { wave: 'pulse', gain: 0.8, duty: 0.5, filter: 2000 },
    arp: {
      voice: { wave: 'pulse', gain: 0.95, duty: 0.25, blip: 5, sustain: 0.3, decay: 0.05, hold: 0.6 },
      order: [0, 2, 1, 3],
      every: 1,
      gate: 0.8,
      octave: 0,
    },
    bass: { wave: 'sawtooth', gain: 1, filter: 420, drive: 2, attack: 0.004, sustain: 0.8, decay: 0.2, hold: 0.9, release: 0.02 },
    bassCalm: TRI_BASS,
    kit: {
      kick: { gain: 1.1, from: 150, to: 40 },
      snare: 'snare',
      snareGain: 0.9,
      hat: { gain: 0.6, cutoff: 7000, open: true },
      perc: 'woodblock',
      percGain: 0.5,
      fill: 'snare',
      crash: true,
      alwaysFill: true,
    },
    echo: { steps: 3, feedback: 0.3, tone: 2000, send: 0.2 },
    reverb: { seconds: 1.2, send: 0.12 },
    trim: { lead: 1.26, harmony: 1.27, bass: 0.86, drums: 1.19, hats: 1.13 },
  },
};

// ---------------------------------------------------------------- Rimefrost Catacombs

/**
 * "Rimefrost Bells": B minor shadowed by the flat second (C), 140 BPM in half-time, so it moves
 * slowly while the arpeggio glitters. A celesta melody over a cold pad, rim clicks, and a bell
 * tolled every four bars in a long, dark room.
 */
const CATACOMBS: Theme = {
  title: 'Rimefrost Bells',
  bpm: 140,
  scale: 'B C# D E F# G A A# C',
  chords: [
    'Bm', 'G', 'C', 'Bm', 'Em', 'Bm', 'C', 'F#7',
    'G', 'D', 'A', 'Bm', 'G', 'D', 'Em', 'F#7',
    'Bm', 'G', 'C', 'Bm', 'Em', 'C', 'F#7', 'Bm',
    'G', 'D', 'A', 'Bm', 'Em', 'C', 'F#7', 'F#7',
  ],
  lead: [
    // A
    'B5:8 F#5:4 D6:4',
    'D6:6 B5:2 G5:8',
    'E6:6 G5:2 C6:8',
    'B5:12 -:4',
    'G5:4 B5:4 E6:6 D6:2',
    'F#6:6 E6:2 D6:4 B5:4',
    'G6:6 E6:2 C6:4 G5:4',
    'F#6:4 E6:4 C#6:4 A#5:4',
    // B
    'D6:8 B5:4 D6:4',
    'F#6:8 A5:4 D6:4',
    'E6:6 C#6:2 A5:8',
    'D6:6 C#6:2 B5:8',
    'B5:4 D6:4 G6:8',
    'F#6:6 E6:2 D6:4 A5:4',
    'G6:4 F#6:4 E6:4 B5:4',
    'C#6:8 A#5:4 F#5:4',
    // A'
    'B5:8 F#5:4 D6:4',
    'D6:6 B5:2 G5:8',
    'E6:6 G5:2 C6:8',
    'B5:12 -:4',
    'E6:6 D6:2 B5:4 G5:4',
    'G6:6 E6:2 C6:8',
    'A#5:4 C#6:4 E6:4 F#6:4',
    'F#6:4 D6:4 B5:8',
    // B'
    'D6:8 B5:4 D6:4',
    'F#6:8 A5:4 D6:4',
    'E6:6 C#6:2 A5:8',
    'D6:6 C#6:2 B5:8',
    'G5:4 B5:4 E6:8',
    'E6:4 G6:4 E6:4 C6:4',
    'F#6:8 E6:4 C#6:4',
    'C#6:4 A#5:4 F#5:4 A#5:4',
  ],
  bass: [
    [0, 6, 0],
    [6, 2, 7],
    [8, 6, 0],
    [14, 2, 12],
  ],
  kick: 'x.........x.....',
  snare: '........x.......',
  hats: '..x...x...x...x.',
  busyHats: 'x.x.x.x.x.x.x.x.',
  perc: '...........l..l.',
  fillEvery: 8,
  toll: { every: 4, voice: TOLL_BELL, floor: 59 },
  band: {
    lead: CELESTA,
    harmony: { wave: 'triangle', gain: 1.2, attack: 0.12, sustain: 0.9, decay: 0.5, hold: 0.95, release: 0.2 },
    arp: {
      voice: { wave: 'sine', gain: 0.8, fm: { ratio: 2, index: 1, decay: 0.08 }, sustain: 0.1, decay: 0.06, hold: 0.6, release: 0.03 },
      order: ARP_ORDER,
      every: 1,
      gate: 0.8,
      octave: 12,
    },
    bass: { wave: 'triangle', gain: 1.1, attack: 0.01, sustain: 0.9, decay: 0.6, hold: 0.95, release: 0.05 },
    bassCalm: TRI_BASS,
    kit: {
      kick: { gain: 0.9, from: 110, to: 40 },
      snare: 'rim',
      snareGain: 0.7,
      hat: { gain: 0.55, cutoff: 9000, open: false },
      perc: 'tom',
      percGain: 0.6,
      fill: 'tom',
      crash: false,
      alwaysFill: false,
    },
    echo: { steps: 6, feedback: 0.35, tone: 1500, send: 0.18 },
    reverb: { seconds: 2.8, send: 0.32 },
    trim: { lead: 0.58, arp: 0.91, bass: 0.85, bassCalm: 0.82, hats: 1.29 },
  },
};

/**
 * "Rimecoil": a crypt-organ toccata in B harmonic minor, 150 BPM: stacked organ stops, a driving
 * octave pedal, glassy arpeggios and the bell tolling every two bars.
 */
const CATACOMBS_BOSS: Theme = {
  title: 'Rimecoil',
  bpm: 150,
  scale: 'B C# D E F# G A A# C',
  chords: ['Bm', 'Bm', 'Em', 'F#', 'G', 'C', 'F#7', 'F#7', 'Bm', 'Bm', 'Em', 'A#dim', 'Bm', 'C', 'F#7', 'F#7'],
  lead: [
    'B5:2 A#5:2 B5:2 F#5:2 D5:2 F#5:2 B4:4',
    'D6:2 C#6:2 D6:2 B5:2 F#5:2 B5:2 D5:4',
    'E6:4 G6:4 E6:2 B5:2 G5:4',
    'F#6:6 E6:2 C#6:4 A#5:4',
    'G6:4 D6:2 B5:2 G5:4 B5:4',
    'G6:4 E6:2 C6:2 G5:4 E6:4',
    'F#6:2 E6:2 C#6:2 A#5:2 F#5:2 A#5:2 C#6:2 E6:2',
    'F#6:8 C#6:4 A#5:4',
    'B5:2 D6:2 F#6:4 E6:2 D6:2 C#6:4',
    'D6:2 B5:2 F#5:4 G5:2 F#5:2 D5:4',
    'E5:2 G5:2 B5:4 E6:4 G6:4',
    'E6:4 C#6:4 A#5:4 G5:4',
    'F#5:4 B5:4 D6:4 F#6:4',
    'G6:6 E6:2 C6:4 G5:4',
    'A#5:2 C#6:2 E6:2 F#6:2 E6:2 C#6:2 A#5:2 G5:2',
    'F#5:4 A#5:4 C#6:4 E6:4',
  ],
  bass: BASS_DRIVE,
  kick: 'x...x...x...x...',
  snare: '....x.......x...',
  hats: 'xxxxxxxxxxxxxxxx',
  busyHats: 'xxxxxxxxxxxxxxxx',
  perc: '..............hl',
  fillEvery: 4,
  toll: { every: 2, voice: TOLL_BELL, floor: 59 },
  band: {
    lead: { wave: 'pulse', gain: 0.5, duty: 0.5, stack: [[12, 0.5], [19, 0.25]], attack: 0.01, sustain: 0.9, decay: 0.3, hold: 0.95, release: 0.03, vibrato: 10, filter: 3200 },
    harmony: { wave: 'pulse', gain: 0.7, duty: 0.25, stack: [[12, 0.4]], sustain: 0.85, filter: 2600 },
    arp: { voice: { ...CELESTA, gain: 0.7, sustain: 0.15, decay: 0.12 }, order: ARP_ORDER, every: 1, gate: 0.7, octave: 12 },
    bass: { ...TRI_BASS, gain: 1.2 },
    bassCalm: TRI_BASS,
    kit: {
      kick: { gain: 1.1, from: 160, to: 45 },
      snare: 'snare',
      snareGain: 0.85,
      hat: { gain: 0.55, cutoff: 8000, open: true },
      perc: 'tom',
      percGain: 0.7,
      fill: 'tom',
      crash: true,
      alwaysFill: true,
    },
    echo: { steps: 3, feedback: 0.25, tone: 2200, send: 0.15 },
    reverb: { seconds: 1.8, send: 0.2 },
    trim: { lead: 0.72, harmony: 1.41, arp: 0.62, bass: 0.62, drums: 0.82, hats: 0.92 },
  },
};

// ---------------------------------------------------------------- Ember Depths

/**
 * "The Forge Below": C# Phrygian dominant (the flat second and the augmented second, D to E#),
 * 152 BPM. A buzzing, trembling saw lead over a distorted bass, with an anvil struck on the
 * backbeat and toms rolling into each phrase.
 */
const EMBER: Theme = {
  title: 'The Forge Below',
  bpm: 152,
  scale: 'C# D E# F# G# A B',
  chords: [
    'C#', 'D', 'C#', 'D', 'F#m', 'D', 'C#', 'C#',
    'F#m', 'Bm', 'D', 'C#', 'F#m', 'Aaug', 'D', 'C#',
    'C#', 'D', 'C#', 'D', 'Bm', 'D', 'C#', 'C#',
    'F#m', 'Bm', 'D', 'C#', 'Bm', 'G#dim', 'D', 'C#',
  ],
  lead: [
    // A
    'C#5:2 D5:2 E#5:2 F#5:2 G#5:4 E#5:2 D5:2',
    'F#5:4 A5:2 F#5:2 D5:4 -:4',
    'G#5:2 A5:2 G#5:2 F#5:2 E#5:4 C#5:4',
    'D5:2 E#5:2 D5:2 C#5:2 D5:8',
    'C#6:4 A5:2 F#5:2 A5:4 C#6:4',
    'D6:4 C#6:2 B5:2 A5:4 F#5:4',
    'G#5:2 A5:2 B5:2 C#6:2 D6:2 C#6:2 B5:2 A5:2',
    'G#5:8 E#5:4 C#5:4',
    // B
    'F#5:4 A5:4 C#6:6 B5:2',
    'D6:6 C#6:2 B5:4 F#5:4',
    'A5:4 D6:4 F#6:6 E#6:2',
    'E#6:6 D6:2 C#6:8',
    'A5:2 C#6:2 F#6:4 E#6:2 D6:2 C#6:4',
    'C#6:2 E#6:2 A5:4 C#6:4 E#6:4',
    'D6:2 F#6:2 A5:2 D6:2 F#6:4 D6:4',
    'C#6:2 D6:2 C#6:2 B5:2 A5:2 G#5:2 E#5:2 D5:2',
    // A'
    'C#5:2 D5:2 E#5:2 F#5:2 G#5:4 E#5:2 D5:2',
    'F#5:4 A5:2 F#5:2 D5:4 -:4',
    'G#5:2 A5:2 G#5:2 F#5:2 E#5:4 C#5:4',
    'D5:2 E#5:2 D5:2 C#5:2 D5:8',
    'B5:4 D6:2 B5:2 F#5:4 A5:4',
    'A5:4 F#5:2 A5:2 D6:4 F#6:4',
    'E#6:2 D6:2 C#6:2 B5:2 A5:2 G#5:2 F#5:2 E#5:2',
    'C#6:12 -:4',
    // B'
    'F#5:4 A5:4 C#6:6 B5:2',
    'D6:6 C#6:2 B5:4 F#5:4',
    'A5:4 D6:4 F#6:6 E#6:2',
    'E#6:6 D6:2 C#6:8',
    'B5:2 D6:2 F#6:4 D6:2 B5:2 F#5:4',
    'G#5:4 B5:4 D6:4 B5:4',
    'F#6:4 E#6:4 D6:4 A5:4',
    'G#5:2 E#5:2 D5:2 C#5:2 D5:2 E#5:2 G#5:4',
  ],
  bass: [
    [0, 2, 0],
    [2, 2, 0],
    [4, 1, 12],
    [5, 1, 0],
    [6, 2, 0],
    [8, 2, 0],
    [10, 2, 12],
    [12, 2, 0],
    [14, 1, 7],
    [15, 1, 12],
  ],
  bassFloor: 37,
  kick: 'x.....x.x.....x.',
  snare: '....x.......x...',
  hats: 'x.x.x.x.x.x.x.x.',
  busyHats: 'x.xxx.xxx.xxx.xx',
  perc: '....h.......h...',
  fillEvery: 8,
  band: {
    lead: { wave: 'sawtooth', gain: 0.45, filter: 2600, drive: 1.2, tremolo: 0.35, vibrato: 14, sustain: 0.7, decay: 0.15 },
    harmony: { wave: 'pulse', gain: 0.8, duty: 0.25, filter: 2200 },
    arp: { voice: { wave: 'pulse', gain: 0.9, duty: 0.125, drive: 1.5 }, order: [0, 2, 1, 3, 1, 2], every: 1, gate: 0.7, octave: 0 },
    bass: GRIT_BASS,
    bassCalm: { ...GRIT_BASS, gain: 0.9, filter: 380, drive: 1.5, hold: 0.94, release: 0.03 },
    kit: {
      kick: { gain: 1.15, from: 190, to: 50 },
      snare: 'snare',
      snareGain: 0.85,
      hat: { gain: 0.7, cutoff: 6800, open: false },
      perc: 'anvil',
      percGain: 0.55,
      fill: 'tom',
      crash: true,
      alwaysFill: false,
    },
    echo: { steps: 2, feedback: 0.2, tone: 2800, send: 0.15 },
    trim: { lead: 1.82, harmony: 1.97, bass: 0.93, drums: 0.74, hats: 1.32 },
  },
};

/**
 * "Pyrecoil": the fastest theme in the game, 168 BPM in the same burning mode: a galloping
 * distorted bass, four-on-the-floor kick, the anvil on every backbeat and a screaming lead.
 */
const EMBER_BOSS: Theme = {
  title: 'Pyrecoil',
  bpm: 168,
  scale: 'C# D E# F# G# A B',
  chords: ['C#', 'D', 'C#', 'D', 'F#m', 'D', 'G#dim', 'C#', 'Bm', 'D', 'F#m', 'Aaug', 'Bm', 'D', 'C#', 'C#'],
  lead: [
    'C#6:2 G#5:2 C#6:2 D6:2 E#6:4 D6:2 C#6:2',
    'D6:2 A5:2 D6:2 E#6:2 F#6:4 E#6:2 D6:2',
    'E#6:4 D6:2 C#6:2 G#5:4 C#6:4',
    'D6:2 C#6:2 B5:2 A5:2 F#5:4 D5:4',
    'F#5:2 A5:2 C#6:2 F#6:2 E#6:2 D6:2 C#6:4',
    'D6:4 F#6:4 A5:4 D6:4',
    'G#5:2 B5:2 D6:2 G#5:2 B5:2 D6:2 F#6:4',
    'E#6:8 C#6:4 G#5:4',
    'B5:2 D6:2 F#6:4 D6:2 B5:2 F#5:4',
    'A5:2 D6:2 F#6:4 E#6:2 D6:2 A5:4',
    'C#6:4 F#6:4 E#6:2 D6:2 C#6:4',
    'E#6:4 C#6:4 A5:4 C#6:4',
    'D6:2 B5:2 F#5:2 B5:2 D6:2 F#6:2 D6:4',
    'F#6:4 A5:4 D6:4 F#6:4',
    'G#5:2 C#6:2 E#6:2 G#5:2 C#6:2 E#6:2 G#5:4',
    'C#6:2 D6:2 C#6:2 B5:2 A5:2 G#5:2 F#5:2 E#5:2',
  ],
  bass: BASS_GALLOP,
  bassFloor: 37,
  kick: 'x...x...x...x...',
  snare: '....x.......x...',
  hats: 'xxxxxxxxxxxxxxxx',
  busyHats: 'xxxxxxxxxxxxxxxx',
  perc: '....h.......h...',
  fillEvery: 4,
  band: {
    lead: { wave: 'sawtooth', gain: 0.45, filter: 3200, drive: 2, tremolo: 0.3, vibrato: 18, sustain: 0.75, decay: 0.15 },
    harmony: { wave: 'pulse', gain: 0.8, duty: 0.5, filter: 2400 },
    arp: { voice: { wave: 'pulse', gain: 0.9, duty: 0.125, drive: 1.5 }, order: ARP_ORDER, every: 1, gate: 0.7, octave: 0 },
    bass: { ...GRIT_BASS, gain: 1.1 },
    bassCalm: { ...GRIT_BASS, gain: 0.9, filter: 380, drive: 1.5, hold: 0.94, release: 0.03 },
    kit: {
      kick: { gain: 1.2, from: 190, to: 50 },
      snare: 'snare',
      snareGain: 0.85,
      hat: { gain: 0.5, cutoff: 7000, open: true },
      perc: 'anvil',
      percGain: 0.55,
      fill: 'tom',
      crash: true,
      alwaysFill: true,
    },
    echo: { steps: 2, feedback: 0.2, tone: 2800, send: 0.12 },
    trim: { lead: 1.41, harmony: 1.19, bass: 0.82, drums: 0.8 },
  },
};

// ---------------------------------------------------------------- the finale

/**
 * "Azhdaha": the Archmage Ascendant's theme, back in the Ruins' D minor (the run has come full
 * circle) at 160 BPM. The melody opens with the "Sigil of the Serpent" motif, and the band is
 * every map's at once: the Ruins' chip lead, the Catacombs' organ and celesta, the Ember's
 * distorted bass and anvil, and the bell.
 */
const FINALE: Theme = {
  title: 'Azhdaha',
  bpm: 160,
  scale: 'D E F G A Bb C C# Eb',
  chords: ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'F', 'C', 'A7', 'Bb', 'C', 'Dm', 'Bb', 'Gm', 'Eb', 'A', 'A7'],
  lead: [
    'D5:2 A4:2 D5:2 E5:2 F5:4 A5:4',
    'F5:2 D5:2 Bb4:2 D5:2 F5:4 Bb5:4',
    'G5:2 Bb5:2 D6:4 C6:2 Bb5:2 G5:4',
    'A5:4 C#6:2 E6:2 A5:8',
    'D6:2 C6:2 A5:2 F5:2 D5:4 F5:4',
    'F5:2 A5:2 C6:4 A5:2 F5:2 C5:4',
    'E5:2 G5:2 C6:4 E6:4 C6:4',
    'C#6:4 E6:4 G6:4 E6:4',
    'D6:6 Bb5:2 F5:4 D6:4',
    'E6:6 C6:2 G5:4 E6:4',
    'F6:4 E6:2 D6:2 A5:4 F5:4',
    'D6:4 F6:4 Bb5:8',
    'G5:2 Bb5:2 D6:2 G6:2 F6:2 D6:2 Bb5:4',
    'G6:4 Eb6:4 Bb5:4 G5:4',
    'A5:2 C#6:2 E6:2 A5:2 C#6:2 E6:2 G6:4',
    'E6:2 D6:2 C#6:2 Bb5:2 A5:2 G5:2 F5:2 E5:2',
  ],
  bass: BASS_GALLOP,
  kick: 'x...x...x...x...',
  snare: '....x.......x...',
  hats: 'xxxxxxxxxxxxxxxx',
  busyHats: 'xxxxxxxxxxxxxxxx',
  perc: '....h.......h...',
  fillEvery: 4,
  toll: { every: 4, voice: TOLL_BELL, floor: 59 },
  band: {
    lead: { ...CHIP_LEAD, gain: 0.8, duty: 0.25 },
    harmony: { wave: 'pulse', gain: 0.7, duty: 0.5, stack: [[12, 0.5], [19, 0.25]], sustain: 0.9, filter: 3000 },
    arp: { voice: { ...CELESTA, gain: 0.7, sustain: 0.15, decay: 0.12 }, order: ARP_ORDER, every: 1, gate: 0.7, octave: 12 },
    bass: { ...GRIT_BASS, gain: 1.05 },
    bassCalm: TRI_BASS,
    kit: {
      kick: { gain: 1.15, from: 190, to: 50 },
      snare: 'snare',
      snareGain: 0.85,
      hat: { gain: 0.5, cutoff: 7600, open: true },
      perc: 'anvil',
      percGain: 0.5,
      fill: 'tom',
      crash: true,
      alwaysFill: true,
    },
    echo: { steps: 3, feedback: 0.28, tone: 2400, send: 0.18 },
    reverb: { seconds: 1.4, send: 0.15 },
    // Drums 1 dB over the Ruins' boss theme on purpose: the last fight.
    trim: { lead: 1.13, arp: 0.59, bass: 0.67, drums: 0.89, hats: 1.29 },
  },
};

/** The run's victory: the Ruins' fanfare, answered on the dominant and resolved to D major. */
export const FINALE_STING: Sting = { chords: ['A7', 'D'], lead: ['A5:4 C#6:4 E6:4 G6:4', 'F#6:16'] };

export const THEMES: Record<ThemeId, Theme> = {
  ruins: RUINS,
  ruinsBoss: RUINS_BOSS,
  hollows: HOLLOWS,
  hollowsBoss: HOLLOWS_BOSS,
  catacombs: CATACOMBS,
  catacombsBoss: CATACOMBS_BOSS,
  ember: EMBER,
  emberBoss: EMBER_BOSS,
  finale: FINALE,
};
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/** Each map's music: its two themes, the sting when its boss falls (a major ending), its ambience. */
export const SOUNDTRACKS: Record<MapId, Soundtrack> = {
  ruins: {
    run: 'ruins',
    boss: 'ruinsBoss',
    sting: { chords: ['A7', 'D'], lead: ['E5:2 A5:2 C#6:2 E6:2 G6:8', 'F#6:12 -:4'] },
    ambience: null,
  },
  hollows: {
    run: 'hollows',
    boss: 'hollowsBoss',
    sting: { chords: ['B7', 'E'], lead: ['F#5:2 A5:2 B5:2 D#6:2 F#6:8', 'E6:4 B5:2 G#5:2 E6:8'] },
    ambience: 'cave',
  },
  catacombs: {
    run: 'catacombs',
    boss: 'catacombsBoss',
    sting: { chords: ['F#7', 'B'], lead: ['C#6:4 E6:4 F#6:4 A#5:4', 'B5:4 D#6:4 F#6:8'] },
    ambience: 'wind',
  },
  ember: {
    run: 'ember',
    boss: 'emberBoss',
    sting: { chords: ['D', 'C#'], lead: ['A5:2 D6:2 F#6:4 E#6:2 D6:2 A5:4', 'C#6:4 G#5:4 C#6:8'] },
    ambience: 'lava',
  },
};

/** What plays when: which of the map's themes, how loud each layer is (0..1) and the ambience. */
export type MusicScene = 'silent' | 'calm' | 'warning' | 'run0' | 'run1' | 'run2' | 'boss1' | 'boss2' | 'victory';
export const MUSIC_SCENES: MusicScene[] = ['silent', 'calm', 'warning', 'run0', 'run1', 'run2', 'boss1', 'boss2', 'victory'];

export interface SceneMix {
  part: 'run' | 'boss';
  layers: Partial<Record<LayerId, number>>;
  /** Busier hats and a fill to close each phrase. */
  busy: boolean;
  /** How much of the map's ambient bed is heard (0..1). */
  ambience: number;
}

export const SCENES: Record<MusicScene, SceneMix> = {
  silent: { part: 'run', layers: {}, busy: false, ambience: 0 },
  calm: { part: 'run', layers: { bassCalm: 1, arp: 0.6, lead: 0.75 }, busy: false, ambience: 1 },
  // The boss is coming: melody and drums drop out and only a pulse remains.
  warning: { part: 'run', layers: { bassCalm: 1, arp: 0.4, hats: 0.8 }, busy: false, ambience: 1 },
  run0: { part: 'run', layers: { bass: 1, arp: 0.8, lead: 1, hats: 0.7 }, busy: false, ambience: 0.8 },
  run1: { part: 'run', layers: { bass: 1, arp: 0.8, lead: 1, hats: 0.85, drums: 1 }, busy: false, ambience: 0.65 },
  run2: { part: 'run', layers: { bass: 1, arp: 0.9, lead: 1, harmony: 1, hats: 1, drums: 1 }, busy: true, ambience: 0.5 },
  boss1: { part: 'boss', layers: { bass: 1, arp: 0.8, lead: 1, hats: 0.9, drums: 1 }, busy: false, ambience: 0.35 },
  boss2: { part: 'boss', layers: { bass: 1, arp: 0.9, lead: 1, harmony: 1, hats: 1, drums: 1 }, busy: true, ambience: 0.35 },
  // The boss has fallen: the band stops for the map's sting.
  victory: { part: 'run', layers: {}, busy: false, ambience: 0.6 },
};

export function themeFor(map: MapId, scene: MusicScene): ThemeId {
  return SOUNDTRACKS[map][SCENES[scene].part];
}

/** Deeper loops of the map order play a semitone higher each time round, up to two. */
export function transposeFor(loop: number): number {
  return Math.max(0, Math.min(2, Math.floor(loop)));
}

// ---------------------------------------------------------------- note helpers

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function pitchClass(name: string): number {
  const base = PITCH_CLASS[name[0]];
  if (base === undefined) throw new Error(`Bad note name: ${name}`);
  const acc = name.slice(1);
  return (base + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
}

/** 'C4' is MIDI 60. */
export function noteToMidi(note: string): number {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`Bad note: ${note}`);
  return pitchClass(m[1]) + (Number(m[2]) + 1) * 12;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function parseBar(text: string): NoteEvent[] {
  const out: NoteEvent[] = [];
  let step = 0;
  for (const token of text.trim().split(/\s+/)) {
    const [note, lenText] = token.split(':');
    const len = Number(lenText);
    if (!Number.isInteger(len) || len <= 0) throw new Error(`Bad length in "${token}"`);
    if (note !== '-') out.push({ step, len, midi: noteToMidi(note) });
    step += len;
  }
  if (step !== STEPS_PER_BAR) throw new Error(`Bar "${text}" lasts ${step} steps, not ${STEPS_PER_BAR}`);
  return out;
}

export interface Chord {
  root: number;
  /** Semitones above the root. */
  tones: number[];
}

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

export function parseChord(symbol: string): Chord {
  const m = /^([A-G][#b]?)(maj7|m7|m|7|dim|aug|sus2|sus4)?$/.exec(symbol);
  if (!m) throw new Error(`Bad chord: ${symbol}`);
  return { root: pitchClass(m[1]), tones: QUALITIES[m[2] ?? ''] };
}

/** The chord's root placed in the octave above `floor` (D2..C#3 by default). */
export function bassRoot(chord: Chord, floor = 38): number {
  return floor + ((chord.root - (floor % 12) + 12) % 12);
}

/** Four arpeggio notes (root, third, fifth, octave) in the middle register (A3..G#4 root). */
export function arpTones(chord: Chord): number[] {
  const root = 57 + ((chord.root - 9 + 12) % 12);
  return [root, root + chord.tones[1], root + chord.tones[2], root + 12];
}

/** The harmony voice: the highest chord tone at least a minor third below the melody note. */
export function harmonyNote(melody: number, chord: Chord): number {
  for (let m = melody - 3; m > melody - 15; m--) {
    const rel = (((m - chord.root) % 12) + 12) % 12;
    if (chord.tones.some((t) => t % 12 === rel)) return m;
  }
  return melody - 12;
}

/** Chords and melody parsed, with the harmony voice worked out from them. */
export interface Phrase {
  bars: number;
  chords: Chord[];
  lead: NoteEvent[][];
  harmony: NoteEvent[][];
}

export interface ParsedTheme extends Phrase {
  theme: Theme;
}

export function parsePhrase(chordSymbols: readonly string[], melody: readonly string[]): Phrase {
  if (melody.length !== chordSymbols.length) throw new Error('Melody and chords differ in length');
  const chords = chordSymbols.map(parseChord);
  const lead = melody.map(parseBar);
  const harmony = lead.map((bar, i) => bar.map((n) => ({ ...n, midi: harmonyNote(n.midi, chords[i]) })));
  return { bars: chords.length, chords, lead, harmony };
}

export function prepareTheme(theme: Theme): ParsedTheme {
  return { theme, ...parsePhrase(theme.chords, theme.lead) };
}

export function stepSeconds(theme: Theme): number {
  return 60 / theme.bpm / 4;
}
