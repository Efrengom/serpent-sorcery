# Steam: setting up the game on Steamworks

The desktop program (`desktop/`, see the README's "Desktop build") is what goes on Steam. This is
what to enter on the Steamworks site once the app exists, and what's still needed before release.

## 1. The app ID

Until Steam issues the game's own app ID, the program uses Valve's test app, **480** (Spacewar), so
the overlay can be tried with Steam running. Once the real ID is issued, change `STEAM_APP_ID` in
`desktop/steam.ts` and package again.

Started without Steam (or with Steam closed), the game plays as usual, without achievements or the
overlay.

## 2. Achievements

Add these under **Stats & Achievements › Achievements**. The **API name** must match exactly: the
game sends its own ids. Each one also needs an icon, earned and not yet earned.

Achievements earned before the game came to Steam, or brought over from the web version with a
backup code, unlock on Steam the next time the game starts.

| API name | Name | Description |
| --- | --- | --- |
| `firstBlood` | First Archmage | Defeat an Archmage. |
| `intoTheDepths` | Into the Depths | Reach Depth 3, the Rimefrost Catacombs. |
| `throughFire` | Through the Fire | Reach the Ember Depths. |
| `ascendant` | The Archmage Now | Defeat Azhdaha, the Archmage Ascendant, and win a run. |
| `fourCrowns` | Four Crowns | Win a run with every wizard. |
| `swiftDescent` | Swift Descent | Win a run in under 26 minutes. |
| `beyond` | Endless Descent | Play on after a win and reach Depth 6. |
| `cursedCrown` | Cursed Crown | Win a run with three or more curses. |
| `trialByFire` | Trial by Fire | Win, or reach the loop, at Heat 5. |
| `whiteHot` | White Hot | Win, or reach the loop, at Heat 10. |
| `calligrapher` | Calligrapher | Draw 50 Perfect sigils in one run. |
| `constrictor` | Constrictor | Crush 25 foes in your coils in one run. |
| `hoarder` | Hoarder | Carry six relics at once. |
| `pactMaker` | Pact Maker | Make three pacts at shrines in one run. |
| `riftwalker` | Riftwalker | Win 5 rifts. |
| `patron` | Patron | Buy 10 wares from merchants. |
| `smasher` | Smasher | Smash 500 urns and reliquaries. |
| `slayer` | Slayer | Defeat 10,000 foes. |
| `naturalist` | Naturalist | Defeat every kind of foe and Archmage in the bestiary. |
| `devotion` | Daily Devotion | Play the daily run three days in a row. |

A unit test (`desktop/__tests__/steam.test.ts`) fails if this table misses one of the game's
achievements, or names one wrong.

## 3. Steam Cloud

The save is one file, `save.json`, in `%APPDATA%\Serpent Sorcery\saves`. Steam Cloud syncs it
with **Auto-Cloud**, with no code. Under **Steam Cloud**:

- **Byte quota:** 1048576 (1 MB; a save is a few kilobytes). **Number of files:** 4.
- **Root paths:** add one:

  | Root | Subdirectory | Pattern | OS | Recursive |
  | --- | --- | --- | --- | --- |
  | `WinAppDataRoaming` | `Serpent Sorcery/saves` | `*.json` | Windows | No |

  The pattern leaves out `save.json.bak` (the save before the last one, kept on this computer
  only) and the temporary file each write starts as.

The window's size and fullscreen are kept beside it, in `window.json`, outside `saves`, so they
stay with each computer.

On a Steam Deck the Windows build runs through Proton. Check there that a save carries over both
ways.

## 4. Installation and the build

- **Launch option:** executable `Serpent Sorcery.exe`, operating system Windows.
- **The depot's content:** everything in `desktop/release/win-unpacked/`, from
  `npm run desktop:package`. Steam installs the folder as it is, so no installer is needed, and the
  .exe needn't be signed.

## 5. Still needed before release

- **Achievement icons,** for each achievement above, earned and not yet earned.
- **Store art:** the capsule images, screenshots and a trailer.
- **Controller support,** for the Steam Deck Verified badge (sigils included).
- **Steam's content survey,** including its question on AI use, answered from its current wording.
