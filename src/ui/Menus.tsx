import { useContext, useEffect, type ComponentProps } from 'react';
import { SPELL_IDS, SPELLS } from '../game/config';
import { CURSE_IDS, CURSES, shardMultiplier, type CurseId } from '../game/curses';
import { MOVE_ACTIONS, primaryKeyLabel } from '../game/keys';
import { formatTime } from '../game/math';
import type { SaveData } from '../game/persistence';
import { META_IDS, META_UPGRADES, metaMaxLevel, metaNextCost, type MetaId } from '../game/progression';
import { isWizardUnlocked, playableWizard, WIZARD_IDS, WIZARDS, type WizardId } from '../game/wizards';
import { PixelIcon, PixelTitleSerpent, Shard, UpgradeGlyph, usePixelArt, WizardPortrait } from './art';
import { BindingsContext, KeyHint, useKeyLabel } from './Options';
import { SigilIcon, SPELL_UI } from './SigilIcon';
import { VolumeControls } from './VolumeControls';

function useKey(code: string[], handler: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (code.includes(e.code) && !e.repeat) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [code, handler]);
}

const ENTER = ['Enter', 'Space'];
const BACK = ['Escape'];

function TitleSerpent({ wizard }: { wizard: WizardId }) {
  const look = WIZARDS[wizard].look;
  return (
    <svg className="title-serpent" viewBox="0 0 520 150" aria-hidden="true">
      <defs>
        <linearGradient id="body" x1="0" x2="1">
          <stop offset="0" stopColor={look.bodyDark} />
          <stop offset="1" stopColor={look.body} />
        </linearGradient>
      </defs>
      <path
        className="serpent-body"
        d="M20 110 C 90 40, 150 140, 220 90 S 340 30, 400 85"
        stroke="url(#body)"
        strokeWidth="22"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx="420" cy="92" rx="26" ry="20" fill={look.body} stroke="#140a24" strokeWidth="4" />
      <circle cx="430" cy="84" r="5" fill="#fff" />
      <circle cx="432" cy="84" r="2.5" fill="#140a24" />
      <path d="M445 98 l14 2 l6 -4 m-6 4 l6 5" stroke="#ff4f7b" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path className="serpent-hat" d="M392 76 Q 400 12, 470 6 Q 432 34, 444 74 Z" fill={look.hat} stroke="#140a24" strokeWidth="4" />
      <ellipse cx="418" cy="76" rx="36" ry="9" fill={look.hat} stroke="#140a24" strokeWidth="4" />
      <path d="M398 66 L 440 62" stroke={look.band} strokeWidth="5" />
      <path className="hat-star" d="M470 6 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1z" fill={look.band} />
    </svg>
  );
}

