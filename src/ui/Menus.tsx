import { useContext, useEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react';
import { drawAtlasPicture } from '../game/atlas';
import { DUOS, HEAT, SPELL_IDS, SPELLS, type DuoId } from '../game/config';
import { playableHeat, startMaps, unlockBlocker, UNLOCKS, type UnlockDef, type UnlockId, type UnlockKind } from '../game/grimoire';
import type { RelicId } from '../game/relics';
import { ULTIMATES } from '../game/ultimates';
import { CURSE_IDS, CURSES, shardMultiplier, type CurseId } from '../game/curses';
import { MOVE_ACTIONS, primaryKeyLabel } from '../game/keys';
import { MAP_ORDER, MAPS } from '../game/maps';
import type { MapId } from '../game/maps/types';
import { formatTime } from '../game/math';
import { SOUNDTRACKS, THEMES } from '../game/music/score';
import { ACHIEVEMENT_IDS, ACHIEVEMENTS, type AchievementDef } from '../game/achievements';
import { BEAST_IDS, BEASTS, bestiaryPages } from '../game/bestiary';
import type { DailySetup } from '../game/daily';
import type { SaveData } from '../game/persistence';
import { META_IDS, META_UPGRADES, metaMaxLevel, metaNextCost, type MetaId } from '../game/progression';
import { isWizardUnlocked, playableWizard, WIZARD_IDS, WIZARDS, type WizardId } from '../game/wizards';
import { PixelIcon, PixelTitleSerpent, RelicIcon, Shard, UpgradeGlyph, WizardPortrait } from './art';
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

export function TitleScreen({
  save,
  onPlay,
  onDaily,
  daily,
  onRecords,
  onSetup,
  onHowTo,
  onShop,
  onOptions,
  onPractice,
  onToggleMute,
  volume,
}: {
  save: SaveData;
  onPlay(): void;
  /** Today's daily run, and starting it. */
  onDaily(): void;
  daily: DailySetup;
  onRecords(): void;
  onSetup(): void;
  onHowTo(): void;
  onShop(): void;
  onOptions(): void;
  onPractice(): void;
  onToggleMute(): void;
  volume: ComponentProps<typeof VolumeControls>;
}) {
  useKey(ENTER, onPlay);
  const firstTime = save.records.totalRuns === 0;
  const wizard = playableWizard(save.settings.wizard, save.records);
  const curses = save.settings.curses;
  const heat = playableHeat(save.settings.heat, save.records.heatUnlocked);
  const start = startMaps(save.grimoire).includes(save.settings.startMap) ? save.settings.startMap : MAP_ORDER[0];
  const muteKey = useKeyLabel('mute');
  return (
    <div className="screen title-screen">
      <div className="title-wrap">
        <PixelTitleSerpent wizard={wizard} />
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
              {heat > 0 && ` · Heat ${heat}`}
              {start !== MAP_ORDER[0] && ` · from the ${MAPS[start].name}`}
            </span>
          </button>
          <button className="btn" onClick={onShop}>
            Permanent Upgrades{' '}
            <span className="shards">
              {save.currency} <Shard />
            </span>
          </button>
          <div className="menu-pair">
            <button className="btn setup-btn daily-btn" data-daily onClick={onDaily}>
              Daily Run
              <span className="setup-summary">
                {WIZARDS[daily.wizard].name} · {CURSES[daily.curse].name}
                {save.records.dailyDate === daily.date && ` · best ${save.records.dailyBest}`}
              </span>
            </button>
            <button className="btn setup-btn" data-records onClick={onRecords}>
              Hall of Records
              <span className="setup-summary">
                {save.achievements.length} / {ACHIEVEMENT_IDS.length} achievements
              </span>
            </button>
          </div>
          <div className="menu-pair">
            <button className={`btn${firstTime ? ' pulse' : ''}`} onClick={onHowTo}>
              How to Play
            </button>
            <button className="btn" onClick={onPractice}>
              Practice Sigils
            </button>
          </div>
          <button className="btn" onClick={onOptions}>
            Options
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
            <span>Deepest</span>
            <b>{save.records.deepest}</b>
          </div>
          <div>
            <span>Runs</span>
            <b>{save.records.totalRuns}</b>
          </div>
          {save.records.wins > 0 && (
            <div>
              <span>Wins</span>
              <b>{save.records.wins}</b>
            </div>
          )}
        </div>
      </div>
      <button className="icon-btn corner" onClick={onToggleMute} title={`Mute (${muteKey})`} aria-label="Toggle sound">
        <PixelIcon name={save.settings.muted ? 'soundOff' : 'soundOn'} scale={2} />
      </button>
    </div>
  );
}

/** Achievements earned and to come, the bestiary of foes met, and the run records behind them. */
export function RecordsScreen({ save, onBack }: { save: SaveData; onBack(): void }) {
  useKey(BACK, onBack);
  const [tab, setTab] = useState<'achievements' | 'bestiary'>('achievements');
  const r = save.records;
  const seen = BEAST_IDS.filter((id) => (r.bestiary[id] ?? 0) > 0).length;
  return (
    <div className="screen records-screen">
      <h2 className="screen-title">Hall of Records</h2>
      <div className="records hall-records">
        <div>
          <span>Wins</span>
          <b>{r.wins}</b>
        </div>
        <div>
          <span>Fastest win</span>
          <b>{r.fastestWin > 0 ? formatTime(r.fastestWin) : '—'}</b>
        </div>
        <div>
          <span>Foes defeated</span>
          <b>{r.totalKills.toLocaleString()}</b>
        </div>
        <div>
          <span>Daily best</span>
          <b>{r.dailyDate ? r.dailyBest : '—'}</b>
        </div>
        <div>
          <span>Daily streak</span>
          <b>{r.dailyStreak}</b>
        </div>
      </div>
      <div className="shop-tabs" role="tablist">
        <button role="tab" className={`btn small${tab === 'achievements' ? ' on' : ''}`} aria-selected={tab === 'achievements'} data-tab="achievements" onClick={() => setTab('achievements')}>
          Achievements {save.achievements.length} / {ACHIEVEMENT_IDS.length}
        </button>
        <button role="tab" className={`btn small${tab === 'bestiary' ? ' on' : ''}`} aria-selected={tab === 'bestiary'} data-tab="bestiary" onClick={() => setTab('bestiary')}>
          Bestiary {seen} / {BEAST_IDS.length}
        </button>
      </div>
      {tab === 'achievements' ? (
        <div className="achievement-grid">
          {ACHIEVEMENT_IDS.map((id) => {
            const a: AchievementDef = ACHIEVEMENTS[id];
            const got = save.achievements.includes(id);
            return (
              <div key={id} className={`achievement${got ? ' earned' : ''}`} data-achievement={id}>
                <span className="achievement-mark" aria-hidden="true">
                  {got ? '★' : '☆'}
                </span>
                <span className="achievement-name">{a.name}</span>
                <span className="achievement-desc">{a.description}</span>
                <span className="achievement-reward">
                  {got ? 'Earned' : (a.progress?.(r) ?? 'Not yet')} · {a.reward} <Shard />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bestiary">
          {bestiaryPages().map((page) => (
            <section key={page.title} className="bestiary-page">
              <h3 className="setup-head">{page.title}</h3>
              <div className="bestiary-list">
                {page.beasts.map((id) => {
                  const b = BEASTS[id];
                  const n = r.bestiary[id] ?? 0;
                  const known = n > 0;
                  return (
                    <div key={id} className={`beast${known ? '' : ' unknown'}${b.boss ? ' boss' : ''}`} data-beast={id}>
                      <span className="beast-token" style={{ '--beast': known ? b.color : '#3a2e50' } as CSSProperties}>
                        {known ? b.glyph : '?'}
                      </span>
                      <span className="beast-name">{known ? b.name : '???'}</span>
                      <span className="beast-lore">{known ? b.lore : 'Not yet met.'}</span>
                      {known && <span className="beast-count">{n.toLocaleString()} defeated</span>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="menu-buttons row">
        <button className="btn" onClick={onBack}>
          Back <kbd>Esc</kbd>
        </button>
      </div>
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
          <p>
            <b>On a touch screen</b>, hold a thumb on the left of the screen and slide it the way to go (or the right, in
            Options). Your other hand draws anywhere else. Tap the ultimate's card to cast it.
          </p>
          <p>
            Walls, pillars and statues sting and bounce you off, but they also block enemy shots. Only enemy <b>heads</b> bite,
            and your own tail is safe.
          </p>
          <p>
            Once your serpent is long enough, <b>loop your body around foes</b> to Constrict them: a dashed line shows the gap
            left to close.
          </p>
        </section>
        <section className="howto-card">
          <h3>2 · Draw</h3>
          <p>
            <b>Hold the left mouse button</b> (or a finger) anywhere over the map, draw a sigil in one stroke, then <b>release</b> to cast.
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
          <p>
            Each wizard also has an <b>ultimate</b> on a long cooldown: press <KeyHint action="ultimate" /> or click its card at the
            bottom of the screen once it's charged.
          </p>
        </section>
      </div>
      <section className="howto-card howto-maps">
        <h3>4 · Maps</h3>
        <p>
          <b>Stone hurts, containers don't.</b> Run into small containers to smash them; break the big ones with spells. They
          drop crystals, health and buffs: Quickening, Empower, Swiftscale, Stoneskin, Lodestone and Shard Caches.
        </p>
        <p>Each Archmage you defeat opens a way down to the next map. After the last, the run starts over, deeper and harder.</p>
        <ol className="map-list">
          {MAP_ORDER.map((id) => (
            <li key={id}>
              <b>{MAPS[id].name}</b> {MAPS[id].tip}
            </li>
          ))}
        </ol>
      </section>
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
          <span className="dot gold" /> Around 5:00 on each map a rival Archmage serpent arrives. Defeat it, then steer into the
          way down to the next map, where elites roam.
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

/**
 * Pick a wizard, any curses, the heat and where to start before a run; all are remembered. The
 * atlas also plays any reached map's music.
 */
export function SetupScreen({
  save,
  onPickWizard,
  onToggleCurse,
  onSetHeat,
  onPickStart,
  listening,
  onListen,
  onBack,
  onPlay,
}: {
  save: SaveData;
  onPickWizard(id: WizardId): void;
  onToggleCurse(id: CurseId): void;
  onSetHeat(heat: number): void;
  onPickStart(map: MapId): void;
  listening: MapId | null;
  onListen(map: MapId | null): void;
  onBack(): void;
  onPlay(): void;
}) {
  useKey(BACK, onBack);
  useKey(ENTER, onPlay);
  const records = save.records;
  const chosen = playableWizard(save.settings.wizard, records);
  const curses = save.settings.curses;
  const mult = shardMultiplier(curses);
  const heat = playableHeat(save.settings.heat, records.heatUnlocked);
  const starts = startMaps(save.grimoire);
  const start = starts.includes(save.settings.startMap) ? save.settings.startMap : MAP_ORDER[0];
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
                    <>
                      <span className="wizard-perks">{w.perks.join(' · ')}</span>
                      <span className="wizard-ult" title={ULTIMATES[w.ultimate].description}>
                        ✸ Ultimate: {ULTIMATES[w.ultimate].name}
                      </span>
                    </>
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
          <HeatPicker heat={heat} unlocked={records.heatUnlocked} cleared={records.heatCleared} onSet={onSetHeat} />
        </section>
      </div>
      <section className="setup-section atlas">
        <h3 className="setup-head">
          Maps <span className="setup-mult">{records.breakables} containers smashed</span>
        </h3>
        <div className="atlas-list">
          {MAP_ORDER.map((id, i) => (
            <AtlasCard
              key={id}
              id={id}
              depth={i + 1}
              known={records.maps.includes(id)}
              startable={starts.length > 1 && starts.includes(id)}
              chosen={start === id}
              onPick={() => onPickStart(id)}
              listening={listening === id}
              onListen={() => onListen(listening === id ? null : id)}
            />
          ))}
        </div>
      </section>
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

/** Heat, once the loop has been reached: harder foes for more shards. */
function HeatPicker({ heat, unlocked, cleared, onSet }: { heat: number; unlocked: number; cleared: number; onSet(heat: number): void }) {
  return (
    <div className="heat">
      <h3 className="setup-head">
        Heat {heat > 0 && <span className="setup-mult">Shards ×{(1 + HEAT.shards * heat).toFixed(2)}</span>}
      </h3>
      {unlocked === 0 ? (
        <p className="heat-desc">Reach Depth {HEAT.clearDepth}, the Ruins again, to unlock Heat.</p>
      ) : (
        <>
          <div className="heat-picker">
            <button className="btn small" aria-label="Less heat" disabled={heat <= 0} onClick={() => onSet(heat - 1)}>
              −
            </button>
            <span className="heat-level" data-heat={heat}>
              {heat}
            </span>
            <button className="btn small" aria-label="More heat" disabled={heat >= unlocked} onClick={() => onSet(heat + 1)}>
              +
            </button>
          </div>
          <p className="heat-desc">
            {heat === 0
              ? 'No heat.'
              : `Foes have ${Math.round(HEAT.hp * heat * 100)}% more health, deal ${Math.round(HEAT.damage * heat * 100)}% more damage, and elites are more common.`}{' '}
            Reaching Depth {HEAT.clearDepth} unlocks the next level{cleared >= 0 && ` · cleared up to ${cleared}`}.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * One map of a run in the atlas: its picture, name and hazard tip once reached, else a
 * silhouette; once reached, its music to listen to; with a waystone, a start.
 */
function AtlasCard({
  id,
  depth,
  known,
  startable,
  chosen,
  onPick,
  listening,
  onListen,
}: {
  id: MapId;
  depth: number;
  known: boolean;
  startable: boolean;
  chosen: boolean;
  onPick(): void;
  listening: boolean;
  onListen(): void;
}) {
  const picture = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (picture.current) drawAtlasPicture(picture.current, id, known);
  }, [id, known]);
  const def = MAPS[id];
  return (
    <div className={`atlas-card${known ? '' : ' unknown'}`} data-map={id}>
      <canvas ref={picture} className="atlas-map" aria-hidden="true" />
      <span className="atlas-depth">Depth {depth}</span>
      <span className="atlas-name">{known ? def.name : 'Undiscovered'}</span>
      <span className="atlas-tip">{known ? def.tip : 'Defeat the Archmage before it to find the way down'}</span>
      {known && (
        <span className="atlas-theme">
          <span aria-hidden="true">♪</span> {THEMES[SOUNDTRACKS[id].run].title}
        </span>
      )}
      {(known || startable) && (
        <div className="atlas-actions">
          {known && (
            <button className={`btn small${listening ? ' on' : ''}`} data-listen={id} aria-pressed={listening} onClick={onListen}>
              {listening ? 'Stop' : 'Listen'}
            </button>
          )}
          {startable && (
            <button className={`btn small${chosen ? ' on' : ''}`} data-start={id} aria-pressed={chosen} onClick={onPick}>
              {chosen ? 'Starting here' : 'Start here'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const UNLOCK_GROUPS: { kind: UnlockKind; title: string }[] = [
  { kind: 'relic', title: 'Relics to find on the way down' },
  { kind: 'duo', title: 'Duo evolutions' },
  { kind: 'tool', title: 'Level-up tools' },
  { kind: 'waystone', title: 'Waystones' },
  { kind: 'ultimate', title: 'Ultimate' },
];

const TOOL_GLYPH: Record<string, string> = { reroll1: '↻', reroll2: '↻', banish1: '✕', banish2: '✕', fourthCard: '▦' };

function UnlockIcon({ def }: { def: UnlockDef }) {
  if (def.kind === 'relic') return <RelicIcon id={def.id.slice(6) as RelicId} size={44} />;
  if (def.kind === 'duo') {
    const [a, b] = DUOS[def.id.slice(4) as DuoId].spells;
    return (
      <span className="card-pair">
        <SigilIcon spell={a} size={36} />
        <SigilIcon spell={b} size={36} />
      </span>
    );
  }
  return <UpgradeGlyph id={def.id} glyph={def.kind === 'waystone' ? '⟱' : def.kind === 'ultimate' ? '✸' : TOOL_GLYPH[def.id]} />;
}

/** The Grimoire: one-time unlocks that widen what a run can find and do. */
function GrimoireGrid({ save, onBuy }: { save: SaveData; onBuy(id: UnlockId): void }) {
  return (
    <div className="grimoire">
      {UNLOCK_GROUPS.map((g) => (
        <section key={g.kind} className="grimoire-group">
          <h3 className="setup-head">{g.title}</h3>
          <div className="shop-grid">
            {UNLOCKS.filter((u) => u.kind === g.kind).map((u) => {
              const blocker = unlockBlocker(u.id, save.grimoire, save.records.maps);
              const owned = save.grimoire.includes(u.id);
              return (
                <div key={u.id} className={`shop-card grimoire-card${owned ? ' maxed' : ''}`} data-unlock={u.id}>
                  <UnlockIcon def={u} />
                  <span className="card-name">{u.name}</span>
                  <span className="card-desc">{u.description}</span>
                  <button
                    className="btn small primary"
                    disabled={blocker !== null || save.currency < u.cost}
                    onClick={(e) => {
                      onBuy(u.id);
                      if (e.detail > 0) e.currentTarget.blur();
                    }}
                  >
                    {blocker ?? (
                      <>
                        Learn · {u.cost} <Shard />
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function ShopScreen({
  save,
  onBuy,
  onBuyUnlock,
  onBack,
  onPlay,
}: {
  save: SaveData;
  onBuy(id: MetaId): void;
  onBuyUnlock(id: UnlockId): void;
  onBack(): void;
  onPlay(): void;
}) {
  useKey(BACK, onBack);
  const [tab, setTab] = useState<'stats' | 'grimoire'>('stats');
  return (
    <div className="screen shop">
      <h2 className="screen-title">Permanent Upgrades</h2>
      <p className="screen-sub">
        Spend Arcane Shards earned from runs. You have{' '}
        <span className="shards big">
          {save.currency} <Shard />
        </span>
      </p>
      <div className="shop-tabs" role="tablist">
        <button role="tab" className={`btn small${tab === 'stats' ? ' on' : ''}`} aria-selected={tab === 'stats'} data-tab="stats" onClick={() => setTab('stats')}>
          Stat lines
        </button>
        <button role="tab" className={`btn small${tab === 'grimoire' ? ' on' : ''}`} aria-selected={tab === 'grimoire'} data-tab="grimoire" onClick={() => setTab('grimoire')}>
          Grimoire · {save.grimoire.length} / {UNLOCKS.length}
        </button>
      </div>
      {tab === 'grimoire' ? (
        <GrimoireGrid save={save} onBuy={onBuyUnlock} />
      ) : (
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
      )}
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
