/**
 * Seeds the project with Season 1 v3, "Unspent": eight ~11-minute episodes set inside Bitcoin
 * and in the human world around it. Ep1 is fully boarded; Ep2–8 are scene outlines (one
 * placeholder shot per scene) until each is built.
 *
 *   The miner Ana (keyholder + node runner) finds a block in her garage. Inside her node — a city
 *   of light with the timechain at its core — a silent giant, the Coinbase, breaks into new coins.
 *   Two of them, Sati and Bit, have a hundred blocks to wait before they can be spent, while the
 *   Rewriter builds a hidden chain that could erase the block they were born in.
 *
 *   Series bible: docs/season-1-bible.md. Earlier drafts: project/archive/ (v1, v2).
 *
 *   npm run seed                 (rewrites episodes, characters, environments, assets, score, credits, dialog cache)
 *   npm run seed -- --no-tts     (estimated timings, no audio)
 *   npm run seed -- --only ep02  (rebuild one episode on top of what's on disk)
 *
 * Kept across a full seed: treatments/, media/boards uploads, project/archive/.
 *
 * Craft conventions (see AGENTS.md): no narrator, shop talk only (one line of real explanation
 * per scene at most); no real colour — brightness is value; every music cue shares the season
 * motif seed (MOTIF); wordless reaction shots and L-cuts for rhythm.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Asset, Beat, CameraClip, Character, Coverage, DialogClip, Environment, Episode, Expression, ExpressionKey, Instrument, MoveKey, Pose, ProjectData, Scene, ScoreCue, SfxClip, StoryboardClip, Treatment, Vec3 } from '../src/model/schema';
import { INSTRUMENTS, SCHEMAS, Shot as ShotSchema } from '../src/model/schema';
import { estimateSpeech, uid } from '../src/model/timeline';
import { PROJECT_DIR, loadProject, saveAll, saveDoc } from '../server/projectFs';
import { synthesize } from '../server/tts';
import { genCharacters, genExtras, genStorySfx } from './gen-story-assets';
import { genSfx } from './gen-assets';
import { cam } from './lib/camera';
import { autoPoses } from './lib/poses';
import { genV3World, V3_ASSETS, V3_ENVIRONMENTS } from './gen-v3-world';
import { mulberry32 } from '../src/score/compose';

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

type Rel = { to: string; label: string };
const C = (c: Partial<Character> & { id: string; name: string; relations?: Rel[] }) => c;
const characters: Record<string, Character> = Object.fromEntries(
  [
    // coins (UTXOs): they exist on every node; their identity lasts only while they're unspent
    C({ id: 'sati', name: 'Sati', role: 'The coin who wants to be spent', world: 'node', home: 'utxo_district', color: '#d8d8d8', mesh: 'media/meshes/sati.glb',
      description: 'A small coinbase output, a few thousand sats: the smallest coin the chain will carry. Curious, restless, wants to matter, which for a coin means to be spent, and to lose herself.',
      voice: 'af_heart', voiceTune: { pitch: 2, speed: 1 }, tags: ['coin', 'lead'],
      refs: ['media/refs/sati_card.png', 'media/refs/sati_turnaround.png', 'media/refs/sati_expressions.png'],
      relations: [{ to: 'bit', label: 'born together' }, { to: 'pip', label: 'friends' }] }),
    C({ id: 'bit', name: 'Bit', role: 'The big coin', world: 'node', home: 'utxo_district', color: '#ffffff', mesh: 'media/meshes/bit.glb', scale: 1.5,
      description: 'A one-bitcoin output from the same coinbase: huge, the brightest coin in the district. Patient, dry, protective of Sati. Secretly wants more speed than the chain can give (season two).',
      voice: 'am_michael', voiceTune: { pitch: -3, speed: 0.9 }, tags: ['coin', 'lead'],
      refs: ['media/refs/bit_card.png', 'media/refs/bit_turnaround.png', 'media/refs/bit_expressions.png'],
      relations: [{ to: 'mili', label: 'season 2' }] }),
    C({ id: 'pip', name: 'Pip', role: 'The waiting coin', world: 'node', home: 'mempool_hall', color: '#f0f0f0', mesh: 'media/meshes/pip.glb',
      description: 'A tiny, funny coin stuck in a low-fee transaction. Sati’s first friend. Confirmed at last in the newest block — the one the Rewriter orphans (Ep7).',
      voice: 'af_sky', voiceTune: { pitch: 6, speed: 1.15 }, tags: ['coin'] }),
    C({ id: 'mili', name: 'Mili', role: 'The Lightning millisat (season 2)', world: 'void', home: 'network_void', color: '#ffffff', mesh: 'media/meshes/mili.glb', scale: 0.8,
      description: 'A single millisat living in Lightning. Too small to ever exist on chain alone. A spark in the last shot of the season.',
      voice: 'af_sky', voiceTune: { pitch: 5, speed: 1.15 }, tags: ['coin', 's2'],
      refs: ['media/refs/mili_card.png', 'media/refs/mili_turnaround.png', 'media/refs/mili_expressions.png'] }),
    C({ id: 'coinbase', name: 'Coinbase', role: 'The silent giant', world: 'core', home: 'node_core', color: '#ffffff', mesh: 'media/meshes/coinbase.glb',
      description: 'Born from a valid block, from nothing: the only parentless thing in the season. Never speaks. Looks around once, tenderly, and breaks into its outputs.',
      tags: ['coin', 'cosmic'], relations: [{ to: 'sati', label: 'breaks into' }, { to: 'bit', label: 'breaks into' }] }),
    // the crew of the miner's node (they go dark with it)
    C({ id: 'node', name: 'The Node', role: 'The node itself', world: 'core', home: 'node_core', color: '#ffffff', mesh: 'media/meshes/node_avatar.glb',
      description: 'The giant sphere, given a face at its core. Calm and vast; answers any question in one short line.',
      voice: 'bf_emma', voiceTune: { pitch: -2, speed: 0.9 }, tags: ['crew'], relations: [{ to: 'validator', label: 'crew' }, { to: 'hasher', label: 'crew' }] }),
    C({ id: 'validator', name: 'Validator', role: 'The guard', world: 'node', home: 'node_city', color: '#eeeeee', mesh: 'media/meshes/validator.glb',
      description: 'Stern, tall, checks every signature and every rule. The node’s immune system. Turns the Counterfeiter away.',
      voice: 'am_fenrir', voiceTune: { pitch: -1, speed: 0.95 }, tags: ['crew'] }),
    C({ id: 'gossip', name: 'Gossip', role: 'The messenger', world: 'node', home: 'node_city', color: '#ffffff', mesh: 'media/meshes/gossip.glb',
      description: 'Small, fast, never stops talking. Runs blocks and transactions out to every other node.',
      voice: 'af_nicole', voiceTune: { pitch: 4, speed: 1.2 }, tags: ['crew'] }),
    C({ id: 'hasher', name: 'Hasher', role: 'The foreman', world: 'core', home: 'node_core', color: '#e8e8e8', mesh: 'media/meshes/hasher.glb',
      description: 'Stocky foreman of the miner’s search. Shuffles the cubes for the nonce, counts blocks, first to see the Rewriter’s dark chain.',
      voice: 'bm_daniel', voiceTune: { pitch: -2, speed: 1 }, tags: ['crew'], relations: [{ to: 'ana', label: 'mines for' }, { to: 'rewriter', label: 'sees him coming' }] }),
    C({ id: 'mempool_host', name: 'Mempool Host', role: 'The waiting-room host', world: 'node', home: 'mempool_hall', color: '#eeeeee', mesh: 'media/meshes/mempool_host.glb',
      description: 'Round, warm, runs the waiting room where transactions bid for the next block. Calls everyone “love”.',
      voice: 'bf_isabella', voiceTune: { pitch: 1, speed: 1.05 }, tags: ['crew'], relations: [{ to: 'pip', label: 'keeps waiting' }] }),
    C({ id: 'script_clerk', name: 'Script Clerk', role: 'The reader of locks', world: 'node', home: 'node_city', color: '#e6e6e6', mesh: 'media/meshes/script_clerk.glb',
      description: 'Thin, precise, round spectacles. Reads the lock on every coin, and what it would take to open it.',
      voice: 'am_echo', voiceTune: { pitch: 1, speed: 0.95 }, tags: ['crew'], relations: [{ to: 'sati', label: 'reads her lock' }] }),
    // antagonists
    C({ id: 'rewriter', name: 'The Rewriter', role: 'The villain', world: 'void', home: 'dark_chain', color: '#111111', mesh: 'media/meshes/rewriter.glb',
      description: 'A rival miner building a secret, longer chain in the dark. If he releases it first, the block Sati and Bit were born in is orphaned and they never existed. Outside, a big mining operation that tries to buy Ana.',
      voice: 'bm_george', voiceTune: { pitch: -5, speed: 0.85 }, tags: ['villain'],
      relations: [{ to: 'sati', label: 'threatens her birth block' }, { to: 'ana', label: 'tries to buy' }, { to: 'counterfeiter', label: 'seen with' }] }),
    C({ id: 'counterfeiter', name: 'The Counterfeiter', role: 'The forger', world: 'node', home: 'mempool_hall', color: '#ffffff', mesh: 'media/meshes/counterfeiter.glb',
      description: 'Over-bright and glossy, offers coins from nothing. Every node turns him away.',
      voice: 'am_adam', voiceTune: { pitch: 3, speed: 1.05 }, tags: ['villain'], relations: [{ to: 'validator', label: 'rejected by' }] }),
    C({ id: 'thief', name: 'The Thief', role: 'The phisher', world: 'human', home: 'town_night', color: '#222222', mesh: 'media/meshes/thief.glb',
      description: 'Works in both worlds: phishes Ana for her seed words outside; his inside agent tries to move Sati and Bit without her signature.',
      voice: 'am_echo', voiceTune: { pitch: -2, speed: 1 }, tags: ['villain'], relations: [{ to: 'ana', label: 'phishes' }] }),
    // the human world
    C({ id: 'ana', name: 'Ana', role: 'The miner (keyholder, node runner)', world: 'human', home: 'garage', color: '#333333', mesh: 'media/meshes/ana.glb',
      description: 'Young woman who mines in a garage at the edge of a small river town, on surplus power from the dam. Holds the key Sati and Bit are locked to, and runs the node they live in. Never sees them.',
      voice: 'af_bella', voiceTune: { pitch: 0, speed: 1 }, tags: ['human'],
      relations: [{ to: 'node', label: 'runs' }, { to: 'sati', label: 'holds the key' }, { to: 'bit', label: 'holds the key' }] }),
    // background coins / townsfolk (no voice)
    ...(['tall', 'round', 'small', 'tall', 'round', 'small'] as const).map((shape, i) => C({
      id: `folk${i + 1}`, name: `Folk ${i + 1}`, role: 'Background', color: '#dddddd',
      mesh: `media/meshes/folk_${shape}.glb`, scale: [1, 1, 1, 0.92, 1.08, 0.9][i],
      description: `A ${shape} coin: other outputs, strangers in a transaction, waiting coins. Never speaks.`, tags: ['extra'],
    })),
    // the nonce cubes: the miner's search, shuffling
    ...Array.from({ length: 12 }, (_, i) => C({ id: `cube${i + 1}`, name: `Cube ${i + 1}`, role: 'Nonce cube', color: '#ffffff', mesh: 'media/meshes/nonce_cube.glb', world: 'core', description: 'One cube of the Hasher’s search grid.', tags: ['extra', 'cube'] })),
  ].map((c) => [c.id, SCHEMAS.character.parse(c)]),
);

const assets: Record<string, Asset> = V3_ASSETS;
const environments: Record<string, Environment> = V3_ENVIRONMENTS;

// ------------------------------------------------------------------ blocking helpers

type Who = 'sati' | 'bit' | 'pip' | 'mili' | 'coinbase' | 'node' | 'validator' | 'gossip' | 'hasher' | 'mempool_host' | 'script_clerk' | 'rewriter' | 'counterfeiter' | 'thief' | 'ana';
type Blocking = Partial<Record<Who, [Vec3, number?]>>;
// head-centre heights and head radii (after character scale), for framing
const HEAD: Record<Who, number> = { sati: 0.61, bit: 3.075, pip: 0.29, mili: 0.32, coinbase: 7.5, node: 2.4, validator: 1.5, gossip: 0.56, hasher: 1.02, mempool_host: 0.98, script_clerk: 1.18, rewriter: 2.05, counterfeiter: 1.3, thief: 1.62, ana: 1.62 };
const HEAD_R: Record<Who, number> = { sati: 0.43, bit: 1.725, pip: 0.18, mili: 0.232, coinbase: 2.2, node: 0.8, validator: 0.22, gossip: 0.2, hasher: 0.27, mempool_host: 0.28, script_clerk: 0.2, rewriter: 0.3, counterfeiter: 0.21, thief: 0.11, ana: 0.11 };
const at = (b: Blocking, who: Who): Vec3 => {
  const pos = b[who]?.[0] ?? [0, 0, 0];
  return [pos[0], pos[1] + HEAD[who], pos[2]];
};
const mid = (b: Blocking): Vec3 => {
  const ps = Object.keys(b).map((k) => at(b, k as Who));
  const n = ps.length || 1;
  return [ps.reduce((s, q) => s + q[0], 0) / n, 0.6, ps.reduce((s, q) => s + q[2], 0) / n];
};

const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const facing = (from: Vec3, to: Vec3) => Math.round((Math.atan2(to[0] - from[0], to[2] - from[2]) * 180) / Math.PI);

type Cam = (d: number, b: Blocking) => CameraClip;

/** Close-up on one character's face, from `side` degrees off their facing, with a slow push-in. */
const close = (who: Who, side = 18, fov = 28, eye: 'level' | 'low' | 'high' = 'level'): Cam => (d, b) => {
  const head = at(b, who);
  const a = rad((b[who]?.[1] ?? 0) + side);
  const dir: Vec3 = [Math.sin(a), eye === 'low' ? -0.14 : eye === 'high' ? 0.3 : 0.04, Math.cos(a)];
  const dist = HEAD_R[who] * 8.5;
  return cam.move(add(head, dir, dist * 1.12), add(head, dir, dist), head, head, fov, 'close-up')(d);
};

