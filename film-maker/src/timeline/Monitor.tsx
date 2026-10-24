import { useEffect, useMemo, useRef } from 'react';
import { mediaUrl } from '../lib/api';
import type { CameraClip, CameraKey, ProjectData, StoryboardClip, SubtitleClip } from '../model/schema';
import { clipsAt, sampleCamera, shotAt, timecode, type ResolvedTimeline } from '../model/timeline';
import { creditVars, CreditsView } from '../preview/CreditsView';
import type { Look } from '../preview/look';
import { SceneView } from '../preview/SceneView';

export type MonitorMode = 'board' | '3d' | 'split';

export interface ViewportHandle {
  getKey: () => Omit<CameraKey, 't'>;
  snapshot: () => string;
}

const DEFAULT_CAM: CameraKey = { t: 0, position: [0, 1.6, 8], target: [0, 1, 0], fov: 40 };

export function cameraAt(tl: ResolvedTimeline, t: number): CameraKey {
  const cams = clipsAt(tl, 'camera', t);
  // the shot's own camera wins over scene/episode cameras; latest start wins otherwise
  const c = cams.sort((a, b) => (a.owner.kind === 'shot' ? 1 : 0) - (b.owner.kind === 'shot' ? 1 : 0) || a.start - b.start).at(-1);
  if (!c) return DEFAULT_CAM;
  return sampleCamera(c.clip as CameraClip, t - c.start);
}

export function Viewport({ data, tl, time, pilot, look, handle }: {
  data: ProjectData; tl: ResolvedTimeline; time: number; pilot: boolean; look: Look; handle?: React.RefObject<ViewportHandle | null>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const view = useRef<SceneView | null>(null);
  useEffect(() => {
    view.current = new SceneView(el.current!);
    if (handle) handle.current = { getKey: () => view.current!.getKey(), snapshot: () => view.current!.snapshot() };
    return () => {
      view.current?.dispose();
      view.current = null;
    };
  }, [handle]);

  const span = shotAt(tl, time);
  const scene = span ? data.scenes[span.sceneId] : undefined;
  const envId = span?.shot.environmentId ?? scene?.environmentId;
  const assets = span?.shot.assets;
  const characters = span?.shot.characters;
  const positions = span?.shot.positions;
  const expressions = span?.shot.expressions;
  const poses = span?.shot.poses;
  const dialog = span?.shot.tracks.dialog;
  const talk = useMemo(() => {
    const out: Record<string, [number, number][]> = {};
    for (const d of dialog ?? []) (out[d.characterId] ??= []).push([d.start, d.start + d.duration]);
    return out;
  }, [dialog]);
  useEffect(() => {
    view.current?.setLook(look);
    view.current?.setContent(data, { envId, assets: assets ?? [], characters: characters ?? [], positions, expressions, poses, talk });
  }, [data, envId, assets, characters, positions, expressions, poses, talk, look]);
  const shotTime = span ? time - span.start : 0;
  useEffect(() => {
    view.current?.setShotTime(shotTime);
  }, [shotTime]);
  useEffect(() => {
    view.current?.setPilot(pilot);
  }, [pilot]);
  const cam = cameraAt(tl, time);
  useEffect(() => {
    view.current?.setCamera(cam);
  });
  return <div className="gl" ref={el} />;
}

export function Monitor({ data, tl, time, mode, pilot, look = 'cinematic', safe, handle }: {
  data: ProjectData; tl: ResolvedTimeline; time: number; mode: MonitorMode; pilot: boolean; look?: Look; safe: boolean; handle: React.RefObject<ViewportHandle | null>;
}) {
  const span = shotAt(tl, time);
  const board = clipsAt(tl, 'storyboard', time).sort((a, b) => a.start - b.start).at(-1)?.clip as StoryboardClip | undefined;
  const subs = clipsAt(tl, 'subtitles', time).map((c) => (c.clip as SubtitleClip).text);
  const scene = span ? data.scenes[span.sceneId] : undefined;
  const fps = data.project.fps;
  const isVideo = board && /\.(mp4|webm|mov)$/i.test(board.image);
  const credit = tl.credits.find((c) => time >= c.start && time < c.end);

  const boardPane = useMemo(
    () =>
      board?.image ? (
        isVideo ? <video className="board" src={mediaUrl(board.image)} autoPlay loop muted /> : <img className="board" src={mediaUrl(board.image)} alt="" />
      ) : (
        <div className="card-board">
          <div className="n">{scene?.title} · {span?.shot.name ?? '—'}</div>
          <div className="d">{span?.shot.description || 'No storyboard yet.'}</div>
        </div>
      ),
    [board?.image, isVideo, scene?.title, span?.shot.name, span?.shot.description],
  );

  const overlay = (label: string) => (
    <>
      <div className="hud">
        <span>{scene?.title} › {span?.shot.name}</span>
        <span>{timecode(time, fps)}</span>
      </div>
      {subs.length > 0 && (
        <div className="subs">
          <span>{subs.join(' ')}</span>
        </div>
      )}
      {safe && <div className="safe" />}
      <div className="label">{label}</div>
    </>
  );

  return (
    <div className="monitor-wrap">
      <div className={`monitor ${mode === 'split' && !credit ? 'split' : ''}`}>
        {credit && (
          <div className="pane" style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
            <CreditsView credits={credit.credits} time={time - credit.start} vars={creditVars(data, tl.scope.episodeId)} />
            <div className="hud" style={{ zIndex: 6 }}>
              <span>{credit.kind} credits</span>
              <span>{timecode(time, fps)}</span>
            </div>
            {safe && <div className="safe" style={{ zIndex: 6 }} />}
          </div>
        )}
        {mode !== '3d' && (
          <div className="pane">
            {boardPane}
            {overlay('board')}
          </div>
        )}
        {mode !== 'board' && (
          <div className="pane">
            <Viewport data={data} tl={tl} time={time} pilot={pilot} look={look} handle={handle} />
            {pilot && <div className="pilot-hint">PILOT — orbit/zoom/pan, then “Set key”</div>}
            {overlay(look === 'flat' ? 'flat' : '3d preview')}
          </div>
        )}
      </div>
    </div>
  );
}
