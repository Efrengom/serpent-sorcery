import type { Hazard, MapDef, Piece, Solid, SolidName } from './types';

/**
 * The Mycelium Hollows: glowing fungal caverns under the ruins. The serpent arrives in the
 * Glowcap Ring, a circle of giant mushroom stalks. North of it the Spore Grotto, walled by roots
 * and open to the south, breathes spores; east grows the Heartroot, a great trunk whose roots
 * sprawl across the floor; west lies the Fallen Giant, a toppled mushroom; south, a Bramble
 * Thicket. Patches of brambles sting, and spore vents burst where a circle glows.
 *
 * Each grid character is 200×200 world units (38×21 cells, 7600×4200). `%` is brambles.
 */
const GRID = [
  '......................................',
  '......bbbbbb..............bbbbbb......',
  '......bbbbbb...########...bbbbbb......',
  '......bbbbbb...#......#...bbbbbb......',
  '......bbbbbb...#..55..#...bbbbbb......',
  '......................................',
  '...........##...........##............',
  '........................##....%%......',
  '............%%..bbbbbb................',
  '................bb11bb................',
  '..........3.....bb11bb......2.........',
  '....%%..........bbSSbb...........%%...',
  '............%%..bbbbbb................',
  '..........##..........................',
  '..........##..........................',
  '..............%%......%%.##...........',
  '..bbbbbb......%%..44..%%......bbbbbb..',
  '..bbbbbb......................bbbbbb..',
  '..bbbbbb......................bbbbbb..',
  '..bbbbbb......................bbbbbb..',
  '......................................',
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
const thorns = (x: number, y: number, r: number): Hazard => ({ shape: 'circle', name: 'bramble', x, y, r });

const pieces: Piece[] = [];
const add = (solid: Solid, group?: string) => pieces.push({ solid, group });

// The Glowcap Ring: eight giant stalks round the arrival, its ways in open.
for (let i = 0; i < 8; i++) {
  const a = ((22.5 + 45 * i) * Math.PI) / 180;
  add(circle('stalk', 3800 + Math.cos(a) * 760, 2000 + Math.sin(a) * 760, 40));
}

// The Heartroot: a great trunk with four roots sprawling from it.
add(circle('heartroot', 5700, 2100, 110));
for (const deg of [45, 135, 225, 315]) {
  const a = (deg * Math.PI) / 180;
  add(capsule('root', 5700 + Math.cos(a) * 90, 2100 + Math.sin(a) * 90, 5700 + Math.cos(a) * 470, 2100 + Math.sin(a) * 470, 30));
}

// The Fallen Giant: a toppled mushroom, its stalk on the floor and its cap at the end.
add(capsule('stalk', 1400, 2350, 2000, 2120, 50));
add(circle('cap', 2150, 2050, 170));

// Stalks inside the Spore Grotto, and optional clumps west and east.
add(circle('stalk', 3500, 900, 40));
add(circle('stalk', 4100, 900, 40));
add(circle('stalk', 1250, 1350, 36), 'westStalks');
add(circle('stalk', 1700, 1500, 36), 'westStalks');
add(circle('stalk', 1400, 1850, 36), 'westStalks');
add(circle('stalk', 6150, 2750, 36), 'eastStalks');
add(circle('stalk', 6550, 2650, 36), 'eastStalks');
add(circle('stalk', 6400, 3050, 36), 'eastStalks');

export const HOLLOWS: MapDef = {
  id: 'hollows',
  name: 'Mycelium Hollows',
  cell: 200,
  grid: GRID,
  landmarks: {
    '1': { name: 'The Glowcap Ring', kind: 'glowring' },
    '2': { name: 'The Heartroot', kind: 'heartroot' },
    '3': { name: 'The Fallen Giant', kind: 'fallen' },
    '4': { name: 'The Bramble Thicket', kind: 'thicket' },
    '5': { name: 'The Spore Grotto', kind: 'grotto' },
  },
  pieces,
  optional: { westStalks: 0.6, eastStalks: 0.6 },
  startHeading: -Math.PI / 2,
  jitter: 10,
  roster: ['sporeling', 'puffcap', 'thornback', 'burrowViper'],
  boss: 'sporemaw',
  tip: 'Brambles sting on touch; spore vents burst where a circle glows',
  wallName: 'roots',
  vent: 'spores',
  hazards: [thorns(2650, 2850, 110), thorns(5050, 2650, 100), thorns(1800, 3300, 100)],
  vents: [
    [3800, 800],
    [2900, 1500],
    [5600, 1300],
    [900, 1600],
    [6600, 1900],
    [1200, 2900],
    [2500, 3350],
    [5600, 2800],
    [6800, 2900],
    [3800, 3700],
  ],
  breakables: {
    small: 'glowcap',
    large: 'seedpod',
    smallCount: 150,
    smallSeed: 4813,
    // Seed pods against the boundary, in the Grotto's corners, flush with root knots, by the
    // Fallen Giant's cap, between the Heartroot's roots and in open ground.
    largeSlots: [
      [2900, 59],
      [4700, 59],
      [2400, 4141],
      [5200, 4141],
      [59, 1400],
      [59, 2800],
      [7541, 1400],
      [7541, 2800],
      [3233, 633],
      [4367, 633],
      [2291, 1909],
      [5700, 1650],
      [5700, 2550],
      [2433, 2800],
      [4767, 1400],
      [2400, 1433],
      [5200, 3233],
      [3400, 3700],
      [4200, 3700],
      [1000, 2000],
      [6600, 1500],
      [2700, 2100],
      [4900, 2100],
    ],
  },
};
