import { describe, expect, it } from 'vitest';
import { clampCamera, createCamera, inView, updateCamera } from '../camera';
import { ARENA, CAMERA, ENEMIES, SNAKE, SPELLS } from '../config';
import { buildLayout, validateLayout } from '../maps';
import { CATACOMBS } from '../maps/catacombs';
import { EMBER } from '../maps/ember';
import { HOLLOWS } from '../maps/hollows';
import { wallRects } from '../maps/layout';
import { RUINS } from '../maps/ruins';
import type { MapDef, Solid, SolidName } from '../maps/types';
import { describeHurt, hurtKey } from '../recap';
import { Snake } from '../snake';
import { bounceOffSolids, buildSolidIndex, castRay, clearanceAt, clearPath, pushOut, solidDistance } from '../terrain';

const circle: Solid = { shape: 'circle', name: 'pillar', x: 500, y: 500, r: 30 };
const rect: Solid = { shape: 'rect', name: 'wall', x0: 400, y0: 400, x1: 600, y1: 450 };
const capsule: Solid = { shape: 'capsule', name: 'column', ax: 300, ay: 300, bx: 500, by: 300, r: 28 };

describe('terrain distances', () => {
  it('measures signed distance and the outward normal for every shape', () => {
    const out = { d: 0, nx: 0, ny: 0, solid: null };
    expect(solidDistance(circle, 560, 500, out)).toBeCloseTo(30, 6);
    expect([out.nx, out.ny]).toEqual([1, 0]);
    expect(solidDistance(circle, 500, 490, out)).toBeCloseTo(-20, 6);
    expect(out.ny).toBeCloseTo(-1, 6);

    expect(solidDistance(rect, 500, 380, out)).toBeCloseTo(20, 6);
    expect([out.nx, out.ny]).toEqual([0, -1]);
    // Inside: the nearest face wins.
    expect(solidDistance(rect, 595, 425, out)).toBeCloseTo(-5, 6);
    expect([out.nx, out.ny]).toEqual([1, 0]);
    // Outside a corner: straight out from it.
    expect(solidDistance(rect, 630, 490, out)).toBeCloseTo(50, 6);
    expect(out.nx).toBeCloseTo(0.6, 6);
    expect(out.ny).toBeCloseTo(0.8, 6);

    expect(solidDistance(capsule, 400, 350, out)).toBeCloseTo(22, 6);
    expect(out.ny).toBeCloseTo(1, 6);
    expect(solidDistance(capsule, 540, 300, out)).toBeCloseTo(12, 6);
    expect(out.nx).toBeCloseTo(1, 6);
  });

  it('finds the nearest solid through the lookup cells, exactly up to the margin', () => {
    const index = buildSolidIndex([circle, rect, capsule], 1000, 1000);
    for (let i = 0; i < 400; i++) {
      const x = (i * 37) % 1000;
      const y = (i * 91) % 1000;
      const exact = Math.min(...[circle, rect, capsule].map((s) => solidDistance(s, x, y)));
      expect(clearanceAt(index, x, y)).toBeCloseTo(Math.min(exact, index.margin), 6);
    }
  });

  it('casts rays and checks clear paths', () => {
    const index = buildSolidIndex([circle], 1000, 1000);
    expect(castRay(index, 300, 500, 700, 500)).toBeCloseTo(170, 0);
    expect(castRay(index, 300, 500, 700, 500, 10)).toBeCloseTo(160, 0);
    expect(clearPath(index, 300, 400, 700, 400)).toBe(true);
    expect(clearPath(index, 300, 450, 700, 450, 25)).toBe(false);
  });
});

