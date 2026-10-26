import { BUFF_INFO } from '../game/breakables';
import type { HudSnapshot } from '../game/engine';
import { ICON_PATHS } from '../game/icons';
import { formatTime } from '../game/math';
import { RELICS } from '../game/relics';
import { PixelIcon, RelicIcon } from './art';
import { useFullscreen } from './fullscreen';
import { useKeyLabel } from './Options';
import { SigilIcon, SPELL_UI } from './SigilIcon';

interface Props {
  hud: HudSnapshot | null;
  muted: boolean;
  onPause(): void;
  onToggleMute(): void;
  onUltimate(): void;
}

/** The wizard's ultimate: its charge filling up, a glow when ready, and a click (or its key) to cast. */
function UltimateCard({ ult, keyLabel, onCast }: { ult: HudSnapshot['ultimate']; keyLabel: string; onCast(): void }) {
  const ready = ult.remaining <= 0 && ult.active <= 0;
  const charge = ult.active > 0 ? 1 : 1 - Math.min(1, ult.remaining / Math.max(0.01, ult.total));
  return (
    <button
      className={`ult-card${ready ? ' ready' : ''}${ult.active > 0 ? ' active' : ''}`}
      data-ult
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onCast}
      style={{ ['--ult' as string]: ult.color, ['--charge' as string]: `${charge * 100}%` }}
      title={`${ult.name} (${keyLabel})`}
    >
      <span className="ult-fill" />
      <span className="ult-star" aria-hidden="true">
        ✸
      </span>
      <span className="ult-text">
        <span className="ult-name">{ult.name}</span>
        <span className="ult-state">{ult.active > 0 ? 'Unleashed!' : ready ? <kbd>{keyLabel}</kbd> : `${Math.ceil(ult.remaining)}s`}</span>
      </span>
    </button>
  );
}

export function Hud({ hud, muted, onPause, onToggleMute, onUltimate }: Props) {
  const fullscreen = useFullscreen();
  const muteKey = useKeyLabel('mute');
  const pauseKey = useKeyLabel('pause');
  const ultKey = useKeyLabel('ultimate');
  if (!hud) return null;
  const hpPct = Math.max(0, Math.min(1, hud.hp / hud.maxHp));
  const xpPct = Math.max(0, Math.min(1, hud.xp / hud.xpNext));
  return (
    <div className="hud">
      <div className="hud-bar">
        <div className="hud-left">
          <div className="level-badge" title="Level">
            <span className="level-label">LV</span>
            <span className="level-num">{hud.level}</span>
          </div>
          <div className="bars">
            <div className={`bar hp${hpPct < 0.3 ? ' low' : ''}`}>
              <div className="fill" style={{ width: `${hpPct * 100}%` }} />
              <span className="bar-text">
                {hud.hp} / {hud.maxHp}
              </span>
            </div>
            <div className="bar xp">
              <div className="fill" style={{ width: `${xpPct * 100}%` }} />
              <span className="bar-text small">
                XP {Math.floor(hud.xp)} / {hud.xpNext}
              </span>
            </div>
            {hud.relics.length > 0 && (
              <div className="relic-row">
                {hud.relics.map((id) => (
                  <span key={id} className="relic-chip" data-relic={id} title={`${RELICS[id].name}: ${RELICS[id].description}`}>
                    <RelicIcon id={id} size={16} />
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="hud-center">
          <div className="clock">{formatTime(hud.time)}</div>
          <div className="kills">
            {hud.kills} defeated
            {hud.depth > 1 && <span className="depth"> · Depth {hud.depth}</span>}
          </div>
          <div className="map-name">{hud.mapName}</div>
        </div>

        <div className={`hud-right${hud.known.length > 3 ? ' many' : ''}`}>
          {hud.known.map((id) => {
            const cd = hud.cooldowns[id];
            const ready = cd.remaining <= 0;
            const pct = ready ? 0 : Math.min(1, cd.remaining / Math.max(0.01, cd.total));
            return (
              <div
                key={id}
                className={`spell-card${ready ? ' ready' : ''}${cd.cast > 0.4 ? ' cast' : ''}${cd.deny > 0.4 ? ' deny' : ''}${hud.evolved[id] ? ' evolved' : ''}`}
                style={{ ['--spell' as string]: SPELL_UI[id].color }}
              >
                <SigilIcon spell={id} size={34} />
                <div className="spell-text">
                  <span className="spell-name">{hud.spellNames[id]}</span>
                  <span className="spell-shape">Draw {SPELL_UI[id].shape}</span>
                </div>
                {!ready && (
                  <>
                    <div className="cd-shade" style={{ height: `${pct * 100}%` }} />
                    <span className="cd-num">{cd.remaining.toFixed(1)}</span>
                  </>
                )}
              </div>
            );
          })}
          {/* Mouse-only buttons that never take focus, so in-game keys can't re-trigger them. */}
          <div className="hud-buttons">
            {fullscreen && (
              <button
                className="icon-btn"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={fullscreen.toggle}
                title={fullscreen.on ? 'Leave fullscreen' : 'Fullscreen'}
                aria-label={fullscreen.on ? 'Leave fullscreen' : 'Fullscreen'}
                data-fullscreen
              >
                <PixelIcon name={fullscreen.on ? 'windowed' : 'fullscreen'} scale={2} />
              </button>
            )}
            <button
              className="icon-btn"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggleMute}
              title={`Mute (${muteKey})`}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <PixelIcon name={muted ? 'soundOff' : 'soundOn'} scale={2} />
            </button>
            <button
              className="icon-btn"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onPause}
              title={`Pause (${pauseKey})`}
              aria-label="Pause"
            >
              <PixelIcon name="pause" scale={3} />
            </button>
          </div>
        </div>
      </div>

      {hud.buffs.length > 0 && (
        <div className="buff-chips">
          {hud.buffs.map((b) => (
            <div
              key={b.id}
              className="buff-chip"
              data-buff={b.id}
              style={{ ['--buff' as string]: BUFF_INFO[b.id].color, ['--left' as string]: `${(b.left / b.total) * 360}deg` }}
            >
              <span className="buff-ring">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={ICON_PATHS[b.id]} />
                </svg>
              </span>
              <span className="buff-name">{BUFF_INFO[b.id].name}</span>
              <span className="buff-left">{Math.ceil(b.left)}s</span>
            </div>
          ))}
        </div>
      )}
      <UltimateCard ult={hud.ultimate} keyLabel={ultKey} onCast={onUltimate} />
      {hud.boss && (
        <div className={`boss-bar${hud.boss.enraged ? ' enraged' : ''}`}>
          <span className="boss-name">{hud.boss.name}</span>
          <div className="boss-track">
            <div className="fill" style={{ width: `${Math.max(0, (hud.boss.hp / hud.boss.maxHp) * 100)}%` }} />
          </div>
        </div>
      )}
      {!hud.boss && hud.bossIncoming !== null && (
        <div className="boss-incoming">Archmage arrives in {Math.ceil(hud.bossIncoming)}s</div>
      )}
      {(hud.rift || hud.curse > 0) && (
        <div className="site-status">
          {hud.rift && (
            <span className="rift-status" data-rift>
              Rift: {hud.rift.kills} / {hud.rift.need} elites · {Math.ceil(hud.rift.left)}s
            </span>
          )}
          {hud.curse > 0 && <span className="curse-status">Cursed · foes hit harder · {Math.ceil(hud.curse)}s</span>}
        </div>
      )}
    </div>
  );
}
