import { useEffect, useState, type ComponentProps, type CSSProperties } from 'react';
import { SPELLS, type SpellId } from '../game/config';
import { formatTime } from '../game/math';
import type { CommitOutcome, RunResult } from '../game/persistence';
import type { UpgradeChoice } from '../game/progression';
import { describeHurt, worstHurt, type RunRecap } from '../game/recap';
import { Shard, UpgradeGlyph } from './art';
import { SigilIcon, SPELL_UI } from './SigilIcon';
import { VolumeControls } from './VolumeControls';

/** Prevents a click that was already in flight from instantly choosing a card. */
function useArmed(delayMs: number, key: unknown): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    const t = window.setTimeout(() => setArmed(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs, key]);
  return armed;
}

export function LevelUpPanel({
  level,
  choices,
  onChoose,
}: {
  level: number;
  choices: UpgradeChoice[];
  onChoose(choice: UpgradeChoice): void;
}) {
  const armed = useArmed(450, choices);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!armed) return;
      const i = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code) % 3;
      if (i >= 0 && choices[i]) onChoose(choices[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed, choices, onChoose]);

  return (
    <div className="overlay levelup">
      <div className="overlay-inner wide">
        <p className="eyebrow">Your serpent grows longer</p>
        <h2 className="overlay-title gold">Level {level}</h2>
        <p className="overlay-sub">Choose a rune to inscribe</p>
        <div className={`cards${armed ? ' armed' : ''}`}>
          {choices.map((c, i) => (
            <button key={`${c.id}-${i}`} className="upgrade-card" disabled={!armed} onClick={() => onChoose(c)}>
              <span className="card-key">{i + 1}</span>
              <UpgradeGlyph id={c.id} glyph={c.glyph} />
              <span className="card-name">{c.name}</span>
              <span className="card-level">
                {c.id === 'restore' ? 'Bonus' : c.nextLevel === 1 ? `New · max ${c.maxLevel}` : `Lv ${c.nextLevel - 1} → ${c.nextLevel} / ${c.maxLevel}`}
              </span>
              <span className="card-pips">
                {c.id !== 'restore' &&
                  Array.from({ length: c.maxLevel }, (_, k) => (
                    <i key={k} className={k < c.nextLevel - 1 ? 'on' : k === c.nextLevel - 1 ? 'next' : ''} />
                  ))}
              </span>
              <span className="card-desc">{c.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PauseMenu({
  pixelArt,
  onResume,
  onEndRun,
  onToggleArt,
  volume,
}: {
  pixelArt: boolean;
  onResume(): void;
  onEndRun(): void;
  onToggleArt(): void;
  volume: ComponentProps<typeof VolumeControls>;
}) {
  return (
    <div className="overlay">
      <div className="overlay-inner">
        <h2 className="overlay-title">Paused</h2>
        <p className="overlay-sub">The ruins hold their breath.</p>
        <div className="menu-buttons">
          <button className="btn primary" onClick={onResume} autoFocus>
            Resume <kbd>Esc</kbd>
          </button>
          <VolumeControls {...volume} />
          <button className="btn" onClick={onToggleArt}>
            Art: {pixelArt ? 'Pixel' : 'Classic'} <kbd>P</kbd>
          </button>
          <button className="btn danger" onClick={onEndRun}>
            End run &amp; bank shards
          </button>
        </div>
        <ul className="mini-help">
          <li>
            <b>WASD</b> steer — the serpent never stops
          </li>
          <li>
            <b>Hold left mouse</b> draw a sigil, release to cast
          </li>
          <li>
            <b>Where you press</b> is where Bolt and Lightning aim
          </li>
        </ul>
      </div>
    </div>
  );
}

const SPELL_ORDER: SpellId[] = ['bolt', 'lightning', 'nova'];

/** What ended the run, and how much each spell contributed. */
function RunRecapView({ recap }: { recap: RunRecap }) {
  const total = SPELL_ORDER.reduce((sum, id) => sum + recap.spells[id].damage, 0);
  const worst = worstHurt(recap);
  return (
    <div className="recap">
      <p className="recap-cause">
        {recap.killedBy ? (
          <>
            Slain by <b>{describeHurt(recap.killedBy)}</b>
          </>
        ) : (
          'You ended the run'
        )}
      </p>
      <div className="recap-spells">
        {SPELL_ORDER.map((id) => {
          const s = recap.spells[id];
          const style = {
            '--spell': SPELL_UI[id].color,
            '--share': `${total > 0 ? (s.damage / total) * 100 : 0}%`,
          } as CSSProperties;
          return (
            <div key={id} className="recap-row" style={style}>
              <SigilIcon spell={id} size={26} />
              <span className="recap-name">
                {SPELLS[id].name}
                <span className="recap-sub">
                  {s.kills} {s.kills === 1 ? 'kill' : 'kills'} · {s.casts} {s.casts === 1 ? 'cast' : 'casts'}
                </span>
              </span>
              <span className="recap-bar">
                <i />
              </span>
              <span className="recap-num" title="Damage dealt">
                {Math.round(s.damage).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
      {worst && (
        <p className="recap-taken">
          Hurt most by {describeHurt(worst.key)} · {worst.amount} damage
        </p>
      )}
    </div>
  );
}

export function GameOverPanel({
  result,
  outcome,
  totalCurrency,
  onRestart,
  onShop,
  onTitle,
}: {
  result: RunResult;
  outcome: CommitOutcome;
  totalCurrency: number;
  onRestart(): void;
  onShop(): void;
  onTitle(): void;
}) {
  const armed = useArmed(600, result.runId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!armed) return;
      if (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onRestart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed, onRestart]);

  return (
    <div className="overlay gameover">
      <div className="overlay-inner">
        <p className="eyebrow">The serpent sheds its final skin</p>
        <h2 className="overlay-title">Run Over</h2>
        <div className="stats">
          <div className="stat">
            <span className="stat-label">Survived</span>
            <span className="stat-value">{formatTime(result.time)}</span>
            {outcome.newBestTime && <span className="stat-badge">New best!</span>}
          </div>
          <div className="stat">
            <span className="stat-label">Defeated</span>
            <span className="stat-value">{result.kills}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Level</span>
            <span className="stat-value">{result.level}</span>
          </div>
          {result.bossKills > 0 && (
            <div className="stat">
              <span className="stat-label">Archmages</span>
              <span className="stat-value">{result.bossKills}</span>
            </div>
          )}
        </div>
        {result.recap && <RunRecapView recap={result.recap} />}
        <div className="reward">
          <span className="reward-gain">
            +{result.reward} <Shard scale={4} />
          </span>
          <span className="reward-total">Arcane Shards · {totalCurrency} total</span>
        </div>
        <div className="menu-buttons row">
          <button className="btn primary" onClick={onRestart} disabled={!armed}>
            Play again <kbd>R</kbd>
          </button>
          <button className="btn" onClick={onShop} disabled={!armed}>
            Upgrades
          </button>
          <button className="btn" onClick={onTitle} disabled={!armed}>
            Title
          </button>
        </div>
      </div>
    </div>
  );
}
