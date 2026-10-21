import type { SpellId } from './config';
import type { RunMods } from './progression';

export type WizardId = 'arcanist' | 'frostcoil' | 'wardscale' | 'stormtongue';
export const WIZARD_IDS: WizardId[] = ['arcanist', 'frostcoil', 'wardscale', 'stormtongue'];

/** Lifetime records that unlock wizards. */
export interface UnlockRecords {
  bestTime: number;
  bestLevel: number;
  bossKills: number;
}

/** [base, lit, shade] colours for the pixel sprites. */
export type Ramp = readonly [string, string, string];

export interface WizardLook {
  /** Classic renderer colours. */
  body: string;
  bodyDark: string;
  hat: string;
  band: string;
  /** Pixel sprite ramps. */
  px: { body: Ramp; stripe: Ramp; hat: Ramp; brim: Ramp; band: Ramp };
}

export interface WizardDef {
  id: WizardId;
  name: string;
  title: string;
  /** The three sigils known at the start of a run; the others can be learned at level-up. */
  spells: SpellId[];
  perks: string[];
  mods: Partial<RunMods>;
  look: WizardLook;
  unlock: { text: string; isMet(r: UnlockRecords): boolean; progress(r: UnlockRecords): string };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const WIZARDS: Record<WizardId, WizardDef> = {
  arcanist: {
    id: 'arcanist',
    name: 'Arcanist',
    title: 'Balanced sorcerer',
    spells: ['bolt', 'lightning', 'nova'],
    perks: ['The classic trio of sigils', 'No weaknesses'],
    mods: {},
    look: {
      body: '#2fd3b5',
      bodyDark: '#127a6c',
      hat: '#8a4ee8',
      band: '#ffd45e',
      px: {
        body: ['#2fd3b5', '#a8ffe2', '#16907d'],
        stripe: ['#16907d', '#2fd3b5', '#0d5a52'],
        hat: ['#7d45dc', '#b48cff', '#4d2496'],
        brim: ['#4d2496', '#7d45dc', '#2a1058'],
        band: ['#ffd45e', '#fff3c4', '#b9761a'],
      },
    },
    unlock: { text: 'Always available', isMet: () => true, progress: () => '' },
  },
  frostcoil: {
    id: 'frostcoil',
    name: 'Frostcoil',
    title: 'Patient hunter of the cold',
    spells: ['bolt', 'frost', 'nova'],
    perks: ['Starts with Frost Field instead of Lightning', '+20% Frost Field radius'],
    mods: { frostRadiusMult: 1.2 },
    look: {
      body: '#8fd8ff',
      bodyDark: '#3a7fb8',
      hat: '#2c4fa8',
      band: '#e8f6ff',
      px: {
        body: ['#8fd8ff', '#e2f6ff', '#3a7fb8'],
        stripe: ['#3a7fb8', '#8fd8ff', '#1d3f6e'],
        hat: ['#2c4fa8', '#5f86e0', '#172a66'],
        brim: ['#172a66', '#2c4fa8', '#0c1538'],
        band: ['#e8f6ff', '#ffffff', '#8fb8d8'],
      },
    },
    unlock: {
      text: 'Survive 3:00 in a run',
      isMet: (r) => r.bestTime >= 180,
      progress: (r) => `Best: ${mmss(r.bestTime)}`,
    },
  },
  wardscale: {
    id: 'wardscale',
    name: 'Wardscale',
    title: 'Armoured warden',
    spells: ['bolt', 'ward', 'lightning'],
    perks: ['Starts with Arcane Ward instead of Nova', '+25 max health', 'Ward blocks one extra hit'],
    mods: { maxHp: 25, wardCharges: 1 },
    look: {
      body: '#a6d65a',
      bodyDark: '#4f7a22',
      hat: '#a8742c',
      band: '#fff3c4',
      px: {
        body: ['#a6d65a', '#e4ffb0', '#4f7a22'],
        stripe: ['#4f7a22', '#a6d65a', '#2c4a12'],
        hat: ['#a8742c', '#e0a858', '#5c3c14'],
        brim: ['#5c3c14', '#a8742c', '#2e1e0a'],
        band: ['#fff3c4', '#ffffff', '#c8b078'],
      },
    },
    unlock: {
      text: 'Reach level 10 in a run',
      isMet: (r) => r.bestLevel >= 10,
      progress: (r) => `Best: level ${r.bestLevel}`,
    },
  },
  stormtongue: {
    id: 'stormtongue',
    name: 'Stormtongue',
    title: 'Reckless tempest',
    spells: ['lightning', 'bolt', 'frost'],
    perks: ['Lightning, Bolt and Frost Field', '+20% spell damage, lightning chains once more', '−25 max health'],
    mods: { damageMult: 1.2, chains: 1, maxHp: -25 },
    look: {
      body: '#7d88b0',
      bodyDark: '#3a4262',
      hat: '#c02a4a',
      band: '#8cff6a',
      px: {
        body: ['#7d88b0', '#c8d0f0', '#3a4262'],
        stripe: ['#3a4262', '#7d88b0', '#1e2238'],
        hat: ['#c02a4a', '#ff6a86', '#6a1024'],
        brim: ['#6a1024', '#c02a4a', '#380814'],
        band: ['#8cff6a', '#f2ffe2', '#1f6a2a'],
      },
    },
    unlock: {
      text: 'Defeat Archmage Ouroboros',
      isMet: (r) => r.bossKills >= 1,
      progress: (r) => (r.bossKills > 0 ? '' : 'Not yet defeated'),
    },
  },
};

export function isWizardUnlocked(id: WizardId, records: UnlockRecords): boolean {
  return WIZARDS[id].unlock.isMet(records);
}

/** The wizard a run will actually use: the chosen one if unlocked, otherwise the Arcanist. */
export function playableWizard(id: WizardId, records: UnlockRecords): WizardId {
  return isWizardUnlocked(id, records) ? id : 'arcanist';
}
