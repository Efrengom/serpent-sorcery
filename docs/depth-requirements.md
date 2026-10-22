# Gameplay depth: requirements

Status: decided and built on 2026-10-22, from the four next steps plus ultimates. Section 10 records where the build differs from this plan. Numbers are starting points for tuning; each lives in `config.ts` (or the module that owns it), like the rest of the balance values.

## 1. Goal

A player with the shop maxed hit a wall at the third map. That wall came from how foes scale. On top of fixing it, the game should give that player more decisions to make in a run and more to work toward between runs.

The work has five parts:

1. **A difficulty curve** a strong build can push through. The balance bot must measure a real run.
2. **More level-up choices:** reroll, banish and skip; aspects that change how a spell behaves; duo evolutions; and endless overcharge ranks.
3. **A relic choice at each way down:** run-long, build-shaping items, some tied to the next map and some with a drawback.
4. **A shop that unlocks options, not stats:** relics, duos, level-up tools, starting at a map you've reached, and heat tiers after the loop.
5. **An ultimate spell for each wizard,** on a long cooldown and far stronger than a sigil.

## 2. Why the third map is a wall

Foe health, damage and spawn rate scale with the total run time *and* with depth, so the two multiply. Health has a squared time term. With about 5.5 minutes per map:

| | Foe health | Foe damage | Spawns a second |
|---|---|---|---|
| Catacombs, arriving → at the boss | ×19 → ×33 | ×4.0 → ×5.1 | 14 → 24 |
| Ember Depths, arriving → at the boss | ×41 → ×62 | ×6.0 → ×7.3 | 28 → 42 |

A serpent with every upgrade rank and the shop maxed gets about ×2.7 damage per hit and 250 health. Once its 46 upgrade ranks run out, a level-up only heals.

`scripts/balance.ts` started every map with the clock at 0, so it never saw this. Started at each map's real arrival time, its bot takes 26, 222, 476 and 873 damage a minute on the four maps (4 seeds × 5 min, shop maxed).

## 3. Difficulty curve (C)

- **C1. A clock per map.** Foes scale with the seconds since the serpent arrived on this map, `m`, and with the depth, `d = depth − 1`. The total run time no longer matters.
  - health ×(1 + m/120 + (m/300)²) × (1 + 0.75·d + 0.1·d²)
  - damage ×(1 + m/360) × (1 + 0.25·d)
  - spawn rate: today's curve in `m`, ×(1 + 0.2·d)
  - alive cap: today's curve in `m`, + 12·d
  - the early ramp of the cap (3 foes, +0.5 a second) only applies on the first map
  - hazard bursts use the same damage factor
- **C2. Bosses** scale with depth, not run time: health ×(1 + 0.8 × earlier bosses) × (1 + 0.3·d).
- **C3. Targets.** The whole-run bot picks cards at random and has the shop maxed. It should take about 25, 45, 65 and 90 damage a minute on the four maps, die rarely on map 3, and die regularly by map 5. Each map should open easier than the previous one closed: a breather after each boss.
- **C4. The bot plays real runs.** `balance.ts` gains a whole-run mode:
  - The bot plays one continuous run from level 1 with its own levels.
  - It goes down to the next map when the boss clock runs out. It doesn't fight the boss.
  - It reports a row per map.
  - A flag chooses an empty or a maxed shop.
  - The fixed-depth mode stays for comparing maps.

## 4. Level-up choices (L)

- **L1. Reroll.** Redraws all three cards. 2 a run, more from the shop.
- **L2. Banish.** Removes one card (an upgrade, a sigil to learn or an aspect) from the run's pool for good. 1 a run, more from the shop.
- **L3. Skip.** Takes nothing and heals 10% of max health. Always available.
- **L4. Aspects.** Each spell has two aspects that change how it behaves. A spell takes at most one, so taking one removes the other from the pool. They're offered from level 5 for known spells, each at one rank.

  | Spell | Aspect A | Aspect B |
  |---|---|---|
  | Bolt | **Ricochet**: after a hit, a bolt bounces once to the nearest other foe within 260, at 70% damage. | **Seeker**: bolts curve toward the nearest foe ahead and fly 40% farther. |
  | Lightning | **Conductor**: chains lose no damage and jump 40% farther. | **Overload**: struck foes are shocked for 3 s and take 20% more damage from everything. |
  | Nova | **Implosion**: pulls foes in instead of pushing them away, for 25% more damage. | **Shockwave**: twice the knockback, and foes hit are stunned for 0.8 s. |
  | Ward | **Mirror**: while the Ward is up, enemy shots that reach the head bounce back as bolts and don't use a charge. | **Sanctuary**: casting the Ward heals 8% of max health, and you regenerate 2 health a second while it lasts. |
  | Frost | **Shatter**: foes that die in a field burst, dealing 40% of their max health to foes within 90. | **Permafrost**: fields last twice as long and are 25% wider. |