/** Over `from`'s shoulder onto `to`'s face. */
const ots = (from: Who, to: Who, fov = 32): Cam => (d, b) => {
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

/** Two-shot: both heads in frame, from the camera side (+Z) of the line between them, easing in. */
const two = (a: Who, c: Who, extra = 0.8, fov = 36): Cam => (d, b) => {
  const A = at(b, a);
  const C = at(b, c);
  const m: Vec3 = [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2, (A[2] + C[2]) / 2];
  const dx = C[0] - A[0];
  const dz = C[2] - A[2];
  const sep = Math.hypot(dx, dz) || 1;
  let n: Vec3 = [-dz / sep, 0, dx / sep];
  // shoot from the side they're facing (their average facing); +Z when they face each other square on
  const f = [a, c].reduce<[number, number]>((acc, w) => { const r = rad(b[w]?.[1] ?? 0); return [acc[0] + Math.sin(r), acc[1] + Math.cos(r)]; }, [0, 0]);
  const toward = Math.hypot(f[0], f[1]) > 0.3 ? n[0] * f[0] + n[2] * f[1] : n[2];
  if (toward < 0) n = [-n[0], 0, -n[2]];
  // very different sizes (Sati beside Bit): swing round toward the small one so they're in front, the big one behind
  const [small, big] = HEAD_R[a] <= HEAD_R[c] ? [A, C] : [C, A];
  if (Math.max(HEAD_R[a], HEAD_R[c]) / Math.min(HEAD_R[a], HEAD_R[c]) > 1.8) {
    const ux = (small[0] - big[0]) / sep;
    const uz = (small[2] - big[2]) / sep;
    const nx = n[0] + ux * 0.75;
    const nz = n[2] + uz * 0.75;
    const l = Math.hypot(nx, nz) || 1;
    n = [nx / l, 0, nz / l];
  }
  const r = sep * 1.5 + Math.abs(A[1] - C[1]) * 1.6 + extra * 1.4 + Math.max(HEAD_R[a], HEAD_R[c]) * 4.5;
  const pos = add(add(m, n, r), [0, 0.12, 0]);
  return cam.move(add(pos, n, r * 0.08), pos, m, m, fov, 'two-shot')(d);
};

/** Wide on the group (or a point), slow drift in. */
const wide = (dist = 6, h = 1.6, fov = 42, dx = 0, look?: Vec3): Cam => (d, b) => {
  const m = look ?? mid(b);
  return cam.move([m[0] + dx, h, m[2] + dist], [m[0] + dx * 0.9, h * 0.96, m[2] + dist * 0.93], m, m, fov, 'wide')(d);
};

/** Unit vector from a character toward where they face, turned `side` degrees. */
const front = (b: Blocking, who: Who, side = 0): Vec3 => {
  const a = rad((b[who]?.[1] ?? 0) + side);
  return [Math.sin(a), 0, Math.cos(a)];
};

/** Low angle up at one character, from in front of them: they read big. */
const low = (who: Who, dist?: number, fov = 42, side = 15): Cam => (d, b) => {
  const head = at(b, who);
  const dir = front(b, who, side);
  const r = Math.max(dist ?? HEAD_R[who] * 7, HEAD_R[who] * 5);
  const y = Math.max(0.08, head[1] * 0.15);
  const p = (k: number): Vec3 => [head[0] + dir[0] * r * k, y, head[2] + dir[2] * r * k];
  return cam.move(p(1), p(0.88), head, head, fov, 'low-angle')(d);
};

/** High angle down on one character, from in front of them: they read small. */
const high = (who: Who, dist = 2.6, h = 2.6, fov = 40, side = 10): Cam => (d, b) => {
  const head = at(b, who);
  const dir = front(b, who, side);
  const p = (k: number): Vec3 => [head[0] + dir[0] * dist * k, head[1] + h * k, head[2] + dir[2] * dist * k];
  return cam.move(p(1), p(1.1), head, head, fov, 'high-angle')(d);
};

// ------------------------------------------------------------------ background folk

/** An extra's mark: position, facing, and optional walk keys as [fraction of shot, position, rotationY?]. */
type Extra = [Vec3, number, Move[]?];
type Move = [number, Vec3, number?];
type Crowd = Record<string, Extra>;

/** reusable crowds (none yet in v3; scenes build their own) */
const CROWD: Record<string, Crowd> = {};

// ------------------------------------------------------------------ shots

interface Line {
  who: Who;
  text: string;
  /** pause before this line (default 0.25s; negative overlaps — an interruption) */
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
  /** shortest the shot may be (default 2s; reaction and insert shots set their own) */
  min?: number;
  /** when the first line starts (default 0.3s, pushed later if the previous shot's line is still running) */
  firstLineAt?: number;
  /** air after the last line before the cut (default 0.35s) */
  tail?: number;
  /** L-cut: cut this many seconds after the last line STARTS; the line plays on under the next shot */
  cut?: number;
  env?: string;
  board?: string;
  blocking?: Blocking;
  /** walks during the shot: [fraction of shot, position, rotationY?] from the blocking mark */
  moves?: Partial<Record<Who, Move[]>>;
  /** expression changes at fractions of the shot (lines can also set `face` / `react`) */
  faces?: Record<string, [number, Expression][]>;
  /** body poses at fractions of the shot; replaces the automatic poses for that character */
  poses?: Record<string, [number, Pose][]>;
  /** background folk: a CROWD preset name or explicit marks */
  crowd?: keyof typeof CROWD | Crowd;
  /** expression changes for the whole crowd at fractions of the shot */
  crowdFaces?: [number, Expression][];
  camera: Cam;
  sfx?: { file: string; at: number | 'end'; gain?: number }[];
  notes?: string;
  /** size, angle, and how this shot cuts with the others in the scene */
  coverage?: Coverage;
  status?: 'todo' | 'wip' | 'review' | 'done';
  /** optional finer point on the story arc */
  tension?: number;
}

type CueSpec = Partial<ScoreCue> & { name: string };
/** Music under a run of shots in a scene: from shot `from` (+`at` seconds) to the start of shot `to` (+`tail`). */
interface Music {
  cue: CueSpec;
  from?: number;
  to?: number;
  at?: number;
  tail?: number;
  gain?: number;
}
interface SceneSpec {
  title: string;
  /** one line, for the plot overview */
  summary: string;
  env: string;
  shots: ShotSpec[];
  music?: Music[];
  arc: { tension: number; beat?: Beat; note: string };
}

const SFX_LEN: Record<string, number> = { zap: 0.7, thud: 0.9, chime: 2.5, sparkle: 1.4, stone_grind: 2, pulse: 2.4, whoosh: 1.6, impact: 1.8, blip: 0.25, ping: 1.4, click: 0.08, hum: 4, coin_drop: 1 };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Builds one shot. `carry` is how far the previous shot's last line runs into this one (L-cuts). */
async function buildShot(spec: ShotSpec, carry = 0) {
  const dialog: DialogClip[] = [];
  let t = Math.max(spec.firstLineAt ?? 0.3, carry > 0 ? carry + 0.12 : 0);
  let lastStart = 0;
  for (const [i, l] of (spec.lines ?? []).entries()) {
    if (i > 0) t = Math.max(0, t + (l.gap ?? 0.25));
    const ch = characters[l.who];
    const text = l.text.replace(/[‘’]/g, "'");
    let duration = estimateSpeech(text) / (ch.voiceTune.speed || 1);
    let audio: string | undefined;
    let audioHash: string | undefined;
    if (!NO_TTS) {
      const r = await synthesize({ text, voice: ch.voice, tune: ch.voiceTune, engine: 'mlx' });
      ({ duration, audio, audioHash } = r);
      process.stdout.write(r.cached ? '·' : '+');
    }
    lastStart = t;
    dialog.push({ id: uid('dlg'), start: r3(t), duration: r3(duration), characterId: l.who, text, audio, audioHash, subtitle: true, gain: 1 });
    t += duration;
  }
  const spoken = dialog.length > 0;
  const end = spoken ? (spec.cut !== undefined ? lastStart + spec.cut : t + (spec.tail ?? 0.35)) : 0;
  const duration = Math.ceil(Math.max(spec.min ?? 2, end) * 4) / 4;
  const blocking = spec.blocking ?? {};
  const storyboard: StoryboardClip[] = spec.board ? [{ id: uid('brd'), start: 0, duration, image: `media/boards/${spec.board}.png` }] : [];
  const sfx: SfxClip[] = (spec.sfx ?? []).map((s) => {
    const len = SFX_LEN[s.file] ?? 1;
    return { id: uid('sfx'), start: r3(s.at === 'end' ? Math.max(0, duration - len * 0.7) : Math.min(s.at, duration - 0.05)), duration: len, file: `media/audio/sfx/${s.file}.wav`, gain: s.gain ?? 0.7 };
  });
  const toMoves = (ms?: Move[]): MoveKey[] | undefined => ms?.length ? ms.map(([f, position, rotationY]) => ({ t: r3(f * duration), position, rotationY })) : undefined;
  const crowd: Crowd = typeof spec.crowd === 'string' ? CROWD[spec.crowd] : (spec.crowd ?? {});
  const positions: Record<string, { position: Vec3; rotationY: number; moves?: MoveKey[] }> = {};
  for (const [k, v] of Object.entries(blocking)) positions[k] = { position: v![0], rotationY: v![1] ?? 0, moves: toMoves(spec.moves?.[k as Who]) };
  for (const [k, [position, rotationY, ms]] of Object.entries(crowd)) positions[k] = { position, rotationY, moves: toMoves(ms) };
  // expressions: shot fractions, then line-driven changes (speaker `face`, listeners `react`)
  const expressions: Record<string, ExpressionKey[]> = {};
  const face = (k: string, t: number, expression: Expression) => (expressions[k] ??= []).push({ t: r3(Math.max(0, t)), expression });
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
    coverage: spec.coverage,
    notes: spec.notes ?? '',
    environmentId: spec.env,
    tension: spec.tension,
    characters: who,
    positions,
    expressions: Object.keys(expressions).length ? expressions : undefined,
    tracks: { storyboard, camera: [spec.camera(duration, blocking)], subtitles: [], dialog, sfx, score: [] },
  });
  const poses = autoPoses(shot) ?? {};
  for (const [k, list] of Object.entries(spec.poses ?? {})) if (who.includes(k)) poses[k] = list.map(([f, pose]) => ({ t: r3(f * duration), pose }));
  shot.poses = Object.keys(poses).length ? poses : undefined;
  const last = dialog.at(-1);
  return { shot, spill: last ? Math.max(0, last.start + last.duration - duration) : 0 };
}

// ------------------------------------------------------------------ music

/** The season motif: every cue uses this seed, so the same tune (progression + melody) returns in new keys, modes and tempos. */
const MOTIF = 1729;
/** instrument → [enters at fraction of the cue, gain]; instruments left out are off */
type Band = Partial<Record<Instrument, [number, number]>>;
const theme = (name: string, key: ScoreCue['key'], mode: ScoreCue['mode'], tempo: number, density: number, band: Band, extra: Partial<ScoreCue> = {}): CueSpec => ({
  name, seed: MOTIF, key, mode, tempo, density,
  instruments: Object.fromEntries(INSTRUMENTS.map((i) => [i, band[i] ? { on: true, enter: band[i]![0], gain: band[i]![1] } : { on: false, enter: 0, gain: 0.5 }])) as ScoreCue['instruments'],
  ...extra,
});

// ------------------------------------------------------------------ story

/** a mark facing a point */
const look = (pos: Vec3, at: Vec3): [Vec3, number] => [pos, facing(pos, at)];

// ---- the nonce search: twelve cubes inside the candidate block (the glass cube at 0, 0, -3.2)
const BLOCK_C: Vec3 = [0, 0, -3.2];
const GRID: Vec3[] = Array.from({ length: 12 }, (_, i) => [-1.05 + (i % 4) * 0.7, 0.15 + Math.floor(i / 4) * 0.8, -3.2]);
/** cubes scattered through the block, shuffling `steps` times; `solve` snaps them into the grid at the end */
const nonceSearch = (seed: number, steps = 3, solve = false): Crowd => {
  const r = mulberry32(seed);
  const rand = (): Vec3 => [(r() - 0.5) * 2.4, 0.1 + r() * 2.1, -3.2 + (r() - 0.5) * 2];
  return Object.fromEntries(GRID.map((g, i) => {
    const start = rand();
    const moves: Move[] = Array.from({ length: steps }, (_, k) => [((k + 1) / (steps + (solve ? 1 : 0))) * (solve ? 0.7 : 1), rand(), Math.round(r() * 90)] as Move);
    if (solve) moves.push([0.85, g, 0]);
    return [`cube${i + 1}`, [start, Math.round(r() * 90), moves] as Extra];
  }));
};
const solved: Crowd = Object.fromEntries(GRID.map((g, i) => [`cube${i + 1}`, [g, 0] as Extra]));

const CORE_CREW: Blocking = {
  hasher: [[3.55, 0, 2.41], -150],
  validator: look([-2.4, 0, 1.4], [0, 3, -6.5]),
  script_clerk: look([-3.4, 0, 2.2], [0, 3, -6.5]),
  mempool_host: look([1.6, 0, 3.4], [0, 3, -6.5]),
};
const DISTRICT: Blocking = { sati: [[-0.5, 0, 1.6], 40], bit: [[1.6, 0, 0.3], -40] };
const NEWBORN: Crowd = { folk1: [[-3.5, 0, -1], 30], folk2: [[3.8, 0, -2.2], -40], folk3: [[-2.2, 0, -3.5], 10], folk4: [[2.4, 0, -4.4], -10] };
const CITY: Blocking = { sati: [[-0.6, 0, 1], 180], bit: [[-3.4, 0, 1.4], 160] };
/** the naming conversation: the Clerk stands on the camera side; the coins turn to him */
const CLERK_AT: Vec3 = [-1.4, 0, 3.6];
const NAMING: Blocking = { sati: look([-0.6, 0, 1.2], CLERK_AT), bit: look([-3.6, 0, 1.2], CLERK_AT), script_clerk: look(CLERK_AT, [-1.6, 0.5, 1.2]) };

