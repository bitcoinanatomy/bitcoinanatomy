import { Link } from 'react-router-dom';
import { Header, StatusPill, Thumb } from '../components/ui';
import { sceneThumb } from '../lib/thumbs';
import type { DialogClip, Status } from '../model/schema';
import { episodeDuration, episodeScenes, fmtDuration, resolveTimeline } from '../model/timeline';
import { useData, useStore } from '../store/store';

const COLORS: Record<Status, string> = { todo: 'var(--s-todo)', wip: 'var(--s-wip)', review: 'var(--s-review)', done: 'var(--s-done)' };

export function Dashboard() {
  const data = useData();
  const issues = useStore((s) => s.issues);
  const tts = useStore((s) => s.tts);
  const past = useStore((s) => s.past);

  const eps = data.project.episodes.map((id) => data.episodes[id]).filter(Boolean);
  const shots = Object.values(data.scenes).flatMap((s) => s.shots.map((sh) => ({ sh, sc: s })));
  const runtime = eps.reduce((s, e) => s + episodeDuration(data, e.id), 0);
  const byStatus = (['todo', 'wip', 'review', 'done'] as Status[]).map((s) => ({ s, n: shots.filter((x) => x.sh.status === s).length }));
  const lines = eps.flatMap((e) => resolveTimeline(data, { kind: 'episode', episodeId: e.id }).clips.filter((c) => c.track === 'dialog' && !c.derived));
  const noAudio = lines.filter((c) => !(c.clip as DialogClip).audio).length;
  const noBoard = shots.filter((x) => !x.sh.tracks.storyboard.length);
  const noCam = shots.filter((x) => !x.sh.tracks.camera.length);

  return (
    <>
      <Header crumbs={[{ label: 'Dashboard' }]} />
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>{data.project.title}</h1>
            <p>Previsualization workspace: script breakdown, storyboards, camera, dialog, sound and score — all stored as plain JSON in <span className="mono">project/</span> so people and agents can edit it, and exportable to Blender.</p>
          </div>
          <Link className="btn primary" to={eps[0] ? `/ep/${eps[0].id}?view=timeline` : '/episodes'}>▶ Open timeline</Link>
        </div>

        <div className="stats">
          <Stat k="Runtime" v={fmtDuration(runtime)} />
          <Stat k="Episodes" v={eps.length} />
          <Stat k="Scenes" v={Object.keys(data.scenes).length} />
          <Stat k="Shots" v={shots.length} />
          <Stat k="Dialog lines" v={lines.length} sub={noAudio ? `${noAudio} without audio` : 'all voiced'} />
          <Stat k="Library" v={Object.keys(data.characters).length + Object.keys(data.environments).length + Object.keys(data.assets).length} sub={`${Object.keys(data.cues).length} score cues`} />
        </div>

        <div className="two" style={{ marginTop: 16 }}>
          <div className="col" style={{ gap: 16 }}>
            <div className="card pad">
              <h3>Shot progress</h3>
              <div className="bar">
                {byStatus.map(({ s, n }) => n > 0 && <span key={s} style={{ width: `${(n / shots.length) * 100}%`, background: COLORS[s] }} />)}
              </div>
              <div className="legend">
                {byStatus.map(({ s, n }) => (
                  <span key={s}><i style={{ background: COLORS[s] }} />{s} {n}</span>
                ))}
              </div>
            </div>

            <div className="card pad">
              <h3>Episodes</h3>
              <div className="grid">
                {eps.map((e) => {
                  const scs = episodeScenes(data, e.id);
                  const thumb = scs.map(sceneThumb).find(Boolean);
                  return (
                    <Link key={e.id} to={`/ep/${e.id}`} className="tile">
                      <Thumb src={thumb} text={e.synopsis} badge={`EP ${e.number}`} dur={fmtDuration(episodeDuration(data, e.id))} />
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
              </div>
            </div>
          </div>

          <div className="col" style={{ gap: 16 }}>
            <div className="card pad">
              <h3>Needs attention</h3>
              <div className="list">
                {issues.map((i) => (
                  <div key={i.file} className="issue">⚠ {i.file}{'\n'}{i.message.slice(0, 400)}</div>
                ))}
                {noAudio > 0 && <div>♪ {noAudio} dialog line{noAudio > 1 ? 's' : ''} without generated audio <span className="grow" /><Link className="btn sm" to={`/ep/${eps[0]?.id}?view=timeline`}>Generate</Link></div>}
                {noBoard.slice(0, 6).map(({ sh, sc }) => (
                  <Link key={sc.id + sh.id} to={`/ep/${sc.episodeId}/sc/${sc.id}/sh/${sh.id}`}>
                    <span style={{ color: 'var(--t-storyboard)' }}>▦</span>
                    <span className="grow">No storyboard: <b>{sh.name}</b> <span className="muted">· {sc.title}</span></span>
                  </Link>
                ))}
                {noBoard.length > 6 && <div className="muted">…and {noBoard.length - 6} more shots without storyboards</div>}
                {noCam.length > 0 && <div><span style={{ color: 'var(--t-camera)' }}>◆</span> {noCam.length} shots without a camera</div>}
                {!issues.length && !noAudio && !noBoard.length && !noCam.length && <div className="muted">Nothing — nice.</div>}
              </div>
            </div>

            <div className="card pad">
              <h3>Recent edits</h3>
              <div className="list">
                {past.slice(-8).reverse().map((p, i) => <div key={i} className="muted">↶ {p.label}</div>)}
                {!past.length && <div className="muted">No edits this session.</div>}
              </div>
            </div>

            <div className="card pad">
              <h3>Pipeline</h3>
              <div className="list">
                <div>Dialog TTS <span className="grow" /><span className="pill">{tts.piper ? `Piper · ${tts.voices.length} voices` : 'macOS say (fallback)'}</span></div>
                <div>Score <span className="grow" /><span className="pill">deterministic · seed → MIDI/WAV</span></div>
                <div>Meshes <span className="grow" /><span className="pill">glTF 2.0 (.glb) PBR</span></div>
                <div>Export <span className="grow" /><Link className="btn sm" to="/export">Blender bundle →</Link></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className="muted" style={{ fontSize: 11.5 }}>{sub}</div>}
    </div>
  );
}
