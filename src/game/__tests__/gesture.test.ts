import { describe, expect, it } from 'vitest';
import { recognize, type Pt } from '../gesture';
import { mulberry32 } from '../math';

/**
 * Builds a stroke from a parametric path, sampling it the way a mouse would:
 * uneven speed (points bunch up and spread out) plus small positional jitter.
 */
function stroke(
  path: (t: number) => Pt,
  opts: { seed?: number; samples?: number; jitter?: number; uneven?: boolean } = {},
): Pt[] {
  const rng = mulberry32(opts.seed ?? 1);
  const samples = opts.samples ?? 60;
  const jitter = opts.jitter ?? 1.5;
  const pts: Pt[] = [];
  for (let i = 0; i <= samples; i++) {
    let t = i / samples;
    // Ease-in/ease-out speed profile like a real hand, optionally exaggerated.
    if (opts.uneven !== false) t = t * t * (3 - 2 * t);
    const p = path(t);
    pts.push({ x: p.x + (rng() - 0.5) * 2 * jitter, y: p.y + (rng() - 0.5) * 2 * jitter });
  }
  return pts;
}

function line(x0: number, y0: number, x1: number, y1: number): (t: number) => Pt {
  return (t) => ({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
}

function polyline(points: Pt[]): (t: number) => Pt {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lens.push(l);
    total += l;
  }
  return (t) => {
    let d = t * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const u = lens[i] === 0 ? 0 : Math.min(1, d / lens[i]);
        return {
          x: points[i].x + (points[i + 1].x - points[i].x) * u,
          y: points[i].y + (points[i + 1].y - points[i].y) * u,
        };
      }
      d -= lens[i];
    }
    return points[points.length - 1];
  };
}

function circle(cx: number, cy: number, r: number, start: number, turns: number, dir: 1 | -1, aspect = 1, rot = 0) {
  return (t: number): Pt => {
    const a = start + dir * t * turns * Math.PI * 2;
    const ex = Math.cos(a) * r;
    const ey = Math.sin(a) * r * aspect;
    return { x: cx + ex * Math.cos(rot) - ey * Math.sin(rot), y: cy + ex * Math.sin(rot) + ey * Math.cos(rot) };
  };
}

/** A V whose vertex is at the bottom, opening `angleDeg`, tilted by `tiltDeg` (positive = clockwise). */
function vee(cx: number, cy: number, leg: number, angleDeg: number, tiltDeg: number, legRatio = 1): Pt[] {
  const half = (angleDeg * Math.PI) / 360;
  const tilt = (tiltDeg * Math.PI) / 180;
  const up = -Math.PI / 2 + tilt;
  const a1 = up - half;
  const a2 = up + half;
  const vertex = { x: cx, y: cy };
  return [
    { x: cx + Math.cos(a1) * leg, y: cy + Math.sin(a1) * leg },
    vertex,
    { x: cx + Math.cos(a2) * leg * legRatio, y: cy + Math.sin(a2) * leg * legRatio },
  ];
}

describe('gesture recognition: lines', () => {
  it('recognizes straight lines in every direction', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const a = (deg * Math.PI) / 180;
      const len = 160;
      const pts = stroke(line(400, 300, 400 + Math.cos(a) * len, 300 + Math.sin(a) * len), { seed: deg + 3 });
      expect(recognize(pts).kind, `line at ${deg} deg`).toBe('line');
    }
  });

  it('accepts short, long, slightly wobbly and hooked lines', () => {
    expect(recognize(stroke(line(0, 0, 70, 10), { seed: 4 })).kind).toBe('line');
    expect(recognize(stroke(line(0, 0, 600, 200), { seed: 5, jitter: 4 })).kind).toBe('line');
    const wobbly = stroke((t) => ({ x: t * 250, y: Math.sin(t * Math.PI * 3) * 6 }), { seed: 6 });
    expect(recognize(wobbly).kind).toBe('line');
    const hooked = stroke(polyline([{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 250, y: 8 }]), { seed: 7 });
    expect(recognize(hooked).kind).toBe('line');
  });

  it('is unaffected by very uneven drawing speed', () => {
    const rng = mulberry32(11);
    const pts: Pt[] = [];
    let t = 0;
    while (t < 1) {
      pts.push({ x: 100 + t * 220, y: 100 + t * 140 });
      t += rng() < 0.5 ? 0.002 : 0.08; // long pauses and fast flicks
    }
    pts.push({ x: 320, y: 240 });
    expect(recognize(pts).kind).toBe('line');
  });
});

