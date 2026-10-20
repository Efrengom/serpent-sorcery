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
 *      signed/absolute turning, closure gap, radial spread, corner geometry).
 *   5. Each sigil has gates (hard requirements) and a confidence score. The best passing
 *      sigil wins unless another passing sigil scores too close to it (ambiguous).
 */

import { GESTURE } from './config';

export interface Pt {
  x: number;
  y: number;
}

export type SigilKind = 'line' | 'vee' | 'circle';

export interface GestureFeatures {
  pathLength: number;
  straightness: number;
  elongation: number;
  signedTurning: number;
  absTurning: number;
  closureGap: number;
  radialCv: number;
  maxChordDeviation: number;
}

export interface Recognition {
  kind: SigilKind | null;
  reason: 'ok' | 'tiny' | 'unclear' | 'ambiguous';
  score: number;
  scores: Record<SigilKind, number>;
  features?: GestureFeatures;
}

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

function sub(pts: readonly Pt[], from: number, to: number): Pt[] {
  return pts.slice(from, to + 1);
}

function margin(value: number, limit: number, span: number): number {
  return Math.max(0, Math.min(1, (value - limit) / span));
}

function scoreLine(pts: Pt[], f: GestureFeatures): number {
  const t = THRESH.line;
  if (f.straightness < t.minStraightness) return 0;
  if (f.elongation > t.maxElongation) return 0;
  if (f.maxChordDeviation > t.maxChordDev) return 0;
  void pts;
  const a = margin(f.straightness, t.minStraightness, 1 - t.minStraightness);
  const b = margin(t.maxElongation - f.elongation, 0, t.maxElongation);
  return 0.5 + 0.5 * (0.6 * a + 0.4 * b);
}

function scoreCircle(f: GestureFeatures): number {
  const t = THRESH.circle;
  const turn = Math.abs(f.signedTurning);
  if (f.closureGap > t.maxGap) return 0;
  if (turn < t.minTurn || turn > t.maxTurn) return 0;
  if (f.absTurning === 0 || turn / f.absTurning < t.minConsistency) return 0;
  if (f.elongation < t.minElongation) return 0;
  if (f.radialCv > t.maxRadialCv) return 0;
  const gap = margin(t.maxGap - f.closureGap, 0, t.maxGap);
  const round = margin(f.elongation, t.minElongation, 1 - t.minElongation);
  const even = margin(t.maxRadialCv - f.radialCv, 0, t.maxRadialCv);
  const full = margin(turn, t.minTurn, 2 * Math.PI - t.minTurn);
  return 0.5 + 0.5 * (0.3 * gap + 0.25 * round + 0.25 * even + 0.2 * full);
}

function scoreVee(pts: Pt[], f: GestureFeatures): number {
  const t = THRESH.vee;
  const n = pts.length;
  if (f.straightness > t.maxStraightness) return 0;
  const first = pts[0];
  const last = pts[n - 1];
  // The vertex is the point farthest from the start-end chord.
  const { index: k } = maxDeviation(pts, 0, n - 1);
  if (k < 3 || k > n - 4) return 0;
  const leg1 = sub(pts, 0, k);
  const leg2 = sub(pts, k, n - 1);
  const len1 = pathLength(leg1);
  const len2 = pathLength(leg2);
  const legRatio = Math.min(len1, len2) / Math.max(len1, len2);
  if (legRatio < t.minLegRatio) return 0;
  const v = pts[k];
  const c1 = Math.hypot(first.x - v.x, first.y - v.y);
  const c2 = Math.hypot(last.x - v.x, last.y - v.y);
  const s1 = c1 / len1;
  const s2 = c2 / len2;
  if (s1 < t.minLegStraightness || s2 < t.minLegStraightness) return 0;
  const d1 = maxDeviation(leg1, 0, leg1.length - 1).dev / c1;
  const d2 = maxDeviation(leg2, 0, leg2.length - 1).dev / c2;
  if (d1 > t.maxLegDeviation || d2 > t.maxLegDeviation) return 0;
  const u1 = { x: (first.x - v.x) / c1, y: (first.y - v.y) / c1 };
  const u2 = { x: (last.x - v.x) / c2, y: (last.y - v.y) / c2 };
  const angle = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
  if (angle < t.minAngle || angle > t.maxAngle) return 0;
  // The opening (bisector from the vertex) should point roughly up the screen.
  const bx = u1.x + u2.x;
  const by = u1.y + u2.y;
  const bl = Math.hypot(bx, by);
  if (bl === 0) return 0;
  const tilt = Math.acos(Math.max(-1, Math.min(1, -by / bl)));
  if (tilt > t.maxTilt) return 0;
  const straight = margin(Math.min(s1, s2), t.minLegStraightness, 1 - t.minLegStraightness);
  const balance = margin(legRatio, t.minLegRatio, 1 - t.minLegRatio);
  const upright = margin(t.maxTilt - tilt, 0, t.maxTilt);
  const mid = (t.minAngle + t.maxAngle) / 2;
  const angleFit = 1 - Math.abs(angle - mid) / ((t.maxAngle - t.minAngle) / 2);
  return 0.5 + 0.5 * (0.35 * straight + 0.2 * balance + 0.25 * upright + 0.2 * angleFit);
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
  return {
    pathLength: len,
    straightness: len > 0 ? chord / len : 0,
    elongation: pcaElongation(norm),
    signedTurning: turn.signed,
    absTurning: turn.abs,
    closureGap: chord / (Math.max(b.w, b.h) || 1),
    radialCv: mean > 0 ? Math.sqrt(variance) / mean : 1,
    maxChordDeviation: chord > 0 ? maxDeviation(norm, 0, n - 1).dev / chord : Infinity,
  };
}

export function recognize(raw: readonly Pt[]): Recognition {
  const empty: Record<SigilKind, number> = { line: 0, vee: 0, circle: 0 };
  const pts = dedupe(raw);
  if (pts.length < 2) return { kind: null, reason: 'tiny', score: 0, scores: empty };
  const b = bounds(pts);
  if (Math.max(b.w, b.h) < GESTURE.minSize || pathLength(pts) < GESTURE.minPathLength) {
    return { kind: null, reason: 'tiny', score: 0, scores: empty };
  }
  const norm = normalize(smooth(resample(pts, GESTURE.resampleCount), 2));
  const features = extractFeatures(norm);
  const scores: Record<SigilKind, number> = {
    line: scoreLine(norm, features),
    vee: scoreVee(norm, features),
    circle: scoreCircle(features),
  };
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
