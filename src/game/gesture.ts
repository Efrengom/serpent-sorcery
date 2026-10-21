/**
 * Deterministic, local single-stroke sigil recognizer.
 *
 * Pipeline:
 *   1. Reject tiny drags (accidental clicks) using the raw bounding box and path length.
 *   2. Resample to a fixed number of equidistant points, which removes the effect of
 *      uneven drawing speed, then lightly smooth to suppress hand jitter.
 *   3. Normalize: translate the centroid to the origin and scale uniformly by the larger
 *      bounding-box side, so proportions are preserved (a thin line stays thin).
 *   4. Measure rotation-invariant geometric features (straightness, PCA elongation,
 *      signed/absolute turning, closure gap, radial spread, sharp corners and how much of
 *      the turning happens at them).
 *   5. Each sigil has gates (hard requirements) and a confidence score. The best passing
 *      sigil wins unless another passing sigil scores too close to it (ambiguous).
 *
 * `analyzeStroke` runs the same pipeline and also reports, for every sigil, the first gate the
 * stroke missed and the points its shape was built from; the practice room draws both.
 */

import { GESTURE } from './config';

export interface Pt {
  x: number;
  y: number;
}

export type SigilKind = 'line' | 'vee' | 'circle' | 'triangle' | 'zigzag';
export const SIGIL_KINDS: SigilKind[] = ['line', 'vee', 'circle', 'triangle', 'zigzag'];

/** A sharp bend: where it is along the resampled stroke and how far it turns (signed radians). */
export interface Corner {
  index: number;
  angle: number;
}

export interface GestureFeatures {
  pathLength: number;
  straightness: number;
  elongation: number;
  signedTurning: number;
  absTurning: number;
  closureGap: number;
  radialCv: number;
  maxChordDeviation: number;
  corners: Corner[];
  /** Share of all turning that happens at the corners (1 = perfectly straight sides). */
  cornerShare: number;
}

export interface Recognition {
  kind: SigilKind | null;
  reason: 'ok' | 'tiny' | 'unclear' | 'ambiguous';
  score: number;
  scores: Record<SigilKind, number>;
  features?: GestureFeatures;
}

/** One sigil's verdict on a stroke. */
export interface ShapeCheck {
  score: number;
  /** The first requirement the stroke missed, in words; null when it passed. */
  miss: string | null;
  /**
   * Indices into the analyzed points that the shape was built from: the V's point, the
   * triangle's corners, the zigzag's corners. Empty for lines and circles.
   */
  marks: number[];
}

function miss(text: string): ShapeCheck {
  return { score: 0, miss: text, marks: [] };
}

function pass(score: number, marks: number[] = []): ShapeCheck {
  return { score, miss: null, marks };
}

const deg = (rad: number) => Math.round((rad * 180) / Math.PI);
const pct = (v: number) => `${Math.round(v * 100)}%`;

const THRESH = {
  line: { minStraightness: 0.86, maxElongation: 0.22, maxChordDev: 0.13 },
  circle: {
    maxGap: 0.6,
    minTurn: 1.5 * Math.PI,
    maxTurn: 3.4 * Math.PI,
    minConsistency: 0.72,
    minElongation: 0.4,
    maxRadialCv: 0.36,
  },
  vee: {
    minLegRatio: 0.3,
    minLegStraightness: 0.86,
    maxLegDeviation: 0.16,
    minAngle: (14 * Math.PI) / 180,
    maxAngle: (122 * Math.PI) / 180,
    /** How far the V's opening may tilt away from pointing straight up. */
    maxTilt: (62 * Math.PI) / 180,
    maxStraightness: 0.9,
  },
  corner: {
    /** Turning within a 5-point window that counts as a sharp corner. */
    minAngle: (55 * Math.PI) / 180,
  },
  triangle: {
    maxGap: 0.32,
    /** Polygon fit tolerance, as a fraction of the stroke's size. */
    fitTolerance: 0.085,
    minShare: 0.38,
    minSideRatio: 0.3,
    /** Widest allowed interior angle; anything flatter isn't really a corner. */
    maxInterior: (125 * Math.PI) / 180,
  },
  zigzag: {
    minGap: 0.3,
    minCorner: (70 * Math.PI) / 180,
    maxLegDeviation: 0.14,
    minLegRatio: 0.28,
    minShare: 0.35,
    /** A first or last leg shorter than this share of the others is a hook, not a leg. */
    hookRatio: 0.3,
  },
  /** Circles may have at most this many really sharp corners (a hook where the ends meet). */
  circleMaxCorners: 1,
  circleSharpCorner: (85 * Math.PI) / 180,
  minScore: 0.5,
  ambiguityMargin: 0.08,
};

