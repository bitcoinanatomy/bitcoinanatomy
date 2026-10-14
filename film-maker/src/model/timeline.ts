/**
 * Timeline resolution: shots are laid end to end inside scenes, scenes end to end
 * inside an episode. Clips can be owned by a shot, a scene or an episode; this
 * module flattens them into absolute times for a given scope (episode/scene/shot).
 */
import type { AnyClip, CameraClip, CameraKey, Credits, Environment, Expression, ExpressionKey, MoveKey, Pose, PoseKey, ProjectData, Scene, ScoreClip, Shot, TrackKind, Tracks, Vec3 } from './schema';
import { TRACK_KINDS } from './schema';

export type Owner =
  | { kind: 'episode'; episodeId: string }
  | { kind: 'scene'; episodeId: string; sceneId: string }
  | { kind: 'shot'; episodeId: string; sceneId: string; shotId: string };

export type Scope = Owner;

export interface ShotSpan {
  sceneId: string;
  shot: Shot;
  index: number; // index within the scene
  start: number; // absolute (relative to scope start)
  end: number;
}
export interface SceneSpan {
  scene: Scene;
  start: number;
  end: number;
}
export interface ResolvedClip {
  track: TrackKind;
  clip: AnyClip;
  owner: Owner;
  /** absolute start of the owner (relative to scope start) */
  ownerStart: number;
  start: number;
  end: number;
  /** derived (read-only) clip, e.g. a subtitle generated from a dialog line */
  derived?: boolean;
  /** belongs to the global intro/outro credits (edit on the Credits page) */
  credits?: 'intro' | 'outro';
}
export interface CreditSpan {
  kind: 'intro' | 'outro';
  credits: Credits;
  start: number;
  end: number;
}
export interface ResolvedTimeline {
  scope: Scope;
  duration: number;
  scenes: SceneSpan[];
  shots: ShotSpan[];
  clips: ResolvedClip[];
  credits: CreditSpan[];
}

export const sceneDuration = (scene: Scene) => scene.shots.reduce((s, sh) => s + sh.duration, 0);

export function episodeScenes(data: ProjectData, episodeId: string): Scene[] {
  const ep = data.episodes[episodeId];
  if (!ep) return [];
  return ep.scenes.map((id) => data.scenes[id]).filter(Boolean);
}

/** The global intro/outro that play on this episode (enabled globally and not switched off per episode). */
export function episodeCredits(data: ProjectData, episodeId: string) {
  const ep = data.episodes[episodeId];
  const pick = (k: 'intro' | 'outro') => {
    const c = data.credits?.[k];
    return c && c.enabled && ep?.credits[k] ? c : undefined;
  };
  return { intro: pick('intro'), outro: pick('outro') };
}

/** Runtime of an episode including its credits. */
export function episodeDuration(data: ProjectData, episodeId: string): number {
  const { intro, outro } = episodeCredits(data, episodeId);
  return episodeScenes(data, episodeId).reduce((s, sc) => s + sceneDuration(sc), 0) + (intro?.duration ?? 0) + (outro?.duration ?? 0);
}

export const ownerKey = (o: Owner) =>
  o.kind === 'episode' ? `ep:${o.episodeId}` : o.kind === 'scene' ? `sc:${o.sceneId}` : `sh:${o.sceneId}/${o.shotId}`;

export function getOwnerTracks(data: ProjectData, o: Owner): Tracks | undefined {
  if (o.kind === 'episode') return data.episodes[o.episodeId]?.tracks;
  const sc = data.scenes[o.sceneId];
  if (!sc) return undefined;
  if (o.kind === 'scene') return sc.tracks;
  return sc.shots.find((s) => s.id === o.shotId)?.tracks;
}