describe('gesture recognition: circles', () => {
  it('recognizes clockwise and counterclockwise circles from any start angle', () => {
    for (const dir of [1, -1] as const) {
      for (let s = 0; s < 8; s++) {
        const pts = stroke(circle(300, 300, 80, (s * Math.PI) / 4, 1.0, dir), { seed: s * 7 + (dir > 0 ? 1 : 2) });
        expect(recognize(pts).kind, `circle dir=${dir} start=${s}`).toBe('circle');
      }
    }
  });

  it('accepts imperfect circles: slightly open, overlapping, oval, and small', () => {
    expect(recognize(stroke(circle(0, 0, 90, 1, 0.86, 1), { seed: 21 })).kind).toBe('circle');
    expect(recognize(stroke(circle(0, 0, 90, 2, 1.2, -1), { seed: 22, samples: 80 })).kind).toBe('circle');
    expect(recognize(stroke(circle(0, 0, 100, 0, 1.0, 1, 0.7, 0.5), { seed: 23 })).kind).toBe('circle');
    expect(recognize(stroke(circle(0, 0, 28, 0, 1.0, -1), { seed: 24, jitter: 1 })).kind).toBe('circle');
  });
});

describe('gesture recognition: V shapes', () => {
  it('recognizes upright V shapes of varied opening', () => {
    for (const angle of [25, 45, 60, 80, 100]) {
      const pts = stroke(polyline(vee(300, 300, 120, angle, 0)), { seed: angle });
      expect(recognize(pts).kind, `V opening ${angle}`).toBe('vee');
    }
  });

  it('accepts reasonably tilted and lopsided V shapes, drawn from either side', () => {
    for (const tilt of [-40, -25, 25, 40]) {
      const pts = stroke(polyline(vee(300, 300, 120, 55, tilt)), { seed: 100 + tilt });
      expect(recognize(pts).kind, `V tilt ${tilt}`).toBe('vee');
    }
    const lopsided = stroke(polyline(vee(300, 300, 130, 60, 10, 0.55)), { seed: 31 });
    expect(recognize(lopsided).kind).toBe('vee');
    const reversed = stroke(polyline(vee(300, 300, 120, 50, -10).reverse()), { seed: 32 });
    expect(recognize(reversed).kind).toBe('vee');
  });

  it('accepts a V with a slightly rounded bottom', () => {
    const rounded = stroke(
      polyline([
        { x: 0, y: 0 },
        { x: 55, y: 120 },
        { x: 60, y: 126 },
        { x: 66, y: 126 },
        { x: 72, y: 120 },
        { x: 130, y: 0 },
      ]),
      { seed: 33 },
    );
    expect(recognize(rounded).kind).toBe('vee');
  });
});

