import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { audio } from '../game/audio';
import { buyMeta, commitRunResult, loadSave, optionsOf, writeSave, type RunResult, type SaveData } from '../game/persistence';
import type { CurseId } from '../game/curses';
import { bindingMap } from '../game/keys';
import type { GameOptions } from '../game/options';
import type { MetaId } from '../game/progression';
import { playableWizard, type WizardId } from '../game/wizards';
import type { RunSetup } from '../game/world';
import { PixelArtContext, pixelFloorUrl } from './art';
import { GameView } from './GameView';
import { HowToPlay, SetupScreen, ShopScreen, TitleScreen } from './Menus';
import { BindingsContext, OptionsScreen } from './Options';
import { PracticeScreen } from './Practice';

type Screen = 'title' | 'howto' | 'shop' | 'setup' | 'options' | 'practice' | 'game';

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

  // Menus get the calm arrangement; during a run the game picks the music.
  useEffect(() => {
    if (screen !== 'game') audio.setMusicScene('calm');
  }, [screen]);

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

  const options = useMemo(() => optionsOf(save.settings), [save.settings]);
  const setOptions = useCallback((patch: Partial<GameOptions>) => {
    setSave((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  // The mute and art keys work on menu screens too (the game handles them while playing).
  const bindings = save.settings.bindings;
  useEffect(() => {
    if (screen === 'game') return;
    const keys = bindingMap(bindings);
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const action = keys.get(e.code);
      if (action === 'mute') toggleMute();
      if (action === 'art') toggleArt();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, bindings, toggleMute, toggleArt]);

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

  const pickWizard = useCallback((wizard: WizardId) => {
    setSave((s) => ({ ...s, settings: { ...s.settings, wizard } }));
    audio.play('select');
  }, []);

  const toggleCurse = useCallback((id: CurseId) => {
    setSave((s) => {
      const on = s.settings.curses.includes(id);
      const curses = on ? s.settings.curses.filter((c) => c !== id) : [...s.settings.curses, id];
      return { ...s, settings: { ...s.settings, curses } };
    });
    audio.play('select');
  }, []);

  // A locked wizard (say, from an edited save) quietly falls back to the Arcanist.
  const setup: RunSetup = {
    wizard: playableWizard(save.settings.wizard, save.records),
    curses: save.settings.curses,
  };

  const pixel = save.settings.pixelArt;

  const play = useCallback(() => {
    setGameKey((k) => k + 1);
    setScreen('game');
  }, []);

  const toTitle = useCallback(() => setScreen('title'), []);

  return (
    <PixelArtContext.Provider value={pixel}>
    <BindingsContext.Provider value={bindings}>
    <div
      className={`app${pixel ? ' pixel' : ''}${options.reduceFlashing ? ' reduce-flash' : ''}`}
      style={pixel ? ({ '--pixel-floor': `url(${pixelFloorUrl()})` } as CSSProperties) : undefined}
    >
      {screen === 'title' && (
        <TitleScreen
          save={save}
          onPlay={play}
          onSetup={() => setScreen('setup')}
          onHowTo={() => setScreen('howto')}
          onShop={() => setScreen('shop')}
          onOptions={() => setScreen('options')}
          onPractice={() => setScreen('practice')}
          onToggleMute={toggleMute}
          onToggleArt={toggleArt}
          volume={volume}
        />
      )}
      {screen === 'howto' && <HowToPlay onBack={toTitle} onPlay={play} onPractice={() => setScreen('practice')} safeWarnings={options.safeWarnings} />}
      {screen === 'options' && <OptionsScreen options={options} onChange={setOptions} onBack={toTitle} />}
      {screen === 'practice' && <PracticeScreen onBack={toTitle} onPlay={play} />}
      {screen === 'shop' && <ShopScreen save={save} onBuy={buy} onBack={() => setScreen('title')} onPlay={play} />}
      {screen === 'setup' && (
        <SetupScreen
          save={save}
          onPickWizard={pickWizard}
          onToggleCurse={toggleCurse}
          onBack={() => setScreen('title')}
          onPlay={play}
        />
      )}
      {screen === 'game' && (
        <GameView
          key={gameKey}
          meta={save.meta}
          setup={setup}
          muted={save.settings.muted}
          pixelArt={save.settings.pixelArt}
          options={options}
          onOptions={setOptions}
          volume={volume}
          totalCurrency={save.currency}
          onCommitRun={commitRun}
          onToggleMute={toggleMute}
          onToggleArt={toggleArt}
          onExit={setScreen}
        />
      )}
    </div>
    </BindingsContext.Provider>
    </PixelArtContext.Provider>
  );
}
