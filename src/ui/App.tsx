import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { audio } from '../game/audio';
import { buyMeta, commitRunResult, loadSave, writeSave, type RunResult, type SaveData } from '../game/persistence';
import type { MetaId } from '../game/progression';
import { PixelArtContext, pixelFloorUrl } from './art';
import { GameView } from './GameView';
import { HowToPlay, ShopScreen, TitleScreen } from './Menus';

type Screen = 'title' | 'howto' | 'shop' | 'game';

export function App() {
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const [screen, setScreen] = useState<Screen>('title');
  const [gameKey, setGameKey] = useState(0);
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
    writeSave(save);
  }, [save]);

  useEffect(() => {
    audio.setMuted(save.settings.muted);
    audio.setVolume(save.settings.volume);
    audio.setMusicVolume(save.settings.musicVolume);
  }, [save.settings.muted, save.settings.volume, save.settings.musicVolume]);

  // Browsers only allow audio after a user gesture.
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const toggleMute = useCallback(() => {
    setSave((s) => ({ ...s, settings: { ...s.settings, muted: !s.settings.muted } }));
  }, []);

  const toggleArt = useCallback(() => {
    setSave((s) => ({ ...s, settings: { ...s.settings, pixelArt: !s.settings.pixelArt } }));
  }, []);

  const setMusicVolume = useCallback((v: number) => {
    setSave((s) => ({ ...s, settings: { ...s.settings, musicVolume: v } }));
  }, []);

  // A short blip while dragging the Effects slider lets you hear the new level.
  const lastBlip = useRef(0);
  const setEffectsVolume = useCallback((v: number) => {
    audio.setVolume(v);
    const now = performance.now();
    if (v > 0 && now - lastBlip.current > 120) {
      lastBlip.current = now;
      audio.play('select');
    }
    setSave((s) => ({ ...s, settings: { ...s.settings, volume: v } }));
  }, []);

  const volume = {
    music: save.settings.musicVolume,
    effects: save.settings.volume,
    muted: save.settings.muted,
    onMusic: setMusicVolume,
    onEffects: setEffectsVolume,
    onUnmute: toggleMute,
  };

  // M and P work on menu screens too (the game handles them while playing).
  useEffect(() => {
    if (screen === 'game') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'KeyM') toggleMute();
      if (e.code === 'KeyP') toggleArt();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, toggleMute, toggleArt]);

  /** Called once per finished run by the engine; idempotent per run id. */
  const commitRun = useCallback((result: RunResult) => {
    const outcome = commitRunResult(saveRef.current, result);
    saveRef.current = outcome.save;
    setSave(outcome.save);
    return outcome;
  }, []);

  const buy = useCallback((id: MetaId) => {
    const next = buyMeta(saveRef.current, id);
    if (next) {
      saveRef.current = next;
      setSave(next);
      audio.play('select');
    }
  }, []);

  const pixel = save.settings.pixelArt;

  const play = useCallback(() => {
    setGameKey((k) => k + 1);
    setScreen('game');
  }, []);

  return (
    <PixelArtContext.Provider value={pixel}>
    <div
      className={`app${pixel ? ' pixel' : ''}`}
      style={pixel ? ({ '--pixel-floor': `url(${pixelFloorUrl()})` } as CSSProperties) : undefined}
    >
      {screen === 'title' && (
        <TitleScreen
          save={save}
          onPlay={play}
          onHowTo={() => setScreen('howto')}
          onShop={() => setScreen('shop')}
          onToggleMute={toggleMute}
          onToggleArt={toggleArt}
          volume={volume}
        />
      )}
      {screen === 'howto' && <HowToPlay onBack={() => setScreen('title')} onPlay={play} />}
      {screen === 'shop' && <ShopScreen save={save} onBuy={buy} onBack={() => setScreen('title')} onPlay={play} />}
      {screen === 'game' && (
        <GameView
          key={gameKey}
          meta={save.meta}
          muted={save.settings.muted}
          pixelArt={save.settings.pixelArt}
          volume={volume}
          totalCurrency={save.currency}
          onCommitRun={commitRun}
          onToggleMute={toggleMute}
          onToggleArt={toggleArt}
          onExit={setScreen}
        />
      )}
    </div>
    </PixelArtContext.Provider>
  );
}