// Episode 1 — Coinbase (setup)
const EP1: SceneSpec[] = [
  {
    title: 'Powers of Ten', env: 'town_night', arc: { tension: 0.25, beat: 'setup', note: 'One unbroken move from her world into theirs.' },
    summary: 'Wordless: a dark town, one glowing garage, a sleeping miner, a blinking LED — and through it, into a node’s city of light.',
    music: [{ cue: theme('Overture', 'C', 'lydian', 80, 0.35, { pad: [0, 0.5], arp: [0.25, 0.3], lead: [0.6, 0.4] }), gain: 0.45, tail: 0.5 }],
    shots: [
      { name: 'A dark town', visual: 'Night. A small river town with every light out: dark houses, dark cars, dead streetlamps. Only one cluster of white light, at the edge of town: a garage.',
        coverage: { size: 'EWS', angle: 'high', role: 'master' }, min: 9,
        camera: (d) => cam.move([-30, 22, 40], [-8, 7, 16], [8, 1, -6], [8, 1, -6], 40, 'crane down')(d) },
      { name: 'The garage', visual: 'White light leaks from the seams of a garage door. A low hum.',
        coverage: { size: 'MWS', angle: 'eye', role: 'insert' }, min: 4.5,
        camera: (d) => cam.move([10.5, 1.4, 8], [7.8, 1.4, 2.2], [6.6, 1.4, -2.2], undefined, 40, 'push-in')(d), sfx: [{ file: 'hum', at: 0, gain: 0.4 }] },
      { name: 'Asleep at the desk', visual: 'Inside: rigs with bright fans, everything else black. Ana asleep in her chair, her phone face-up on the desk, lighting her from below.', env: 'garage',
        coverage: { size: 'MS', angle: 'eye', role: 'master' }, blocking: { ana: [[0.4, 0, -0.2], 0] }, poses: { ana: [[0, 'crouch']] }, min: 5,
        camera: (d) => cam.move([1.6, 1.3, 2.4], [1.2, 1.2, 1.6], [0.4, 0.9, -0.2], undefined, 40, 'push-in')(d), sfx: [{ file: 'hum', at: 0, gain: 0.5 }] },
      { name: 'The blinking light', visual: 'On a shelf, a small dark box with one white LED. It blinks. We go into it.', env: 'garage',
        coverage: { size: 'ECU', angle: 'eye', role: 'insert' }, min: 4,
        camera: (d) => cam.dollyZoom([2.82, 1.31, -1.05], 1.6, 0.22, 22, 60, 0.02)(d), sfx: [{ file: 'blip', at: 1, gain: 0.5 }, { file: 'blip', at: 2.4, gain: 0.5 }] },
      { name: 'Through the light', visual: 'The light opens into black space strung with points of light. Ahead, a vast translucent sphere: the node. We fall toward its skin.', env: 'network_void',
        coverage: { size: 'EWS', angle: 'eye', role: 'pov' }, min: 5.5,
        camera: (d) => cam.move([0, 1.5, 26], [0, 0.4, -3.5], [0, 0, -14], [0, 0, -14], 50, 'fall in')(d), sfx: [{ file: 'whoosh', at: 3.6, gain: 0.6 }] },
      { name: 'City of light', visual: 'Through the membrane: a whole city of white glass towers banded with data, filaments of light arching overhead. Far away at its centre, a great sphere glows.', env: 'node_city', board: 'hero_banner',
        coverage: { size: 'EWS', angle: 'high', role: 'master' }, min: 7.5, tension: 0.3,
        camera: (d) => cam.move([0, 30, 34], [2, 4, 9], [0, 4, -18], [0, 6, -30], 56, 'crane down')(d), sfx: [{ file: 'sparkle', at: 1.5, gain: 0.4 }] },
      { name: 'To the core', visual: 'We race between the towers toward the central sphere, the core. Inside it, a helix of discs turns: the timechain.', env: 'node_city',
        coverage: { size: 'WS', angle: 'eye', role: 'pov' }, min: 5,
        camera: (d) => cam.move([0, 4, 6], [0, 8, -24], [0, 8, -40], undefined, 50, 'fly-in')(d), sfx: [{ file: 'whoosh', at: 0.5, gain: 0.4 }] },
    ],
  },
  {
    title: 'The Nonce', env: 'node_core', arc: { tension: 0.45, beat: 'inciting', note: 'Work, then click: a block.' },
    summary: 'Inside the core, the Hasher shuffles a grid of cubes faster and faster until — click — they lock: a valid block. The Gossip runs it out to the world.',
    music: [
      { cue: theme('The Search', 'A', 'minor', 112, 0.75, { pad: [0, 0.4], bass: [0, 0.6], arp: [0, 0.35], perc: [0.2, 0.45] }), from: 0, to: 6, gain: 0.45 },
      { cue: theme('Block', 'C', 'major', 96, 0.6, { pad: [0, 0.55], bass: [0, 0.55], arp: [0, 0.35], lead: [0.2, 0.5] }), from: 7, tail: 0.6, gain: 0.5 },
    ],
    shots: [
      { name: 'The search', visual: 'Close: dim cubes drift and shuffle inside a glass block, never settling.', notes: 'Ref: explorer block.js (glass cube, header bar).',
        coverage: { size: 'INS', angle: 'eye', role: 'insert' }, crowd: nonceSearch(1, 3), min: 3.5,
        camera: (d) => cam.move([1.8, 1.4, 0.6], [1.4, 1.3, 0.1], [0, 1.1, -3.2], undefined, 38, 'drift')(d), sfx: [0.4, 1.2, 2, 2.8].map((t) => ({ file: 'blip', at: t, gain: 0.35 })) },
      { name: 'Counting', visual: 'The Hasher at his console, eyes on the grid, muttering as each try fails.',
        coverage: { size: 'MCU', angle: 'eye', role: 'single' }, blocking: CORE_CREW, faces: { hasher: [[0, 'determined']] },
        lines: [{ who: 'hasher', text: 'No.' }, { who: 'hasher', text: 'No.', gap: 0.5 }, { who: 'hasher', text: 'Nope.', gap: 0.45 }],
        camera: close('hasher', 25, 30) },
      { name: 'Faster', visual: 'The cubes shuffle faster.', coverage: { size: 'INS', angle: 'high', role: 'insert' }, crowd: nonceSearch(2, 4), min: 1.75,
        camera: (d) => cam.still([0, 3.4, -0.6], [0, 1, -3.2], 40)(d), sfx: [0.2, 0.6, 1, 1.4].map((t) => ({ file: 'blip', at: t, gain: 0.4 })) },
      { name: 'Faster still', visual: 'Faster still — a blur of cubes.', coverage: { size: 'INS', angle: 'low', role: 'insert' }, crowd: nonceSearch(3, 5), min: 1.5,
        camera: cam.handheld([-1.4, 0.4, -0.8], [0, 1.2, -3.2], 36, 0.04, 2), sfx: [0.1, 0.4, 0.7, 1, 1.3].map((t) => ({ file: 'blip', at: t, gain: 0.45 })) },
      { name: 'Come on', visual: 'The Hasher leans in.', coverage: { size: 'CU', angle: 'eye', role: 'single' }, blocking: CORE_CREW, faces: { hasher: [[0, 'grimace']] },
        lines: [{ who: 'hasher', text: 'Come on. Come on…' }], tension: 0.5,
        camera: close('hasher', 5, 26) },
      { name: 'Click', visual: 'Every cube snaps into a perfect lattice. Click. The header bar of the block flares white. Then silence.',
        coverage: { size: 'MS', angle: 'eye', role: 'action' }, crowd: nonceSearch(4, 2, true), min: 3.25, tension: 0.6,
        camera: (d) => cam.still([0, 1.3, 2.2], [0, 1.2, -3.2], 38)(d), sfx: [{ file: 'click', at: 2.25, gain: 0.9 }] },
      { name: 'Got one', visual: 'The Hasher, frozen. Then, a whisper.', coverage: { size: 'CU', angle: 'eye', role: 'single' }, blocking: CORE_CREW, faces: { hasher: [[0, 'surprised'], [0.6, 'grin']] },
        lines: [{ who: 'hasher', text: '…Got one.' }], firstLineAt: 0.9, tail: 0.7,
        camera: close('hasher', 15, 28) },
      { name: 'Sealed', visual: 'The block glows. Camera rises with its light, up the core, to the top of the timechain helix where a new disc lights up.', notes: 'Ref: explorer blockchain.js helix.',
        coverage: { size: 'WS', angle: 'low', role: 'master' }, crowd: solved, min: 5,
        camera: (d) => cam.move([0.6, 0.6, 3.4], [0.6, 6, 4.5], [0, 1.6, -3.2], [0, 11, -9], 46, 'tilt up')(d), sfx: [{ file: 'chime', at: 0.4 }] },
      { name: 'Coming through', visual: 'The Gossip, small and fast, zips in, scoops up the news and zips out toward the city.',
        coverage: { size: 'WS', angle: 'eye', role: 'action' }, blocking: { ...CORE_CREW, gossip: [[-5, 0, 3], 100] }, moves: { gossip: [[0.35, [-0.8, 0, 0.4], 160], [1, [-9, 0, 7], -60]] },
        poses: { gossip: [[0.3, 'reach'], [0.5, 'cheer']] }, faces: { gossip: [[0, 'grin']] },
        lines: [{ who: 'gossip', text: 'New block! Coming through!' }], firstLineAt: 0.6,
        camera: (d) => cam.still([1.5, 0.8, 4.5], [-1.5, 0.5, 1], 46)(d), sfx: [{ file: 'zap', at: 0.2 }, { file: 'whoosh', at: 1.6, gain: 0.5 }] },
      { name: 'The wave', visual: 'From high above the city: a ring of light rolls outward from the core, tower by tower.', env: 'node_city',
        coverage: { size: 'EWS', angle: 'birds_eye', role: 'master' }, min: 4.5,
        camera: (d) => cam.move([0, 46, 6], [0, 52, 10], [0, 0, -28], undefined, 54, 'rise')(d), sfx: [{ file: 'sparkle', at: 0.5 }] },
    ],
  },
  {
    title: 'The Giant', env: 'node_core', arc: { tension: 0.65, beat: 'rising', note: 'Something born from nothing. It never speaks.' },
    summary: 'From the new block rises the Coinbase, a silent giant with no parents; it looks around once, tenderly, and breaks into a snowfall of new coins.',
    music: [{ cue: theme('Coinbase', 'C', 'lydian', 60, 0.25, { pad: [0, 0.6], arp: [0.3, 0.3], lead: [0.55, 0.5] }), from: 0, tail: 1.5, gain: 0.5 }],
    shots: [
      { name: 'Rising', visual: 'Low, from the floor: light pours up out of the new block and takes a shape — a giant, three times Bit’s size, rising through the floor of the core.',
        coverage: { size: 'WS', angle: 'worms_eye', role: 'master' }, blocking: { coinbase: [[0, -9, -6.5], 0] }, crowd: solved, moves: { coinbase: [[0.85, [0, 0, -6.5], 0]] }, min: 7.5, tension: 0.6,
        camera: (d) => cam.move([0.4, 0.25, 5], [0.2, 0.25, 4.4], [0, 2, -5], [0, 6.5, -6.5], 62, 'tilt up')(d), sfx: [{ file: 'pulse', at: 0.3 }, { file: 'hum', at: 1, gain: 0.5 }] },
      { name: 'The crew looks up', visual: 'The crew stop work and look up: Validator, Script Clerk, Mempool Host, Hasher.',
        coverage: { size: 'WS', angle: 'high', role: 'coverage' }, blocking: { ...CORE_CREW, coinbase: [[0, 0, -6.5], 0] }, faces: { validator: [[0, 'ooh']], script_clerk: [[0, 'ooh']], mempool_host: [[0, 'surprised']], hasher: [[0, 'happy']] },
        lines: [{ who: 'validator', text: 'A coinbase.' }, { who: 'script_clerk', text: 'From nothing. Every time.', gap: 0.6 }], firstLineAt: 0.8,
        camera: (d) => cam.move([-0.5, 4, 8], [-0.3, 3.6, 7.2], [-0.8, 0.8, 2], undefined, 46, 'high wide')(d) },
      { name: 'It looks around', visual: 'Close on the Coinbase’s face, vast and calm. It looks around the core, once, slowly. Almost tender.',
        coverage: { size: 'CU', angle: 'low', role: 'single' }, blocking: { coinbase: [[0, 0, -6.5], 0] }, moves: { coinbase: [[0.35, [0, 0, -6.5], -25], [0.7, [0, 0, -6.5], 20], [1, [0, 0, -6.5], 0]] },
        faces: { coinbase: [[0, 'neutral'], [0.75, 'happy']] }, min: 5.5,
        camera: close('coinbase', 0, 30, 'low') },
      { name: 'Cracks', visual: 'It looks down at its hands. Fine cracks of light run across them, up its arms.',
        coverage: { size: 'MS', angle: 'eye', role: 'insert' }, blocking: { coinbase: [[0, 0, -6.5], 0] }, poses: { coinbase: [[0, 'reach'], [0.6, 'think']] }, faces: { coinbase: [[0, 'ooh']] }, min: 4,
        camera: (d) => cam.move([2.5, 4.8, 2], [2.2, 4.8, 1.2], [0, 4.6, -5.8], undefined, 40, 'push-in')(d), sfx: [{ file: 'stone_grind', at: 1, gain: 0.3 }] },
      { name: 'It breaks', visual: 'It breaks. A soundless burst of light: one huge piece, one small, and a scatter of others, flung up and out. Where the giant stood, nothing.',
        coverage: { size: 'WS', angle: 'low', role: 'action' }, blocking: { coinbase: [[0, 0, -6.5], 0] }, moves: { coinbase: [[0.45, [0, 0, -6.5], 0], [0.5, [0, 40, -6.5], 0]] }, poses: { coinbase: [[0, 'cheer']] }, min: 3.5, tension: 0.75,
        camera: (d) => cam.still([0, 1, 9], [0, 5, -6.5], 58)(d), sfx: [{ file: 'impact', at: 1.4 }, { file: 'sparkle', at: 1.5 }] },
      { name: 'Snowfall', visual: 'The pieces drift down like slow snow over a field of resting coins, each settling with a soft glow. Two of them land side by side: one small, one enormous.', env: 'utxo_district',
        coverage: { size: 'EWS', angle: 'eye', role: 'master' }, blocking: { sati: [[-0.5, 8, 1.6], 40], bit: [[1.4, 9, 0.4], -120] }, crowd: Object.fromEntries(Object.entries(NEWBORN).map(([k, [p, rr]], i) => [k, [[p[0], 7 + i, p[2]], rr, [[0.75 + i * 0.05, p, rr]]] as Extra])),
        moves: { sati: [[0.85, DISTRICT.sati![0], 40]], bit: [[0.8, DISTRICT.bit![0], -120]] }, poses: { sati: [[0, 'crouch']], bit: [[0, 'crouch']] }, min: 8,
        camera: (d) => cam.move([3, 2.6, 9], [2.4, 1.4, 7], [0.4, 3.5, 0], [0.4, 0.6, 0.8], 46, 'tilt down')(d), sfx: [{ file: 'sparkle', at: 2, gain: 0.4 }, { file: 'chime', at: 6.2, gain: 0.3 }] },
    ],
  },
  {
    title: 'Who Are We', env: 'utxo_district', arc: { tension: 0.4, beat: 'setup', note: 'Two newborn coins, no idea who they are. They have each other.' },
    summary: 'Sati and Bit wake among the resting coins with no idea who they are; the other new coins walk off, and the two find the same glowing lock on their chests.',
    music: [{ cue: theme('Wake', 'G', 'lydian', 72, 0.3, { pad: [0, 0.5], arp: [0, 0.3], lead: [0.5, 0.4] }), from: 2, tail: 1, gain: 0.4 }],
    shots: [
      { name: 'Eyes open', visual: 'Extreme close: a small light on the ground. Two eyes open.', coverage: { size: 'ECU', angle: 'eye', role: 'single' },
        blocking: DISTRICT, poses: { sati: [[0, 'crouch'], [0.7, 'idle']] }, faces: { sati: [[0, 'neutral'], [0.4, 'surprised']] }, min: 3.25,
        camera: close('sati', 0, 22) },
      { name: 'A giant', visual: 'Her point of view, from very low: something enormous sitting up, staring at its own huge hands.', coverage: { size: 'MS', angle: 'worms_eye', role: 'pov' },
        blocking: DISTRICT, poses: { bit: [[0, 'crouch'], [0.4, 'reach']] }, faces: { bit: [[0, 'ooh']] }, min: 3.25,
        camera: (d) => cam.move([-0.15, 0.25, 1.2], [-0.05, 0.25, 1.1], [1.6, 1.9, 0.3], undefined, 52, 'pov')(d) },
      { name: 'Hello', visual: 'They look at each other.', coverage: { size: '2S', angle: 'eye', role: 'coverage' }, blocking: DISTRICT, faces: { sati: [[0, 'worried']], bit: [[0, 'neutral']] },
        lines: [{ who: 'sati', text: '…Hello?' }, { who: 'bit', text: 'Hello.', gap: 0.6 }, { who: 'sati', text: 'Who are you?', gap: 0.9 }, { who: 'bit', text: 'I was going to ask you.', gap: 0.5, face: 'smirk' }],
        camera: two('sati', 'bit', 1, 38) },
      { name: 'Very bright', visual: 'Bit stands, all the way up. He blazes. Sati shields her eyes.', coverage: { size: 'MS', angle: 'low', role: 'single' },
        blocking: DISTRICT, poses: { bit: [[0, 'crouch'], [0.2, 'idle']], sati: [[0.35, 'think']] }, faces: { bit: [[0.6, 'surprised']] },
        lines: [{ who: 'sati', text: "You're very bright." }, { who: 'bit', text: 'Am I?', gap: 0.5 }, { who: 'bit', text: 'Huh.', gap: 0.9, face: 'ooh' }], firstLineAt: 1.4, tail: 0.6,
        camera: ots('sati', 'bit', 44) },
      { name: 'I can move', visual: 'Sati hops on the spot, then again, higher — delighted. Bit tries one careful step and the ground hums under him.', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: DISTRICT, poses: { sati: [[0, 'cheer'], [0.5, 'idle']], bit: [[0.3, 'reach'], [0.6, 'idle']] }, faces: { sati: [[0, 'laugh']], bit: [[0, 'neutral'], [0.5, 'smirk']] },
        moves: { sati: [[0.12, [-0.5, 0.25, 1.6], 40], [0.2, [-0.5, 0, 1.6], 40], [0.3, [-0.4, 0.35, 1.5], 50], [0.38, [-0.4, 0, 1.5], 50]] },
        lines: [{ who: 'sati', text: 'I can move!' }, { who: 'bit', text: 'So can I.', gap: 0.6 }, { who: 'bit', text: 'Slowly.', gap: 0.5 }], firstLineAt: 0.5, tail: 0.5,
        camera: two('sati', 'bit', 1.4, 40), sfx: [{ file: 'thud', at: 2.6, gain: 0.3 }] },
      { name: 'Before', visual: 'Sati, suddenly serious.', coverage: { size: 'CU', angle: 'eye', role: 'single' },
        blocking: DISTRICT, faces: { sati: [[0, 'worried']] },
        lines: [{ who: 'sati', text: 'Do you remember anything? From before?' }],
        camera: close('sati', 15, 28) },
      { name: 'Light, then you', visual: 'Bit thinks about it, properly.', coverage: { size: 'CU', angle: 'low', role: 'reverse' },
        blocking: DISTRICT, poses: { bit: [[0, 'think']] }, faces: { bit: [[0, 'ooh'], [0.6, 'happy']] },
        lines: [{ who: 'bit', text: 'Light.' }, { who: 'bit', text: 'Then you.', gap: 0.9 }, { who: 'sati', text: "That's it?", gap: 0.5 }, { who: 'bit', text: "That's a lot, for a first memory.", gap: 0.5 }], firstLineAt: 0.8, tail: 0.6,
        camera: close('bit', -15, 30, 'low') },
      { name: 'Too loud', visual: 'Bit leans down and tries to whisper. It comes out like distant thunder.', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: DISTRICT, poses: { bit: [[0, 'crouch']] }, faces: { bit: [[0, 'worried'], [0.7, 'surprised']], sati: [[0.3, 'grin'], [0.85, 'laugh']] },
        lines: [{ who: 'bit', text: 'Is this too loud?' }, { who: 'sati', text: 'A bit.', gap: 0.4 }, { who: 'bit', text: '…Was that a joke?', gap: 0.9 }, { who: 'sati', text: "I don't know. Maybe.", gap: 0.4, face: 'laugh', react: { bit: 'laugh' } }], tail: 0.8,
        camera: two('bit', 'sati', 1.2, 38) },
      { name: 'Everyone goes', visual: 'Around them the other new coins get up and walk away in every direction, purposeful, as if they’d always known where to go.', coverage: { size: 'WS', angle: 'high', role: 'master' },
        blocking: DISTRICT, crowd: Object.fromEntries(Object.entries(NEWBORN).map(([k, [p]]) => [k, [p, facing([0, 0, 0], p), [[1, [p[0] * 4, 0, p[2] * 3 - 4]]]] as Extra])),
        faces: { sati: [[0, 'surprised']] },
        lines: [{ who: 'sati', text: 'Where is everyone going?' }, { who: 'bit', text: 'Somewhere, I suppose.', gap: 0.5 }], firstLineAt: 1.2, min: 5,
        camera: (d, b) => cam.move([0.4, 5, 8], [0.4, 5.6, 9], mid(b), mid(b), 46, 'high wide')(d) },
      { name: 'The mark', visual: 'Sati looks down: on her chest, a small glowing sign, like a lock.', coverage: { size: 'INS', angle: 'high', role: 'insert' },
        blocking: DISTRICT, faces: { sati: [[0, 'ooh']] },
        lines: [{ who: 'sati', text: "What's this?" }], firstLineAt: 0.9,
        camera: close('sati', 10, 26, 'high') },
      { name: 'Same as mine', visual: 'Bit taps his own chest. The same sign.', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: DISTRICT, poses: { bit: [[0.1, 'point']] }, faces: { sati: [[0.4, 'surprised']] },
        lines: [{ who: 'bit', text: 'Same as mine.' }, { who: 'sati', text: "So we're… the same?", gap: 0.6 }, { who: 'bit', text: 'We came from the same… thing.', gap: 0.7, face: 'worried' }], tail: 0.6,
        camera: two('bit', 'sati', 0.8, 36) },
      { name: 'Looking up', visual: 'Both look up, past the towers, at the core glowing at the centre of everything.', coverage: { size: 'WS', angle: 'low', role: 'master' },
        blocking: { sati: look([-0.5, 0, 1.6], [0, 6, -30]), bit: look([1.4, 0, 0.4], [0, 6, -30]) }, faces: { sati: [[0, 'determined']] },
        lines: [{ who: 'sati', text: "Let's find out." }], firstLineAt: 1.4, tail: 1,
        camera: (d) => cam.move([1, 0.25, 4.6], [0.8, 0.25, 4], [0.5, 1.6, 0], [0.5, 2.6, -2], 50, 'low')(d) },
    ],
  },
  {
    title: 'Ask the Node', env: 'node_city', arc: { tension: 0.5, beat: 'rising', note: 'Locked to the miner; a hundred blocks to wait. Sati hears the word “spent” for the first time.' },
    summary: 'In the city of light the crew tell them what they are: coinbase coins, locked to a miner on the other side, unable to move for a hundred blocks — and Sati wants to know what “spent” means.',
    music: [{ cue: theme('Node City', 'C', 'lydian', 92, 0.5, { pad: [0, 0.45], bass: [0.1, 0.5], arp: [0, 0.3], perc: [0.3, 0.3] }), from: 0, to: 5, gain: 0.35 }],
    shots: [
      { name: 'City of light', visual: 'Tracking alongside: Sati and Bit walk into the city. Towers banded with data, filaments overhead, crew rushing past with glowing slabs.',
        coverage: { size: 'WS', angle: 'eye', role: 'master' }, blocking: { sati: [[-0.6, 0, 7], 180], bit: [[-3.4, 0, 7.6], 180] }, moves: { sati: [[1, CITY.sati![0], 180]], bit: [[1, CITY.bit![0], 170]] }, min: 6,
        camera: (d) => cam.track([0, 0.6, 7], [0, 0.6, 1], 5, 0.8, 40)(d) },
      { name: 'Coinbase babies', visual: 'The Mempool Host bustles across their path, slab under one arm — and stops dead.', coverage: { size: 'MS', angle: 'eye', role: 'single' },
        blocking: { ...CITY, mempool_host: look([-0.3, 0, -2.6], [0.2, 0, 1]) }, poses: { mempool_host: [[0.1, 'point'], [0.5, 'idle']] }, faces: { mempool_host: [[0, 'happy'], [0.4, 'surprised'], [0.75, 'grin']] },
        lines: [{ who: 'mempool_host', text: "Waiting room's that way, loves—" }, { who: 'mempool_host', text: "Oh. You're new. Brand new.", gap: 0.5 }, { who: 'mempool_host', text: 'Coinbase babies!', gap: 0.5 }],
        camera: close('mempool_host', 15, 32) },
      { name: 'Locked to the miner', visual: 'The Script Clerk leans in, peering at the signs on their chests through round spectacles.', coverage: { size: 'OTS', angle: 'eye', role: 'single' },
        blocking: { ...CITY, script_clerk: look([-0.2, 0, -1.6], [-0.4, 0.4, 1]) }, faces: { script_clerk: [[0, 'neutral']], sati: [[0.5, 'surprised']] },
        lines: [{ who: 'script_clerk', text: 'Locked to the miner. Both of you.' }, { who: 'sati', text: 'The who?', gap: 0.4 }, { who: 'script_clerk', text: 'The one on the other side.', gap: 0.5, face: 'smirk' }],
        camera: ots('sati', 'script_clerk', 34) },
      { name: 'A hundred blocks', visual: 'Sati, eager. The Clerk, precise.', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: { ...CITY, script_clerk: look([-0.2, 0, -1.6], [-0.4, 0.4, 1]) }, faces: { sati: [[0, 'happy']], bit: [[0.6, 'surprised']] },
        lines: [{ who: 'sati', text: 'Can we go somewhere?' }, { who: 'script_clerk', text: 'Not yet. Coinbase coins wait a hundred blocks.' }, { who: 'bit', text: 'A hundred?', gap: 0.3 }, { who: 'script_clerk', text: 'Then you can be spent.', gap: 0.5 }],
        camera: two('sati', 'script_clerk', 1, 36) },
      { name: 'Spent?', visual: 'Close on Sati. The word lands. It frightens her a little, and thrills her more.', coverage: { size: 'CU', angle: 'eye', role: 'single' },
        blocking: CITY, faces: { sati: [[0, 'ooh'], [0.8, 'happy']] },
        lines: [{ who: 'sati', text: 'Spent?' }, { who: 'sati', text: "What happens when you're spent?", gap: 0.7 }, { who: 'script_clerk', text: 'You go somewhere.', gap: 0.5 }, { who: 'sati', text: '…Somewhere.', gap: 0.8, face: 'happy' }], tail: 0.8, tension: 0.55,
        camera: close('sati', -10, 26) },
      { name: 'The Node', visual: 'At the heart of the core, a floating eye of light with two orbit rings: the Node. Sati and Bit, tiny at its feet.', env: 'node_core',
        coverage: { size: 'WS', angle: 'worms_eye', role: 'master' }, blocking: { node: [[0, 2.6, -6.5], 0], sati: [[-0.6, 0, -0.6], 180], bit: [[1, 0, -1], 190] }, crowd: solved,
        faces: { node: [[0, 'neutral']] },
        lines: [{ who: 'sati', text: 'Excuse me. Who are we?' }, { who: 'node', text: 'You are new. You are valid.', gap: 0.8 }, { who: 'node', text: 'And you are unspent.', gap: 0.6 }], firstLineAt: 1.4,
        camera: (d) => cam.move([0.4, 0.3, 3], [0.3, 0.3, 2.4], [0, 3.6, -5], [0, 5, -6.5], 58, 'low')(d), sfx: [{ file: 'hum', at: 0, gain: 0.35 }] },
      { name: 'Everything', visual: 'Bit, looking up at it. The Node’s answer, gentle.', env: 'node_core', coverage: { size: 'OTS', angle: 'low', role: 'reverse' },
        blocking: { node: [[0, 2.6, -6.5], 0], sati: [[-0.6, 0, -0.6], 180], bit: [[1, 0, -1], 190] }, faces: { bit: [[0, 'worried']], node: [[0.4, 'happy']] },
        lines: [{ who: 'bit', text: 'Is that good?' }, { who: 'node', text: 'For now, it is everything.', gap: 0.8 }], tail: 1.2,
        camera: (d) => cam.move([0.6, 5.4, -4.8], [0.5, 5.4, -4.4], [1, 2.4, -1], undefined, 40, 'from above')(d) },
    ],
  },
  {
    title: 'Names', env: 'node_city', arc: { tension: 0.45, beat: 'rising', note: 'Coins don’t get names. They take them anyway.' },
    summary: 'The Clerk reads their values — three thousand two hundred sats, and one whole bitcoin — and the two coins name each other: Sati and Bit.',
    music: [{ cue: theme('Names', 'F', 'lydian', 88, 0.4, { pad: [0, 0.45], arp: [0, 0.3], lead: [0.5, 0.45] }), from: 1, tail: 1, gain: 0.38 }],
    shots: [
      { name: 'Reading values', visual: 'The Script Clerk adjusts his spectacles and reads the numbers glowing on their locks.', coverage: { size: 'MCU', angle: 'eye', role: 'single' },
        blocking: NAMING, poses: { script_clerk: [[0.05, 'think'], [0.5, 'point']] }, faces: { script_clerk: [[0, 'neutral']] },
        lines: [{ who: 'script_clerk', text: 'This one. Three thousand two hundred sats.' }, { who: 'script_clerk', text: 'And you…', gap: 0.6 }, { who: 'script_clerk', text: 'One whole bitcoin.', gap: 0.6, face: 'ooh' }], tail: 0.4,
        camera: close('script_clerk', -20, 30) },
      { name: 'A whistle', visual: 'Behind him, the Mempool Host’s eyebrows go all the way up.', coverage: { size: 'MS', angle: 'eye', role: 'insert' },
        blocking: { ...NAMING, mempool_host: look([0.9, 0, 4.2], [-2, 1.5, 1.2]) }, faces: { mempool_host: [[0, 'ooh']] }, min: 1.5,
        camera: close('mempool_host', -10, 34) },
      { name: 'Sats?', visual: 'Sati looks down at her small glow.', coverage: { size: 'OTS', angle: 'eye', role: 'coverage' },
        blocking: NAMING, faces: { sati: [[0, 'ooh'], [0.7, 'happy']] },
        lines: [{ who: 'sati', text: 'Sats?' }, { who: 'script_clerk', text: 'The smallest amount there is.', gap: 0.4 }, { who: 'sati', text: "I'm made of the smallest thing there is.", gap: 0.8 }, { who: 'bit', text: 'Three thousand two hundred of them.', gap: 0.5 }], tail: 0.4,
        camera: two('script_clerk', 'sati', 1.2, 38) },
      { name: 'Sati', visual: 'Close on her, trying the word on like a coat.', coverage: { size: 'CU', angle: 'eye', role: 'single' },
        blocking: NAMING, faces: { sati: [[0, 'ooh'], [0.45, 'grin']] },
        lines: [{ who: 'sati', text: 'Sats.' }, { who: 'sati', text: 'Sati.', gap: 0.9 }, { who: 'sati', text: "I'm Sati.", gap: 0.7 }], firstLineAt: 0.5, tail: 0.3,
        camera: close('sati', -10, 26) },
      { name: 'No names', visual: 'The Clerk, prim. Sati, unbothered.', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: NAMING, faces: { script_clerk: [[0, 'pout']], sati: [[0.5, 'grin']] },
        lines: [{ who: 'script_clerk', text: "You're a coin. Coins don't get names." }, { who: 'sati', text: 'I just got one.', gap: 0.5 }],
        camera: two('sati', 'script_clerk', 1, 36) },
      { name: 'Then what am I?', visual: 'Bit, enormous and suddenly shy.', coverage: { size: 'MS', angle: 'low', role: 'single' },
        blocking: NAMING, faces: { bit: [[0, 'worried']] },
        lines: [{ who: 'bit', text: 'Then what am I?' }], firstLineAt: 0.5,
        camera: low('bit', undefined, 42) },
      { name: 'Bit', visual: 'Sati looks him up and down, all the way up, and decides.', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: NAMING, faces: { sati: [[0, 'smirk']], bit: [[0.6, 'ooh'], [0.85, 'happy']] }, poses: { sati: [[0.2, 'point']] },
        lines: [{ who: 'sati', text: "You're a whole bitcoin." }, { who: 'sati', text: "You're Bit.", gap: 0.6 }, { who: 'bit', text: 'Bit.', gap: 0.9 }, { who: 'bit', text: 'I like it.', gap: 0.8 }], tail: 0.5,
        camera: two('sati', 'bit', 1.6, 40) },
      { name: 'Whatever next', visual: 'The Mempool Host, bustling off, to nobody in particular.', coverage: { size: 'MS', angle: 'eye', role: 'insert' },
        blocking: { ...NAMING, mempool_host: look([0.9, 0, 4.2], [6, 0, 8]) }, moves: { mempool_host: [[1, [3.4, 0, 6.4], 40]] }, faces: { mempool_host: [[0, 'grin']] },
        lines: [{ who: 'mempool_host', text: 'Coinbase babies, naming themselves. Whatever next.' }], tail: 0.6,
        camera: (d) => cam.still([-0.6, 1.2, 1.6], [1.6, 0.9, 5], 40)(d) },
    ],
  },
  {
    title: 'The Rounds', env: 'node_city', arc: { tension: 0.45, beat: 'rising', note: 'A day in the node: everyone has a job except them.' },
    summary: 'Waiting for block two, Sati and Bit tag along on the crew’s rounds — the Validator’s gate, the waiting room they’re not allowed in, the Hasher’s needle.',
    music: [{ cue: theme('Rounds', 'C', 'mixolydian', 104, 0.55, { pad: [0, 0.4], bass: [0, 0.55], arp: [0, 0.3], lead: [0.4, 0.4], perc: [0.2, 0.35] }), gain: 0.35, tail: 0.5 }],
    shots: [
      { name: 'The gate', visual: 'At the Validator’s gate a stranger coin steps through; a bar of light scans it top to bottom. Pass. The next. Pass. Sati and Bit watch from behind a pillar.',
        coverage: { size: 'WS', angle: 'eye', role: 'master' }, blocking: { validator: look([2.2, 0, -7.2], [0, 1, -8]), sati: [[-3.2, 0, -5.6], 140], bit: [[-4.6, 0, -6.4], 120] },
        crowd: { folk3: [[0, 0, -5], 180, [[0.5, [0, 0, -8], 180], [1, [0, 0, -11], 180]]] }, poses: { validator: [[0.2, 'point'], [0.6, 'arms_crossed']] }, faces: { sati: [[0, 'ooh']] }, min: 5.5,
        camera: (d) => cam.move([-6.5, 1, -1.5], [-6, 1.1, -2.2], [0, 1.4, -8], undefined, 40, 'wide')(d), sfx: [{ file: 'blip', at: 2.4, gain: 0.5 }, { file: 'ping', at: 2.8, gain: 0.3 }] },
      { name: 'Every one', visual: 'The Validator notices them. Stern; not unkind.', coverage: { size: 'MCU', angle: 'low', role: 'single' },
        blocking: { validator: look([2.2, 0, -7.2], [-3.2, 0.6, -5.6]) }, faces: { validator: [[0, 'determined']] },
        lines: [{ who: 'validator', text: 'Every coin. Every rule. Every time.' }, { who: 'validator', text: 'Move along.', gap: 0.6 }], tail: 0.5,
        camera: low('validator', 2.2, 40) },
      { name: 'Did you hear?', visual: 'The Gossip screeches to a halt in front of them, antennae buzzing, talking faster than anyone should.', coverage: { size: 'MS', angle: 'eye', role: 'single' },
        blocking: { sati: [[-0.6, 0, 1], 180], bit: [[2, 0, 0.9], 190], gossip: [[-4, 0, -1.5], 90] }, moves: { gossip: [[0.12, [0.6, 0, -0.6], 10], [0.85, [0.6, 0, -0.6], 10], [1, [6, 0, -3], 100]] },
        poses: { gossip: [[0.15, 'wave'], [0.4, 'point'], [0.7, 'shrug']] }, faces: { gossip: [[0.12, 'grin']], sati: [[0.2, 'surprised']] },
        lines: [{ who: 'gossip', text: 'Did you hear? A node up north lost power for an hour!' }, { who: 'gossip', text: 'Came back fine. Everyone fine. Gotta go!', gap: 0.2 }], firstLineAt: 0.6, tail: 0.6,
        camera: (d) => cam.still([0.2, 0.7, 3.4], [0.4, 0.5, -0.4], 42)(d), sfx: [{ file: 'zap', at: 0.2, gain: 0.5 }, { file: 'whoosh', at: 'end', gain: 0.4 }] },
      { name: 'Keeps nothing', visual: 'The Hasher, ambling past with a slab, answers before Sati can ask.', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: { sati: [[-0.6, 0, 1], 120], hasher: look([0.8, 0, -0.2], [-0.6, 0.4, 1]) }, faces: { hasher: [[0, 'smirk']], sati: [[0, 'ooh']] },
        lines: [{ who: 'sati', text: 'Who was that?' }, { who: 'hasher', text: 'Gossip. Knows everything.', gap: 0.4 }, { who: 'hasher', text: 'Keeps nothing.', gap: 0.5 }], tail: 0.5,
        camera: two('sati', 'hasher', 1, 38) },
      { name: 'Not for you', visual: 'At the edge of a great spiral of waiting slabs, the Mempool Host shoos them off with her slab.', env: 'mempool_hall', coverage: { size: 'WS', angle: 'high', role: 'master' },
        blocking: { mempool_host: look([0, 0, 3.2], [0, 0, 6]), sati: [[-0.8, 0, 6.2], 180], bit: [[0.9, 0, 6.6], 190] }, poses: { mempool_host: [[0.2, 'wave']] }, faces: { mempool_host: [[0, 'grin']], sati: [[0.6, 'pout']] },
        lines: [{ who: 'mempool_host', text: 'Not for you yet, loves. You’re not going anywhere.' }], firstLineAt: 1.2, tail: 0.6,
        camera: (d) => cam.move([0, 7, 13], [0, 6.4, 11.8], [0, 0.6, 2], undefined, 46, 'high')(d) },
      { name: 'Two', visual: 'In the core the cubes click again. The Hasher ticks his counter: 2.', env: 'node_core', coverage: { size: 'MS', angle: 'eye', role: 'insert' },
        blocking: { ...CORE_CREW, sati: [[1.6, 0, 3.6], -110], bit: [[-0.8, 0, 4.4], -150] }, crowd: nonceSearch(7, 1, true), faces: { hasher: [[0.7, 'happy']] },
        lines: [{ who: 'hasher', text: 'Two.' }], firstLineAt: 2.3, tail: 0.6,
        camera: (d) => cam.still([2.8, 1.5, 6.8], [1.2, 0.9, 0], 44)(d), sfx: [{ file: 'click', at: 1.9, gain: 0.8 }] },
      { name: 'A needle', visual: 'Bit, enormous, crouched beside the stocky Hasher at his console.', env: 'node_core', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: { hasher: [[3.55, 0, 2.41], -60], bit: look([1.9, 0, 3.4], [3.55, 1, 2.41]) }, poses: { bit: [[0, 'crouch']] }, faces: { hasher: [[0, 'smirk']], bit: [[0, 'neutral']] },
        lines: [{ who: 'bit', text: 'What do you do, exactly?' }, { who: 'hasher', text: 'Look for a needle. All day.', gap: 0.5 }, { who: 'bit', text: "What's the needle?", gap: 0.5 }, { who: 'hasher', text: 'A number. One lucky number.', gap: 0.5 }, { who: 'bit', text: 'Ah.', gap: 0.7, face: 'ooh' }], tail: 0.6,
        camera: two('bit', 'hasher', 0.8, 40) },
    ],
  },
  {
    title: 'The Giant’s Face', env: 'utxo_district', arc: { tension: 0.5, beat: 'midpoint', note: 'Sati’s want is born: the giant didn’t vanish — it went somewhere, into them.' },
    summary: 'At the quiet edge of the district Sati can’t stop thinking about the giant’s face — and realises it didn’t disappear: it turned into them.',
    music: [{ cue: theme('The Face', 'G', 'lydian', 66, 0.25, { pad: [0, 0.55], arp: [0.2, 0.3], lead: [0.45, 0.45] }), from: 1, tail: 1.5, gain: 0.4 }],
    shots: [
      { name: 'The edge', visual: 'The quiet edge of the district. Sati and Bit sit on the bright ground; the city hums behind them.', coverage: { size: 'WS', angle: 'eye', role: 'master' },
        blocking: { sati: look([-0.4, 0, 1.2], [0, 4, -30]), bit: look([1.1, 0, 0.8], [0, 4, -30]) }, poses: { sati: [[0, 'crouch']], bit: [[0, 'crouch']] }, min: 4.5,
        camera: (d) => cam.move([-1.5, 0.8, 5.6], [-1.3, 0.75, 5], [0.4, 0.7, 0.8], undefined, 40, 'wide')(d) },
      { name: 'Its face', visual: 'Close on Sati, remembering.', coverage: { size: 'CU', angle: 'eye', role: 'single' },
        blocking: { sati: look([-0.4, 0, 1.2], [1.1, 1.5, 0.8]) }, faces: { sati: [[0, 'ooh']] },
        lines: [{ who: 'sati', text: 'Did you see its face?' }], firstLineAt: 0.6,
        camera: close('sati', 20, 28) },
      { name: 'It looked at us', visual: 'Bit, quietly.', coverage: { size: 'CU', angle: 'low', role: 'reverse' },
        blocking: { bit: look([1.1, 0, 0.8], [-0.4, 0.5, 1.2]) }, faces: { bit: [[0, 'happy']] },
        lines: [{ who: 'bit', text: 'It looked at us.' }, { who: 'sati', text: 'Like it knew us.', gap: 0.6 }, { who: 'bit', text: 'Like it was glad.', gap: 0.7 }],
        camera: close('bit', -20, 30, 'low') },
      { name: 'Then it was gone', visual: 'Sati looks down at her small glow. Then up, as it lands.', coverage: { size: 'CU', angle: 'eye', role: 'single' },
        blocking: { sati: look([-0.4, 0, 1.2], [1.1, 1.5, 0.8]) }, faces: { sati: [[0, 'sad'], [0.55, 'surprised'], [0.85, 'happy']] },
        lines: [{ who: 'sati', text: 'And then it was gone.' }, { who: 'sati', text: "No. It didn't go.", gap: 1.1 }, { who: 'sati', text: 'It turned into us.', gap: 0.6 }], tail: 0.8, tension: 0.55,
        camera: close('sati', 5, 26) },
      { name: 'Somewhere', visual: 'Two-shot. Bit lets that sink in.', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: { sati: look([-0.4, 0, 1.2], [1.1, 1.5, 0.8]), bit: look([1.1, 0, 0.8], [-0.4, 0.5, 1.2]) }, poses: { sati: [[0, 'crouch']], bit: [[0, 'crouch']] }, faces: { bit: [[0.3, 'ooh'], [0.75, 'happy']], sati: [[0.75, 'grin']] },
        lines: [{ who: 'bit', text: '…Then it went somewhere.' }], firstLineAt: 1.2, tail: 1.6,
        camera: two('sati', 'bit', 1, 36) },
    ],
  },
  {
    title: 'Night Talk', env: 'utxo_district', arc: { tension: 0.5, beat: 'midpoint', note: 'They tell each other what they like, fear and want: Bit wants speed and dreads being spent; Sati dreads staying.' },
    summary: 'Lying under the data streams, they trade likes and fears: Bit wants to be fast just once and dreads being spent; Sati dreads staying the same forever.',
    music: [{ cue: theme('Night Talk', 'D', 'lydian', 62, 0.2, { pad: [0, 0.5], arp: [0.15, 0.25], lead: [0.6, 0.4] }), from: 0, tail: 2, gain: 0.35 }],
    shots: [
      { name: 'Lying down', visual: 'From above: two lights lying on their backs on the bright ground, one tiny, one enormous, filaments of data streaming over them.', coverage: { size: 'WS', angle: 'birds_eye', role: 'master' },
        blocking: { sati: [[-1.4, 0, 1.2], 0], bit: [[1.6, 0, 0.6], 0] }, poses: { sati: [[0, 'crouch']], bit: [[0, 'crouch']] }, min: 5,
        camera: (d) => cam.move([0.7, 9, 1.5], [0.7, 8, 1.2], [0.7, 0, 0.8], undefined, 40, 'top down')(d) },
      { name: 'What do you like?', visual: 'Close, both faces in the frame, looking up.', coverage: { size: '2S', angle: 'low', role: 'coverage' },
        blocking: { sati: [[-1.4, 0, 1.2], 50], bit: [[1.6, 0, 0.6], -50] }, poses: { sati: [[0, 'crouch']], bit: [[0, 'crouch']] }, faces: { sati: [[0, 'happy']], bit: [[0, 'neutral']] },
        lines: [{ who: 'sati', text: 'What do you like? So far.' }, { who: 'bit', text: 'The hum.', gap: 0.9 }, { who: 'bit', text: 'Things staying where they are.', gap: 0.6 }, { who: 'sati', text: 'I like the streams.', gap: 0.7 }, { who: 'sati', text: "They're always going somewhere.", gap: 0.5 }], tail: 0.6,
        camera: two('sati', 'bit', 1.6, 42) },
      { name: 'Fast', visual: 'Bit turns his huge head toward her.', coverage: { size: 'CU', angle: 'eye', role: 'single' },
        blocking: { bit: [[1.6, 0, 0.6], -40] }, poses: { bit: [[0, 'crouch']] }, faces: { bit: [[0, 'smirk'], [0.6, 'ooh']] },
        lines: [{ who: 'bit', text: 'You keep saying that. Somewhere.' }, { who: 'sati', text: "Don't you want to go somewhere?", gap: 0.5 }, { who: 'bit', text: "I'd like to be fast.", gap: 1 }, { who: 'bit', text: 'Just once.', gap: 0.5 }], tail: 0.4,
        camera: close('bit', -20, 30) },
      { name: 'You? Fast?', visual: 'Sati props herself up on an elbow, grinning.', coverage: { size: 'CU', angle: 'eye', role: 'reverse' },
        blocking: { sati: [[-1.4, 0, 1.2], 50] }, poses: { sati: [[0, 'crouch']] }, faces: { sati: [[0, 'laugh']] },
        lines: [{ who: 'sati', text: 'You? Fast?' }, { who: 'bit', text: "Everything's slow when you're big.", gap: 0.6 }], tail: 0.6,
        camera: close('sati', 20, 28) },
      { name: 'Scared', visual: 'A quiet beat. The streams overhead. Then Sati, softer.', coverage: { size: 'CU', angle: 'eye', role: 'single' },
        blocking: { sati: [[-1.4, 0, 1.2], 50] }, poses: { sati: [[0, 'crouch']] }, faces: { sati: [[0, 'neutral'], [0.4, 'worried']] },
        lines: [{ who: 'sati', text: 'What are you scared of?' }], firstLineAt: 1.4, tail: 0.6,
        camera: close('sati', 30, 30) },
      { name: 'Being spent', visual: 'Bit, not looking at her.', coverage: { size: 'CU', angle: 'low', role: 'reverse' },
        blocking: { bit: [[1.6, 0, 0.6], -10] }, poses: { bit: [[0, 'crouch']] }, faces: { bit: [[0, 'sad']] },
        lines: [{ who: 'bit', text: 'Being spent.' }, { who: 'bit', text: 'Not knowing where the rest of me ends up.', gap: 1.1 }], firstLineAt: 1, tail: 1, tension: 0.55,
        camera: close('bit', -30, 30, 'low') },
      { name: 'Staying', visual: 'Sati, after a while.', coverage: { size: 'CU', angle: 'eye', role: 'single' },
        blocking: { sati: [[-1.4, 0, 1.2], 50] }, poses: { sati: [[0, 'crouch']] }, faces: { sati: [[0, 'sad']] },
        lines: [{ who: 'bit', text: 'What about you?' }, { who: 'sati', text: 'Staying.', gap: 1 }, { who: 'sati', text: 'Being the same coin forever, in the same place, and nobody ever needing me.', gap: 0.8 }], tail: 0.9,
        camera: close('sati', 10, 26) },
      { name: 'Two good blocks', visual: 'Two-shot. Bit, simply. Sati laughs; so does he, and the ground hums.', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: { sati: [[-1.4, 0, 1.2], 50], bit: [[1.6, 0, 0.6], -50] }, poses: { sati: [[0, 'crouch']], bit: [[0, 'crouch']] }, faces: { bit: [[0, 'happy']], sati: [[0.3, 'surprised'], [0.7, 'laugh']] },
        lines: [{ who: 'bit', text: 'I need you.' }, { who: 'sati', text: "You've known me for two blocks.", gap: 0.8 }, { who: 'bit', text: 'Two very good blocks.', gap: 0.5, react: { sati: 'laugh' } }], firstLineAt: 0.6, tail: 1.4,
        camera: two('sati', 'bit', 1.8, 40), sfx: [{ file: 'hum', at: 'end', gain: 0.3 }] },
    ],
  },
  {
    title: 'One of a Hundred', env: 'node_core', arc: { tension: 0.6, beat: 'inciting', note: 'Block one of a hundred — and something dark is building blocks out there.' },
    summary: 'Every node takes the block; far off, something builds blocks without any light; in the dark garage Ana wakes to “block found”, and Sati and Bit settle in to wait.',
    music: [
      { cue: theme('Out There', 'D', 'phrygian', 64, 0.35, { pad: [0, 0.55], bass: [0, 0.6], arp: [0.4, 0.25] }), from: 2, to: 4, gain: 0.45 },
      { cue: theme('Home Light', 'C', 'major', 84, 0.45, { pad: [0, 0.55], arp: [0, 0.35], lead: [0.25, 0.5] }), from: 4, tail: 2.5, gain: 0.5 },
    ],
    shots: [
      { name: 'One down', visual: 'Block three. The Hasher ticks his counter: 3. The Gossip skids back in, breathless.', coverage: { size: '2S', angle: 'eye', role: 'coverage' },
        blocking: { ...CORE_CREW, gossip: [[-3, 0, 4], 120] }, moves: { gossip: [[0.4, [2.4, 0, 3], 100]] }, faces: { hasher: [[0, 'happy']], gossip: [[0.4, 'grin']] },
        lines: [{ who: 'hasher', text: 'Three down.' }, { who: 'hasher', text: 'Ninety-seven to go.', gap: 0.5 }, { who: 'gossip', text: "Everyone's got it! Every node!", gap: 0.4 }],
        camera: two('hasher', 'gossip', 1, 38) },
      { name: 'Every node', visual: 'Outside, in the black: node after node lights up, a wave rolling through the network as the block arrives.', env: 'network_void', notes: 'Ref: explorer network.js montage.',
        coverage: { size: 'EWS', angle: 'eye', role: 'master' }, min: 6,
        camera: (d) => cam.orbit([0, 0, -40], 40, 8, -30, 15, 50)(d), sfx: [{ file: 'sparkle', at: 0.5, gain: 0.5 }, { file: 'sparkle', at: 3, gain: 0.4 }] },
      { name: 'Something dark', visual: 'Far off, a blind spot in the network. Black blocks, stacked one after another, giving off no light at all. A tall silhouette steps back from them.', env: 'dark_chain',
        coverage: { size: 'WS', angle: 'low', role: 'insert' }, blocking: { rewriter: [[7, 0, -3], -120] }, min: 5.5, tension: 0.7,
        camera: (d) => cam.move([-4, 0.6, 9], [-3, 0.8, 7.6], [10, 1.5, -6], undefined, 46, 'creep')(d), sfx: [{ file: 'hum', at: 0.5, gain: 0.4 }] },
      { name: "Who's that?", visual: 'The Hasher, looking out through the skin of the core, frowning.', coverage: { size: 'CU', angle: 'eye', role: 'single' },
        blocking: { hasher: [[3.55, 0, 2.41], 120] }, faces: { hasher: [[0, 'worried']] },
        lines: [{ who: 'hasher', text: "…Who's that?" }], firstLineAt: 1, tail: 0.8, tension: 0.7,
        camera: close('hasher', -10, 28) },
      { name: 'Block found', visual: 'The garage. Ana’s phone buzzes and lights up. She wakes, squints at it, and sits bolt upright.', env: 'garage',
        coverage: { size: 'MCU', angle: 'eye', role: 'single' }, blocking: { ana: [[0.4, 0, -0.2], 0] }, poses: { ana: [[0, 'crouch'], [0.45, 'idle'], [0.75, 'cheer']] }, faces: { ana: [[0, 'neutral'], [0.4, 'surprised'], [0.75, 'grin']] },
        lines: [{ who: 'ana', text: 'No way.' }, { who: 'ana', text: 'No way!', gap: 0.7 }], firstLineAt: 2, tail: 0.8,
        camera: close('ana', 15, 34), sfx: [{ file: 'ping', at: 0.5 }] },
      { name: 'Calling home', visual: 'Ana, phone to her ear, pacing between the glowing rigs. The only light on her face is the phone and the fans.', env: 'garage',
        coverage: { size: 'MS', angle: 'eye', role: 'single' }, blocking: { ana: [[0.4, 0, -0.2], 0] }, moves: { ana: [[0.4, [-0.6, 0, 0.4], 60], [0.8, [0.6, 0, 0.8], -60]] }, poses: { ana: [[0, 'think']] }, faces: { ana: [[0, 'happy'], [0.55, 'worried'], [0.9, 'happy']] },
        lines: [{ who: 'ana', text: "Hey. Sorry, I know it's late." }, { who: 'ana', text: 'I found one. A whole block.', gap: 0.8 }, { who: 'ana', text: "No, I'm keeping it. All of it. For now.", gap: 1.4 },
          { who: 'ana', text: 'If the dam holds through winter, I can pay off the rigs.', gap: 1.2 }, { who: 'ana', text: "I know. I know it's a lot of power.", gap: 1.3 }, { who: 'ana', text: 'Night, Mum.', gap: 1 }], firstLineAt: 0.8, tail: 1,
        camera: (d) => cam.move([2.2, 1.5, 3], [1.8, 1.45, 2.6], [0, 1.4, 0.2], undefined, 40, 'slow push')(d), sfx: [{ file: 'hum', at: 0, gain: 0.4 }] },
      { name: 'Waiting together', visual: 'Back inside: Sati and Bit sit side by side among the resting coins, looking up at the core. Pull back until they are two small lights in a city of light.', env: 'utxo_district',
        coverage: { size: 'EWS', angle: 'high', role: 'master' }, blocking: { sati: look([0, 0, 1], [0, 6, -30]), bit: look([1.3, 0, 0.6], [0, 6, -30]) }, poses: { sati: [[0, 'crouch']], bit: [[0, 'crouch']] },
        lines: [{ who: 'sati', text: 'A hundred blocks.' }, { who: 'bit', text: "We'll wait together.", gap: 0.9 }], firstLineAt: 1.2, min: 9,
        camera: (d, b) => cam.move([0.8, 1.2, 4], [0.8, 16, 22], mid(b), mid(b), 44, 'pull back')(d) },
    ],
  },
];

