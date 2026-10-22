# Music for each map: requirements and as built

The plan for giving each map its own soundtrack, and what was built.

## 1. Goal

Every map should sound like where it is. Before this work, all four maps played the same two
themes ("Sigil of the Serpent" and "Ouroboros"), so the Rimefrost Catacombs sounded like the
Sunken Ruins. The run's structure (a map per boss, the way down, deeper loops) gives the music
natural places to change.

## 2. Where the music started

- The soundtrack was synthesized live with WebAudio from note data (`src/game/music/`): pulse-wave
  lead and arpeggio, triangle bass, noise drums. It added nothing to the download.
- Two themes, seven layers (calm bass, bass, arpeggio, lead, harmony, drums, hats). Scenes set how
  loud each layer is: calm on menus, three run levels driven by enemy load, a hush before the boss
  and the boss theme during the fight.
- **Two small faults:**
  - The slow build-up counted total run time, so from the second map on the music started at
    full build and could never drop to its lightest layer.
  - The echo was timed to the main theme's tempo, so the faster boss theme echoed off the beat.

## 3. Approach

Keep synthesizing. Recorded tracks would have added 8–16 MB, needed separate stems for every
layer to keep the music reacting to the game, and needed licensing; they would also have stood
apart from the chiptune art and effects. Instead, each map's music is data: its themes, its
instruments ("band"), its drum kit, its room and its ambient bed.

## 4. Each map's sound

| Map | Mood | Run theme | Boss theme | Band and ambience |
| --- | --- | --- | --- | --- |
| Sunken Ruins | old, heroic | "Sigil of the Serpent": D minor, 132 BPM (unchanged) | "Ouroboros": 150 BPM (unchanged) | pulse leads, triangle bass, dotted-eighth echo; no ambience |
| Mycelium Hollows | eerie, alive | "Glowcap Hollow": E Dorian, 120 BPM, swung sixteenths | "Sporemaw": E minor with the flat second, 138 BPM, lurching half-time | soft chorused ocarina, bubbling arpeggio, woodblocks and claps, a damp room; ambience of drips, spore puffs and cave air |
| Rimefrost Catacombs | cold, solemn | "Rimefrost Bells": B minor with the flat second, 140 BPM in half-time | "Rimecoil": crypt-organ toccata in B harmonic minor, 150 BPM | celesta melody, glittering arpeggio an octave up, a cold pad, rim clicks, a bell tolled every four bars, a long dark room; ambience of wind and ice tinkles |
| Ember Depths | hot, industrial | "The Forge Below": C# Phrygian dominant, 152 BPM | "Pyrecoil": 168 BPM, the fastest theme | buzzing, trembling saw lead, distorted saw bass, an anvil on the backbeat, tom rolls, a slapback echo; ambience of lava rumble, bubbles and crackles |

## 5. Requirements

### The score

- **S1.** Each map has a run theme and a boss theme. Each boss theme is faster than its run theme.
- **S2.** Each map is in its own key and at its own tempo.
- **S3.** Every melody note and chord tone comes from the theme's declared scale, and every new
  theme starts each bar's melody on a chord tone (checked by the tests).
- **S4.** Each map has a two-bar victory sting that ends on a major chord.
- **S5.** The Ruins keeps its two themes, its band and its balance.

### The engine

- **E1.** A theme's band is data: the voice of each part (wave, envelope, vibrato, tremolo, chorus,
  filter, distortion, pitch blip, FM bell, organ stops), the arpeggio's order and rate, the drum
  kit (kick tuning, snare, clap or rim, an extra drum, fills, crash), the echo and the room.
- **E2.** Themes can swing their off-beat sixteenths, set their bass register, add an extra drum
  pattern and toll a bell on the chord root.
- **E3.** The chord parser reads diminished, augmented, suspended and major-seventh chords.
- **E4.** Each theme (in each key) is its own track with its own echo, timed to its tempo, and
  its own room. Moving to another theme crossfades on the beat, as the boss theme always did.
- **E5.** Each deeper map has an ambient bed under its music, at a level set per scene (fullest
  when calm, lower as the music builds, silent at death).
