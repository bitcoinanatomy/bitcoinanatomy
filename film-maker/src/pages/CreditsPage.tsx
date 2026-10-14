import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { loadCue, transport } from '../audio/player';
import { Field, Header, NumInput, TextInput } from '../components/ui';
import { CREDIT_SIZES, type Credits } from '../model/schema';
import { uid } from '../model/timeline';
import { creditVars, CreditsView } from '../preview/CreditsView';
import { updateEpisode } from '../store/actions';
import { useData, useStore } from '../store/store';

const KINDS = ['intro', 'outro'] as const;
type Kind = (typeof KINDS)[number];

function update(kind: Kind, fn: (c: Credits) => void, coalesce?: string) {
  useStore.getState().mutate(`edit ${kind} credits`, (d) => {
    const c = d.credits[kind];
    if (c) fn(c);
  }, coalesce && `credits:${kind}:${coalesce}`);
}

/** A representative moment to show in thumbnails: the middle of the first card (or of the roll). */
const showcaseTime = (c: Credits) => (c.cards[0] ? c.cards[0].start + c.cards[0].duration / 2 : c.roll ? c.roll.start + c.roll.duration * 0.35 : 0);

export function CreditsListPage() {
  const data = useData();
  const ep = data.project.episodes[0];
  return (
    <>
      <Header crumbs={[{ label: 'Credits' }]} />
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>Credits</h1>
            <p>Global intro and outro credits, played at the start and end of every episode. Text can use placeholders —
              <span className="mono"> {'{project}'} {'{season}'} {'{episode.number}'} {'{episode.title}'} {'{episode.theme}'}</span> — so one design fills in correctly for each episode.</p>
          </div>
        </div>
        <div className="grid lg">
          {KINDS.map((k) => {
            const c = data.credits[k];
            if (!c) return null;
            const used = data.project.episodes.filter((id) => data.episodes[id]?.credits[k]).length;
            return (
              <Link key={k} to={`/credits/${k}`} className="tile">
                <div className="thumb" style={{ background: c.background }}>
                  <CreditsView credits={c} time={showcaseTime(c)} vars={creditVars(data, ep)} />
                </div>
                <div className="body">
                  <div className="title">{c.name}</div>
                  <div className="meta">
                    <span className={`pill ${c.enabled ? 'status-done' : 'status-todo'}`}><span className="dot" />{c.enabled ? 'on' : 'off'}</span>
                    <span>{c.duration}s · {c.cards.length} cards{c.roll ? ` · roll of ${c.roll.sections.length} sections` : ''}</span>
                    <span>· {used}/{data.project.episodes.length} episodes</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function CreditsEditPage() {
  const { id = 'intro' } = useParams();
  const kind = (KINDS.includes(id as Kind) ? id : 'intro') as Kind;
  const data = useData();
  const navigate = useNavigate();
  const c = data.credits[kind];
  const [t, setT] = useState(0);
  const [epId, setEpId] = useState(data.project.episodes[0]);
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => () => stopRef.current(), []);
  useEffect(() => {
    stopRef.current();
    setT(c ? showcaseTime(c) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  if (!c) return <div className="empty">No {kind} credits in this project</div>;

  const play = async () => {
    if (playing) return stopRef.current();
    transport.stop();
    const cue = c.music.cueId ? data.cues[c.music.cueId] : undefined;
    const buf = cue ? await loadCue(cue) : null;
    const audio = buf ? transport.audition(buf, 0) : null;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const now = (performance.now() - t0) / 1000;
      if (now >= c.duration) return stopRef.current();
      setT(now);
      raf = requestAnimationFrame(tick);
    };
    stopRef.current = () => {
      cancelAnimationFrame(raf);
      try {
        audio?.stop();
      } catch {
        /* already ended */
      }
      setPlaying(false);
      stopRef.current = () => {};
    };
    setPlaying(true);
    tick();
  };

  const up = (fn: (c: Credits) => void, k?: string) => update(kind, fn, k);

  return (
    <>
      <Header crumbs={[{ label: 'Credits', to: '/credits' }, { label: c.name }]}>
        <div className="seg">
          {KINDS.map((k) => <button key={k} className={k === kind ? 'on' : ''} onClick={() => navigate(`/credits/${k}`)}>{k}</button>)}
        </div>
      </Header>
      <div className="page">
        <div className="detail">
          <div className="col" style={{ gap: 12 }}>
            <div className="monitor credits-monitor">
              <CreditsView credits={c} time={t} vars={creditVars(data, epId)} />
            </div>
            <div className="row">
              <button className="btn primary" onClick={() => void play()}>{playing ? '■ Stop' : '▶ Play'}</button>
              <input type="range" className="grow" min={0} max={c.duration} step={0.01} value={Math.min(t, c.duration)} onChange={(e) => (stopRef.current(), setT(Number(e.target.value)))} />
              <span className="mono muted">{t.toFixed(2)}s / {c.duration}s</span>
            </div>
            <div className="row">
              <span className="muted" style={{ fontSize: 12 }}>Preview as</span>
              <select className="select" style={{ width: 240 }} value={epId} onChange={(e) => setEpId(e.target.value)}>
                {data.project.episodes.map((id) => <option key={id} value={id}>{data.episodes[id]?.number}. {data.episodes[id]?.title}</option>)}
              </select>
            </div>

            <div className="card pad col" style={{ gap: 10 }}>
              <h3 className="row">Title cards <span className="grow" />
                <button className="btn sm" onClick={() => up((x) => void x.cards.push({ id: uid('card'), start: Math.round(t * 10) / 10, duration: 2.5, align: 'center', lines: [{ text: 'New card', size: 'lg' }] }))}>＋ Card at {t.toFixed(1)}s</button>
              </h3>
              {c.cards.map((card, i) => (
                <div key={card.id} className="key">
                  <div className="kh">
                    <span className="muted">at</span>
                    <div style={{ width: 64 }}><NumInput value={card.start} min={0} onChange={(v) => up((x) => void (x.cards[i].start = v))} /></div>
                    <span className="muted">for</span>
                    <div style={{ width: 64 }}><NumInput value={card.duration} min={0.1} onChange={(v) => up((x) => void (x.cards[i].duration = v))} /></div>
                    <select className="select" style={{ width: 120 }} value={card.align} onChange={(e) => up((x) => void (x.cards[i].align = e.target.value as typeof card.align))}>
                      <option value="center">center</option>
                      <option value="bottom-left">bottom-left</option>
                      <option value="top">top</option>
                    </select>
                    <span className="grow" />
                    <button className="btn sm ghost" title="Jump here" onClick={() => setT(card.start + card.duration / 2)}>◉</button>
                    <button className="btn sm ghost danger" onClick={() => up((x) => void x.cards.splice(i, 1))}>✕</button>
                  </div>
                  {card.lines.map((l, j) => (
                    <div key={j} className="row" style={{ gap: 4 }}>
                      <div className="grow"><TextInput value={l.text} onChange={(v) => up((x) => void (x.cards[i].lines[j].text = v), `card${i}-${j}`)} /></div>
                      <select className="select" style={{ width: 64 }} value={l.size} onChange={(e) => up((x) => void (x.cards[i].lines[j].size = e.target.value as typeof l.size))}>
                        {CREDIT_SIZES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                      <button className="btn sm ghost danger" onClick={() => up((x) => void x.cards[i].lines.splice(j, 1))}>✕</button>
                    </div>
                  ))}
                  <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => up((x) => void x.cards[i].lines.push({ text: '', size: 'md' }))}>＋ Line</button>
                </div>
              ))}
              {!c.cards.length && <div className="muted">No cards.</div>}
            </div>

            <div className="card pad col" style={{ gap: 10 }}>
              <h3 className="row">Credit roll <span className="grow" />
                {c.roll
                  ? <button className="btn sm danger" onClick={() => up((x) => void (x.roll = undefined))}>Remove roll</button>
                  : <button className="btn sm" onClick={() => up((x) => void (x.roll = { start: 0, duration: Math.max(4, x.duration - 3), sections: [{ heading: 'Created by', names: ['Your name'] }] }))}>＋ Add roll</button>}
              </h3>
              {c.roll && (
                <>
                  <div className="fields">
                    <Field label="Starts at (s)"><NumInput value={c.roll.start} min={0} onChange={(v) => up((x) => void (x.roll!.start = v))} /></Field>
                    <Field label="Scroll duration (s)"><NumInput value={c.roll.duration} min={1} onChange={(v) => up((x) => void (x.roll!.duration = v))} /></Field>
                  </div>
                  {c.roll.sections.map((s, i) => (
                    <div key={i} className="key">
                      <div className="kh">
                        <div className="grow"><TextInput value={s.heading} placeholder="Heading" onChange={(v) => up((x) => void (x.roll!.sections[i].heading = v), `roll-h${i}`)} /></div>
                        <button className="btn sm ghost" title="Move up" onClick={() => up((x) => { const a = x.roll!.sections; if (i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]]; })}>↑</button>
                        <button className="btn sm ghost danger" onClick={() => up((x) => void x.roll!.sections.splice(i, 1))}>✕</button>
                      </div>
                      <TextInput multiline rows={Math.max(2, s.names.length)} value={s.names.join('\n')} placeholder="One name per line"
                        onChange={(v) => up((x) => void (x.roll!.sections[i].names = v.split('\n')), `roll-n${i}`)} />
                    </div>
                  ))}
                  <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => up((x) => void x.roll!.sections.push({ heading: 'Section', names: [] }))}>＋ Section</button>
                </>
              )}
            </div>
          </div>

          <div className="card pad col" style={{ gap: 12 }}>
            <div className="muted mono" style={{ fontSize: 11.5 }}>project/credits/{kind}.json — shared by all episodes</div>
            <Field label="Name"><TextInput value={c.name} onChange={(v) => up((x) => void (x.name = v), 'name')} /></Field>
            <label className="check"><input type="checkbox" checked={c.enabled} onChange={(e) => up((x) => void (x.enabled = e.target.checked))} /> Enabled (globally)</label>
            <div className="fields">
              <Field label="Duration (s)"><NumInput value={c.duration} min={0.5} step={0.5} onChange={(v) => up((x) => void (x.duration = v))} /></Field>
              <Field label="Fade (s)"><NumInput value={c.fade} min={0} max={3} step={0.1} onChange={(v) => up((x) => void (x.fade = v))} /></Field>
              <Field label="Background"><input type="color" className="input" value={c.background} onChange={(e) => up((x) => void (x.background = e.target.value), 'bg')} /></Field>
              <Field label="Text colour"><input type="color" className="input" value={c.color} onChange={(e) => up((x) => void (x.color = e.target.value), 'fg')} /></Field>
            </div>
            <div className="section col">
              <h3>Music</h3>
              <div className="fields">
                <Field label="Score cue">
                  <select className="select" value={c.music.cueId ?? ''} onChange={(e) => up((x) => void (x.music.cueId = e.target.value || undefined))}>
                    <option value="">None</option>
                    {Object.values(data.cues).map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                  </select>
                </Field>
                <Field label="Gain"><NumInput value={c.music.gain} min={0} max={2} step={0.05} onChange={(v) => up((x) => void (x.music.gain = v))} /></Field>
              </div>
              {c.music.cueId && <Link className="btn sm" style={{ alignSelf: 'flex-start' }} to={`/score/${c.music.cueId}`}>Open cue in composer →</Link>}
            </div>
            <div className="section col">
              <h3>Episodes</h3>
              {data.project.episodes.map((id) => {
                const ep = data.episodes[id];
                if (!ep) return null;
                return (
                  <label key={id} className="check">
                    <input type="checkbox" checked={ep.credits[kind]} onChange={(e) => updateEpisode(id, (x) => void (x.credits[kind] = e.target.checked))} />
                    {ep.number}. {ep.title}
                  </label>
                );
              })}
            </div>
            <div className="section col">
              <h3>Placeholders</h3>
              <pre className="code">{`{project}         ${data.project.title}
{season}          ${data.project.season.title}
{episode.number}  per episode
{episode.title}   per episode
{episode.theme}   per episode`}</pre>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
