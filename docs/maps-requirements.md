# Large themed maps: requirements

Status: decisions settled on 2026-10-21 (see section 16). All five phases are built (section 15 lists what differs from this plan). Numbers are starting points for tuning, and each is meant to live in `config.ts` or the map data, like today's balance values.

## 1. Goal

Replace the single one-screen arena with **large, scrolling maps that are the levels of a run**. Each map has:

- a theme: its look, obstacles and hazards
- its own enemies and boss
- obstacles that hurt and bounce the serpent, as the arena walls do now
- breakable objects that drop XP crystals, health or a temporary buff

The core loop stays the same: steer with the keys, draw sigils with the mouse, survive, level up, and beat the boss to go deeper.

## 2. Where the game is today

These are the constraints the design has to work with:

| Today | Consequence for this change |
| --- | --- |
| One fixed 1400×800 arena, scaled to fit the window; no camera. | A camera, a scrolling view and screen↔world mapping that goes through it. |
| The pixel style draws the whole arena on a 560×320 canvas (2.5 units per pixel). Classic pre-renders one full-arena background. | Pixel floors get bigger. Classic needs a chunked background, because one canvas for a big map would be too large. |
| The only obstacles are the perimeter walls: 8 damage, a bounce inward, 0.2 s of locked steering. The Ward doesn't block walls ("walls still sting"). | Obstacles reuse these rules, generalised from four straight walls to any shape. |
| Enemies walk straight at the head. Spawns can be anywhere at least 360 units from the head. | Enemies need navigation around obstacles. Spawning moves to a ring just off-screen. |
| Several places assume the arena: its centre `(700, 400)` (U-turn bias, slither steering) and `PLAY_AREA` clamps (crystals, shots, bolts, the Lance, aim, Frost placement, telegraph clipping, pixel draw bounds). | Every one of these becomes map-aware (see section 13). |
| Depth goes up with each boss kill. `world.area` swaps the look: the violet ruins at depth 1, the Ember Depths after that. | Depth becomes "which map you're on". The existing two looks become the first and last maps. |
| Crystals are the only pickup (cap 300). Health comes only from Regen, Vitality, Restorative Draught and Supernova. There's no timed-buff system. | Health pickups and buffs are new systems. |

## 3. Run structure: maps as levels

- **R1. Fixed order.** A run plays the maps in order:
  1. Sunken Ruins
  2. Mycelium Hollows
  3. Rimefrost Catacombs
  4. Ember Depths

  The order rises in mechanical complexity: obstacles only, then slowing and periodic hazards, then sliding ice, then lava and lobbed fire.
- **R2. Looping.** After map 4 the run loops back to map 1 at depth 5, then continues, endless as now. The existing depth scaling continues: +35% enemy HP, +20% damage, +15% spawn rate and +12 cap per depth. Elites keep their per-depth chances.
- **R3. Boss timer per map.** Each map's boss arrives 5:00 after you enter that map (3:30 with Impatient Archmage). The boss banner and HUD countdown work as now.
- **R4. Roster unlocks per map.** Each map has four regular enemy types in the same four slots as today: swarmer, shooter, heavy, special.
  - **Map 1** unlocks them at today's times: 0 s, 40 s, 100 s, 180 s.
  - **Later maps** unlock them faster after you enter: 0 s, 20 s, 45 s, 90 s. You're stronger by then.
  - **Stat scaling** (HP, damage, speed) still uses total run time plus depth, so a new map isn't a reset.
- **R5. Descent.** When a boss dies:
  1. The existing freeze and slow-motion play.
  2. Every remaining enemy dies, and every crystal on the map flies to the serpent.
  3. Spawning stops, and a descent portal opens where the boss died.
  4. Steer into the portal to descend. After 15 s it pulls you in anyway, so the safe gap can't be farmed for shards.
  5. A short fade (about 0.6 s) and a banner follow: "Depth 3: Rimefrost Catacombs", plus a one-line tip about that map's hazard.

  Level, upgrades, length and HP all carry over. The serpent starts at the new map's start point with the usual 1.5 s of invulnerability.
- **R6. Unchanged systems.** Curses, wizards, the shard multiplier, game speed and the reward formula don't change. The game-over screen adds the map reached.
- **R7. Dev shortcut.** A dev-only URL parameter (for example `?map=catacombs&depth=3`) starts a run on any map, for development and the play-test.

## 4. Map size, camera and view

- **V1. Map size.** Each map is between 6400×3600 and 8000×4400 world units, about 4–5 views each way.
  - **Crossing time** at 190 units/s: 34–42 s for the long side, 19–23 s for the short side.
  - **Ruins:** 6400×3600, the smallest, since it's the map where players learn obstacles.
  - **Later maps:** can grow toward 8000×4400.
