/**
 * The sigil practice room's reading of a stroke: a verdict in words, the shape the recognizer
 * fitted, and its measurements. Pure functions over `analyzeStroke`, so they're testable.
 */

import { castTier, tierBonusLabel, type CastTier } from './cast';
import { SPELLS } from './config';
import type { Pt, SigilKind, StrokeAnalysis } from './gesture';
import { SIGIL_TO_SPELL } from './spells';

export const SHAPE_NAMES: Record<SigilKind, string> = {
  line: 'Line',
  vee: 'V',
  circle: 'Circle',
  triangle: 'Triangle',
  zigzag: 'Zigzag',
};

/** What a high score asks for, from each sigil's scoring weights. */
export const SHAPE_TIPS: Record<SigilKind, string> = {
  line: 'One quick, steady stroke: straight and thin.',
  vee: 'Two straight legs of similar length, opening upward.',
  circle: 'Go all the way round, keep it even, and close the loop.',
  triangle: 'Close it, keep the sides similar, make every corner sharp.',
  zigzag: 'Two to four sharp turns, alternating, with straight legs.',
};

export type AttemptOutcome = 'hit' | 'wrong' | 'miss' | 'tiny';

export interface AttemptReport {
  /** hit: it cast (the target, when one is chosen); wrong: it cast another sigil; miss: nothing cast. */
  outcome: AttemptOutcome;
  kind: SigilKind | null;
  tier: CastTier | null;
  /** The sigil the explanation and overlay focus on: the target, else what the stroke read as. */
  focus: SigilKind | null;
  headline: string;
  detail: string;
}

export function reportAttempt(a: StrokeAnalysis, target: SigilKind | null): AttemptReport {
  const r = a.recognition;
  if (r.reason === 'tiny') {
    return { outcome: 'tiny', kind: null, tier: null, focus: target, headline: 'Too small', detail: 'Draw the sigil bigger.' };
  }
  if (r.kind) {
    const tier = castTier(r.kind, r.score);
    if (target && r.kind !== target) {
      return {
        outcome: 'wrong',
        kind: r.kind,
        tier,
        focus: target,
        headline: `Read as ${SHAPE_NAMES[r.kind]}, not ${SHAPE_NAMES[target]}`,
        detail: a.checks[target].miss ?? `It passes as a ${SHAPE_NAMES[target]} too, but reads more clearly as a ${SHAPE_NAMES[r.kind]}.`,
      };
    }
    const bonus = tierBonusLabel(tier);
    const grade =
      tier === 'perfect' ? `Perfect: ${bonus} power.` : tier === 'clean' ? `Clean: ${bonus} power. ${SHAPE_TIPS[r.kind]}` : `Rough: normal power. ${SHAPE_TIPS[r.kind]}`;
    return {
      outcome: 'hit',
      kind: r.kind,
      tier,
      focus: r.kind,
      headline: `${SHAPE_NAMES[r.kind]}: ${SPELLS[SIGIL_TO_SPELL[r.kind]].name}`,
      detail: grade,
    };
  }
  if (r.reason === 'ambiguous') {
    const [first, second] = (Object.keys(r.scores) as SigilKind[]).sort((x, y) => r.scores[y] - r.scores[x]);
    return {
      outcome: 'miss',
      kind: null,
      tier: null,
      focus: target ?? first,
      headline: 'Too close to call',
      detail: `It reads almost equally as a ${SHAPE_NAMES[first]} and a ${SHAPE_NAMES[second]}. Exaggerate what makes it one of them.`,
    };
  }
  return {
    outcome: 'miss',
    kind: null,
    tier: null,
    focus: target,
    headline: 'Unclear',
    detail: target ? (a.checks[target].miss ?? 'No sigil matched.') : 'No sigil matched. Each one below says what it was missing.',
  };
}

export type Overlay = { type: 'path'; points: Pt[]; closed: boolean } | { type: 'circle'; center: Pt; radius: number };

/**
 * The shape the recognizer fitted for one sigil, in the stroke's coordinates. Lines and circles
 * always have one; a V, triangle or zigzag only once it found its corners (that is, passed).
 */
export function shapeOverlay(a: StrokeAnalysis, kind: SigilKind): Overlay | null {
  const pts = a.points;
  if (pts.length < 2 || a.recognition.reason === 'tiny') return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const marks = a.checks[kind].marks.map((i) => pts[i]).filter(Boolean);
  switch (kind) {
    case 'line':
      return { type: 'path', points: [first, last], closed: false };
    case 'circle': {
      let r = 0;
      for (const p of pts) r += Math.hypot(p.x - a.center.x, p.y - a.center.y);
      return { type: 'circle', center: a.center, radius: r / pts.length };
    }
    case 'vee':
      return marks.length === 1 ? { type: 'path', points: [first, marks[0], last], closed: false } : null;
    case 'triangle':
      return marks.length === 3 ? { type: 'path', points: marks, closed: true } : null;
    case 'zigzag':
      return marks.length >= 2 ? { type: 'path', points: [first, ...marks, last], closed: false } : null;
  }
}

/** Where the sharp corners are and how sharp: the angle inside each bend, in degrees. */
export function cornerMarks(a: StrokeAnalysis): { at: Pt; degrees: number }[] {
  const f = a.recognition.features;
  if (!f) return [];
  return f.corners.map((c) => ({ at: a.points[c.index], degrees: Math.round(180 - (Math.abs(c.angle) * 180) / Math.PI) }));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The recognizer's measurements in words, with what each one means. */
export function measurements(a: StrokeAnalysis): { label: string; value: string; about: string }[] {
  const f = a.recognition.features;
  if (!f) return [];
  return [
    { label: 'Straightness', value: pct(f.straightness), about: 'Distance between the ends over the length drawn.' },
    { label: 'Roundness', value: pct(f.elongation), about: 'Width over length: 0% is a thin line, 100% as wide as long.' },
    { label: 'Turning', value: `${Math.round((Math.abs(f.signedTurning) * 180) / Math.PI)}°`, about: 'How far the stroke turns overall; a circle is 360°.' },
    { label: 'End gap', value: pct(f.closureGap), about: 'Distance between the ends, as a share of the size.' },
    { label: 'Sharp corners', value: String(f.corners.length), about: 'Bends of more than 55° within a few points.' },
    { label: 'Turning at corners', value: pct(f.cornerShare), about: 'How much of the turning happens at the corners.' },
  ];
}
