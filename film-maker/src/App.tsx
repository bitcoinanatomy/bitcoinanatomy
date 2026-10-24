import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { episodeDuration, fmtDuration } from './model/timeline';
import { ArcsPage } from './pages/ArcsPage';
import { CreditsEditPage, CreditsListPage } from './pages/CreditsPage';
import { Dashboard } from './pages/Dashboard';
import { EpisodePage } from './pages/EpisodePage';
import { EpisodesPage } from './pages/EpisodesPage';
import { ExportPage } from './pages/ExportPage';
import { LibraryDetail, LibraryPage } from './pages/Library';
import { ScenePage } from './pages/ScenePage';
import { CuePage, ScorePage } from './pages/ScorePage';
import { ShotPage } from './pages/ShotPage';
import { ShotsPage } from './pages/ShotsPage';
import { TreatmentsPage } from './pages/TreatmentsPage';
import { useStore } from './store/store';

export function App() {
  const data = useStore((s) => s.data);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    useStore.getState().load().catch((e) => setErr(String(e)));
  }, []);

  // global undo/redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if (e.target instanceof Element && e.target.closest('input, textarea')) return;
      e.preventDefault();
      if (e.shiftKey) useStore.getState().redo();
      else useStore.getState().undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (err) return <div className="empty">Could not load project: {err}</div>;
  if (!data) return <div className="empty">Loading project…</div>;
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/episodes" element={<EpisodesPage />} />
          <Route path="/arcs" element={<ArcsPage />} />
          <Route path="/treatments" element={<TreatmentsPage />} />
          <Route path="/credits" element={<CreditsListPage />} />
          <Route path="/credits/:id" element={<CreditsEditPage />} />
          <Route path="/ep/:epId" element={<EpisodePage />} />
          <Route path="/ep/:epId/sc/:scId" element={<ScenePage />} />
          <Route path="/ep/:epId/sc/:scId/sh/:shId" element={<ShotPage />} />
          <Route path="/characters" element={<LibraryPage kind="characters" />} />
          <Route path="/characters/:id" element={<LibraryDetail kind="characters" />} />
          <Route path="/environments" element={<LibraryPage kind="environments" />} />
          <Route path="/environments/:id" element={<LibraryDetail kind="environments" />} />
          <Route path="/assets" element={<LibraryPage kind="assets" />} />
          <Route path="/shots" element={<ShotsPage />} />
          <Route path="/assets/:id" element={<LibraryDetail kind="assets" />} />
          <Route path="/score" element={<ScorePage />} />
          <Route path="/score/:id" element={<CuePage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="*" element={<div className="empty">Not found</div>} />
        </Routes>
      </main>
      <Toast />
    </div>
  );
}

function Sidebar() {
  const data = useStore((s) => s.data)!;
  const loc = useLocation();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">▶</div>
        <div>
          <b>{data.project.title}</b>
          <span>Film Maker</span>
        </div>
      </div>
      <nav className="nav">
        <NavLink to="/" end><span className="ico">◉</span>Dashboard</NavLink>
        <div className="nav-label">Story</div>
        <NavLink to="/arcs"><span className="ico">∿</span>Story arcs</NavLink>
        <NavLink to="/treatments"><span className="ico">▣</span>Treatments</NavLink>
        <NavLink to="/episodes" end><span className="ico">▤</span>Episodes</NavLink>
        {data.project.episodes.map((id) => {
          const ep = data.episodes[id];
          if (!ep) return null;
          return (
            <NavLink key={id} to={`/ep/${id}`} className={() => `sub ${loc.pathname.startsWith(`/ep/${id}`) ? 'active' : ''}`}>
              <span className="grow">{ep.number}. {ep.title}</span>
              <span className="muted mono" style={{ fontSize: 10.5 }}>{fmtDuration(episodeDuration(data, id))}</span>
            </NavLink>
          );
        })}
        <div className="nav-label">Credits</div>
        <NavLink to="/credits" end><span className="ico">◫</span>All credits</NavLink>
        {(['intro', 'outro'] as const).map((k) => (
          <NavLink key={k} to={`/credits/${k}`} className={({ isActive }) => `sub ${isActive ? 'active' : ''}`}>
            <span className="grow">{data.credits[k]?.name ?? (k === 'intro' ? 'Intro' : 'Outro')}</span>
            <span className="muted mono" style={{ fontSize: 10.5 }}>{data.credits[k]?.enabled ? `${data.credits[k].duration}s` : 'off'}</span>
          </NavLink>
        ))}
        <div className="nav-label">Library</div>
        <NavLink to="/characters"><span className="ico">☺</span>Characters</NavLink>
        <NavLink to="/environments"><span className="ico">◭</span>Environments</NavLink>
        <NavLink to="/assets"><span className="ico">◆</span>Assets</NavLink>
        <NavLink to="/shots"><span className="ico">▷</span>Shots</NavLink>
        <NavLink to="/score"><span className="ico">♫</span>Score</NavLink>
        <div className="nav-label">Output</div>
        <NavLink to="/export"><span className="ico">⇪</span>Blender export</NavLink>
      </nav>
      <div className="sidebar-foot">
        <span>{data.project.fps} fps · {data.project.resolution.join('×')}</span>
        <span><kbd>space</kbd> play · <kbd>⌘Z</kbd> undo</span>
      </div>
    </aside>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  return show && toast ? <div className="toast">{toast.text}</div> : null;
}