- **V2. Same zoom as today.** The view keeps today's zoom: 800 world units tall, as wide as the window allows, up to 1600 units. Beyond that the view is letterboxed.

  This keeps enemy readability, spell ranges (Lightning reaches 580) and pixel size the same. The pixel view is 320 art pixels tall and up to 640 wide, still at a whole-number upscale.
- **V3. Camera movement.** The camera follows the head with a lookahead of about 120 units in the direction of travel. It eases in over about 0.25 s and stops at the map edges. Screen shake is added on top.

  In the pixel style the camera moves in whole art pixels, so the floor doesn't shimmer.
- **V4. Aim while scrolling.** The aim target is still recorded in world coordinates at mouse-down. The reticle stays on that world spot while the view scrolls.

  The stroke itself stays in screen space, so recognition is unaffected.
- **V5. Coordinate mapping.** `screenToWorld` and `worldToScreen` include the camera. The play-test already maps through them, so its aim and click checks keep working.
- **V6. Steady camera option.** **Steady camera** (on the Options screen, off by default) turns off the lookahead and easing for players who find camera motion uncomfortable.

## 5. Map layouts

- **L1. Hand-made layouts.** Each map is hand-made data: bounds, start point, boss clearings, landmarks, solids, hazards and breakable slots. There's one file per map in `src/game/maps/`.

  Each run varies the layout from its seed:
  - which breakable slots are filled
  - which of a few optional obstacle clusters appear
  - the hazard timers

  Procedural generation is a non-goal (see section 17).
- **L1a. Authoring format.** Hand-placing every solid on an 8000×4400 map would be slow and hard to review, so each map file has two parts:
  - **A text grid** for the structure: one character per 200×200-unit cell, about 40×22 characters. It marks walls, open floor, hazard areas, the start, boss clearings and landmarks. Wall cells merge into larger rectangles.
  - **A list of freely placed pieces** on top: pillars, statues, ridges and breakable slots. Each gets a small seeded jitter.

  The layout can be read at a glance in the file, and the validator works on the same grid.
- **L1b. Landmarks.** On a map this big, players need points to steer by. Each map has 4–6 named landmarks: distinct set pieces such as a fallen colossus, a giant mushroom ring or a frozen bell tower. They're shown on the minimap and drawn larger than ordinary props.
- **L2. Readable shapes.** Solids are circles, axis-aligned rectangles and capsules (thick line segments). That's enough for pillars, statues, walls and ridges, and keeps collision cheap.
- **L3. Layout rules**, enforced by a unit test for every map and every seeded variation:
  - **Corridor width.** Every corridor is at least 220 units wide. The serpent's turning circle is about 86 units across (190 units/s ÷ 4.4 rad/s, ×2), plus the head's width and a margin.
  - **No traps.** There are no dead ends narrower than 300 units, and no enclosed pockets. Every open area is reachable from the start, with that clearance.

    As built, the validator checks this on a 25-unit grid: all "turning space" (at least 110 from any solid) is one connected region, every spot the head fits in is reachable from the start, and every such spot is within 170 path units of turning space. The inside of a right-angled corner measures about 160, so the 170 allows corners but catches slits and narrow pockets.
  - **Start point.** It has at least 600 units of clear space, and the serpent starts facing open ground.
  - **Boss clearings.** There are 3–5 clearings, each at least 1000×700, for the boss (the Ruins has 5: the plaza and the four corner courts). The boss's body is 384 units long and its charge covers about 470.

    They're spread so that every open point is within about 1900 units (10 s of travel) of one. The boss arrives at the nearest one (E9).
  - **No overlaps.** Breakable slots and hazards don't overlap solids. Hazards leave clear paths around them.
  - **Open ground.** At least 55% of the map is open floor, so it never feels like a maze.
- **L4. Map edge.** The map boundary is a wall with today's rules. Each theme draws its own boundary: ruin walls, root walls, crypt walls, basalt cliffs.

## 6. Obstacles and hazards

### Solids

- **O1. Bouncing.** The head bounces off any solid the way it bounces off walls today:
  - it's pushed out along the surface normal
  - its heading is reflected to leave at a clear angle
  - steering is locked for 0.2 s
  - it takes 8 damage (each obstacle type can override this)

  The usual 1 s of invulnerability after a hit applies. The body follows the head's path, so it never touches a solid on its own.
- **O2. Ward and terrain.** Terrain always stings, even through the Ward: walls, solids, lava, brambles. Telegraphed bursts (vents, icicles, eruptions) are attacks, so the Ward and the Stoneskin buff block them.
- **O3. U-turns.** The U-turn bias that now curves toward the arena centre curves away from the nearest solid instead.
- **O4. Enemies.** Enemies are pushed out of solids every step, including when knocked back.
  - **Brute-style charges** that hit a solid stop and stagger 1.5× longer. Baiting a brute into a pillar is a deliberate tactic.
  - **The boss's charge** stops at solids the same way.
