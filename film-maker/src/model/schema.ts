/**
 * Film Maker data model — the single source of truth.
 *
 * Everything on disk under `project/` is validated against these schemas.
 * Times are always in SECONDS and relative to the owner (episode, scene or shot).
 * 3D space is Y-up, metres (three.js / glTF convention). The Blender importer
 * converts to Z-up.
 */
import { z } from 'zod';

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const Status = z.enum(['todo', 'wip', 'review', 'done']);

/** Story-structure beats, in narrative order */
export const BEATS = ['setup', 'inciting', 'rising', 'midpoint', 'crisis', 'climax', 'resolution'] as const;
export const Beat = z.enum(BEATS);
export type Beat = z.infer<typeof Beat>;

export const Arc = z.object({
  /** 0 = calm, 1 = peak tension/stakes */
  tension: z.number().min(0).max(1).default(0.5),
  beat: Beat.optional(),
  note: z.string().default(''),
});
export type Arc = z.infer<typeof Arc>;
export type Status = z.infer<typeof Status>;

// ---------------------------------------------------------------- clips

const ClipBase = {
  id: z.string(),
  start: z.number().min(0).default(0),
  duration: z.number().positive(),
  label: z.string().optional(),
};

export const CameraKey = z.object({
  t: z.number().min(0), // seconds from clip start
  position: Vec3,
  target: Vec3,
  fov: z.number().min(5).max(150).default(40), // vertical degrees
});
export type CameraKey = z.infer<typeof CameraKey>;

export const StoryboardClip = z.object({ ...ClipBase, image: z.string() });
export const CameraClip = z.object({
  ...ClipBase,
  ease: z.enum(['linear', 'smooth']).default('smooth'),
  keys: z.array(CameraKey).min(1),
});
export const SubtitleClip = z.object({ ...ClipBase, text: z.string() });
export const DialogClip = z.object({
  ...ClipBase,
  characterId: z.string(),
  text: z.string(),
  /** media path of generated audio (relative to project/), set by TTS */
  audio: z.string().optional(),
  /** hash of voice+text the audio was generated from; stale when it differs */
  audioHash: z.string().optional(),
  /** show this line on the subtitle track */
  subtitle: z.boolean().default(true),
  gain: z.number().default(1),
});
export const SfxClip = z.object({ ...ClipBase, file: z.string(), gain: z.number().default(0.8) });
export const ScoreClip = z.object({
  ...ClipBase,
  cueId: z.string(),
  /** seconds into the cue where this clip starts playing */
  offset: z.number().min(0).default(0),
  gain: z.number().default(0.7),
});

export type StoryboardClip = z.infer<typeof StoryboardClip>;
export type CameraClip = z.infer<typeof CameraClip>;
export type SubtitleClip = z.infer<typeof SubtitleClip>;
export type DialogClip = z.infer<typeof DialogClip>;
export type SfxClip = z.infer<typeof SfxClip>;
export type ScoreClip = z.infer<typeof ScoreClip>;

export const TRACK_KINDS = ['storyboard', 'camera', 'subtitles', 'dialog', 'sfx', 'score'] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export const Tracks = z.object({
  storyboard: z.array(StoryboardClip).default([]),
  camera: z.array(CameraClip).default([]),
  subtitles: z.array(SubtitleClip).default([]),
  dialog: z.array(DialogClip).default([]),
  sfx: z.array(SfxClip).default([]),
  score: z.array(ScoreClip).default([]),
});
export type Tracks = z.infer<typeof Tracks>;
export type AnyClip = Tracks[TrackKind][number];
export interface ClipOf {
  storyboard: StoryboardClip;
  camera: CameraClip;
  subtitles: SubtitleClip;
  dialog: DialogClip;
  sfx: SfxClip;
  score: ScoreClip;
}

const emptyTracks = () => Tracks.parse({});

// ---------------------------------------------------------------- structure

/** A character's facial expression (drives eyes, brows and mouth in the preview). */
export const EXPRESSIONS = ['neutral', 'happy', 'grin', 'laugh', 'smirk', 'tongue', 'ooh', 'surprised', 'shout', 'grimace', 'pout', 'worried', 'determined', 'sad'] as const;
export const Expression = z.enum(EXPRESSIONS);
export type Expression = z.infer<typeof Expression>;
export const ExpressionKey = z.object({ t: z.number().min(0), expression: Expression });
export type ExpressionKey = z.infer<typeof ExpressionKey>;