describe('bouncing off solids', () => {
  it('pushes the head out of a pillar and sends it off at a clear angle', () => {
    const index = buildSolidIndex([circle], 1000, 1000);
    const head = { x: 460, y: 496, heading: 0 };
    expect(bounceOffSolids(index, head, SNAKE.headRadius)?.name).toBe('pillar');
    expect(Math.hypot(head.x - 500, head.y - 500)).toBeGreaterThanOrEqual(30 + SNAKE.headRadius - 1e-6);
    // Heading back away from the pillar's centre by at least the minimum outward share.
    const nx = (head.x - 500) / Math.hypot(head.x - 500, head.y - 500);
    const ny = (head.y - 500) / Math.hypot(head.x - 500, head.y - 500);
    const out = Math.cos(head.heading) * nx + Math.sin(head.heading) * ny;
    expect(out).toBeGreaterThanOrEqual(ARENA.wallMinInward * 0.8);
  });

  it('never lets the head, a charge or a bolt pass through the thinnest solid', () => {
    const thin: Solid = { shape: 'capsule', name: 'column', ax: 500, ay: 300, bx: 500, by: 700, r: 28 };
    const index = buildSolidIndex([thin], 1000, 1000);
    const dt = 1 / 120;
    for (const [speed, r] of [
      [SNAKE.speed, SNAKE.headRadius],
      [ENEMIES.brute.chargeSpeed, ENEMIES.brute.radius],
      [ENEMIES.boss.chargeSpeed, ENEMIES.boss.radius],
    ]) {
      const body = { x: 300, y: 500 };
      for (let i = 0; i < 2 / dt; i++) {
        body.x += speed * dt;
        pushOut(index, body, r);
      }
      expect(body.x, `speed ${speed}`).toBeLessThan(500);
    }
    // A bolt is removed on the first step whose centre is within half its radius of a solid.
    let x = 300;
    let stopped = false;
    while (x < 700 && !stopped) {
      x += SPELLS.bolt.speed * dt;
      stopped = clearanceAt(index, x, 500) < SPELLS.bolt.radius * 0.5;
    }
    expect(stopped).toBe(true);
    expect(x).toBeLessThan(500);
  });

  it('names what the serpent ran into, on a map', () => {
    const map = buildLayout(RUINS, 1);
    const s = new Snake(3200, 2100, -Math.PI / 2);
    let hit: SolidName | null = null;
    // Straight up from the start: through the plaza and into the colonnade's middle pillar.
    for (let i = 0; i < 120 * 10 && !hit; i++) hit = s.update(1 / 120, 0, 0, map);
    expect(hit).toBe('pillar');
    expect(s.steerLock).toBeGreaterThan(0);
  });
});

describe('the Sunken Ruins layout', () => {
  it('meets every layout rule for 50 seeds', { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 50; seed++) {
      const report = validateLayout(buildLayout(RUINS, seed));
      expect(report.issues, `seed ${seed}`).toEqual([]);
    }
  });

  it('is 4 to 5 views each way, with its clearings, landmarks and torches', () => {
    const map = buildLayout(RUINS, 7);
    expect(map.width).toBe(6400);
    expect(map.height).toBe(3600);
    expect(map.width / CAMERA.maxViewWidth).toBeGreaterThanOrEqual(4);
    expect(map.height / CAMERA.viewHeight).toBeGreaterThanOrEqual(4.5);
    expect(map.clearings.length).toBeGreaterThanOrEqual(3);
    expect(map.landmarks.map((l) => l.kind).sort()).toEqual(['colonnade', 'colossus', 'gate', 'hall', 'plaza']);
    expect(map.torches.length).toBeGreaterThan(20);
    expect(map.start).toEqual({ x: 3200, y: 2100 });
  });

  it('varies from run to run: optional clusters come and go, round pieces jitter', () => {
    const counts = new Set<number>();
    const pillarX = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const map = buildLayout(RUINS, seed);
      counts.add(map.solids.length);
      const p = map.solids.find((s) => s.name === 'pillar');
      if (p?.shape === 'circle') pillarX.add(Math.round(p.x));
    }
    expect(counts.size).toBeGreaterThan(1);
    expect(pillarX.size).toBeGreaterThan(5);
    // The same seed always builds the same map.
    expect(buildLayout(RUINS, 3).solids).toEqual(buildLayout(RUINS, 3).solids);
  });

  it('merges wall cells into as few rectangles as it can', () => {
    const def: MapDef = { ...RUINS, grid: ['....', '.##.', '.##.', '.#..', 'S...'], landmarks: {}, pieces: [], optional: {} };
    expect(wallRects(def)).toEqual([
      { x0: 200, y0: 200, x1: 600, y1: 600 },
      { x0: 200, y0: 600, x1: 400, y1: 800 },
    ]);
  });

  it('names every solid in the death recap', () => {
    for (const name of ['wall', 'pillar', 'column', 'statue', 'colossus'] as SolidName[]) {
      const key = hurtKey({ kind: 'wall', attack: name });
      expect(describeHurt(key), name).not.toBe(key);
    }
  });
});

describe('the Ember Depths layout', () => {
  it('meets every layout rule for 50 seeds, lava and vents included', { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 50; seed++) {
      const report = validateLayout(buildLayout(EMBER, seed));
      expect(report.issues, `seed ${seed}`).toEqual([]);
    }
  });

  it('is bigger than the Ruins, with its landmarks, a lava river and vents', () => {
    const map = buildLayout(EMBER, 7);
    expect(map.width).toBe(7200);
    expect(map.height).toBe(4000);
    expect(map.width).toBeLessThanOrEqual(8000);
    expect(map.height).toBeLessThanOrEqual(4400);
    expect(map.clearings.length).toBeGreaterThanOrEqual(3);
    expect(map.landmarks.map((l) => l.kind).sort()).toEqual(['caldera', 'falls', 'forge', 'spires']);
    expect(map.hazards.length).toBeGreaterThan(3);
    expect(map.hazardIndex).not.toBeNull();
    expect(map.vents.length).toBeGreaterThanOrEqual(8);
    // The river cuts the map in two, but the bridges keep both halves on dry ground.
    expect(clearanceAt(map.hazardIndex!, 3500, 2000)).toBeLessThan(0);
    expect(clearanceAt(map.hazardIndex!, 3500, 1200)).toBeGreaterThan(0);
  });

  it('names every solid and hazard in the death recap', () => {
    for (const name of ['basalt', 'spire', 'ridge', 'anvil', 'lava', 'fire'] as const) {
      const key = hurtKey({ kind: 'wall', attack: name });
      expect(describeHurt(key), name).not.toBe(key);
    }
    expect(describeHurt(hurtKey({ kind: 'hazard', attack: 'vent' }))).toBe('an eruption vent');
  });
});

