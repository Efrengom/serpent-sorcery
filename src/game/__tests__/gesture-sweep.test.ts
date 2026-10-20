import { describe, expect, it } from 'vitest';
import { recognize, type Pt, type SigilKind } from '../gesture';
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

function sweep(kind: SigilKind, gen: (rng: () => number) => { size: number; path: (t: number) => Pt }, seed: number) {
  const rng = mulberry32(seed);
  let correct = 0;
  let wrong = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const g = gen(rng);
    const res = recognize(handDrawn(rng, g.path, g.size));
    if (res.kind === kind) correct++;
    else if (res.kind !== null) wrong++;
  }
  return { rate: correct / N, wrong };
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