- **L5. Duo evolutions.** When both spells of a pair have evolved, a duo card can appear. It takes a guaranteed slot, as an evolution does.

  | Duo | Spells | Effect |
  |---|---|---|
  | **Stormlance** | Bolt + Lightning | Each bolt or lance hit has a 25% chance to arc lightning to 2 nearby foes. |
  | **Rimeshot** | Bolt + Frost | Bolt and lance hits chill foes for 1.5 s (slowed as in a field), and chilled foes take 30% more bolt damage. |
  | **Shatterstorm** | Lightning + Frost | Lightning deals double damage to chilled or frozen foes. |
  | **Thunderclap** | Nova + Lightning | Each Nova strikes up to 4 of the foes it hits with lightning. |
  | **Bulwark** | Ward + Nova | Every hit the Ward blocks also releases a Nova. |
  | **Blizzard** | Nova + Frost | Each Nova leaves a Frost Field where it was cast. |

  Three duos are known from the start (Stormlance, Thunderclap, Blizzard); the shop unlocks the others.
- **L6. Overcharge.** When fewer than three cards are left to offer, endless overcharge cards fill the gap:
  - **Overcharge Power**: +6% spell damage
  - **Overcharge Vigor**: +12 max health, and heal 25
  - **Overcharge Focus**: −3% cooldowns, down to a floor of 50%

  These replace the Restorative Draught.

## 5. Relics (R)

- **R1. When.** Entering the way down offers three relics before the next map loads. You pick one, or leave them and heal 40% of max health. The 15-second pull still takes the serpent down; the choice then waits for you while the game is paused.
- **R2. What's offered.** If you don't own it yet, one of the three is always the **next map's relic**. The other two are random relics you've unlocked and don't own.
- **R3. Shown.** Owned relics appear in a row of small icons under the HUD's health bar, with their names on hover, and in the pause menu with their effects.
- **R4. The relics.** 18 in all. 10 are known from the start (✓); the shop unlocks the rest.

  | Relic | Effect | Known |
  |---|---|---|
  | **Ouroboros Coil** | +1% spell damage per 4 body segments. | ✓ |
  | **Tail Sigil** | The tail tip fires a bolt at the nearest foe every 1.5 s. | ✓ |
  | **Glass Fang** | +40% spell damage, −25% max health. | ✓ |
  | **Echo Stone** | Every 5th sigil is cast twice. | |
  | **Hunter's Mark** | Elites and bosses take 25% more damage. | ✓ |
  | **Quill of Precision** | A Perfect sigil refunds half its cooldown. | |
  | **Sacrificial Scales** | Once per map, a lethal blow instead sheds a third of your body and leaves you at 30% health. | ✓ |
  | **Thick Hide** | 15% less damage from foes. | ✓ |
  | **Bloodglyph** | Heal 1 for every 8 foes slain. | |
  | **Warden's Bell** | Dropping below 30% health releases a free Nova and 2 s of safety (once every 30 s). | |
  | **Lodestar** | Crystals fly in from twice as far, and +15% XP. | |
  | **Hourglass** | The ultimate recharges 30% faster. | |
  | **Gambler's Die** | +2 rerolls and +1 banish, now. | |
  | **Frenzied Heart** | 25% shorter cooldowns, but foes move 15% faster. | |
  | **Stoneshaper's Charm** | Walls and pillars don't hurt (you still bounce). Ruins relic. | ✓ |
  | **Thornhide** | Brambles don't hurt, and spore bursts deal half damage. Hollows relic. | ✓ |
  | **Rimewalker** | Ice doesn't widen your turns, and icicles deal half damage. Catacombs relic. | ✓ |
  | **Emberwalk** | Lava and burning ground don't hurt, and eruptions deal half damage. Ember relic. | ✓ |

  Every map's own relic is known from the start, so each map's hazards have an answer on the way down to it.

## 6. The shop: unlocks, waystones and heat (M)

- **M1. Stat lines stay.** The four stat lines (health, damage, pickup, wisdom) stay as they are. The shop gains a second tab, **Grimoire**, of one-time unlocks:

  | Unlock | Cost (shards) |
  |---|---|
  | Each locked relic (8) | 150–300 |
  | Each locked duo (3) | 250 |
  | +1 reroll, twice | 120, 300 |
  | +1 banish, twice | 180, 400 |
  | A fourth card at every level-up | 900 |
  | Waystone to the Hollows / Catacombs / Ember Depths (needs the map reached) | 250 / 450 / 650 |
  | Ultimate starts the run charged | 350 |

  Altogether about 5,500 shards, against roughly 1,600 for the stat lines.
- **M2. Waystones.** On the setup screen, an unlocked waystone lets a run start on that map. To catch up, the run begins with:
  - one relic choice for each map skipped
  - a draft of level-ups up to level 12 for each map skipped

  The draft runs through the normal level-up panel, labelled *Draft n / N*, with an "Auto-pick the rest" button.
