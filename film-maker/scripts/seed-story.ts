/**
 * Seeds the project with the "Mili · Sati · Bit" story: two Pixar-style episodes.
 *   Ep 1 introduces the trio in the light city; Ep 2 takes them into the dark to
 *   explore the protocol — nodes, a transaction's journey, and mining.
 *
 *   npm run seed                 (overwrites project/ episodes, libraries, score, boards, dialog cache)
 *   npm run seed -- --no-tts     (estimated timings, no audio)
 *
 * Storyboards and character refs are cropped from project/media/refs/character_sheet.png.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Asset, Beat, Character, DialogClip, Environment, Episode, Expression, ExpressionKey, MoveKey, ProjectData, Scene, ScoreCue, SfxClip, StoryboardClip, Vec3 } from '../src/model/schema';
import { SCHEMAS, Shot as ShotSchema } from '../src/model/schema';
import { estimateSpeech, uid } from '../src/model/timeline';
import { PROJECT_DIR, saveAll } from '../server/projectFs';
import { synthesize } from '../server/tts';
import { genCharacters, genExtras, genSets, genStorySfx } from './gen-story-assets';
import { genSfx } from './gen-assets';
import { cam } from './lib/camera';
import { autoPoses } from './lib/poses';
import { ENVIRONMENTS, genSetDressing, genSkies, SET_ASSETS } from './gen-environments';

const NO_TTS = process.argv.includes('--no-tts');
const SHEET = path.join(PROJECT_DIR, 'media/refs/character_sheet.png');

// ------------------------------------------------------------------ sheet crops

/** [x, y, w, h] regions of the 1536×1024 character sheet */
const CROPS: Record<string, [number, number, number, number]> = {
  'boards/hero_banner': [0, 0, 1536, 262],
  'boards/explore': [14, 674, 350, 160],
  'boards/discover': [374, 674, 268, 160],
  'boards/the_protocol': [652, 674, 250, 160],
  'boards/together': [912, 674, 308, 160],
  'boards/a_more_open_world': [1230, 674, 296, 160],
  'boards/into_the_dark': [14, 844, 290, 166],
  'boards/finding_signals': [314, 844, 304, 166],
  'boards/overcome': [628, 844, 282, 166],
  'boards/new_perspectives': [920, 844, 282, 166],
  'boards/same_direction': [1212, 844, 314, 166],
  'refs/mili_card': [14, 272, 496, 171],
  'refs/sati_card': [522, 272, 490, 171],
  'refs/bit_card': [1024, 272, 508, 171],
  'refs/mili_turnaround': [14, 454, 496, 112],
  'refs/sati_turnaround': [522, 454, 490, 112],
  'refs/bit_turnaround': [1024, 454, 508, 112],
  'refs/mili_expressions': [14, 578, 496, 86],
  'refs/sati_expressions': [522, 578, 490, 86],
  'refs/bit_expressions': [1024, 578, 508, 86],
  'refs/light_environments': [10, 670, 1520, 168],
  'refs/dark_environments': [10, 840, 1520, 172],
};

