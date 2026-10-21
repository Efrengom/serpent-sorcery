# Serpent Sorcery

A top-down action roguelite for desktop browsers. One hand steers a wizard snake that never stops moving; the other hand draws magic sigils with the mouse to cast spells. Survive as long as you can. Your snake grows longer and stronger, learns new sigils and evolves its spells, and the ruins send ever nastier foes, including a rival Archmage serpent at 5:00. Defeat it and the floor cracks open into ever deeper, harder depths. Before each run you pick a wizard and, if you dare, curses that raise the reward.

## Setup

Requires Node 18+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (recognizer, progression, persistence, movement, music, hit-stop, recap, spells, depth, clean casts, Constrict)
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
- drawing an unlearned triangle, then learning the triangle and zigzag sigils from level-up cards and casting them with real strokes, the ward blocking a real hit, frost slowing a foe, and an evolution card turning Arcane Bolt into Arcane Lance
- descending to Depth 2 (the Ember Depths) after the boss falls
- the trail reading a real V's first leg as a line and the finished stroke as a V, a careful V casting as Perfect or Clean, and a real WASD circle around a brute showing the loop hint and then Constricting it
- an autopilot run with level-ups through death, music layers building as the arena fills, the death recap, the reward banked once, and an instant restart
- the setup screen: locked and unlocked wizards, picking Frostcoil and a curse with real clicks, the run starting with them, and the curse multiplying the banked shards
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
| **Enter** (title) | Play with the saved wizard and curses; **Wizard & Curses** changes them |
| **R / Enter** | Play again from the game-over screen |

### Sigils

| Draw | Spell | Effect |
| --- | --- | --- |
| Straight line (any direction) | **Arcane Bolt** | Fast projectile from the head toward your target; hits the first enemy (more with Piercing). |
| V (opening roughly upward, tilt up to ~60°) | **Forked Lightning** | Strikes an enemy near the aimed direction, then chains to nearby enemies. |
| Circle (either direction) | **Arcane Nova** | Shockwave centered on the snake. Knocks enemies back and dispels enemy shots. |
| Triangle (any rotation, either way round) | **Arcane Ward** | A shield around the head that blocks the next hit (walls still sting) and shoves nearby foes away, for 8 s. |
| Zigzag (Z, N, W or longer, any direction) | **Frost Field** | Freezing ground at your target for 5 s: foes inside move and attack at 45% speed, take damage over time, and enemy shots crawl through it. |

Each wizard starts a run knowing three sigils. Drawing one you haven't learned says so and costs nothing. From level 3, level-up cards offer the missing sigils (guaranteed on levels 3, 6, 9 and so on while any are unknown); their own upgrades (Warding Runes, Deep Frost) only appear once you know them.

**Aiming is independent of the stroke's shape.** On mouse-down the cursor's arena position is recorded and marked with a reticle, with a faint dashed guide from the head. On release, Bolt and Lightning fire from the snake's **current** head toward that recorded point, and Frost Field lands on it, so the snake can keep moving while you draw. If you press within ~48 units of the head, spells fire along the current heading instead.

**Clean casts.** While you draw, the stroke is read about 16 times a second: the trail takes the colour of the spell it currently reads as (grey if you haven't learned it), and a label by the pen names it and how cleanly it's drawn. On release, a **Perfect** sigil casts at +35% power and a **Clean** one at +15% (damage, plus duration for the Ward and size for Frost Field). The grade comes from the recognizer's confidence, compared with per-sigil thresholds in `CLEAN_CAST` (each sigil's scores spread differently: a careful line scores about 0.99, a careful circle about 0.88). They were set from thousands of randomized strokes so that Perfect is roughly the best third of careful strokes. The game-over recap counts your perfect and clean sigils.

Each spell has its own cooldown. An unrecognized stroke shows "Sigil unclear" and costs nothing. A recognized spell that is still recharging shows "… recharging 1.2s" and shakes its HUD card. Tiny drags and clicks are ignored silently.

## Gesture recognition

All in `src/game/gesture.ts`. It is local, deterministic and has no dependencies:

