import type { CSSProperties } from 'react';
import { useKeyLabel } from './Options';

function Slider({ label, value, onChange }: { label: string; value: number; onChange(v: number): void }) {
  const pct = Math.round(value * 100);
  return (
    <label className="volume-row">
      <span className="volume-label">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        aria-label={`${label} volume`}
        style={{ '--fill': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span className="volume-value">{pct === 0 ? 'Off' : `${pct}%`}</span>
    </label>
  );
}

/** Music and sound-effects sliders, used on the title screen and in the pause menu. */
export function VolumeControls({
  music,
  effects,
  muted,
  onMusic,
  onEffects,
  onUnmute,
}: {
  music: number;
  effects: number;
  muted: boolean;
  onMusic(v: number): void;
  onEffects(v: number): void;
  onUnmute(): void;
}) {
  const muteKey = useKeyLabel('mute');
  return (
    <div className="volume-controls">
      <Slider label="Music" value={music} onChange={onMusic} />
      <Slider label="Effects" value={effects} onChange={onEffects} />
      {muted && (
        <button className="volume-muted" onClick={onUnmute}>
          All sound is muted — click or press {muteKey} to unmute
        </button>
      )}
    </div>
  );
}
