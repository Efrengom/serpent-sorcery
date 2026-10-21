import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  bindKey,
  clearKey,
  copyBindings,
  DEFAULT_BINDINGS,
  isLockedSlot,
  KEY_ACTION_NAMES,
  KEY_ACTIONS,
  keyLabel,
  primaryKeyLabel,
  RESERVED_KEY,
  unboundMoves,
  type KeyAction,
  type KeyBindings,
} from '../game/keys';
import { GAME_SPEED, type GameOptions } from '../game/options';
import { usePixelArt } from './art';

/** The player's key bindings, so hints like "Pause (Esc)" show the keys actually bound. */
export const BindingsContext = createContext<KeyBindings>(DEFAULT_BINDINGS);

export function useKeyLabel(action: KeyAction): string {
  return primaryKeyLabel(useContext(BindingsContext), action);
}

export function KeyHint({ action }: { action: KeyAction }) {
  return <kbd>{useKeyLabel(action)}</kbd>;
}

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(v: number): string;
  onChange(v: number): void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="volume-row opt-range">
      <span className="volume-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="volume-value">{format(value)}</span>
    </label>
  );
}

function Toggle({ label, hint, on, onChange, children }: { label: string; hint: string; on: boolean; onChange(on: boolean): void; children?: ReactNode }) {
  return (
    <button className={`opt-toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="opt-switch" aria-hidden="true">
        <i />
      </span>
      <span className="opt-text">
        <b>{label}</b>
        <span>{hint}</span>
      </span>
      {children}
    </button>
  );
}

/** A tiny charge lane in the chosen warning style, next to its toggle. */
function WarningPreview({ safe }: { safe: boolean }) {
  const pixel = usePixelArt();
  return (
    <svg className="warn-preview" viewBox="0 0 96 34" aria-hidden="true" shapeRendering={pixel ? 'crispEdges' : 'auto'}>
      <defs>
        <pattern id="hazard" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="#120c00" />
          <rect width="6" height="12" fill="#ffd400" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="96" height="34" fill="#2b130e" />
      {safe ? (
        <>
          <rect x="6" y="8" width="84" height="18" fill="rgba(18,12,0,0.5)" stroke="#120c00" strokeWidth="5" />
          <rect x="6" y="8" width="52" height="18" fill="url(#hazard)" />
          <rect x="6" y="8" width="84" height="18" fill="none" stroke="#ffd400" strokeWidth="2.5" />
        </>
      ) : (
        <>
          <rect x="6" y="8" width="84" height="18" fill="rgba(255,72,48,0.12)" />
          <rect x="6" y="8" width="52" height="18" fill="rgba(255,72,48,0.32)" />
          <rect x="6" y="8" width="84" height="18" fill="none" stroke="rgba(255,72,48,0.8)" strokeWidth="2" />
        </>
      )}
      <path d="M66 12 l6 5 -6 5 M78 12 l6 5 -6 5" fill="none" stroke={safe ? '#fff6c2' : 'rgba(255,200,180,0.8)'} strokeWidth="2.5" />
    </svg>
  );
}

function KeyTable({ bindings, onChange }: { bindings: KeyBindings; onChange(b: KeyBindings): void }) {
  const [listening, setListening] = useState<{ action: KeyAction; slot: 0 | 1 } | null>(null);
  const [note, setNote] = useState('Click a key to change it.');

  useEffect(() => {
    if (!listening) return;
    // Captured on the window, the first stop for any key, so it never reaches the game, the menu
    // shortcuts or the Escape-to-go-back handler.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      const { action, slot } = listening;
      if (e.code === RESERVED_KEY) {
        setNote('Cancelled.');
      } else if (e.code === 'Backspace' || e.code === 'Delete') {
        onChange(clearKey(bindings, action, slot));
        setNote(`${KEY_ACTION_NAMES[action]}: key removed.`);
      } else {
        const out = bindKey(bindings, action, slot, e.code);
        if (!out) {
          setNote(`${keyLabel(e.code)} can't be bound.`);
          return;
        }
        onChange(out.bindings);
        setNote(
          out.movedFrom
            ? `${keyLabel(e.code)} now does ${KEY_ACTION_NAMES[action]}, so ${KEY_ACTION_NAMES[out.movedFrom]} lost it.`
            : `${KEY_ACTION_NAMES[action]}: ${keyLabel(e.code)}.`,
        );
      }
      setListening(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, bindings, onChange]);

  const unbound = unboundMoves(bindings);
  return (
    <div className="keys">
      <div className="key-table" role="table" aria-label="Key bindings">
        {KEY_ACTIONS.map((action) => (
          <div key={action} className="key-row" role="row">
            <span className="key-action" role="rowheader">
              {KEY_ACTION_NAMES[action]}
            </span>
            {([0, 1] as const).map((slot) => {
              const locked = isLockedSlot(action, slot);
              const waiting = listening?.action === action && listening.slot === slot;
              const code = bindings[action][slot];
              return (
                <button
                  key={slot}
                  role="cell"
                  className={`key-btn${waiting ? ' listening' : ''}${code ? '' : ' empty'}${locked ? ' locked' : ''}`}
                  data-action={action}
                  data-slot={slot}
                  disabled={locked}
                  title={locked ? 'Esc always pauses' : 'Click, then press a key (Backspace clears, Esc cancels)'}
                  aria-label={`${KEY_ACTION_NAMES[action]}, key ${slot + 1}: ${waiting ? 'press a key' : code ? keyLabel(code) : 'none'}`}
                  onClick={() => {
                    setListening(waiting ? null : { action, slot });
                    if (!waiting) setNote(`Press a key for ${KEY_ACTION_NAMES[action]}. Backspace clears it, Esc cancels.`);
                  }}
                  onBlur={() => waiting && setListening(null)}
                >
                  {waiting ? 'Press a key…' : keyLabel(code)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="key-note" aria-live="polite">
        {unbound.length > 0 ? (
          <span className="key-warn">
            Nothing steers {unbound.map((a) => KEY_ACTION_NAMES[a].replace('Steer ', '')).join(', ')}. {note}
          </span>
        ) : (
          note
        )}
      </p>
      <button
        className="btn small"
        onClick={() => {
          onChange(copyBindings(DEFAULT_BINDINGS));
          setNote('Keys reset to WASD and arrows.');
        }}
      >
        Reset keys
      </button>
    </div>
  );
}

/** Comfort, accessibility and key settings. Used on its own screen and inside the pause menu. */
export function OptionsPanel({ options, onChange, onBack }: { options: GameOptions; onChange(patch: Partial<GameOptions>): void; onBack(): void }) {
  // Escape goes back. Captured on the document, so in the pause menu it doesn't also reach the
  // game and resume it. A waiting key button captures on the window, which comes first, so there
  // Escape only cancels the wait.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== RESERVED_KEY || e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      onBack();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onBack]);

  return (
    <div className="options-grid">
      <section className="options-section">
        <h3 className="setup-head">Comfort &amp; visibility</h3>
        <RangeRow
          label="Screen shake"
          value={Math.round(options.shake * 100)}
          min={0}
          max={100}
          step={10}
          format={(v) => (v === 0 ? 'Off' : `${v}%`)}
          onChange={(v) => onChange({ shake: v / 100 })}
        />
        <Toggle
          label="Reduce flashing"
          hint="Hit flashes, blinking and flickering lightning become steady or softer."
          on={options.reduceFlashing}
          onChange={(reduceFlashing) => onChange({ reduceFlashing })}
        />
        <Toggle
          label="Colorblind-safe warnings"
          hint="Charge lanes and aim lines become yellow-and-black hazard stripes, and every attacker shows a “!”."
          on={options.safeWarnings}
          onChange={(safeWarnings) => onChange({ safeWarnings })}
        >
          <WarningPreview safe={options.safeWarnings} />
        </Toggle>
        <RangeRow
          label="Game speed"
          value={Math.round(options.gameSpeed * 100)}
          min={GAME_SPEED.min * 100}
          max={GAME_SPEED.max * 100}
          step={GAME_SPEED.step * 100}
          format={(v) => `${v}%`}
          onChange={(v) => onChange({ gameSpeed: v / 100 })}
        />
        <p className="opt-note">
          A slower game leaves more time to draw, since drawing happens in real time. Shards and records count game time, so
          nothing is lost.
        </p>
      </section>
      <section className="options-section">
        <h3 className="setup-head">Keys</h3>
        <KeyTable bindings={options.bindings} onChange={(bindings) => onChange({ bindings })} />
        <p className="opt-note">Draw sigils with the left mouse button. Esc always pauses and goes back.</p>
      </section>
    </div>
  );
}

export function OptionsScreen({ options, onChange, onBack }: { options: GameOptions; onChange(patch: Partial<GameOptions>): void; onBack(): void }) {
  return (
    <div className="screen options">
      <h2 className="screen-title">Options</h2>
      <OptionsPanel options={options} onChange={onChange} onBack={onBack} />
      <div className="menu-buttons row">
        <button className="btn primary" onClick={onBack}>
          Back <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