1. **Reject tiny strokes**: a bounding box under 26 px or a path under 40 px counts as a click.
2. **Resample** to 64 points equally spaced along the path, so drawing speed doesn't matter. Then **smooth** lightly to remove hand jitter.
3. **Normalize**: move the centroid to the origin and scale *uniformly* by the larger bounding-box side, which keeps proportions (a thin line stays thin).
4. **Extract rotation-invariant features**: straightness (chord / path length), PCA elongation, signed and absolute turning, closure gap, radial spread, the corner found at maximum deviation from the chord, and **sharp corners**: peaks of the turning summed over a 5-point window, plus the share of all turning that happens at them.
5. **Score each sigil.** Each one has hard gates plus a confidence score:
   - *Line*: very straight, very thin, tiny deviation from its chord.
   - *Circle*: turns 270–610° consistently one way, ends near its start, roundish, even radius.
   - *V*: one corner splitting the stroke into two straight legs of comparable length, opening between 14° and 122°, and the opening points up the screen within ±62°.
   - *Triangle*: the stroke closes on itself (overshooting past the start is fine), most of its turning happens at corners, and it simplifies to a three-sided polygon with no interior angle wider than 125° and no side under 30% of the longest. The polygon is fitted from the two most distant points, so it doesn't matter where on the triangle you start, and wobble vertices, overshoot spikes and near-duplicate corners are merged away.
   - *Zigzag*: an open stroke with 2 to 4 sharp corners (70°+) that turn alternately left and right, joined by straight legs of comparable length. A tiny hook at either end is ignored.
   - Circles are rejected if they have two or more really sharp (85°+) corners, which keeps triangles from reading as circles.
6. The best sigil wins. Nothing above 0.5 means **unclear**. Two candidates within 0.08 of each other means **ambiguous**, which also shows "Sigil unclear".

The tests in `src/game/__tests__/gesture*.test.ts` include a sweep of 300 randomized, noisy hand-drawn strokes per shape: triangles of varied shape started at a corner or mid-side with a gap or overlap, and zigzags of 3 to 5 legs at any rotation. Across three seeds (900 strokes per shape): lines 100%, circles 96–99%, Vs 100%, triangles 99–100%, zigzags 99%, zero strokes read as the wrong sigil, and about 1% of random scribbles accepted.

## Constrict

Once the serpent is long enough to bend into a full loop (about 22 segments, around level 6; a banner announces it), **loop your body around foes to crush them**. The loop closes when the head comes back within 30 units of a body point at least 10 segments back. Every foe inside takes 45 damage (scaled by spell damage), is held still for 1.1 s (bosses shrug that off) and is pulled toward the middle. As the head comes around a loop that would catch foes, a dashed line shows the gap left to close. Loops with nothing inside do nothing, and crushes are at least 1.2 s apart. Constrict has its own row in the game-over recap. Tuning is `CONSTRICT` in `config.ts` and the logic is in `src/game/constrict.ts`.

The serpent now starts with 8 segments and grows 3 per level (it used to be 6 and 2) so Constrict arrives mid-run. The body is still harmless to you and to enemies, so a longer serpent has no downside.

## Spell evolutions

When a spell's own upgrade is maxed and its partner upgrade has 2 ranks, the next level-up includes a golden card that evolves it (the HUD card then shows the new name):

| Spell | Needs | Becomes |
| --- | --- | --- |
| Arcane Bolt | Piercing Bolt max + Arcane Potency 2 | **Arcane Lance**: instant beams (one per Split Bolt projectile) that pierce everything in a line for 1.8× damage |
| Forked Lightning | Forked Chains max + Quickened Runes 2 | **Tempest**: chains to 3 more foes, then strikes again 0.3 s later |
| Arcane Nova | Nova Expanse max + Serpent Vitality 2 | **Supernova**: a second, 1.5× wider ring follows, and each foe hit heals 1 (up to 20 per ring) |
| Arcane Ward | Warding Runes max + Shed Skin 2 | **Aegis**: lasts 4 s longer, and every blocked hit fires 8 bolts outward |
| Frost Field | Deep Frost max + Crystal Magnetism 2 | **Glacier**: foes entering the field freeze solid for 1.2 s and take 40% more damage while chilled |

## Wizards

Chosen on the **Wizard & Curses** screen (reached from the title) and remembered between runs. Each has its own colours in both art styles.

| Wizard | Starting sigils | Perks | Unlock |
| --- | --- | --- | --- |
| **Arcanist** | Line, V, Circle | Balanced | Always |
| **Frostcoil** | Line, Zigzag, Circle | +20% Frost Field radius | Survive 3:00 |
| **Wardscale** | Line, Triangle, V | +25 max health, the ward blocks one more hit | Reach level 10 |
| **Stormtongue** | V, Line, Zigzag | +20% spell damage, lightning chains once more, −25 max health | Defeat Ouroboros |

## Curses

Optional handicaps toggled on the same screen. Each adds to the run's shard multiplier, shown on the setup screen and the game-over screen (capped at ×3):