/** A body pose (arms, legs, lean) held from `t` until the next key; blends in over ~0.35s. */
export const POSES = ['idle', 'wave', 'point', 'cheer', 'think', 'shrug', 'reach', 'lift', 'crouch', 'arms_crossed'] as const;
export const Pose = z.enum(POSES);
export type Pose = z.infer<typeof Pose>;
export const PoseKey = z.object({ t: z.number().min(0), pose: Pose });
export type PoseKey = z.infer<typeof PoseKey>;

/** Where a character stands at the start of a shot; `moves` walks them to new marks (shot-local seconds, eased). */
export const MoveKey = z.object({ t: z.number().min(0), position: Vec3, rotationY: z.number().optional() });
export type MoveKey = z.infer<typeof MoveKey>;
export const Blocking = z.object({ position: Vec3, rotationY: z.number().default(0), moves: z.array(MoveKey).optional() });
export type Blocking = z.infer<typeof Blocking>;

export const Shot = z.object({
  id: z.string(),
  name: z.string(),
  duration: z.number().positive(),
  status: Status.default('todo'),
  /** what we see (the "visual" column of the script) */
  description: z.string().default(''),
  /** technical / research notes */
  notes: z.string().default(''),
  environmentId: z.string().optional(),
  characters: z.array(z.string()).default([]),
  /** asset ids placed in this shot on top of the environment's props */
  assets: z.array(z.string()).default([]),
  /** optional finer point on the story arc (0..1); scenes provide the coarse curve */
  tension: z.number().min(0).max(1).optional(),
  /** per-shot blocking: where each character stands (falls back to environment marks), and how they move */
  positions: z.record(z.string(), Blocking).optional(),
  /** facial expression changes per character, keyed at shot-local seconds */
  expressions: z.record(z.string(), z.array(ExpressionKey)).optional(),
  /** body poses per character, keyed at shot-local seconds (walking and talking animate on top) */
  poses: z.record(z.string(), z.array(PoseKey)).optional(),
  tracks: Tracks.default(emptyTracks),
});
export type Shot = z.infer<typeof Shot>;

export const Scene = z.object({
  id: z.string(),
  title: z.string(),
  status: Status.default('todo'),
  summary: z.string().default(''),
  environmentId: z.string().optional(),
  arc: Arc.default({ tension: 0.5, note: '' }),
  shots: z.array(Shot).default([]),
  /** scene-level tracks (e.g. a score cue spanning the scene) */
  tracks: Tracks.default(emptyTracks),
});
export type Scene = z.infer<typeof Scene>;

export const Episode = z.object({
  id: z.string(),
  number: z.number().int().default(1),
  title: z.string(),
  status: Status.default('todo'),
  synopsis: z.string().default(''),
  /** what the episode is about underneath the plot */
  theme: z.string().default(''),
  /** the episode's role in the season arc */
  arc: Arc.default({ tension: 0.5, note: '' }),
  /** play the global intro/outro credits on this episode */
  credits: z.object({ intro: z.boolean().default(true), outro: z.boolean().default(true) }).default({ intro: true, outro: true }),
  /** ordered scene ids; scene files live in episodes/<id>/scenes/<sceneId>.json */
  scenes: z.array(z.string()).default([]),
  tracks: Tracks.default(emptyTracks),
});
export type Episode = z.infer<typeof Episode>;

export const Project = z.object({
  title: z.string(),
  fps: z.number().int().positive().default(24),
  resolution: z.tuple([z.number().int(), z.number().int()]).default([1920, 1080]),
  /** ordered episode ids */
  episodes: z.array(z.string()).default([]),
  season: z.object({ title: z.string().default(''), logline: z.string().default('') }).default({ title: '', logline: '' }),
  tts: z
    .object({
      engine: z.enum(['piper', 'say']).default('piper'),
      defaultVoice: z.string().default('en_US-lessac-medium'),
    })
    .default({ engine: 'piper', defaultVoice: 'en_US-lessac-medium' }),
});
export type Project = z.infer<typeof Project>;

// ---------------------------------------------------------------- libraries

export const Textures = z.object({
  baseColor: z.string().optional(),
  normal: z.string().optional(),
  roughness: z.string().optional(),
  metallic: z.string().optional(),
  emissive: z.string().optional(),
});

