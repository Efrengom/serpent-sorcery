import type { WizardId } from './wizards';

/**
 * The ultimates' names, descriptions and tuning, apart from the code that casts them, so the menus
 * can name them without loading the run (ultimates.ts re-exports all of this).
 */

export type UltimateId = 'starfall' | 'absoluteZero' | 'bastion' | 'maelstrom';

export const ULTIMATES = {
  starfall: {
    wizard: 'arcanist',
    name: 'Starfall',
    description: 'For 3 s, 36 stars fall on foes in view (elites and the boss first), each bursting for heavy damage.',
    color: '#ffd45e',
    cooldown: 75,
    duration: 3,
    stars: 36,
    /** Seconds a star takes to fall, its burst radius, and its damage: flat plus a share of a foe's max health. */
    fall: 0.4,
    radius: 75,
    damage: 60,
    share: 0.12,
  },
  absoluteZero: {
    wizard: 'frostcoil',
    name: 'Absolute Zero',
    description: 'Every foe in view freezes solid for 4 s (a boss slows to 40%), takes heavy damage, and frozen foes take 50% more. Shots in view shatter.',
    color: '#bfe6ff',
    cooldown: 80,
    duration: 4,
    damage: 40,
    share: 0.1,
    brittle: 1.5,
    bossSlow: 0.4,
  },
  bastion: {
    wizard: 'wardscale',
    name: 'Bastion',
    description: 'For 6 s nothing can hurt you, not even stone. Heals 35% of max health, and foes touching your body are burned and shoved away.',
    color: '#ffe08a',
    cooldown: 75,
    duration: 6,
    heal: 0.35,
    /** Seconds between burns, and each burn's damage: flat plus a share of a foe's max health. */
    tick: 0.4,
    damage: 30,
    share: 0.03,
    shove: 320,
  },
  maelstrom: {
    wizard: 'stormtongue',
    name: 'Maelstrom',
    description: 'For 6 s a storm around your head strikes a foe every 0.2 s, chaining to 2 more.',
    color: '#8cff6a',
    cooldown: 70,
    duration: 6,
    radius: 420,
    every: 0.2,
    damage: 45,
    share: 0.04,
    chains: 2,
  },
} as const satisfies Record<UltimateId, { wizard: WizardId; name: string; description: string; color: string; cooldown: number; duration: number; [tuning: string]: unknown }>;

export const ULTIMATE_IDS = Object.keys(ULTIMATES) as UltimateId[];

export function ultimateFor(wizard: WizardId): UltimateId {
  return ULTIMATE_IDS.find((id) => ULTIMATES[id].wizard === wizard)!;
}