/** Lay out the whole episode, then cut out the window belonging to `scope`. */
export function resolveTimeline(data: ProjectData, scope: Scope): ResolvedTimeline {
  const epId = scope.episodeId;
  const ep = data.episodes[epId];
  const scenes: SceneSpan[] = [];
  const shots: ShotSpan[] = [];
  const clips: ResolvedClip[] = [];

  const push = (tracks: Tracks, owner: Owner, ownerStart: number) => {
    for (const track of TRACK_KINDS) {
      for (const clip of tracks[track] as AnyClip[]) {
        const start = ownerStart + clip.start;
        clips.push({ track, clip, owner, ownerStart, start, end: start + clip.duration });
        if (track === 'dialog' && (clip as { subtitle?: boolean }).subtitle) {
          clips.push({ track: 'subtitles', clip, owner, ownerStart, start, end: start + clip.duration, derived: true });
        }
      }
    }
  };

  const credits: CreditSpan[] = [];
  const { intro, outro } = episodeCredits(data, epId);
  const creditMusic = (kind: 'intro' | 'outro', c: Credits, at: number) => {
    if (!c.music.cueId) return;
    const clip: ScoreClip = { id: `credits_${kind}`, start: 0, duration: c.duration, cueId: c.music.cueId, offset: 0, gain: c.music.gain };
    clips.push({ track: 'score', clip, owner: { kind: 'episode', episodeId: epId }, ownerStart: at, start: at, end: at + c.duration, credits: kind });
  };
  let t = 0;
  if (intro) {
    credits.push({ kind: 'intro', credits: intro, start: 0, end: intro.duration });
    creditMusic('intro', intro, 0);
    t = intro.duration;
  }
  if (ep) push(ep.tracks, { kind: 'episode', episodeId: epId }, t);
  for (const sc of episodeScenes(data, epId)) {
    const scStart = t;
    push(sc.tracks, { kind: 'scene', episodeId: epId, sceneId: sc.id }, scStart);
    sc.shots.forEach((sh, index) => {
      shots.push({ sceneId: sc.id, shot: sh, index, start: t, end: t + sh.duration });
      push(sh.tracks, { kind: 'shot', episodeId: epId, sceneId: sc.id, shotId: sh.id }, t);
      t += sh.duration;
    });
    scenes.push({ scene: sc, start: scStart, end: t });
  }
  if (outro) {
    credits.push({ kind: 'outro', credits: outro, start: t, end: t + outro.duration });
    creditMusic('outro', outro, t);
    t += outro.duration;
  }

  // window for the scope
  let w0 = 0;
  let w1 = t;
  if (scope.kind === 'scene') {
    const s = scenes.find((x) => x.scene.id === scope.sceneId);
    if (s) [w0, w1] = [s.start, s.end];
  } else if (scope.kind === 'shot') {
    const s = shots.find((x) => x.shot.id === scope.shotId && x.sceneId === scope.sceneId);
    if (s) [w0, w1] = [s.start, s.end];
  }
  const shift = <T extends { start: number; end: number }>(x: T): T => ({ ...x, start: x.start - w0, end: x.end - w0 });
  const inWin = (x: { start: number; end: number }) => x.end > w0 + 1e-6 && x.start < w1 - 1e-6;

  return {
    scope,
    duration: w1 - w0,
    scenes: scenes.filter(inWin).map(shift),
    shots: shots.filter(inWin).map(shift),
    clips: clips.filter(inWin).map((c) => ({ ...shift(c), ownerStart: c.ownerStart - w0 })),
    credits: credits.filter(inWin).map(shift),
  };
}

export function shotAt(tl: ResolvedTimeline, t: number): ShotSpan | undefined {
  return tl.shots.find((s) => t >= s.start && t < s.end) ?? (t >= tl.duration ? tl.shots[tl.shots.length - 1] : undefined);
}

export function clipsAt(tl: ResolvedTimeline, track: TrackKind, t: number): ResolvedClip[] {
  return tl.clips.filter((c) => c.track === track && t >= c.start && t < c.end);
}

// ---------------------------------------------------------------- blocking

/** Where each character stands in a shot: shot.positions, else environment marks, else a row. */
export function blockingFor(shot: Pick<Shot, 'characters' | 'positions'>, env?: Environment) {
  const n = shot.characters.length;
  return shot.characters.map((id, i) => ({
    id,
    position: shot.positions?.[id]?.position ?? env?.marks[i] ?? ([i * 1.2 - (n - 1) * 0.6, 0, 0] as Vec3),
    rotationY: shot.positions?.[id]?.rotationY ?? 0,
    moves: shot.positions?.[id]?.moves ?? [],
  }));
}

