import type { SpellId } from '../game/config';
import { PixelSigil, usePixelArt } from './art';

const PATHS: Record<SpellId, string> = {
  bolt: 'M8 33 L32 9',
  lightning: 'M8 9 L20 32 L32 9',
  nova: 'M20 8 A12 12 0 1 1 19.9 8',
};

export const SPELL_UI: Record<SpellId, { color: string; shape: string; blurb: string }> = {
  bolt: { color: 'var(--cyan)', shape: 'Line', blurb: 'Fast bolt toward your target. Hits the first foe.' },
  lightning: { color: 'var(--green)', shape: 'V', blurb: 'Strikes a foe near your aim, then chains onward.' },
  nova: { color: 'var(--gold)', shape: 'Circle', blurb: 'Shockwave around the snake. Dispels enemy shots.' },
};

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
    </svg>
  );
}
