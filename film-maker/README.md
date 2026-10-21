# Film Maker

A local previz and production tool for **The Anatomy of Bitcoin**. It covers episodes, scenes and shots,
storyboards, a multi-track timeline (camera, subtitles, generated dialog, SFX, deterministic score),
a 3D preview, and a one-click export to Blender. Everything is stored as plain JSON so people and agents can work on it together.

```bash
cd film-maker
npm install
npm run setup:tts      # optional: installs Piper TTS + voices into tools/ (falls back to macOS `say`)
npm run dev            # http://localhost:5199
```

## What's inside

| Area | Notes |
|---|---|
| Dashboard | runtime, shot status, missing boards/audio, load errors, recent edits |
| Episodes → Scenes → Shots | each level has **Grid** and **Table** (inline-editable script breakdown) views plus a **Timeline** view. Shots have a **Details** view. |
| Timeline editor | monitor (storyboard / 3D / both, subtitles, safe area), inspector, tracks: Storyboard, Camera, Subtitles, Dialog, Sound FX, Score. Drag, trim and snap clips; drag a shot's right edge to retime; mute/solo/lock; `space` J K L ←→ ↑↓ `Del` `+`/`-` `⌘Z` |
| 3D preview | three.js; environments, glTF props and characters, keyframed shot cameras. **Pilot** mode lets you frame a shot and click “Set key”. “3D frame → board” saves a storyboard panel. |
| Dialog | Piper TTS (offline, open source), cached by text+voice; durations come from the real audio |
| Score | seed → notes (`src/score/compose.ts`) → built-in synth (`render.ts`), identical in browser and Node. Export MIDI for LMMS/MuseScore/Ardour and drop the edited `.mid`/`.wav` back in as a replacement. |
| Library | characters (voices), environments (look, props, marks), assets (`.glb`, PBR textures, refs) |
| Blender | `npm run export -- ep01` writes `export/ep01/{bundle.json, media/, import_project.py}`. Then run `blender --python export/ep01/import_project.py -- export/ep01/bundle.json` |

## Test content: *Mili · Sati · Bit*

`npm run seed` builds two short Pixar-style episodes from `scripts/seed-story.ts`:

- **Ep 1 "Mili, Sati & Bit"** (~80s, light city): meet the trio. Mili (smallest, speed) zooms in, Sati (the hero) solves the stepping-block puzzle, Bit (the muscle) lifts the gate. Then a pulse calls from the dark below.
- **Ep 2 "Into the Dark"** (~80s, three acts with their own score cues): **Finding Signals** (a new node's version/verack handshake), **The Journey** (a transaction is signed, relayed and waits in the mempool) and **Overcome** (proof of work; the block is found).

The script also:
- Generates the character and set meshes procedurally (`scripts/gen-story-assets.ts`).
- Crops storyboards and character refs from `project/media/refs/character_sheet.png`.
- Voices every line with Piper. Each character has their own voice, pitch and speed (Mili: Amy +5 st ×1.15, Sati: Lessac +2 st, Bit: Joe −3 st ×0.9).

The original documentary importer is still available as `npm run import:aob`.

See [AGENTS.md](AGENTS.md) for the data model and agent workflow.
