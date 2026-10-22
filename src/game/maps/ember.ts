import type { Hazard, MapDef, Piece, Solid, SolidName } from './types';

/**
 * The Ember Depths: volcanic caverns below the ruins. The serpent arrives in the Caldera, ringed
 * by basalt columns. A river of lava runs north to south from the Lava Falls, crossed by three
 * bridges; east of it stand the walls of an old Forge and a field of Obsidian Spires. Lava pools
 * and eruption vents dot the floor. The Forge Yard north of the Forge, courts in the west corners and
 * beside the Spires, and the Caldera are the boss clearings.
 *
 * Each grid character is 200×200 world units (36×20 cells, 7200×4000). `~` is lava.
 */
const GRID = [
  '...............~~~~~~...............',
  '.bbbbbb........~~~~~~.bbbbbb........',
  '.bbbbbb........~~~~~~.bbbbbb........',
  '.bbbbbb.........2~~2..bbbbbb........',
  '.bbbbbb..........~~...bbbbbb........',
  '......................##..##........',
  '......................#....#........',
  '.................~~.....33..........',
  '.....bbbbbb......~~.................',
  '.....bb11bb......~~...#....#........',
  '.....bb11bb......~~...##..##........',
  '.....bbSSbb......~~.................',
  '....................................',
  '.............................bbbbbb.',
  '.................~~......4...bbbbbb.',
  '....bbbbbbb......~~......4...bbbbbb.',
  '....bbbbbbb......~~..........bbbbbb.',
  '....bbbbbbb..................bbbbbb.',
  '....bbbbbbb..................bbbbbb.',
  '.................~~.................',
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
const pool = (x: number, y: number, r: number): Hazard => ({ shape: 'circle', name: 'lava', x, y, r });

const pieces: Piece[] = [];
const add = (solid: Solid, group?: string) => pieces.push({ solid, group });

// The Caldera: eight basalt columns ring the arrival, its four ways in open.
for (let i = 0; i < 8; i++) {
  const a = ((22.5 + 45 * i) * Math.PI) / 180;
  add(circle('basalt', 1600 + Math.cos(a) * 800, 2000 + Math.sin(a) * 800, 34));
}

// The Obsidian Spires: a staggered field east of the river (odd rows step west, clear of the south-east court).
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 5; col++) add(circle('spire', 4500 + col * 300 - (row % 2) * 150, 2500 + row * 333, 36));
}

// The Forge's anvil.
add(rect('anvil', 4940, 1565, 5060, 1635));

// Optional ridges of cooled lava.
add(capsule('ridge', 2100, 550, 2600, 750, 40), 'ridges');
add(capsule('ridge', 2350, 3550, 2900, 3430, 35), 'ridges');
add(circle('basalt', 6300, 1700, 40), 'eastColumns');
add(circle('basalt', 6000, 2050, 34), 'eastColumns');

export const EMBER: MapDef = {
  id: 'ember',
  name: 'Ember Depths',
  cell: 200,
  grid: GRID,
  landmarks: {
    '1': { name: 'The Caldera', kind: 'caldera' },
    '2': { name: 'The Lava Falls', kind: 'falls' },
    '3': { name: 'The Forge', kind: 'forge' },
    '4': { name: 'The Obsidian Spires', kind: 'spires' },
  },
  pieces,
  optional: { ridges: 0.6, eastColumns: 0.5 },
  startHeading: -Math.PI / 2,
  jitter: 10,
  roster: ['imp', 'pyromancer', 'magmaBrute', 'salamander'],
  boss: 'pyrecoil',
  tip: 'Lava burns on touch; vents erupt where a circle glows',
  wallName: 'cliff',
  vent: 'vent',
  hazards: [pool(2700, 3200, 160), pool(700, 2650, 140), pool(6400, 2380, 150)],
  vents: [
    [2600, 1000],
    [2650, 2000],
    [2400, 3000],
    [600, 1300],
    [4200, 1000],
    [4200, 2300],
    [6300, 400],
    [6550, 1950],
    [5850, 1500],
    [3000, 3700],
    [4300, 3750],
    [2900, 3650],
  ],
  breakables: {
    small: 'geode',
    large: 'brazier',
    smallCount: 150,
    smallSeed: 2718,
    // Braziers in the Forge's corners, flush against the boundary, and in open ground by the Caldera and the river.
    largeSlots: [
      [4633, 1233],
      [5367, 1233],
      [4633, 1967],
      [5367, 1967],
      [1700, 59],
      [2600, 59],
      [4300, 59],
      [5700, 59],
      [1800, 3941],
      [2700, 3941],
      [4300, 3941],
      [5300, 3941],
      [59, 1300],
      [59, 2700],
      [7141, 1400],
      [7141, 2700],
      [2700, 1500],
      [600, 2000],
      [6200, 1900],
      [4100, 3300],
      [3200, 2200],
    ],
  },
};