- **E6.** The music's slow build-up follows each map's own clock.
- **E7.** One function picks what plays (`musicCue`): the map's theme layered by danger, the hush,
  the boss theme, the sting and the way down. It is pure, so it is unit-tested.

### When the music changes

- **W1.** When a boss falls, the band stops and the map's sting plays.
- **W2.** While the way down is open (and through the relic choice), the next map's music rises
  in its calm arrangement, so the serpent arrives to a theme it has already heard begin.
- **W3.** Deeper loops (R1, R2) play each map a semitone higher per loop, up to two.
- **W4.** The menus play the calm arrangement of the map the next run starts on (a waystone start
  changes it).
- **W5.** A waystone start plays the starting map's music from the first step.

### Listening

- **L1.** A development jukebox (`?jukebox` in the address) plays any map's music in any
  arrangement and loop, over the menus or a run.
- **L2.** The atlas on the setup screen names each reached map's theme and has a **Listen**
  button that plays it with the full band.

### The mix

- **M1.** Each new theme's layers are trimmed (per-layer `trim` in its band) so that, played alone,
  each sits near the Ruins' same layer, and each arrangement sits near the Ruins' same arrangement.
  `node scripts/music-mix.mjs` renders and compares them.
- **M2.** Each ambient bed sits well under the calm arrangement.
- **M3.** No render peaks above the limiter's threshold by more than it can catch.

## 6. Delivery phases

1. **Plumbing:** the band as data, per-track echo and room, map changes, the cue function, the
   build-up fix, swing, new chord types, the jukebox.
2. **Mycelium Hollows:** its instruments, both themes and the cave bed.
3. **Rimefrost Catacombs:** bells, the room, the toll, both themes and the wind bed.
4. **Ember Depths:** distortion, the anvil, toms, both themes and the lava bed.
5. **Polish:** the stings and the way down, deeper loops, the menus following the start map,
   the atlas's Listen button, the mix, docs and the full play-test.

## 7. Not in scope

- Per-map sound effects.
- Recorded or generated audio.
- Any change to the Ruins' two themes.

## 8. As built

Everything above is in. Notes on what it came to:

- **Files.** `src/game/music/score.ts` holds every theme, band, sting and scene as data;
  `synth.ts` the one data-driven voice (`playVoice`) and the drums (kick, snare, rim, clap, hats,
  crash, woodblock, tom, anvil) and the room (`createReverb`); `ambience.ts` the three beds;
  `player.ts` the tracks, crossfades, sting and beds; `mood.ts` the cue (`musicCue`). The
  development jukebox is `src/ui/Jukebox.tsx` (left out of production builds). The atlas's
  Listen button is on the setup screen.
- **The sting** plays with the fallen boss's map band, in its key, on the next beat; the band
  holds silent for `VICTORY_HOLD` (3.2 s of play) unless the relic choice comes first.
- **Mix, measured** with `node scripts/music-mix.mjs` (weighted RMS over 24 s, compared with the
  Ruins' same arrangement):

  | Map | calm | warning | run0 | run1 | run2 | boss1 | boss2 | ambience under calm |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Mycelium Hollows | +0.0 | +0.1 | −0.2 | −0.4 | −0.4 | −0.1 | −0.1 | −12.2 dB |
  | Rimefrost Catacombs | +0.8 | +0.4 | +0.8 | +0.0 | +0.1 | +0.3 | +0.3 | −10.8 dB |
  | Ember Depths | −0.3 | −0.4 | −0.2 | +0.1 | +0.1 | +0.3 | +0.3 | −10.0 dB |

  Each layer alone is within about 1 dB of the Ruins' same layer, except where meant: the
  Catacombs' drums and hats sit 2 dB under (a sparse kit), the Ember's drums 1 dB over (the
  forge), and the Catacombs' boss bass 1.8 dB over because its bell tolls every two bars. The
  loudest peak anywhere is the Ember's sting at −2.8 dBFS, which the final limiter catches.
- **Not checkable by machine:** whether each theme sounds right. The tests check that every note
  is in its scale and every bar starts on a chord tone, and the mix is matched by measurement,
  but the themes still need listening to (`?jukebox`).
