/**
 * Timeline editor: monitor + inspector on top, multi-track timeline below.
 * Works for an episode, a scene or a single shot (the "scope").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { transport, usePlayback } from '../audio/player';
import { mediaUrl } from '../lib/api';
import {
  TRACK_KINDS, type AnyClip, type CameraClip, type ClipOf, type DialogClip, type ProjectData, type ScoreClip, type SfxClip,
  type StoryboardClip, type SubtitleClip, type TrackKind,
} from '../model/schema';
import { ownerKey, resolveTimeline, shotAt, timecode, uid, type Owner, type ResolvedClip, type Scope } from '../model/timeline';
import { addClip, generateDialog, newDialog, removeClip, reparentClip, updateClip, updateShot } from '../store/actions';
import { useData, useStore } from '../store/store';
import { NoteRoll, Waveform } from './ClipViz';
import { Inspector, TRACK_LABEL } from './Inspector';
import { LOOK_LABEL, LOOKS, useLook } from '../preview/look';
import { cameraAt, Monitor, type MonitorMode, type ViewportHandle } from './Monitor';

const ROW_H: Record<TrackKind, number> = { storyboard: 54, camera: 36, subtitles: 34, dialog: 50, sfx: 42, score: 52 };

type IconName = 'start' | 'prev' | 'play' | 'pause' | 'next' | 'loop' | 'board' | 'split' | '3d' | 'cinematic' | 'flat' | 'toon';

function Icon({ name }: { name: IconName }) {
  const stroke = { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, 'aria-hidden': true as const };
  const fill = { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'currentColor', 'aria-hidden': true as const };
  if (name === 'start') return <svg {...fill}><path d="M1.6 1.4h1.3v9.2H1.6zM10.6 1.8 4.2 6l6.4 4.2z" /></svg>;
  if (name === 'prev') return <svg {...fill}><path d="M6.4 1.8 1.2 6l5.2 4.2zM11 1.8 5.8 6 11 10.2z" /></svg>;
  if (name === 'play') return <svg {...fill}><path d="M3 1.6v8.8L10.4 6z" /></svg>;
  if (name === 'pause') return <svg {...fill}><path d="M2.4 1.6h2.2v8.8H2.4zM7.4 1.6h2.2v8.8H7.4z" /></svg>;
  if (name === 'next') return <svg {...fill}><path d="M1 1.8 6.2 6 1 10.2zM5.6 1.8 10.8 6 5.6 10.2z" /></svg>;
  if (name === 'loop') return <svg {...stroke}><path d="M9.4 3.4A3.8 3.8 0 1 0 10 7.2" /><path d="M9.4 1.3v2.3H7.1" /></svg>;
  if (name === 'board') return <svg {...stroke}><rect x="1.2" y="2.2" width="9.6" height="7.6" rx="0.6" /></svg>;
  if (name === 'split') return <svg {...stroke}><rect x="1.2" y="1.4" width="9.6" height="4" rx="0.5" /><rect x="1.2" y="6.6" width="9.6" height="4" rx="0.5" /></svg>;
  if (name === '3d') return <svg {...stroke}><path d="M6 1.4 10.6 4 6 6.6 1.4 4zM1.4 4v4.2L6 10.6V6.6M10.6 4v4.2L6 10.6" /></svg>;
  if (name === 'cinematic') return <svg {...stroke}><circle cx="6" cy="6" r="2.1" /><path d="M6 1.3v1.5M6 9.2v1.5M1.3 6h1.5M9.2 6h1.5M2.7 2.7l1.1 1.1M8.2 8.2l1.1 1.1M9.3 2.7 8.2 3.8M3.8 8.2 2.7 9.3" /></svg>;
  if (name === 'toon') return <svg {...stroke}><circle cx="6" cy="6" r="4.4" /><path d="M6 1.6a4.4 4.4 0 0 1 0 8.8z" fill="currentColor" /></svg>;
  return <svg {...stroke}><rect x="1.6" y="1.6" width="8.8" height="8.8" /></svg>;
}
const HEAD_W = 168;
const clipKey = (rc: { track: TrackKind; clip: AnyClip; derived?: boolean }) => `${rc.track}:${rc.clip.id}${rc.derived ? ':d' : ''}`;

type Sel = { kind: 'clip'; key: string } | { kind: 'shot'; sceneId: string; shotId: string } | null;
type DragMode = 'move' | 'l' | 'r';
interface Drag {
  key: string;
  rc: ResolvedClip;
  mode: DragMode;
  x0: number;
  start: number;
  end: number;
  snap?: number;
  moved: boolean;
}

export function TimelineEditor({ scope }: { scope: Scope }) {
  const data = useData();
  const tl = useMemo(() => resolveTimeline(data, scope), [data, scope]);
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);
  const loading = usePlayback((s) => s.loading);
  const navigate = useNavigate();

  const [zoom, setZoom] = useState(0); // px per second; 0 = fit
  const [sel, setSel] = useState<Sel>(null);
  const [mode, setMode] = useState<MonitorMode>(() => (localStorage.getItem('fm.monitor') as MonitorMode) || 'split');
  const [muted, setMuted] = useState<Set<TrackKind>>(new Set());
  const [solo, setSolo] = useState<TrackKind | null>(null);
  const [locked, setLocked] = useState<Set<TrackKind>>(new Set());
  const [snap, setSnap] = useState(true);
  const [pilot, setPilot] = useState(false);
  const [look, setLook] = useLook();
  const [safe, setSafe] = useState(false);
  const [loop, setLoop] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [shotDrag, setShotDrag] = useState<{ sceneId: string; shotId: string; x0: number; dur0: number; dur: number } | null>(null);
  const [gen, setGen] = useState<string | null>(null);
  const [monitorH, setMonitorH] = useState(() => Number(localStorage.getItem('fm.monitorH')) || 46);
  const scroller = useRef<HTMLDivElement>(null);
  const heads = useRef<HTMLDivElement>(null);
  const viewport = useRef<ViewportHandle | null>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => localStorage.setItem('fm.monitor', mode), [mode]);

  // reset on scope change
  const scopeKey = ownerKey(scope);
  useEffect(() => {
    transport.stop();
    usePlayback.setState({ time: 0 });
    setSel(null);
    setZoom(0);
  }, [scopeKey]);
  useEffect(() => () => transport.stop(), []);

  // preload audio for snappy playback
  useEffect(() => {
    const t = setTimeout(() => void transport.preload(tl, data), 300);
    return () => clearTimeout(t);
  }, [tl, data]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pps = zoom || Math.max(4, (width - 40) / Math.max(1, tl.duration));
  const X = (t: number) => t * pps;
  const fps = data.project.fps;

  const effMuted = useMemo(() => {
    const m = new Set(muted);
    if (solo) for (const k of TRACK_KINDS) if (k !== solo) m.add(k);
    return m;
  }, [muted, solo]);

  // ---------------------------------------------------------------- transport
  const play = useCallback(() => {
    transport.muted = effMuted;
    void transport.play(tl, data, usePlayback.getState().time, { loop });
  }, [tl, data, effMuted, loop]);
  const toggle = useCallback(() => (usePlayback.getState().playing ? transport.pause() : play()), [play]);
  const seek = useCallback((t: number) => transport.seek(Math.max(0, Math.min(tl.duration, t))), [tl.duration]);

  // restart playback with new mutes
  useEffect(() => {
    if (usePlayback.getState().playing) {
      transport.muted = effMuted;
      transport.seek(transport.position());
    }
  }, [effMuted]);

  // keep the playhead visible while playing
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = X(time);
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  });

  // ---------------------------------------------------------------- selection
  const clipsByKey = useMemo(() => new Map(tl.clips.map((c) => [clipKey(c), c])), [tl]);
  const selClip = sel?.kind === 'clip' ? clipsByKey.get(sel.key) : undefined;
  const curShot = sel?.kind === 'shot' ? tl.shots.find((s) => s.shot.id === sel.shotId && s.sceneId === sel.sceneId) : shotAt(tl, time);

  // ---------------------------------------------------------------- adding clips
  const addAt = useCallback(
    (track: TrackKind) => {
      const t = usePlayback.getState().time;
      const span = shotAt(tl, t) ?? tl.shots[0];
      if (!span) return;
      let owner: Owner = { kind: 'shot', episodeId: scope.episodeId, sceneId: span.sceneId, shotId: span.shot.id };
      if (track === 'score') owner = scope.kind === 'shot' ? owner : scope;
      const ownerStart = owner.kind === 'shot' ? span.start : 0;
      const start = Math.max(0, Math.round((t - ownerStart) * 10) / 10);
      const id = uid(track.slice(0, 3));
      const room = owner.kind === 'shot' ? Math.max(0.5, span.shot.duration - start) : 8;
      const make: { [K in TrackKind]: () => ClipOf[K] } = {
        storyboard: (): StoryboardClip => ({ id, start, duration: room, image: '' }),
        camera: (): CameraClip => ({ id, start, duration: room, ease: 'smooth', keys: [{ ...cameraAt(tl, t), t: 0 }] }),
        subtitles: (): SubtitleClip => ({ id, start, duration: Math.min(3, room), text: 'New subtitle' }),
        dialog: (): DialogClip => newDialog(Object.keys(data.characters)[0] ?? 'narrator', 'New line.', start),
        sfx: (): SfxClip => ({ id, start, duration: 1.5, file: 'media/audio/sfx/whoosh.wav', gain: 0.8 }),
        score: (): ScoreClip => ({ id, start, duration: 16, cueId: Object.keys(data.cues)[0] ?? '', offset: 0, gain: 0.6 }),
      };
      const clip = make[track]() as AnyClip;
      if (track === 'score' && !Object.keys(data.cues).length) return useStore.getState().notify('Create a score cue first (Score page).');
      addClip(owner, track, clip as never);
      setSel({ kind: 'clip', key: `${track}:${clip.id}` });
    },
    [tl, scope, data],
  );

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt instanceof Element && tgt.closest('input, textarea, select, [contenteditable]')) return;
      const t = usePlayback.getState().time;
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'k') transport.pause();
      else if (e.key === 'l') play();
      else if (e.key === 'j') seek(t - 2);
      else if (e.key === 'ArrowLeft') seek(t - (e.shiftKey ? 1 : 1 / fps));
      else if (e.key === 'ArrowRight') seek(t + (e.shiftKey ? 1 : 1 / fps));
      else if (e.key === 'Home') seek(0);
      else if (e.key === 'End') seek(tl.duration);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // jump between shot boundaries
        e.preventDefault();
        const marks = [0, ...tl.shots.map((s) => s.end)];
        const next = e.key === 'ArrowDown' ? marks.find((m) => m > t + 1e-3) : [...marks].reverse().find((m) => m < t - 1e-3);
        if (next !== undefined) seek(next);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selClip && !selClip.derived) {
        removeClip(selClip.owner, selClip.track, selClip.clip.id);
        setSel(null);
      } else if (e.key === '=' || e.key === '+') setZoom((z) => (z || pps) * 1.4);
      else if (e.key === '-') setZoom((z) => Math.max(2, (z || pps) / 1.4));
      else if (e.key === '0') setZoom(0);
      else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, play, seek, fps, tl, selClip, pps]);

  // ---------------------------------------------------------------- dragging clips
  const snapPoints = useMemo(() => {
    const pts = new Set<number>([0, tl.duration]);
    for (const s of tl.shots) pts.add(s.start).add(s.end);
    return [...pts];
  }, [tl]);

  const doSnap = (t: number, exclude: string) => {
    if (!snap) return { t };
    const thr = 8 / pps;
    let best: number | undefined;
    const cands = [...snapPoints, usePlayback.getState().time];
    for (const c of tl.clips) if (clipKey(c) !== exclude && !c.derived) cands.push(c.start, c.end);
    for (const p of cands) if (Math.abs(p - t) < thr && (best === undefined || Math.abs(p - t) < Math.abs(best - t))) best = p;
    return best === undefined ? { t } : { t: best, snap: best };
  };

  const startDrag = (e: React.PointerEvent, rc: ResolvedClip, m: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const key = clipKey(rc);
    setSel({ kind: 'clip', key });
    if (rc.derived || rc.credits || locked.has(rc.track)) return;
    setDrag({ key, rc, mode: m, x0: e.clientX, start: rc.start, end: rc.end, moved: false });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dt = (e.clientX - drag.x0) / pps;
      if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
      const { rc } = drag;
      const len = rc.end - rc.start;
      let start = rc.start;
      let end = rc.end;
      let snapAt: number | undefined;
      if (drag.mode === 'move') {
        let s = doSnap(rc.start + dt, drag.key);
        if (s.snap === undefined) {
          const s2 = doSnap(rc.start + dt + len, drag.key);
          s = s2.snap !== undefined ? { t: s2.t - len, snap: s2.snap } : s;
        }
        start = Math.max(rc.owner.kind === 'shot' ? 0 : rc.ownerStart, s.t);
        end = start + len;
        snapAt = s.snap;
      } else if (drag.mode === 'r') {
        const s = doSnap(rc.end + dt, drag.key);
        end = Math.max(rc.start + 0.05, s.t);
        snapAt = s.snap;
      } else {
        const s = doSnap(rc.start + dt, drag.key);
        start = Math.min(rc.end - 0.05, Math.max(rc.ownerStart, s.t));
        snapAt = s.snap;
      }
      setDrag({ ...drag, start, end, snap: snapAt, moved: true });
    };
    const onUp = () => {
      setDrag(null);
      if (!drag.moved) return;
      const { rc, start, end } = drag;
      if (drag.mode === 'move' && rc.owner.kind === 'shot') {
        const target = shotAt(tl, start + 1e-4);
        if (target && (target.shot.id !== rc.owner.shotId || target.sceneId !== rc.owner.sceneId)) {
          const to: Owner = { kind: 'shot', episodeId: scope.episodeId, sceneId: target.sceneId, shotId: target.shot.id };
          reparentClip(rc.owner, to, rc.track, rc.clip.id, round(start - target.start));
          return;
        }
      }
      updateClip(rc.owner, rc.track, rc.clip.id, (c: AnyClip) => {
        const delta = start - rc.start;
        c.start = round(Math.max(0, start - rc.ownerStart));
        c.duration = round(end - start);
        if (drag.mode === 'l' && rc.track === 'score') (c as ScoreClip).offset = round(Math.max(0, (c as ScoreClip).offset + delta));
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });

  // shot duration drag (right edge of a shot band)
  useEffect(() => {
    if (!shotDrag) return;
    const onMove = (e: PointerEvent) => setShotDrag({ ...shotDrag, dur: Math.max(0.5, Math.round((shotDrag.dur0 + (e.clientX - shotDrag.x0) / pps) * fps) / fps) });
    const onUp = () => {
      setShotDrag(null);
      if (shotDrag.dur !== shotDrag.dur0) updateShot(shotDrag.sceneId, shotDrag.shotId, (s) => void (s.duration = round(shotDrag.dur)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });

  // scrubbing on the ruler
  const scrub = (e: React.PointerEvent) => {
    const el = scroller.current!;
    const rect = el.getBoundingClientRect();
    const at = (x: number) => seek((x - rect.left + el.scrollLeft) / pps);
    // dragging the cursor must never start a text selection anywhere on the page
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    document.body.classList.add('scrubbing');
    at(e.clientX);
    const mv = (ev: PointerEvent) => at(ev.clientX);
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', () => {
      window.removeEventListener('pointermove', mv);
      document.body.classList.remove('scrubbing');
    }, { once: true });
  };

  // ---------------------------------------------------------------- dialog TTS
  const missing = tl.clips.filter((c) => c.track === 'dialog' && !c.derived && !(c.clip as DialogClip).audio).length;
  const runTts = async () => {
    setGen('0%');
    try {
      const n = await generateDialog(scope, (d, t) => setGen(`${Math.round((d / t) * 100)}%`));
      useStore.getState().notify(`Dialog audio ready for ${n} line${n === 1 ? '' : 's'}`);
    } catch (e) {
      useStore.getState().notify(`TTS failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setGen(null);
    }
  };

  // ---------------------------------------------------------------- render
  const ticks = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const major = steps.find((s) => s * pps >= 70) ?? 300;
    const out: { t: number; major: boolean }[] = [];
    for (let t = 0; t <= tl.duration + 1e-6; t += major / 5) out.push({ t: Math.round(t * 1000) / 1000, major: Math.abs(t / major - Math.round(t / major)) < 1e-6 });
    return out;
  }, [pps, tl.duration]);

  const innerW = X(tl.duration) + 200;
  const rows = TRACK_KINDS;

  const startSplit = (e: React.PointerEvent) => {
    const parent = (e.target as HTMLElement).parentElement!;
    const rect = parent.getBoundingClientRect();
    const mv = (ev: PointerEvent) => {
      const pct = Math.min(75, Math.max(18, ((ev.clientY - rect.top) / rect.height) * 100));
      setMonitorH(pct);
      localStorage.setItem('fm.monitorH', String(pct));
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mv), { once: true });
  };

  return (
    <div className="editor" style={{ ['--monitor-h' as string]: `${monitorH}%` }}>
      <div className="toolbar">
        <button className="btn icon" title="Start (Home)" onClick={() => seek(0)}><Icon name="start" /></button>
        <button className="btn icon" title="Previous shot (↑)" onClick={() => {
          const t = usePlayback.getState().time;
          const prev = [...tl.shots].reverse().find((s) => s.start < t - 0.05);
          seek(prev?.start ?? 0);
        }}><Icon name="prev" /></button>
        <button className={`btn icon ${playing ? 'on' : ''}`} title="Play/pause (space)" onClick={toggle}>{loading ? '…' : <Icon name={playing ? 'pause' : 'play'} />}</button>
        <button className="btn icon" title="Next shot (↓)" onClick={() => {
          const t = usePlayback.getState().time;
          seek(tl.shots.find((s) => s.start > t + 0.05)?.start ?? tl.duration);
        }}><Icon name="next" /></button>
        <button className={`btn icon ${loop ? 'on' : ''}`} title="Loop" onClick={() => setLoop(!loop)}><Icon name="loop" /></button>
        <span className="tc" title="Playhead / duration">{timecode(time, fps)}<span className="muted"> / {timecode(tl.duration, fps)}</span></span>
        <span className="sep" />
        <div className="seg" title="Monitor layout">
          {(['board', 'split', '3d'] as const).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}><Icon name={m} />{m === 'board' ? 'Board' : m === '3d' ? '3D' : 'Split'}</button>
          ))}
        </div>
        <button className={`btn icon ${pilot ? 'on' : ''}`} disabled={mode === 'board'} onClick={() => setPilot(!pilot)} title="Pilot — free camera in the 3D view">✥</button>
        <div className="seg" title="Preview treatment">
          {LOOKS.map((k) => (
            <button key={k} className={look === k ? 'on' : ''} disabled={mode === 'board'} onClick={() => setLook(k)}><Icon name={k} />{LOOK_LABEL[k]}</button>
          ))}
        </div>
        <button className={`btn sm ${safe ? 'on' : ''}`} onClick={() => setSafe(!safe)} title="Safe area">Safe</button>
        <span className="sep" />
        <button className={`btn sm ${snap ? 'on' : ''}`} onClick={() => setSnap(!snap)}>Snap</button>
        <div className="seg" title="Timeline zoom">
          <button type="button" onClick={() => setZoom(Math.max(2, pps / 1.4))}>−</button>
          <button type="button" onClick={() => setZoom(0)}>Fit</button>
          <button type="button" onClick={() => setZoom(pps * 1.4)}>+</button>
        </div>
        <span className="grow" />
        <button className="btn sm primary" disabled={!!gen} onClick={() => void runTts()} title="Generate/refresh TTS for every dialog line in view (cached)">
          {gen ? `Generating ${gen}` : `♪ Audio${missing ? ` (${missing})` : ''}`}
        </button>
      </div>

      <div className="upper">
        <Monitor data={data} tl={tl} time={time} mode={mode} pilot={pilot} look={look} safe={safe} handle={viewport} />
        <Inspector data={data} tl={tl} sel={selClip} shot={curShot} time={time} viewport={viewport} onDeselect={() => setSel(null)} />
      </div>
      <div className="splitter" onPointerDown={startSplit} />

      <div className="timeline">
        <div className="tl-heads" ref={heads}>
          <div className="tl-head ruler">{pps.toFixed(0)} px/s</div>
          <div className="tl-head" style={{ ['--h' as string]: '24px' }}><span className="nm">Scenes</span></div>
          <div className="tl-head" style={{ ['--h' as string]: '30px' }}><span className="nm">Shots</span></div>
          {rows.map((k) => (
            <div key={k} className="tl-head" style={{ ['--h' as string]: `${ROW_H[k]}px` }}>
              <span className="sw" style={{ background: `var(--t-${k})` }} />
              <span className="nm">{TRACK_LABEL[k]}</span>
              {['dialog', 'sfx', 'score'].includes(k) && (
                <>
                  <button className={`tb ${muted.has(k) ? 'on' : ''}`} title="Mute" onClick={() => setMuted(toggleSet(muted, k))}>M</button>
                  <button className={`tb ${solo === k ? 'on' : ''}`} title="Solo" onClick={() => setSolo(solo === k ? null : k)}>S</button>
                </>
              )}
              <button className={`tb ${locked.has(k) ? 'on' : ''}`} title="Lock" onClick={() => setLocked(toggleSet(locked, k))}>{locked.has(k) ? '🔒' : 'L'}</button>
              <button className="tb" title={`Add ${TRACK_LABEL[k]} clip at playhead`} onClick={() => addAt(k)}>＋</button>
            </div>
          ))}
        </div>

        <div className="tl-scroll" ref={scroller} onScroll={(e) => heads.current && (heads.current.scrollTop = e.currentTarget.scrollTop)}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setZoom(Math.max(2, Math.min(800, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
            }
          }}>
          <div className="tl-inner" style={{ width: innerW }}>
            <div className="tl-ruler" onPointerDown={scrub}>
              {ticks.map((tk) => (
                <div key={tk.t} className={`tick ${tk.major ? '' : 'minor'}`} style={{ left: X(tk.t) }}>{tk.major ? (Number.isInteger(tk.t) ? timecode(tk.t, fps).slice(0, 5) : timecode(tk.t, fps)) : ''}</div>
              ))}
            </div>

            <div className="tl-row" style={{ ['--h' as string]: '24px' }}>
              {tl.credits.map((c) => (
                <div key={c.kind} className="tl-band credits-band" style={{ left: X(c.start), width: X(c.end - c.start) - 2 }}
                  title={`${c.credits.name} — global, edit on the Credits page (double-click)`}
                  onClick={() => seek(c.start)} onDoubleClick={() => navigate(`/credits/${c.kind}`)}>
                  {c.kind} credits
                </div>
              ))}
              {tl.scenes.map((s) => (
                <div key={s.scene.id} className="tl-band scene" style={{ left: X(s.start), width: X(s.end - s.start) - 2 }}
                  title={s.scene.title}
                  onDoubleClick={() => navigate(`/ep/${scope.episodeId}/sc/${s.scene.id}?view=timeline`)}
                  onClick={() => seek(s.start)}>
                  {s.scene.title}
                </div>
              ))}
            </div>

            <div className="tl-row" style={{ ['--h' as string]: '30px' }}>
              {tl.credits.map((c) => (
                <div key={c.kind} className="tl-band credits-band" style={{ left: X(c.start), width: X(c.end - c.start) - 2 }}
                  onClick={() => seek(c.start)} onDoubleClick={() => navigate(`/credits/${c.kind}`)}>
                  {c.credits.name}
                </div>
              ))}
              {tl.shots.map((s) => {
                const dur = shotDrag && shotDrag.shotId === s.shot.id && shotDrag.sceneId === s.sceneId ? shotDrag.dur : s.end - s.start;
                const isSel = sel?.kind === 'shot' && sel.shotId === s.shot.id && sel.sceneId === s.sceneId;
                const cur = time >= s.start && time < s.end;
                return (
                  <div key={s.sceneId + s.shot.id} className={`tl-band shot ${cur ? 'cur' : ''} ${isSel ? 'sel' : ''}`}
                    style={{ left: X(s.start), width: Math.max(4, X(dur) - 2) }}
                    title={`${s.shot.name} — ${dur.toFixed(2)}s (double-click to open)`}
                    onClick={() => setSel({ kind: 'shot', sceneId: s.sceneId, shotId: s.shot.id })}
                    onDoubleClick={() => navigate(`/ep/${scope.episodeId}/sc/${s.sceneId}/sh/${s.shot.id}?view=timeline`)}>
                    <span className="mono muted">{s.shot.id}</span> {s.shot.name}
                    {shotDrag?.shotId === s.shot.id && <span className="mono"> · {dur.toFixed(2)}s</span>}
                    <div className="grip" onPointerDown={(e) => {
                      e.stopPropagation();
                      setShotDrag({ sceneId: s.sceneId, shotId: s.shot.id, x0: e.clientX, dur0: s.shot.duration, dur: s.shot.duration });
                    }} />
                  </div>
                );
              })}
            </div>

            {rows.map((k) => (
              <div key={k} className="tl-row" style={{ ['--h' as string]: `${ROW_H[k]}px` }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    setSel(null);
                    scrub(e);
                  }
                }}
                onDoubleClick={(e) => e.target === e.currentTarget && addAt(k)}>
                {tl.clips.filter((c) => c.track === k).map((rc) => {
                  const key = clipKey(rc);
                  const d = drag?.key === key && drag.moved ? drag : null;
                  const start = d ? d.start : rc.start;
                  const end = d ? d.end : rc.end;
                  return (
                    <ClipView key={key} data={data} rc={rc} x={X(start)} w={Math.max(3, X(end - start))} selected={sel?.kind === 'clip' && sel.key === key}
                      locked={locked.has(k)} muted={effMuted.has(k)} onDown={startDrag} />
                  );
                })}
              </div>
            ))}

            <div className="playhead" style={{ left: X(time) }} />
            {drag?.snap !== undefined && <div className="snapline" style={{ left: X(drag.snap) }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;
function toggleSet<T>(s: Set<T>, v: T) {
  const n = new Set(s);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

function ClipView({ data, rc, x, w, selected, locked, muted, onDown }: {
  data: ProjectData; rc: ResolvedClip; x: number; w: number; selected: boolean; locked: boolean; muted: boolean;
  onDown: (e: React.PointerEvent, rc: ResolvedClip, m: DragMode) => void;
}) {
  const { track, clip } = rc;
  let label: React.ReactNode = clip.label ?? '';
  let body: React.ReactNode = null;
  let color = `var(--t-${track})`;
  let stale = false;
  const len = rc.end - rc.start;
  switch (track) {
    case 'storyboard': {
      const c = clip as StoryboardClip;
      label = c.label ?? c.image.split('/').pop() ?? '(no image)';
      if (c.image && !/\.(mp4|webm|mov)$/i.test(c.image)) body = <div className="bgimg" style={{ backgroundImage: `url("${mediaUrl(c.image)}")` }} />;
      break;
    }
    case 'camera': {
      const c = clip as CameraClip;
      label = c.label ?? 'camera';
      body = c.keys.map((k, i) => <span key={i} className="kf" style={{ left: `${(k.t / len) * 100}%` }} />);
      break;
    }
    case 'subtitles':
      label = (clip as SubtitleClip).text;
      break;
    case 'dialog': {
      const c = clip as DialogClip;
      const ch = data.characters[c.characterId];
      color = ch?.color ?? color;
      label = (
        <>
          <b>{ch?.name ?? c.characterId}</b> {c.text}
        </>
      );
      stale = !c.audio;
      if (rc.derived) {
        color = 'var(--t-subtitles)';
        label = c.text;
      } else if (c.audio) body = <Waveform url={mediaUrl(c.audio)!} duration={len} color="rgba(255,255,255,.45)" width={w} />;
      break;
    }
    case 'sfx': {
      const c = clip as SfxClip;
      label = c.label ?? c.file.split('/').pop();
      body = <Waveform url={mediaUrl(c.file)!} duration={len} color="rgba(255,255,255,.45)" width={w} />;
      break;
    }
    case 'score': {
      const c = clip as ScoreClip;
      const cue = data.cues[c.cueId];
      label = cue ? `${rc.credits ? `${rc.credits} credits · ` : ''}${cue.name} · seed ${cue.seed}` : `missing cue ${c.cueId}`;
      stale = !cue;
      if (cue) body = cue.replacement?.endsWith('.wav') ? <Waveform url={mediaUrl(cue.replacement)!} offset={c.offset} duration={len} color="rgba(255,255,255,.45)" width={w} /> : <NoteRoll cue={cue} offset={c.offset} duration={len} width={w} />;
      break;
    }
  }
  const canTrimLeft = !['dialog', 'sfx'].includes(track);
  return (
    <div
      className={`clip ${selected ? 'sel' : ''} ${rc.derived ? 'derived' : ''} ${rc.credits ? 'credits-clip' : ''} ${locked ? 'locked' : ''} ${stale ? 'stale' : ''}`}
      style={{ left: x, width: w, ['--c' as string]: color, opacity: muted ? 0.4 : undefined }}
      title={typeof label === 'string' ? label : undefined}
      onPointerDown={(e) => onDown(e, rc, 'move')}
    >
      {body}
      <div className="lbl">{label}</div>
      {!rc.derived && !rc.credits && !locked && (
        <>
          {canTrimLeft && <div className="edge l" onPointerDown={(e) => onDown(e, rc, 'l')} />}
          <div className="edge r" onPointerDown={(e) => onDown(e, rc, 'r')} />
        </>
      )}
    </div>
  );
}