// ---- Episodes 2–8: scene outlines (one placeholder shot each, sized to the scene)

interface OutlineScene { title: string; env: string; beat: Beat; tension: number; summary: string; cast: string[]; secs: number }
/** a placeholder shot for an outlined scene: the cast lined up on the set, a wide from the environment's preview camera */
function outline(o: OutlineScene): SceneSpec {
  const env = V3_ENVIRONMENTS[o.env];
  const cast = o.cast.filter((c) => characters[c]);
  const row: Crowd = Object.fromEntries(cast.map((c, i) => [c, [[(i - (cast.length - 1) / 2) * 1.4, 0, 0.5], 0] as Extra]));
  return {
    title: o.title, env: o.env, summary: o.summary, arc: { tension: o.tension, beat: o.beat, note: '' },
    shots: [{ name: `Outline — ${o.title}`, visual: `${o.summary} (Not boarded yet.)`, crowd: row, min: o.secs, status: 'todo',
      camera: (d) => cam.still(env.preview?.position ?? [0, 2, 10], env.preview?.target ?? [0, 1, 0], env.preview?.fov ?? 50)(d) }],
  };
}
/** outline scenes run ~1.3× the first estimates: longer episodes, room for the characters to talk */
const S = (title: string, env: string, beat: Beat, tension: number, secs: number, cast: string[], summary: string): OutlineScene => ({ title, env, beat, tension, secs: Math.round(secs * 1.3), cast, summary });

