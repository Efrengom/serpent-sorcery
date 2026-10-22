import type { Hazard, MapDef, Piece, Solid, SolidName } from './types';

/**
 * The Rimefrost Catacombs: frozen crypts below the hollows. The serpent arrives in the Bell
 * Court, ringed by pillars of ice. North stands the Ossuary, a hall of bones with a door to
 * each side; south, the Crypt of Kings, where sarcophagi lie in a row; east, the Frozen Lake.
 * Ice sheets widen the serpent's turns, and icicles fall where a circle is marked.
 *
 * Each grid character is 200×200 world units (40×22 cells, 8000×4400). `=` is ice.
 */
const GRID = [
  '........................................',
  '......bbbbbb................bbbbbb......',
  '......bbbbbb..############..bbbbbb......',
  '......bbbbbb..#..........#..bbbbbb......',
  '......bbbbbb..#....22....#..bbbbbb......',
  '..............#..........#..............',
  '..............###......###..............',
  '.........##..................##.........',
  '.........##......bbbbbb......##=====....',
  '...====..........bb11bb........=====....',
  '...====..........bb11bb........==4==....',
  '...====..........bbSSbb........=====....',
  '...====..........bbbbbb........=====....',
  '.........##..................##=====....',
  '.........##..................##.........',
  '..............###......###..............',
  '..............#..........#..............',
  '......bbbbbb..#....33....#..bbbbbb......',
  '......bbbbbb..#..........#..bbbbbb......',
  '......bbbbbb..############..bbbbbb......',
  '......bbbbbb................bbbbbb......',
  '........................................',
];

const circle = (name: SolidName, x: number, y: number, r: number): Solid => ({ shape: 'circle', name, x, y, r });
const rect = (name: SolidName, x0: number, y0: number, x1: number, y1: number): Solid => ({ shape: 'rect', name, x0, y0, x1, y1 });
const ice = (x: number, y: number, r: number): Hazard => ({ shape: 'circle', name: 'ice', x, y, r });

const pieces: Piece[] = [];
const add = (solid: Solid, group?: string) => pieces.push({ solid, group });

// The Bell Court: eight pillars of ice round the arrival, its ways in open.
for (let i = 0; i < 8; i++) {
  const a = ((22.5 + 45 * i) * Math.PI) / 180;
  add(circle('icePillar', 4000 + Math.cos(a) * 760, 2000 + Math.sin(a) * 760, 36));
}

// The Ossuary's two pillars, and the Crypt of Kings' row of sarcophagi.
add(circle('icePillar', 3500, 900, 36));
add(circle('icePillar', 4500, 900, 36));
for (const x of [3400, 3800, 4200, 4600]) add(rect('sarcophagus', x - 70, 3465, x + 70, 3535));

// Optional pillars here and there.
add(circle('icePillar', 1700, 1300, 34), 'westPillars');
add(circle('icePillar', 1500, 2900, 34), 'westPillars');
add(circle('icePillar', 7500, 1000, 34), 'eastPillars');
add(circle('icePillar', 7500, 3300, 34), 'eastPillars');

export const CATACOMBS: MapDef = {
  id: 'catacombs',
  name: 'Rimefrost Catacombs',
  cell: 200,
  grid: GRID,
  landmarks: {
    '1': { name: 'The Bell Court', kind: 'bellcourt' },
    '2': { name: 'The Ossuary', kind: 'ossuary' },
    '3': { name: 'The Crypt of Kings', kind: 'kings' },
    '4': { name: 'The Frozen Lake', kind: 'lake' },
  },
  pieces,
  optional: { westPillars: 0.6, eastPillars: 0.6 },
  startHeading: -Math.PI / 2,
  jitter: 10,
  roster: ['rattler', 'frostArcher', 'golem', 'wraith'],
  boss: 'rimecoil',
  tip: 'Ice sheets widen your turns; icicles fall where a circle is marked',
  wallName: 'crypt',
  vent: 'icicle',
  // The Frozen Lake's shore, rounded off, and a sheet by the Crypt's door.
  hazards: [ice(6700, 1500, 190), ice(6700, 2950, 180), ice(3000, 2750, 130)],
  vents: [
    [3300, 800],
    [4700, 800],
    [3200, 3350],
    [4800, 3350],
    [2400, 1100],
    [5600, 1100],
    [2400, 3300],
    [5600, 3300],
    [1200, 3000],
    [6900, 3200],
    [800, 1200],
    [7200, 1200],
  ],
  breakables: {
    small: 'frostUrn',
    large: 'coffin',
    smallCount: 150,
    smallSeed: 6011,
    // Coffins against the boundary, in the halls' corners, flush with crypt walls, on the
    // shores and either side of the Bell Court.
    largeSlots: [
      [2800, 59],
      [5200, 59],
      [2800, 4341],
      [5200, 4341],
      [59, 1400],
      [59, 3000],
      [7941, 1400],
      [7941, 3000],
      [3033, 633],
      [4967, 633],
      [3033, 3767],
      [4967, 3767],
      [2233, 1600],
      [2233, 2800],
      [5767, 1600],
      [5767, 2800],
      [2600, 900],
      [5400, 900],
      [6000, 2200],
      [1600, 2200],
      [2800, 2100],
      [5200, 2100],
      [3800, 4033],
    ],
  },
};