export function TitleScreen({
  save,
  onPlay,
  onSetup,
  onHowTo,
  onShop,
  onOptions,
  onPractice,
  onToggleMute,
  onToggleArt,
  volume,
}: {
  save: SaveData;
  onPlay(): void;
  onSetup(): void;
  onHowTo(): void;
  onShop(): void;
  onOptions(): void;
  onPractice(): void;
  onToggleMute(): void;
  onToggleArt(): void;
  volume: ComponentProps<typeof VolumeControls>;
}) {
  useKey(ENTER, onPlay);
  const pixel = usePixelArt();
  const firstTime = save.records.totalRuns === 0;
  const wizard = playableWizard(save.settings.wizard, save.records);
  const curses = save.settings.curses;
  const muteKey = useKeyLabel('mute');
  return (
    <div className="screen title-screen">
      <div className="runes-bg" aria-hidden="true" />
      <div className="title-wrap">
        {pixel ? <PixelTitleSerpent wizard={wizard} /> : <TitleSerpent wizard={wizard} />}
        <h1 className="game-title">Serpent Sorcery</h1>
        <p className="tagline">One hand steers the serpent. The other draws the spells.</p>
        <div className="menu-buttons">
          <button className="btn primary big" onClick={onPlay} autoFocus>
            Play <kbd>Enter</kbd>
          </button>
          <button className="btn setup-btn" onClick={onSetup}>
            Wizard &amp; Curses
            <span className="setup-summary">
              {WIZARDS[wizard].name} · {curses.length === 0 ? 'no curses' : `${curses.length} ${curses.length === 1 ? 'curse' : 'curses'}, shards ×${shardMultiplier(curses).toFixed(2)}`}
            </span>
          </button>
          <button className="btn" onClick={onShop}>
            Permanent Upgrades{' '}
            <span className="shards">
              {save.currency} <Shard />
            </span>
          </button>
          <div className="menu-pair">
            <button className={`btn${firstTime ? ' pulse' : ''}`} onClick={onHowTo}>
              How to Play
            </button>
            <button className="btn" onClick={onPractice}>
              Practice Sigils
            </button>
          </div>
          <div className="menu-pair">
            <button className="btn" onClick={onOptions}>
              Options
            </button>
            <button className="btn" onClick={onToggleArt}>
              Art: {save.settings.pixelArt ? 'Pixel' : 'Classic'} <KeyHint action="art" />
            </button>
          </div>
        </div>
        <VolumeControls {...volume} />
        <div className="records">
          <div>
            <span>Best time</span>
            <b>{formatTime(save.records.bestTime)}</b>
          </div>
          <div>
            <span>Best level</span>
            <b>{save.records.bestLevel}</b>
          </div>
          <div>
            <span>Most defeated</span>
            <b>{save.records.bestKills}</b>
          </div>
          <div>
            <span>Runs</span>
            <b>{save.records.totalRuns}</b>
          </div>
        </div>
      </div>
      <button className="icon-btn corner" onClick={onToggleMute} title={`Mute (${muteKey})`} aria-label="Toggle sound">
        {pixel ? <PixelIcon name={save.settings.muted ? 'soundOff' : 'soundOn'} scale={2} /> : save.settings.muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}

export function HowToPlay({
  onBack,
  onPlay,
  onPractice,
  safeWarnings,
}: {
  onBack(): void;
  onPlay(): void;
  onPractice(): void;
  safeWarnings: boolean;
}) {
  useKey(BACK, onBack);
  useKey(ENTER, onPlay);
  const bindings = useContext(BindingsContext);
  const [up, left, down, right] = (['up', 'left', 'down', 'right'] as const).map((a) => primaryKeyLabel(bindings, a));
  const steer = MOVE_ACTIONS.map((a) => primaryKeyLabel(bindings, a)).join('');
  return (
    <div className="screen howto">
      <h2 className="screen-title">How to Play</h2>
      <div className="howto-grid">
        <section className="howto-card">
          <h3>1 · Steer</h3>
          <div className="keys">
            <kbd className="k-w">{up}</kbd>
            <kbd className="k-a">{left}</kbd>
            <kbd className="k-s">{down}</kbd>
            <kbd className="k-d">{right}</kbd>
          </div>
          <p>
            Your serpent <b>never stops moving</b>. {steer === 'WSAD' ? 'WASD' : `${up} ${left} ${down} ${right}`} points it up, left,
            down or right; hold two keys for diagonals.
            Let go and it keeps its heading. Turns curve — reversing makes a U-turn.
          </p>
          <p>Walls sting and bounce you back inward. Only enemy <b>heads</b> bite, and your own tail is safe.</p>
          <p>
            Once your serpent is long enough, <b>loop your body around foes</b> to Constrict them: a dashed line shows the gap
            left to close.
          </p>
        </section>
        <section className="howto-card">
          <h3>2 · Draw</h3>
          <p>
            <b>Hold the left mouse button</b> anywhere over the arena, draw a sigil in one stroke, then <b>release</b> to cast.
            Size doesn't matter: lines, triangles and zigzags work in any direction, circles either way round, and a V
            just needs to open roughly upward. Each wizard starts with three sigils; level-ups teach the others.
          </p>
          <div className="sigil-list">
            {SPELL_IDS.map((id) => (
              <div key={id} className="sigil-row" style={{ ['--spell' as string]: SPELL_UI[id].color }}>
                <SigilIcon spell={id} size={52} animate />
                <div>
                  <b>
                    {SPELL_UI[id].shape} → {SPELLS[id].name}
                  </b>
                  <span>{SPELL_UI[id].blurb}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="howto-card">
          <h3>3 · Aim</h3>
          <p>
            The spot where you <b>press down</b> becomes your target and gets a marker. On release, Bolt and Lightning fly
            from the serpent's <b>current</b> head toward that marker — so the stroke itself can be drawn anywhere.
          </p>
          <p>
            Press right on top of the serpent to fire straight ahead. Frost Field lands where you pressed; Nova and Ward
            always surround you.
          </p>
          <p>Max a spell's own upgrade and take two ranks of its partner, and a golden card evolves it.</p>
          <p>
            While you draw, the trail takes the colour of the spell it reads. <b>Perfect</b> sigils hit 35% harder,{' '}
            <b>Clean</b> ones 15%.
          </p>
          <p className="muted">Each spell has its own short cooldown. A messy stroke shows “Sigil unclear” and costs nothing.</p>
        </section>
      </div>
      <ul className="tips">
        <li>
          {safeWarnings ? (
            <>
              <span className="dot warn" /> Yellow-and-black stripes and a “!” mark a coming attack; red-orange shots and portals
              are dangerous too.
            </>
          ) : (
            <>
              <span className="dot red" /> Red-orange means danger: shots, charge lanes, portals.
            </>
          )}
        </li>
        <li>
          <span className="dot violet" /> Defeated foes drop crystals. Survive and level up to grow longer and stronger.
        </li>
        <li>
          <span className="dot gold" /> Around 5:00 a rival Archmage serpent arrives. Defeat it to descend deeper, where elites
          roam.
        </li>
        <li>
          <KeyHint action="pause" /> pause · <KeyHint action="mute" /> mute · keys and comfort settings are in Options
        </li>
      </ul>
      <div className="menu-buttons row">
        <button className="btn" onClick={onBack}>
          Back <kbd>Esc</kbd>
        </button>
        <button className="btn" onClick={onPractice}>
          Practice Sigils
        </button>
        <button className="btn primary" onClick={onPlay}>
          Play <kbd>Enter</kbd>
        </button>
      </div>
    </div>
  );
}

/** Pick a wizard and any curses before a run; both are remembered. */
export function SetupScreen({
  save,
  onPickWizard,
  onToggleCurse,
  onBack,
  onPlay,
}: {
  save: SaveData;
  onPickWizard(id: WizardId): void;
  onToggleCurse(id: CurseId): void;
  onBack(): void;
  onPlay(): void;
}) {
  useKey(BACK, onBack);
  useKey(ENTER, onPlay);
  const records = save.records;
  const chosen = playableWizard(save.settings.wizard, records);
  const curses = save.settings.curses;
  const mult = shardMultiplier(curses);
  return (
    <div className="screen setup">
      <h2 className="screen-title">Prepare Your Run</h2>
      <div className="setup-grid">
        <section className="setup-section">
          <h3 className="setup-head">Wizard</h3>
          <div className="wizard-list">
            {WIZARD_IDS.map((id) => {
              const w = WIZARDS[id];
              const unlocked = isWizardUnlocked(id, records);
              return (
                <button
                  key={id}
                  className={`wizard-card${chosen === id ? ' chosen' : ''}${unlocked ? '' : ' locked'}`}
                  disabled={!unlocked}
                  aria-pressed={chosen === id}
                  onClick={() => onPickWizard(id)}
                >
                  <WizardPortrait id={id} />
                  <span className="wizard-name">{w.name}</span>
                  <span className="wizard-title">{w.title}</span>
                  <span className="wizard-sigils">
                    {w.spells.map((sp) => (
                      <span key={sp} title={SPELLS[sp].name}>
                        <SigilIcon spell={sp} size={24} />
                      </span>
                    ))}
                  </span>
                  {unlocked ? (
                    <span className="wizard-perks">{w.perks.join(' · ')}</span>
                  ) : (
                    <span className="wizard-lock">
                      Locked: {w.unlock.text}
                      {w.unlock.progress(records) && <small>{w.unlock.progress(records)}</small>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
        <section className="setup-section">
          <h3 className="setup-head">
            Curses <span className="setup-mult">Shards ×{mult.toFixed(2)}</span>
          </h3>
          <div className="curse-list">
            {CURSE_IDS.map((id) => {
              const c = CURSES[id];
              const on = curses.includes(id);
              return (
                <button key={id} className={`curse${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onToggleCurse(id)}>
                  <span className="curse-box">{on ? '✓' : ''}</span>
                  <span className="curse-text">
                    <b>{c.name}</b>
                    <span>{c.description}</span>
                  </span>
                  <span className="curse-bonus">+{Math.round(c.bonus * 100)}%</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <div className="menu-buttons row">
        <button className="btn" onClick={onBack}>
          Back <kbd>Esc</kbd>
        </button>
        <button className="btn primary" onClick={onPlay}>
          Begin as {WIZARDS[chosen].name} <kbd>Enter</kbd>
        </button>
      </div>
    </div>
  );
}

export function ShopScreen({
  save,
  onBuy,
  onBack,
  onPlay,
}: {
  save: SaveData;
  onBuy(id: MetaId): void;
  onBack(): void;
  onPlay(): void;
}) {
  useKey(BACK, onBack);
  return (
    <div className="screen shop">
      <h2 className="screen-title">Permanent Upgrades</h2>
      <p className="screen-sub">
        Spend Arcane Shards earned from runs. You have{' '}
        <span className="shards big">
          {save.currency} <Shard />
        </span>
      </p>
      <div className="shop-grid">
        {META_IDS.map((id) => {
          const def = META_UPGRADES[id];
          const level = save.meta[id];
          const max = metaMaxLevel(id);
          const cost = metaNextCost(id, level);
          const affordable = cost !== null && save.currency >= cost;
          return (
            <div key={id} className={`shop-card${cost === null ? ' maxed' : ''}`}>
              <UpgradeGlyph id={id} glyph={def.glyph} />
              <span className="card-name">{def.name}</span>
              <span className="card-pips">
                {Array.from({ length: max }, (_, k) => (
                  <i key={k} className={k < level ? 'on' : ''} />
                ))}
              </span>
              <span className="card-desc">{level > 0 ? def.describe(level) : 'Not yet learned.'}</span>
              {cost !== null && <span className="card-next">Next: {def.describe(level + 1)}</span>}
              <button
                className="btn small primary"
                disabled={!affordable}
                onClick={(e) => {
                  onBuy(id);
                  // After a mouse purchase, drop focus so a later Enter/Space can't buy again by accident.
                  // Keyboard activation (detail === 0) keeps focus for deliberate keyboard use.
                  if (e.detail > 0) e.currentTarget.blur();
                }}
              >
                {cost === null ? (
                  'Mastered'
                ) : (
                  <>
                    Learn · {cost} <Shard />
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
      <div className="menu-buttons row">
        <button className="btn" onClick={onBack}>
          Back <kbd>Esc</kbd>
        </button>
        <button className="btn primary" onClick={onPlay}>
          Play
        </button>
      </div>
    </div>
  );
}
