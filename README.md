# Serpent Sorcery

A top-down action roguelite for desktop browsers. One hand steers a wizard snake that never stops moving; the other hand draws magic sigils with the mouse to cast spells. Survive as long as you can. Your snake grows longer and stronger, and the ruins send ever nastier foes, including a rival Archmage serpent at 5:00.

## Setup

Requires Node 18+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (recognizer, progression, persistence, movement, music, hit-stop, recap)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run playtest   # ~5 min end-to-end play-test in a headless Edge/Chrome
```

On Windows PowerShell with script execution disabled, `npm` itself is blocked (`npm.ps1 cannot be loaded`). Use `npm.cmd` instead (for example `npm.cmd run dev`), or run the commands from Command Prompt or Git Bash.

### End-to-end play-test

`npm run playtest` starts its own dev server and drives an installed Edge or Chrome with real browser input through the DevTools Protocol. Keys are actually held down while the mouse draws multi-point strokes. It checks:

- steering, diagonals, U-turns, and the heading staying put after keys are released
- drawing V, circle and line sigils *while* steering
- aiming from the current head, cooldown feedback, rejected scribbles and clicks
- Escape, focus loss and resize handling
- every sound sample loading, music start/mute/duck/slider behavior
- the boss warning hushing the music, the boss theme crossfading in, the freeze and slow motion when the boss dies, and the main theme returning
- an autopilot run with level-ups through death, music layers building as the arena fills, the death recap, the reward banked once, and an instant restart
- shop purchases and reload persistence
- a 400-action random keyboard/mouse fuzz asserting that permanent upgrades only change through a "Learn" click

Screenshots and `results.json` go to `playtest-output/`. Set `PLAYTEST_BROWSER` to use a different Chromium-based browser and `AUTOPILOT_SECONDS` to shorten the run.

## Controls

| Input | Action |
| --- | --- |
| **W A S D** (or arrows) | Point the snake up / left / down / right. Hold two for diagonals. Release to keep the current heading. |
| **Hold left mouse** | Draw a sigil anywhere over the arena. Where you *press* becomes the aim target. |
| **Release** | Recognize the sigil and cast. |
| **Esc** | Pause / resume (focus loss also pauses) |
| **M** | Mute everything (volume sliders are on the title screen and pause menu) |
| **P** | Switch art style (Classic / Pixel), even mid-run |
| **1 / 2 / 3** | Pick a level-up card |
| **R / Enter** | Play again from the game-over screen |

### Sigils

| Draw | Spell | Effect |
| --- | --- | --- |
| Straight line (any direction) | **Arcane Bolt** | Fast projectile from the head toward your target; hits the first enemy (more with Piercing). |
| V (opening roughly upward, tilt up to ~60°) | **Forked Lightning** | Strikes an enemy near the aimed direction, then chains to nearby enemies. |
| Circle (either direction) | **Arcane Nova** | Shockwave centered on the snake. Knocks enemies back and dispels enemy shots. |

**Aiming is independent of the stroke's shape.** On mouse-down the cursor's arena position is recorded and marked with a reticle, with a faint dashed guide from the head. On release, Bolt and Lightning fire from the snake's **current** head toward that recorded point, so the snake can keep moving while you draw. If you press within ~48 units of the head, spells fire along the current heading instead.

Each spell has its own cooldown. An unrecognized stroke shows "Sigil unclear" and costs nothing. A recognized spell that is still recharging shows "… recharging 1.2s" and shakes its HUD card. Tiny drags and clicks are ignored silently.

## Gesture recognition

All in `src/game/gesture.ts`. It is local, deterministic and has no dependencies:

1. **Reject tiny strokes**: a bounding box under 26 px or a path under 40 px counts as a click.
2. **Resample** to 64 points equally spaced along the path, so drawing speed doesn't matter. Then **smooth** lightly to remove hand jitter.
3. **Normalize**: move the centroid to the origin and scale *uniformly* by the larger bounding-box side, which keeps proportions (a thin line stays thin).
4. **Extract rotation-invariant features**: straightness (chord / path length), PCA elongation, signed and absolute turning, closure gap, radial spread, and the corner found at maximum deviation from the chord.
5. **Score each sigil.** Each one has hard gates plus a confidence score:
   - *Line*: very straight, very thin, tiny deviation from its chord.
   - *Circle*: turns 270–610° consistently one way, ends near its start, roundish, even radius.
   - *V*: one corner splitting the stroke into two straight legs of comparable length, opening between 14° and 122°, and the opening points up the screen within ±62°.
6. The best sigil wins. Nothing above 0.5 means **unclear**. Two candidates within 0.08 of each other means **ambiguous**, which also shows "Sigil unclear".

The tests in `src/game/__tests__/gesture*.test.ts` include a sweep of 300 randomized, noisy hand-drawn strokes per shape. Current results: lines 100%, circles 98%, Vs 100%, zero misclassifications, and fewer than 2% of random scribbles accepted.

## Music

The soundtrack is an original chiptune score, synthesized live with WebAudio (pulse-wave lead and arpeggio, triangle bass, noise drums), so it adds nothing to the download and reacts to the game:

| When | What plays |
| --- | --- |
| Title, shop, game over | **Calm** arrangement of the main theme ("Sigil of the Serpent", D minor, 132 BPM): bass, arpeggio and melody |
| Early in a run | Driving bass, arpeggio, melody and hi-hats |
| The arena fills up | Drums join, then a harmony line, busier hats and snare fills. Driven by enemy load (heavier enemies count more), a slow build over the first two minutes and low health, with hysteresis so layers don't flicker |
| Boss warning | Melody and drums drop out |
| Boss fight | The **"Ouroboros"** theme (150 BPM, galloping bass) crossfades in on the beat; it adds harmony when the boss is enraged |
| Boss defeated | Back to the main theme |
| Death | Silence |

Layer changes land on the next bar line, so they sound like part of the song.

- **Starting:** browsers only allow audio after a user gesture, so it starts on your first click or key press.
- **Pausing:** it plays quieter while the game is paused and stops while the tab is hidden.
- **Volume:** the title screen and pause menu have **Music** and **Effects** sliders (0–100%, saved). Music at 0% turns it off. Dragging Effects plays a short blip so you can hear the level.
- **Quick mute:** **M** or the speaker button in the HUD mutes everything without moving the sliders.
- **Where it lives:** the notes, chords and patterns are data in `src/game/music/score.ts`; the instruments are in `synth.ts`; `player.ts` schedules them and holds the layer balance (`LAYER_LEVEL`). The overall loudness at 100% is `MUSIC_MAX` in `src/game/audio.ts` (the default 55% matches the old "Pixel Kingdom" track's loudness), and the paused level is `MUSIC_DUCKED`.

## Sound effects

Effects are samples from Kenney's free CC0 packs (Impact, Sci-Fi, Interface and RPG sounds), in `src/assets/sfx/` with the license note. Frequent sounds pick between several variants with slightly randomized pitch, and crystal pickups climb a pentatonic scale while you keep collecting. Each effect's level was matched to the loudness of the synthesized effect it replaced. The synthesized versions remain as a fallback for browsers that can't decode Ogg Vorbis, and for the moment before the samples load. Layers, files and gains are in `src/game/sfx.ts`.

## Game feel

- **Hit-stop:** the action freezes for a few hundredths of a second when you get hurt, kill a brute or rival snake, chain lightning through 4+ foes or hit 6+ with one Nova. Killing the boss freezes for 0.45 s and then plays out in slow motion. Small freezes are rationed so a busy fight doesn't stutter. Timings are `HIT_STOP` in `config.ts`.
- **Death recap:** the game-over screen names the blow that ended the run, shows each spell's damage (overkill not counted), kills and casts, and what hurt you most.

## Art styles

There are two complete looks, switched with **P**, the title-screen button or the pause menu. The choice is saved.

- **Classic** draws smooth vector art with soft glows.
- **Pixel** renders the arena on a 560×320 canvas (1 pixel = 2.5 arena units) and upscales it by a whole-number factor: ×2 at 1280×720, ×3 at 1920×1080. Very small windows fall back to fractional scaling.
  - **Sprites** are generated in code with hard edges, a 1px outline and top-left rim lighting. Heads are drawn at 16 headings. Floor tiles, the rune circle and torch light are generated once from a fixed seed.
  - **Effects** use per-pixel lines and circles plus ordered (Bayer) dithering: charge lanes, lightning, Nova, enemy shots, crystals, particles and portals.
  - **Overlay:** the sigil trail and hurt flash are drawn on a screen-sized overlay that lines up with the same pixel grid.
  - **HUD and menus** switch to pixel fonts (Silkscreen, Pixelify Sans), stepped panels and bitmap icons.

The pixel art lives in `src/game/pixel/`: `palette.ts`, `bake.ts` (sprite rasterizer), `sprites.ts`, `floor.ts` and `draw.ts`. The menu pieces are in `src/ui/art.tsx`. Pixel size is `PIXEL_ART.worldPerPixel` in `config.ts`.

## Where to tune balance

**`src/game/config.ts`** holds every balance value:

- `SNAKE`: speed, turn rate, segment spacing and growth, health, invulnerability, pickup radius, aim fallback distance
- `SPELLS`: damage, cooldowns and their minimums, speeds, chain counts and range, Nova radius
- `HIT_STOP`: freeze lengths, what counts as a big hit, boss-kill slow motion
- `ENEMIES`: per-type health, speed, damage, XP, telegraph timings, boss attack patterns
- `DIRECTOR`: spawn rate curve, alive cap, enemy-type unlock times, boss timing, difficulty scaling over time
- `PROGRESSION`: XP curve, passive survival XP, crystal cap
- `REWARDS`: Arcane Shards per 10 s survived, per kill, per level and per boss

Run upgrades (stack sizes and per-level effects) and permanent upgrades (costs and caps) are in **`src/game/progression.ts`**.

## Project layout

```
src/game/            framework-free game code (no React)
  config.ts          balance values
  engine.ts          Game class: fixed-timestep loop, phases, gesture → spell, events to React
  snake.ts           player movement, path trail for body segments, wall bounce
  input.ts           keyboard + pointer capture, clears on blur/resize/pause
  gesture.ts         sigil recognizer
  spells.ts          Bolt / Lightning / Nova casting and updates, aim logic
  enemies.ts         spawn director, scaling, AI for chasers/casters/brutes/rivals/boss
  combat.ts          damage, deaths, crystals, contacts, enemy shots
  progression.ts     XP curve, run upgrades, rewards, permanent upgrades
  persistence.ts     validated localStorage save, award-once commit
  recap.ts           per-run spell and damage statistics for the game-over screen
  render.ts          Canvas 2D renderer (cached background, glow sprites)
  effects.ts         capped particles, floating text, screen shake, hit-stop
  audio.ts           WebAudio context, volumes, sample loading, music scheduling
  sfx.ts             sound-effect samples and the synthesized fallback
  music/             score (themes as data), synth instruments, player, intensity
src/ui/              React screens, HUD and overlays
```

The animation loop and all fast-changing state live in `Game` outside React. React gets phase changes, level-up offers, run results, and a HUD snapshot throttled to 20 Hz. The simulation runs at a fixed 120 Hz step, so movement, cooldowns and spawns don't depend on frame rate.

## Saves

Saved in `localStorage` under `serpent-sorcery-save-v1`: Arcane Shards, permanent upgrade levels, records (best time, level, kills, run count), and mute/volume. Every field is validated and clamped on load. Missing or corrupt data falls back to defaults field by field. Each run has a unique id, and the reward is banked only if that id hasn't been committed before, so a run can never pay out twice.
