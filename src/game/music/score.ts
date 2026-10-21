/**
 * The soundtrack, written as data: chord changes, melodies and patterns for two themes.
 * Time is counted in sixteenth-note steps, 16 to a bar. Everything here is pure so it can be
 * unit-tested; music/player.ts turns it into sound.
 */

export const STEPS_PER_BAR = 16;

export type ThemeId = 'main' | 'boss';
export type LayerId = 'bassCalm' | 'bass' | 'arp' | 'lead' | 'harmony' | 'drums' | 'hats';
export const LAYERS: LayerId[] = ['bassCalm', 'bass', 'arp', 'lead', 'harmony', 'drums', 'hats'];

export interface NoteEvent {
  step: number;
  len: number;
  midi: number;
}

/** [step, length, semitones above the bar's bass root] */
type BassHit = readonly [number, number, number];

export interface Theme {
  bpm: number;
  /** One chord per bar, e.g. 'Dm', 'Bb', 'A7'. */
  chords: string[];
  /** One bar of melody per entry: "D5:6 A4:2 -:4" means note:sixteenths, '-' is a rest. */
  lead: string[];
  bass: BassHit[];
  kick: string;
  snare: string;
  hats: string;
  busyHats: string;
  /** A snare fill closes every Nth bar. */
  fillEvery: number;
}

/** Half notes on the root and fifth, used by every theme's quiet arrangement. */
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

/**
 * "Sigil of the Serpent": D minor, 132 BPM, A-B-A'-B'. The A section states the motif,
 * B lifts into the relative major, and the primed sections end with new cadences.
 */
const MAIN: Theme = {
  bpm: 132,
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
};

/**
 * "Ouroboros": the boss theme. Faster (150 BPM), galloping bass, four-on-the-floor kick and a
 * melody that leans on the tritone and the flat second for menace.
 */
const BOSS: Theme = {
  bpm: 150,
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
};

export const THEMES: Record<ThemeId, Theme> = { main: MAIN, boss: BOSS };

/** What plays when: the theme and how loud each layer is (0..1). */
export type MusicScene = 'silent' | 'calm' | 'warning' | 'run0' | 'run1' | 'run2' | 'boss1' | 'boss2';

export interface SceneMix {
  theme: ThemeId;
  layers: Partial<Record<LayerId, number>>;
  /** Busier hats and a snare fill to close each phrase. */
  busy: boolean;
}

export const SCENES: Record<MusicScene, SceneMix> = {
  silent: { theme: 'main', layers: {}, busy: false },
  calm: { theme: 'main', layers: { bassCalm: 1, arp: 0.6, lead: 0.75 }, busy: false },
  // The boss is coming: melody and drums drop out and only a pulse remains.
  warning: { theme: 'main', layers: { bassCalm: 1, arp: 0.4, hats: 0.8 }, busy: false },
  run0: { theme: 'main', layers: { bass: 1, arp: 0.8, lead: 1, hats: 0.7 }, busy: false },
  run1: { theme: 'main', layers: { bass: 1, arp: 0.8, lead: 1, hats: 0.85, drums: 1 }, busy: false },
  run2: { theme: 'main', layers: { bass: 1, arp: 0.9, lead: 1, harmony: 1, hats: 1, drums: 1 }, busy: true },
  boss1: { theme: 'boss', layers: { bass: 1, arp: 0.8, lead: 1, hats: 0.9, drums: 1 }, busy: false },
  boss2: { theme: 'boss', layers: { bass: 1, arp: 0.9, lead: 1, harmony: 1, hats: 1, drums: 1 }, busy: true },
};

// ---------------------------------------------------------------- note helpers

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function pitchClass(name: string): number {
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

export function parseChord(symbol: string): Chord {
  const m = /^([A-G][#b]?)(m7|m|7)?$/.exec(symbol);
  if (!m) throw new Error(`Bad chord: ${symbol}`);
  const q = m[2] ?? '';
  const tones = q === 'm' ? [0, 3, 7] : q === '7' ? [0, 4, 7, 10] : q === 'm7' ? [0, 3, 7, 10] : [0, 4, 7];
  return { root: pitchClass(m[1]), tones };
}

/** The chord's root placed in the bass register (D2..C#3). */
export function bassRoot(chord: Chord): number {
  return 38 + ((chord.root - 2 + 12) % 12);
}

/** Four arpeggio notes (root, third, fifth, octave) in the middle register (A3..G#4 root). */
export function arpTones(chord: Chord): number[] {
  const root = 57 + ((chord.root - 9 + 12) % 12);
  return [root, root + chord.tones[1], root + chord.tones[2], root + 12];
}

/** Arpeggio order through arpTones: up and back down. */
export const ARP_ORDER = [0, 1, 2, 3, 2, 1];

/** The harmony voice: the highest chord tone at least a minor third below the melody note. */
export function harmonyNote(melody: number, chord: Chord): number {
  for (let m = melody - 3; m > melody - 15; m--) {
    const rel = (((m - chord.root) % 12) + 12) % 12;
    if (chord.tones.some((t) => t % 12 === rel)) return m;
  }
  return melody - 12;
}

export interface ParsedTheme {
  theme: Theme;
  bars: number;
  chords: Chord[];
  lead: NoteEvent[][];
  harmony: NoteEvent[][];
}

export function prepareTheme(theme: Theme): ParsedTheme {
  if (theme.lead.length !== theme.chords.length) throw new Error('Melody and chords differ in length');
  const chords = theme.chords.map(parseChord);
  const lead = theme.lead.map(parseBar);
  const harmony = lead.map((bar, i) => bar.map((n) => ({ ...n, midi: harmonyNote(n.midi, chords[i]) })));
  return { theme, bars: chords.length, chords, lead, harmony };
}

export function stepSeconds(theme: Theme): number {
  return 60 / theme.bpm / 4;
}