- **O5. Projectiles.** Solids block projectiles on both sides: Arcane Bolt, enemy shots and the boss's volley.
  - **Arcane Lance** beams stop at the first solid.
  - **Lobbed attacks** (Pyromancer fireballs, meteors) arc over solids. They're marked by a ground circle, not a travelling shot.
  - **Forked Lightning** ignores solids. It's magic, and it targets foes in a cone.
- **O6. Nothing ends up inside a solid.** Crystals, pickups, Frost Field centres and spawns are pushed out of or kept away from solids. A Frost Field may overlap a solid. It just can't be centred inside one.

### Hazards

Hazards are zones on the ground that you can pass through. Each is shown by shape and pattern as well as colour.

- **O7. Contact hazards.** Lava, brambles and burning ground hurt the head on contact, using the normal hurt and invulnerability rules. Lava does 6 per touch (about 6 per second while you stay in), brambles 5.

  They also hurt enemies, except enemies native to that map. Knocking foes into lava with a Nova is meant to work.
- **O8. Burst hazards.** Vents, icicles and eruptions follow the existing telegraph language:
  - a ground circle about 1.0 s before the burst, filling as it builds
  - the colourblind-safe hazard stripes when that option is on

  They hit enemies too.
- **O9. Ice.** It changes handling without doing damage: the turn rate is halved while the head is on ice, so turns are wider. It's drawn with a sheen and a clear edge, so you can see it coming.
- **O10. Pathing around hazards.** Enemies avoid hazards when finding a path, unless they're immune. They don't avoid being knocked into them.
- **O11. Death recap names.** Every solid and hazard has a name, for example "a basalt column", "lava", "a spore vent", "falling icicles" or "the catacomb walls".

## 7. Breakables, pickups and buffs

### Breakables

- **B1. Two sizes.** Breakables look like containers (clay, wood, crystal, gilt), never like stone. The rule players learn is that **containers never hurt you**.

  | Size | Examples | Solid? | Broken by |
  | --- | --- | --- | --- |
  | Small | urns, glowcaps, frozen urns, geodes | No | The head on contact, or any spell damage |
  | Large | reliquaries, seed pods, coffins, braziers | Yes, but bumping one does no damage. The head gets a soft bounce and the same 0.2 s steer lock. | Spell damage only: about 3 Bolt hits at depth 1, scaling with depth |
- **B2. What breaks them.** Breakables take damage from:
  - Bolt and Lance
  - Nova and Supernova
  - Ward pulses and Aegis bolts
  - Frost Field ticks
  - Constrict

  Lightning targets foes only.

  Bolts pass through small breakables without being used up, and it doesn't cost them pierce. That way they never steal shots meant for enemies.
- **B3. Placement.** About 120–160 small slots and 20–28 large slots per map. That's roughly 5 small and 1 large per view of area.
  - **Large breakables** cluster in side rooms, wide alcoves and around landmarks, so the space off the main routes is worth visiting.
  - **At the start:** about 70% of small slots are filled, and all large ones.
  - **Refilling:** a broken slot refills after 60 s (small) or 120 s (large), only when it's at least one view away from the serpent.
  - **While the descent portal is open,** nothing refills.
- **B4. Enemies don't break them.** Enemies never break breakables. Small ones don't block enemies; large ones do, like solids.
- **B5. XP budget.** Breakables are a side source of XP: at most about 15% of a typical run's XP. The play-test measures this, and the drop tables are tuned until it holds.

### Drops

- **B6. Drop tables.** Each map has a drop table for each breakable size. Default weights:

  | | Small | Large |
  | --- | --- | --- |
  | XP crystals | Always: 3–5 XP | Always: 10 XP |
  | Small heal (+20 HP) | 12% (24% below 35% health) | 30% (a large heal instead, below 35% health) |
  | Buff | 3% | Always one, weighted as in B9 |
- **B7. Collecting.** Health and buff pickups use the existing pickup radius and magnet. A pickup that would heal you while you're at full health stays on the ground until you need it. Pickups never despawn while the map is active.
- **B8. Health.**
  - **Small heal:** +20 HP.
  - **Large heal:** +35% of max HP.
  - Both show a floater and play their own sound.

### Buffs

- **B9. Buffs.** Durations are in game time, so the game-speed option slows them too, and they pause with the game.

  | Buff | Effect | Duration | Weight |
  | --- | --- | --- | --- |
  | **Quickening** | Spell cooldowns recover 50% faster | 15 s | 25 |
  | **Empower** | +40% spell damage | 15 s | 25 |
  | **Swiftscale** | +20% speed and +20% turn rate (same turning circle, so steering feels the same) | 12 s | 15 |
  | **Stoneskin** | Blocks the next hit from a foe or a burst hazard, even if you don't know the Ward. Terrain still stings. | Until used, at most 30 s | 15 |
  | **Lodestone** | Every crystal on the map flies to you | Instant | 10 |
  | **Shard Cache** | +5 Arcane Shards, +2 per depth. They're banked with the run and the curse multiplier applies. | Instant | 10 |
