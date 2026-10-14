import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { transport, usePlayback } from '../audio/player';
import { resolveTimeline, timecode, type Scope } from '../model/timeline';
import { useData } from '../store/store';
import { Monitor, type MonitorMode, type ViewportHandle } from './Monitor';

/** Full-screen playback of a scope (episode/scene) with the timeline's Monitor + transport. */
export function PlayerOverlay({ scope, from = 0, onClose }: { scope: Scope; from?: number; onClose: () => void }) {
  const data = useData();
  const tl = useMemo(() => resolveTimeline(data, scope), [data, scope]);
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);
  const loading = usePlayback((s) => s.loading);
  const [mode, setMode] = useState<MonitorMode>(() => (localStorage.getItem('fm.monitor') as MonitorMode) || 'split');
  const viewport = useRef<ViewportHandle | null>(null);
  const tlRef = useRef(tl);
  tlRef.current = tl;

  useEffect(() => localStorage.setItem('fm.monitor', mode), [mode]);

  const play = useCallback(() => {
    transport.muted = new Set();
    const t = usePlayback.getState().time;
    void transport.play(tl, data, t >= tl.duration ? 0 : t);
  }, [tl, data]);
  const toggle = useCallback(() => (usePlayback.getState().playing ? transport.pause() : play()), [play]);
  const seek = useCallback((t: number) => transport.seek(Math.max(0, Math.min(tl.duration, t))), [tl.duration]);

  // start from the requested point on open; stop on close
  useEffect(() => {
    transport.stop();
    transport.muted = new Set();
    usePlayback.setState({ time: from });
    void transport.play(tlRef.current, data, from);
    return () => transport.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ') (e.preventDefault(), toggle());
      else if (e.key === 'ArrowLeft') seek(usePlayback.getState().time - 5);
      else if (e.key === 'ArrowRight') seek(usePlayback.getState().time + 5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, toggle, seek]);

  const fps = data.project.fps;
  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player" onClick={(e) => e.stopPropagation()}>
        <Monitor data={data} tl={tl} time={time} mode={mode} pilot={false} safe={false} handle={viewport} />
        <div className="player-bar">
          <button className="btn sm primary" onClick={toggle} title="Play / pause (space)">{loading ? '…' : playing ? '❚❚' : '▶'}</button>
          <span className="mono muted">{timecode(time, fps)}</span>
          <input className="grow" type="range" min={0} max={tl.duration} step={1 / fps} value={Math.min(time, tl.duration)} onChange={(e) => seek(Number(e.target.value))} />
          <span className="mono muted">{timecode(tl.duration, fps)}</span>
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as MonitorMode)}>
            <option value="split">Split</option>
            <option value="board">Board</option>
            <option value="3d">3D</option>
          </select>
          <button className="btn sm ghost" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
      </div>
    </div>
  );
}