export interface ActorPose {
  position: Vec3;
  rotationY: number;
  moving: boolean;
  /** metres per second along the ground right now */
  speed: number;
  /** metres walked so far in the shot (drives the stride so feet don't slide) */
  travelled: number;
}

/**
 * Where a blocked character is at shot-local time `t`: eased from mark to mark along `moves`.
 * A move without its own rotationY turns the character to face where they're going, then
 * back to their previous facing as they arrive.
 */
export function poseAt(b: { position: Vec3; rotationY: number; moves?: MoveKey[] }, t: number): ActorPose {
  let from = { t: 0, position: b.position, rotationY: b.rotationY };
  let travelled = 0;
  for (const m of [...(b.moves ?? [])].sort((x, y) => x.t - y.t)) {
    const to = { t: m.t, position: m.position, rotationY: m.rotationY ?? from.rotationY };
    const dx = to.position[0] - from.position[0];
    const dz = to.position[2] - from.position[2];
    const dist = Math.hypot(dx, dz);
    if (t < to.t) {
      // a move takes the time from the previous key; dwell at a key by repeating it
      const span = Math.max(1e-6, to.t - from.t);
      const u = Math.min(1, Math.max(0, (t - from.t) / span));
      const k = smooth(u);
      const moving = dist > 0.01 && u > 0 && u < 1;
      let rot = from.rotationY + turn(from.rotationY, to.rotationY) * k;
      if (dist > 0.3 && m.rotationY === undefined) {
        // face the direction of travel through the middle of the walk
        const heading = (Math.atan2(dx, dz) * 180) / Math.PI;
        const w = Math.min(1, Math.min(u, 1 - u) * 5);
        rot += turn(rot, heading) * w;
      }
      return { position: lerp3(from.position, to.position, k), rotationY: rot, moving, speed: moving ? (dist / span) * 6 * u * (1 - u) : 0, travelled: travelled + dist * k };
    }
    travelled += dist;
    from = to;
  }
  return { position: from.position, rotationY: from.rotationY, moving: false, speed: 0, travelled };
}

/** Shortest signed turn in degrees from `a` to `b`. */
const turn = (a: number, b: number) => ((((b - a + 180) % 360) + 360) % 360) - 180;

/** The body pose at shot-local time `t`, the one before it, and seconds since it changed. */
export function bodyPoseAt(keys: PoseKey[] | undefined, t: number): { pose: Pose; prev: Pose; since: number } {
  let cur: PoseKey = { t: 0, pose: 'idle' };
  let prev: Pose = 'idle';
  for (const k of [...(keys ?? [])].sort((a, b) => a.t - b.t))
    if (k.t <= t) {
      prev = cur.pose;
      cur = k;
    }
  return { pose: cur.pose, prev, since: t - cur.t };
}

/** The expression a character wears at shot-local time `t`, and seconds since it changed. */
export function expressionAt(keys: ExpressionKey[] | undefined, t: number): { expression: Expression; since: number } {
  let cur: ExpressionKey = { t: 0, expression: 'neutral' };
  for (const k of [...(keys ?? [])].sort((a, b) => a.t - b.t)) if (k.t <= t) cur = k;
  return { expression: cur.expression, since: t - cur.t };
}

// ---------------------------------------------------------------- camera

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const smooth = (k: number) => k * k * (3 - 2 * k);

/** Sample a camera clip at local time `t` (seconds from clip start). */
export function sampleCamera(clip: CameraClip, t: number): CameraKey {
  const keys = [...clip.keys].sort((a, b) => a.t - b.t);
  if (t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      let k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      if (clip.ease === 'smooth') k = smooth(k);
      return { t, position: lerp3(a.position, b.position, k), target: lerp3(a.target, b.target, k), fov: lerp(a.fov, b.fov, k) };
    }
  }
  return last;
}

// ---------------------------------------------------------------- formatting

export function timecode(t: number, fps = 24): string {
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t - Math.floor(t)) * fps + 1e-6);
  return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export const fmtDuration = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${(Math.round(t * 10) / 10).toString()}s`;
};

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Rough speaking time for a line, used before TTS has run. */
export const estimateSpeech = (text: string) => Math.max(1, text.trim().split(/\s+/).length / 2.6 + 0.3);
