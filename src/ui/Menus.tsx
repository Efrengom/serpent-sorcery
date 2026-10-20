import { useEffect, type ComponentProps } from 'react';
import type { SpellId } from '../game/config';
import { SPELLS } from '../game/config';
import { formatTime } from '../game/math';
import type { SaveData } from '../game/persistence';
import { META_IDS, META_UPGRADES, metaMaxLevel, metaNextCost, type MetaId } from '../game/progression';
import { PixelIcon, PixelTitleSerpent, Shard, UpgradeGlyph, usePixelArt } from './art';
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

function TitleSerpent() {
  return (
    <svg className="title-serpent" viewBox="0 0 520 150" aria-hidden="true">
      <defs>
        <linearGradient id="body" x1="0" x2="1">
          <stop offset="0" stopColor="#127a6c" />
          <stop offset="1" stopColor="#2fd3b5" />
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
      <ellipse cx="420" cy="92" rx="26" ry="20" fill="#2fd3b5" stroke="#140a24" strokeWidth="4" />
      <circle cx="430" cy="84" r="5" fill="#fff" />
      <circle cx="432" cy="84" r="2.5" fill="#140a24" />
      <path d="M445 98 l14 2 l6 -4 m-6 4 l6 5" stroke="#ff4f7b" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path className="serpent-hat" d="M392 76 Q 400 12, 470 6 Q 432 34, 444 74 Z" fill="#5b2aa8" stroke="#140a24" strokeWidth="4" />
      <ellipse cx="418" cy="76" rx="36" ry="9" fill="#2f1263" stroke="#140a24" strokeWidth="4" />
      <path d="M398 66 L 440 62" stroke="#ffd45e" strokeWidth="5" />
      <path className="hat-star" d="M470 6 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1z" fill="#ffd45e" />
    </svg>
  );
}

export function TitleScreen({
  save,
  onPlay,
  onHowTo,
  onShop,
  onToggleMute,
  onToggleArt,
  volume,
}: {
  save: SaveData;
  onPlay(): void;
  onHowTo(): void;
  onShop(): void;
  onToggleMute(): void;
  onToggleArt(): void;
  volume: ComponentProps<typeof VolumeControls>;
}) {
  useKey(ENTER, onPlay);
  const pixel = usePixelArt();
  const firstTime = save.records.totalRuns === 0;
  return (
    <div className="screen title-screen">
      <div className="runes-bg" aria-hidden="true" />
      <div className="title-wrap">
        {pixel ? <PixelTitleSerpent /> : <TitleSerpent />}
        <h1 className="game-title">Serpent Sorcery</h1>
        <p className="tagline">One hand steers the serpent. The other draws the spells.</p>
        <div className="menu-buttons">
          <button className="btn primary big" onClick={onPlay} autoFocus>
            Play <kbd>Enter</kbd>
          </button>
          <button className={`btn${firstTime ? ' pulse' : ''}`} onClick={onHowTo}>
            How to Play
          </button>
          <button className="btn" onClick={onShop}>
            Permanent Upgrades{' '}
            <span className="shards">
              {save.currency} <Shard />
            </span>
          </button>
          <button className="btn small" onClick={onToggleArt}>
            Art style: {save.settings.pixelArt ? 'Pixel' : 'Classic'} <kbd>P</kbd>
          </button>
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
      <button className="icon-btn corner" onClick={onToggleMute} title="Mute (M)" aria-label="Toggle sound">
        {pixel ? <PixelIcon name={save.settings.muted ? 'soundOff' : 'soundOn'} scale={2} /> : save.settings.muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}

const SPELL_ORDER: SpellId[] = ['bolt', 'lightning', 'nova'];

export function HowToPlay({ onBack, onPlay }: { onBack(): void; onPlay(): void }) {
  useKey(BACK, onBack);
  useKey(ENTER, onPlay);
  return (
    <div className="screen howto">
      <h2 className="screen-title">How to Play</h2>
      <div className="howto-grid">
        <section className="howto-card">
          <h3>1 · Steer</h3>
          <div className="keys">
            <kbd className="k-w">W</kbd>
            <kbd className="k-a">A</kbd>
            <kbd className="k-s">S</kbd>
            <kbd className="k-d">D</kbd>
          </div>
          <p>
            Your serpent <b>never stops moving</b>. WASD points it up, left, down or right; hold two keys for diagonals.
            Let go and it keeps its heading. Turns curve — reversing makes a U-turn.
          </p>
          <p>Walls sting and bounce you back inward. Only enemy <b>heads</b> bite, and your own tail is safe.</p>
        </section>
        <section className="howto-card">
          <h3>2 · Draw</h3>
          <p>
            <b>Hold the left mouse button</b> anywhere over the arena, draw a sigil in one stroke, then <b>release</b> to cast.
            Size doesn't matter: lines work in any direction, circles either way round, and a V just needs to open
            roughly upward.
          </p>
          <div className="sigil-list">
            {SPELL_ORDER.map((id) => (
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
          <p>Press right on top of the serpent to fire straight ahead. Nova always bursts around you.</p>
          <p className="muted">Each spell has its own short cooldown. A messy stroke shows “Sigil unclear” and costs nothing.</p>
        </section>
      </div>
      <ul className="tips">
        <li>
          <span className="dot red" /> Red-orange means danger: shots, charge lanes, portals.
        </li>
        <li>
          <span className="dot violet" /> Defeated foes drop crystals. Survive and level up to grow longer and stronger.
        </li>
        <li>
          <span className="dot gold" /> Around 5:00 a rival Archmage serpent arrives.
        </li>
        <li>
          <kbd>Esc</kbd> pause · <kbd>M</kbd> mute
        </li>
      </ul>
      <div className="menu-buttons row">
        <button className="btn" onClick={onBack}>
          Back <kbd>Esc</kbd>
        </button>
        <button className="btn primary" onClick={onPlay}>
          Play <kbd>Enter</kbd>
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
