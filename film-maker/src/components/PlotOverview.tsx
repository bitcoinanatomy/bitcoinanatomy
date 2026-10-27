import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BEAT_COLOR, BEAT_LABEL } from '../model/arc';
import type { Beat, ProjectData } from '../model/schema';
import { episodeDuration, fmtDuration } from '../model/timeline';
import { updateEpisode, updateScene } from '../store/actions';
import { useStore } from '../store/store';
import { TextInput } from './ui';

function BeatChip({ beat }: { beat?: Beat }) {
  if (!beat) return null;
  return <span className="plot-beat" style={{ color: BEAT_COLOR[beat], borderColor: BEAT_COLOR[beat] }}>{BEAT_LABEL[beat]}</span>;
}

/**
 * The season at a glance: season plot, then one line per episode and one per scene.
 * Editable on the Story arcs page; read-only (and unlinked) for archived seasons.
 */
export function PlotOverview({ data, editable, linkable = editable }: { data: ProjectData; editable?: boolean; linkable?: boolean }) {
  const mutate = useStore((s) => s.mutate);
  const navigate = useNavigate();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const eps = data.project.episodes.filter((id) => data.episodes[id]);
  const allClosed = eps.every((id) => closed[id]);

  return (
    <div className="card pad plot">
      <h3 className="row">
        Plot overview <span className="grow" />
        <button className="btn sm" onClick={() => setClosed(Object.fromEntries(eps.map((id) => [id, !allClosed])))}>{allClosed ? 'Expand all' : 'Collapse all'}</button>
      </h3>
      {editable ? (
        <TextInput multiline rows={6} className="input bare plot-season" value={data.project.season.plot}
          placeholder="The season's story in 3–5 sentences: who wants what, what stands in the way, how it ends…"
          onChange={(v) => mutate('edit season plot', (d) => void (d.project.season.plot = v), 'season-plot')} />
      ) : (
        <p className="plot-season">{data.project.season.plot || data.project.season.logline}</p>
      )}
      <ol className="plot-eps">
        {eps.map((id) => {
          const ep = data.episodes[id];
          const open = !closed[id];
          return (
            <li key={id} className="plot-ep">
              <div className="plot-ep-head">
                <button className="plot-toggle" onClick={() => setClosed({ ...closed, [id]: open })}>{open ? '▾' : '▸'}</button>
                <span className="plot-num">{ep.number}</span>
                <a className={`plot-title ${linkable ? 'link' : ''}`} onClick={linkable ? () => navigate(`/ep/${id}`) : undefined}>{ep.title}</a>
                <BeatChip beat={ep.arc.beat} />
                <span className="grow" />
                <span className="muted mono plot-dur">{fmtDuration(episodeDuration(data, id))}</span>
              </div>
              {editable ? (
                <TextInput className="input bare plot-logline" value={ep.logline} placeholder="One sentence: what happens in this episode…"
                  onChange={(v) => updateEpisode(id, (e) => void (e.logline = v), 'logline')} />
              ) : (
                <div className="plot-logline">{ep.logline || ep.synopsis}</div>
              )}
              {open && (
                <ul className="plot-scenes">
                  {ep.scenes.map((scId) => {
                    const sc = data.scenes[scId];
                    if (!sc) return null;
                    return (
                      <li key={scId}>
                        <i style={{ background: sc.arc.beat ? BEAT_COLOR[sc.arc.beat] : 'var(--fg-4)' }} title={sc.arc.beat ? BEAT_LABEL[sc.arc.beat] : ''} />
                        <a className={linkable ? 'link' : ''} onClick={linkable ? () => navigate(`/ep/${id}/sc/${scId}`) : undefined}>{sc.title}</a>
                        <span className="plot-dash">—</span>
                        {editable ? (
                          <TextInput className="input bare" value={sc.summary} placeholder="One line…" onChange={(v) => updateScene(scId, (s) => void (s.summary = v), 'summary')} />
                        ) : (
                          <span className="muted">{sc.summary}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
