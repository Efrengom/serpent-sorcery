import { useCallback, useContext, useEffect, useState, type ComponentProps, type CSSProperties } from 'react';
import { HEAT, SPELL_IDS, SPELLS, type SpellId } from '../game/config';
import { MOVE_ACTIONS, primaryKeyLabel } from '../game/keys';
import { formatTime } from '../game/math';
import type { GameOptions } from '../game/options';
import type { CommitOutcome, RunResult } from '../game/persistence';
import type { LevelUpOffer, RelicOffer } from '../game/engine';
import { MAPS } from '../game/maps';
import { RELICS, type RelicId } from '../game/relics';
import { ULTIMATES, ultimateFor } from '../game/ultimates';
import { canBanish, type UpgradeChoice } from '../game/progression';
import { describeHurt, worstHurt, type RunRecap } from '../game/recap';
import { CoilIcon, RelicIcon, Shard, UpgradeGlyph } from './art';
import { BindingsContext, KeyHint, OptionsPanel } from './Options';
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

const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const NUMPAD = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'];

/** The small line under a card's name saying what kind of card it is. */
function cardKind(c: UpgradeChoice): string {
  switch (c.kind) {
    case 'restore':
      return 'Bonus';
    case 'learn':
      return `New sigil · ${SPELL_UI[c.spell!].shape}`;
    case 'evolve':
      return 'Evolution';
    case 'aspect':
      return `Aspect of ${SPELLS[c.spell!].name}`;
    case 'duo':
      return 'Duo evolution';
    case 'overcharge':
      return `Overcharge · rank ${c.nextLevel}`;
    default:
      return c.nextLevel === 1 ? `New · max ${c.maxLevel}` : `Lv ${c.nextLevel - 1} → ${c.nextLevel} / ${c.maxLevel}`;
  }
}

