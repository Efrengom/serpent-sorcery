import { BEAST_IDS } from './bestiary';
import { HEAT } from './config';
import type { RunResult, SaveData } from './persistence';
import { WIZARD_IDS } from './wizards';

/**
 * Achievements (D2): milestones across runs and feats within one, each paying a few shards the
 * first time. They are checked when a run is banked, against the records it has just updated.
 */

type Records = SaveData['records'];

export interface AchievementDef {
  name: string;
  description: string;
  /** Shards paid when it is earned. */
  reward: number;
  earned(records: Records, run: RunResult): boolean;
  /** How far along a lifetime goal is, for the Hall of Records ("312 / 500"). */
  progress?(records: Records): string;
}

/** Time a win must beat for Swift Ascent: four Archmages at five minutes apiece and little to spare. */
const SWIFT_WIN = 26 * 60;

export const ACHIEVEMENTS = {
  firstBlood: {
    name: 'First Archmage',
    description: 'Defeat an Archmage.',
    reward: 25,
    earned: (r) => r.bossKills >= 1,
  },
  intoTheDepths: {
    name: 'Into the Depths',
    description: 'Reach Depth 3, the Rimefrost Catacombs.',
    reward: 40,
    earned: (r) => r.deepest >= 3,
  },
  throughFire: {
    name: 'Through the Fire',
    description: 'Reach the Ember Depths.',
    reward: 60,
    earned: (r) => r.maps.includes('ember'),
  },
  ascendant: {
    name: 'The Archmage Now',
    description: 'Defeat Azhdaha, the Archmage Ascendant, and win a run.',
    reward: 150,
    earned: (r) => r.wins >= 1,
  },
  fourCrowns: {
    name: 'Four Crowns',
    description: 'Win a run with every wizard.',
    reward: 300,
    earned: (r) => WIZARD_IDS.every((id) => r.winners.includes(id)),
    progress: (r) => `${r.winners.length} / ${WIZARD_IDS.length}`,
  },
  swiftAscent: {
    name: 'Swift Ascent',
    description: 'Win a run in under 26 minutes.',
    reward: 120,
    earned: (r) => r.fastestWin > 0 && r.fastestWin < SWIFT_WIN,
  },
  beyond: {
    name: 'Beyond the Ascent',
    description: 'Play on after a win and reach Depth 6.',
    reward: 120,
    earned: (r) => r.wins >= 1 && r.deepest >= 6,
  },
  cursedCrown: {
    name: 'Cursed Crown',
    description: 'Win a run with three or more curses.',
    reward: 150,
    earned: (_r, run) => !!run.won && (run.curses?.length ?? 0) >= 3,
  },
  trialByFire: {
    name: 'Trial by Fire',
    description: 'Win, or reach the loop, at Heat 5.',
    reward: 120,
    earned: (r) => r.heatCleared >= 5,
  },
  whiteHot: {
    name: 'White Hot',
    description: `Win, or reach the loop, at Heat ${HEAT.max}.`,
    reward: 300,
    earned: (r) => r.heatCleared >= HEAT.max,
  },
  calligrapher: {
    name: 'Calligrapher',
    description: 'Draw 50 Perfect sigils in one run.',
    reward: 60,
    earned: (_r, run) => (run.recap?.casts.perfect ?? 0) >= 50,
  },
  constrictor: {
    name: 'Constrictor',
    description: 'Crush 25 foes in your coils in one run.',
    reward: 60,
    earned: (_r, run) => (run.recap?.spells.constrict.kills ?? 0) >= 25,
  },
  hoarder: {
    name: 'Hoarder',
    description: 'Carry six relics at once.',
    reward: 60,
    earned: (_r, run) => (run.relics?.length ?? 0) >= 6,
  },
  pactMaker: {
    name: 'Pact Maker',
    description: 'Make three pacts at shrines in one run.',
    reward: 50,
    earned: (_r, run) => (run.recap?.pacts ?? 0) >= 3,
  },
  riftwalker: {
    name: 'Riftwalker',
    description: 'Win 5 rifts.',
    reward: 60,
    earned: (r) => r.rifts >= 5,
    progress: (r) => `${Math.min(5, r.rifts)} / 5`,
  },
  patron: {
    name: 'Patron',
    description: 'Buy 10 wares from merchants.',
    reward: 40,
    earned: (r) => r.bought >= 10,
    progress: (r) => `${Math.min(10, r.bought)} / 10`,
  },
  smasher: {
    name: 'Smasher',
    description: 'Smash 500 urns and reliquaries.',
    reward: 40,
    earned: (r) => r.breakables >= 500,
    progress: (r) => `${Math.min(500, r.breakables)} / 500`,
  },
  slayer: {
    name: 'Slayer',
    description: 'Defeat 10,000 foes.',
    reward: 80,
    earned: (r) => r.totalKills >= 10000,
    progress: (r) => `${Math.min(10000, r.totalKills).toLocaleString()} / 10,000`,
  },
  naturalist: {
    name: 'Naturalist',
    description: 'Defeat every kind of foe and Archmage in the bestiary.',
    reward: 120,
    earned: (r) => BEAST_IDS.every((id) => (r.bestiary[id] ?? 0) > 0),
    progress: (r) => `${BEAST_IDS.filter((id) => (r.bestiary[id] ?? 0) > 0).length} / ${BEAST_IDS.length}`,
  },
  devotion: {
    name: 'Daily Devotion',
    description: 'Play the daily run three days in a row.',
    reward: 60,
    earned: (r) => r.dailyStreak >= 3,
    progress: (r) => `${Math.min(3, r.dailyStreak)} / 3`,
  },
} satisfies Record<string, AchievementDef>;

export type AchievementId = keyof typeof ACHIEVEMENTS;
export const ACHIEVEMENT_IDS = Object.keys(ACHIEVEMENTS) as AchievementId[];

/** Achievements this run has just earned, given the records after it and those already held. */
export function newAchievements(records: Records, run: RunResult, held: readonly AchievementId[]): AchievementId[] {
  return ACHIEVEMENT_IDS.filter((id) => !held.includes(id) && (ACHIEVEMENTS[id] as AchievementDef).earned(records, run));
}