describe('the Mycelium Hollows and the Rimefrost Catacombs', () => {
  it('meet every layout rule for 50 seeds, brambles, ice and vents included', { timeout: 120_000 }, () => {
    for (const def of [HOLLOWS, CATACOMBS]) {
      for (let seed = 1; seed <= 50; seed++) {
        const report = validateLayout(buildLayout(def, seed));
        expect(report.issues, `${def.id} seed ${seed}`).toEqual([]);
      }
    }
  });

  it('are 4 to 5 views each way, with their landmarks, hazards and vents', () => {
    const hollows = buildLayout(HOLLOWS, 3);
    expect([hollows.width, hollows.height]).toEqual([7600, 4200]);
    expect(hollows.landmarks.map((l) => l.kind).sort()).toEqual(['fallen', 'glowring', 'grotto', 'heartroot', 'thicket']);
    expect(hollows.zones.bramble).toBeDefined();
    expect(hollows.zones.lava).toBeUndefined();
    expect(hollows.harmIndex).not.toBeNull();
    expect(hollows.vents.length).toBeGreaterThanOrEqual(8);

    const crypts = buildLayout(CATACOMBS, 3);
    expect([crypts.width, crypts.height]).toEqual([8000, 4400]);
    expect(crypts.landmarks.map((l) => l.kind).sort()).toEqual(['bellcourt', 'kings', 'lake', 'ossuary']);
    // Ice is all the Catacombs have, and it doesn't sting.
    expect(crypts.zones.ice).toBeDefined();
    expect(crypts.harmIndex).toBeNull();
    expect(clearanceAt(crypts.zones.ice!, 6700, 2300)).toBeLessThan(0);
    for (const map of [hollows, crypts]) {
      expect(map.width / CAMERA.maxViewWidth).toBeGreaterThanOrEqual(4);
      expect(map.height / CAMERA.viewHeight).toBeGreaterThanOrEqual(4.5);
      expect(map.width).toBeLessThanOrEqual(8000);
    }
  });

  it('name every solid, wall, hazard and vent in the death recap', () => {
    for (const name of ['stalk', 'heartroot', 'root', 'cap', 'icePillar', 'sarcophagus', 'roots', 'crypt', 'cliff', 'bramble'] as const) {
      const key = hurtKey({ kind: 'wall', attack: name });
      expect(describeHurt(key), name).not.toBe(key);
    }
    expect(describeHurt(hurtKey({ kind: 'hazard', attack: 'spores' }))).toBe('a spore vent');
    expect(describeHurt(hurtKey({ kind: 'hazard', attack: 'icicle' }))).toBe('falling icicles');
  });
});

describe('the camera', () => {
  const head = { x: 3000, y: 1800, heading: 0 };

  it('looks ahead of the head and eases after it', () => {
    const cam = createCamera(3000, 1800);
    updateCamera(cam, head, 6400, 3600, 1 / 120, false);
    expect(cam.x).toBeGreaterThan(3000);
    expect(cam.x).toBeLessThan(3000 + CAMERA.lookahead);
    for (let i = 0; i < 240; i++) updateCamera(cam, head, 6400, 3600, 1 / 120, false);
    expect(cam.x).toBeCloseTo(3000 + CAMERA.lookahead, 0);
    expect(cam.y).toBeCloseTo(1800, 6);
  });

  it('stays centred with Steady camera, and snaps after a teleport', () => {
    const cam = createCamera(3000, 1800);
    updateCamera(cam, head, 6400, 3600, 1 / 120, true);
    expect([cam.x, cam.y]).toEqual([3000, 1800]);
    updateCamera(cam, { x: 1000, y: 900, heading: Math.PI / 2 }, 6400, 3600, 1 / 120, false);
    expect(cam.x).toBeCloseTo(1000, 6);
    expect(cam.y).toBeCloseTo(900 + CAMERA.lookahead, 6);
  });

  it('never shows past the map edge', () => {
    const cam = createCamera(0, 0);
    clampCamera(cam, 6400, 3600);
    expect(cam.x).toBe(cam.viewW / 2);
    expect(cam.y).toBe(cam.viewH / 2);
    expect(inView(cam, 10, 10)).toBe(true);
    expect(inView(cam, cam.viewW + 50, 10)).toBe(false);
    expect(inView(cam, cam.viewW + 50, 10, 60)).toBe(true);
  });
});
