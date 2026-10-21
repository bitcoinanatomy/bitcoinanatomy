import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Field, Header, NumInput, StatusSelect, TextInput, Upload, useView, ViewToggle } from '../components/ui';
import { api, mediaUrl } from '../lib/api';
import { resolveTimeline, uid, type Owner, type Scope } from '../model/timeline';
import { addClip, deleteShot, duplicateShot, newDialog, removeClip, updateClip, updateShot } from '../store/actions';
import { useData, useStore } from '../store/store';
import { Monitor, type ViewportHandle } from '../timeline/Monitor';
import { TimelineEditor } from '../timeline/TimelineEditor';

export function ShotPage() {
  const { epId = '', scId = '', shId = '' } = useParams();
  const data = useData();
  const [view, setView] = useView('details');
  const navigate = useNavigate();
  const scope = useMemo<Extract<Scope, { kind: 'shot' }>>(() => ({ kind: 'shot', episodeId: epId, sceneId: scId, shotId: shId }), [epId, scId, shId]);
  const sc = data.scenes[scId];
  const shot = sc?.shots.find((s) => s.id === shId);
  if (!sc || !shot) return <div className="empty">Shot not found</div>;
  const ep = data.episodes[sc.episodeId];
  const i = sc.shots.indexOf(shot);
  const crumbs = [
    { label: 'Episodes', to: '/episodes' },
    { label: `${ep.number}. ${ep.title}`, to: `/ep/${ep.id}` },
    { label: sc.title, to: `/ep/${ep.id}/sc/${sc.id}` },
    { label: `${shot.id} · ${shot.name}` },
  ];
  const go = (j: number) => navigate(`/ep/${epId}/sc/${scId}/sh/${sc.shots[j].id}?view=${view}`);
  const header = (
    <Header crumbs={crumbs}>
      <div className="row" style={{ gap: 2 }}>
        <button className="btn ghost icon" disabled={i <= 0} onClick={() => go(i - 1)}>‹</button>
        <button className="btn ghost icon" disabled={i >= sc.shots.length - 1} onClick={() => go(i + 1)}>›</button>
      </div>
      <ViewToggle value={view} onChange={setView} modes={['details', 'timeline']} />
    </Header>
  );
  if (view === 'timeline')
    return (
      <>
        {header}
        <div className="page flush"><TimelineEditor scope={scope} /></div>
      </>
    );
  return (
    <>
      {header}
      <ShotDetails scope={scope} />
    </>
  );
}

