/**
 * Builds the two test episodes from the Anatomy of Bitcoin scripts in ../scenes
 * (Prologue + The Network), with storyboards from ../assets/boards, narrator
 * audio from TTS, placeholder meshes/SFX and a deterministic score per episode.
 *
 *   npm run import:aob            (overwrites project/)
 *   npm run import:aob -- --no-tts  (estimate timings instead of generating audio)
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  Asset, CameraClip, Character, DialogClip, Environment, Episode, ProjectData, Scene, ScoreCue, SfxClip, Shot, StoryboardClip, Vec3,
} from '../src/model/schema';
import { SCHEMAS, Shot as ShotSchema } from '../src/model/schema';
import { estimateSpeech } from '../src/model/timeline';
import { PROJECT_DIR, ROOT, saveAll } from '../server/projectFs';
import { synthesize } from '../server/tts';
import { genMeshes, genSfx } from './gen-assets';
import { cam } from './lib/camera';

const REPO = path.resolve(ROOT, '..');
const NO_TTS = process.argv.includes('--no-tts');

type Entry = { section?: string; duration?: number; vo?: string; visual?: string; board?: string; [k: string]: unknown };
const script = (f: string): Entry[] => JSON.parse(fs.readFileSync(path.join(REPO, 'scenes', f), 'utf8'));

// ------------------------------------------------------------------ helpers

const clean = (s = '') => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
/** first sentences, ~12–30 words, to keep the test episodes short */
function trimVo(vo: string) {
  const sentences = clean(vo).match(/[^.!?]+[.!?]+["”]?/g) ?? [clean(vo)];
  let out = '';
  for (const s of sentences) {
    out = (out + ' ' + s.trim()).trim();
    if (out.split(' ').length >= 12) break;
  }
  return out;
}
const notesOf = (e: Entry) =>
  Object.entries(e)
    .filter(([k]) => k.startsWith('technicalNotes'))
    .map(([, v]) => clean(String(v)))
    .join('\n');

function copyBoard(board?: string): string | undefined {
  if (!board) return undefined;
  const name = board.trim().split('/').pop()!;
  const src = path.join(REPO, 'assets/boards', name);
  if (!fs.existsSync(src)) return undefined;
  const rel = `media/boards/${name}`;
  fs.mkdirSync(path.join(PROJECT_DIR, 'media/boards'), { recursive: true });
  fs.copyFileSync(src, path.join(PROJECT_DIR, rel));
  return rel;
}

let counter = 0;
const id = (p: string) => `${p}_${String(++counter).padStart(3, '0')}`;

interface ShotSpec {
  name: string;
  entry?: Entry;
  lines?: { character: string; text: string }[];
  /** when the first dialog line starts (default 0.5s) */
  dialogAt?: number;
  /** minimum duration when there is no or little dialog */
  min?: number;
  camera: (d: number) => CameraClip;
  sfx?: { file: string; at: number | 'end'; gain?: number }[];
  subtitle?: string;
  env?: string;
  characters?: string[];
  assets?: string[];
  status?: Shot['status'];
  board?: string;
}

async function buildShot(spec: ShotSpec, characters: Record<string, Character>): Promise<Shot> {
  const e = spec.entry ?? {};
  const lines = spec.lines ?? (e.vo && clean(e.vo) ? [{ character: 'narrator', text: trimVo(e.vo) }] : []);
  const dialog: DialogClip[] = [];
  let t = spec.dialogAt ?? 0.5;
  for (const l of lines) {
    const ch = characters[l.character];
    let duration = estimateSpeech(l.text);
    let audio: string | undefined;
    let audioHash: string | undefined;
    if (!NO_TTS) {
      const r = await synthesize({ text: l.text, voice: ch.voice, tune: ch.voiceTune });
      duration = r.duration;
      audio = r.audio;
      audioHash = r.audioHash;
      process.stdout.write(r.cached ? '·' : `+`);
    }
    dialog.push({ id: id('dlg'), start: t, duration, characterId: l.character, text: l.text, audio, audioHash, subtitle: true, gain: 1 });
    t += duration + 0.35;
  }
  const duration = Math.ceil(Math.max(spec.min ?? 4, t + 0.6) * 2) / 2; // round up to 0.5s
  const image = copyBoard(spec.board ?? (e.board as string | undefined));
  const storyboard: StoryboardClip[] = image ? [{ id: id('brd'), start: 0, duration, image }] : [];
  const sfx: SfxClip[] = (spec.sfx ?? []).map((s) => {
    const len = { whoosh: 1.6, blip: 0.25, ping: 1.4, impact: 1.8, hum: 4, click: 0.08, coin_drop: 1.2 }[s.file] ?? 1;
    const start = s.at === 'end' ? Math.max(0, duration - len * 0.6) : s.at;
    return { id: id('sfx'), start, duration: len, file: `media/audio/sfx/${s.file}.wav`, gain: s.gain ?? 0.7 };
  });
  return ShotSchema.parse({
    id: id('sh'),
    name: spec.name,
    duration,
    status: spec.status ?? (image ? 'wip' : 'todo'),
    description: clean(e.visual as string | undefined),
    notes: [notesOf(e), e.vo && trimVo(e.vo) !== clean(e.vo) ? `Full VO: ${clean(e.vo)}` : ''].filter(Boolean).join('\n\n'),
    environmentId: spec.env,
    characters: spec.characters ?? [],
    assets: spec.assets ?? [],
    tracks: {
      storyboard,
      camera: [spec.camera(duration)],
      subtitles: spec.subtitle ? [{ id: id('sub'), start: 0.3, duration: Math.max(1, (spec.dialogAt ?? 0.5) - 0.5), text: spec.subtitle }] : [],
      dialog,
      sfx,
      score: [],
    },
  });
}

// ------------------------------------------------------------------ libraries

const characters: Record<string, Character> = Object.fromEntries(
  [
    { id: 'narrator', name: 'Narrator', role: 'Voice over', description: 'Calm, precise documentary narrator.', voice: 'en_US-lessac-medium', color: '#a8875a' },
    { id: 'hal', name: 'Hal', role: 'Early node operator', description: 'Runs one of the first bitcoin nodes. Appears as a voice from a node.', voice: 'en_GB-alan-medium', color: '#6f93a8' },
  ].map((c) => [c.id, SCHEMAS.character.parse(c)]),
);

const assets: Record<string, Asset> = Object.fromEntries(
  [
    { id: 'node_box', name: 'Bitcoin Node', kind: 'prop', mesh: 'media/meshes/node_box.glb', description: 'Small glowing white rectangle with UI-like elements.', color: '#e8ecff', tags: ['network'] },
    { id: 'network_sphere', name: 'Network Sphere', kind: 'set', mesh: 'media/meshes/network_sphere.glb', description: 'Peers on a sphere joined by links.', color: '#f7931a', tags: ['network'] },
    { id: 'gold_bar', name: 'Gold Bar', kind: 'prop', mesh: 'media/meshes/gold_bar.glb', description: 'Trapezoid gold ingot.', color: '#ffc254', tags: ['money'] },
    { id: 'coin', name: 'Coin', kind: 'prop', mesh: 'media/meshes/coin.glb', description: 'Generic orange coin.', color: '#f7931a', tags: ['money'] },
    { id: 'grid_floor', name: 'Grid Floor', kind: 'set', mesh: 'media/meshes/grid_floor.glb', description: 'Ground plane with a procedural grid texture (texture round-trip test).', color: '#f7931a', textures: { baseColor: 'media/textures/grid.png' }, tags: ['ground'] },
  ].map((a) => [a.id, SCHEMAS.asset.parse(a)]),
);

const environments: Record<string, Environment> = Object.fromEntries(
  [
    { id: 'void', name: 'Void', description: 'Pure black. Titles and quotes.', background: '#000000', lighting: { ambient: 0.2, key: 0.6 } },
    {
      id: 'earth_orbit', name: 'Earth Orbit', description: 'Dark space with the network sphere standing in for the globe.', background: '#03050c',
      fog: { color: '#03050c', near: 12, far: 40 },
      lighting: { ambient: 0.25, key: 1.4, keyColor: '#cfe0ff', keyPosition: [6, 4, 5] },
      props: [{ assetId: 'network_sphere', position: [0, 2.4, 0] }],
    },
    {
      id: 'gold_vault', name: 'Gold Vault', description: 'Warm vault with stacked gold.', background: '#120b04',
      fog: { color: '#120b04', near: 6, far: 22 },
      lighting: { ambient: 0.35, key: 1.6, keyColor: '#ffd9a0', keyPosition: [3, 5, 4] },
      props: [
        { assetId: 'grid_floor' },
        { assetId: 'gold_bar', position: [0, 0, 0] },
        { assetId: 'gold_bar', position: [1.3, 0, 0.2], rotationY: 8 },
        { assetId: 'gold_bar', position: [-1.3, 0, -0.1], rotationY: -6 },
        { assetId: 'gold_bar', position: [0.6, 0.35, 0.05], rotationY: 3 },
        { assetId: 'coin', position: [2.4, 0.03, 1.2], scale: 0.8 },
      ],
    },
    {
      id: 'node_network', name: 'Node Network', description: 'A single node in front of the peer network.', background: '#020308',
      fog: { color: '#020308', near: 8, far: 30 },
      lighting: { ambient: 0.2, key: 1.0, keyColor: '#ffffff', keyPosition: [2, 4, 6] },
      props: [
        { assetId: 'grid_floor', position: [0, -0.6, 0] },
        { assetId: 'node_box', position: [0, 0.6, 0] },
        { assetId: 'network_sphere', position: [0, 2.4, -7], scale: 1.4 },
      ],
      marks: [[-2.2, 0, -1.2]],
    },
  ].map((e) => [e.id, SCHEMAS.environment.parse(e)]),
);

// ------------------------------------------------------------------ episodes

const P = script('01_Prologue.json');
const N = script('02_The_Network.json');
const NODE: Vec3 = [0, 0.6, 0];
const EARTH: Vec3 = [0, 2.4, 0];
const VAULT: Vec3 = [0, 0.3, 0];

const EPISODES: { id: string; number: number; title: string; synopsis: string; cue: Partial<ScoreCue> & { seed: number }; scenes: { title: string; env: string; summary: string; shots: ShotSpec[] }[] }[] = [
  {
    id: 'ep01', number: 1, title: 'Prologue',
    synopsis: 'From the human search for money to gold, to Bitcoin: a decentralized, energy-anchored monetary network.',
    cue: { seed: 2009, key: 'D', mode: 'minor', tempo: 64, density: 0.35 },
    scenes: [
      {
        title: 'Opening', env: 'void', summary: 'Credits, the Satoshi quote and the title.',
        shots: [
          { name: 'Producer logos', entry: P[0], min: 4, camera: cam.still([0, 0, 6], [0, 0, 0]), sfx: [{ file: 'hum', at: 0, gain: 0.5 }] },
          { name: 'Quote', entry: P[1], min: 5, camera: cam.still([0, 0, 6], [0, 0, 0]), status: 'review' },
          { name: 'Title', entry: P[2], camera: cam.push([0, 0, 0], 8, 5, 0), subtitle: 'THE ANATOMY OF BITCOIN', dialogAt: 3.5, sfx: [{ file: 'impact', at: 0.2 }] },
        ],
      },
      {
        title: 'Search for Money', env: 'earth_orbit', summary: 'Earth from orbit, timelapse of human activity.',
        shots: [{ name: 'Earth timelapse', entry: P[3], camera: cam.orbit(EARTH, 9, 1, -20, 25), assets: [], sfx: [{ file: 'whoosh', at: 0 }] }],
      },
      {
        title: 'Reliance on Gold', env: 'gold_vault', summary: 'Gold as money and its physical constraints.',
        shots: [{ name: 'Gold stack', entry: P[4], camera: cam.orbit(VAULT, 4.5, 1.2, 30, -30, 35), sfx: [{ file: 'coin_drop', at: 1.0 }] }],
      },
      {
        title: 'Decentralization', env: 'earth_orbit', summary: 'The internet layer is revealed beneath the surface.',
        shots: [{ name: 'Internet layer', entry: P[5], camera: cam.pull(EARTH, 6, 12), sfx: [{ file: 'whoosh', at: 0 }] }],
      },
      {
        title: 'Stranded and Wasted Energy', env: 'earth_orbit', summary: 'Energy leaks and how mining captures them.',
        shots: [
          { name: 'Energy leaks', entry: P[7], camera: cam.orbit(EARTH, 10, 3, 120, 160) },
          { name: 'Difficulty balance', entry: P[12], camera: cam.push(EARTH, 9, 7, 1) },
        ],
      },
      {
        title: 'Responsibility', env: 'void', summary: 'Each node keeps the system lean and balanced. Fade to black.',
        shots: [
          { name: 'Lean network', entry: P[16], env: 'earth_orbit', camera: cam.orbit(EARTH, 8, 0.5, 200, 230) },
          { name: 'Balanced incentives', entry: P[17], env: 'earth_orbit', camera: cam.push(EARTH, 10, 4, 0.2, 30) },
          { name: 'Fade to black', entry: P[18], min: 3, camera: cam.still([0, 0, 6], [0, 0, 0]) },
        ],
      },
    ],
  },
  {
    id: 'ep02', number: 2, title: 'The Network',
    synopsis: 'A node comes online, finds peers, shakes hands and joins the peer-to-peer network that validates bitcoin.',
    cue: { seed: 8333, key: 'A', mode: 'dorian', tempo: 84, density: 0.6, instruments: {
      pad: { on: true, enter: 0, gain: 0.5 }, bass: { on: true, enter: 0.15, gain: 0.65 }, arp: { on: true, enter: 0.05, gain: 0.35 },
      lead: { on: true, enter: 0.55, gain: 0.35 }, perc: { on: true, enter: 0.3, gain: 0.35 } } },
    scenes: [
      {
        title: 'Network Origin', env: 'node_network', summary: 'A single node pops up and looks for peers.',
        shots: [
          { name: 'Node comes online', entry: N[0], characters: ['hal'], camera: cam.push(NODE, 5, 2.6, 0.2),
            lines: [{ character: 'hal', text: 'Running bitcoin.' }, { character: 'narrator', text: clean(N[0].vo) }], sfx: [{ file: 'ping', at: 0.3 }] },
          { name: 'TCP port 8333', entry: N[1], camera: cam.still([1.2, 0.9, 2.4], NODE, 35), sfx: [{ file: 'blip', at: 1 }, { file: 'blip', at: 1.4 }] },
          { name: 'IRC bootstrap', entry: N[2], camera: cam.pull(NODE, 3, 7) },
          { name: 'DNS seeds', entry: N[3], camera: cam.orbit(NODE, 3.5, 0.6, -25, 15), sfx: [{ file: 'click', at: 1.2 }, { file: 'click', at: 1.5 }, { file: 'click', at: 1.8 }] },
        ],
      },
      {
        title: 'Connected Node', env: 'node_network', summary: 'Handshake: version messages, validation, rejection.',
        shots: [
          { name: 'Handshake', entry: N[4], camera: cam.pull(NODE, 3, 9, 50), sfx: [{ file: 'whoosh', at: 0.2 }] },
          { name: 'Version message', entry: N[5], camera: cam.still([0.6, 0.8, 2], NODE, 30), sfx: [{ file: 'blip', at: 0.8 }] },
          { name: 'Rejected connection', entry: N[6], camera: cam.orbit(NODE, 4, 0.8, 40, 70), sfx: [{ file: 'impact', at: 1.2, gain: 0.5 }] },
          { name: 'Geography is irrelevant', entry: N[8], env: 'earth_orbit', camera: cam.pull(EARTH, 7, 13) },
        ],
      },
      {
        title: 'Role of Nodes', env: 'earth_orbit', summary: 'Nodes as validators; some do more.',
        shots: [
          { name: 'Backbone', entry: N[9], camera: cam.orbit(EARTH, 9, 1.5, 0, 40) },
          { name: 'Same rules', entry: N[10], camera: cam.orbit(EARTH, 9, 1.5, 40, 70) },
        ],
      },
      {
        title: 'Peer-2-Peer Network', env: 'node_network', summary: 'Direct connections, full nodes, wallets.',
        shots: [
          { name: 'No middle-men', entry: N[11], camera: cam.push(NODE, 6, 3.5, 0.5), sfx: [{ file: 'ping', at: 0.5 }] },
          { name: 'Full nodes', entry: N[12], env: 'earth_orbit', camera: cam.orbit(EARTH, 7, 0.5, 100, 130) },
          { name: 'Wallets connect', entry: N[14], camera: cam.orbit(NODE, 4.5, 1, -40, 0), sfx: [{ file: 'coin_drop', at: 'end', gain: 0.5 }] },
        ],
      },
    ],
  },
];

// ------------------------------------------------------------------ build

async function main() {
  console.log('→ generating meshes, textures and SFX');
  genMeshes();
  genSfx();

  for (const dir of ['episodes', 'characters', 'environments', 'assets', 'score']) fs.rmSync(path.join(PROJECT_DIR, dir), { recursive: true, force: true });

  const data: ProjectData = {
    project: SCHEMAS.project.parse({ title: 'The Anatomy of Bitcoin', fps: 24, resolution: [1920, 1080], episodes: EPISODES.map((e) => e.id) }),
    episodes: {}, scenes: {}, characters, environments, assets, cues: {}, credits: {}, treatments: {},
  };

  for (const epSpec of EPISODES) {
    console.log(`\n→ ${epSpec.id} ${epSpec.title} ${NO_TTS ? '(no TTS)' : '(TTS: + new, · cached)'}`);
    const ep: Episode = SCHEMAS.episode.parse({ id: epSpec.id, number: epSpec.number, title: epSpec.title, synopsis: epSpec.synopsis, status: 'wip' });
    let total = 0;
    for (const [i, scSpec] of epSpec.scenes.entries()) {
      const sc: Scene = SCHEMAS.scene.parse({
        id: `${epSpec.id}_sc${String(i + 1).padStart(2, '0')}`,
        title: scSpec.title, summary: scSpec.summary, environmentId: scSpec.env, status: 'wip',
      });
      for (const shSpec of scSpec.shots) {
        const shot = await buildShot(shSpec, characters);
        shot.id = `sh${String(sc.shots.length + 1).padStart(2, '0')}`;
        sc.shots.push(shot);
        total += shot.duration;
      }
      ep.scenes.push(sc.id);
      data.scenes[sc.id] = { ...sc, episodeId: ep.id };
    }
    // score cue long enough for the whole episode, owned by the episode
    const cueBase = SCHEMAS.cue.parse({ id: `cue_${epSpec.id}`, name: `${epSpec.title} — main theme`, ...epSpec.cue });
    const barLen = (cueBase.beatsPerBar * 60) / cueBase.tempo;
    const cue = { ...cueBase, bars: Math.ceil(total / barLen) };
    data.cues[cue.id] = cue;
    ep.tracks.score.push({ id: id('scr'), start: 0, duration: total, cueId: cue.id, offset: 0, gain: 0.55 });
    data.episodes[ep.id] = ep;
    console.log(`\n  ${ep.scenes.length} scenes, ${total.toFixed(1)}s`);
  }

  saveAll(data);
  console.log('\n✓ project written to', path.relative(process.cwd(), PROJECT_DIR) || PROJECT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