const LibraryBase = {
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  /** reference images (paths relative to project/) */
  refs: z.array(z.string()).default([]),
  /** glTF 2.0 binary (.glb), relative to project/ — imports into three.js and Blender */
  mesh: z.string().optional(),
  textures: Textures.default({}),
  scale: z.number().positive().default(1),
  color: z.string().default('#8aa4ff'),
};

export const Character = z.object({
  ...LibraryBase,
  /** piper voice id, or a macOS `say` voice name when engine = say */
  voice: z.string().optional(),
  /** voice character: pitch in semitones, speed multiplier (applied after TTS) */
  voiceTune: z.object({ pitch: z.number().min(-12).max(12).default(0), speed: z.number().min(0.5).max(2).default(1) }).default({ pitch: 0, speed: 1 }),
  role: z.string().default(''),
});
export type Character = z.infer<typeof Character>;

export const Asset = z.object({
  ...LibraryBase,
  kind: z.enum(['prop', 'set', 'fx', 'vehicle', 'other']).default('prop'),
});
export type Asset = z.infer<typeof Asset>;

export const Placement = z.object({
  assetId: z.string(),
  position: Vec3.default([0, 0, 0]),
  rotationY: z.number().default(0), // degrees
  scale: z.number().positive().default(1),
});
export type Placement = z.infer<typeof Placement>;

export const Environment = z.object({
  ...LibraryBase,
  background: z.string().default('#05060a'),
  fog: z.object({ color: z.string(), near: z.number(), far: z.number() }).optional(),
  lighting: z
    .object({
      ambient: z.number().default(0.3),
      key: z.number().default(1.2),
      keyColor: z.string().default('#ffffff'),
      keyPosition: Vec3.default([4, 6, 3]),
    })
    .default({ ambient: 0.3, key: 1.2, keyColor: '#ffffff', keyPosition: [4, 6, 3] }),
  /** equirectangular Radiance .hdr (relative to project/): image-based lighting and, with hdriBackground, the visible sky */
  hdri: z.string().optional(),
  hdriIntensity: z.number().min(0).default(1),
  hdriBackground: z.boolean().default(true),
  /** degrees about Y */
  hdriRotation: z.number().default(0),
  /** preview post-processing: bloom on bright/emissive pixels, vignette, film grain (0..1) */
  post: z
    .object({ bloom: z.number().min(0).max(3).default(0.6), vignette: z.number().min(0).max(1).default(0.35), grain: z.number().min(0).max(1).default(0.04), exposure: z.number().positive().default(1) })
    .default({ bloom: 0.6, vignette: 0.35, grain: 0.04, exposure: 1 }),
  /** establishing camera for thumbnails and shots without a camera */
  preview: z.object({ position: Vec3, target: Vec3, fov: z.number().default(45) }).optional(),
  props: z.array(Placement).default([]),
  /** where characters stand by default, in order of the shot's character list */
  marks: z.array(Vec3).default([]),
});
export type Environment = z.infer<typeof Environment>;

// ---------------------------------------------------------------- score

export const INSTRUMENTS = ['pad', 'bass', 'arp', 'lead', 'perc'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const ScoreOverride = z.object({
  op: z.enum(['mute', 'transpose', 'gain']),
  instrument: z.enum(INSTRUMENTS).optional(),
  /** inclusive bar range, 0-based; omitted = whole cue */
  bars: z.tuple([z.number().int(), z.number().int()]).optional(),
  value: z.number().default(0),
});
export type ScoreOverride = z.infer<typeof ScoreOverride>;

export const ScoreCue = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.number().int(),
  key: z.enum(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']).default('D'),
  mode: z.enum(['major', 'minor', 'dorian', 'lydian', 'phrygian', 'mixolydian']).default('minor'),
  tempo: z.number().min(30).max(220).default(72),
  bars: z.number().int().min(1).max(256).default(16),
  beatsPerBar: z.number().int().min(2).max(7).default(4),
  /** 0..1 — how busy arp/lead/perc are */
  density: z.number().min(0).max(1).default(0.5),
  /** 0..1 — fraction of the cue at which each instrument enters (builds) */
  instruments: z
    .record(z.enum(INSTRUMENTS), z.object({ on: z.boolean(), enter: z.number().min(0).max(1), gain: z.number() }))
    .default({
      pad: { on: true, enter: 0, gain: 0.6 },
      bass: { on: true, enter: 0.25, gain: 0.7 },
      arp: { on: true, enter: 0.4, gain: 0.35 },
      lead: { on: true, enter: 0.6, gain: 0.4 },
      perc: { on: false, enter: 0.5, gain: 0.4 },
    }),
  overrides: z.array(ScoreOverride).default([]),
  /** when set, this rendered/edited file replaces the generated music (wav or mid) */
  replacement: z.string().optional(),
  notes: z.string().default(''),
});
export type ScoreCue = z.infer<typeof ScoreCue>;

