import type { BossId, EnemyKind } from './config';
import { MAP_ORDER, MAPS } from './maps';
import type { MapId } from './maps/types';

/**
 * The bestiary (D3): every foe and Archmage, by the map it haunts, with a line about how it
 * fights. The save counts how many of each the player has defeated; one never met is a mystery.
 */

export type BeastId = Exclude<EnemyKind, 'boss'> | BossId;

export interface Beast {
  name: string;
  lore: string;
  /** Its colour on the bestiary's token, and the shape on it. */
  color: string;
  glyph: string;
  boss?: boolean;
}

export const BEASTS: Record<BeastId, Beast> = {
  chaser: { name: 'Chaser', lore: 'Quick, many and mindless. Only its head bites.', color: '#ff5d7a', glyph: '●' },
  caster: { name: 'Caster', lore: 'Keeps its distance and fires arcane bolts; stone stops them.', color: '#ff8a4d', glyph: '✦' },
  brute: { name: 'Brute', lore: 'Slow and heavy. Watch for the lane it marks before it charges.', color: '#c24a4a', glyph: '■' },
  rival: { name: 'Rival Serpent', lore: 'A lesser serpent mage that coils, waits, and strikes.', color: '#b3203f', glyph: '∿' },
  ouroboros: { name: 'Archmage Ouroboros', lore: 'Master of the Sunken Ruins: volleys, charges and summons.', color: '#ffd45e', glyph: '♛', boss: true },
  sporeling: { name: 'Sporeling', lore: 'Tiny, in packs, hopping in short bursts.', color: '#5fffd0', glyph: '•' },
  puffcap: { name: 'Puffcap', lore: 'Puffs clouds of drifting spores.', color: '#ff8ae8', glyph: '✿' },
  thornback: { name: 'Thornback', lore: 'Armoured in thorns, it charges headlong.', color: '#7aa84a', glyph: '▲' },
  burrowViper: { name: 'Burrow Viper', lore: 'Tunnels under the floor and bursts up where you’ll be.', color: '#a8844a', glyph: '∿' },
  sporemaw: { name: 'Sporemaw, the Fungal Archmage', lore: 'Burrows, fans spores and calls its brood.', color: '#ff8ae8', glyph: '♛', boss: true },
  rattler: { name: 'Bone Rattler', lore: 'Falls to pieces when struck down — and rises unless finished.', color: '#e8e0c8', glyph: '☠' },
  frostArcher: { name: 'Frost Archer', lore: 'Looses icicles from afar.', color: '#bfe6ff', glyph: '➶' },
  golem: { name: 'Crypt Golem', lore: 'Slams the ground all around it.', color: '#8c9ab8', glyph: '■' },
  wraith: { name: 'Wraith', lore: 'Drifts through stone and lunges.', color: '#b8a8ff', glyph: '◌' },
  rimecoil: { name: 'Rimecoil, the Frost Archmage', lore: 'Icicles down the lines it draws, charges, and rings of ice.', color: '#bfe6ff', glyph: '♛', boss: true },
  imp: { name: 'Cinder Imp', lore: 'Leaps in bursts of flame.', color: '#ff7a2a', glyph: '▴' },
  pyromancer: { name: 'Pyromancer', lore: 'Lobs fireballs that leave the ground burning.', color: '#ffb35c', glyph: '✦' },
  magmaBrute: { name: 'Magma Brute', lore: 'Charges, and leaves a trail of lava.', color: '#d8501e', glyph: '■' },
  salamander: { name: 'Salamander', lore: 'Breathes a roaring cone of fire.', color: '#ff7a2a', glyph: '∿' },
  pyrecoil: { name: 'Pyrecoil, the Ember Archmage', lore: 'Meteors where you’re heading, and a burning charge.', color: '#ff7a2a', glyph: '♛', boss: true },
  ascendant: { name: 'Azhdaha, the Archmage Ascendant', lore: 'Every Archmage’s magic in one. The end of the first pass.', color: '#ffd45e', glyph: '✸', boss: true },
};

export const BEAST_IDS = Object.keys(BEASTS) as BeastId[];

/** The bestiary's pages: each map's four foes and its Archmage, then the Ascendant on its own. */
export function bestiaryPages(): { title: string; map: MapId | null; beasts: BeastId[] }[] {
  const pages = MAP_ORDER.map((id) => {
    const def = MAPS[id];
    return { title: def.name, map: id as MapId | null, beasts: [...def.roster, def.boss] as BeastId[] };
  });
  pages.push({ title: 'The End of the Descent', map: null, beasts: ['ascendant'] });
  return pages;
}