function ShotDetails({ scope }: { scope: Extract<Scope, { kind: 'shot' }> }) {
  const data = useData();
  const navigate = useNavigate();
  const { sceneId, shotId } = scope;
  const sc = data.scenes[sceneId];
  const shot = sc.shots.find((s) => s.id === shotId)!;
  const owner: Owner = scope;
  const tl = useMemo(() => resolveTimeline(data, scope), [data, scope]);
  const [t, setT] = useState(shot.duration / 2);
  const vp = useRef<ViewportHandle | null>(null);
  const up = (fn: Parameters<typeof updateShot>[2], c?: string) => updateShot(sceneId, shotId, fn, c);
  const time = Math.min(t, tl.duration - 0.01);

  const snapshotBoard = async () => {
    const url = vp.current?.snapshot();
    if (!url) return;
    const blob = await (await fetch(url)).blob();
    const r = await api.upload(blob, 'media/boards', `${sceneId}_${shotId}_${Date.now()}.jpg`);
    addClip(owner, 'storyboard', { id: uid('brd'), start: 0, duration: shot.duration, image: r.path });
    useStore.getState().notify('Saved the 3D frame as a storyboard panel');
  };

  return (
    <div className="page">
      <div className="detail">
        <div className="col" style={{ gap: 12 }}>
          <div style={{ height: 'min(50vh, 420px)', display: 'flex' }}>
            <Monitor data={data} tl={tl} time={time} mode="split" pilot={false} safe={false} handle={vp} />
          </div>
          <div className="row">
            <input type="range" className="grow" min={0} max={shot.duration} step={1 / data.project.fps} value={time} onChange={(e) => setT(Number(e.target.value))} />
            <span className="mono muted">{time.toFixed(2)}s</span>
            <button className="btn sm" onClick={() => void snapshotBoard()} title="Render the 3D view to a PNG storyboard panel">📷 3D frame → board</button>
          </div>

          <div className="card pad">
            <h3>Storyboard panels</h3>
            <div className="refs" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {shot.tracks.storyboard.map((b) => (
                <div key={b.id} className="col" style={{ gap: 4 }}>
                  {/\.(mp4|webm|mov)$/i.test(b.image) ? <video src={mediaUrl(b.image)} muted loop autoPlay style={{ width: '100%', borderRadius: 6 }} /> : <img src={mediaUrl(b.image)} style={{ aspectRatio: '16/9' }} alt="" />}
                  <div className="row muted" style={{ fontSize: 11 }}>
                    <span className="grow">{b.start}s → {(b.start + b.duration).toFixed(1)}s</span>
                    <button className="btn sm ghost danger" onClick={() => removeClip(owner, 'storyboard', b.id)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <Upload dir="media/boards" accept="image/*,video/*" onDone={(p) => addClip(owner, 'storyboard', { id: uid('brd'), start: 0, duration: shot.duration, image: p })}>
                Drop storyboard images / GIFs / MP4 here
              </Upload>
            </div>
          </div>

          <div className="card pad">
            <h3 className="row">Dialog <span className="grow" />
              <button className="btn sm" onClick={() => addClip(owner, 'dialog', newDialog(Object.keys(data.characters)[0] ?? 'narrator', 'New line.', shot.tracks.dialog.reduce((e, d) => Math.max(e, d.start + d.duration + 0.3), 0.5)))}>＋ Line</button>
            </h3>
            <div className="col">
              {shot.tracks.dialog.map((d) => (
                <div key={d.id} className="key">
                  <div className="kh">
                    <select className="select" style={{ width: 150 }} value={d.characterId} onChange={(e) => updateClip(owner, 'dialog', d.id, (c) => Object.assign(c, { characterId: e.target.value, audio: undefined, audioHash: undefined }))}>
                      {Object.values(data.characters).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <span className="muted">at</span>
                    <div style={{ width: 70 }}><NumInput value={d.start} min={0} onChange={(v) => updateClip(owner, 'dialog', d.id, (c) => void (c.start = v))} /></div>
                    <span className="muted mono" style={{ fontSize: 11 }}>{d.duration.toFixed(2)}s</span>
                    <span className="grow" />
                    {d.audio ? <audio controls src={mediaUrl(d.audio)} style={{ height: 28, width: 200 }} /> : <span className="pill" style={{ color: 'var(--danger)' }}>no audio</span>}
                    <button className="btn sm ghost danger" onClick={() => removeClip(owner, 'dialog', d.id)}>✕</button>
                  </div>
                  <TextInput multiline rows={2} value={d.text} onChange={(v) => updateClip(owner, 'dialog', d.id, (c) => Object.assign(c, { text: v, audio: undefined, audioHash: undefined }), 'text')} />
                </div>
              ))}
              {!shot.tracks.dialog.length && <div className="muted">No dialog in this shot.</div>}
            </div>
          </div>
        </div>

        <div className="card pad col" style={{ gap: 12 }}>
          <Field label="Name"><TextInput value={shot.name} onChange={(v) => up((s) => void (s.name = v), 'name')} /></Field>
          <div className="fields">
            <Field label="Duration (s)"><NumInput value={shot.duration} min={0.1} step={0.5} onChange={(v) => up((s) => void (s.duration = v))} /></Field>
            <Field label="Status"><StatusSelect value={shot.status} onChange={(v) => up((s) => void (s.status = v))} /></Field>
          </div>
          <Field label="Environment">
            <select className="select" value={shot.environmentId ?? ''} onChange={(e) => up((s) => void (s.environmentId = e.target.value || undefined))}>
              <option value="">(scene: {sc.environmentId ? data.environments[sc.environmentId]?.name : 'none'})</option>
              {Object.values(data.environments).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          <Field label="Characters in shot">
            <div className="row wrap">
              {Object.values(data.characters).map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={shot.characters.includes(c.id)} onChange={(e) => up((s) => void (s.characters = e.target.checked ? [...s.characters, c.id] : s.characters.filter((x) => x !== c.id)))} />
                  {c.name}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Extra assets in shot">
            <div className="row wrap">
              {Object.values(data.assets).map((a) => (
                <label key={a.id} className="check">
                  <input type="checkbox" checked={shot.assets.includes(a.id)} onChange={(e) => up((s) => void (s.assets = e.target.checked ? [...s.assets, a.id] : s.assets.filter((x) => x !== a.id)))} />
                  {a.name}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Visual / description"><TextInput multiline rows={5} value={shot.description} onChange={(v) => up((s) => void (s.description = v), 'desc')} /></Field>
          <Field label="Notes / research"><TextInput multiline rows={6} value={shot.notes} onChange={(v) => up((s) => void (s.notes = v), 'notes')} /></Field>
          <div className="section col">
            <h3>Tracks</h3>
            <div className="muted" style={{ fontSize: 12 }}>
              {shot.tracks.camera.length} camera · {shot.tracks.storyboard.length} boards · {shot.tracks.dialog.length} dialog · {shot.tracks.subtitles.length} subtitles · {shot.tracks.sfx.length} sfx · {shot.tracks.score.length} score
            </div>
            <div className="row">
              <button className="btn sm" onClick={() => navigate('?view=timeline')}>Edit in timeline</button>
              <button className="btn sm" onClick={() => navigate(`/ep/${scope.episodeId}/sc/${sceneId}/sh/${duplicateShot(sceneId, shotId)}`)}>Duplicate</button>
              <button className="btn sm danger" onClick={() => {
                if (!confirm(`Delete shot “${shot.name}”?`)) return;
                deleteShot(sceneId, shotId);
                navigate(`/ep/${scope.episodeId}/sc/${sceneId}`);
              }}>Delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
