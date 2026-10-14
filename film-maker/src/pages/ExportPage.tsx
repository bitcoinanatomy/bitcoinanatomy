import { useState } from 'react';
import { Header } from '../components/ui';
import { api } from '../lib/api';
import { episodeDuration, fmtDuration } from '../model/timeline';
import { useData } from '../store/store';

export function ExportPage() {
  const data = useData();
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<Record<string, { dir: string; warnings: string[]; frames: number } | { error: string }>>({});
  const run = async (id: string) => {
    setBusy(id);
    try {
      const r = await api.exportEpisode(id);
      setResult((x) => ({ ...x, [id]: r }));
    } catch (e) {
      setResult((x) => ({ ...x, [id]: { error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <>
      <Header crumbs={[{ label: 'Blender export' }]} />
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>Blender export</h1>
            <p>Each episode exports to <span className="mono">film-maker/export/&lt;episode&gt;/</span>: a <span className="mono">bundle.json</span> with
              frame-accurate timing, the media it references (boards, dialog, SFX, rendered score + MIDI, .glb meshes) and <span className="mono">import_project.py</span>.
              The importer builds one Blender scene per film scene (environment, props, characters, a keyframed camera per shot bound with markers)
              plus an <b>EDIT</b> scene whose Video Sequencer holds the cut: scene strips, storyboards, dialog, SFX, score and subtitles.</p>
          </div>
        </div>
        <div className="col" style={{ gap: 12 }}>
          {data.project.episodes.map((id) => {
            const ep = data.episodes[id];
            const r = result[id];
            return (
              <div key={id} className="card pad col" style={{ gap: 8 }}>
                <div className="row">
                  <b className="grow">{ep.number}. {ep.title}</b>
                  <span className="muted">{ep.scenes.length} scenes · {fmtDuration(episodeDuration(data, id))}</span>
                  <button className="btn primary" disabled={!!busy} onClick={() => void run(id)}>{busy === id ? 'Exporting…' : '⇪ Export'}</button>
                </div>
                {r && 'error' in r && <div className="issue">{r.error}</div>}
                {r && 'dir' in r && (
                  <>
                    <div className="muted">Wrote <span className="mono">{r.dir}</span> · {r.frames} frames at {data.project.fps} fps</div>
                    {r.warnings.map((w) => <div key={w} className="issue">⚠ {w}</div>)}
                    <div className="muted">Open in Blender (4.2+), either from a terminal:</div>
                    <pre className="code">{`blender --python "${r.dir}/import_project.py" -- "${r.dir}/bundle.json"`}</pre>
                    <div className="muted">…or headless, saving a .blend:</div>
                    <pre className="code">{`blender --background --python "${r.dir}/import_project.py" -- "${r.dir}/bundle.json" --save "${r.dir}/${id}.blend"`}</pre>
                    <div className="muted">…or inside Blender: Scripting tab › Open <span className="mono">import_project.py</span> › Run (it asks for nothing: it finds bundle.json next to itself).</div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <h2>Command line</h2>
        <pre className="code">{`npm run export -- ep01          # same as the button
npm run validate               # schema + reference checks (agents: run after editing JSON)
npm run tts                    # generate all missing dialog audio with Piper`}</pre>
      </div>
    </>
  );
}