const EP2 = [
  S('Waiting', 'utxo_district', 'setup', 0.3, 110, ['sati', 'bit'], 'Blocks tick by. Sati can’t sit still; Bit can — but he sighs at every ten-minute wait. They start to learn each other.'),
  S('Strangers Walk In', 'node_city', 'rising', 0.4, 120, ['sati', 'bit', 'folk1', 'folk2', 'validator'], 'They follow two strangers through the Validator’s gate into a transaction: input tubes flowing into a bar of light.'),
  S('Melt', 'node_core', 'midpoint', 0.6, 130, ['sati', 'bit', 'folk1', 'folk2', 'folk5'], 'The strangers melt into light; new outputs walk out with new faces, remembering nothing. Sati is shaken — and can’t look away.'),
  S('The Wrong Key', 'node_city', 'rising', 0.55, 120, ['validator', 'script_clerk', 'sati', 'bit', 'folk3'], 'A transaction arrives signed with the wrong key. The Validator turns it away; the Clerk shows Sati the lock she carries.'),
  S('Ten Blocks', 'utxo_district', 'resolution', 0.35, 100, ['sati', 'bit'], 'Block ten. “When it’s my turn, I want to go.” “Even if you don’t come back?” Sati doesn’t answer.'),
];
const EP3 = [
  S('The Waiting Room', 'mempool_hall', 'setup', 0.35, 120, ['sati', 'bit', 'mempool_host'], 'They sneak into the mempool: a vast spiral of waiting transactions, the bright ones bidding more. The Host runs it all.'),
  S('Pip', 'mempool_hall', 'rising', 0.4, 140, ['sati', 'pip', 'bit'], 'Sati meets Pip, a tiny, funny coin stuck in a low-fee transaction for days. Instant friends.'),
  S('Fee Rush', 'mempool_hall', 'crisis', 0.6, 130, ['pip', 'sati', 'mempool_host', 'folk2', 'folk4'], 'A rush: bright transactions jump the queue, block after block. Pip is passed over again. Sati wants to help and can’t.'),
  S('Made It', 'node_core', 'resolution', 0.5, 120, ['pip', 'sati', 'bit', 'hasher'], 'The Hasher finally picks Pip’s transaction into the newest block. Pip waves goodbye, glowing. Block thirty.'),
];
const EP4 = [
  S('Free Light', 'mempool_hall', 'setup', 0.4, 120, ['counterfeiter', 'mempool_host', 'folk1', 'folk3'], 'An over-bright stranger works the waiting room, handing out coins from nothing.'),
  S('Tempted', 'mempool_hall', 'rising', 0.55, 130, ['counterfeiter', 'sati', 'bit'], 'He offers Sati a faster way to matter. She’s tempted; Bit isn’t.'),
  S('Rejected', 'node_city', 'climax', 0.7, 140, ['validator', 'counterfeiter', 'sati', 'gossip'], 'At the gate the Validator checks his coins: their parents don’t exist. Rejected — and the Gossip carries the word to every node.'),
  S('Nowhere', 'network_void', 'resolution', 0.5, 110, ['counterfeiter', 'rewriter'], 'Node after node turns him away. Out in the void he slips toward a dark shape that is stacking black blocks. Block forty-five.'),
];
const EP5 = [
  S('Storm Warning', 'river_dam', 'setup', 0.45, 100, ['ana'], 'Outside: a storm rolls toward the town. The dam’s lights flicker. Ana, exhausted, keeps her rigs running.'),
  S('Lights Out', 'node_city', 'inciting', 0.75, 110, ['validator', 'hasher', 'mempool_host', 'sati', 'bit'], 'The node goes dark mid-sentence. Machinery stops, no data moves, the crew freeze. Only the coins still glow.'),
  S('Outside', 'network_void', 'midpoint', 0.6, 140, ['sati', 'bit'], 'Sati and Bit wake outside every node, like spirits in the void, and see the whole network — and a copy of themselves in every single node.'),
  S('The Crossing', 'garage', 'rising', 0.65, 140, ['sati', 'bit', 'ana'], 'Through the core of their dark node they cross into the human world as invisible passengers, and watch Ana fight to bring the power back.'),
  S('Resync', 'node_core', 'resolution', 0.4, 120, ['hasher', 'validator', 'gossip', 'node', 'sati', 'bit'], 'Power returns. The node reboots; the crew wake groggy with a gap in their memory and catch up block by block. Block fifty-eight.'),
];
const EP6 = [
  S('A Message', 'garage', 'setup', 0.45, 110, ['ana', 'thief'], 'A friendly “support” message asks Ana to confirm her seed words. In town, a figure watches a screen.'),
  S('The Agent', 'utxo_district', 'rising', 0.6, 130, ['sati', 'bit', 'folk4'], 'Inside, a slick stranger tries to lead Sati and Bit to a new lock.'),
  S('No Signature', 'node_city', 'climax', 0.7, 120, ['validator', 'script_clerk', 'sati', 'bit'], 'At the gate it falls apart: no signature from the miner, no move. The Clerk shows why the lock holds.'),
  S('Almost', 'garage', 'crisis', 0.75, 140, ['ana', 'sati', 'bit'], 'Ana nearly types the words. Sati and Bit, passengers in her phone’s glow, can’t stop her. Something feels wrong. She doesn’t.'),
  S('Seventy-Two', 'utxo_district', 'resolution', 0.4, 90, ['sati', 'bit'], 'Block seventy-two. Sati has learned that being moved isn’t the same as going somewhere.'),
];
const EP7 = [
  S('The Offer', 'river_dam', 'setup', 0.55, 120, ['ana', 'rewriter'], 'In the storm, a big mining operation’s man offers Ana good money to point her rigs at his pool. She says no.'),
  S('The Dark Chain', 'dark_chain', 'rising', 0.7, 110, ['rewriter', 'hasher'], 'The Hasher finally sees it: a hidden chain of black blocks, growing.'),
  S('Release', 'node_core', 'crisis', 0.9, 130, ['rewriter', 'pip', 'sati', 'bit', 'hasher'], 'He releases it. The newest block is orphaned — Pip’s block. Pip never existed. Sati is devastated.'),
  S('Race', 'garage', 'climax', 0.95, 150, ['ana', 'hasher', 'sati', 'bit'], 'Ana keeps mining through the storm while the honest network races the dark chain. The dam is hit.'),
  S('Heavier', 'node_core', 'resolution', 0.6, 120, ['hasher', 'node', 'sati', 'bit', 'rewriter'], 'The honest chain outweighs his; the dark chain falls apart. Sati and Bit survive because their block is buried deep enough. Block ninety-nine.'),
];
const EP8 = [
  S('One Hundred', 'node_core', 'setup', 0.5, 110, ['sati', 'bit', 'hasher', 'node', 'script_clerk'], 'Block one hundred. Their locks change; they are finally real, and free to be spent.'),
  S('The Town in the Dark', 'town_night', 'rising', 0.55, 120, ['ana'], 'The dam is broken and the town is dark. Ana decides to help pay for the repair.'),
  S('Goodbye', 'utxo_district', 'crisis', 0.8, 150, ['sati', 'bit'], 'Sati chooses to go. Saying goodbye to Bit.'),
  S('Spent', 'node_core', 'climax', 0.95, 140, ['sati', 'validator', 'hasher', 'node'], 'The transaction: Sati flows in, melts into light, and crosses through the core as an invisible passenger inside the payment.'),
  S('One Light', 'town_night', 'resolution', 0.4, 110, ['ana'], 'In the dark town one light comes back on. Somewhere, a brand-new coin hums Sati’s little tune.'),
  S('Faster', 'network_void', 'resolution', 0.35, 90, ['bit', 'mili'], 'Ana opens a channel with Bit. On the skin of the node a tiny spark races past him. Season two.'),
];