function cropSheet() {
  if (!fs.existsSync(SHEET)) {
    console.warn(`  ⚠ ${path.relative(process.cwd(), SHEET)} not found — skipping storyboard crops`);
    return false;
  }
  for (const [name, [x, y, w, h]] of Object.entries(CROPS)) {
    const out = path.join(PROJECT_DIR, 'media', `${name}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SHEET, '-vf', `crop=${w}:${h}:${x}:${y}`, out]);
    if (r.status !== 0) throw new Error(`ffmpeg crop failed for ${name}: ${r.stderr}`);
  }
  console.log(`  cropped ${Object.keys(CROPS).length} boards/refs from the character sheet`);
  return true;
}

// ------------------------------------------------------------------ library

const characters: Record<string, Character> = Object.fromEntries(
  [
    {
      id: 'sati', name: 'Sati', role: 'The hero', color: '#6f93a8', mesh: 'media/meshes/sati.glb',
      description: 'Intelligent, resourceful, leads the way. Calm under pressure, figures out how things work.',
      voice: 'en_US-lessac-medium', voiceTune: { pitch: 2, speed: 1 },
      refs: ['media/refs/sati_card.png', 'media/refs/sati_turnaround.png', 'media/refs/sati_expressions.png'], tags: ['hero', 'trio'],
    },
    {
      id: 'mili', name: 'Mili', role: 'Speed', color: '#c26a6a', mesh: 'media/meshes/mili.glb', scale: 0.8,
      description: 'The smallest. Curious, playful, impossibly fast — leaves a lightning trail. A thousand Milis make one Sati.',
      voice: 'en_US-amy-medium', voiceTune: { pitch: 5, speed: 1.15 },
      refs: ['media/refs/mili_card.png', 'media/refs/mili_turnaround.png', 'media/refs/mili_expressions.png'], tags: ['sidekick', 'trio'],
    },
    {
      id: 'bit', name: 'Bit', role: 'The muscle', color: '#7fa883', mesh: 'media/meshes/bit.glb',
      description: 'The largest. Strong, loyal, supportive. A hundred million Satis make one Bit.',
      voice: 'en_US-joe-medium', voiceTune: { pitch: -3, speed: 0.9 },
      refs: ['media/refs/bit_card.png', 'media/refs/bit_turnaround.png', 'media/refs/bit_expressions.png'], tags: ['sidekick', 'trio'],
    },
    // generic background folk (no voice): crowds in the plaza, peers in the dark, miners in the hall
    ...(['tall', 'round', 'small', 'tall', 'round', 'small'] as const).map((shape, i) => ({
      id: `folk${i + 1}`, name: `Folk ${i + 1}`, role: 'Background', color: ['#9aa6b8', '#b8a99a', '#a9b89a', '#b89ab0', '#9ab8b5', '#b8b49a'][i],
      mesh: `media/meshes/folk_${shape}.glb`, scale: [1, 1, 1, 0.92, 1.08, 0.9][i],
      description: `A ${shape} citizen of the light city. Fills the background; never speaks.`, tags: ['extra'],
    })),
  ].map((c) => [c.id, SCHEMAS.character.parse(c)]),
);

const A = (id: string, name: string, kind: Asset['kind'], description: string, color = '#e8e6e1', extra: Partial<Asset> = {}) =>
  [id, SCHEMAS.asset.parse({ id, name, kind, description, color, mesh: `media/meshes/${id}.glb`, ...extra })] as const;

const assets: Record<string, Asset> = Object.fromEntries([
  A('marble_floor', 'Marble Floor', 'set', 'Polished white marble tiles (procedural texture).', '#eeeeee', { textures: { baseColor: 'media/textures/marble.png' }, tags: ['light'] }),
  A('marble_block', 'Marble Block', 'prop', 'A 1m white marble cube — scale it for stepping stones or the giant gate block.', '#eeeeee', { tags: ['light'] }),
  A('marble_steps', 'Marble Steps', 'set', 'Four broad steps.', '#eeeeee', { tags: ['light'] }),
  A('arch', 'Arch', 'set', 'Marble archway, 3.2m to the springline.', '#eeeeee', { tags: ['light'] }),
  A('tower', 'Tower', 'set', 'Tall stepped marble tower for the skyline.', '#eeeeee', { tags: ['light'] }),
  A('tree', 'Tree', 'prop', 'Rounded stylised tree.', '#6c8f5e', { tags: ['light'] }),
  A('glass_sphere', 'Glass Sphere', 'fx', 'Floating transparent sphere (alpha-blended glass).', '#dfe7ff', { tags: ['light', 'dark'] }),
  A('obsidian_floor', 'Obsidian Floor', 'set', 'Glossy black reflective ground.', '#111111', { tags: ['dark'] }),
  A('monolith', 'Monolith', 'set', 'Black glossy pillar, 5m.', '#151515', { tags: ['dark'] }),
  A('monolith_cube', 'Monolith Cube', 'set', 'Black glossy 2m cube.', '#151515', { tags: ['dark'] }),
  A('light_shaft', 'Light Shaft', 'fx', 'Volumetric-looking beam of light (alpha, emissive).', '#ffffff', { tags: ['dark'] }),
  A('hex_beacon', 'Hex Beacon', 'prop', 'Glowing hexagonal frame — a new node calling for peers.', '#cfe0ff', { tags: ['dark', 'protocol'] }),
  A('tx_orb', 'Transaction Orb', 'prop', 'A glowing transaction with its signature ring.', '#ffd58c', { tags: ['protocol'] }),
  A('hash_block', 'Hash Block', 'prop', 'Dark block with glowing edges — a mining attempt.', '#9fb6ff', { tags: ['dark', 'protocol'] }),
  A('mempool_bubble', 'Mempool Bubble', 'fx', 'Glass bubble holding a waiting transaction.', '#dfe7ff', { tags: ['protocol'] }),
]);

// environments, skies and set dressing live in gen-environments.ts (npm run gen:envs)
const environments: Record<string, Environment> = ENVIRONMENTS;

// ------------------------------------------------------------------ blocking helpers

type Who = 'sati' | 'mili' | 'bit';
type Blocking = Partial<Record<Who, [Vec3, number?]>>;
const TRIO: Blocking = { mili: [[-1.1, 0, 0.35], 15], sati: [[0, 0, 0]], bit: [[1.6, 0, -0.25], -12] };
// head-centre heights and head radii (after character scale), for framing
const HEAD = { mili: 0.264, sati: 0.58, bit: 1.5 };
const HEAD_R = { mili: 0.176, sati: 0.32, bit: 0.6 };
const at = (b: Blocking, who: keyof typeof HEAD): Vec3 => {
  const pos = b[who]?.[0] ?? [0, 0, 0];
  return [pos[0], HEAD[who], pos[2]];
};
const mid = (b: Blocking): Vec3 => {
  const ps = Object.keys(b).map((k) => at(b, k as keyof typeof HEAD));
  const n = ps.length || 1;
  return [ps.reduce((s, q) => s + q[0], 0) / n, 0.6, ps.reduce((s, q) => s + q[2], 0) / n];
};

const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Close-up on one character's face, from `side` degrees off their facing, with a slow push-in. */
const close = (who: Who, side = 18, fov = 28) => (d: number, b: Blocking) => {
  const head = at(b, who);
  const a = rad((b[who]?.[1] ?? 0) + side);
  const dir: Vec3 = [Math.sin(a), 0.06, Math.cos(a)];
  const dist = HEAD_R[who] * 8.5;
  return cam.move(add(head, dir, dist * 1.12), add(head, dir, dist), head, head, fov, 'close-up')(d);
};

/** Over `from`'s shoulder onto `to`'s face. */
const ots = (from: Who, to: Who, fov = 32) => (d: number, b: Blocking) => {
  const f = at(b, from);
  const t = at(b, to);
  const dx = f[0] - t[0];
  const dz = f[2] - t[2];
  const len = Math.hypot(dx, dz) || 1;
  const back: Vec3 = [dx / len, 0, dz / len];
  const sideV: Vec3 = [-back[2], 0, back[0]];
  const r = HEAD_R[from];
  const pos = add(add(add(f, back, r * 2.6), sideV, r * 1.4), [0, r * 0.5, 0]);
  return cam.move(pos, add(pos, back, -r * 0.6), t, t, fov, 'over-shoulder')(d);
};

// ------------------------------------------------------------------ background folk

/** An extra's mark: position, facing, and optional walk keys as [fraction of shot, position, rotationY?]. */
type Extra = [Vec3, number, Move[]?];
type Move = [number, Vec3, number?];
type Crowd = Record<string, Extra>;
const facing = (from: Vec3, to: Vec3) => (Math.atan2(to[0] - from[0], to[2] - from[2]) * 180) / Math.PI;

const CROWD: Record<string, Crowd> = {
  // light city: people strolling across the back of the plaza, a few chatting in pairs
  plaza: {
    folk1: [[-7, 0, -5], 90, [[1, [7, 0, -5]]]],
    folk2: [[3.5, 0, -3.6], -40],
    folk3: [[4.2, 0, -3.1], -100],
    folk4: [[6.5, 0, -7.5], -90, [[1, [-6, 0, -7.5]]]],
    folk5: [[-4.2, 0, -3.2], 40],
    folk6: [[-3.5, 0, -3.8], -80],
  },
  // the city edge: a few onlookers, still
  edge: {
    folk2: [[-4, 0, 1.5], 160],
    folk3: [[-3.4, 0, 1.9], 170],
    folk4: [[4.5, 0, 1], 200],
  },
  // the dark: newly connected peers gathered around the beacon at (0, 0, -4)
  peers: Object.fromEntries(([[-4, 0, -6.5], [4.5, 0, -6], [-6, 0, -2.5], [6, 0, -3], [-2, 0, -8.5], [2.6, 0, -9]] as Vec3[]).map((p, i) => [`folk${i + 1}`, [p, facing(p, [0, 0, -4])] as Extra])),
  // the mempool: other travellers drifting between bubbles
  travellers: {
    folk1: [[-5, 0, -4], 70, [[1, [-1.5, 0, -6]]]],
    folk3: [[4, 0, -3], -120],
    folk5: [[5, 0, -7], -100, [[1, [2, 0, -8.5]]]],
  },
  // the mining hall: miners pacing between the rows of hash blocks
  miners: {
    folk1: [[-5.5, 0, -4.5], 90, [[0.5, [5.5, 0, -4.5], 90], [1, [-5.5, 0, -4.5], -90]]],
    folk2: [[5, 0, -7.5], -90, [[0.6, [-4, 0, -7.5], -90], [1, [-1, 0, -7.5], 90]]],
    folk4: [[-3, 0, -1.6], 160],
    folk5: [[3.2, 0, -1.8], 200],
    folk6: [[0, 0, -9.5], 0, [[1, [2, 0, -9.5], 90]]],
  },
};

// ------------------------------------------------------------------ shots

interface Line {
  who: Who;
  text: string;
  /** pause before this line (default 0.35s) */
  gap?: number;
  /** the speaker's expression from the start of this line */
  face?: Expression;
  /** listeners' expressions from the start of this line */
  react?: Partial<Record<Who, Expression>>;
}
interface ShotSpec {
  name: string;
  visual: string;
  lines?: Line[];
  min?: number;
  firstLineAt?: number;
  env?: string;
  board?: string;
  blocking?: Blocking;
  /** walks during the shot: [fraction of shot, position, rotationY?] from the blocking mark */
  moves?: Partial<Record<Who, Move[]>>;
  /** expression changes at fractions of the shot (lines can also set `face` / `react`) */
  faces?: Partial<Record<Who, [number, Expression][]>>;
  /** background folk: a CROWD preset name or explicit marks */
  crowd?: keyof typeof CROWD | Crowd;
  /** expression changes for the whole crowd at fractions of the shot */
  crowdFaces?: [number, Expression][];
  camera: (d: number, b: Blocking) => import('../src/model/schema').CameraClip;
  sfx?: { file: string; at: number | 'end'; gain?: number }[];
  notes?: string;
  status?: 'todo' | 'wip' | 'review' | 'done';
  /** optional finer point on the story arc */
  tension?: number;
}
interface SceneSpec {
  title: string;
  summary: string;
  env: string;
  shots: ShotSpec[];
  cue?: Partial<ScoreCue> & { seed: number; name: string };
  arc: { tension: number; beat?: Beat; note: string };
}

const SFX_LEN: Record<string, number> = { zap: 0.7, thud: 0.9, chime: 2.5, sparkle: 1.4, stone_grind: 2, pulse: 2.4, whoosh: 1.6, impact: 1.8, blip: 0.25, ping: 1.4, click: 0.08, hum: 4 };

async function buildShot(spec: ShotSpec) {
  const dialog: DialogClip[] = [];
  let t = spec.firstLineAt ?? 0.6;
  for (const [i, l] of (spec.lines ?? []).entries()) {
    if (i > 0) t += l.gap ?? 0.35;
    const ch = characters[l.who];
    let duration = estimateSpeech(l.text) / (ch.voiceTune.speed || 1);
    let audio: string | undefined;
    let audioHash: string | undefined;
    if (!NO_TTS) {
      const r = await synthesize({ text: l.text, voice: ch.voice, tune: ch.voiceTune });
      ({ duration, audio, audioHash } = r);
      process.stdout.write(r.cached ? '·' : '+');
    }
    dialog.push({ id: uid('dlg'), start: Math.round(t * 1000) / 1000, duration: Math.round(duration * 1000) / 1000, characterId: l.who, text: l.text, audio, audioHash, subtitle: true, gain: 1 });
    t += duration;
  }
  const duration = Math.ceil(Math.max(spec.min ?? 3.5, t + 0.8) * 2) / 2;
  const blocking = spec.blocking ?? TRIO;
  const storyboard: StoryboardClip[] = spec.board ? [{ id: uid('brd'), start: 0, duration, image: `media/boards/${spec.board}.png` }] : [];
  const sfx: SfxClip[] = (spec.sfx ?? []).map((s) => {
    const len = SFX_LEN[s.file] ?? 1;
    return { id: uid('sfx'), start: s.at === 'end' ? Math.max(0, duration - len * 0.7) : s.at, duration: len, file: `media/audio/sfx/${s.file}.wav`, gain: s.gain ?? 0.7 };
  });
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const toMoves = (ms?: Move[]): MoveKey[] | undefined => ms?.length ? ms.map(([f, position, rotationY]) => ({ t: r3(f * duration), position, rotationY })) : undefined;
  const crowd: Crowd = typeof spec.crowd === 'string' ? CROWD[spec.crowd] : (spec.crowd ?? {});
  const positions: Record<string, { position: Vec3; rotationY: number; moves?: MoveKey[] }> = {};
  for (const [k, v] of Object.entries(blocking)) positions[k] = { position: v![0], rotationY: v![1] ?? 0, moves: toMoves(spec.moves?.[k as Who]) };
  for (const [k, [position, rotationY, ms]] of Object.entries(crowd)) positions[k] = { position, rotationY, moves: toMoves(ms) };
  // expressions: shot fractions, then line-driven changes (speaker `face`, listeners `react`)
  const expressions: Record<string, ExpressionKey[]> = {};
  const face = (k: string, t: number, expression: Expression) => (expressions[k] ??= []).push({ t: r3(t), expression });
  for (const [k, list] of Object.entries(spec.faces ?? {})) for (const [f, e] of list!) face(k, f * duration, e);
  (spec.lines ?? []).forEach((l, i) => {
    if (l.face) face(l.who, dialog[i].start, l.face);
    for (const [k, e] of Object.entries(l.react ?? {})) face(k, dialog[i].start + 0.3, e!);
  });
  for (const [f, e] of spec.crowdFaces ?? []) for (const k of Object.keys(crowd)) face(k, f * duration + (k.charCodeAt(4) % 3) * 0.15, e);
  for (const list of Object.values(expressions)) list.sort((a, b) => a.t - b.t);
  const who = [...Object.keys(blocking), ...Object.keys(crowd)];
  const shot = ShotSchema.parse({
    id: 'tmp',
    name: spec.name,
    duration,
    status: spec.status ?? (spec.board ? 'wip' : 'todo'),
    description: spec.visual,
    notes: spec.notes ?? '',
    environmentId: spec.env,
    tension: spec.tension,
    characters: who,
    positions,
    expressions: Object.keys(expressions).length ? expressions : undefined,
    tracks: { storyboard, camera: [spec.camera(duration, blocking)], subtitles: [], dialog, sfx, score: [] },
  });
  shot.poses = autoPoses(shot);
  return shot;
}

// ------------------------------------------------------------------ story

const EP1: SceneSpec[] = [
  {
    title: 'Explore', env: 'light_city', arc: { tension: 0.25, beat: 'setup', note: 'Meet Mili — speed and curiosity — in a bright, safe world.' }, summary: 'Dawn over the light city. Mili arrives at full speed — and stops less gracefully.',
    shots: [
      { name: 'Dawn over the city', visual: 'Wide establishing shot. Sun rising between marble towers; glass spheres drift in the air. Citizens stroll the plaza; three small glows among them.', min: 6, board: 'hero_banner',
        crowd: 'plaza', faces: { sati: [[0, 'happy']], bit: [[0, 'happy']] },
        camera: (d, b) => cam.crane(mid(b), 9, 0.6, 4.5, 50)(d), sfx: [{ file: 'sparkle', at: 1.2, gain: 0.5 }] },
      { name: 'Mili zooms in', visual: 'Mili streaks across frame trailing lightning, scattering passers-by, and skids to a stop.', board: 'explore',
        blocking: { mili: [[-5, 0, 1.6], 90] }, moves: { mili: [[0.35, [-1.5, 0, 2.2], 60], [0.6, [-0.4, 0, 0.8], 25]] },
        faces: { mili: [[0, 'happy']] }, crowd: 'plaza', crowdFaces: [[0.15, 'surprised'], [0.7, 'happy']],
        lines: [{ who: 'mili', text: 'Wheee! Out of the way, out of the way!' }], firstLineAt: 0.8,
        camera: (d) => cam.move([-3, 0.5, 3.4], [1.2, 0.45, 2.2], [-2.6, 0.3, 1.8], [-0.4, 0.26, 0.8], 38, 'whip-follow')(d), sfx: [{ file: 'zap', at: 0.1 }, { file: 'whoosh', at: 0.6, gain: 0.5 }] },
      { name: 'Bonk', visual: 'Mili bounces off a floating glass sphere — BONK — and spins to a stop, dizzy but delighted.', blocking: { mili: [[-1.4, 0, -0.5], -20] },
        moves: { mili: [[0.12, [-1.8, 0, -0.9], 160], [0.3, [-1.8, 0, -0.9], -20]] },
        lines: [{ who: 'mili', text: 'Ow.', face: 'worried' }, { who: 'mili', text: 'Did you see that? I was SO fast!', gap: 0.5, face: 'happy' }], firstLineAt: 1.1,
        faces: { mili: [[0.08, 'surprised']] },
        camera: (d, b) => cam.push(at({ mili: [[-1.8, 0, -0.9]] }, 'mili'), 2.4, 1.4, 0.15, 35)(d), sfx: [{ file: 'chime', at: 0.3, gain: 0.6 }, { file: 'thud', at: 0.35, gain: 0.4 }] },
      { name: 'Sati arrives', visual: 'Sati walks in calmly, arms behind back, one eyebrow raised. Mili spins round.', min: 3.5,
        blocking: { mili: [[-1.8, 0, -0.9], -20], sati: [[1.6, 0, 1.4], -100] }, moves: { sati: [[0.75, [-0.3, 0, -0.2], -60]], mili: [[0.55, [-1.8, 0, -0.9], 30]] },
        faces: { sati: [[0, 'determined']], mili: [[0.55, 'surprised']] }, crowd: { folk2: [[3.5, 0, -3.6], -40], folk3: [[4.2, 0, -3.1], -100] },
        camera: (d) => cam.orbit([-0.6, 0.4, -0.3], 3.6, 0.3, -5, 20, 40)(d) },
      { name: 'The whole city saw', visual: 'Close on Sati: deadpan, then the corner of a smile.', blocking: { mili: [[-1.8, 0, -0.9], 30], sati: [[-0.3, 0, -0.2], -60] },
        lines: [{ who: 'sati', text: 'We saw, Mili. The whole city saw.', face: 'determined' }], faces: { sati: [[0.85, 'happy']] },
        camera: close('sati', 25) },
      { name: 'Hehe', visual: 'Close on Mili, sheepish grin.', blocking: { mili: [[-1.8, 0, -0.9], 30], sati: [[-0.3, 0, -0.2], -60] },
        lines: [{ who: 'mili', text: 'Hehe.', face: 'happy' }], faces: { mili: [[0, 'worried']] }, min: 2,
        camera: close('mili', -20) },
    ],
  },
  {
    title: 'Discover', env: 'light_plaza', arc: { tension: 0.35, beat: 'rising', note: 'Sati leads with brains, not speed: follow the chain, one block at a time.' }, summary: 'Sati works out the stepping-block puzzle: each block only lights after the one before it.',
    shots: [
      { name: 'The stepping blocks', visual: 'A row of marble blocks leads up the steps. Sati studies them, head tilted; the first block glows faintly.', board: 'discover',
        blocking: { sati: [[-2.4, 0, -0.4], 35], mili: [[-3.4, 0, 0.2], 40] }, moves: { mili: [[0.5, [-3, 0, -0.2], 60]] },
        faces: { sati: [[0, 'determined']], mili: [[0, 'surprised']] }, crowd: { folk5: [[-5, 0, -6], 20], folk6: [[-4.4, 0, -6.4], -40] },
        lines: [{ who: 'sati', text: 'Look. They only light up in order. Every block follows the one before it.' }],
        camera: (d, b) => cam.move([-4.6, 1.1, 2.4], [-3.2, 0.9, 1.8], at(b, 'sati'), [0, 0.3, -2.6], 36, 'over-shoulder')(d), sfx: [{ file: 'blip', at: 2.2 }, { file: 'blip', at: 2.8 }] },
      { name: 'Penny drops', visual: 'Close on Mili: the idea lands. Eyes go wide, then a huge grin.', blocking: { sati: [[-2.4, 0, -0.4], 35], mili: [[-3, 0, -0.2], 60] }, min: 2.5,
        faces: { mili: [[0, 'surprised'], [0.5, 'happy']] }, camera: close('mili', -10) },
      { name: 'Follow the chain', visual: 'Mili hops onto the first block, then the next — each lights as they land. Sati follows, a step behind.',
        blocking: { sati: [[-2.4, 0, -0.4], 35], mili: [[-2.6, 0, -0.6], 40] },
        moves: {
          mili: [[0.12, [-1.5, 0.5, -1.5], 30], [0.3, [-0.3, 0.5, -2.6], 35], [0.48, [1, 0.5, -3.8], 30], [0.66, [2.4, 0.5, -5], 20]],
          sati: [[0.3, [-1.5, 0.5, -1.5], 35], [0.55, [-0.3, 0.5, -2.6], 35], [0.8, [1, 0.5, -3.8], 30]],
        },
        faces: { mili: [[0, 'happy']], sati: [[0, 'determined']] },
        lines: [{ who: 'mili', text: 'So we just... follow the chain?' }, { who: 'sati', text: 'Exactly. One block at a time. This way!', face: 'happy' }],
        camera: (d) => cam.orbit([0, 0.4, -2.6], 5, 1.4, 50, 15, 42)(d), sfx: [{ file: 'blip', at: 0.4 }, { file: 'blip', at: 1.1 }, { file: 'blip', at: 1.8 }] },
    ],
  },
  {
    title: 'Together', env: 'sealed_gate', arc: { tension: 0.6, beat: 'crisis', note: 'A wall none of them can move alone. Enter Bit.' }, summary: 'A giant block seals the archway. Enter Bit.',
    shots: [
      { name: 'Dead end', visual: 'The arch is sealed by a marble block three times their height. Mili pushes with all their might; nothing.', board: 'together',
        blocking: { mili: [[-0.3, 0, -2.3], 180], sati: [[0.8, 0, -1.2], 160] }, moves: { mili: [[0.2, [-0.3, 0, -2.42], 180], [0.35, [-0.3, 0, -2.3], 180], [0.5, [-0.3, 0, -2.42], 180], [0.7, [-0.4, 0, -1.6], 30]] },
        faces: { mili: [[0, 'determined']], sati: [[0, 'worried']] },
        lines: [{ who: 'mili', text: 'Hnnnngh! Dead end!', face: 'sad' }],
        camera: (d) => cam.still([2.6, 0.8, 2.2], [0, 1.1, -3], 45)(d), sfx: [{ file: 'stone_grind', at: 0.6, gain: 0.35 }] },
      { name: 'Too heavy', visual: 'Close on Sati looking up at the block, thinking hard — and coming up empty.', blocking: { mili: [[-0.4, 0, -1.6], 30], sati: [[0.8, 0, -1.2], 160] },
        lines: [{ who: 'sati', text: "It's too heavy for us.", face: 'worried' }], faces: { sati: [[0, 'determined']] }, min: 2.5,
        camera: close('sati', 30) },
      { name: 'Enter Bit', visual: 'A big shadow. Bit strides in, cracks knuckles, and lifts the block overhead in one smooth move.', env: 'open_gate',
        blocking: { bit: [[4.5, 0, 0.4], -90], sati: [[-0.5, 0, 0.4], 150], mili: [[-1.4, 0, 0.6], 160] },
        moves: { bit: [[0.3, [1.4, 0, -1.3], -15]], sati: [[0.25, [-0.5, 0, 0.4], 100]], mili: [[0.25, [-1.4, 0, 0.6], 95]] },
        faces: { bit: [[0, 'determined']], sati: [[0.25, 'surprised']], mili: [[0.25, 'surprised']] },
        lines: [{ who: 'bit', text: 'Leave the heavy stuff to me.', face: 'happy' }], firstLineAt: 1.4, min: 6,
        camera: (d) => cam.move([-0.6, 0.35, 3.4], [-0.3, 0.3, 2.6], [1.2, 1.4, -1.3], [1.2, 1.9, -1.3], 50, 'low-angle hero')(d), sfx: [{ file: 'thud', at: 0.3 }, { file: 'stone_grind', at: 0.9 }] },
      { name: 'Jaws drop', visual: 'Close on Mili, mouth open, staring up — then delight.', blocking: { bit: [[1.4, 0, -1.3], -15], mili: [[-1.4, 0, 0.6], 95] }, min: 2.5,
        faces: { mili: [[0, 'surprised'], [0.6, 'happy']] }, camera: close('mili', -25) },
      { name: 'Show off', visual: 'Mili and Sati grin up at Bit, still holding the block like it weighs nothing.', env: 'open_gate',
        blocking: { bit: [[1.4, 0, -1.3], -30], sati: [[-0.5, 0, 0.4], 60], mili: [[-1.4, 0, 0.6], 55] }, moves: { mili: [[0.4, [-0.6, 0, 0.1], 55]] },
        faces: { mili: [[0, 'happy']], sati: [[0, 'happy']] },
        lines: [{ who: 'mili', text: 'Bit! Show off.' }],
        camera: (d, b) => cam.orbit(mid(b), 4.5, 0.6, -20, 5, 40)(d) },
      { name: 'Supportive', visual: 'Close on Bit: a modest, enormous smile.', blocking: { bit: [[1.4, 0, -1.3], -30], mili: [[-0.6, 0, 0.1], 55] },
        lines: [{ who: 'bit', text: 'Just being supportive.', face: 'happy' }],
        camera: close('bit', -20) },
    ],
  },
  {
    title: 'Names', env: 'light_plaza', arc: { tension: 0.3, beat: 'resolution', note: 'Theme stated: big or small, every one counts.' }, summary: 'Walking through the gate, the trio compare sizes — and units.',
    shots: [
      { name: 'Why so small?', visual: 'Walking side by side. Mili jogs to keep up, looking up at the others. Folk pass the other way.',
        blocking: { mili: [[-1, 0, 1.4], 180], sati: [[0, 0, 1.2], 180], bit: [[1.5, 0, 1], 180] },
        moves: { mili: [[1, [-1, 0, -1], 170]], sati: [[1, [0, 0, -1.2], 180]], bit: [[1, [1.5, 0, -1.4], 185]] },
        crowd: { folk1: [[-3, 0, -6], 0, [[1, [-3, 0, -1]]]], folk4: [[3.5, 0, -7], 0, [[1, [3.5, 0, -2]]]] },
        lines: [{ who: 'mili', text: 'Hey. Why am I always the smallest?', face: 'sad' }, { who: 'sati', text: "Because you're a Mili. A thousand of you make one Sati.", face: 'happy', react: { mili: 'surprised' } }],
        camera: (d) => cam.move([0.6, 1, -4.2], [0.6, 1, -5.4], [0, 0.6, 1.2], [0, 0.6, -1.2], 38, 'walk-and-talk (leading)')(d) },
      { name: 'A hundred million', visual: 'Mili turns to Bit. Bit beams down.', blocking: { mili: [[-0.5, 0, 0.6], 60], bit: [[0.9, 0, 0.2], -40] },
        faces: { bit: [[0, 'happy']] },
        lines: [{ who: 'mili', text: 'And how many Satis make a Bit?' }, { who: 'bit', text: 'A hundred million.', face: 'happy' }],
        camera: ots('mili', 'bit') },
      { name: 'Whoa', visual: 'Close on Mili doing the maths on tiny fingers, eyes going wide.', blocking: { mili: [[-0.5, 0, 0.6], 60], bit: [[0.9, 0, 0.2], -40] },
        faces: { mili: [[0, 'determined']] },
        lines: [{ who: 'mili', text: 'Whoa.', gap: 0.7, face: 'surprised' }], firstLineAt: 1.2, min: 3,
        camera: close('mili', -15) },
      { name: 'Every one counts', visual: 'Sati walks over and puts an arm around Mili. Behind them, the light city opens up — wide and bright.', board: 'a_more_open_world',
        moves: { sati: [[0.4, [-0.6, 0, 0.3], -20]] }, faces: { sati: [[0, 'happy']], mili: [[0.4, 'happy']], bit: [[0, 'happy']] }, crowd: 'plaza',
        lines: [{ who: 'sati', text: 'Big or small, every one of us counts.' }],
        camera: (d, b) => cam.pull(mid(b), 3.4, 8, 45)(d), sfx: [{ file: 'sparkle', at: 0.5, gain: 0.4 }] },
    ],
  },
  {
    title: 'The Protocol', env: 'city_edge', arc: { tension: 0.75, beat: 'inciting', note: 'The call to adventure — the season’s inciting incident.' }, summary: 'At the rim of the city, a pulse from the dark world below. Cliffhanger.',
    shots: [
      { name: 'A pulse', visual: 'A deep pulse rolls through the plaza. The glass spheres tremble. Everyone freezes — the onlookers too.', board: 'the_protocol',
        blocking: { mili: [[-1, 0, 1.2], 160], sati: [[0, 0, 1], 180], bit: [[1.5, 0, 0.8], 200] },
        faces: { mili: [[0.05, 'surprised']], sati: [[0.05, 'surprised']], bit: [[0.05, 'surprised']] }, crowd: 'edge', crowdFaces: [[0.08, 'surprised'], [0.6, 'worried']],
        lines: [{ who: 'mili', text: 'What was that?', face: 'worried' }], firstLineAt: 1.8, min: 5,
        camera: (d) => cam.still([0, 1, 4.6], [0, 0.7, 0], 40)(d), sfx: [{ file: 'pulse', at: 0 }] },
      { name: 'Sati listens', visual: 'Close on Sati, very still, listening. Fear gives way to resolve.', blocking: { sati: [[0, 0, 1], 180] }, min: 3,
        faces: { sati: [[0, 'worried'], [0.55, 'determined']] }, camera: close('sati', 0, 26) },
      { name: 'Something is calling', visual: 'Reverse: the trio walk to the edge, silhouetted, looking down. Far below, a hex beacon pulses in the dark.',
        blocking: { mili: [[-1, 0, -0.4], 180], sati: [[0, 0, -0.6], 180], bit: [[1.5, 0, -0.7], 180] },
        moves: { mili: [[0.35, [-1, 0, -1.8], 180]], sati: [[0.3, [0, 0, -2], 180]], bit: [[0.4, [1.5, 0, -2.1], 180]] },
        faces: { sati: [[0, 'determined']], mili: [[0, 'worried']], bit: [[0, 'determined']] },
        lines: [{ who: 'sati', text: "Something's calling. From down there." }, { who: 'bit', text: 'Then we go together.', gap: 0.6, react: { mili: 'happy' } }], min: 6,
        camera: (d) => cam.move([0, 1.6, 2.8], [0, 2.4, 1.4], [0, -2, -20], [0, -7, -24], 42, 'over-the-edge')(d), sfx: [{ file: 'chime', at: 0.8, gain: 0.4 }, { file: 'pulse', at: 3, gain: 0.5 }] },
    ],
  },
];

const EP2: SceneSpec[] = [
  {
    title: 'Finding Signals', env: 'dark_monoliths', arc: { tension: 0.5, beat: 'rising', note: 'Fear of the dark turns into purpose: they connect a lonely node.' }, summary: 'Act 1 — Nodes. The beacon is a brand-new node calling for peers; the trio carry its handshake.',
    cue: { name: 'Finding Signals', seed: 3301, key: 'D', mode: 'phrygian', tempo: 68, density: 0.3 },
    shots: [
      { name: 'Into the dark', visual: 'The trio step into a forest of black monoliths, huddled close. Their own glow is the only light.', board: 'into_the_dark',
        blocking: { mili: [[-0.9, 0, 2.4], 180], sati: [[0, 0, 2.2], 180], bit: [[1.3, 0, 2], 180] },
        moves: { mili: [[1, [-0.6, 0, 0.4], 175]], sati: [[1, [0, 0, 0.2], 180]], bit: [[1, [1.1, 0, 0], 185]] },
        faces: { mili: [[0, 'worried']], sati: [[0, 'determined']] },
        lines: [{ who: 'mili', text: "It's so dark down here." }, { who: 'bit', text: 'Stay close.', face: 'determined' }], firstLineAt: 1.5, min: 6,
        camera: (d) => cam.move([0.4, 1, -3], [0.3, 0.9, -4.4], [0, 0.6, 2.2], [0, 0.6, 0.2], 42, 'leading')(d), sfx: [{ file: 'hum', at: 0, gain: 0.4 }] },
      { name: 'The beacon', visual: 'A glowing hexagon hums in a clearing, pulsing like a heartbeat. Sati steps closer.', env: 'signal_chamber', board: 'finding_signals',
        blocking: { sati: [[0, 0, 0.2], 180], mili: [[-1, 0, -0.9], 200], bit: [[1.2, 0, -1], 160] }, moves: { sati: [[0.5, [0, 0, -1.4], 180]] },
        faces: { sati: [[0, 'surprised'], [0.5, 'determined']], mili: [[0, 'surprised']] },
        lines: [{ who: 'sati', text: "It's a node. A brand new one." }],
        camera: (d) => cam.move([-2.8, 0.7, 2.2], [-1.9, 0.9, 1.4], [0, 1, -4], [0, 1.2, -4], 40, 'reveal')(d), sfx: [{ file: 'pulse', at: 0.2, gain: 0.6 }] },
      { name: 'No one answers', visual: 'Close on Sati, the beacon light pulsing across their face.', env: 'signal_chamber', blocking: { sati: [[0, 0, -1.4], 160] },
        lines: [{ who: 'sati', text: "It's calling for peers, but no one's answering.", face: 'sad' }],
        camera: close('sati', 20), sfx: [{ file: 'chime', at: 1, gain: 0.3 }] },
      { name: 'Carry the hello', visual: "Close on Mili, crackling with lightning, raring to go.", env: 'signal_chamber',
        blocking: { sati: [[0, 0, -1.4], 120], mili: [[-0.9, 0, -1.2], 60] },
        lines: [{ who: 'mili', text: "I'll take its hello to the others!", face: 'determined' }], faces: { mili: [[0, 'happy']] },
        camera: close('mili', 10) },
      { name: 'Version, then wait', visual: "Sati hands over the node's 'version' message. Mili spins and blurs off into the dark.", env: 'signal_chamber',
        blocking: { sati: [[0, 0, -1.4], 120], mili: [[-0.9, 0, -1.2], 60] }, moves: { mili: [[0.82, [-0.9, 0, -1.2], -90], [1, [-9, 0, -3], -90]] },
        faces: { sati: [[0, 'determined']], mili: [[0, 'determined']] },
        lines: [{ who: 'sati', text: 'Tell them its version. Then wait for their answer.' }],
        camera: ots('mili', 'sati'), sfx: [{ file: 'zap', at: 'end' }],
        notes: 'Protocol: a new node opens a connection and sends a `version` message; the peer replies with its own `version` and a `verack`.' },
      { name: 'They answered', visual: 'One by one, light shafts rise from the monoliths; figures step out of the dark toward the beacon. Mili skids back in, glowing.', env: 'network_awake',
        blocking: { sati: [[0, 0, -1.4], 0], mili: [[-7, 0, -0.6], 90], bit: [[1.2, 0, -1], -10] }, moves: { mili: [[0.2, [-0.9, 0, -0.6], 10]] },
        faces: { mili: [[0, 'happy']], sati: [[0.25, 'happy']], bit: [[0.6, 'surprised'], [0.8, 'happy']] }, crowd: 'peers', crowdFaces: [[0.3, 'happy']],
        lines: [{ who: 'mili', text: 'They answered! Version, verack, handshake done!' }, { who: 'bit', text: "Look. They're all lighting up." }],
        camera: (d, b) => cam.crane(mid(b), 6.5, 0.8, 5, 55)(d), sfx: [{ file: 'chime', at: 0.4 }, { file: 'sparkle', at: 1.4 }, { file: 'chime', at: 2.6, gain: 0.4 }] },
    ],
  },
  {
    title: 'The Journey', env: 'mempool_sea', arc: { tension: 0.65, beat: 'midpoint', note: 'They understand what they protect: value moving peer to peer.' }, summary: 'Act 2 — A transaction. A glowing orb: signed, verified, relayed peer to peer, then waiting in the mempool.',
    cue: { name: 'The Journey', seed: 2140, key: 'A', mode: 'dorian', tempo: 88, density: 0.65 },
    shots: [
      { name: 'A shiny one', visual: 'A warm glowing orb drifts down between them, ringed with light. Mili reaches for it; other travellers drift past in the distance.', board: 'new_perspectives',
        blocking: { sati: [[-0.4, 0, 0.6], 20], mili: [[-0.8, 0, 2], 160], bit: [[1.8, 0, 0.4], -30] }, moves: { mili: [[0.3, [-0.4, 0, 1.4], 160]] },
        faces: { mili: [[0, 'surprised'], [0.3, 'happy']] }, crowd: 'travellers',
        lines: [{ who: 'mili', text: 'Ooh. A shiny one.' }, { who: 'sati', text: "That's a transaction. Someone's sending value across the network.", face: 'determined' }],
        camera: (d) => cam.push([0.4, 1.3, 0.6], 3.2, 2.2, 0.1, 38)(d), sfx: [{ file: 'sparkle', at: 0.2 }] },
      { name: 'The key fits', visual: 'Close on Sati holding up a hand; the ring around the orb clicks into alignment and flashes.', blocking: { sati: [[-0.4, 0, 0.6], 20] },
        lines: [{ who: 'sati', text: 'Its signature matches the key.', face: 'determined' }, { who: 'sati', text: "It's valid.", gap: 0.5, face: 'happy' }],
        camera: (d) => cam.still([-1.2, 1.2, 2.2], [0.2, 1.3, 0.6], 32)(d), sfx: [{ file: 'click', at: 1.6 }, { file: 'chime', at: 1.7, gain: 0.5 }],
        notes: 'Protocol: nodes check each input’s signature against the public key it spends from before relaying.' },
      { name: 'Peer to peer', visual: 'Mili grabs the orb and blurs off — lightning zig-zags from bubble to bubble across the dark.',
        blocking: { mili: [[-2, 0, 1], 30] }, moves: { mili: [[0.35, [1, 0, -1], 60], [0.6, [3, 0, -4], 20], [1, [6, 0, -8], 40]] }, faces: { mili: [[0, 'happy']] },
        lines: [{ who: 'mili', text: 'Passing it on! Peer to peer to peer!' }],
        camera: (d) => cam.move([-2, 1, 3], [3, 1.4, 2], [-1, 0.6, 0], [4, 0.6, -5], 45, 'whip-pan')(d), sfx: [{ file: 'zap', at: 0.1 }, { file: 'whoosh', at: 0.5 }, { file: 'zap', at: 1.4, gain: 0.5 }] },
      { name: 'The waiting room', visual: 'The orb settles into a glass bubble among hundreds of others, all floating, all waiting. Other folk wait beside theirs.',
        blocking: { sati: [[-0.6, 0, 1.2], 170], bit: [[1, 0, 1], 190], mili: [[0.1, 0, 1.6], 180] }, moves: { mili: [[0.5, [0.1, 0, 0.8], 180]] },
        faces: { bit: [[0, 'surprised']], mili: [[0, 'happy']], sati: [[0.5, 'determined']] }, crowd: 'travellers', crowdFaces: [[0, 'worried']],
        lines: [{ who: 'bit', text: 'So many bubbles.' }, { who: 'sati', text: "They're all waiting for the next block. Let's follow ours." }],
        camera: (d) => cam.crane([0, 1.2, -4], 8.5, 0.7, 2.4, 50)(d), notes: 'Protocol: valid, unconfirmed transactions wait in each node’s mempool until a miner includes them in a block.' },
    ],
  },
  {
    title: 'Overcome', env: 'mining_hall', arc: { tension: 0.85, beat: 'climax', note: 'All three strengths at once — muscle, speed, brains — to find the block.' }, summary: 'Act 3 — Mining. Hash block after hash block until one comes out right. The block is found; the transaction is sealed.',
    cue: { name: 'Overcome', seed: 21000000, key: 'E', mode: 'minor', tempo: 96, density: 0.8, instruments: {
      pad: { on: true, enter: 0, gain: 0.55 }, bass: { on: true, enter: 0.1, gain: 0.7 }, arp: { on: true, enter: 0.2, gain: 0.35 },
      lead: { on: true, enter: 0.5, gain: 0.4 }, perc: { on: true, enter: 0.25, gain: 0.45 } } },
    shots: [
      { name: 'The hall of blocks', tension: 0.7, visual: 'Rows of dark blocks with glowing edges, grinding into place again and again. Miners pace between them.', board: 'overcome',
        crowd: 'miners', crowdFaces: [[0, 'determined']], faces: { mili: [[0, 'surprised']], bit: [[0, 'surprised']] },
        lines: [{ who: 'sati', text: 'This is where blocks are made.' }, { who: 'sati', text: 'Miners try number after number, until the hash comes out just right.', gap: 0.5, face: 'determined' }],
        camera: (d, b) => cam.move([4, 2.5, 5], [2.5, 1.5, 3.5], mid(b), [0, 0.6, -3], 45, 'descending')(d), sfx: [{ file: 'stone_grind', at: 0.4, gain: 0.5 }],
        notes: 'Protocol: proof of work — miners vary the nonce and re-hash the block header until the hash is below the target.' },
      { name: 'Heavy!', tension: 0.8, visual: 'Close on Bit, straining, shoving a block into its slot.', blocking: { bit: [[0.9, 0, 0.9], -60] },
        moves: { bit: [[0.5, [0.6, 0, 0.7], -60], [1, [0.4, 0, 0.6], -60]] },
        lines: [{ who: 'bit', text: 'Heavy!', face: 'determined' }], faces: { bit: [[0.8, 'happy']] }, min: 2.5,
        camera: close('bit', 30) },
      { name: 'Heavy lifting', tension: 0.85, visual: 'Mili spins through numbers so fast they become a blur, zig-zagging between blocks; Sati watches the hashes.',
        blocking: { bit: [[0.4, 0, 0.6], -60], mili: [[-1.2, 0, 0.8], 30], sati: [[-0.1, 0, 1.6], 0] },
        moves: { mili: [[0.2, [-2.2, 0, -0.6], 0], [0.4, [-0.2, 0, -0.6], 180], [0.6, [-2.2, 0, 0.8], 0], [0.8, [-1.2, 0, 0.8], 30]] },
        faces: { mili: [[0, 'happy']], sati: [[0, 'determined']], bit: [[0, 'determined']] }, crowd: 'miners', crowdFaces: [[0, 'determined']],
        lines: [{ who: 'mili', text: 'One, two, three, four, five, a million!' }],
        camera: (d, b) => cam.orbit(mid(b), 4, 0.6, -30, 20, 40)(d), sfx: [{ file: 'thud', at: 0.2 }, { file: 'click', at: 1.4 }, { file: 'click', at: 1.6 }, { file: 'click', at: 1.8 }, { file: 'zap', at: 2.1, gain: 0.5 }] },
      { name: 'More zeros', tension: 1, visual: 'Sati squints at a hash scrolling across a block face. Zeros line up at the front. Eyes go wide.',
        blocking: { sati: [[-0.1, 0, 1.2], 180] },
        lines: [{ who: 'sati', text: 'We need more zeros in front...', face: 'determined' }, { who: 'sati', text: "There! That's the one!", gap: 0.6, face: 'surprised' }],
        faces: { sati: [[0.92, 'happy']] },
        camera: (d, b) => cam.push(at(b, 'sati'), 2.2, 1.1, 0.05, 32)(d), sfx: [{ file: 'impact', at: 'end', gain: 0.6 }] },
      { name: 'Sealed', tension: 0.6, visual: 'The winning block blazes. A shaft of light opens overhead and the orb is drawn inside — sealed. The miners cheer.', env: 'block_found', board: 'same_direction',
        blocking: { mili: [[-1.2, 0, 0.4], 180], sati: [[0, 0, 0.3], 180], bit: [[1.5, 0, 0.2], 180] }, moves: { mili: [[0.2, [-1, 0, -0.4], 180], [0.4, [-1.2, 0, 0.4], 180]] },
        faces: { mili: [[0, 'surprised'], [0.2, 'happy']], sati: [[0, 'happy']], bit: [[0.1, 'happy']] },
        crowd: { folk1: [[-4, 0, -1], 120], folk2: [[4, 0, -1.4], -120], folk4: [[-3, 0, -5.5], 150], folk5: [[3.4, 0, -5], -150] }, crowdFaces: [[0, 'surprised'], [0.25, 'happy']],
        lines: [{ who: 'mili', text: 'Our transaction is in the block!' }, { who: 'bit', text: 'Sealed. For good.', face: 'determined' }], min: 6,
        camera: (d) => cam.crane([0, 1.5, -3], 7, 1.1, 3.4, 50)(d), sfx: [{ file: 'chime', at: 0.2 }, { file: 'sparkle', at: 0.8 }] },
      { name: 'Same direction', tension: 0.2, visual: 'Back in the light city, the trio walk toward the sunrise, side by side, among the waking crowd.', env: 'light_city',
        blocking: { mili: [[-1, 0, 1.2], 180], sati: [[0, 0, 1], 180], bit: [[1.5, 0, 0.8], 180] },
        moves: { mili: [[1, [-1, 0, -2.6], 180]], sati: [[1, [0, 0, -2.8], 180]], bit: [[1, [1.5, 0, -3], 180]] },
        faces: { mili: [[0, 'happy']], sati: [[0, 'happy']], bit: [[0, 'happy']] }, crowd: 'plaza', crowdFaces: [[0, 'happy']],
        lines: [{ who: 'sati', text: 'Light or dark, we all follow the same rules.' }, { who: 'mili', text: 'Same direction!', gap: 0.5 }], min: 7,
        camera: (d) => cam.move([0, 0.6, 4.6], [0, 1.8, 7], [0, 0.6, 0], [0, 1.6, -10], 45, 'pull-away')(d), sfx: [{ file: 'sparkle', at: 1, gain: 0.4 }] },
    ],
  },
];

// ------------------------------------------------------------------ build

const EPISODES = [
  { id: 'ep01', number: 1, title: 'Mili, Sati & Bit', theme: 'Every one of us counts — small, smart or strong.', arc: { tension: 0.4, beat: 'setup' as Beat, note: '' }, synopsis: 'In a city of white marble and floating glass, three glowing friends — fast little Mili, clever Sati and mighty Bit — discover that every one of them counts. Then something calls from the dark below.', scenes: EP1,
    cue: { name: 'Light City', seed: 2009, key: 'C', mode: 'lydian', tempo: 96, density: 0.6 } as Partial<ScoreCue> & { seed: number; name: string } },
  { id: 'ep02', number: 2, title: 'Into the Dark', theme: 'Rules anyone can check make the dark less scary.', arc: { tension: 0.85, beat: 'climax' as Beat, note: '' }, synopsis: 'Following the signal down into a world of black monoliths, the trio help a new node find its peers, follow a transaction across the network, and watch a block being mined.', scenes: EP2 },
];

async function main() {
  console.log('→ generating characters, sets and SFX');
  genCharacters();
  genExtras();
  genSets();
  genSetDressing();
  genSkies();
  genSfx();
  genStorySfx();
  for (const dir of ['episodes', 'characters', 'environments', 'assets', 'score', 'credits', 'media/boards', 'media/audio/dialog', 'media/audio/score'])
    fs.rmSync(path.join(PROJECT_DIR, dir), { recursive: true, force: true });
  // drop documentary-only placeholder meshes
  for (const f of ['node_box', 'network_sphere', 'gold_bar', 'coin', 'grid_floor']) fs.rmSync(path.join(PROJECT_DIR, `media/meshes/${f}.glb`), { force: true });
  fs.rmSync(path.join(PROJECT_DIR, 'media/textures/grid.png'), { force: true });
  const boards = cropSheet();

  const data: ProjectData = {
    project: SCHEMAS.project.parse({ title: 'Sati', season: { title: 'Season 1 — Into the Protocol', logline: 'Three glowing friends of very different sizes leave their bright marble city to answer a call from the dark — and discover the rules that let strangers agree on value.' }, fps: 24, resolution: [1920, 1080], episodes: EPISODES.map((e) => e.id), tts: { engine: 'piper', defaultVoice: 'en_US-lessac-medium' } }),
    episodes: {}, scenes: {}, characters, environments, assets: { ...assets, ...SET_ASSETS }, cues: {}, credits: {},
  };

  const cueFor = (id: string, spec: Partial<ScoreCue> & { seed: number; name: string }, seconds: number) => {
    const base = SCHEMAS.cue.parse({ id, ...spec });
    const cue: ScoreCue = { ...base, bars: Math.max(2, Math.ceil(seconds / ((base.beatsPerBar * 60) / base.tempo))) };
    data.cues[id] = cue;
    return cue;
  };

  for (const epSpec of EPISODES) {
    console.log(`\n→ ${epSpec.id} ${epSpec.title} ${NO_TTS ? '(no TTS)' : '(TTS: + new, · cached)'}`);
    const ep: Episode = SCHEMAS.episode.parse({ id: epSpec.id, number: epSpec.number, title: epSpec.title, synopsis: epSpec.synopsis, theme: epSpec.theme, arc: epSpec.arc, status: 'wip' });
    let total = 0;
    for (const [i, scSpec] of epSpec.scenes.entries()) {
      const sc: Scene = SCHEMAS.scene.parse({ id: `${ep.id}_sc${String(i + 1).padStart(2, '0')}`, title: scSpec.title, summary: scSpec.summary, environmentId: scSpec.env, status: 'wip', arc: scSpec.arc });
      for (const shSpec of scSpec.shots) {
        const shot = await buildShot(boards ? shSpec : { ...shSpec, board: undefined });
        shot.id = `sh${String(sc.shots.length + 1).padStart(2, '0')}`;
        sc.shots.push(shot);
      }
      const scLen = sc.shots.reduce((s, x) => s + x.duration, 0);
      total += scLen;
      if (scSpec.cue) {
        const cue = cueFor(`cue_${sc.id}`, scSpec.cue, scLen);
        sc.tracks.score.push({ id: uid('scr'), start: 0, duration: scLen, cueId: cue.id, offset: 0, gain: 0.5 });
      }
      ep.scenes.push(sc.id);
      data.scenes[sc.id] = { ...sc, episodeId: ep.id };
    }
    if (epSpec.cue) {
      const cue = cueFor(`cue_${ep.id}`, epSpec.cue, total);
      ep.tracks.score.push({ id: uid('scr'), start: 0, duration: total, cueId: cue.id, offset: 0, gain: 0.45 });
    }
    data.episodes[ep.id] = ep;
    console.log(`\n  ${ep.scenes.length} scenes, ${ep.scenes.reduce((n, s) => n + data.scenes[s].shots.length, 0)} shots, ${total.toFixed(1)}s`);
  }

  // global intro / outro credits (shared by every episode)
  // intro: sparse pad + arp bar, then bass/drums with a crash, the melody on bar 3, fills, button ending
  const introCue = cueFor('cue_intro', { name: 'Intro theme', seed: 3297, key: 'D', mode: 'major', tempo: 137, density: 0.85,
    notes: 'Upbeat: I-vi-IV-V, syncopated bass, 16th up/down arp, bouncy lead. 6 bars @137 = 10.5s.', instruments: {
    pad: { on: true, enter: 0, gain: 0.5 }, bass: { on: true, enter: 0.17, gain: 0.7 }, arp: { on: true, enter: 0, gain: 0.4 }, lead: { on: true, enter: 0.34, gain: 0.5 }, perc: { on: true, enter: 0.17, gain: 0.45 } } }, 10.5);
  // outro: warm and lyrical, I-IV-vi-V with a soft kick/hat pulse under the roll
  const outroCue = cueFor('cue_outro', { name: 'Outro theme', seed: 814, key: 'F', mode: 'major', tempo: 90, density: 0.55,
    notes: 'Warm: I-IV-vi-V, half-note bass with walk-ups, flowing arp, long-note melody, soft pulse. 6 bars @90 = 16s.', instruments: {
    pad: { on: true, enter: 0, gain: 0.55 }, bass: { on: true, enter: 0.17, gain: 0.65 }, arp: { on: true, enter: 0, gain: 0.35 }, lead: { on: true, enter: 0.34, gain: 0.45 }, perc: { on: true, enter: 0.17, gain: 0.3 } } }, 16);
  data.credits.intro = SCHEMAS.credits.parse({
    id: 'intro', name: 'Intro', duration: 10.5, fade: 0.6, background: '#000000', color: '#ffffff',
    cards: [
      { id: 'title', start: 0.3, duration: 3.3, lines: [{ text: '{project}', size: 'xl' }, { text: 'Mili · Sati · Bit', size: 'sm' }] },
      { id: 'season', start: 3.8, duration: 2.9, lines: [{ text: '{season}', size: 'md' }] },
      { id: 'episode', start: 6.9, duration: 3.4, lines: [{ text: 'Episode {episode.number}', size: 'sm' }, { text: '{episode.title}', size: 'lg' }] },
    ],
    music: { cueId: introCue.id, gain: 0.55 },
  });
  data.credits.outro = SCHEMAS.credits.parse({
    id: 'outro', name: 'Outro', duration: 16, fade: 0.8, background: '#000000', color: '#ffffff',
    roll: { start: 0.4, duration: 11.5, sections: [
      { heading: 'Starring', names: ['Mili', 'Sati', 'Bit'] },
      { heading: 'Written & directed by', names: ['Your name here'] },
      { heading: 'Voices', names: ['Piper TTS — Amy, Lessac & Joe'] },
      { heading: 'Music', names: ['Deterministic score — seeds 3297 · 814'] },
      { heading: 'Previz', names: ['Film Maker · three.js · Blender'] },
    ] },
    cards: [{ id: 'end', start: 12.2, duration: 3.6, lines: [{ text: '{project}', size: 'xl' }, { text: 'Thanks for watching', size: 'sm' }] }],
    music: { cueId: outroCue.id, gain: 0.5 },
  });

  saveAll(data);
  console.log('\n✓ project written');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
