/**
 * Story-arc geometry: turns scene (and optional shot) tension values into curves
 * over story time, for one episode or the whole season.
 */
import type { Beat, ProjectData } from './schema';
import { BEATS } from './schema';
import { episodeScenes, sceneDuration } from './timeline';

export interface ArcPoint {
  t: number; // seconds from the start of the episode / season
  tension: number;
  episodeId: string;
  sceneId: string;
  shotId?: string;
  beat?: Beat;
  label: string;
}
export interface ArcSpan {
  id: string;
  label: string;
  start: number;
  end: number;
}
export interface ArcData {
  duration: number;
  points: ArcPoint[];
  /** scene points only — the draggable handles */
  handles: ArcPoint[];
  episodes: ArcSpan[];
  scenes: ArcSpan[];
  /** which characters are in each scene, with how many lines they speak */
  presence: { characterId: string; sceneId: string; start: number; end: number; lines: number }[];
}

export function arcFor(data: ProjectData, episodeIds: string[]): ArcData {
  const out: ArcData = { duration: 0, points: [], handles: [], episodes: [], scenes: [], presence: [] };
  let t = 0;
  for (const epId of episodeIds) {
    const ep = data.episodes[epId];
    if (!ep) continue;
    const epStart = t;
    for (const sc of episodeScenes(data, epId)) {
      const len = sceneDuration(sc);
      const handle: ArcPoint = { t: t + len / 2, tension: sc.arc.tension, episodeId: epId, sceneId: sc.id, beat: sc.arc.beat, label: sc.title };
      out.handles.push(handle);
      // shots that carry their own tension refine the curve inside the scene
      let st = t;
      const fine = sc.shots.filter((s) => s.tension !== undefined);
      if (fine.length) {
        for (const sh of sc.shots) {
          if (sh.tension !== undefined) out.points.push({ t: st + sh.duration / 2, tension: sh.tension, episodeId: epId, sceneId: sc.id, shotId: sh.id, label: sh.name });
          st += sh.duration;
        }
      } else out.points.push(handle);
      const chars = new Map<string, number>();
      for (const sh of sc.shots) {
        sh.characters.forEach((c) => chars.set(c, chars.get(c) ?? 0));
        sh.tracks.dialog.forEach((d) => chars.set(d.characterId, (chars.get(d.characterId) ?? 0) + 1));
      }
      for (const [characterId, lines] of chars) out.presence.push({ characterId, sceneId: sc.id, start: t, end: t + len, lines });
      out.scenes.push({ id: sc.id, label: sc.title, start: t, end: t + len });
      t += len;
    }
    out.episodes.push({ id: epId, label: `${ep.number}. ${ep.title}`, start: epStart, end: t });
  }
  out.duration = t;
  return out;
}

/** Smooth SVG path through points (Catmull-Rom → cubic Bézier), clamped to the plot. */
export function smoothPath(pts: [number, number][], yMin: number, yMax: number): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const clamp = (y: number) => Math.max(yMin, Math.min(yMax, y));
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Classic rising-action reference curve (tension at story fraction x), for comparison. */
export function referenceArc(x: number) {
  // gentle setup, rising action, peak around 85%, quick resolution
  if (x < 0.1) return 0.2 + x;
  if (x < 0.85) return 0.3 + ((x - 0.1) / 0.75) ** 1.4 * 0.65;
  return 0.95 - ((x - 0.85) / 0.15) * 0.6;
}

export const BEAT_LABEL: Record<Beat, string> = {
  setup: 'Setup', inciting: 'Inciting incident', rising: 'Rising action', midpoint: 'Midpoint', crisis: 'Crisis', climax: 'Climax', resolution: 'Resolution',
};
export const BEAT_COLOR: Record<Beat, string> = {
  setup: '#8a8a8a', inciting: '#c26a6a', rising: '#a8875a', midpoint: '#6f93a8', crisis: '#a86a8f', climax: '#f2f2f2', resolution: '#608a64',
};
export { BEATS };