// ------------------------------------------------------------------ build

const ref = (t: Treatment): Treatment => t;
export const STYLE_BOARD: Treatment[] = [
  ref({ id: 'tx_cinematic', name: '3D cinematic', order: 1, reference: true, chosen: false, status: 'review', medium: 'cinematic',
    adjectives: ['emotional', 'cinematic', 'modern'],
    principles: ['Pixar-style volumes', 'Cinematic cameras', 'Rich materials', 'Emotional storytelling'],
    palette: ['#f4efe4', '#ffd9a0', '#7eb6ff', '#1c2430'],
    characters: { mili: 'Small, fast, rim-lit. Eyes carry the performance.', sati: 'Mid scale, soft key, thoughtful face.', bit: 'Large simple volume, broad highlights.' },
    camera: 'Wide city frames, longer lenses on faces.', light: 'Warm key, cool fill, characters as practicals.', line: 'No drawn line. Form from light.', materials: 'Soft subsurface, polished marble, glass.', notes: '' }),
  ref({ id: 'tx_cartoon', name: '2D cartoon', order: 2, reference: true, chosen: false, status: 'review', medium: 'cartoon',
    adjectives: ['bold lines', 'flat colors', 'fun', 'expressive'],
    principles: ['TV animation staging', 'Bold outlines', 'Flat local color', 'Clear poses'],
    palette: ['#f7f3ea', '#f0b429', '#3aa0e8', '#2a4a7a'],
    characters: { mili: 'Tiny, thick contour, squash on the run.', sati: 'Same outline family, calmer pose.', bit: 'One big shape, face does the acting.' },
    camera: 'Flat staging, limited moves, readable silhouettes.', light: 'No realistic light. Color does the separation.', line: 'Even, confident ink.', materials: 'Flat fills. Backgrounds more rendered than the cast.', notes: '' }),
  ref({ id: 'tx_storybook', name: 'Hand-drawn storybook', order: 3, reference: true, chosen: false, status: 'review', medium: 'storybook',
    adjectives: ['sketchy lines', 'watercolor', 'warm', 'charming'],
    principles: ['Sketchy construction', 'Watercolor washes', 'Warm paper', 'Storybook scale'],
    palette: ['#f6f0e4', '#e7b07a', '#8fbf9f', '#6a5a48'],
    characters: { mili: 'Loose pencil, the glow is a wash.', sati: 'Fewer strokes, clearer eyes.', bit: 'Big soft mass, detail only in the face.' },
    camera: 'Held storybook frames.', light: 'Bleeding light, no hard shadows.', line: 'Pencil over pigment.', materials: 'Paper grain, blooms, granulation.', notes: '' }),
  ref({ id: 'tx_retro', name: 'Graphic retro', order: 4, reference: true, chosen: false, status: 'review', medium: 'retro',
    adjectives: ['bold shapes', 'texture', 'retro', 'playful'],
    principles: ['Print texture', 'Limited retro palette', 'Poster composition', 'Playful scale'],
    palette: ['#f4e04a', '#e23b2f', '#2f6fed', '#1a1a1a'],
    characters: { mili: 'Graphic blob with a hard outline.', sati: 'Same family, slightly more face.', bit: 'A billboard shape. The pose is the design.' },
    camera: 'Poster frames. Strong foreground shapes.', light: 'Flat, with a printed shadow.', line: 'Thick, slightly imperfect ink.', materials: 'Halftone and paper texture over flat color.', notes: '' }),
  ref({ id: 'tx_anime', name: 'Anime', order: 5, reference: true, chosen: false, status: 'review', medium: 'anime',
    adjectives: ['clean lines', 'dynamic', 'expressive', 'cinematic'],
    principles: ['Clean digital line', 'Dynamic poses', 'Painted backgrounds', 'Expressive faces'],
    palette: ['#f7f4ee', '#ffb15a', '#7eb6ff', '#243044'],
    characters: { mili: 'Speed lines and a small, sharp face.', sati: 'Cleaner, stiller, the eyes do the thinking.', bit: 'Simplified volume, anime highlight on the cheek.' },
    camera: 'Dynamic angles, speed in the frame.', light: 'Cel shading plus a painted sky.', line: 'Thin, consistent digital ink.', materials: 'Flat color, soft airbrush only in the background.', notes: '' }),
  ref({ id: 'tx_iconic', name: 'Minimal iconic', order: 6, reference: true, chosen: false, status: 'review', medium: 'iconic',
    adjectives: ['simple forms', 'strong silhouette', 'versatile'],
    principles: ['One shape per character', 'Strong silhouette', 'Almost no texture', 'Works at any size'],
    palette: ['#2489F5', '#65B5FF', '#D7EAFF', '#0B1936', '#FFFDF5', '#FFD12F', '#FF9564', '#F4F9FF'],
    characters: { mili: 'Smallest. Lightning bolts when she moves. Squash and stretch.', sati: 'Medium sphere, confident brows, the story focus.', bit: 'Largest sphere, slow and heavy.' },
    camera: 'Same lenses and blocking as the Pixar camera.', light: 'Flat fills. Soft disc shadows. No HDRI.', line: 'Silhouette first. Outlines only where a shape needs them.', materials: 'Unlit white characters, four to six colors per scene.', notes: 'Preview toggle: Flat. The world sheet is the board.', board: 'media/boards/treatment-iconic.jpg' }),
  ref({ id: 'tx_stopmotion', name: 'Stop-motion', order: 7, reference: true, chosen: false, status: 'review', medium: 'stopmotion',
    adjectives: ['tangible', 'textured', 'crafted', 'charming'],
    principles: ['Practical materials', 'Visible craft', 'Tactile light', 'Charming imperfection'],
    palette: ['#f3ecdf', '#d8c4a4', '#8a7560', '#3a332c'],
    characters: { mili: 'Small felt or clay, fingerprint scale.', sati: 'Same material, quieter pose.', bit: 'A heavy handmade volume. Seams are welcome.' },
    camera: 'Real-set lenses, shallow focus.', light: 'Practical lamps, soft contact shadows.', line: 'No line. Edges are material.', materials: 'Felt, clay, fabric, dust.', notes: '' }),
  ref({ id: 'tx_clay', name: '3D clay', order: 8, reference: true, chosen: false, status: 'review', medium: 'clay',
    adjectives: ['tactile', 'handcrafted', 'playful', 'expressive'],
    principles: ['Plasticine volumes', 'Fingerprints', 'Playful squash', 'Studio light'],
    palette: ['#f6f1e8', '#f0d2a0', '#c9845a', '#6e5344'],
    characters: { mili: 'A pinched little lump, bright eyes.', sati: 'Smoother, still handmade.', bit: 'A big ball of clay. The weight reads.' },
    camera: 'Close enough to see the craft.', light: 'Soft studio key, gentle bounce.', line: 'None.', materials: 'Plasticine, tool marks, slight subsurface.', notes: '' }),
  ref({ id: 'tx_animatic', name: 'Line sketch', order: 9, reference: true, chosen: false, status: 'review', medium: 'animatic',
    adjectives: ['rough lines', 'expressive', 'fast', 'story-driven'],
    principles: ['Rough construction', 'Story first', 'Fast poses', 'Unfinished on purpose'],
    palette: ['#f7f4ee', '#222222', '#9a9a9a', '#ffffff'],
    characters: { mili: 'Gesture first, features last.', sati: 'Fewer lines, a clear eyeline.', bit: 'A heavy contour and a face.' },
    camera: 'Storyboard frames. The drawing is the shot.', light: 'Hatched, not lit.', line: 'Rough pencil, overlapping strokes.', materials: 'Paper. Nothing finished.', notes: '' }),
  ref({ id: 'tx_geometric', name: 'Geometric', order: 10, reference: true, chosen: false, status: 'review', medium: 'geometric',
    adjectives: ['shapes', 'colors', 'stylized', 'modern'],
    principles: ['Simple geometry', 'Bold color blocks', 'Modern layout', 'Stylized motion'],
    palette: ['#ffffff', '#ff7a3c', '#3d7dff', '#f2c14e'],
    characters: { mili: 'Small circle plus a motion wedge.', sati: 'Circle and a slight oval.', bit: 'The largest circle in the frame.' },
    camera: 'Designed frames, like a poster in motion.', light: 'Flat. Color is the light.', line: 'Clean vector edges.', materials: 'Flat shapes, no texture.', notes: '' }),
  ref({ id: 'tx_collage', name: 'Paper cutout', order: 11, reference: true, chosen: false, status: 'review', medium: 'collage',
    adjectives: ['paper texture', 'layered', 'handmade', 'artistic'],
    principles: ['Cut paper layers', 'Visible edges', 'Handmade texture', 'Collage backgrounds'],
    palette: ['#f4efe6', '#e7d3b0', '#c47a5a', '#6e8b74'],
    characters: { mili: 'A small cut shape, slightly off the layer below.', sati: 'Layered paper, a drawn face on top.', bit: 'One big cutout. The shadow is another sheet.' },
    camera: 'Flat, with real paper depth.', light: 'A single raking light so layers cast shadows.', line: 'The cut edge is the line.', materials: 'Paper, card, torn fiber, glue.', notes: '' }),
  ref({ id: 'tx_bw', name: 'Black & white + glow', order: 12, reference: true, chosen: false, status: 'review', medium: 'bw',
    adjectives: ['high contrast', 'atmospheric', 'stylized'],
    principles: ['Monochrome', 'Characters as light sources', 'High contrast', 'Atmospheric city'],
    palette: ['#f2f2f2', '#9a9a9a', '#2a2a2a', '#050505'],
    characters: { mili: 'A small lamp. The eyes are the hottest point.', sati: 'Quieter glow, more midtone.', bit: 'A large soft light. The body is the practical.' },
    camera: 'Cinematic, low angles, reflections on wet ground.', light: 'The cast is the only light. Deep blacks around them.', line: 'None. Glow defines the edge.', materials: 'Matte blacks, bloom, wet reflections.', notes: '' }),
];