| Curse | Effect | Bonus |
| --- | --- | --- |
| Frenzied Foes | Enemies move and attack 25% faster | +25% |
| Glass Scales | 40% less max health | +30% |
| Swarming Ruins | Enemies spawn 40% faster and more can be out at once | +30% |
| Sluggish Sigils | Spell cooldowns 30% longer | +25% |
| Champions' Hunt | Elites appear from the start, and more often | +20% |
| Impatient Archmage | The boss arrives at 3:30, and every 3:30 after | +20% |

## Depths and elites

The run never ends on its own. Each Archmage defeated takes you one **depth** deeper (shown next to the kill count). The first descent turns the arena into the **Ember Depths**: scorched red stone, ash and glowing lava cracks, in both art styles. Every depth adds 35% enemy health, 20% damage, 15% spawn rate and room for 12 more foes, and the boss keeps returning stronger.

From Depth 2, spawns can be **elites** (10% at Depth 2, +5% per depth, up to 35%): bigger, 1.6× health, 2.5× experience, a crown marker and one modifier:

- **Shielded**: a hexagonal barrier worth 80% of its health soaks damage and knockback until it breaks.
- **Swift**: lives on a 1.45× faster clock, so it moves, winds up and attacks faster.
- **Splitting**: bursts into two smaller fragments when it dies.

Frost works the same way in reverse: enemies inside a field run on a slower clock, which slows their attack wind-ups too. The game-over recap also counts hits the ward blocked, elites slain and the depth reached.

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
- `SPELLS.ward`, `SPELLS.frost`: the new spells' cooldowns, duration, charges, slow, damage
- `EVOLUTIONS`, `EVOLUTION_PARTNER_RANKS`: what each evolution needs and does
- `DEPTH`, `ELITE`: per-depth scaling and elite chances and modifiers
- `CLEAN_CAST`: per-sigil Perfect and Clean thresholds and their power bonus
- `CONSTRICT`: loop closing distance, damage, hold, pull and cooldown
- `ENEMIES`: per-type health, speed, damage, XP, telegraph timings, boss attack patterns
- `DIRECTOR`: spawn rate curve, alive cap, enemy-type unlock times, boss timing, difficulty scaling over time
- `PROGRESSION`: XP curve, passive survival XP, crystal cap
- `REWARDS`: Arcane Shards per 10 s survived, per kill, per level and per boss

Run upgrades (stack sizes and per-level effects), the level-up offer (when new sigils and evolutions appear) and permanent upgrades (costs and caps) are in **`src/game/progression.ts`**. Wizards are in **`src/game/wizards.ts`** and curses in **`src/game/curses.ts`**.

## Project layout

```
src/game/            framework-free game code (no React)
  config.ts          balance values
  engine.ts          Game class: fixed-timestep loop, phases, gesture → spell, events to React
  snake.ts           player movement, path trail for body segments, wall bounce
  input.ts           keyboard + pointer capture, clears on blur/resize/pause
  gesture.ts         sigil recognizer
  spells.ts          all five spells and their evolutions, frost and swift time scaling, aim logic
  enemies.ts         spawn director, depth scaling, elites, AI for chasers/casters/brutes/rivals/boss
  combat.ts          damage, deaths, crystals, contacts, enemy shots
  progression.ts     XP curve, run upgrades, rewards, permanent upgrades
  persistence.ts     validated localStorage save, award-once commit
  recap.ts           per-run spell and damage statistics for the game-over screen
  wizards.ts         playable wizards: starting sigils, perks, colours, unlocks
  curses.ts          optional pre-run curses and the shard multiplier
  cast.ts            clean-cast grading from the recognizer's confidence
  constrict.ts       loop detection and the Constrict crush
  render.ts          Canvas 2D renderer (cached background, glow sprites)
  effects.ts         capped particles, floating text, screen shake, hit-stop
  audio.ts           WebAudio context, volumes, sample loading, music scheduling
  sfx.ts             sound-effect samples and the synthesized fallback
  music/             score (themes as data), synth instruments, player, intensity
src/ui/              React screens, HUD and overlays
```

The animation loop and all fast-changing state live in `Game` outside React. React gets phase changes, level-up offers, run results, and a HUD snapshot throttled to 20 Hz. The simulation runs at a fixed 120 Hz step, so movement, cooldowns and spawns don't depend on frame rate.

## Saves

Saved in `localStorage` under `serpent-sorcery-save-v1`: Arcane Shards, permanent upgrade levels, records (best time, level, kills, run count, lifetime bosses defeated), mute/volume, and the chosen wizard and curses. A locked wizard in the save falls back to the Arcanist. Every field is validated and clamped on load. Missing or corrupt data falls back to defaults field by field. Each run has a unique id, and the reward is banked only if that id hasn't been committed before, so a run can never pay out twice.
