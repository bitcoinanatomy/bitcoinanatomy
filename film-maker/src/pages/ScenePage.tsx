import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Table } from '../components/Table';
import { Header, NumInput, StatusPill, StatusSelect, TextInput, Thumb, useView, ViewToggle } from '../components/ui';
import { shotThumb } from '../lib/thumbs';
import type { Shot } from '../model/schema';
import { fmtDuration, sceneDuration, timecode, type Scope } from '../model/timeline';
import { addShot, deleteShot, duplicateShot, moveShot, updateScene, updateShot } from '../store/actions';
import { useData } from '../store/store';
import { TimelineEditor } from '../timeline/TimelineEditor';

export function ScenePage() {
  const { epId = '', scId = '' } = useParams();
  const data = useData();
  const [view, setView] = useView('grid');
  const navigate = useNavigate();
  const sc = data.scenes[scId];
  const scope = useMemo<Scope>(() => ({ kind: 'scene', episodeId: epId, sceneId: scId }), [epId, scId]);
  if (!sc) return <div className="empty">Scene not found</div>;
  const ep = data.episodes[sc.episodeId];
  const index = ep.scenes.indexOf(scId);
  const crumbs = [{ label: 'Episodes', to: '/episodes' }, { label: `${ep.number}. ${ep.title}`, to: `/ep/${ep.id}` }, { label: `${index + 1}. ${sc.title}` }];
  const toggle = <ViewToggle value={view} onChange={setView} modes={['grid', 'table', 'timeline']} />;
  const nav = (
    <div className="row" style={{ gap: 2 }}>
      <button className="btn ghost icon" title="Previous scene" disabled={index <= 0} onClick={() => navigate(`/ep/${epId}/sc/${ep.scenes[index - 1]}?view=${view}`)}>‹</button>
      <button className="btn ghost icon" title="Next scene" disabled={index >= ep.scenes.length - 1} onClick={() => navigate(`/ep/${epId}/sc/${ep.scenes[index + 1]}?view=${view}`)}>›</button>
    </div>
  );

  if (view === 'timeline')
    return (
      <>
        <Header crumbs={crumbs}>{nav}{toggle}</Header>
        <div className="page flush"><TimelineEditor scope={scope} /></div>
      </>
    );

  let acc = 0;
  const starts = sc.shots.map((s) => ((acc += s.duration), acc - s.duration));
  const add = () => navigate(`/ep/${epId}/sc/${scId}/sh/${addShot(scId, undefined, { environmentId: undefined })}`);
  const go = (s: Shot) => `/ep/${epId}/sc/${scId}/sh/${s.id}`;

  return (
    <>
      <Header crumbs={crumbs}>
        {nav}
        {toggle}
        <button className="btn primary" onClick={add}>＋ Shot</button>
      </Header>
      <div className="page">
        <div className="page-head">
          <div className="grow col" style={{ gap: 6 }}>
            <TextInput className="input bare" value={sc.title} onChange={(v) => updateScene(scId, (x) => void (x.title = v), 'title')} />
            <TextInput multiline rows={2} className="input bare" value={sc.summary} placeholder="Scene summary…" onChange={(v) => updateScene(scId, (x) => void (x.summary = v), 'sum')} />
            <div className="row muted">
              <StatusSelect value={sc.status} onChange={(s) => updateScene(scId, (x) => void (x.status = s))} />
              <select className="select" style={{ width: 180 }} value={sc.environmentId ?? ''} onChange={(e) => updateScene(scId, (x) => void (x.environmentId = e.target.value || undefined))}>
                <option value="">No environment</option>
                {Object.values(data.environments).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              {sc.shots.length} shots · {fmtDuration(sceneDuration(sc))}
            </div>
          </div>
          <Link className="btn" to="?view=timeline">▶ Play scene</Link>
        </div>

        {view === 'table' ? (
          <Table<Shot>
            rows={sc.shots}
            rowKey={(s) => s.id}
            cols={[
              { key: 'id', label: 'Shot', width: 50, className: 'num', sort: (s) => s.id, render: (s) => <Link to={go(s)}>{s.id}</Link> },
              { key: 'thumb', label: 'Board', width: 96, className: 'thumbcell', render: (s) => <Link to={go(s)} className="t" style={{ backgroundImage: `url(/project/${shotThumb(s) ?? ''})` }} /> },
              { key: 'name', label: 'Name', width: 170, sort: (s) => s.name, render: (s) => <TextInput className="input bare" value={s.name} onChange={(v) => updateShot(scId, s.id, (x) => void (x.name = v), 'name')} /> },
              { key: 'vo', label: 'Dialog / VO', render: (s) => (
                <div className="col" style={{ gap: 2 }}>
                  {s.tracks.dialog.map((d) => (
                    <div key={d.id} className="row" style={{ alignItems: 'flex-start', gap: 4 }}>
                      <span className="tag" style={{ marginTop: 5, color: data.characters[d.characterId]?.color }}>{data.characters[d.characterId]?.name ?? d.characterId}</span>
                      <TextInput multiline rows={2} className="input bare" value={d.text}
                        onChange={(v) => updateShot(scId, s.id, (x) => {
                          const c = x.tracks.dialog.find((y) => y.id === d.id);
                          if (c) Object.assign(c, { text: v, audio: undefined, audioHash: undefined });
                        }, `dlg:${d.id}`)} />
                    </div>
                  ))}
                  {!s.tracks.dialog.length && <span className="muted" style={{ padding: 5 }}>—</span>}
                </div>
              ) },
              { key: 'vis', label: 'Visual', render: (s) => <TextInput multiline rows={2} className="input bare" value={s.description} onChange={(v) => updateShot(scId, s.id, (x) => void (x.description = v), 'desc')} /> },
              { key: 'in', label: 'In', width: 74, className: 'num', render: (_, i) => timecode(starts[i], data.project.fps) },
              { key: 'dur', label: 'Dur (s)', width: 70, sort: (s) => s.duration, render: (s) => <NumInput className="input bare num" value={s.duration} min={0.1} step={0.5} onChange={(v) => updateShot(scId, s.id, (x) => void (x.duration = v))} /> },
              { key: 'st', label: 'Status', width: 86, sort: (s) => s.status, render: (s) => <StatusSelect value={s.status} onChange={(v) => updateShot(scId, s.id, (x) => void (x.status = v))} /> },
              { key: 'act', label: '', width: 150, render: (s, i) => (
                <div className="row" style={{ gap: 2 }}>
                  <button className="btn sm ghost" onClick={() => moveShot(scId, i, -1)}>↑</button>
                  <button className="btn sm ghost" onClick={() => moveShot(scId, i, 1)}>↓</button>
                  <button className="btn sm ghost" title="Duplicate" onClick={() => duplicateShot(scId, s.id)}>⧉</button>
                  <button className="btn sm ghost danger" onClick={() => confirm(`Delete shot “${s.name}”?`) && deleteShot(scId, s.id)}>✕</button>
                </div>
              ) },
            ]}
          />
        ) : (
          <div className="grid">
            {sc.shots.map((s, i) => (
              <Link key={s.id} to={go(s)} className="tile">
                <Thumb src={shotThumb(s)} text={s.description} badge={s.id} dur={`${s.duration}s`} />
                <div className="body">
                  <div className="title">{s.name}</div>
                  <div className="desc">{s.tracks.dialog.map((d) => d.text).join(' ') || s.description}</div>
                  <div className="meta">
                    <StatusPill s={s.status} />
                    <span className="mono">{timecode(starts[i], data.project.fps)}</span>
                    {s.tracks.camera[0]?.label && <span className="tag">{s.tracks.camera[0].label}</span>}
                  </div>
                </div>
                <div className="acts" onClick={(e) => e.preventDefault()}>
                  <button className="btn sm" title="Move earlier" onClick={() => moveShot(scId, i, -1)}>←</button>
                  <button className="btn sm" title="Move later" onClick={() => moveShot(scId, i, 1)}>→</button>
                  <button className="btn sm" title="Duplicate" onClick={() => duplicateShot(scId, s.id)}>⧉</button>
                </div>
              </Link>
            ))}
            <div className="tile add" onClick={add}>＋ New shot</div>
          </div>
        )}
      </div>
    </>
  );
}
