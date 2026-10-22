# Touch, a winnable run, map events and replay: requirements and as built

The plan for the four directions chosen after the per-map music, and what was built.

## 1. Goal

The game had plenty of systems (four maps, four wizards, five spells with evolutions and duos,
relics, the Grimoire, heat, ultimates, per-map music) but three gaps:

- **Reach.** Steering only read the keyboard, so on a phone nobody could steer, although the game
  is a public link people open on phones.
- **An ending.** A run could only end in death; the maps just looped deeper.
- **Choices between fights.** The maps are big and full of landmarks, but apart from level-ups
  and the way down there was nothing to decide.

And little to bring a player back beyond shards.

## 2. Touch screens (T)

- **T1. Two thumbs.** On a touch screen a thumb on the steering side (the left 42% of the
  screen, or the right with **Steer with the right thumb** in Options) holds a floating stick:
  where it lands is the stick's base, and sliding it steers at any angle (keys stay 8-way). A long
  drag pulls the base along behind the thumb, so turning back is never far. A finger anywhere
  else draws a sigil, at the same time. A third finger leaves a sigil being drawn alone.
- **T2. Taps.** The ultimate's card and the pause and mute buttons answer taps; every button acts
  at once, with no double-tap zoom.
- **T3. Showing it.** The stick draws under the thumb (a ring and a knob, square in the pixel
  style). For the first 8 seconds of a run on a touch screen each side is labelled ("Hold here to
  steer", "Draw sigils here").
- **T4. Phone layout.** A window under 560 CSS pixels wide (upright) or 500 tall (sideways)
  counts as a phone. Its view is closer (600 world units tall rather than 800, at least 640
  across) so the serpent is big enough to see, and fills the width. Sideways, the HUD bar slims to
  50 px; upright, it takes two rows with the spells below. The minimap is smaller. Level-up,
  relic and game-over panels are tighter on a short screen and scroll from the top if they must.
- **T5. Installing.** A web manifest (full screen, any orientation), icons drawn from the game's
  own pixel serpent (192, 512 and a maskable 512, and an iOS touch icon), and a service worker for
  offline play in production builds: the page itself network-first (a new deploy is picked up at
  once), hashed assets cache-first, fonts refreshed in the background. The game stays inside a
  phone's safe area when installed full screen.

## 3. A winnable run (V)

- **V1. The Ascendant.** When the last map of the first pass falls (Pyrecoil, at the end of the
  Ember Depths), no way down opens. The field clears, the ground shakes for 4.5 s while the four
  Archmages' colours gather, and **Azhdaha, the Archmage Ascendant** rises where Pyrecoil fell:
  2.2 times an ordinary boss's health at that depth, 15% bigger, its body banded in all four
  Archmages' colours.
- **V2. Phases.** Its moves change as its health falls. Above two thirds it uses the Ruins' and
  Hollows' moves (volleys, spores, charges, burrows, summons); below two thirds it turns to frost
  (icicles, rings of ice); below a third it burns (meteors and a fire trail, with everything else).
  Each phase is announced, and it enrages at half health as every boss does.
- **V3. Its music.** "Azhdaha", a finale theme back in the Ruins' D minor at 160 BPM, opening with
  the "Sigil of the Serpent" motif and played by every map's band at once. The rising plays its
  hush, the fight its boss arrangement, and the win its own sting.
- **V4. Victory.** When it falls the run is won. After its fall has played out, the victory screen
  offers **Claim victory** (end the run and bank it with a 300-shard bonus) or **Descend into the
  endless depths** (a way down opens; the run goes on into the next loop and keeps the win).
- **V5. Records.** A won run is banked as a victory ("Victory" on the game-over screen, with the
  time it was won), and the save counts wins, keeps the fastest win, and remembers which wizards
  have won and the highest heat won at. A win also clears its heat, as reaching the loop does.

## 4. Map events (E)

- **E1. Sites.** Each map has two sites (three from the third map on) at some of its landmarks,
  on open dry ground away from where the serpent arrives, chosen from four kinds, each kind at
  most once per map. Each shows a dashed circle on the ground, its name, and a marker on the
  minimap until it is used.
- **E2. Shrine of Pacts.** Steering in pauses for a choice of three pacts, or leaving. A pact
  lasts the run, a boon with a price: Blood (+18% spell damage, −20% max health), Haste (−12%
  cooldowns, foes hit 15% harder), Plenty (+25% XP and pickup reach, −10% max health), Glass (+30%
  damage, foes hit 30% harder) and Stone (+25% max health and foes hit 15% softer, +10%
  cooldowns). One pact per shrine.
- **E3. Elite Rift.** Steering in opens it: elites come every 2.4 s, near it or just out of view,
  and the HUD counts them. Defeat 6 (plus one per depth past the first) within 35 s and it offers a
  relic choice (XP if none are left); otherwise it closes.
- **E4. Cursed Chest.** Opening it gives a relic at once (or shards if none are left), but for 45 s
  foes hit 40% harder (shown on the HUD), and three elite guards come.
- **E5. Wandering Merchant.** Sells for the shards the run would bank (its "purse", shown in its
  panel), taken off the run's reward: a healing draught, a relic or a tome of insight (a level),
  and an elixir (a buff). Its prices rise 15% each depth; what is too dear can't be bought. It
  stays open after a purchase while it has more to sell, and can be visited again.

## 5. Replay (D)

- **D1. Daily run.** One seed a day (UTC), the same for everyone: the maps, the foes, the sites
  and every level-up and relic offer follow from it, with the day's wizard (every wizard takes a
  turn, locked or not) and one curse. Its score counts time, foes, levels and Archmages, and a win
  most of all. The save keeps the day's best and tries, and a streak of days played in a row.
