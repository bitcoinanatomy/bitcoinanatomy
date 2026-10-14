import { Link, useNavigate } from 'react-router-dom';
import { Table } from '../components/Table';
import { Header, StatusPill, StatusSelect, TextInput, Thumb, useView, ViewToggle } from '../components/ui';
import { sceneThumb } from '../lib/thumbs';
import type { Episode } from '../model/schema';
import { episodeDuration, episodeScenes, fmtDuration } from '../model/timeline';
import { addEpisode, deleteEpisode, moveEpisode, updateEpisode } from '../store/actions';
import { useData } from '../store/store';

export function EpisodesPage() {
  const data = useData();
  const [view, setView] = useView('grid');
  const navigate = useNavigate();
  const eps = data.project.episodes.map((id) => data.episodes[id]).filter(Boolean);
  const add = () => navigate(`/ep/${addEpisode()}`);

  return (
    <>
      <Header crumbs={[{ label: 'Episodes' }]}>
        <ViewToggle value={view} onChange={setView} modes={['grid', 'table']} />
        <button className="btn primary" onClick={add}>＋ Episode</button>
      </Header>
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>Episodes</h1>
            <p>{eps.length} episodes · {fmtDuration(eps.reduce((s, e) => s + episodeDuration(data, e.id), 0))} total</p>
          </div>
        </div>
        {view === 'table' ? (
          <Table<Episode>
            rows={eps}
            rowKey={(e) => e.id}
            cols={[
              { key: 'n', label: '#', width: 40, className: 'num', sort: (e) => e.number, render: (e) => e.number },
              { key: 'thumb', label: '', width: 96, className: 'thumbcell', render: (e) => <Link to={`/ep/${e.id}`} className="t" style={{ backgroundImage: `url(/project/${episodeScenes(data, e.id).map(sceneThumb).find(Boolean) ?? ''})` }} /> },
              { key: 'title', label: 'Title', width: 220, sort: (e) => e.title, render: (e) => <TextInput className="input bare" value={e.title} onChange={(v) => updateEpisode(e.id, (x) => void (x.title = v), 'title')} /> },
              { key: 'syn', label: 'Synopsis', render: (e) => <TextInput multiline rows={2} className="input bare" value={e.synopsis} onChange={(v) => updateEpisode(e.id, (x) => void (x.synopsis = v), 'syn')} /> },
              { key: 'sc', label: 'Scenes', width: 70, className: 'num', sort: (e) => e.scenes.length, render: (e) => e.scenes.length },
              { key: 'dur', label: 'Duration', width: 90, className: 'num', sort: (e) => episodeDuration(data, e.id), render: (e) => fmtDuration(episodeDuration(data, e.id)) },
              { key: 'st', label: 'Status', width: 90, sort: (e) => e.status, render: (e) => <StatusSelect value={e.status} onChange={(s) => updateEpisode(e.id, (x) => void (x.status = s))} /> },
              { key: 'act', label: '', width: 150, render: (e, i) => (
                <div className="row" style={{ gap: 2 }}>
                  <button className="btn sm ghost" onClick={() => moveEpisode(i, -1)}>↑</button>
                  <button className="btn sm ghost" onClick={() => moveEpisode(i, 1)}>↓</button>
                  <Link className="btn sm" to={`/ep/${e.id}?view=timeline`}>Timeline</Link>
                  <button className="btn sm ghost danger" onClick={() => confirm(`Delete episode “${e.title}” and all its scenes?`) && deleteEpisode(e.id)}>✕</button>
                </div>
              ) },
            ]}
          />
        ) : (
          <div className="grid lg">
            {eps.map((e) => {
              const scs = episodeScenes(data, e.id);
              return (
                <Link key={e.id} to={`/ep/${e.id}`} className="tile">
                  <Thumb src={scs.map(sceneThumb).find(Boolean)} text={e.synopsis} badge={`EP ${e.number}`} dur={fmtDuration(episodeDuration(data, e.id))} />
                  <div className="body">
                    <div className="title">{e.title}</div>
                    <div className="desc">{e.synopsis}</div>
                    <div className="meta">
                      <StatusPill s={e.status} />
                      <span>{scs.length} scenes · {scs.reduce((n, s) => n + s.shots.length, 0)} shots</span>
                    </div>
                  </div>
                </Link>
              );
            })}
            <div className="tile add" onClick={add}>＋ New episode</div>
          </div>
        )}
      </div>
    </>
  );
}
