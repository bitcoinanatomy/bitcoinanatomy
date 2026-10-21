/** Editing operations on the project. All go through `mutate` so they're undoable and autosaved. */
import { api } from '../lib/api';
import {
  Asset, Character, Environment, Episode, Scene, ScoreCue, Shot,
  type AnyClip, type ClipOf, type DialogClip, type ProjectData, type TrackKind,
} from '../model/schema';
import { estimateSpeech, getOwnerTracks, resolveTimeline, uid, type Owner, type Scope } from '../model/timeline';
import { useStore } from './store';
import { ttsRequestFor } from '../model/tts';

const m = (label: string, fn: (d: ProjectData) => void, coalesce?: string) => useStore.getState().mutate(label, fn, coalesce);

export const findShot = (d: ProjectData, sceneId: string, shotId: string) => d.scenes[sceneId]?.shots.find((s) => s.id === shotId);

// ---------------------------------------------------------------- structure

export function updateEpisode(id: string, fn: (e: Episode) => void, coalesce?: string) {
  m('edit episode', (d) => d.episodes[id] && fn(d.episodes[id]), coalesce && `ep:${id}:${coalesce}`);
}
export function updateScene(id: string, fn: (s: Scene) => void, coalesce?: string) {
  m('edit scene', (d) => d.scenes[id] && fn(d.scenes[id]), coalesce && `sc:${id}:${coalesce}`);
}
export function updateShot(sceneId: string, shotId: string, fn: (s: Shot) => void, coalesce?: string) {
  m('edit shot', (d) => {
    const s = findShot(d, sceneId, shotId);
    if (s) fn(s);
  }, coalesce && `sh:${sceneId}/${shotId}:${coalesce}`);
}

const nextId = (prefix: string, taken: string[]) => {
  for (let i = 1; ; i++) {
    const id = `${prefix}${String(i).padStart(2, '0')}`;
    if (!taken.includes(id)) return id;
  }
};

export function addEpisode() {
  let id = '';
  m('add episode', (d) => {
    id = nextId('ep', Object.keys(d.episodes));
    const number = d.project.episodes.length + 1;
    d.episodes[id] = Episode.parse({ id, number, title: `Episode ${number}` });
    d.project.episodes.push(id);
  });
  return id;
}

export function addScene(episodeId: string, index?: number) {
  let id = '';
  m('add scene', (d) => {
    const ep = d.episodes[episodeId];
    id = nextId(`${episodeId}_sc`, Object.keys(d.scenes));
    const shot = Shot.parse({ id: 'sh01', name: 'New shot', duration: 4 });
    d.scenes[id] = { ...Scene.parse({ id, title: 'New scene', shots: [shot] }), episodeId };
    ep.scenes.splice(index ?? ep.scenes.length, 0, id);
  });
  return id;
}

export function addShot(sceneId: string, index?: number, base?: Partial<Shot>) {
  let id = '';
  m('add shot', (d) => {
    const sc = d.scenes[sceneId];
    id = nextId('sh', sc.shots.map((s) => s.id));
    const shot = Shot.parse({ name: 'New shot', duration: 4, environmentId: undefined, ...base, id });
    sc.shots.splice(index ?? sc.shots.length, 0, shot);
  });
  return id;
}

export function duplicateShot(sceneId: string, shotId: string) {
  let id = '';
  m('duplicate shot', (d) => {
    const sc = d.scenes[sceneId];
    const i = sc.shots.findIndex((s) => s.id === shotId);
    const copy: Shot = structuredClone(sc.shots[i]);
    copy.id = nextId('sh', sc.shots.map((s) => s.id));
    copy.name += ' (copy)';
    for (const t of Object.values(copy.tracks)) for (const c of t as AnyClip[]) c.id = uid('clip');
    sc.shots.splice(i + 1, 0, copy);
    id = copy.id;
  });
  return id;
}

export function deleteShot(sceneId: string, shotId: string) {
  m('delete shot', (d) => {
    const sc = d.scenes[sceneId];
    sc.shots = sc.shots.filter((s) => s.id !== shotId);
  });
}
export function deleteScene(sceneId: string) {
  m('delete scene', (d) => {
    const ep = d.episodes[d.scenes[sceneId].episodeId];
    ep.scenes = ep.scenes.filter((s) => s !== sceneId);
    delete d.scenes[sceneId];
  });
}
export function deleteEpisode(id: string) {
  m('delete episode', (d) => {
    for (const s of d.episodes[id].scenes) delete d.scenes[s];
    delete d.episodes[id];
    d.project.episodes = d.project.episodes.filter((e) => e !== id);
  });
}

export function move<T>(arr: T[], index: number, dir: -1 | 1) {
  const j = index + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[index], arr[j]] = [arr[j], arr[index]];
}
export const moveShot = (sceneId: string, index: number, dir: -1 | 1) => m('reorder shots', (d) => move(d.scenes[sceneId].shots, index, dir));
export const moveScene = (episodeId: string, index: number, dir: -1 | 1) => m('reorder scenes', (d) => move(d.episodes[episodeId].scenes, index, dir));
export const moveEpisode = (index: number, dir: -1 | 1) => m('reorder episodes', (d) => move(d.project.episodes, index, dir));

