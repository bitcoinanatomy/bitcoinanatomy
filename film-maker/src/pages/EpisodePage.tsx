import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Table } from '../components/Table';
import { Header, StatusPill, StatusSelect, TextInput, Thumb, useView, ViewToggle } from '../components/ui';
import { sceneThumb } from '../lib/thumbs';
import type { Scene } from '../model/schema';
import { episodeDuration, episodeScenes, fmtDuration, sceneDuration, timecode, type Scope } from '../model/timeline';
import { addScene, deleteScene, moveScene, updateEpisode, updateScene } from '../store/actions';
import { useData } from '../store/store';
import { PlayerOverlay } from '../timeline/PlayerOverlay';
import { TimelineEditor } from '../timeline/TimelineEditor';

export function EpisodePage() {
  const { epId = '' } = useParams();
  const data = useData();
  const [view, setView] = useView('grid');
  const navigate = useNavigate();
  const [playFrom, setPlayFrom] = useState<number | null>(null);
  const ep = data.episodes[epId];
  const scope = useMemo<Scope>(() => ({ kind: 'episode', episodeId: epId }), [epId]);
  if (!ep) return <div className="empty">Episode not found</div>;
  const scenes = episodeScenes(data, epId);
  let acc = 0;
  const starts = scenes.map((s) => ((acc += sceneDuration(s)), acc - sceneDuration(s)));
  const crumbs = [{ label: 'Episodes', to: '/episodes' }, { label: `${ep.number}. ${ep.title}` }];
  const toggle = <ViewToggle value={view} onChange={setView} modes={['grid', 'table', 'timeline']} />;

  if (view === 'timeline')
    return (
      <>
        <Header crumbs={crumbs}>{toggle}</Header>
        <div className="page flush"><TimelineEditor scope={scope} /></div>
      </>
    );

  const add = () => navigate(`/ep/${epId}/sc/${addScene(epId)}`);
  return (
    <>
      <Header crumbs={crumbs}>
        {toggle}
        <button className="btn" onClick={() => setPlayFrom(0)} title="Play the whole episode">▶ Play</button>
        <button className="btn primary" onClick={add}>＋ Scene</button>
      </Header>
      {playFrom !== null && <PlayerOverlay scope={scope} from={playFrom} onClose={() => setPlayFrom(null)} />}
      <div className="page">
        <div className="page-head">
          <div className="grow col" style={{ gap: 6 }}>
            <div className="row">
              <span className="pill mono">EP {ep.number}</span>
              <TextInput className="input bare" value={ep.title} onChange={(v) => updateEpisode(epId, (e) => void (e.title = v), 'title')} />
            </div>
            <TextInput multiline rows={2} className="input bare" value={ep.synopsis} placeholder="Synopsis…" onChange={(v) => updateEpisode(epId, (e) => void (e.synopsis = v), 'syn')} />
            <div className="row muted">
              <StatusSelect value={ep.status} onChange={(s) => updateEpisode(epId, (e) => void (e.status = s))} />
              {scenes.length} scenes · {scenes.reduce((n, s) => n + s.shots.length, 0)} shots · {fmtDuration(episodeDuration(data, epId))}
            </div>
          </div>
          <Link className="btn" to="?view=timeline">Open timeline</Link>
        </div>

        {view === 'table' ? (
          <Table<Scene>
            rows={scenes}
            rowKey={(s) => s.id}
            cols={[
              { key: 'n', label: '#', width: 36, className: 'num', render: (_, i) => i + 1 },
              { key: 'thumb', label: '', width: 96, className: 'thumbcell', render: (s) => <Link to={`/ep/${epId}/sc/${s.id}`} className="t" style={{ backgroundImage: `url(/project/${sceneThumb(s) ?? ''})` }} /> },
              { key: 'title', label: 'Scene', width: 220, sort: (s) => s.title, render: (s) => <TextInput className="input bare" value={s.title} onChange={(v) => updateScene(s.id, (x) => void (x.title = v), 'title')} /> },
              { key: 'sum', label: 'Summary', render: (s) => <TextInput multiline rows={2} className="input bare" value={s.summary} onChange={(v) => updateScene(s.id, (x) => void (x.summary = v), 'sum')} /> },
              { key: 'env', label: 'Environment', width: 150, sort: (s) => s.environmentId ?? '', render: (s) => (
                <select className="select" value={s.environmentId ?? ''} onChange={(e) => updateScene(s.id, (x) => void (x.environmentId = e.target.value || undefined))}>
                  <option value="">—</option>
                  {Object.values(data.environments).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              ) },
              { key: 'tc', label: 'In', width: 80, className: 'num', render: (_, i) => timecode(starts[i], data.project.fps) },
              { key: 'shots', label: 'Shots', width: 60, className: 'num', sort: (s) => s.shots.length, render: (s) => s.shots.length },
              { key: 'dur', label: 'Dur', width: 70, className: 'num', sort: (s) => sceneDuration(s), render: (s) => fmtDuration(sceneDuration(s)) },
              { key: 'st', label: 'Status', width: 90, sort: (s) => s.status, render: (s) => <StatusSelect value={s.status} onChange={(v) => updateScene(s.id, (x) => void (x.status = v))} /> },
              { key: 'act', label: '', width: 190, render: (s, i) => (
                <div className="row" style={{ gap: 2 }}>
                  <button className="btn sm ghost" title="Play from this scene" onClick={() => setPlayFrom(starts[i])}>▶</button>
                  <button className="btn sm ghost" onClick={() => moveScene(epId, i, -1)}>↑</button>
                  <button className="btn sm ghost" onClick={() => moveScene(epId, i, 1)}>↓</button>
                  <Link className="btn sm" to={`/ep/${epId}/sc/${s.id}`}>Open</Link>
                  <button className="btn sm ghost danger" onClick={() => confirm(`Delete scene “${s.title}”?`) && deleteScene(s.id)}>✕</button>
                </div>
              ) },
            ]}
          />
        ) : (
          <div className="grid">
            {scenes.map((s, i) => (
              <Link key={s.id} to={`/ep/${epId}/sc/${s.id}`} className="tile">
                <Thumb src={sceneThumb(s)} text={s.summary} badge={`SC ${i + 1}`} dur={fmtDuration(sceneDuration(s))} />
                <div className="body">
                  <div className="title">{s.title}</div>
                  <div className="desc">{s.summary}</div>
                  <div className="meta">
                    <StatusPill s={s.status} />
                    <span>{s.shots.length} shots</span>
                    {s.environmentId && <span className="tag">{data.environments[s.environmentId]?.name}</span>}
                  </div>
                </div>
                <div className="acts" onClick={(e) => e.preventDefault()}>
                  <button className="btn sm" title="Play from this scene" onClick={() => setPlayFrom(starts[i])}>▶</button>
                  <button className="btn sm" title="Move earlier" onClick={() => moveScene(epId, i, -1)}>←</button>
                  <button className="btn sm" title="Move later" onClick={() => moveScene(epId, i, 1)}>→</button>
                </div>
              </Link>
            ))}
            <div className="tile add" onClick={add}>＋ New scene</div>
          </div>
        )}
      </div>
    </>
  );
}
