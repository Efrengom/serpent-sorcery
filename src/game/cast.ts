import { CLEAN_CAST } from './config';
import type { SigilKind } from './gesture';

/** How cleanly a sigil was drawn. Perfect and clean casts are stronger. */
export type CastTier = 'perfect' | 'clean' | 'rough';

/** Grades a recognized sigil from the recognizer's confidence, using that sigil's own thresholds. */
export function castTier(kind: SigilKind, score: number): CastTier {
  if (score >= CLEAN_CAST.perfect[kind]) return 'perfect';
  if (score >= CLEAN_CAST.clean[kind]) return 'clean';
  return 'rough';
}

export function castPower(tier: CastTier): number {
  return CLEAN_CAST.power[tier];
}

/** "+35%"-style label for the bonus, or '' for a rough cast. */
export function tierBonusLabel(tier: CastTier): string {
  const bonus = Math.round((castPower(tier) - 1) * 100);
  return bonus > 0 ? `+${bonus}%` : '';
}