/** Triangle corners around (cx, cy), rotated, closed back to the start. */
function triangle(cx: number, cy: number, r: number, rotDeg: number, dir: 1 | -1 = 1): Pt[] {
  const pts = [0, 1, 2].map((i) => {
    const a = ((rotDeg + dir * i * 120) * Math.PI) / 180;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  return [...pts, pts[0]];
}

describe('gesture recognition: triangles', () => {
  it('recognizes triangles at any rotation, drawn either way round', () => {
    for (let rot = 0; rot < 360; rot += 30) {
      for (const dir of [1, -1] as const) {
        const pts = stroke(polyline(triangle(300, 300, 90, rot, dir)), { seed: rot + (dir > 0 ? 1 : 2), samples: 80 });
        expect(recognize(pts).kind, `triangle rot=${rot} dir=${dir}`).toBe('triangle');
      }
    }
  });

  it('accepts lopsided triangles, a start partway along a side, and a small overlap', () => {
    const lopsided = [
      { x: 0, y: 0 },
      { x: 200, y: 20 },
      { x: 60, y: 120 },
      { x: 0, y: 0 },
    ];
    expect(recognize(stroke(polyline(lopsided), { seed: 71, samples: 80 })).kind).toBe('triangle');
    const midSide = [
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 90 },
      { x: 0, y: 0 },
      { x: 55, y: 0 },
    ];
    expect(recognize(stroke(polyline(midSide), { seed: 72, samples: 80 })).kind).toBe('triangle');
    // Ends 30% of the way along the first side again.
    const corners = triangle(0, 0, 70, -90);
    const overlap = [...corners, { x: corners[0].x + (corners[1].x - corners[0].x) * 0.3, y: corners[0].y + (corners[1].y - corners[0].y) * 0.3 }];
    expect(recognize(stroke(polyline(overlap), { seed: 73, samples: 80 })).kind).toBe('triangle');
  });
});

describe('gesture recognition: zigzags', () => {
  it('recognizes Z, N, W and longer saw-tooth zigzags in any direction', () => {
    const z = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 0, y: 110 },
      { x: 120, y: 110 },
    ];
    const n = [
      { x: 0, y: 120 },
      { x: 0, y: 0 },
      { x: 100, y: 120 },
      { x: 100, y: 0 },
    ];
    const w = [
      { x: 0, y: 0 },
      { x: 40, y: 100 },
      { x: 80, y: 20 },
      { x: 120, y: 100 },
      { x: 160, y: 0 },
    ];
    const saw = [
      { x: 0, y: 0 },
      { x: 40, y: 80 },
      { x: 80, y: 0 },
      { x: 120, y: 80 },
      { x: 160, y: 0 },
      { x: 200, y: 80 },
    ];
    [z, n, w, saw].forEach((shape, i) => {
      for (const rot of [0, 90, 200]) {
        const a = (rot * Math.PI) / 180;
        const turned = shape.map((p) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }));
        expect(recognize(stroke(polyline(turned), { seed: 80 + i * 7 + rot, samples: 90 })).kind, `zigzag ${i} rot=${rot}`).toBe('zigzag');
      }
    });
  });

  it('also accepts a quick zigzag whose corners came out rounded', () => {
    const wave = stroke((t) => ({ x: t * 240, y: Math.sin(t * Math.PI * 4) * 40 }), { seed: 56, samples: 90 });
    expect(recognize(wave).kind).toBe('zigzag');
  });
});

describe('gesture recognition: rejections', () => {
  it('treats clicks and tiny drags as tiny, never as a sigil', () => {
    expect(recognize([]).reason).toBe('tiny');
    expect(recognize([{ x: 10, y: 10 }]).reason).toBe('tiny');
    expect(recognize([{ x: 10, y: 10 }, { x: 10.5, y: 10.2 }]).reason).toBe('tiny');
    expect(recognize(stroke(line(0, 0, 14, 6), { seed: 41 })).reason).toBe('tiny');
    expect(recognize(stroke(circle(0, 0, 8, 0, 1, 1), { seed: 42 })).kind).toBeNull();
  });

  it('rejects scribbles, squares, spirals, S-curves and upside-down Vs', () => {
    const square = stroke(
      polyline([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 0 },
      ]),
      { seed: 51, samples: 90 },
    );
    expect(recognize(square).kind).toBeNull();

    const rng = mulberry32(52);
    const walk: Pt[] = [{ x: 200, y: 200 }];
    for (let i = 0; i < 80; i++) {
      const p = walk[walk.length - 1];
      walk.push({ x: p.x + (rng() - 0.5) * 50, y: p.y + (rng() - 0.5) * 50 });
    }
    expect(recognize(walk).kind).toBeNull();

    const spiral = stroke(
      (t) => ({ x: Math.cos(t * Math.PI * 7) * (20 + t * 90), y: Math.sin(t * Math.PI * 7) * (20 + t * 90) }),
      { seed: 53, samples: 140 },
    );
    expect(recognize(spiral).kind).toBeNull();

    const caret = stroke(polyline(vee(300, 300, 120, 50, 180)), { seed: 54 });
    expect(recognize(caret).kind).toBeNull();

    const sCurve = stroke((t) => ({ x: Math.sin(t * Math.PI * 2) * 60, y: t * 200 }), { seed: 55 });
    expect(recognize(sCurve).kind).toBeNull();
  });

  it('is deterministic', () => {
    const pts = stroke(circle(10, 10, 70, 0.3, 1, -1), { seed: 61 });
    const a = recognize(pts);
    const b = recognize(pts.map((p) => ({ ...p })));
    expect(a).toEqual(b);
  });
});