// ---------------------------------------------------------------- libraries

export type LibKind = 'characters' | 'environments' | 'assets' | 'cues';
const LIB_SCHEMA = { characters: Character, environments: Environment, assets: Asset, cues: ScoreCue };

export function updateLib<K extends LibKind>(kind: K, id: string, fn: (doc: ProjectData[K][string]) => void, coalesce?: string) {
  m(`edit ${kind.slice(0, -1)}`, (d) => {
    const doc = d[kind][id];
    if (doc) fn(doc as ProjectData[K][string]);
  }, coalesce && `${kind}:${id}:${coalesce}`);
}

export function addLib(kind: LibKind, name: string) {
  let id = '';
  m(`add ${kind.slice(0, -1)}`, (d) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || kind.slice(0, -1);
    id = base;
    for (let i = 2; d[kind][id]; i++) id = `${base}_${i}`;
    const extra = kind === 'cues' ? { seed: Math.floor(Math.random() * 1e6) } : {};
    (d[kind] as Record<string, unknown>)[id] = LIB_SCHEMA[kind].parse({ id, name, ...extra });
  });
  return id;
}

export function deleteLib(kind: LibKind, id: string) {
  m(`delete ${kind.slice(0, -1)}`, (d) => {
    delete d[kind][id];
  });
}

// ---------------------------------------------------------------- clips

export function updateClip<K extends TrackKind>(owner: Owner, track: K, clipId: string, fn: (c: ClipOf[K]) => void, coalesce?: string) {
  m(`edit ${track} clip`, (d) => {
    const c = (getOwnerTracks(d, owner)?.[track] as ClipOf[K][] | undefined)?.find((x) => x.id === clipId);
    if (c) fn(c);
  }, coalesce && `clip:${clipId}:${coalesce}`);
}

export function addClip<K extends TrackKind>(owner: Owner, track: K, clip: ClipOf[K]) {
  m(`add ${track} clip`, (d) => {
    (getOwnerTracks(d, owner)?.[track] as ClipOf[K][] | undefined)?.push(clip);
  });
}

export function removeClip(owner: Owner, track: TrackKind, clipId: string) {
  m(`delete ${track} clip`, (d) => {
    const t = getOwnerTracks(d, owner);
    if (t) (t[track] as AnyClip[]) = (t[track] as AnyClip[]).filter((c) => c.id !== clipId);
  });
}

/** Move a clip to another owner (e.g. dragged across a shot boundary), keeping absolute time. */
export function reparentClip(from: Owner, to: Owner, track: TrackKind, clipId: string, newStart: number) {
  m(`move ${track} clip`, (d) => {
    const a = getOwnerTracks(d, from);
    const b = getOwnerTracks(d, to);
    if (!a || !b) return;
    const list = a[track] as AnyClip[];
    const i = list.findIndex((c) => c.id === clipId);
    if (i < 0) return;
    const [clip] = list.splice(i, 1);
    clip.start = Math.max(0, newStart);
    (b[track] as AnyClip[]).push(clip);
  });
}

// ---------------------------------------------------------------- dialog audio

/** Generate (or fetch cached) TTS audio for every dialog line in scope. Grows shots that are too short. */
export async function generateDialog(scope: Scope, onProgress?: (done: number, total: number) => void) {
  const st = useStore.getState();
  const data = st.data!;
  const tl = resolveTimeline(data, scope);
  const lines = tl.clips.filter((c) => c.track === 'dialog' && !c.derived);
  let done = 0;
  const results: { owner: Owner; id: string; audio: string; audioHash: string; duration: number }[] = [];
  for (const c of lines) {
    const clip = c.clip as DialogClip;
    const r = await api.tts(ttsRequestFor(data, clip));
    results.push({ owner: c.owner, id: clip.id, audio: r.audio, audioHash: r.audioHash, duration: r.duration });
    onProgress?.(++done, lines.length);
  }
  m('generate dialog audio', (d) => {
    for (const r of results) {
      const clip = (getOwnerTracks(d, r.owner)?.dialog ?? []).find((x) => x.id === r.id);
      if (!clip) continue;
      Object.assign(clip, { audio: r.audio, audioHash: r.audioHash, duration: Math.round(r.duration * 1000) / 1000 });
      if (r.owner.kind === 'shot') {
        const shot = findShot(d, r.owner.sceneId, r.owner.shotId);
        const end = clip.start + clip.duration + 0.4;
        if (shot && end > shot.duration) shot.duration = Math.ceil(end * 2) / 2;
      }
    }
  });
  return results.length;
}

export const newDialog = (characterId: string, text: string, start: number): DialogClip => ({
  id: uid('dlg'), start, duration: estimateSpeech(text), characterId, text, subtitle: true, gain: 1,
});