- **B10. Stacking.**
  - Picking up a buff you already have resets its duration. It doesn't stack.
  - Different buffs run at the same time.
  - Empower stacks multiplicatively with Clean and Perfect casts.
- **B11. Record keeping.** Buffs show in the HUD (section 10). The run recap counts breakables smashed, health restored from pickups and buffs collected.

## 8. Enemies

### Rules for every enemy

- **E1. Navigation.** Enemies find their way around solids with a flow field. It's a grid of about 40-unit cells, recomputed from the head's position a few times a second.

  Swarmers, heavies and the serpent-style enemies follow it. Shooters use it to reach a spot they can see you from.
- **E2. Line of sight.** Shooters need line of sight to start an attack, unless their attack is lobbed.
- **E3. No attacks from off-screen.** No enemy starts an attack's wind-up while it's outside the view (plus a 40-unit margin). Every telegraph is visible.
- **E4. Telegraphs.** Every new attack is telegraphed for at least 0.6 s, using the existing preview shapes (lane, line, ring, cone, circle). Each one also needs:
  - a colourblind-safe variant (hazard stripes, the yellow "!")
  - a reduced-flashing variant
  - a death-recap name for each of its attacks
- **E5. Compatibility with existing systems.** Every new enemy works with:
  - elites (shielded, swift, splitting; splitting is excluded for snake bodies, as now)
  - Frost slow and Glacier freeze
  - Constrict's stun
  - knockback
  - hit-stop
  - the music's intensity weight
- **E6. Art.** Every new enemy has sprites in both art styles: classic vector, and pixel sprites baked at 16 headings where it turns.
- **E7. Stuck enemies.** An enemy more than about 1.6 views from the head for 6 s is moved to the spawn ring (section 9). The same happens to one stuck against a solid for 3 s. Bosses are never moved.

### Rosters

Each map uses the same four slots, so the spawn director's weights and alive cap carry over. Each new enemy is an existing AI archetype with one themed twist.

