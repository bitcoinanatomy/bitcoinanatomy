import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header, TextInput } from '../components/ui';
import { arcFor, BEAT_COLOR, BEAT_LABEL, BEATS, referenceArc, smoothPath, type ArcData } from '../model/arc';
import type { Beat, ProjectData } from '../model/schema';
import { fmtDuration } from '../model/timeline';
import { updateEpisode, updateScene } from '../store/actions';
import { useData, useStore } from '../store/store';

const PAD = { l: 64, r: 18, t: 30, b: 26 };
const LANE = 15;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Sets a scene's tension; shots with their own tension move by the same amount. */
function setSceneTension(data: ProjectData, sceneId: string, v: number) {
  const delta = v - data.scenes[sceneId].arc.tension;
  updateScene(sceneId, (s) => {
    s.arc.tension = round(v);
    for (const sh of s.shots) if (sh.tension !== undefined) sh.tension = round(clamp01(sh.tension + delta));
  });
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round = (v: number) => Math.round(v * 100) / 100;

export function ArcChart({ data, arc, height, editable, reference, showEpisodes }: {
  data: ProjectData; arc: ArcData; height: number; editable?: boolean; reference?: boolean; showEpisodes?: boolean;
}) {
  const [ref, width] = useWidth();
  const navigate = useNavigate();
  const [drag, setDrag] = useState<{ sceneId: string; v: number } | null>(null);
  const chars = Object.values(data.characters).filter((c) => arc.presence.some((p) => p.characterId === c.id));
  const plotH = height;
  const totalH = PAD.t + plotH + PAD.b + chars.length * LANE + (chars.length ? 8 : 0);
  const W = Math.max(300, width);
  const X = (t: number) => PAD.l + (t / Math.max(1e-6, arc.duration)) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - v) * plotH;

  // live drag preview: shift that scene's points
  const delta = (sceneId: string) => (drag?.sceneId === sceneId ? drag.v - data.scenes[sceneId].arc.tension : 0);
  const pts = arc.points.map((p) => [X(p.t), Y(clamp01(p.tension + delta(p.sceneId)))] as [number, number]);
  const ends: [number, number][] = pts.length ? [[X(0), pts[0][1]], ...pts, [X(arc.duration), pts[pts.length - 1][1]]] : [];
  const path = smoothPath(ends, PAD.t, PAD.t + plotH);
  const area = path && `${path} L${X(arc.duration)},${PAD.t + plotH} L${X(0)},${PAD.t + plotH} Z`;
  const refPath = useMemo(() => {
    const r: [number, number][] = [];
    for (let i = 0; i <= 60; i++) r.push([X((i / 60) * arc.duration), Y(referenceArc(i / 60))]);
    return smoothPath(r, PAD.t, PAD.t + plotH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, arc.duration, plotH]);

  const startDrag = (e: React.PointerEvent, sceneId: string) => {
    if (!editable) return;
    e.preventDefault();
    const svg = (e.target as SVGElement).ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    const val = (cy: number) => round(clamp01(1 - (cy - rect.top - PAD.t) / plotH));
    let v = val(e.clientY);
    setDrag({ sceneId, v });
    const mv = (ev: PointerEvent) => setDrag({ sceneId, v: (v = val(ev.clientY)) });
    const up = () => {
      window.removeEventListener('pointermove', mv);
      setDrag(null);
      if (v !== data.scenes[sceneId].arc.tension) setSceneTension(data, sceneId, v);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up, { once: true });
  };

  const open = (sceneId: string) => {
    const sc = data.scenes[sceneId];
    navigate(`/ep/${sc.episodeId}/sc/${sceneId}`);
  };

  return (
    <div ref={ref} className="arc-chart">
      <svg width={W} height={totalH} viewBox={`0 0 ${W} ${totalH}`}>
        <defs>
          <linearGradient id="arcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* episode / scene bands */}
        {(showEpisodes ? arc.episodes : arc.scenes).map((s, i) => (
          <g key={s.id}>
            <rect x={X(s.start)} y={PAD.t} width={Math.max(0, X(s.end) - X(s.start))} height={plotH} fill={i % 2 ? 'rgba(255,255,255,.025)' : 'transparent'} />
            <line x1={X(s.start)} x2={X(s.start)} y1={PAD.t - (showEpisodes ? 22 : 6)} y2={PAD.t + plotH} stroke="rgba(255,255,255,.1)" />
            {showEpisodes && <text x={X(s.start) + 8} y={PAD.t - 10} className="arc-ep">{s.label}</text>}
          </g>
        ))}
        {showEpisodes && arc.scenes.map((s) => <line key={s.id} x1={X(s.start)} x2={X(s.start)} y1={PAD.t + plotH - 6} y2={PAD.t + plotH} stroke="rgba(255,255,255,.18)" />)}

        {/* axis */}
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="rgba(255,255,255,.06)" strokeDasharray={v === 0.5 ? '2 4' : undefined} />
            <text x={PAD.l - 10} y={Y(v) + 3} className="arc-axis" textAnchor="end">{v === 1 ? 'PEAK' : v === 0 ? 'CALM' : ''}</text>
          </g>
        ))}

        {reference && <path d={refPath} fill="none" stroke="rgba(255,255,255,.22)" strokeDasharray="4 5" />}
        {area && <path d={area} fill="url(#arcFill)" />}
        {path && <path d={path} fill="none" stroke="#e6e6e6" strokeWidth={2} />}

        {/* shot-level fine points */}
        {arc.points.filter((p) => p.shotId).map((p) => (
          <circle key={`${p.sceneId}/${p.shotId}`} cx={X(p.t)} cy={Y(clamp01(p.tension + delta(p.sceneId)))} r={2.5} fill="#bbb"><title>{p.label}</title></circle>
        ))}

        {/* scene handles */}
        {arc.handles.map((h) => {
          const v = drag?.sceneId === h.sceneId ? drag.v : h.tension;
          const color = h.beat ? BEAT_COLOR[h.beat] : '#666';
          return (
            <g key={h.sceneId} className={`arc-handle ${editable ? 'editable' : ''}`} onPointerDown={(e) => startDrag(e, h.sceneId)} onDoubleClick={() => open(h.sceneId)}>
              <line x1={X(h.t)} x2={X(h.t)} y1={Y(v)} y2={PAD.t + plotH} stroke={color} strokeOpacity={0.25} />
              <circle cx={X(h.t)} cy={Y(v)} r={11} fill="transparent" />
              <circle cx={X(h.t)} cy={Y(v)} r={5.5} fill="#000" stroke={color} strokeWidth={2} />
              {h.beat && h.beat !== 'rising' && (
                <text x={X(h.t)} y={Y(v) - 12} className="arc-beat" textAnchor="middle" fill={color}>{BEAT_LABEL[h.beat].toUpperCase()}</text>
              )}
              <text x={X(h.t)} y={PAD.t + plotH + 16} className="arc-scene" textAnchor="middle">{h.label}</text>
              <title>{`${h.label} — tension ${v.toFixed(2)}${h.beat ? ` · ${BEAT_LABEL[h.beat]}` : ''}${editable ? '\nDrag to change · double-click to open' : '\nDouble-click to open'}`}</title>
            </g>
          );
        })}

        {/* character presence lanes */}
        {chars.map((c, i) => {
          const y = PAD.t + plotH + PAD.b + 8 + i * LANE;
          const max = Math.max(1, ...arc.presence.filter((p) => p.characterId === c.id).map((p) => p.lines));
          return (
            <g key={c.id}>
              <text x={PAD.l - 10} y={y + 9} className="arc-axis" textAnchor="end">{c.name.toUpperCase()}</text>
              <line x1={PAD.l} x2={W - PAD.r} y1={y + 5.5} y2={y + 5.5} stroke="rgba(255,255,255,.05)" />
              {arc.presence.filter((p) => p.characterId === c.id).map((p) => (
                <rect key={p.sceneId} x={X(p.start) + 1} y={y + 1} width={Math.max(2, X(p.end) - X(p.start) - 2)} height={9} rx={2}
                  fill={c.color} fillOpacity={0.25 + 0.6 * (p.lines / max)}>
                  <title>{`${c.name} · ${data.scenes[p.sceneId]?.title} · ${p.lines} line${p.lines === 1 ? '' : 's'}`}</title>
                </rect>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BeatSelect({ value, onChange }: { value?: Beat; onChange: (b?: Beat) => void }) {
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as Beat | undefined)}
      style={{ color: value ? BEAT_COLOR[value] : undefined }}>
      <option value="">—</option>
      {BEATS.map((b) => <option key={b} value={b}>{BEAT_LABEL[b]}</option>)}
    </select>
  );
}

export function ArcsPage() {
  const data = useData();
  const [reference, setReference] = useState(true);
  const eps = data.project.episodes.filter((id) => data.episodes[id]);
  const season = useMemo(() => arcFor(data, eps), [data, eps]);
  const mutate = useStore((s) => s.mutate);

  return (
    <>
      <Header crumbs={[{ label: 'Story arcs' }]}>
        <button className={`btn sm ${reference ? 'on' : ''}`} onClick={() => setReference(!reference)} title="Dashed classic rising-action curve for comparison">Reference curve</button>
      </Header>
      <div className="page">
        <div className="page-head">
          <div className="grow col" style={{ gap: 4 }}>
            <TextInput className="input bare" value={data.project.season.title} placeholder={`${data.project.title} — Season 1`}
              onChange={(v) => mutate('edit season', (d) => void (d.project.season.title = v), 'season-title')} />
            <TextInput multiline rows={2} className="input bare" value={data.project.season.logline} placeholder="Season logline — what this season is about, in one or two sentences…"
              onChange={(v) => mutate('edit season', (d) => void (d.project.season.logline = v), 'season-logline')} />
          </div>
        </div>

        <div className="card pad">
          <h3 className="row">Season arc <span className="grow" /><span className="muted" style={{ letterSpacing: 0, textTransform: 'none' }}>{eps.length} episodes · {fmtDuration(season.duration)}</span></h3>
          <ArcChart data={data} arc={season} height={220} reference={reference} showEpisodes editable />
          <div className="legend">
            {BEATS.map((b) => <span key={b}><i style={{ background: BEAT_COLOR[b] }} />{BEAT_LABEL[b]}</span>)}
            <span className="grow" />
            <span>drag a point to change tension · double-click to open the scene</span>
          </div>
        </div>

        {eps.map((id) => {
          const ep = data.episodes[id];
          return <EpisodeArc key={id} data={data} episodeId={id} reference={reference} title={`${ep.number}. ${ep.title}`} />;
        })}
      </div>
    </>
  );
}

function EpisodeArc({ data, episodeId, reference, title }: { data: ProjectData; episodeId: string; reference: boolean; title: string }) {
  const ep = data.episodes[episodeId];
  const arc = useMemo(() => arcFor(data, [episodeId]), [data, episodeId]);
  const navigate = useNavigate();
  return (
    <div className="card pad" style={{ marginTop: 16 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16, marginBottom: 6 }}>
        <div className="grow col" style={{ gap: 2 }}>
          <div className="arc-title" onClick={() => navigate(`/ep/${episodeId}`)}>{title}</div>
          <TextInput className="input bare" value={ep.theme} placeholder="Theme — what it's really about…" onChange={(v) => updateEpisode(episodeId, (e) => void (e.theme = v), 'theme')} />
        </div>
        <div className="field" style={{ width: 170 }}>
          <label>Role in season</label>
          <BeatSelect value={ep.arc.beat} onChange={(b) => updateEpisode(episodeId, (e) => void (e.arc.beat = b))} />
        </div>
        <button className="btn sm" onClick={() => navigate(`/ep/${episodeId}?view=timeline`)}>Timeline</button>
      </div>
      <ArcChart data={data} arc={arc} height={150} reference={reference} editable />
      <table className="data arc-table">
        <thead>
          <tr><th style={{ width: 28 }}>#</th><th>Scene</th><th style={{ width: 170 }}>Beat</th><th style={{ width: 200 }}>Tension</th><th>Note</th></tr>
        </thead>
        <tbody>
          {ep.scenes.map((scId, i) => {
            const sc = data.scenes[scId];
            if (!sc) return null;
            return (
              <tr key={scId}>
                <td className="num">{i + 1}</td>
                <td><a className="arc-link" onClick={() => navigate(`/ep/${episodeId}/sc/${scId}`)}>{sc.title}</a></td>
                <td><BeatSelect value={sc.arc.beat} onChange={(b) => updateScene(scId, (s) => void (s.arc.beat = b))} /></td>
                <td>
                  <div className="row">
                    <input type="range" min={0} max={1} step={0.05} value={sc.arc.tension} className="grow" onChange={(e) => setSceneTension(data, scId, Number(e.target.value))} />
                    <span className="mono muted" style={{ width: 30 }}>{sc.arc.tension.toFixed(2)}</span>
                  </div>
                </td>
                <td><TextInput className="input bare" value={sc.arc.note} placeholder="What changes for the characters?" onChange={(v) => updateScene(scId, (s) => void (s.arc.note = v), 'arc-note')} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
