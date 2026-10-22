# Serpent Sorcery

A top-down action roguelite for desktop browsers. One hand steers a wizard snake that never stops moving; the other hand draws magic sigils with the mouse to cast spells. Survive as long as you can across four maps, each several screens across, where the camera follows the serpent and every pillar, wall and fallen statue hurts to run into. Your snake grows longer and stronger, learns new sigils and evolves its spells, and each map sends ever nastier foes of its own, including a rival Archmage serpent at 5:00. Defeat it and a way down opens to the next map: from the Sunken Ruins to the Mycelium Hollows, the Rimefrost Catacombs and the Ember Depths, then round again, deeper and harder. Before each run you pick a wizard and, if you dare, curses that raise the reward.

## Setup

Requires Node 18+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (recognizer, progression, persistence, movement, music, hit-stop, recap, spells, depth, clean casts, Constrict, options, practice, maps, terrain, camera, navigation, breakables, buffs, descent, hazards, every map's foes and bosses, records)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run playtest   # ~6 min end-to-end play-test in a headless Edge/Chrome
npx vite-node scripts/balance.ts   # a bot plays every map headlessly; damage taken by kind, per map
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
- the boss's fall clearing the field and opening a way down (with an arrow while it's off-screen), and steering into it with a real key to reach Depth 2, the Mycelium Hollows, with its banner
- the big map: the camera following the serpent and Steady camera centring it, the aim staying on the world point pressed while the view scrolls, steering into a pillar with a real key (a bounce, 8 damage, recorded as the pillar), the boss clearing marked half a minute early with an arrow at the edge of the view, the minimap turned off and on with real clicks (checked in canvas pixels), a screenshot of every landmark in both styles, and frame times while the view races across the whole map; then each deeper map's landmarks in both styles and frame times racing across it, ice on the Frozen Lake halving the turn rate, and brambles in the Hollows stinging and named in the recap
- the trail reading a real V's first leg as a line and the finished stroke as a V, a careful V casting as Perfect or Clean, and a real WASD circle around a brute showing the loop hint and then Constricting it
- breakables: running into an urn smashes it for crystals, real Bolt strokes break a reliquary for a buff, the HUD chip counting down, Quickening speeding cooldowns by half, and a heart healing
- an autopilot run with level-ups through death, foes spawning just outside the view (never on screen) and staying around the serpent, breakables giving at most 15% of the XP, music layers building as the arena fills, the death recap, the reward banked once, and an instant restart
- the setup screen: the atlas showing the maps reached and the rest as silhouettes, locked and unlocked wizards, picking Frostcoil and a curse with real clicks, the run starting with them, and the curse multiplying the banked shards
- shop purchases and reload persistence
- the options screen: toggles, sliders and rebinding set with real clicks and keys and saved, a key taken from another action, Esc cancelling a rebind, the run steering with the new key (and not the old one), 50% game speed advancing the run at half speed, and canvas pixels showing a struck foe not flashing white with reduced flashing and a charge lane and a vent's circle painted in hazard yellow with colorblind-safe warnings
- the sigil practice room: the live reading while drawing, a V graded as Forked Lightning, a square drawn for the triangle explaining that it has 4 corners, and the tally of attempts
- a 400-action random keyboard/mouse fuzz asserting that permanent upgrades only change through a "Learn" click

Screenshots and `results.json` go to `playtest-output/`. Set `PLAYTEST_BROWSER` to use a different Chromium-based browser and `AUTOPILOT_SECONDS` to shorten the run.

## Controls

