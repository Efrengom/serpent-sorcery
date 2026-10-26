import { SPELL_INFO, type SpellId } from '../game/config';
import { PixelSigil } from './art';

const SPELL_COLOR: Record<SpellId, string> = {
  bolt: 'var(--cyan)',
  lightning: 'var(--green)',
  nova: 'var(--gold)',
  ward: 'var(--ward)',
  frost: 'var(--ice)',
};

export const SPELL_UI: Record<SpellId, { color: string; shape: string; blurb: string }> = Object.fromEntries(
  (Object.keys(SPELL_COLOR) as SpellId[]).map((id) => [id, { color: SPELL_COLOR[id], ...SPELL_INFO[id] }]),
) as Record<SpellId, { color: string; shape: string; blurb: string }>;

/** Sample sigil drawing. `animate` replays the stroke like a hand drawing it. */
export function SigilIcon({ spell, size = 40, animate = false }: { spell: SpellId; size?: number; animate?: boolean }) {
  return (
    <span className="sigil-px" style={{ color: SPELL_UI[spell].color }}>
      <PixelSigil spell={spell} size={size} animate={animate} />
    </span>
  );
}