| Map | Swarmer | Shooter | Heavy | Special | Boss |
| --- | --- | --- | --- | --- | --- |
| **Sunken Ruins** | Chaser | Caster | Brute | Rival serpent | **Archmage Ouroboros** (as now) |
| **Mycelium Hollows** | **Sporeling**: hops toward you in short bursts, in packs of 4–6 | **Puffcap**: roots in place, swells for 0.9 s, then fires a slow fan of 3 long-lived spores | **Thornback**: Brute-style charge that leaves a 3 s bramble trail | **Burrow Viper**: dives underground and travels as a mound (it can't be hit then), then erupts under where you're heading, after a 0.9 s circle telegraph | **Sporemaw**: spore volleys, a burrowing charge, summons Sporelings |
| **Rimefrost Catacombs** | **Bone Rattler**: when killed by a single-target hit, it collapses into a harmless bone pile. It rises again at half health after 3 s unless the pile is hit or caught by Nova, Frost or Constrict. XP drops only when it stays down. | **Frost Archer**: keeps about 420 units away. Draws a thin line telegraph for 0.8 s, then fires a fast piercing icicle (solids block it). | **Crypt Golem**: slow, with no charge. Slams the ground after a 1.1 s ring telegraph (radius 120), leaving ice for 4 s. | **Wraith**: drifts through interior solids and takes 40% less damage while inside one. Lunges after a 0.8 s telegraph. | **Rimecoil**: a fan of icicle lines, rings of ice laid around the clearing, summons Bone Rattlers, charges |
| **Ember Depths** | **Cinder Imp**: fast and fragile. Crouches for 0.5 s, then leaps the last 150 units. | **Pyromancer**: lobs a fireball onto a ground circle (1.0 s telegraph) that leaves burning ground for 2.5 s. Arcs over solids. | **Magma Brute**: Brute-style charge that leaves a 3 s lava trail | **Salamander**: rival-style serpent, immune to lava, that spits a short flame cone after a 0.8 s cone telegraph | **Pyrecoil**: meteor rain (several circle telegraphs), a charge that leaves a fire trail, summons Cinder Imps, volleys |

- **E8. Bosses.** Each boss is a themed variant of the existing serpent boss. It keeps the shared skeleton:
  - slither, then a sequence of moves
  - enrage at 50%
  - only the head bites
  - a HP bar

  Two of its four moves are swapped for themed ones. That gives each map a distinct fight without writing four bosses from scratch. Fully unique bosses are an open decision (section 16).
- **E9. Boss arrival.**
  - **Before it arrives:** when the HUD's 30 s countdown starts, the boss clearing nearest the serpent is marked on the minimap, with an arrow at the edge of the view. Heading there is the player's choice.
  - **Where it arrives:** the boss's portal opens in that clearing.
  - **If you're not there yet:** if the clearing is off-screen when the boss arrives, the boss slithers toward the serpent. You can lure it back to open ground or fight where you are.
  - **Once it's out:** the boss is always shown on the minimap and by an arrow at the edge of the view.

## 9. Spawning on a big map

- **S1. Spawn ring.** Regular spawns appear in a ring 80–450 units outside the view. Spawn points must be:
  - on open floor, outside hazards (unless the enemy is immune)
  - reachable through the flow field
  - at least 360 units from the head, as now

  There's a mild bias against spawning directly in the serpent's path. When the camera is against a map edge, spawns use the other sides.
- **S2. Portals.** Portals are kept for spawns that happen in view: boss summons, and the rare ring point that lands on-screen at a map edge. That way nothing pops in without warning.
- **S3. Spawn balance.** Spawn rate, alive cap and their depth and curse multipliers carry over, since the view is the same size as today's arena. Re-tune after the first play-test.
- **S4. Pressure stays near the serpent.** The serpent (190 units/s) outruns every foe except charges and leaps, and these maps are big enough to keep running. So spawns and relocation (E7) are what keep enemies around it.

  The play-test checks that the number of foes within one view of the head stays within 20% of the same moment in a run on today's arena.
- **S5. Only nearby burst hazards run.** Vents, icicles and eruptions only go off within about one view of the camera. Elsewhere their timers pause.

  Off-screen bursts would cost frames and kill foes the player never sees. Contact hazards (lava, brambles, ice) are always active, since they're just ground.

## 10. Interface

- **U1. Minimap.** A minimap in the bottom-right corner, about 220×120 px (one minimap pixel is about 36 world units). Clicks and strokes pass straight through it.
  - **Static layer** (pre-rendered): the map outline, solids, hazards and landmark icons. The rectangle you can currently see is outlined.
  - **Live markers:** the serpent's head, the boss (and its clearing during the countdown), elites, large breakables and the descent portal. Regular foes aren't shown.
  - **No fog of war:** the whole layout is visible from the start.
  - It's styled to each art style. **Minimap** is a toggle on the Options screen, on by default.
- **U2. Edge arrows.** When off-screen, arrows at the edge of the view point to:
  - the boss
  - the boss clearing, during the countdown
  - the descent portal
- **U3. HUD.**
  - **Map name** next to the depth.
  - **Buff chips** under the health and XP bars: an icon, a sweep showing the time left, and the name as a tooltip.
  - **Pickup floaters**, for example "+20 health" or "Empower!".
- **U4. Map banner.** On entering a map: its name, its depth, and a one-line tip, for example "Ice sheets widen your turns".
- **U5. How to Play.** A new "Maps" section covers:
  - "Stone hurts, containers don't"
  - what breakables drop
  - the buff list
  - each map's hazard in one line
- **U6. Game over.** The run summary adds:
  - the map reached
  - breakables smashed
  - buffs collected
  - health restored from pickups
  - terrain damage, by name
- **U7. Map atlas (later phase).** The setup screen shows the four maps in order. Maps you haven't reached are silhouettes.

## 11. Art and performance

- **A1. Both art styles.** Every map, solid, hazard, breakable, pickup, buff icon, enemy and boss exists in both Classic and Pixel.
  - **The two existing looks** (violet ruins, Ember Depths) become maps 1 and 4.
  - **The two new maps** get new palettes: bioluminescent teal and magenta for the Hollows, pale ice blue and navy for the Catacombs.
- **A2. Drawing order.** Solids are drawn flat, top-down, with a drop shadow. Everything that moves draws above them, so a pillar never hides the head, a foe or a telegraph.
- **A3. Floors in chunks, in both styles.** Both art styles draw the floor in chunks.
  - **Classic** uses chunks of about 512 world units.
  - **Pixel** uses chunks of 256×256 art pixels, which is 640 world units.

  Chunks are built when they first come near the view and cached (as built: the view plus a ring of chunks around it in classic, about twice that in pixel), least-recently-used dropped first.

  The pixel floor can't stay one image per map: an 8000×4400 map is 3200×1760 art pixels (about 22 MB). Building it pixel by pixel at once would stall for a noticeable moment.

  Building chunks may add at most about 4 ms to any frame. The chunks around the next map's start point are built during the descent fade.

  Floor detail (flagstones, moss, cracks, runes) must stay seamless across chunk edges. It's seeded by world position, not by chunk.
- **A4. Performance budget.** 60 fps at 1920×1080 on integrated graphics, with the alive cap full on the largest map. Requirements:
  - Off-screen entities are skipped when drawing.
  - Solids sit in a static spatial grid that the head, foes, shots, bolts and pickups query.
  - Background memory stays under about 64 MB.
  - The flow field can be limited to a window about 3 views around the head. A full map is about 200×110 cells, which is still cheap, but the window keeps the cost flat.

## 12. Options, accessibility, audio and saves

- **C1. New options.** **Minimap** (on) and **Steady camera** (off), saved with the other options.
- **C2. Accessibility options cover new effects.**
  - **Colorblind-safe warnings** covers every new telegraph and burst hazard. Contact hazards also get an outline and pattern that don't depend on colour, so lava, brambles and ice read in greyscale.
  - **Reduce flashing** calms lava shimmer, eruptions, breakable hit flashes and buff pickup bursts.
  - **Screen shake** scales every new shake.
- **C3. Sound.** New effects for smashing small and large breakables, health and buff pickups, buff expiry, vents, eruptions, icicles and burrowing. They come from the bundled Kenney packs where possible: there are glass, mining and creak samples already. The soundtrack is unchanged, apart from intensity weights for new enemies. A different arrangement or key per map is optional (Phase 5).
- **C4. Saves.**
  - **Records add:** deepest map reached, maps discovered (for the atlas) and lifetime breakables smashed.
  - **Settings add:** the two new options.
  - The save version stays at 1. New fields are cleaned on load with defaults, like the options were.

## 13. Code areas affected

| Area | Change |
| --- | --- |
| `config.ts` | `ARENA` splits: wall rules stay, size moves to map data. New `CAMERA`, `TERRAIN`, `BREAKABLES`, `BUFFS` and `MAPS` tuning blocks. |
| new `maps/` | Map types, the four map definitions, seeded variation, validation |
| new `terrain.ts` | Spatial grid; circle, rectangle and capsule collision with normals; ray tests for shots, beams and line of sight; hazard lookup |
| new `nav.ts` | Flow field and spawn-ring point picking |
| new `camera.ts` | Follow, lookahead, clamping, view rectangle (gameplay uses it for spawning and the off-screen rule) |
| new `breakables.ts`, `pickups.ts`, `buffs.ts` | Breakables, drops, refills; health and buff pickups; active buffs feeding into `computeStats` |
| `snake.ts` | `PLAY_AREA` and `bounceOffWalls` become map-aware solid collision; U-turn bias moves away from solids |
| `enemies.ts` | Spawning, roster per map, navigation, line of sight, the off-screen rule, relocation, new AI twists, the `(700, 400)` steering centre |
| `combat.ts`, `spells.ts` | Crystal, shot, bolt and beam limits against terrain; breakable damage; Lance ray cast; aim and Frost clamping to map bounds; descent replaces the in-place area swap |
| `engine.ts` | Camera update, map transitions, the descent phase, aim clamping |
| `render.ts`, `pixel/*` | Camera transform, chunked classic floor, per-map pixel floors and palettes, solids, hazards, breakables, pickups, minimap, edge arrows, new enemy sprites |
| `recap.ts`, `music/mood.ts`, `persistence.ts`, UI | Hurt names, intensity weights, records and options, HUD buff chips, banners, How to Play, game-over additions |
| `scripts/playtest.mjs` | Hard-coded arena positions replaced with map-relative ones, plus the new checks in section 14 |

## 14. Testing and acceptance

**Unit tests**

- **Collision.** Bounce normals and outgoing angles for circles, rectangles and capsules, including corners. No tunnelling at the fastest speeds: Bolt at 900 units/s, charges at 520, at the 1/120 s step.
- **Map validation**, for every map and 50 seeds:
  - the layout rules in L3, including reachability with turning clearance
  - every open point within 1900 units of a boss clearing
  - the text grid and placed pieces agreeing (no piece inside a wall cell)
- **Navigation.** Flow-field correctness, and that a field of enemies around an obstacle cluster reaches the head with none stuck for more than 3 s.
- **Spawn ring.** Never inside solids or non-immune hazards, never in view (except portals), always reachable.
- **Drops.** Table weights, the low-health pity rule, and the XP share staying under its budget over simulated runs.
- **Buffs.** Durations, refresh-not-stack, interaction with clean casts, game speed and pause.
- **Records.** Hurt names for every new source. Saves cleaned on load with the new fields.

**Play-test** (real input, both art styles)

- the camera follows the head, and aiming lands on the right world point while the view scrolls
- steering into a pillar bounces and does 8 damage, and the recap names it
- smashing an urn with the head drops crystals
- breaking a reliquary with Bolts gives a buff, its HUD chip counts down, and the effect is measurable (for example, cooldowns recover faster under Quickening)
- a health pickup heals
- the descent portal moves to the next map, with its banner
- the minimap toggle and Steady camera work
- canvas pixel checks: hazard stripes on a vent telegraph with safe warnings on, and no hit flash on a breakable with reduced flashing
- a screenshot of every map in both styles

**Performance**, at 1080p:
- frame time logged with the alive cap full on the largest map
- the slowest frame while crossing the map end to end, to catch stalls from building floor chunks

## 15. Delivery phases

Each phase is one PR that ships something playable:

1. **Big maps foundation** (largest). Covers:
   - map data and validation
   - the camera
   - terrain collision for the head, foes, shots, bolts and pickups
   - the flow field, line of sight, the off-screen attack rule
   - the spawn ring and relocation
   - the minimap and boss arrow
   - both renderers
   - the two options

   The **Sunken Ruins** becomes a 6400×3600 map with obstacles, landmarks, boss clearings and its current roster. It also needs the grid-based map format and chunked floors in both styles. Until Phase 3, depth 2 and later reuse the Ruins layout with the Ember look, as today.

   **Built.** Where it differs from this plan:
   - **Clearings:** the Ruins has 5 (L3 now allows 3–5), so every point is close to one.
   - **Start and landmarks** are marked in the grid as planned; clearings are patches of `b` cells, and start or landmark cells inside a patch count as part of it.
   - **Map name in the HUD** is shown under the kill count. Below depth 1 it reads "Ember Depths", since those depths use that look.
   - **Not built yet:** the dev URL shortcut (R7) waits for a second map; the play-test places the serpent with its debug hooks instead.
   - **S4 is measured differently:** there's no old arena to compare with, so the play-test checks that over 90% of foes stay within 1.5 views of the serpent during the autopilot run.
2. **Breakables, health and buffs** (medium). Covers breakables, drop tables, refills, pickups, the six buffs, HUD chips and the recap additions, all on the Ruins.

   **Built.** Where it differs from this plan:
   - **Small slots** aren't hand-placed: each map scatters its own (140 on the Ruins) from a fixed seed, mostly along the stonework and never near the start. The 24 reliquary slots are hand-placed, flush against walls or in open ground so no gap can trap the serpent.
   - **Constrict** also counts breakables inside a loop, so a loop round a reliquary crushes it.
   - **Reduced flashing** turns off breakable hit flashes and holds pickup halos steady; the pickup burst is ordinary particles.
   - **Lifetime breakables smashed** waits for Phase 5's records.
   - **Drops were tuned down** to keep within B5: urns give 2–3 XP (planned 3–5) and reliquaries 8 (planned 10). The first play-test measured 19.5% of XP from breakables in one run and 8% in another.
   - **B5** is measured in the play-test's autopilot run: the XP in crystals that breakables dropped, against all the XP earned.
3. **Descent and the Ember Depths** (large). Covers:
   - the descent portal and map transitions
   - the Ember Depths as a real map: lava, eruption vents, its four foes and Pyrecoil

   For now it's the second map (Phase 4 moved it to fourth).

   **Built.** Where it differs from this plan:
   - **The Ember Depths** is 7200×4000: a lava river runs north to south from the Lava Falls, crossed by three bridges, with the Caldera (the start), the Forge and the Obsidian Spires as its landmarks, three lava pools and 12 eruption vents. Its five clearings are the Caldera, the Forge Yard north of the Forge, two west courts and one beside the Spires: placed so every dry spot is within 1900 path units of one. Its small and large breakables are geodes and braziers.
   - **The way down** opens where the boss fell, unless that's in stone or lava (a boss can die in lava): then it opens on the nearest dry, open ground. It has an edge arrow while off-screen, a minimap marker, and no breakable refills while it's open.
   - **The dev shortcut** is `?depth=N` (dev builds only). The map follows from the depth, since the order is fixed.
   - **Clearing reach** (L3) is measured from dry ground: nobody waits for a boss standing in lava.
   - **Chunk prefetch on arrival:** the new map's chunks are built in its first frames, behind the fade, rather than during it.
   - **Hazard kills** are counted apart from spells in the recap ("4 foes fell to lava and fire").
4. **Mycelium Hollows and Rimefrost Catacombs** (large). Two new themes, brambles, spore vents, ice and icicles, eight foes and two bosses. The final four-map order is set here.

   **Built.** Where it differs from this plan:
   - **The order** is Ruins, Hollows, Catacombs, Ember Depths, as planned. The Hollows is 7600×4200 (the Glowcap Ring where you arrive, the Spore Grotto, the Heartroot, the Fallen Giant, the Bramble Thicket); the Catacombs 8000×4400 (the Bell Court, the Ossuary, the Crypt of Kings, the Frozen Lake). Both have five clearings, two of them drawn in from the corners so the strip behind a walled landmark stays in reach.
   - **Hazard cells** in the grid: `~` lava, `%` brambles, `=` ice, plus placed circles. Ice is harmless, so the "dry paths round every hazard" rule only counts lava and brambles; any hazard still keeps out of clearings, the start and vents.
   - **Vents** make each map's own burst: eruptions (Ember), spore puffs (Hollows, radius 100, 10 damage) and falling icicles (Catacombs, radius 60, 15 damage), all with a 1 s circle.
   - **Every foe paths round stinging ground**, natives included, since they share one flow field; natives just aren't hurt when they cross it. Spawns avoid it too.
   - **Burrow Viper** dives within 440 units, can't be hit or bite while underground, erupts under a circle marked 0.9 s ahead, and stays up (and open to hits) for 1.2 s. It's a single body, not a segmented serpent.
   - **Bone Rattler** collapses when a Bolt (or Lance) or Lightning deals the last hit, rises after 3 s at half health, and any hit on the pile (Nova, Frost and Constrict included) finishes it. A collapse isn't counted as a kill.
   - **Frost Archer's icicle** stops at stone and at the serpent like other shots; "piercing" wasn't needed.
   - **Wraith** ignores the flow field and drifts straight at the serpent through interior stone (never the boundary), taking 40% less damage while inside it.
   - **Sporemaw**: spore fan, a burrowing charge (underground down its telegraphed lane, erupting under a circle at the end), summons Sporelings and Puffcaps, volley. **Rimecoil**: icicle fan (its lines show through the wind-up), rings of ice laid round the serpent rather than the clearing, summons Bone Rattlers and Frost Archers, charges.
   - **Wall names** come from each map: "the ruin walls", "the root walls", "the catacomb walls", "the basalt cliffs".
5. **Polish** (small to medium). The map atlas and records, a balance pass across all four maps, and optionally per-map music variations.

   **Built.** Where it differs from this plan:
   - **The atlas** is a row on the setup screen: each map's picture (its layout in minimap colours, with landmarks and the start marked), its depth, name and hazard tip. A map not yet reached is a dark silhouette marked "Undiscovered". The row's heading shows lifetime containers smashed.
   - **Records** add the deepest depth (also on the title screen), the maps reached and lifetime containers smashed, banked with the run's reward. The save version stays 1; old saves load with the first map known.
   - **Balance pass:** `scripts/balance.ts` has a bot play each map for four minutes at the same depth and level, and reports damage taken per minute by kind, deaths, kills and the breakables' share of XP. Before tuning, the Catacombs took 52 per minute (Frost Archer icicles) and the Ember Depths 81 (Pyromancer fireballs and their burning ground) against 30 on the Ruins. After, over six seeds (three swung too much with the bot's occasional deaths): Ruins 45, Hollows 29, Catacombs 46, Ember Depths 43, and breakables at 4–10% of XP on every map (B5). The Hollows is the gentlest on purpose, as the first new roster. Changes: Pyromancer burning ground 2.5 s → 1.6 s (radius 56 → 46), fireball 12 → 11, every 3.4 s → 3.8 s; Frost Archer icicle 13 → 11 damage, 560 → 420 speed, line 0.8 s → 0.9 s, every 3.6 s → 4.6 s; Puffcap spores 10 → 7 damage, drifting 7 s (other shots last 6 s; at 8 damage the Hollows took 41 a minute, with deaths); Rimecoil's icicles 14 → 12 damage, 620 → 520 speed.
   - **Per-map music** wasn't built (it was optional); every map plays the same score.

## 16. Decisions

Settled on 2026-10-21:

| Question | Decision |
| --- | --- |
| How a run uses maps | A fixed order, one map per boss, then loop harder (R1–R2). The setup screen doesn't pick a map. |
| Map size and kind | Hand-made, **4–5 views each way** (6400×3600 to 8000×4400). This is larger than first proposed, which added: the grid authoring format (L1a), landmarks (L1b), several boss clearings with a countdown arrow (L3, E9), keeping pressure near the serpent (S4), only nearby burst hazards running (S5), chunked pixel floors (A3) and more breakable slots (B3). |
| Bosses | Themed variants of the serpent boss, with two of four moves swapped per map (E8) |
| The Ward and terrain | Terrain always stings, even through the Ward. Telegraphed bursts can be blocked (O2). |
| Small breakables | The head smashes them on touch (B1) |
| Content scope | All four maps, through Phase 5 |

## 17. Not in scope

- Procedural or endless maps
- An in-game map editor (maps are data files)
- New spells or wizards (wizard unlocks tied to maps could come later)
- Touch or controller input, multiplayer
- New music themes (beyond optional per-map variations in Phase 5)
