import { describe, expect, it } from 'vitest';
import { analyzeStroke, recognize, SIGIL_KINDS, type Pt, type SigilKind } from '../gesture';
import { reportAttempt, shapeOverlay } from '../practice';
import { mulberry32 } from '../math';

/** Randomized hand-drawn-ish strokes: wobble, jitter, uneven speed, varied size and rotation. */
function handDrawn(rng: () => number, path: (t: number) => Pt, size: number): Pt[] {
  const n = 30 + Math.floor(rng() * 60);
  const jitter = size * (0.006 + rng() * 0.012);
  const wobbleAmp = size * rng() * 0.025;
  const wobbleFreq = 1 + rng() * 3;
  const phase = rng() * 6;
  const pts: Pt[] = [];
  let t = 0;
  for (let i = 0; i <= n; i++) {
    const p = path(Math.min(1, t));
    const w = Math.sin(t * Math.PI * 2 * wobbleFreq + phase) * wobbleAmp;
    pts.push({ x: p.x + (rng() - 0.5) * 2 * jitter + w, y: p.y + (rng() - 0.5) * 2 * jitter - w });
    // Uneven speed: random step sizes
    t += (0.3 + rng() * 1.4) / n;
  }
  pts.push(path(1));
  return pts;
}

function randomLine(rng: () => number) {
  const size = 60 + rng() * 260;
  const a = rng() * Math.PI * 2;
  const x0 = rng() * 400;
  const y0 = rng() * 400;
  return { size, path: (t: number) => ({ x: x0 + Math.cos(a) * size * t, y: y0 + Math.sin(a) * size * t }) };
}

function randomCircle(rng: () => number) {
  const r = 30 + rng() * 110;
  const start = rng() * Math.PI * 2;
  const dir = rng() < 0.5 ? 1 : -1;
  const turns = 0.9 + rng() * 0.3;
  const aspect = 0.75 + rng() * 0.25;
  const rot = rng() * Math.PI;
  return {
    size: r * 2,
    path: (t: number) => {
      const a = start + dir * t * turns * Math.PI * 2;
      const ex = Math.cos(a) * r;
      const ey = Math.sin(a) * r * aspect;
      return { x: 300 + ex * Math.cos(rot) - ey * Math.sin(rot), y: 300 + ex * Math.sin(rot) + ey * Math.cos(rot) };
    },
  };
}

function randomVee(rng: () => number) {
  const leg = 50 + rng() * 130;
  const open = ((30 + rng() * 60) * Math.PI) / 180;
  const tilt = ((rng() - 0.5) * 70 * Math.PI) / 180; // within ±35 degrees
  const ratio = 0.65 + rng() * 0.35;
  const up = -Math.PI / 2 + tilt;
  const a = { x: 300 + Math.cos(up - open / 2) * leg, y: 300 + Math.sin(up - open / 2) * leg };
  const b = { x: 300 + Math.cos(up + open / 2) * leg * ratio, y: 300 + Math.sin(up + open / 2) * leg * ratio };
  const [s, e] = rng() < 0.5 ? [a, b] : [b, a];
  return {
    size: leg,
    path: (t: number) =>
      t < 0.5
        ? { x: s.x + (300 - s.x) * t * 2, y: s.y + (300 - s.y) * t * 2 }
        : { x: 300 + (e.x - 300) * (t - 0.5) * 2, y: 300 + (e.y - 300) * (t - 0.5) * 2 },
  };
}

/** Constant-speed path through a list of points. */
function polyPath(points: Pt[]): (t: number) => Pt {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lens.push(l);
    total += l;
  }
  return (t) => {
    let d = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const u = lens[i] === 0 ? 0 : Math.min(1, d / lens[i]);
        return { x: points[i].x + (points[i + 1].x - points[i].x) * u, y: points[i].y + (points[i + 1].y - points[i].y) * u };
      }
      d -= lens[i];
    }
    return points[points.length - 1];
  };
}

const rotate = (p: Pt, a: number, c: Pt): Pt => ({
  x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a),
  y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a),
});

/**
 * Triangles of varied shape (no angle under ~35°), any rotation, either direction, started at a
 * corner or partway along a side, ending with a small gap or overlap.
 */