const SEASON = {
  title: 'Season 1 — Unspent',
  logline: 'Two coins born from nothing in a miner’s node have a hundred blocks to wait before they’re real — while a rival builds a chain in the dark that could erase them.',
  plot: 'A miner in a dark river town finds a block; inside her node a silent giant, the Coinbase, breaks into new coins, and two of them — small Sati and huge Bit — wake with no idea who they are. Locked to the miner and unable to move for a hundred blocks, they learn their world: transactions that melt coins into strangers, a waiting room where Sati befriends little Pip, a forger every node rejects, a blackout that throws them outside the network to see themselves on every node, and a thief who can’t move them without the miner’s signature. Then the Rewriter releases his hidden chain: Pip’s block is orphaned, but honest work outweighs him and Sati and Bit survive by depth. At block one hundred, Sati chooses to be spent — to help relight the town — and becomes someone new, while Bit opens a door to Lightning.',
};

const EPISODES = [
  { id: 'ep01', number: 1, title: 'Coinbase', theme: 'Everything has to start from somewhere. Almost everything.', arc: { tension: 0.35, beat: 'setup' as Beat, note: 'Birth: the world, the crew, the wait.' },
    logline: 'A block is mined in a garage at the edge of a dark town; inside the node a silent giant is born from nothing and breaks into new coins — two of them, Sati and Bit, wake with no idea who they are.',
    synopsis: 'Wordless, we fall from a dark town into a sleeping miner’s node: a city of light with the timechain turning at its core. The Hasher shuffles cubes until they click into a valid block. From it rises the Coinbase, a silent giant with no parents, which breaks into new coins. Sati and Bit wake, find the same lock on their chests, and learn from the crew that they belong to the miner and must wait a hundred blocks before they can be spent. Far off, something is building blocks in the dark.', scenes: EP1 },
  { id: 'ep02', number: 2, title: 'Transaction', theme: 'To go somewhere, you stop being who you were.', arc: { tension: 0.4, beat: 'inciting' as Beat, note: 'Foreshadow: coins lose themselves when spent.' },
    logline: 'Sati and Bit get to know each other — and watch strangers walk into a transaction and come out as someone else.',
    synopsis: 'Waiting out their hundred blocks, Sati and Bit follow strangers through the Validator’s gate and watch them melt into a transaction and come out as new coins who remember nothing. A wrong-key transaction is turned away. Sati still wants to go.', scenes: EP2.map(outline) },
  { id: 'ep03', number: 3, title: 'The Mempool', theme: 'Everyone is waiting for something.', arc: { tension: 0.45, beat: 'rising' as Beat, note: 'Sati makes a friend.' },
    logline: 'In the waiting room of the node, Sati befriends Pip, a tiny coin stuck in a low-fee transaction, and cheers when he finally makes it into a block.',
    synopsis: 'Sati and Bit sneak into the mempool, a spiral of waiting transactions that bid for space. Sati befriends Pip, passed over block after block, until the Hasher finally picks his transaction into the newest block.', scenes: EP3.map(outline) },
  { id: 'ep04', number: 4, title: 'The Counterfeiter', theme: 'What comes from nothing is worth nothing — except once.', arc: { tension: 0.5, beat: 'rising' as Beat, note: 'The rules hold everywhere.' },
    logline: 'An over-bright stranger offers coins from nothing; every node turns him away, and he slips into the dark toward someone else.',
    synopsis: 'The Counterfeiter tempts the waiting room and Sati with coins from nothing. At the gate their parents don’t exist; the Validator rejects him and every node follows. In the void he drifts toward the Rewriter.', scenes: EP4.map(outline) },
  { id: 'ep05', number: 5, title: 'The Dark Node', theme: 'You are everywhere at once — and nowhere is home.', arc: { tension: 0.65, beat: 'midpoint' as Beat, note: 'Decentralization seen from outside; first crossing.' },
    logline: 'A storm kills the miner’s node: its crew go dark, but Sati and Bit wake outside every node and see themselves in all of them — then cross into the human world.',
    synopsis: 'The storm cuts the power. The node goes dark and its crew freeze; only the coins glow. Sati and Bit wake in the void, seeing the whole network and a copy of themselves in every node. Through the core they cross into the human world as invisible passengers and watch Ana bring the power back. The node reboots and the crew resync.', scenes: EP5.map(outline) },
  { id: 'ep06', number: 6, title: 'The Thief', theme: 'Being moved is not the same as going somewhere.', arc: { tension: 0.7, beat: 'rising' as Beat, note: 'Keys and signatures, across both worlds.' },
    logline: 'A phisher works on Ana outside while his agent tries to move Sati and Bit inside — and nothing moves without her signature.',
    synopsis: 'A fake support message asks Ana for her seed words. Inside, an agent tries to lead Sati and Bit to a new lock, but without the miner’s signature the Validator stops them. Outside, Ana almost types the words — and doesn’t.', scenes: EP6.map(outline) },
  { id: 'ep07', number: 7, title: 'The Rewrite', theme: 'The past is only as safe as the work piled on top of it.', arc: { tension: 0.95, beat: 'crisis' as Beat, note: 'The villain strikes; a loss; honest work wins.' },
    logline: 'The Rewriter releases his hidden chain: Pip’s block is erased, but the honest network outworks him and Sati and Bit survive by depth.',
    synopsis: 'Ana refuses the Rewriter’s offer and mines through the storm. He releases his hidden chain and the newest block is orphaned — Pip never existed. The honest chain outweighs his and the dark chain collapses; Sati and Bit’s birth block holds. The dam is damaged.', scenes: EP7.map(outline) },
  { id: 'ep08', number: 8, title: 'Spent', theme: 'To matter, you let go.', arc: { tension: 0.85, beat: 'climax' as Beat, note: 'Sati is spent; echo; Season 2 hook.' },
    logline: 'At block one hundred Sati chooses to be spent to help relight the town — and becomes someone new; Bit is left looking toward Lightning.',
    synopsis: 'Block one hundred: Sati and Bit are free to move. The town is dark; Ana pays toward the dam’s repair, and Sati goes, melting into the transaction and crossing as a passenger. A light comes back on in town, and a new coin hums her tune. Ana opens a channel with Bit, and a tiny spark races past him.', scenes: EP8.map(outline) },
];

