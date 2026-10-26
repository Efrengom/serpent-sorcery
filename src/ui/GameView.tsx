import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { audio } from '../game/audio';
import { Game, type HudSnapshot, type LevelUpOffer, type Phase, type RelicOffer, type VictorySummary } from '../game/engine';
import type { RelicId } from '../game/relics';
import type { SiteOffer } from '../game/sites';
import type { CommitOutcome, RunResult } from '../game/persistence';
import type { GameOptions } from '../game/options';
import type { MetaLevels, UpgradeChoice } from '../game/progression';
import type { RunSetup } from '../game/world';
import { Hud } from './Hud';
import { GameOverPanel, LevelUpPanel, PauseMenu, RelicPanel, SitePanel, VictoryPanel } from './Overlays';
import type { VolumeControls } from './VolumeControls';

interface Props {
  meta: MetaLevels;
  /** Wizard and curses for the next run; a restart picks up the latest choice. */
  setup: RunSetup;
  muted: boolean;
  options: GameOptions;
  onOptions(patch: Partial<GameOptions>): void;
  volume: ComponentProps<typeof VolumeControls>;
  totalCurrency: number;
  onCommitRun(result: RunResult): CommitOutcome;
  onToggleMute(): void;
  onExit(to: 'title' | 'shop'): void;
}

/**
 * Hosts the canvas and the imperative Game. React only receives coarse events
 * (phase changes, level-up offers, run results) and a throttled HUD snapshot.
 */
export function GameView({
  meta,
  setup,
  muted,
  options,
  onOptions,
  volume,
  totalCurrency,
  onCommitRun,
  onToggleMute,
  onExit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [phase, setPhase] = useState<Phase>('playing');
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [levelUp, setLevelUp] = useState<LevelUpOffer | null>(null);
  const [relicOffer, setRelicOffer] = useState<RelicOffer | null>(null);
  const [victory, setVictory] = useState<VictorySummary | null>(null);
  const [siteOffer, setSiteOffer] = useState<SiteOffer | null>(null);
  const [over, setOver] = useState<{ result: RunResult; outcome: CommitOutcome } | null>(null);

  // Keep latest callbacks/props reachable from the long-lived Game without re-creating it.
  const latest = useRef({ meta, setup, options, onCommitRun, onToggleMute });
  latest.current = { meta, setup, options, onCommitRun, onToggleMute };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new Game(
      canvas,
      latest.current.meta,
      {
        onPhase: setPhase,
        onLevelUp: setLevelUp,
        onRelicOffer: setRelicOffer,
        onVictory: setVictory,
        onSiteOffer: setSiteOffer,
        onGameOver: (result) => {
          const outcome = latest.current.onCommitRun(result);
          setOver({ result, outcome });
        },
        onHud: setHud,
        onToggleMute: () => latest.current.onToggleMute(),
      },
      latest.current.setup,
      latest.current.options,
    );
    gameRef.current = game;
    game.start();
    // Console handle for play-testing in development builds only.
    const handle = window as unknown as { __serpent?: Game };
    if (import.meta.env.DEV) handle.__serpent = game;
    return () => {
      game.destroy();
      gameRef.current = null;
      if (handle.__serpent === game) delete handle.__serpent;
    };
  }, []);

  useEffect(() => {
    gameRef.current?.setOptions(options);
  }, [options]);

  // Music drops to a quieter level while paused.
  useEffect(() => {
    audio.duckMusic(phase === 'paused');
    return () => audio.duckMusic(false);
  }, [phase]);

  const choose = useCallback((c: UpgradeChoice) => {
    setLevelUp(null);
    gameRef.current?.chooseUpgrade(c);
  }, []);
  const chooseRelic = useCallback((r: RelicId | null) => {
    setRelicOffer(null);
    gameRef.current?.chooseRelic(r);
  }, []);
  const reroll = useCallback(() => gameRef.current?.rerollLevelUp(), []);
  const autoDraft = useCallback(() => {
    setLevelUp(null);
    gameRef.current?.autoDraft();
  }, []);
  const banish = useCallback((c: UpgradeChoice) => gameRef.current?.banishChoice(c), []);
  const skip = useCallback(() => {
    setLevelUp(null);
    gameRef.current?.skipLevelUp();
  }, []);

  const restart = useCallback(() => {
    setOver(null);
    setLevelUp(null);
    setRelicOffer(null);
    setVictory(null);
    setSiteOffer(null);
    gameRef.current?.restart(latest.current.meta, latest.current.setup);
  }, []);

  return (
    <div className="game-view">
      <canvas ref={canvasRef} className="game-canvas" />
      <Hud
        hud={hud}
        muted={muted}
        onPause={() => gameRef.current?.pause()}
        onToggleMute={onToggleMute}
        onUltimate={() => gameRef.current?.castUltimate()}
      />
      {phase === 'paused' && (
        <PauseMenu
          relics={hud?.relics ?? []}
          onResume={() => gameRef.current?.resume()}
          onEndRun={() => gameRef.current?.endRun()}
          options={options}
          onOptions={onOptions}
          volume={volume}
        />
      )}
      {phase === 'relic' && relicOffer && <RelicPanel offer={relicOffer} onChoose={chooseRelic} />}
      {phase === 'event' && siteOffer && <SitePanel offer={siteOffer} onChoose={(c) => gameRef.current?.chooseSite(c)} />}
      {phase === 'victory' && victory && (
        <VictoryPanel victory={victory} onClaim={() => gameRef.current?.claimVictory()} onPlayOn={() => gameRef.current?.playOn()} />
      )}
      {phase === 'levelup' && levelUp && (
        <LevelUpPanel offer={levelUp} onChoose={choose} onReroll={reroll} onBanish={banish} onSkip={skip} onAutoDraft={autoDraft} />
      )}
      {phase === 'gameover' && over && (
        <GameOverPanel
          result={over.result}
          outcome={over.outcome}
          totalCurrency={totalCurrency}
          onRestart={restart}
          onShop={() => onExit('shop')}
          onTitle={() => onExit('title')}
        />
      )}
    </div>
  );
}