export function LevelUpPanel({
  offer,
  onChoose,
  onReroll,
  onBanish,
  onSkip,
  onAutoDraft,
}: {
  offer: LevelUpOffer;
  onChoose(choice: UpgradeChoice): void;
  onReroll(): void;
  onBanish(choice: UpgradeChoice): void;
  onSkip(): void;
  onAutoDraft(): void;
}) {
  const { level, choices, rerolls, banishes, draft } = offer;
  const armed = useArmed(450, choices);
  // Banish mode: the next card picked is banished instead of taken.
  const [banishing, setBanishing] = useState(false);
  useEffect(() => setBanishing(false), [choices]);
  const pick = useCallback(
    (c: UpgradeChoice) => {
      if (!banishing) onChoose(c);
      else if (canBanish(c)) onBanish(c);
    },
    [banishing, onChoose, onBanish],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!armed || e.repeat) return;
      const i = Math.max(DIGITS.indexOf(e.code), NUMPAD.indexOf(e.code));
      if (i >= 0 && choices[i]) pick(choices[i]);
      else if (e.code === 'KeyR' && rerolls > 0) onReroll();
      else if (e.code === 'KeyB' && banishes > 0) setBanishing((b) => !b);
      else if (e.code === 'KeyX') onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed, choices, pick, rerolls, banishes, onReroll, onSkip]);

  return (
    <div className="overlay levelup">
      <div className="overlay-inner wide">
        <p className="eyebrow">{draft ? `Waystone draft · ${draft.n} of ${draft.total}` : 'Your serpent grows longer'}</p>
        <h2 className="overlay-title gold">Level {level}</h2>
        <p className="overlay-sub">{banishing ? 'Pick a card to banish for the rest of the run' : 'Choose a rune to inscribe'}</p>
        <div className={`cards${armed ? ' armed' : ''}${banishing ? ' banishing' : ''}`} style={{ '--cols': choices.length } as CSSProperties}>
          {choices.map((c, i) => (
            <button
              key={`${c.id}-${i}`}
              className={`upgrade-card ${c.kind}`}
              data-card={c.id}
              style={c.spell ? ({ '--spell': SPELL_UI[c.spell].color } as CSSProperties) : undefined}
              disabled={!armed || (banishing && !canBanish(c))}
              onClick={() => pick(c)}
            >
              <span className="card-key">{i + 1}</span>
              {c.pair ? (
                <span className="card-pair">
                  <SigilIcon spell={c.pair[0]} size={40} />
                  <SigilIcon spell={c.pair[1]} size={40} />
                </span>
              ) : c.spell ? (
                <SigilIcon spell={c.spell} size={48} />
              ) : (
                <UpgradeGlyph id={c.id} glyph={c.glyph} />
              )}
              <span className="card-name">{c.name}</span>
              <span className="card-level">{cardKind(c)}</span>
              <span className="card-pips">
                {c.kind === 'upgrade' &&
                  Array.from({ length: c.maxLevel }, (_, k) => (
                    <i key={k} className={k < c.nextLevel - 1 ? 'on' : k === c.nextLevel - 1 ? 'next' : ''} />
                  ))}
              </span>
              <span className="card-desc">{c.description}</span>
            </button>
          ))}
        </div>
        <div className="level-tools">
          <button className="btn small" data-tool="reroll" disabled={!armed || rerolls <= 0} onClick={onReroll}>
            Reroll · {rerolls} <kbd>R</kbd>
          </button>
          <button
            className={`btn small${banishing ? ' on' : ''}`}
            data-tool="banish"
            aria-pressed={banishing}
            disabled={!armed || banishes <= 0}
            onClick={() => setBanishing((b) => !b)}
          >
            {banishing ? 'Cancel banish' : `Banish · ${banishes}`} <kbd>B</kbd>
          </button>
          <button className="btn small" data-tool="skip" disabled={!armed} onClick={onSkip}>
            Skip · heal 10% <kbd>X</kbd>
          </button>
          {draft && (
            <button className="btn small" data-tool="auto" disabled={!armed} onClick={onAutoDraft}>
              Auto-pick the rest
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The threshold of the way down: one relic to carry deeper, or leave them and heal. */
export function RelicPanel({ offer, onChoose }: { offer: RelicOffer; onChoose(relic: RelicId | null): void }) {
  const { relics, nextMap, depth, draft } = offer;
  const armed = useArmed(500, relics);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!armed || e.repeat) return;
      const i = Math.max(DIGITS.indexOf(e.code), NUMPAD.indexOf(e.code));
      if (i >= 0 && relics[i]) onChoose(relics[i]);
      else if (e.code === 'KeyX') onChoose(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed, relics, onChoose]);
  return (
    <div className="overlay relic-offer">
      <div className="overlay-inner wide">
        <p className="eyebrow">{draft ? `Waystone · relic ${draft.n} of ${draft.total}` : 'On the threshold of the way down'}</p>
        <h2 className="overlay-title gold">Choose a relic</h2>
        <p className="overlay-sub">
          Carry one {draft ? 'into' : 'to'} Depth {depth}: {nextMap}
        </p>
        <div className={`cards${armed ? ' armed' : ''}`} style={{ '--cols': relics.length } as CSSProperties}>
          {relics.map((id, i) => {
            const r = RELICS[id];
            return (
              <button key={id} className="upgrade-card relic" data-relic={id} style={{ '--spell': r.color } as CSSProperties} disabled={!armed} onClick={() => onChoose(id)}>
                <span className="card-key">{i + 1}</span>
                <RelicIcon id={id} size={52} />
                <span className="card-name">{r.name}</span>
                <span className="card-level">{r.map ? `Relic of the ${MAPS[r.map].name}` : 'Relic'}</span>
                <span className="card-desc">{r.description}</span>
              </button>
            );
          })}
        </div>
        <div className="level-tools">
          <button className="btn small" data-tool="leave" disabled={!armed} onClick={() => onChoose(null)}>
            {draft ? 'Take none' : 'Leave them · heal 40%'} <kbd>X</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

/** The relics a run carries, with what each does. */
export function RelicList({ relics }: { relics: RelicId[] }) {
  if (relics.length === 0) return null;
  return (
    <ul className="relic-list">
      {relics.map((id) => (
        <li key={id} data-relic={id}>
          <RelicIcon id={id} size={22} />
          <span>
            <b>{RELICS[id].name}</b> {RELICS[id].description}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PauseMenu({
  pixelArt,
  relics,
  onResume,
  onEndRun,
  onToggleArt,
  options,
  onOptions,
  volume,
}: {
  pixelArt: boolean;
  relics: RelicId[];
  onResume(): void;
  onEndRun(): void;
  onToggleArt(): void;
  options: GameOptions;
  onOptions(patch: Partial<GameOptions>): void;
  volume: ComponentProps<typeof VolumeControls>;
}) {
  const [showOptions, setShowOptions] = useState(false);
  const closeOptions = useCallback(() => setShowOptions(false), []);
  const bindings = useContext(BindingsContext);
  const steer = MOVE_ACTIONS.map((a) => primaryKeyLabel(bindings, a)).join(' ');
  if (showOptions) {
    return (
      <div className="overlay">
        <div className="overlay-inner wide options-overlay">
          <h2 className="overlay-title">Options</h2>
          <OptionsPanel options={options} onChange={onOptions} onBack={closeOptions} />
          <button className="btn primary" onClick={closeOptions} autoFocus>
            Back to pause <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="overlay">
      <div className="overlay-inner">
        <h2 className="overlay-title">Paused</h2>
        <p className="overlay-sub">The depths hold their breath.</p>
        <div className="menu-buttons">
          <button className="btn primary" onClick={onResume} autoFocus>
            Resume <KeyHint action="pause" />
          </button>
          <VolumeControls {...volume} />
          <div className="menu-pair">
            <button className="btn" onClick={onToggleArt}>
              Art: {pixelArt ? 'Pixel' : 'Classic'} <KeyHint action="art" />
            </button>
            <button className="btn" onClick={() => setShowOptions(true)}>
              Options
            </button>
          </div>
          <button className="btn danger" onClick={onEndRun}>
            End run &amp; bank shards
          </button>
        </div>
        <RelicList relics={relics} />
        <ul className="mini-help">
          <li>
            <b>{steer}</b> steer — the serpent never stops
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

/** What ended the run, and how much each spell contributed. */
function RunRecapView({ recap, ultimate }: { recap: RunRecap; ultimate: string }) {
  // Damage from lava, vents and the like isn't yours, so it gets a line below rather than a row.
  const used: (SpellId | 'constrict' | 'ultimate')[] = SPELL_IDS.filter((id) => recap.spells[id].casts > 0);
  const rows: (SpellId | 'constrict' | 'ultimate')[] = used.length > 0 ? used : SPELL_IDS.slice(0, 3);
  if (recap.spells.constrict.casts > 0) rows.push('constrict');
  if (recap.spells.ultimate?.casts > 0) rows.push('ultimate');
  const total = rows.reduce((sum, id) => sum + recap.spells[id].damage, 0);
  const worst = worstHurt(recap);
  const { perfect, clean, rough } = recap.casts;
  const sigils = perfect + clean + rough;
  const extras = [
    sigils > 0 && `Sigils: ${perfect} perfect · ${clean} clean of ${sigils}`,
    recap.blocked > 0 && `Ward blocked ${recap.blocked} ${recap.blocked === 1 ? 'hit' : 'hits'}`,
    recap.depth > 1 && `Reached Depth ${recap.depth}: the ${recap.map}`,
    recap.elitesSlain > 0 && `${recap.elitesSlain} ${recap.elitesSlain === 1 ? 'elite' : 'elites'} slain`,
    recap.breakables > 0 && `${recap.breakables} ${recap.breakables === 1 ? 'container' : 'containers'} smashed`,
    recap.spells.hazard.kills > 0 && `${recap.spells.hazard.kills} ${recap.spells.hazard.kills === 1 ? 'foe' : 'foes'} fell to lava and fire`,
    recap.healed > 0 && `${Math.round(recap.healed)} health from pickups`,
    recap.buffs > 0 && `${recap.buffs} ${recap.buffs === 1 ? 'buff' : 'buffs'} collected`,
  ].filter(Boolean);
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
        {rows.map((id) => {
          const s = recap.spells[id];
          const coil = id === 'constrict';
          if (id === 'ultimate') {
            return (
              <div key={id} className="recap-row" style={{ '--spell': 'var(--gold)', '--share': `${total > 0 ? (s.damage / total) * 100 : 0}%` } as CSSProperties} data-source={id}>
                <span className="recap-ult" aria-hidden="true">
                  ✸
                </span>
                <span className="recap-name">
                  {ultimate}
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
          }
          const style = {
            '--spell': coil ? 'var(--coil)' : SPELL_UI[id].color,
            '--share': `${total > 0 ? (s.damage / total) * 100 : 0}%`,
          } as CSSProperties;
          return (
            <div key={id} className="recap-row" style={style} data-source={id}>
              {coil ? <CoilIcon size={26} /> : <SigilIcon spell={id} size={26} />}
              <span className="recap-name">
                {coil ? 'Constrict' : SPELLS[id].name}
                <span className="recap-sub">
                  {s.kills} {s.kills === 1 ? 'kill' : 'kills'} · {s.casts} {coil ? (s.casts === 1 ? 'loop' : 'loops') : s.casts === 1 ? 'cast' : 'casts'}
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
      {extras.length > 0 && <p className="recap-taken">{extras.join(' · ')}</p>}
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
          {(result.recap?.depth ?? 1) > 1 && (
            <div className="stat">
              <span className="stat-label">Depth</span>
              <span className="stat-value">{result.recap!.depth}</span>
            </div>
          )}
        </div>
        {result.recap && <RunRecapView recap={result.recap} ultimate={ULTIMATES[ultimateFor(result.wizard ?? 'arcanist')].name} />}
        {result.relics && result.relics.length > 0 && (
          <p className="recap-relics" title="Relics carried">
            {result.relics.map((id) => (
              <span key={id} title={RELICS[id].name}>
                <RelicIcon id={id} size={20} />
              </span>
            ))}
          </p>
        )}
        <div className="reward">
          <span className="reward-gain">
            +{result.reward} <Shard scale={4} />
          </span>
          <span className="reward-total">
            Arcane Shards{(result.shardMult ?? 1) > 1 && ` · ×${result.shardMult!.toFixed(2)} from curses`}
            {(result.heat ?? 0) > 0 && ` · ×${(1 + HEAT.shards * result.heat!).toFixed(2)} from heat ${result.heat}`} · {totalCurrency} total
            {result.gameSpeed && ` · played at ${Math.round(result.gameSpeed * 100)}% speed`}
          </span>
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