| Input | Action |
| --- | --- |
| **W A S D** (or arrows) | Point the snake up / left / down / right. Hold two for diagonals. Release to keep the current heading. |
| **Hold left mouse** | Draw a sigil anywhere over the map. Where you *press* becomes the aim target, and it stays on that spot of the map while the view scrolls. |
| **Release** | Recognize the sigil and cast. |
| **Esc** | Pause / resume (focus loss also pauses) |
| **M** | Mute everything (volume sliders are on the title screen and pause menu) |
| **P** | Switch art style (Classic / Pixel), even mid-run |
| **Space** (or **Q**) | Cast your wizard's ultimate once it's charged (or click its card at the bottom of the screen) |
| **Options** | Rebind every key above except Esc; see [Options](#options) |
| **1 / 2 / 3 / 4** | Pick a level-up card (or a relic on the way down) |
| **R / B / X** | On a level-up: reroll, banish a card, or skip it and heal |
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

## The maps

A run goes through four maps in order, one per Archmage: the **Sunken Ruins**, the **Mycelium Hollows**, the **Rimefrost Catacombs** and the **Ember Depths**, then round again, one depth deeper each time. They rise in what they ask of you: stone only, then stinging brambles and spore vents, then sliding ice, then lava and lobbed fire. The setup screen's atlas shows the maps you've reached; the rest are silhouettes.

| Map | Size | Landmarks | Hazards | Foes | Archmage |
| --- | --- | --- | --- | --- | --- |
| Sunken Ruins | 6400×3600 | Rune Plaza, Colonnade, Collapsed Hall, Fallen Colossus, Broken Gate | stone only | Chaser, Caster, Brute, rival serpent | Ouroboros |
| Mycelium Hollows | 7600×4200 | Glowcap Ring, Spore Grotto, Heartroot, Fallen Giant, Bramble Thicket | brambles, spore vents | Sporeling, Puffcap, Thornback, Burrow Viper | Sporemaw |
| Rimefrost Catacombs | 8000×4400 | Bell Court, Ossuary, Crypt of Kings, Frozen Lake | ice, falling icicles | Bone Rattler, Frost Archer, Crypt Golem, Wraith | Rimecoil |
| Ember Depths | 7200×4000 | Caldera, Lava Falls, Forge, Obsidian Spires | lava, eruption vents | Cinder Imp, Pyromancer, Magma Brute, Salamander | Pyrecoil |

The **Sunken Ruins** is an old temple complex 6400×3600 world units: about four views across and four and a half down. The view shows the same amount of the world as the old one-screen arena (800 units tall, as wide as the window allows up to 1600), so foes and spell ranges look the same. The camera follows the head, looking 120 units ahead of it and easing after it over a quarter of a second, and stops at the map's edges.

- **Landmarks** to steer by, marked on the minimap: the **Rune Plaza** in the middle (where every run starts) ringed by eight pillars, **The Colonnade** along the north, **The Collapsed Hall** to the west, **The Fallen Colossus** to the east and **The Broken Gate** across the south. Open courts in the four corners and the plaza are the boss clearings.
- **Stone hurts.** Running into anything solid (the boundary wall, a hall wall, a pillar, a toppled column, a statue, the colossus) bounces the serpent off at a clear angle, locks steering for 0.2 s and costs 8 health, like the old arena walls. The Ward doesn't block it. The death recap names what you hit ("a broken pillar").
- **Stone gives cover.** Walls and pillars stop enemy shots, Arcane Bolts and Arcane Lance beams. Forked Lightning arcs over them.
- **Foes find their way.** A flow field (40-unit cells, refreshed four times a second) leads them around walls to the serpent; with a clear line they come straight at you. Casters need a clear shot before they fire. A brute that charges into stone staggers 1.5× longer, so baiting one into a pillar is worth it.
- **Fair fights on a big map.** Foes spawn in a ring just outside the view, on open floor they can walk from, and never on screen. No foe starts an attack until it is on screen, so every telegraph is seen. Foes left far behind, or stuck out of sight, are brought back to the ring so the fight stays around you.
- **The boss** arrives in the clearing nearest you. Half a minute before, that clearing is marked on the ground and on the minimap, with an arrow at the edge of the view while it's off-screen; once the boss is out, the arrow points at it.
- **The way down.** When the Archmage falls, every other foe falls with it, every crystal flies to you, spawning stops and a way down opens where it fell (or on the nearest dry ground, if it fell in lava), with an arrow at the edge of the view. Steer into it, or after 15 s it pulls you in. The next map fades in with a banner naming its depth and a one-line tip; your level, upgrades and length carry over. Its foes unlock faster than the first map's (0, 20, 45 and 90 s after you arrive).
- **Breakables.** Containers never hurt. About 140 clay **urns** stand mostly along the stonework: run into one or hit it with any spell and it shatters into 2–3 XP of crystals, sometimes a heart (+20 health; twice as likely below 35% health) or, rarely, a buff. 24 gilded **reliquaries** stand against walls and by the landmarks: they're solid (you bump off them unhurt, foes can't pass and enemy shots stop at them) and take about three Bolts at depth 1, more deeper down. Each drops 8 XP, always a buff, and often a heart (a big one, +35% max health, when you're low). Bolts pass through urns without being used up. Bolt, Lance, Nova, Ward pulses, Frost Fields and Constrict all break them; Lightning only seeks foes, and foes never break anything. Most urns and every reliquary are there at the start; a broken slot refills after 60 s (urn) or 120 s (reliquary), once you're well away from it. Hearts wait on the ground while your health is full.
- **Buffs** show as chips under the health bar, counting down in game time: **Quickening** (cooldowns recover 50% faster, 15 s), **Empower** (+40% spell damage, on top of clean casts, 15 s), **Swiftscale** (+20% speed and turning, so the turning circle stays the same, 12 s) and **Stoneskin** (blocks the next hit from a foe, up to 30 s; stone still hurts). **Lodestone** pulls in every crystal on the map, and a **Shard Cache** adds 5 Arcane Shards (+2 per depth) to the run's reward, multiplied by curses. Picking up a buff you already have restarts it. The game-over recap counts what you smashed, health from pickups and buffs collected.
- **Varied per run:** a few optional clusters of statues, fallen columns and pillars come and go, and pillars sit a little differently each time.
- **Hazards.** Ground you touch always stings, even through the Ward and Stoneskin: **lava** (6), **brambles** (5) and **burning ground** (5) that some attacks leave. **Ice** never hurts but halves your turn rate, so turns are wider. Each map's **vents** (eruptions, spore puffs, falling icicles) go off under a circle that fills for a second first, only near the view; those are attacks, so the Ward and Stoneskin block them, and they hurt foes too. Foes path round stinging ground, but a map's own foes (and every boss) are at home in it; knocking others into it burns them. Every hazard has a pattern and outline, not just a colour, and colorblind-safe warnings stripe every circle.
- **New foes** each add one twist to an old one: Sporelings hop in packs; Puffcaps root and swell, then puff a fan of slow spores; Thornbacks charge and leave brambles; Burrow Vipers dive (they can't be hit underground) and erupt under where you're heading; Bone Rattlers struck down by a bolt or arc collapse and rise again in 3 s unless you hit the pile; Frost Archers draw a line, then loose an icicle down it; Crypt Golems slam a ring round themselves and leave ice; Wraiths drift through stone (taking less damage inside it) and lunge; Cinder Imps crouch and leap; Pyromancers lob fireballs over stone onto marked circles; Magma Brutes charge and leave lava; Salamanders breathe a cone of flame. Each Archmage keeps Ouroboros's body and swaps two moves: Sporemaw fans spores and burrows down its lane to erupt at the end, Rimecoil looses icicles down lines it draws and lays rings of ice round you, Pyrecoil rains meteors and leaves a trail of fire.

Maps are data in `src/game/maps/`: a text grid (one character per 200×200 cell: `#` wall, `.` floor, `b` boss clearing, `S` start, digits for landmarks, `~` lava, `%` brambles, `=` ice) plus freely placed pieces, hazards, vents and breakable slots. `validate.ts` checks the layout rules for every map and 50 seeds in a unit test: corridors at least 220 wide (the serpent turns in about 86), no narrow pockets, all floor reachable from the start (and all dry floor without crossing lava or brambles), 3 to 5 clearings at least 1000×700 within 1900 units of all dry ground, hazards clear of stone, clearings, vents and the start, and a clear start. The full plan for more maps is in [docs/maps-requirements.md](docs/maps-requirements.md).

## Options

**Options** on the title screen and in the pause menu. Every change applies at once, even mid-run, and is saved.

- **Screen shake**: 0 to 100%. 0 turns it off.
- **Reduce flashing**: blinking and strobing become steady or softer. Foes no longer flash white when hit; the serpent stays see-through while invulnerable instead of blinking; lightning holds one shape instead of re-jittering 30 times a second; the hurt flash is softer and the low-health warning stops pulsing; the Ward fades out instead of blinking; Constrict's flash, the boss's wind-up glow and the blinking interface cues (low health, enraged boss, a refused spell) calm down.
- **Colorblind-safe warnings**: attack previews switch from red to yellow-and-black hazard stripes with dark casings, and every foe winding up an attack gets a yellow "!". Charge lanes fill with stripes as the charge builds, aim lines become solid with an arrowhead, and the boss's volley ring gets a casing. The colours are told apart by brightness, which every kind of colour vision keeps. A test simulates protanopia, deuteranopia and tritanopia (Machado et al., 2009). The yellow stays above 7:1 contrast against every arena floor under all of them. The standard red lane edge drops below 3:1 on some floors under protanopia.
- **Minimap** (on by default): the map in the bottom-right corner, with the visible area outlined, your serpent, elites, the boss and its clearing. Clicks and strokes pass straight through it.
- **Steady camera** (off by default): keeps the serpent in the middle of the view, with no look-ahead or easing, for players who find a moving camera uncomfortable.
- **Game speed**: 50 to 100% in 10% steps. It slows the whole run, but drawing happens in real time, so there's more time to draw. Shards and records count game time, so a slower run earns the same; the run summary notes the speed.
- **Keys**: two keys per action (steer up, down, left, right, pause, mute, art style). Click a key, then press the new one. Backspace clears it, Esc cancels. A key does one thing: binding one that's in use moves it and says which action lost it. A steering direction left with no key gets a warning. Keys are physical positions, so they work the same on any keyboard layout. Esc always pauses and goes back. Hints across the game (How to Play, the pause menu, button tooltips) show the keys you've bound.

## Sigil practice

**Practice Sigils** on the title screen (and How to Play) opens a drawing pad with nothing at stake. Choose a sigil to practise or leave it on **Any sigil**. While you draw, the trail takes the colour of what it reads, like in a run. On release you see what the recognizer saw:

- **The verdict**: the sigil and spell with its grade (Perfect, Clean or Rough) and a tip, or what went wrong: "Read as Circle, not V", "Too close to call", or the first requirement the chosen sigil missed.
- **Every sigil's score**: a bar from 0.5 (just readable) to 1, with ticks at that sigil's Clean and Perfect thresholds, or the reason it failed, such as "Simplifies to 4 corners; a triangle has 3", "Goes only 220° around; a circle needs 270°" or "Opens 80° away from up; a V opens upward (within 62°)".
- **On the pad**: the stroke as drawn and the 64 points the recognizer actually reads, the start and end, each sharp corner with the angle inside the bend, the gap a closed shape has to close, and the shape it fitted: the line's chord, the V's legs, the circle's centre and average radius, the triangle's three corners, the zigzag's legs.
- **Measurements**: straightness, roundness, turning, end gap, sharp corners and how much of the turning happens at them.
- **A tally** of recent attempts, how many cast and were perfect, and the current streak.

The explanations come from the game's own recognizer: `analyzeStroke` in `gesture.ts` runs the same pipeline as `recognize` and also reports, for each sigil, the first gate the stroke failed and the points its shape was built from. A test checks that it returns exactly the game's verdict across 600 random strokes and explains every failure.

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

## Level-ups: rerolls, aspects, duos and overcharge

A level-up offers three cards (four with the Grimoire's Fourth Rune). Under them:

- **Reroll** (R) draws a fresh offer. A run starts with 2.
- **Banish** (B, then a card) takes that card out of the run for good, and a new one takes its place. A run starts with 1.
- **Skip** (X) takes nothing and heals 10% of max health.

From level 5, **aspects** join the offer: two for each spell that change how it behaves. A spell takes one, and the other leaves the pool.

| Spell | Aspect | Aspect |
| --- | --- | --- |
| Arcane Bolt | **Ricochet**: a spent bolt bounces on to the nearest foe within 260, at 70% damage | **Seeker**: bolts curve toward foes ahead and fly 40% farther |
| Forked Lightning | **Conductor**: no damage lost along the chain, and 40% longer jumps | **Overload**: struck foes are shocked for 3 s and take 20% more from everything |
| Arcane Nova | **Implosion**: pulls foes in instead of pushing them out, 25% harder | **Shockwave**: double knockback, and a 0.8 s stun |
| Arcane Ward | **Mirror**: shots that reach you while it's up bounce back as bolts, using no charge | **Sanctuary**: casting it heals 8%, and you regenerate 2 health a second while it lasts |
| Frost Field | **Shatter**: foes dying in a field burst for 40% of their max health against neighbours | **Permafrost**: fields last twice as long and are 25% wider |

When both spells of a pair have **evolved**, a **duo** card can appear: Stormlance (Bolt + Lightning: hits arc lightning), Rimeshot (Bolt + Frost: hits chill), Shatterstorm (Lightning + Frost: double damage to chilled foes), Thunderclap (Nova + Lightning: the ring calls lightning on 4 foes), Bulwark (Ward + Nova: every blocked hit releases a Nova) and Blizzard (Nova + Frost: each Nova leaves a field). Stormlance, Thunderclap and Blizzard are known from the start; the Grimoire teaches the rest.

Once nothing else is left to offer, endless **overcharge** cards fill the offer: +6% spell damage, +12 max health (and a heal), or 3% shorter cooldowns (down to half).

## Relics

Stepping into the way down after a boss offers **three relics** to carry for the rest of the run; pick one, or leave them and heal 40%. One of the three is always the next map's own relic, which blunts its hazards: Stoneshaper's Charm (stone doesn't hurt), Thornhide (brambles, half from spores), Rimewalker (ice doesn't widen turns, half from icicles) and Emberwalk (lava and burning ground, half from eruptions). The others range from the Ouroboros Coil (+1% damage per 4 body segments), the Tail Sigil (the tail fires bolts) and Glass Fang (+40% damage, −25% health) to Sacrificial Scales (once per map a killing blow sheds a third of the body instead) and Hunter's Mark (elites and bosses take 25% more). Carried relics show as icons under the HUD bars, with their effects in the pause menu. Ten are known from the start; the Grimoire unlocks eight more.

## The Grimoire, waystones and heat

The **Permanent Upgrades** screen has a second tab, the **Grimoire**: one-time unlocks that add options rather than power. It sells the eight locked relics, three duos, extra rerolls and banishes, a fourth card at every level-up, a primed ultimate, and **waystones**. A waystone (once you've reached that map) lets a run start on the Hollows, the Catacombs or the Ember Depths, picked in the atlas on the setup screen. To catch up, the run first chooses a relic and drafts twelve level-ups for each map it skips, through the usual panel, with **Auto-pick the rest** to hurry.

Reaching Depth 5 (the Ruins again) unlocks **heat**. Each heat level gives foes 12% more health, 6% more damage and 3% more elites, and the run 15% more shards. Reaching Depth 5 at a heat unlocks the next, up to 10. It's set on the setup screen.

## Wizards

Chosen on the **Wizard & Curses** screen (reached from the title) and remembered between runs. Each has its own colours in both art styles, and its own **ultimate**.

| Wizard | Starting sigils | Perks | Ultimate | Unlock |
| --- | --- | --- | --- | --- |
| **Arcanist** | Line, V, Circle | Balanced | Starfall | Always |
| **Frostcoil** | Line, Zigzag, Circle | +20% Frost Field radius | Absolute Zero | Survive 3:00 |
| **Wardscale** | Line, Triangle, V | +25 max health, the ward blocks one more hit | Bastion | Reach level 10 |
| **Stormtongue** | V, Line, Zigzag | +20% spell damage, lightning chains once more, −25 max health | Maelstrom | Defeat Ouroboros |

## Ultimates

Each wizard has one, cast with **Space** (or Q, rebindable) or by clicking its card at the bottom of the screen. It recharges over 70–80 s (Quickened Runes and the Hourglass relic shorten that, down to 45 s), and a run starts with 30 s to go. Ultimates scale with spell damage, and non-boss foes also lose a share of their own max health, so they stay decisive at depth:

| Ultimate | Effect |
| --- | --- |
| **Starfall** | For 3 s, 36 stars fall on foes in view (elites and the boss first), each bursting in a 75 radius |
| **Absolute Zero** | Every foe in view freezes for 4 s (a boss slows to 40%) and takes a heavy blow; frozen foes take 50% more, and shots in view shatter |
| **Bastion** | 6 s of immunity to everything, even stone; heals 35%, and foes touching the body are burned and shoved away |
| **Maelstrom** | For 6 s a storm strikes a foe near the head every 0.2 s, chaining to 2 more |

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

The run never ends on its own. Each Archmage defeated takes you one **depth** deeper (shown next to the kill count), onto the next map. Foes grow tougher with the time spent on the map you're on, not the run's length, and each depth adds a step: health ×(1 + 0.75·d + 0.1·d²) for d depths down, 25% more damage, 20% more spawns and room for 12 more foes each depth. So each map opens a little easier than the last one closed, and the boss keeps returning stronger.

From Depth 2, spawns can be **elites** (10% at Depth 2, +5% per depth, up to 35%): bigger, 1.6× health, 2.5× experience, a crown marker and one modifier:

- **Shielded**: a hexagonal barrier worth 80% of its health soaks damage and knockback until it breaks.
- **Swift**: lives on a 1.45× faster clock, so it moves, winds up and attacks faster.
- **Splitting**: bursts into two smaller fragments when it dies.

Frost works the same way in reverse: enemies inside a field run on a slower clock, which slows their attack wind-ups too. The game-over recap also counts hits the ward blocked, elites slain, the depth and map reached, and foes that fell to lava and fire.

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

- **Classic** draws smooth vector art with soft glows. The floor and stonework are painted in 256-unit chunks at the screen's resolution the first time they come near the view, then cached (the view and a ring of chunks around it, at most 1.75 device pixels per world unit, so under about 64 MB even at 4K); one chunk ahead is painted per frame.
- **Pixel** renders the view on a low-res canvas 320 art pixels tall (1 pixel = 2.5 world units), offset by the camera in whole pixels, and upscales it by a whole-number factor: ×2 at 1280×720, ×3 at 1920×1080. Very small windows fall back to fractional scaling.
  - **Sprites** are generated in code with hard edges, a 1px outline and top-left rim lighting. Heads are drawn at 16 headings.
  - **The floor** is painted per pixel in 256×256 chunks: flagstones, cracks, moss, the rune circle, torch light, and the stonework shaded from each solid's exact distance (rim-lit top-left, shadows cast down-right). Every detail is keyed by its position on the map, so chunks meet without seams. The chunks around the view are painted a band at a time within 3 ms a frame, ahead of need.
  - **Effects** use per-pixel lines and circles plus ordered (Bayer) dithering: charge lanes, lightning, Nova, enemy shots, crystals, particles and portals.
  - **Overlay:** the sigil trail and hurt flash are drawn on a screen-sized overlay that lines up with the same pixel grid.
  - **HUD and menus** switch to pixel fonts (Silkscreen, Pixelify Sans), stepped panels and bitmap icons.

The pixel art lives in `src/game/pixel/`: `palette.ts`, `bake.ts` (sprite rasterizer), `sprites.ts`, `floor.ts` (chunked floor) and `draw.ts`. The classic floor is `src/game/classicFloor.ts`. The menu pieces are in `src/ui/art.tsx`. Pixel size is `PIXEL_ART.worldPerPixel` in `config.ts`.

## Where to tune balance

**`src/game/config.ts`** holds every balance value:

- `SNAKE`: speed, turn rate, segment spacing and growth, health, invulnerability, pickup radius, aim fallback distance
- `SPELLS`: damage, cooldowns and their minimums, speeds, chain counts and range, Nova radius
- `HIT_STOP`: freeze lengths, what counts as a big hit, boss-kill slow motion
- `SPELLS.ward`, `SPELLS.frost`: the new spells' cooldowns, duration, charges, slow, damage
- `EVOLUTIONS`, `EVOLUTION_PARTNER_RANKS`: what each evolution needs and does
- `DEPTH`, `ELITE`, `HEAT`: per-depth scaling, elite chances and modifiers, and what each heat level adds
- `ASPECTS`, `DUOS`, `OVERCHARGE`, `LEVEL_TOOLS`: each aspect's and duo's numbers, overcharge ranks, and the rerolls, banishes and skip heal a run starts with
- `ULTIMATE`: how charged an ultimate starts and its cooldown floor (each ultimate's own numbers are in `src/game/ultimates.ts`, each relic's in `src/game/relics.ts`, and the Grimoire's prices in `src/game/grimoire.ts`)
- `CLEAN_CAST`: per-sigil Perfect and Clean thresholds and their power bonus
- `CONSTRICT`: loop closing distance, damage, hold, pull and cooldown
- `ENEMIES`: per-type health, speed, damage, XP, telegraph timings, boss attack patterns
- `DIRECTOR`: spawn rate curve, alive cap, enemy-type unlock times, boss timing, difficulty scaling over the time on each map
- `PROGRESSION`: XP curve, passive survival XP, crystal cap
- `REWARDS`: Arcane Shards per 10 s survived, per kill, per level and per boss
- `BREAKABLES`, `PICKUPS`, `BUFFS`: urn and reliquary health, drops and refill times, heal sizes, and each buff's strength, length and drop weight
- `HAZARDS`, `DESCENT`: lava, bramble and fire damage, ice's turn rate, each kind of vent, burning trails, and the way down
- `BOSSES`, `METEORS`, `BOSS_MOVES`: each Archmage's name, banners, moves and summons, and their themed attacks; `ARCHETYPE`: which older foe each new one is built on
- `ARENA`: damage and bounce from walls and every other solid; `CAMERA`: view size, look-ahead and easing; `NAV`: flow-field cells, the spawn ring, the off-screen attack margin, when stragglers are brought back, and how early the boss clearing is marked

Each map's layout is in `src/game/maps/` (`ruins.ts`, `hollows.ts`, `catacombs.ts`, `ember.ts`), and their order in `maps/index.ts`. After changing foes or hazards, `npx vite-node scripts/balance.ts` has a bot play every map at the same depth and level and prints the damage taken per minute by kind (melee, shots, bursts, vents, lava, fire, brambles, stone), deaths, kills and the share of XP from breakables. With depth 0 it plays whole runs instead: from level 1, levelling as it goes, taking cards and relics at random and casting its ultimate, and going down a map when each boss is due (`npx vite-node scripts/balance.ts 0 6 0 6 max` for six seeds, six maps, the shop maxed; `none` for an empty shop). With the shop maxed, the last pass measured 28, 29, 68, 115, 87 and 96 damage a minute on the six maps, with no deaths until the Ember Depths. Measured over six seeds (`npx vite-node scripts/balance.ts 240 6`), the last pass brought the four maps to 29–46 per minute, the Hollows the gentlest; it trimmed the Pyromancer's burning ground (2.5 s → 1.6 s), the Frost Archer's icicle (13 → 11 damage, 560 → 420 speed, a 0.9 s line) and the Puffcap's spores (10 → 7 damage, drifting 7 s).

Run upgrades (stack sizes and per-level effects), the level-up offer (when new sigils and evolutions appear) and permanent upgrades (costs and caps) are in **`src/game/progression.ts`**. Wizards are in **`src/game/wizards.ts`** and curses in **`src/game/curses.ts`**.

## Project layout

```
src/game/            framework-free game code (no React)
  config.ts          balance values
  engine.ts          Game class: fixed-timestep loop, phases, gesture → spell, events to React
  snake.ts           player movement, path trail for body segments, steering that bends U-turns away from stone
  maps/              the four maps as data, their order, building a run's layout from a seed, the layout validator
  terrain.ts         distances to solids, bounces, pushing bodies out, ray casts, line of sight
  camera.ts          the view following the serpent around the map
  nav.ts             the flow field foes follow to the serpent
  heap.ts, hash.ts   a min-heap for path searches; position-keyed randomness for seamless floors
  breakables.ts      urns and reliquaries, their drops, pickups, and buffs
  descent.ts         the way down after a boss, its relic choice, and moving the run to the next map
  levelup.ts         level-up offers, applying cards, reroll, banish and skip
  relics.ts          the relics: their table, offers, and what each does as things happen
  ultimates.ts       the four ultimates: casting, cooldown, and their effects each step
  grimoire.ts        the Grimoire's unlocks, waystone starts and heat
  hazards.ts         lava, brambles, ice, burning trails, vents and telegraphed blasts
  hazardDraw.ts      the classic look of hazards, blasts and the way down
  telegraph.ts       what both renderers need to preview attacks: lanes, aim lines, blasts in flight
  atlas.ts           the setup screen's map pictures
  icons.ts           pickup and buff icons, shared by the canvas, pixel sprites and HUD
  input.ts           keyboard (following the key bindings) + pointer capture, clears on blur/resize/pause
  keys.ts            key bindings: defaults, rebinding, validation, key labels
  options.ts         comfort and accessibility options: shake, flashing, warnings, minimap, camera, game speed
  gesture.ts         sigil recognizer, and the per-sigil explanations for practice
  practice.ts        the practice room's verdicts, fitted shapes and measurements
  spells.ts          all five spells and their evolutions, frost and swift time scaling, aim logic
  enemies.ts         spawn director and spawn ring, boss clearings, depth scaling, elites, AI for each archetype and its twists (packs, burrowing, collapsing, phasing, lobbing, slams), every boss's moves, line of sight, stragglers
  combat.ts          damage, deaths, crystals, contacts, enemy shots
  progression.ts     XP curve, run upgrades, rewards, permanent upgrades
  persistence.ts     validated localStorage save, award-once commit
  recap.ts           per-run spell and damage statistics for the game-over screen
  wizards.ts         playable wizards: starting sigils, perks, colours, unlocks
  curses.ts          optional pre-run curses and the shard multiplier
  cast.ts            clean-cast grading from the recognizer's confidence
  constrict.ts       loop detection and the Constrict crush
  render.ts          Canvas 2D renderer: camera transform, glow sprites, edge arrows, both styles
  classicFloor.ts    the classic floor and stonework, painted in cached chunks
  minimap.ts         the map overview in the corner
  effects.ts         capped particles, floating text, screen shake, hit-stop
  audio.ts           WebAudio context, volumes, sample loading, music scheduling
  sfx.ts             sound-effect samples and the synthesized fallback
  music/             score (themes as data), synth instruments, player, intensity
src/ui/              React screens, HUD and overlays
scripts/             the end-to-end play-test, and the headless balance bot
```

The animation loop and all fast-changing state live in `Game` outside React. React gets phase changes, level-up offers, run results, and a HUD snapshot throttled to 20 Hz. The simulation runs at a fixed 120 Hz step, so movement, cooldowns and spawns don't depend on frame rate.

## Saves

Saved in `localStorage` under `serpent-sorcery-save-v1`: Arcane Shards, permanent upgrade levels, Grimoire unlocks, records (best time, level, kills, run count, lifetime bosses defeated, deepest depth, maps reached for the atlas, lifetime containers smashed, heat unlocked and cleared), mute/volume, the chosen wizard, curses, heat and start map, and the options (shake, reduced flashing, safe warnings, minimap, steady camera, game speed, key bindings). Saved bindings are cleaned on load: unknown keys, duplicates and a stray Esc are dropped. A locked wizard in the save falls back to the Arcanist. Every field is validated and clamped on load. Missing or corrupt data falls back to defaults field by field. Each run has a unique id, and the reward is banked only if that id hasn't been committed before, so a run can never pay out twice.