- **D2. Achievements.** Twenty, from a first Archmage to winning with every wizard, at Heat 10, or
  with three curses, and feats within a run (50 Perfect sigils, 25 Constricted foes, six relics,
  three pacts). Each pays shards once, and the game-over screen lists those just earned.
- **D3. Bestiary.** Every foe and Archmage by the map it haunts, with a line on how it fights and
  how many the player has defeated; one never met shows as "???".
- **D4. Hall of Records.** A screen from the title with the run records (wins, fastest win, foes
  defeated, daily best and streak) and two tabs: achievements and the bestiary.

## 6. Testing

- **Unit tests:** the two-thumb input on a stand-in canvas; the Ascendant's rising, phases and win,
  and its records and reward; each site, the purse and what it costs the reward; the daily's seed,
  score and streak; achievements paying once; the bestiary's counts.
- **Play-test:** a phone held both ways with real touch input (a thumb steering while another
  finger draws a Bolt, a tap casting the ultimate), the manifest and icons; the Ascendant from
  Pyrecoil's fall through its phases to the victory screen, playing on, and the win banked; each
  site entered with a real key and used with real clicks; the daily run and the Hall of Records.
  The older parts play with `?nosites` (a development flag) so sites don't interrupt them.

## 7. As built

Everything above is in.

- **Files.**
  - **Touch:** `input.ts` (the stick and zones), `render.ts` (`drawTouch`, the compact view), `config.ts`
    (`TOUCH`, the compact view sizes), `styles.css` (the phone HUD and panels), `public/` (manifest,
    icons, `sw.js`) and `scripts/make-icons.mjs` (draws the icons from the game's sprites).
  - **The Ascendant:** `finale.ts` (rising, fight, win), its phases in `BOSSES.ascendant`, the
    finale theme in `music/score.ts`, and its look in both renderers.
  - **Map events:** `sites.ts`, drawn in `hazardDraw.ts` and `pixel/draw.ts`, with the
    `SitePanel` in the overlays.
  - **Replay:** `daily.ts`, `achievements.ts`, `bestiary.ts`, the Hall of Records in `Menus.tsx`,
    and the save's new records in `persistence.ts`.
- **Not measured yet:** how the Ascendant and the sites play over many runs. The balance bot
  doesn't use sites, and only reaches the Ascendant at full upgrades.