export function pathLength(pts: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

export function bounds(pts: readonly Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Resamples a polyline into `n` points spaced equally along its length. */
export function resample(pts: readonly Pt[], n: number): Pt[] {
  if (pts.length === 0) return [];
  const total = pathLength(pts);
  if (total === 0 || pts.length === 1) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const interval = total / (n - 1);
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  let acc = 0;
  let prev = { x: pts[0].x, y: pts[0].y };
  let i = 1;
  while (i < pts.length && out.length < n) {
    const cur = pts[i];
    const d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (d > 0 && acc + d >= interval) {
      const t = (interval - acc) / d;
      const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
      out.push(q);
      prev = q;
      acc = 0;
    } else {
      acc += d;
      prev = { x: cur.x, y: cur.y };
      i++;
    }
  }
  const last = pts[pts.length - 1];
  while (out.length < n) out.push({ x: last.x, y: last.y });
  out[n - 1] = { x: last.x, y: last.y };
  return out;
}

/** Moving-average smoothing that keeps the endpoints fixed. */
export function smooth(pts: readonly Pt[], passes = 2): Pt[] {
  let cur = pts.map((p) => ({ ...p }));
  for (let pass = 0; pass < passes; pass++) {
    const next = cur.map((p) => ({ ...p }));
    for (let i = 1; i < cur.length - 1; i++) {
      next[i].x = (cur[i - 1].x + 2 * cur[i].x + cur[i + 1].x) / 4;
      next[i].y = (cur[i - 1].y + 2 * cur[i].y + cur[i + 1].y) / 4;
    }
    cur = next;
  }
  return cur;
}

/** Centroid at origin, uniform scale so the larger bounding-box side is 1. */
export function normalize(pts: readonly Pt[]): Pt[] {
  const b = bounds(pts);
  const size = Math.max(b.w, b.h) || 1;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  return pts.map((p) => ({ x: (p.x - cx) / size, y: (p.y - cy) / size }));
}

function pcaElongation(pts: readonly Pt[]): number {
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(0, tr / 2 - disc);
  return l1 > 0 ? Math.sqrt(l2 / l1) : 0;
}

function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function maxDeviation(pts: readonly Pt[], from: number, to: number): { index: number; dev: number } {
  let index = from;
  let dev = 0;
  for (let i = from; i <= to; i++) {
    const d = perpDistance(pts[i], pts[from], pts[to]);
    if (d > dev) {
      dev = d;
      index = i;
    }
  }
  return { index, dev };
}

function turning(pts: readonly Pt[]): { signed: number; abs: number } {
  let signed = 0;
  let abs = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i].x - pts[i - 1].x;
    const ay = pts[i].y - pts[i - 1].y;
    const bx = pts[i + 1].x - pts[i].x;
    const by = pts[i + 1].y - pts[i].y;
    if ((ax === 0 && ay === 0) || (bx === 0 && by === 0)) continue;
    const a = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    signed += a;
    abs += Math.abs(a);
  }
  return { signed, abs };
}

/** Signed turning angle at every point (0 at the two ends). */
function turnAngles(pts: readonly Pt[]): number[] {
  const out = new Array<number>(pts.length).fill(0);
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i].x - pts[i - 1].x;
    const ay = pts[i].y - pts[i - 1].y;
    const bx = pts[i + 1].x - pts[i].x;
    const by = pts[i + 1].y - pts[i].y;
    if ((ax === 0 && ay === 0) || (bx === 0 && by === 0)) continue;
    out[i] = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  }
  return out;
}

