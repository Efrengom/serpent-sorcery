import type { HudSnapshot } from '../game/engine';
import { formatTime } from '../game/math';
import { PixelIcon, usePixelArt } from './art';
import { useKeyLabel } from './Options';
import { SigilIcon, SPELL_UI } from './SigilIcon';

interface Props {
  hud: HudSnapshot | null;
  muted: boolean;
  onPause(): void;
  onToggleMute(): void;
}

export function Hud({ hud, muted, onPause, onToggleMute }: Props) {
  const pixel = usePixelArt();
  const muteKey = useKeyLabel('mute');
  const pauseKey = useKeyLabel('pause');
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
          </div>
        </div>

        <div className="hud-center">
          <div className="clock">{formatTime(hud.time)}</div>
          <div className="kills">
            {hud.kills} defeated
            {hud.depth > 1 && <span className="depth"> · Depth {hud.depth}</span>}
          </div>
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
            <button
              className="icon-btn"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggleMute}
              title={`Mute (${muteKey})`}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {pixel ? <PixelIcon name={muted ? 'soundOff' : 'soundOn'} scale={2} /> : muted ? '🔇' : '🔊'}
            </button>
            <button
              className="icon-btn"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onPause}
              title={`Pause (${pauseKey})`}
              aria-label="Pause"
            >
              {pixel ? <PixelIcon name="pause" scale={3} /> : '❚❚'}
            </button>
          </div>
        </div>
      </div>

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
    </div>
  );
}
