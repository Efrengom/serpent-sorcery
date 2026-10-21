import { SPELL_INFO, type SpellId } from '../game/config';
import { PixelSigil, usePixelArt } from './art';

const PATHS: Record<SpellId, string> = {
  bolt: 'M8 33 L32 9',
  lightning: 'M8 9 L20 32 L32 9',
  nova: 'M20 8 A12 12 0 1 1 19.9 8',
  ward: 'M20 7 L33 31 L7 31 Z',
  frost: 'M6 12 L16 30 L24 10 L34 28',
};

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
  const pixel = usePixelArt();
  const color = SPELL_UI[spell].color;
  if (pixel) {
    return (
      <span className="sigil-px" style={{ color }}>
        <PixelSigil spell={spell} size={size} animate={animate} />
      </span>
    );
  }
  return (
    <svg
      className={`sigil-icon${animate ? ' sigil-animate' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      style={{ color }}
    >
      <path d={PATHS[spell]} pathLength={100} className="sigil-glow" />
      <path d={PATHS[spell]} pathLength={100} className="sigil-core" />
      {spell === 'nova' && <path d="M17 5 L21 8 L17 11" className="sigil-arrow" />}
      {spell === 'bolt' && <circle cx="8" cy="33" r="2.6" className="sigil-dot" />}
      {spell === 'lightning' && <circle cx="8" cy="9" r="2.6" className="sigil-dot" />}
      {spell === 'ward' && <circle cx="20" cy="7" r="2.6" className="sigil-dot" />}
      {spell === 'frost' && <circle cx="6" cy="12" r="2.6" className="sigil-dot" />}
    </svg>
  );
}