/** Half-width of the window over which a corner's turning is summed. */
const CORNER_WINDOW = 2;

/**
 * Sharp corners: peaks of the turning summed over a short window, so a corner the smoothing has
 * rounded over several points still counts once. Also reports what share of all turning
 * happens at those corners (high for polygons, low for curves).
 */
export function findCorners(pts: readonly Pt[], minAngle = THRESH.corner.minAngle): { corners: Corner[]; share: number } {
  const a = turnAngles(pts);
  const n = pts.length;
  const win = a.map((_, i) => {
    let s = 0;
    for (let j = Math.max(1, i - CORNER_WINDOW); j <= Math.min(n - 2, i + CORNER_WINDOW); j++) s += a[j];
    return s;
  });
  const corners: Corner[] = [];
  // The window is cut short at the very ends, where hand jitter also makes tiny hooks.
  for (let i = 3; i < n - 3; i++) {
    const v = Math.abs(win[i]);
    if (v < minAngle) continue;
    let peak = true;
    for (let j = Math.max(1, i - 3); j <= Math.min(n - 2, i + 3) && peak; j++) {
      const w = Math.abs(win[j]);
      if (j !== i && (w > v || (w === v && j < i))) peak = false;
    }
    if (peak) corners.push({ index: i, angle: win[i] });
  }
  let total = 0;
  for (const v of a) total += Math.abs(v);
  const counted = new Set<number>();
  let atCorners = 0;
  for (const c of corners) {
    for (let j = c.index - CORNER_WINDOW - 1; j <= c.index + CORNER_WINDOW + 1; j++) {
      if (j < 1 || j > n - 2 || counted.has(j)) continue;
      counted.add(j);
      atCorners += Math.abs(a[j]);
    }
  }
  return { corners, share: total > 0 ? atCorners / total : 0 };
}

/** Ramer-Douglas-Peucker: indices strictly between `from` and `to` that the simplified line keeps. */
function simplify(pts: readonly Pt[], from: number, to: number, eps: number, out: number[]): void {
  if (to - from < 2) return;
  const { index, dev } = maxDeviation(pts, from, to);
  if (dev <= eps || index === from || index === to) return;
  simplify(pts, from, index, eps, out);
  out.push(index);
  simplify(pts, index, to, eps, out);
}

/**
 * Vertices of a closed stroke simplified to a polygon. The loop is anchored at its two most
 * distant points, so where the stroke starts doesn't matter, and a small overlap or gap where
 * the ends meet just lies along a side.
 */
export function closedPolygon(pts: readonly Pt[], eps: number): Pt[] {
  const n = pts.length;
  let a = 0;
  let b = 0;
  let best = -1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2;
      if (d > best) {
        best = d;
        a = i;
        b = j;
      }
    }
  }
  const forward: number[] = [];
  simplify(pts, a, b, eps, forward);
  // The other way round the loop: b..end, then the start..a.
  const back = [...pts.slice(b), ...pts.slice(0, a + 1)];
  const backKept: number[] = [];
  simplify(back, 0, back.length - 1, eps, backKept);
  const poly = [pts[a], ...forward.map((i) => pts[i]), pts[b], ...backKept.map((i) => back[i])];
  // Hand wobble can leave an extra vertex on a side or where the ends meet, and overshooting
  // past the start leaves a spike that doubles back: drop vertices that barely turn, that
  // reverse, or that sit right next to a neighbour.
  for (let changed = true; changed && poly.length > 3; ) {
    changed = false;
    for (let i = 0; i < poly.length && poly.length > 3; i++) {
      const p = poly[(i + poly.length - 1) % poly.length];
      const v = poly[i];
      const q = poly[(i + 1) % poly.length];
      const turn = Math.abs(signedAngle(v.x - p.x, v.y - p.y, q.x - v.x, q.y - v.y));
      if (turn < FLAT_VERTEX || turn > SPIKE_VERTEX || Math.hypot(q.x - v.x, q.y - v.y) < eps) {
        poly.splice(i, 1);
        changed = true;
      }
    }
  }
  return poly;
}

