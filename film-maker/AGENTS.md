# Film Maker — guide for agents

The whole film lives as plain JSON under `project/`. Edit those files directly; the running
app (`npm run dev`) watches them and reloads live, with your change on the undo stack.
The schema source of truth is `src/model/schema.ts` (zod). Always finish with:

```bash
npm run validate      # schema + references + media + stale dialog audio
```

## Layout

```
project/
  project.json                       title, fps, resolution, ordered episode ids, tts engine
  episodes/<ep>/episode.json         ordered scene ids, episode-level tracks (e.g. the score)
  episodes/<ep>/scenes/<scene>.json  the scene and ALL its shots (shots[] is ordered)
  characters/<id>.json               name, voice (Piper id), colour, optional mesh
  environments/<id>.json             background, fog, lighting, props[] (asset placements), marks[]
  assets/<id>.json                   mesh (.glb), textures, kind
  score/<cue>.json                   deterministic score cue (seed + parameters + overrides)
  credits/intro.json, outro.json     global credits played on every episode (cards, roll, music cue)
  media/                             boards/, meshes/*.glb, textures/, hdri/*.hdr, audio/{dialog,sfx,score}/
```

Ids: `[A-Za-z0-9_-]+`. Scene ids are global (`ep01_sc03`); shot ids are unique within a scene (`sh02`).

## Time model

* All times are **seconds**, relative to the owner (shot, scene or episode).
* Shots are laid end to end; a scene's length is the sum of its shots; same for episodes.
  To retime, change `shot.duration`. Nothing else moves except what comes after.
* Each owner has `tracks`: `storyboard`, `camera`, `subtitles`, `dialog`, `sfx`, `score`.
  Every clip has `id`, `start`, `duration`. Clips may extend past their owner (J/L cuts).
* Dialog lines with `subtitle: true` also show as subtitles, so don't duplicate them on the subtitle track.

## Common edits

| Goal | Edit |
|---|---|
| Rewrite a line | `shots[i].tracks.dialog[j].text`, delete `audio` + `audioHash`, then `npm run tts` (sets real durations, lengthens shots that are too short) |
| New shot | append to `shots[]` (or `npm run fm -- add-shot ep01_sc02 "Name" --duration 4 --vo "Line" --visual "What we see"`) |
| Reorder | reorder `shots[]` in the scene, or `scenes[]` in `episode.json` |
| Camera move | `tracks.camera[k].keys[]`: `{ t, position:[x,y,z], target:[x,y,z], fov }` (Y-up metres, vertical fov in degrees). `ease`: `smooth` or `linear` |
| Storyboard | put an image/GIF/MP4 in `media/boards/`, add `{ id, start, duration, image: "media/boards/x.png" }` |
| Music | change `seed`/`key`/`mode`/`tempo`/`density`/`instruments` in `score/<cue>.json`; add `overrides` (`mute`/`transpose`/`gain` per instrument + bar range). Same cue → identical music. |
| Story arc | `scene.arc = { tension: 0..1, beat, note }` (beats: setup, inciting, rising, midpoint, crisis, climax, resolution); optional `shot.tension` refines the curve; `episode.theme`, `episode.arc.beat` (role in the season), `project.season = { title, logline }`. View on the Story arcs page. |
| Credits | edit `credits/intro.json` / `outro.json`: `cards[] { start, duration, align, lines[] { text, size: xl/lg/md/sm } }`, optional `roll { start, duration, sections[] { heading, names[] } }`, `music.cueId`. Text placeholders: `{project}` `{season}` `{episode.number}` `{episode.title}` `{episode.theme}`. Per episode: `episode.credits = { intro, outro }` booleans. Episode timelines start with the intro, so shot times shift by its duration. |
| Character movement | `shot.positions[id].moves[]`: `{ t, position, rotationY? }` (shot-local seconds, eased; repeat a key to dwell). Walkers hop and waddle in the preview; Blender gets eased keys. |
| Body poses | `shot.poses[id] = [{ t, pose }]`, pose ∈ `idle wave point cheer think shrug reach lift crouch arms_crossed`; holds until the next key, blends in over ~0.35s. Walking (stride synced to distance, lean, waddle) and talking (beat gestures, mouth flap while a dialog line plays) layer on top. `npm run fm -- auto-poses [--force]` fills poses from dialog + story beats (`scripts/lib/poses.ts`). Character .glbs need `arm_l/arm_r/leg_l/leg_r` nodes pivoting at shoulder/hip. |
| Expressions | `shot.expressions[id] = [{ t, expression }]`, expression ∈ `neutral happy surprised worried determined sad`; holds until the next key. Drives the `eye_*`/`brow_*`/`mouth` nodes of the character .glb. |
| Background folk | characters tagged `extra` (`folk1`…`folk6`, no voice): add to `shot.characters` with a `positions` entry. |
| Sky / look | `environments/<id>.json`: `hdri` (equirect `.hdr` → lighting + visible sky; `hdriBackground: false` keeps the flat `background`), `hdriIntensity`, `hdriRotation` (deg), `post { bloom, vignette, grain, exposure }`, `preview { position, target, fov }` (thumbnail / establishing camera). Procedural skies + set dressing + the env definitions live in `scripts/gen-environments.ts` (`npm run gen:envs` rewrites environments/ and set assets only). |
| Set dressing | add `{ assetId, position, rotationY, scale }` to `environments/<id>.json` `props` |

## Tools

```bash
npm run fm -- tree                 # outline with ids, durations, status
npm run fm -- show ep01_sc02 sh01  # print a shot
npm run fm -- set ep01_sc02 sh01 status '"done"'
npm run fm -- cue cue_ep01 seed 7
npm run fm -- auto-poses           # body poses for shots that have none
npm run gen:envs                   # skies (.hdr), set-dressing meshes, environments/
npm run tts [-- ep01] [--force]    # Piper TTS for missing/stale lines (falls back to macOS `say`)
npm run export -- ep01             # Blender bundle → export/ep01/
npm test                           # unit tests (score determinism, timeline math, export)
```

## Rules

* Keep JSON pretty-printed (2 spaces). Unknown fields are dropped on the next save.
* Meshes must be glTF 2.0 binary (`.glb`) with PBR metal-rough materials; it's the format both three.js and Blender read.
* Don't hand-edit files in `media/audio/dialog/`; they're a cache keyed by hash(engine, voice, text).
* Re-running `npm run seed` (or `npm run import:aob`) **overwrites** `project/` with generated episodes; edit `scripts/seed-story.ts` for durable story changes.
* Characters stand where `shot.positions[characterId] = { position, rotationY }` says (rotationY 0 faces +Z, toward a default camera). Voices are tuned per character with `voiceTune: { pitch (semitones), speed }`; changing them makes lines stale until `npm run tts`.