function randomTriangle(rng: () => number) {
  const size = 60 + rng() * 140;
  const c = { x: 300, y: 300 };
  // Corner angles around the centre, jittered from an equilateral layout.
  const base = rng() * Math.PI * 2;
  const verts = [0, 1, 2].map((i) => {
    const a = base + (i * Math.PI * 2) / 3 + (rng() - 0.5) * 0.5;
    const r = size * (0.85 + rng() * 0.3);
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  });
  if (rng() < 0.5) verts.reverse();
  const loop = [...verts, verts[0]];
  // Start at a corner or partway along the first side.
  const startU = rng() < 0.5 ? 0 : 0.2 + rng() * 0.6;
  const s = { x: loop[0].x + (loop[1].x - loop[0].x) * startU, y: loop[0].y + (loop[1].y - loop[0].y) * startU };
  const pts = [s, ...loop.slice(1)];
  if (startU > 0) pts.push(s);
  // Small overlap past the start, or a small gap before it.
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const nextDir = startU > 0 ? { x: loop[1].x - s.x, y: loop[1].y - s.y } : { x: loop[1].x - loop[0].x, y: loop[1].y - loop[0].y };
  const nl = Math.hypot(nextDir.x, nextDir.y) || 1;
  const o = (rng() - 0.4) * 0.12 * size;
  if (o > 0) pts.push({ x: end.x + (nextDir.x / nl) * o, y: end.y + (nextDir.y / nl) * o });
  else pts[pts.length - 1] = { x: end.x + (prev.x - end.x) * (-o / Math.hypot(prev.x - end.x, prev.y - end.y)), y: end.y + (prev.y - end.y) * (-o / Math.hypot(prev.x - end.x, prev.y - end.y)) };
  return { size: size * 1.6, path: polyPath(pts) };
}

/** Zigzags of 3 to 5 legs (Z, N, W, saw-tooth), any rotation, legs of uneven length and steepness. */
function randomZigzag(rng: () => number) {
  const legs = 3 + Math.floor(rng() * 3);
  const leg = 45 + rng() * 80;
  const steep = ((35 + rng() * 35) * Math.PI) / 180;
  const rot = rng() * Math.PI * 2;
  const c = { x: 300, y: 300 };
  const pts: Pt[] = [{ ...c }];
  for (let i = 0; i < legs; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const a = side * (steep + (rng() - 0.5) * 0.3);
    const l = leg * (0.75 + rng() * 0.5);
    const p = pts[pts.length - 1];
    pts.push({ x: p.x + Math.cos(a) * l * 0.6, y: p.y + Math.sin(a) * l });
  }
  return { size: leg * 1.5, path: polyPath(pts.map((p) => rotate(p, rot, c))) };
}

function sweep(kind: SigilKind, gen: (rng: () => number) => { size: number; path: (t: number) => Pt }, seed: number) {
  const rng = mulberry32(seed);
  let correct = 0;
  let wrong = 0;
  const confused: Partial<Record<SigilKind, number>> = {};
  const N = 300;
  for (let i = 0; i < N; i++) {
    const g = gen(rng);
    const res = recognize(handDrawn(rng, g.path, g.size));
    if (res.kind === kind) correct++;
    else if (res.kind !== null) {
      wrong++;
      confused[res.kind] = (confused[res.kind] ?? 0) + 1;
    }
  }
  return { rate: correct / N, wrong, confused };
}

describe('recognizer robustness sweep (300 random hand-drawn strokes each)', () => {
  it('lines', () => {
    const r = sweep('line', randomLine, 101);
    expect(r.rate).toBeGreaterThan(0.97);
    expect(r.wrong).toBe(0);
  });

  it('circles (either direction, ovals, slight overlap or gap)', () => {
    const r = sweep('circle', randomCircle, 202);
    expect(r.rate).toBeGreaterThan(0.95);
    expect(r.wrong).toBe(0);
  });

  it('V shapes (tilted up to ±35°, uneven legs)', () => {
    const r = sweep('vee', randomVee, 303);
    expect(r.rate).toBeGreaterThan(0.95);
    expect(r.wrong).toBe(0);
  });

  it('triangles (any rotation and direction, started at a corner or mid-side, small gap or overlap)', () => {
    const r = sweep('triangle', randomTriangle, 505);
    expect(r.rate).toBeGreaterThan(0.95);
    expect(r.wrong, JSON.stringify(r.confused)).toBe(0);
  });

  it('zigzags (3 to 5 legs, any rotation, uneven legs)', () => {
    const r = sweep('zigzag', randomZigzag, 606);
    expect(r.rate).toBeGreaterThan(0.95);
    expect(r.wrong, JSON.stringify(r.confused)).toBe(0);
  });

  it('random scribbles are almost always rejected', () => {
    const rng = mulberry32(404);
    let accepted = 0;
    for (let i = 0; i < 300; i++) {
      const pts: Pt[] = [{ x: 300, y: 300 }];
      const n = 20 + Math.floor(rng() * 60);
      let a = rng() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        a += (rng() - 0.5) * 2.4;
        const p = pts[pts.length - 1];
        pts.push({ x: p.x + Math.cos(a) * 12, y: p.y + Math.sin(a) * 12 });
      }
      if (recognize(pts).kind !== null) accepted++;
    }
    expect(accepted / 300).toBeLessThan(0.1);
  });
});

