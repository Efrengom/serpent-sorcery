import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { audio } from '../game/audio';
import { Game, type HudSnapshot, type Phase } from '../game/engine';
import type { CommitOutcome, RunResult } from '../game/persistence';
import type { MetaLevels, UpgradeChoice } from '../game/progression';
import type { RunSetup } from '../game/world';
import { Hud } from './Hud';
import { GameOverPanel, LevelUpPanel, PauseMenu } from './Overlays';
import type { VolumeControls } from './VolumeControls';

interface Props {
  meta: MetaLevels;
  /** Wizard and curses for the next run; a restart picks up the latest choice. */
  setup: RunSetup;
  muted: boolean;
  pixelArt: boolean;
  volume: ComponentProps<typeof VolumeControls>;
  totalCurrency: number;
  onCommitRun(result: RunResult): CommitOutcome;
  onToggleMute(): void;
  onToggleArt(): void;
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
  pixelArt,
  volume,
  totalCurrency,
  onCommitRun,
  onToggleMute,
  onToggleArt,
  onExit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [phase, setPhase] = useState<Phase>('playing');
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [levelUp, setLevelUp] = useState<{ level: number; choices: UpgradeChoice[] } | null>(null);
  const [over, setOver] = useState<{ result: RunResult; outcome: CommitOutcome } | null>(null);

  // Keep latest callbacks/props reachable from the long-lived Game without re-creating it.
  const latest = useRef({ meta, setup, pixelArt, onCommitRun, onToggleMute, onToggleArt });
  latest.current = { meta, setup, pixelArt, onCommitRun, onToggleMute, onToggleArt };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new Game(
      canvas,
      latest.current.meta,
      {
        onPhase: setPhase,
        onLevelUp: (level, choices) => setLevelUp({ level, choices }),
        onGameOver: (result) => {
          const outcome = latest.current.onCommitRun(result);
          setOver({ result, outcome });
        },
        onHud: setHud,
        onToggleMute: () => latest.current.onToggleMute(),
        onToggleArt: () => latest.current.onToggleArt(),
      },
      latest.current.pixelArt,
      latest.current.setup,
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
    gameRef.current?.setPixelArt(pixelArt);
  }, [pixelArt]);

  // Music drops to a quieter level while paused.
  useEffect(() => {
    audio.duckMusic(phase === 'paused');
    return () => audio.duckMusic(false);
  }, [phase]);

  const choose = useCallback((c: UpgradeChoice) => {
    setLevelUp(null);
    gameRef.current?.chooseUpgrade(c);
  }, []);

  const restart = useCallback(() => {
    setOver(null);
    setLevelUp(null);
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
      />
      {phase === 'paused' && (
        <PauseMenu
          pixelArt={pixelArt}
          onResume={() => gameRef.current?.resume()}
          onEndRun={() => gameRef.current?.endRun()}
          onToggleArt={onToggleArt}
          volume={volume}
        />
      )}
      {phase === 'levelup' && levelUp && (
        <LevelUpPanel level={levelUp.level} choices={levelUp.choices} onChoose={choose} />
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