/**
 * How far a stroke is from closing on itself (normalized points, so relative to its size): the
 * end's distance to the first quarter of the stroke or the start's to the last quarter, so
 * overshooting past the start still counts as closed.
 */
function loopGap(pts: readonly Pt[]): number {
  const n = pts.length;
  const q = Math.floor(n / 4);
  let best = Infinity;
  for (let i = 0; i <= q; i++) {
    best = Math.min(best, Math.hypot(pts[n - 1].x - pts[i].x, pts[n - 1].y - pts[i].y));
    best = Math.min(best, Math.hypot(pts[0].x - pts[n - 1 - i].x, pts[0].y - pts[n - 1 - i].y));
  }
  return best;
}

/** A polygon vertex turning less than this is part of a side, not a corner; more is a doubling back. */
const FLAT_VERTEX = (32 * Math.PI) / 180;
const SPIKE_VERTEX = (155 * Math.PI) / 180;

function signedAngle(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

function sub(pts: readonly Pt[], from: number, to: number): Pt[] {
  return pts.slice(from, to + 1);
}

function margin(value: number, limit: number, span: number): number {
  return Math.max(0, Math.min(1, (value - limit) / span));
}

function scoreLine(f: GestureFeatures): ShapeCheck {
  const t = THRESH.line;
  if (f.straightness < t.minStraightness) return miss(`Curves too much: ${pct(f.straightness)} straight, a line needs ${pct(t.minStraightness)}`);
  if (f.elongation > t.maxElongation) return miss('Too wide for a line');
  if (f.maxChordDeviation > t.maxChordDev) return miss('Bows away from straight in the middle');
  const a = margin(f.straightness, t.minStraightness, 1 - t.minStraightness);
  const b = margin(t.maxElongation - f.elongation, 0, t.maxElongation);
  return pass(0.5 + 0.5 * (0.6 * a + 0.4 * b));
}

function scoreCircle(f: GestureFeatures): ShapeCheck {
  const t = THRESH.circle;
  const turn = Math.abs(f.signedTurning);
  const sharp = f.corners.filter((c) => Math.abs(c.angle) >= THRESH.circleSharpCorner).length;
  if (sharp > THRESH.circleMaxCorners) return miss(`${sharp} sharp corners: a circle is one smooth curve`);
  if (f.closureGap > t.maxGap) return miss('The ends are too far apart to close the loop');
  if (turn < t.minTurn) return miss(`Goes only ${deg(turn)}° around; a circle needs ${deg(t.minTurn)}°`);
  if (turn > t.maxTurn) return miss(`Goes round ${(turn / (2 * Math.PI)).toFixed(1)} times; stop after one loop`);
  if (f.absTurning === 0 || turn / f.absTurning < t.minConsistency) return miss('Bends both ways; keep turning the same way');
  if (f.elongation < t.minElongation) return miss('Too flat; make it rounder');
  if (f.radialCv > t.maxRadialCv) return miss('Lopsided; keep an even distance from the middle');
  const gap = margin(t.maxGap - f.closureGap, 0, t.maxGap);
  const round = margin(f.elongation, t.minElongation, 1 - t.minElongation);
  const even = margin(t.maxRadialCv - f.radialCv, 0, t.maxRadialCv);
  const full = margin(turn, t.minTurn, 2 * Math.PI - t.minTurn);
  return pass(0.5 + 0.5 * (0.3 * gap + 0.25 * round + 0.25 * even + 0.2 * full));
}

function scoreVee(pts: Pt[], f: GestureFeatures): ShapeCheck {
  const t = THRESH.vee;
  const n = pts.length;
  if (f.straightness > t.maxStraightness) return miss('Too straight; bend it into a point');
  const first = pts[0];
  const last = pts[n - 1];
  // The vertex is the point farthest from the start-end chord.
  const { index: k } = maxDeviation(pts, 0, n - 1);
  if (k < 3 || k > n - 4) return miss('The point is at one end; draw two legs');
  const leg1 = sub(pts, 0, k);
  const leg2 = sub(pts, k, n - 1);
  const len1 = pathLength(leg1);
  const len2 = pathLength(leg2);
  const legRatio = Math.min(len1, len2) / Math.max(len1, len2);
  if (legRatio < t.minLegRatio) return miss(`One leg is only ${pct(legRatio)} as long as the other`);
  const v = pts[k];
  const c1 = Math.hypot(first.x - v.x, first.y - v.y);
  const c2 = Math.hypot(last.x - v.x, last.y - v.y);
  const s1 = c1 / len1;
  const s2 = c2 / len2;
  if (s1 < t.minLegStraightness || s2 < t.minLegStraightness) return miss('A leg curves; keep both legs straight');
  const d1 = maxDeviation(leg1, 0, leg1.length - 1).dev / c1;
  const d2 = maxDeviation(leg2, 0, leg2.length - 1).dev / c2;
  if (d1 > t.maxLegDeviation || d2 > t.maxLegDeviation) return miss('A leg bows out; keep both legs straight');
  const u1 = { x: (first.x - v.x) / c1, y: (first.y - v.y) / c1 };
  const u2 = { x: (last.x - v.x) / c2, y: (last.y - v.y) / c2 };
  const angle = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
  if (angle < t.minAngle) return miss(`The point is too narrow (${deg(angle)}°, at least ${deg(t.minAngle)}°)`);
  if (angle > t.maxAngle) return miss(`Opens too wide (${deg(angle)}°, at most ${deg(t.maxAngle)}°)`);
  // The opening (bisector from the vertex) should point roughly up the screen.
  const bx = u1.x + u2.x;
  const by = u1.y + u2.y;
  const bl = Math.hypot(bx, by);
  if (bl === 0) return miss('The legs point straight away from each other');
  const tilt = Math.acos(Math.max(-1, Math.min(1, -by / bl)));
  if (tilt > t.maxTilt) return miss(`Opens ${deg(tilt)}° away from up; a V opens upward (within ${deg(t.maxTilt)}°)`);
  const straight = margin(Math.min(s1, s2), t.minLegStraightness, 1 - t.minLegStraightness);
  const balance = margin(legRatio, t.minLegRatio, 1 - t.minLegRatio);
  const upright = margin(t.maxTilt - tilt, 0, t.maxTilt);
  const mid = (t.minAngle + t.maxAngle) / 2;
  const angleFit = 1 - Math.abs(angle - mid) / ((t.maxAngle - t.minAngle) / 2);
  return pass(0.5 + 0.5 * (0.35 * straight + 0.2 * balance + 0.25 * upright + 0.2 * angleFit), [k]);
}

/**
 * Triangle: a closed stroke that simplifies to a three-cornered polygon with sides of
 * comparable length, whose turning happens mostly at those corners (not a rounded blob).
 */
function scoreTriangle(pts: Pt[], f: GestureFeatures): ShapeCheck {
  const t = THRESH.triangle;
  if (loopGap(pts) > t.maxGap) return miss("The ends don't meet; close the triangle");
  if (f.cornerShare < t.minShare) return miss('The corners are too rounded');
  const poly = closedPolygon(pts, t.fitTolerance);
  if (poly.length !== 3) return miss(`Simplifies to ${poly.length} corners; a triangle has 3`);
  const sides = poly.map((v, i) => {
    const w = poly[(i + 1) % 3];
    return Math.hypot(w.x - v.x, w.y - v.y);
  });
  const sideRatio = Math.min(...sides) / Math.max(...sides);
  if (sideRatio < t.minSideRatio) return miss(`One side is only ${pct(sideRatio)} as long as the longest`);
  // Each corner must actually turn: no interior angle wider than maxInterior.
  const interior = poly.map((v, i) => {
    const p = poly[(i + 2) % 3];
    const q = poly[(i + 1) % 3];
    return Math.abs(signedAngle(p.x - v.x, p.y - v.y, q.x - v.x, q.y - v.y));
  });
  const widest = Math.max(...interior);
  if (widest > t.maxInterior) return miss(`A corner is too flat (${deg(widest)}°, at most ${deg(t.maxInterior)}°)`);
  const closed = margin(t.maxGap - loopGap(pts), 0, t.maxGap);
  const balance = margin(sideRatio, t.minSideRatio, 1 - t.minSideRatio);
  const crisp = margin(f.cornerShare, t.minShare, 1 - t.minShare);
  const pointy = margin(t.maxInterior - widest, 0, t.maxInterior - Math.PI / 3);
  return pass(0.5 + 0.5 * (0.25 * closed + 0.3 * balance + 0.25 * crisp + 0.2 * pointy), poly.map((v) => pts.indexOf(v)));
}

/**
 * Zigzag: an open stroke of 3 to 5 straight legs joined by sharp corners that turn alternately
 * left and right (Z, N, W, M and longer saw-tooth lines).
 */
function scoreZigzag(pts: Pt[], f: GestureFeatures): ShapeCheck {
  const t = THRESH.zigzag;
  const c = dropHooks(pts, f.corners, t.hookRatio);
  if (c.length < 2) return miss(`${c.length === 0 ? 'No sharp corners' : 'Only 1 sharp corner'}; a zigzag needs 2 to 4`);
  if (c.length > 4) return miss(`${c.length} sharp corners; a zigzag has 2 to 4`);
  if (f.closureGap < t.minGap) return miss('The ends come back together; a zigzag stays open');
  for (let i = 1; i < c.length; i++) {
    if (Math.sign(c[i].angle) === Math.sign(c[i - 1].angle)) return miss('Two corners turn the same way; turn left and right in turn');
  }
  const sharpest = Math.min(...c.map((k) => Math.abs(k.angle)));
  if (sharpest < t.minCorner) return miss('A corner is too soft; make each turn sharp');
  if (f.cornerShare < t.minShare) return miss('Too curvy between the corners');
  const cuts = [0, ...c.map((k) => k.index), pts.length - 1];
  const lens: number[] = [];
  let worstDev = 0;
  for (let i = 1; i < cuts.length; i++) {
    const a = pts[cuts[i - 1]];
    const b = pts[cuts[i]];
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord === 0 || cuts[i] - cuts[i - 1] < 2) return miss('A leg is too short');
    lens.push(chord);
    worstDev = Math.max(worstDev, maxDeviation(pts, cuts[i - 1], cuts[i]).dev / chord);
  }
  if (worstDev > t.maxLegDeviation) return miss('A leg bows; keep each one straight');
  const legRatio = Math.min(...lens) / Math.max(...lens);
  if (legRatio < t.minLegRatio) return miss(`The shortest leg is only ${pct(legRatio)} of the longest`);
  const sharp = margin(sharpest, t.minCorner, Math.PI * 0.75 - t.minCorner);
  const straight = margin(t.maxLegDeviation - worstDev, 0, t.maxLegDeviation);
  const balance = margin(legRatio, t.minLegRatio, 1 - t.minLegRatio);
  return pass(0.5 + 0.5 * (0.35 * sharp + 0.35 * straight + 0.3 * balance), c.map((k) => k.index));
}

