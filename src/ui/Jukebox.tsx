import { useState } from 'react';
import { audio } from '../game/audio';
import { MAP_ORDER, MAPS } from '../game/maps';
import type { MapId } from '../game/maps/types';
import { MUSIC_SCENES, themeFor, THEMES, type MusicScene } from '../game/music/score';

/**
 * Development only (open the game with ?jukebox): plays any map's music in any arrangement and
 * loop, over the menus or a run, for listening through the soundtrack without playing to it.
 * Release hands the music back to the game.
 */
export function Jukebox() {
  const [map, setMap] = useState<MapId>('ruins');
  const [scene, setScene] = useState<MusicScene>('run2');
  const [loop, setLoop] = useState(0);
  const [on, setOn] = useState(false);
  const play = (m: MapId, s: MusicScene, l: number) => {
    setMap(m);
    setScene(s);
    setLoop(l);
    setOn(true);
    audio.jukebox({ map: m, loop: l, scene: s });
  };
  const release = () => {
    setOn(false);
    audio.jukebox(null);
  };
  return (
    <div className="jukebox" aria-label="Jukebox">
      <div className="jukebox-title">Jukebox{on && `: ${THEMES[themeFor(map, scene)].title}`}</div>
      <div className="jukebox-row">
        {MAP_ORDER.map((m) => (
          <button key={m} className={`btn small${on && m === map ? ' on' : ''}`} data-jukebox-map={m} onClick={() => play(m, scene, loop)}>
            {MAPS[m].name}
          </button>
        ))}
      </div>
      <div className="jukebox-row">
        {MUSIC_SCENES.filter((s) => s !== 'silent').map((s) => (
          <button key={s} className={`btn small${on && s === scene ? ' on' : ''}`} data-jukebox-scene={s} onClick={() => play(map, s, loop)}>
            {s}
          </button>
        ))}
      </div>
      <div className="jukebox-row">
        {[0, 1, 2].map((l) => (
          <button key={l} className={`btn small${on && l === loop ? ' on' : ''}`} onClick={() => play(map, scene, l)}>
            Loop {l}
          </button>
        ))}
        <button className="btn small" disabled={!on} onClick={release}>
          Release
        </button>
      </div>
    </div>
  );
}