// ---------------------------------------------------------------- credits

export const CREDIT_SIZES = ['xl', 'lg', 'md', 'sm'] as const;
export const CreditLine = z.object({ text: z.string(), size: z.enum(CREDIT_SIZES).default('md') });
export type CreditLine = z.infer<typeof CreditLine>;
export const CreditCard = z.object({
  id: z.string(),
  start: z.number().min(0).default(0),
  duration: z.number().positive().default(3),
  align: z.enum(['center', 'bottom-left', 'top']).default('center'),
  lines: z.array(CreditLine).default([]),
});
export type CreditCard = z.infer<typeof CreditCard>;
export const CreditSection = z.object({ heading: z.string(), names: z.array(z.string()).default([]) });
export type CreditSection = z.infer<typeof CreditSection>;

/**
 * Global intro/outro credits, shared by every episode. Text may use placeholders:
 * {project} {season} {episode.number} {episode.title} {episode.theme}
 */
export const Credits = z.object({
  id: z.enum(['intro', 'outro']),
  name: z.string(),
  enabled: z.boolean().default(true),
  duration: z.number().positive().default(6),
  background: z.string().default('#000000'),
  color: z.string().default('#ffffff'),
  /** fade in/out of each card, seconds */
  fade: z.number().min(0).max(3).default(0.6),
  cards: z.array(CreditCard).default([]),
  /** optional scrolling roll (typical for outros) */
  roll: z.object({ start: z.number().min(0).default(0), duration: z.number().positive().default(8), sections: z.array(CreditSection).default([]) }).optional(),
  music: z.object({ cueId: z.string().optional(), gain: z.number().default(0.6) }).default({ gain: 0.6 }),
});
export type Credits = z.infer<typeof Credits>;

// ---------------------------------------------------------------- treatments

/** A visual treatment: either a locked style-board reference, or a working plan forked from one. */
export const TREATMENTS_MEDIA = ['cinematic', 'cartoon', 'storybook', 'retro', 'anime', 'iconic', 'stopmotion', 'clay', 'animatic', 'geometric', 'collage', 'bw', 'custom'] as const;
export const TreatmentMedium = z.enum(TREATMENTS_MEDIA);
export type TreatmentMedium = z.infer<typeof TreatmentMedium>;

export const Treatment = z.object({
  id: z.string(),
  name: z.string(),
  status: Status.default('todo'),
  /** sort on the board */
  order: z.number().int().default(0),
  /** locked option from the style board; planning forks a copy */
  reference: z.boolean().default(false),
  /** the look the film is heading toward (one at a time) */
  chosen: z.boolean().default(false),
  medium: TreatmentMedium.default('custom'),
  /** short adjectives under the title */
  adjectives: z.array(z.string()).default([]),
  /** what the look is built from */
  principles: z.array(z.string()).default([]),
  palette: z.array(z.string()).default([]),
  /** notes per character id */
  characters: z.record(z.string(), z.string()).default({}),
  camera: z.string().default(''),
  light: z.string().default(''),
  line: z.string().default(''),
  materials: z.string().default(''),
  notes: z.string().default(''),
  /** reference sheet, relative to project/ */
  board: z.string().optional(),
});
export type Treatment = z.infer<typeof Treatment>;

// ---------------------------------------------------------------- bundle

/** Everything the app holds in memory. Scenes are keyed by id and know their episode. */
export interface ProjectData {
  project: Project;
  episodes: Record<string, Episode>;
  scenes: Record<string, Scene & { episodeId: string }>;
  characters: Record<string, Character>;
  environments: Record<string, Environment>;
  assets: Record<string, Asset>;
  cues: Record<string, ScoreCue>;
  credits: Record<string, Credits>;
  treatments: Record<string, Treatment>;
}

export type DocKind = 'project' | 'episode' | 'scene' | 'character' | 'environment' | 'asset' | 'cue' | 'credits' | 'treatment';

export const SCHEMAS = {
  project: Project,
  episode: Episode,
  scene: Scene,
  character: Character,
  environment: Environment,
  asset: Asset,
  cue: ScoreCue,
  credits: Credits,
  treatment: Treatment,
} as const;