/** Drops a corner at either end whose leg to the end of the stroke is too short to be a leg. */
function dropHooks(pts: Pt[], corners: Corner[], ratio: number): Corner[] {
  const c = [...corners];
  const legLen = (from: number, to: number) => Math.hypot(pts[to].x - pts[from].x, pts[to].y - pts[from].y);
  for (let pass = 0; pass < 2 && c.length >= 2; pass++) {
    const cuts = [0, ...c.map((k) => k.index), pts.length - 1];
    const lens = cuts.slice(1).map((to, i) => legLen(cuts[i], to));
    const inner = [...lens.slice(1, -1)].sort((a, b) => a - b);
    const ref = inner.length ? inner[Math.floor(inner.length / 2)] : Math.max(...lens);
    if (lens[lens.length - 1] < ref * ratio) c.pop();
    else if (lens[0] < ref * ratio) c.shift();
    else break;
  }
  return c;
}

/** Removes consecutive near-duplicate points. */
export function dedupe(pts: readonly Pt[], minSpacing = GESTURE.minPointSpacing): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minSpacing) out.push({ x: p.x, y: p.y });
  }
  return out;
}

export function extractFeatures(norm: readonly Pt[]): GestureFeatures {
  const n = norm.length;
  const len = pathLength(norm);
  const first = norm[0];
  const last = norm[n - 1];
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  const turn = turning(norm);
  let cx = 0;
  let cy = 0;
  for (const p of norm) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let mean = 0;
  const radii = norm.map((p) => Math.hypot(p.x - cx, p.y - cy));
  for (const r of radii) mean += r;
  mean /= n;
  let variance = 0;
  for (const r of radii) variance += (r - mean) ** 2;
  variance /= n;
  const b = bounds(norm);
  const { corners, share } = findCorners(norm);
  return {
    pathLength: len,
    straightness: len > 0 ? chord / len : 0,
    elongation: pcaElongation(norm),
    signedTurning: turn.signed,
    absTurning: turn.abs,
    closureGap: chord / (Math.max(b.w, b.h) || 1),
    radialCv: mean > 0 ? Math.sqrt(variance) / mean : 1,
    maxChordDeviation: chord > 0 ? maxDeviation(norm, 0, n - 1).dev / chord : Infinity,
    corners,
    cornerShare: share,
  };
}