const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : undefined;

/** Builds one episode (scenes, shots, scene-level music cues) into `data`. Returns the cue ids it wrote. */
async function buildEpisode(epSpec: (typeof EPISODES)[number], data: ProjectData, boards: boolean) {
  console.log(`\n→ ${epSpec.id} ${epSpec.title} ${NO_TTS ? '(no TTS)' : '(TTS: + new, · cached)'}`);
  const ep: Episode = SCHEMAS.episode.parse({ id: epSpec.id, number: epSpec.number, title: epSpec.title, logline: epSpec.logline, synopsis: epSpec.synopsis, theme: epSpec.theme, arc: epSpec.arc, status: 'wip' });
  const cueIds: string[] = [];
  let total = 0;
  for (const [i, scSpec] of epSpec.scenes.entries()) {
    const sc: Scene = SCHEMAS.scene.parse({ id: `${ep.id}_sc${String(i + 1).padStart(2, '0')}`, title: scSpec.title, summary: scSpec.summary, environmentId: scSpec.env, status: 'wip', arc: scSpec.arc });
    let carry = 0;
    const starts: number[] = [];
    let t = 0;
    for (const shSpec of scSpec.shots) {
      const { shot, spill } = await buildShot(boards ? shSpec : { ...shSpec, board: undefined }, carry);
      shot.id = `sh${String(sc.shots.length + 1).padStart(2, '0')}`;
      carry = Math.max(spill, carry - shot.duration);
      starts.push(t);
      t += shot.duration;
      sc.shots.push(shot);
    }
    const scLen = t;
    total += scLen;
    for (const [k, m] of (scSpec.music ?? []).entries()) {
      const id = `cue_${sc.id}${k ? `_${String.fromCharCode(97 + k)}` : ''}`;
      const start = r3(starts[m.from ?? 0] + (m.at ?? 0));
      const end = (m.to === undefined || m.to >= starts.length ? scLen : starts[m.to]) + (m.tail ?? 0);
      const base = SCHEMAS.cue.parse({ id, seed: MOTIF, ...m.cue });
      data.cues[id] = { ...base, bars: Math.max(2, Math.ceil((end - start) / ((base.beatsPerBar * 60) / base.tempo)) + 1) };
      sc.tracks.score.push({ id: uid('scr'), start, duration: r3(end - start), cueId: id, offset: 0, gain: m.gain ?? 0.45 });
      cueIds.push(id);
    }
    ep.scenes.push(sc.id);
    data.scenes[sc.id] = { ...sc, episodeId: ep.id };
  }
  data.episodes[ep.id] = ep;
  console.log(`\n  ${ep.scenes.length} scenes, ${ep.scenes.reduce((n, s) => n + data.scenes[s].shots.length, 0)} shots, ${total.toFixed(1)}s`);
  return cueIds;
}

/** Rebuild one episode on top of the project already on disk. Does not touch the other episodes. */
async function writeEpisodes(only: string) {
  const epSpec = EPISODES.find((e) => e.id === only);
  if (!epSpec) throw new Error(`unknown episode ${only}`);
  const { data } = loadProject();
  if (!data.project.episodes.includes(epSpec.id)) data.project.episodes.push(epSpec.id);
  // drop the episode's old scenes and cues first
  for (const id of data.episodes[epSpec.id]?.scenes ?? []) {
    fs.rmSync(path.join(PROJECT_DIR, 'episodes', epSpec.id, 'scenes', `${id}.json`), { force: true });
    delete data.scenes[id];
  }
  for (const id of Object.keys(data.cues).filter((c) => c.startsWith(`cue_${epSpec.id}`))) {
    fs.rmSync(path.join(PROJECT_DIR, 'score', `${id}.json`), { force: true });
    delete data.cues[id];
  }
  const boards = fs.existsSync(path.join(PROJECT_DIR, 'media/boards/hero_banner.png'));
  const cueIds = await buildEpisode(epSpec, data, boards);
  const ep = data.episodes[epSpec.id];
  saveDoc({ kind: 'project', id: 'project' }, data.project);
  saveDoc({ kind: 'episode', id: ep.id }, ep);
  for (const id of ep.scenes) saveDoc({ kind: 'scene', id, episodeId: ep.id }, data.scenes[id]);
  for (const id of cueIds) saveDoc({ kind: 'cue', id }, data.cues[id]);
  console.log('\n✓ episode written');
}

async function main() {
  if (ONLY) {
    await writeEpisodes(ONLY);
    return;
  }
  console.log('→ generating characters, sets and SFX');
  genCharacters();
  genExtras();
  genV3World();
  genSfx();
  genStorySfx();
  // treatments are hand-edited (chosen look, boards): keep them, and only add style-board entries that are missing
  const kept = loadProject().data.treatments;
  // project/archive/, media/boards uploads and treatments/ are never wiped
  for (const dir of ['episodes', 'characters', 'environments', 'assets', 'score', 'credits', 'media/audio/dialog', 'media/audio/score'])
    fs.rmSync(path.join(PROJECT_DIR, dir), { recursive: true, force: true });
  // drop documentary-only placeholder meshes
  for (const f of ['network_sphere', 'gold_bar', 'coin', 'grid_floor']) fs.rmSync(path.join(PROJECT_DIR, `media/meshes/${f}.glb`), { force: true });
  fs.rmSync(path.join(PROJECT_DIR, 'media/textures/grid.png'), { force: true });
  const boards = cropSheet();

  const data: ProjectData = {
    project: SCHEMAS.project.parse({ title: 'Sati', season: SEASON, fps: 24, resolution: [1920, 1080], episodes: EPISODES.map((e) => e.id), tts: { engine: 'mlx', defaultVoice: 'am_adam' } }),
    episodes: {}, scenes: {}, characters, environments, assets, cues: {}, credits: {}, treatments: {},
  };

  const cueFor = (id: string, spec: Partial<ScoreCue> & { seed: number; name: string }, seconds: number) => {
    const base = SCHEMAS.cue.parse({ id, ...spec });
    const cue: ScoreCue = { ...base, bars: Math.max(2, Math.ceil(seconds / ((base.beatsPerBar * 60) / base.tempo))) };
    data.cues[id] = cue;
    return cue;
  };

  for (const epSpec of EPISODES) await buildEpisode(epSpec, data, boards);

  // global intro / outro credits (shared by every episode)
  // intro: the season motif, bright and quick: sparse pad + arp bar, then bass/drums, the melody on bar 3
  const introCue = cueFor('cue_intro', { name: 'Intro theme', seed: MOTIF, key: 'C', mode: 'lydian', tempo: 132, density: 0.85,
    notes: 'The season motif, upbeat. 6 bars @132 ≈ 10.9s.', instruments: {
    pad: { on: true, enter: 0, gain: 0.5 }, bass: { on: true, enter: 0.17, gain: 0.7 }, arp: { on: true, enter: 0, gain: 0.4 }, lead: { on: true, enter: 0.34, gain: 0.5 }, perc: { on: true, enter: 0.17, gain: 0.45 } } }, 10.5);
  // outro: the motif again, warm and slow, under the roll
  const outroCue = cueFor('cue_outro', { name: 'Outro theme', seed: MOTIF, key: 'C', mode: 'major', tempo: 84, density: 0.5,
    notes: 'The season motif, warm and lyrical, soft pulse under the roll.', instruments: {
    pad: { on: true, enter: 0, gain: 0.55 }, bass: { on: true, enter: 0.17, gain: 0.65 }, arp: { on: true, enter: 0, gain: 0.35 }, lead: { on: true, enter: 0.34, gain: 0.45 }, perc: { on: true, enter: 0.17, gain: 0.3 } } }, 16);
  data.credits.intro = SCHEMAS.credits.parse({
    id: 'intro', name: 'Intro', duration: 10.5, fade: 0.6, background: '#000000', color: '#ffffff',
    cards: [
      { id: 'title', start: 0.3, duration: 3.3, lines: [{ text: '{project}', size: 'xl' }, { text: 'Sati · Bit', size: 'sm' }] },
      { id: 'season', start: 3.8, duration: 2.9, lines: [{ text: '{season}', size: 'md' }] },
      { id: 'episode', start: 6.9, duration: 3.4, lines: [{ text: 'Episode {episode.number}', size: 'sm' }, { text: '{episode.title}', size: 'lg' }] },
    ],
    music: { cueId: introCue.id, gain: 0.55 },
  });
  data.credits.outro = SCHEMAS.credits.parse({
    id: 'outro', name: 'Outro', duration: 16, fade: 0.8, background: '#000000', color: '#ffffff',
    roll: { start: 0.4, duration: 11.5, sections: [
      { heading: 'Starring', names: ['Sati', 'Bit', 'Ana'] },
      { heading: 'The crew', names: ['The Node', 'Validator', 'Gossip', 'Hasher', 'Mempool Host', 'Script Clerk'] },
      { heading: 'And', names: ['The Coinbase', 'Pip', 'The Rewriter'] },
      { heading: 'Written & directed by', names: ['Your name here'] },
      { heading: 'Voices', names: ['Kokoro TTS'] },
      { heading: 'Music', names: [`Deterministic score — season motif, seed ${MOTIF}`] },
      { heading: 'Previz', names: ['Film Maker · three.js · Blender'] },
    ] },
    cards: [{ id: 'end', start: 12.2, duration: 3.6, lines: [{ text: '{project}', size: 'xl' }, { text: 'Thanks for watching', size: 'sm' }] }],
    music: { cueId: outroCue.id, gain: 0.5 },
  });

  for (const t of STYLE_BOARD) data.treatments[t.id] = SCHEMAS.treatment.parse(t);
  Object.assign(data.treatments, kept);

  saveAll(data);
  console.log('\n✓ project written');
}

const isDirect = process.argv[1]?.includes('seed-story');
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
