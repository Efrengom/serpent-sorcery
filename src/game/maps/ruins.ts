import type { MapDef, Piece, Solid, SolidName } from './types';

/**
 * The Sunken Ruins: an old temple complex. The serpent starts in the Rune Plaza at the middle,
 * ringed by pillars. A colonnade runs along the north, a roofless hall stands to the west, a
 * fallen colossus lies to the east and a broken gate wall crosses the south. Open courts in the
 * four corners and the plaza are the boss clearings. No hazards: this is where players learn
 * that stone hurts.
 *
 * Each grid character is 200×200 world units (32×18 cells, 6400×3600).
 */
const GRID = [
  '................................',
  '.bbbbbb..................bbbbbb.',
  '.bbbbbb........22........bbbbbb.',
  '.bbbbbb........22........bbbbbb.',
  '.bbbbbb..................bbbbbb.',
  '................................',
  '..##..###.......................',
  '..#.....#....bbbbbb.............',
  '........#....bb11bb.............',
  '.....3.......bb11bb.......4.....',
  '..#..........bbSSbb.............',
  '..#.....#.......................',
  '..###..##.......................',
  '.bbbbbb..................bbbbbb.',
  '.bbbbbb..######55######..bbbbbb.',
  '.bbbbbb..................bbbbbb.',
  '.bbbbbb..................bbbbbb.',
  '................................',
];

const circle = (name: SolidName, x: number, y: number, r: number): Solid => ({ shape: 'circle', name, x, y, r });
const capsule = (name: SolidName, ax: number, ay: number, bx: number, by: number, r: number): Solid => ({
  shape: 'capsule',
  name,
  ax,
  ay,
  bx,
  by,
  r,
});
const rect = (name: SolidName, x0: number, y0: number, x1: number, y1: number): Solid => ({ shape: 'rect', name, x0, y0, x1, y1 });

const pieces: Piece[] = [];
const add = (solid: Solid, group?: string) => pieces.push({ solid, group });

// The Colonnade: two rows of pillars along the north avenue.
for (let x = 1700; x <= 4700; x += 300) {
  add(circle('pillar', x, 380, 34));
  add(circle('pillar', x, 780, 34));
}

// The Rune Plaza: eight pillars ring the summoning circle, leaving the four ways in open.
for (let i = 0; i < 8; i++) {
  const a = ((22.5 + 45 * i) * Math.PI) / 180;
  add(circle('pillar', 3200 + Math.cos(a) * 760, 1800 + Math.sin(a) * 760, 36));
}

// The Collapsed Hall: four pillars still stand inside its broken walls.
for (const [x, y] of [
  [900, 1700],
  [1300, 1700],
  [900, 2100],
  [1300, 2100],
]) {
  add(circle('pillar', x, y, 30));
}

// The Fallen Colossus, lying with its head to the south-east and its arms flung out.
add(capsule('colossus', 4520, 1408, 4900, 1650, 110));
add(capsule('colossus', 4900, 1650, 5450, 2000, 130));
add(circle('colossus', 5644, 2123, 140));
add(capsule('colossus', 5150, 1810, 5279, 1607, 60));
add(capsule('colossus', 5250, 1870, 5121, 2073, 60));

// The Broken Gate: two towers flank the opening in the south wall.
add(rect('wall', 2860, 2800, 3000, 3080));
add(rect('wall', 3400, 2800, 3540, 3080));

// Optional clusters, varied per run.
add(rect('statue', 2020, 1500, 2140, 1640), 'westStatues');
add(rect('statue', 2020, 2060, 2140, 2200), 'westStatues');
add(capsule('column', 2000, 3290, 2400, 3250, 28), 'gateRubble');
add(capsule('column', 4000, 3250, 4400, 3300, 28), 'gateRubble');
add(circle('pillar', 4200, 1150, 32), 'eastPillars');
add(circle('pillar', 4200, 2450, 32), 'eastPillars');

export const RUINS: MapDef = {
  id: 'ruins',
  name: 'Sunken Ruins',
  cell: 200,
  grid: GRID,
  landmarks: {
    '1': { name: 'Rune Plaza', kind: 'plaza' },
    '2': { name: 'The Colonnade', kind: 'colonnade' },
    '3': { name: 'The Collapsed Hall', kind: 'hall' },
    '4': { name: 'The Fallen Colossus', kind: 'colossus' },
    '5': { name: 'The Broken Gate', kind: 'gate' },
  },
  pieces,
  optional: { westStatues: 0.6, gateRubble: 0.6, eastPillars: 0.5 },
  startHeading: -Math.PI / 2,
  jitter: 10,
};