export function recognize(raw: readonly Pt[]): Recognition {
  return analyzeStroke(raw).recognition;
}

/** Everything the recognizer worked out about a stroke, for the practice room. */
export interface StrokeAnalysis {
  recognition: Recognition;
  /** The stroke as the recognizer saw it: resampled and smoothed, in the input's coordinates. */
  points: Pt[];
  /** Each sigil's verdict; all misses when the stroke was too small to read. */
  checks: Record<SigilKind, ShapeCheck>;
  /** The stroke's centre and size; normalized coordinates × size + centre give input ones. */
  center: Pt;
  size: number;
}

export function analyzeStroke(raw: readonly Pt[]): StrokeAnalysis {
  const empty: Record<SigilKind, number> = { line: 0, vee: 0, circle: 0, triangle: 0, zigzag: 0 };
  const pts = dedupe(raw);
  const tiny = (): StrokeAnalysis => {
    const small = miss('Too small to read; draw it bigger');
    return {
      recognition: { kind: null, reason: 'tiny', score: 0, scores: empty },
      points: pts,
      checks: { line: small, vee: small, circle: small, triangle: small, zigzag: small },
      center: pts[0] ?? { x: 0, y: 0 },
      size: 1,
    };
  };
  if (pts.length < 2) return tiny();
  const b = bounds(pts);
  if (Math.max(b.w, b.h) < GESTURE.minSize || pathLength(pts) < GESTURE.minPathLength) return tiny();
  const seen = smooth(resample(pts, GESTURE.resampleCount), 2);
  const norm = normalize(seen);
  const nb = bounds(seen);
  const size = Math.max(nb.w, nb.h) || 1;
  const center = { x: seen[0].x - norm[0].x * size, y: seen[0].y - norm[0].y * size };
  const features = extractFeatures(norm);
  const checks: Record<SigilKind, ShapeCheck> = {
    line: scoreLine(features),
    vee: scoreVee(norm, features),
    circle: scoreCircle(features),
    triangle: scoreTriangle(norm, features),
    zigzag: scoreZigzag(norm, features),
  };
  const scores = Object.fromEntries(SIGIL_KINDS.map((k) => [k, checks[k].score])) as Record<SigilKind, number>;
  return { recognition: decide(scores, features), points: seen, checks, center, size };
}

function decide(scores: Record<SigilKind, number>, features: GestureFeatures): Recognition {
  const ranked = (Object.keys(scores) as SigilKind[]).sort((a, z) => scores[z] - scores[a]);
  const best = ranked[0];
  const second = ranked[1];
  if (scores[best] < THRESH.minScore) {
    return { kind: null, reason: 'unclear', score: scores[best], scores, features };
  }
  if (scores[second] >= THRESH.minScore && scores[best] - scores[second] < THRESH.ambiguityMargin) {
    return { kind: null, reason: 'ambiguous', score: scores[best], scores, features };
  }
  return { kind: best, reason: 'ok', score: scores[best], scores, features };
}