- **M3. Heat.** Reaching depth 5 (the loop) unlocks heat 1. Reaching depth 5 at heat *h* unlocks *h+1*, up to 10. Each heat level adds:
  - +12% foe health
  - +6% foe damage
  - +3% elite chance
  - +15% shards

  Heat is picked on the setup screen next to the curses. The records keep the highest heat cleared.
- **M4. Saves.** New save fields (unlocks, extra rerolls and banishes, heat chosen and unlocked) are sanitised one by one like the rest, so older saves load unchanged.

## 7. Ultimates (U)

- **U1. One per wizard.** Each ultimate is cast with a new rebindable **Ultimate** action (Space by default) or by clicking its HUD card. Ultimates aren't aimed, so the drawing hand stays free.
- **U2. Cooldown.** Long: 70–80 s, shortened by Quickened Runes and the Hourglass (down to 45 s). A run starts with 30 s to go, or ready with the shop unlock. Going down a map doesn't reset it.
- **U3. Power.** Damage scales with spell damage and Empower. Non-boss foes also take a share of their own max health, so an ultimate stays decisive at depth.

  | Wizard | Ultimate | Cooldown | Effect |
  |---|---|---|---|
  | Arcanist | **Starfall** | 75 s | For 3 s, 36 stars fall on foes in view (elites and the boss first). Each bursts in a 75 radius for 60 + 12% of max health. |
  | Frostcoil | **Absolute Zero** | 80 s | Every foe in view freezes for 4 s (a boss is slowed to 40% instead). Each takes 40 + 10% of max health, and frozen foes take 50% more damage. Hostile shots in view shatter. |
  | Wardscale | **Bastion** | 75 s | 6 s of immunity to every hit (walls and hazards too). Heals 35% of max health. Foes touching any segment take 30 every 0.4 s and are shoved away. |
  | Stormtongue | **Maelstrom** | 70 s | For 6 s, a storm around the head (radius 420) strikes a foe every 0.2 s for 45 + 4% of max health, chaining to 2 more. |

- **U4. Shown.**
  - **HUD:** a larger card with the ultimate's name, its key, a cooldown sweep and a glow when ready, plus a sound when it comes ready.
  - **Setup screen:** each wizard card names its ultimate.
  - **How to Play:** explains the key.
  - **Recap:** counts the ultimate's casts, damage and kills as their own row.
- **U5. Art.** Both art styles draw:
  - Starfall's falling stars and their bursts
  - Absolute Zero's frost wave and frozen foes (as Glacier's)
  - Bastion's golden body
  - Maelstrom's storm ring and bolts

## 8. Testing and acceptance

- Unit tests for each part:
  - the curve's shape
  - reroll, banish and skip
  - aspects being exclusive, and each aspect's effect
  - duo requirements and effects
  - overcharge
  - relic offers and effects
  - unlocks, waystones, heat and save sanitising
  - each ultimate's effect and cooldown
- **Play-test**, in both art styles:
  - an ultimate cast from the key
  - the relic panel at a way down
  - reroll, banish and skip on a level-up
  - a Grimoire purchase
  - a waystone start with its draft
  - heat on the setup screen
- **Balance:** the whole-run bot meets the targets in C3, with an empty and a maxed shop.

## 9. Not in scope

- New sigil shapes. Ultimates use a key so the recognizer stays as tuned.
- New maps, foes or bosses.
- Online leaderboards.

## 10. As built

Where the build differs from the plan above, and what was measured.

- **The curve (C1-C3).** Built as planned, plus a small speed step for each depth (5%, within the clock's existing cap). Whole runs from the balance bot, six seeds, damage a minute (deaths in brackets):

  | | Ruins | Hollows | Catacombs | Ember | Ruins II | Hollows II |
  |---|---|---|---|---|---|---|
  | Shop maxed | 28 (0) | 29 (0) | 68 (0) | 115 (5) | 87 (0) | 96 (1) |
  | Empty shop | 31 (1) | 34 (0) | 69 (6) | 155 (26) | 203 (42) | 121 (11) |

  Before the change, the Catacombs alone were 476 a minute with the shop maxed. The Hollows came out gentler than the target and the Ember Depths steeper. At the same depth and level the four maps sit together (68-80 a minute at depth 4, level 30), so Ember's step comes from arriving there on a weaker build, which its burning ground punishes. The bot picks cards and relics at random and doesn't fight bosses, so a player should fare better.
- **Sanctuary (L4)** regenerates 2 health a second while the Ward is up, rather than tripling regeneration (which is zero without Shed Skin).
- **Relics (R4).** Every map's own relic is known from the start, Emberwalk included; Lodestar is locked in its place, so there are still 10 known and 8 to unlock. At a waystone start the relic choices lead with the starting map's own relic.
- **Ultimates (U1, U4).** The key is Space, with Q as its second slot; both can be rebound. The HUD card sits at the bottom centre of the screen.
- **The balance bot** takes relics at random on the way down and casts its ultimate into a crowd or when hurt.