describe('practice room explanations', () => {
  const GENS = { line: randomLine, vee: randomVee, circle: randomCircle, triangle: randomTriangle, zigzag: randomZigzag };

  it('explain every stroke: a passing sigil has a score and no complaint, a failing one says why', () => {
    const rng = mulberry32(707);
    for (const kind of Object.keys(GENS) as SigilKind[]) {
      for (let i = 0; i < 120; i++) {
        const g = GENS[kind](rng);
        const pts = handDrawn(rng, g.path, g.size);
        const a = analyzeStroke(pts);
        // Same verdict as the game's recognizer.
        expect(a.recognition).toEqual(recognize(pts));
        for (const k of SIGIL_KINDS) {
          const c = a.checks[k];
          if (c.score > 0) expect(c.miss).toBeNull();
          else expect(c.miss).toMatch(/\w{3}/);
        }
        // The analyzed points sit where the stroke was drawn.
        const first = a.points[0];
        expect(Math.hypot(first.x - pts[0].x, first.y - pts[0].y)).toBeLessThan(g.size * 0.05);
      }
    }
  });

  it('report a hit with its grade, the wrong sigil, and an unclear stroke', () => {
    const rng = mulberry32(808);
    let tri = randomTriangle(rng);
    let a = analyzeStroke(handDrawn(rng, tri.path, tri.size));
    while (a.recognition.kind !== 'triangle') {
      tri = randomTriangle(rng);
      a = analyzeStroke(handDrawn(rng, tri.path, tri.size));
    }
    const hit = reportAttempt(a, 'triangle');
    expect(hit.outcome).toBe('hit');
    expect(hit.headline).toBe('Triangle: Arcane Ward');
    expect(hit.detail).toMatch(/^(Perfect|Clean|Rough)/);
    const wrong = reportAttempt(a, 'circle');
    expect(wrong.outcome).toBe('wrong');
    expect(wrong.headline).toBe('Read as Triangle, not Circle');
    expect(wrong.focus).toBe('circle');
    expect(wrong.detail).toBe(a.checks.circle.miss);

    const square: Pt[] = [];
    for (const [x, y] of [[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]]) square.push({ x: x + 100, y: y + 100 });
    const sq = analyzeStroke(handDrawn(mulberry32(1), polyPath(square), 200));
    const unclear = reportAttempt(sq, 'triangle');
    expect(unclear.outcome).toBe('miss');
    expect(unclear.detail).toMatch(/4 corners; a triangle has 3/);
    expect(reportAttempt(analyzeStroke([{ x: 0, y: 0 }, { x: 5, y: 4 }]), null).outcome).toBe('tiny');
  });

  it("fit the shape it found: a triangle's three corners and a circle's centre and radius", () => {
    const rng = mulberry32(909);
    let tri = analyzeStroke(handDrawn(rng, randomTriangle(rng).path, 200));
    while (tri.recognition.kind !== 'triangle') tri = analyzeStroke(handDrawn(rng, randomTriangle(rng).path, 200));
    const fit = shapeOverlay(tri, 'triangle');
    expect(fit?.type === 'path' && fit.closed && fit.points.length).toBe(3);

    const ring: Pt[] = [];
    for (let i = 0; i <= 80; i++) ring.push({ x: 300 + Math.cos((i / 80) * Math.PI * 2) * 90, y: 200 + Math.sin((i / 80) * Math.PI * 2) * 90 });
    const circle = shapeOverlay(analyzeStroke(ring), 'circle');
    expect(circle?.type).toBe('circle');
    if (circle?.type === 'circle') {
      expect(circle.center.x).toBeCloseTo(300, -1);
      expect(circle.center.y).toBeCloseTo(200, -1);
      expect(circle.radius).toBeGreaterThan(80);
      expect(circle.radius).toBeLessThan(95);
    }
  });
});
