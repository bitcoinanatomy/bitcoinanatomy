import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { loadCue, transport } from '../audio/player';
import { encodeWav } from '../audio/wav';
import { Field, Header, NumInput, TextInput, Upload } from '../components/ui';
import { download } from '../lib/api';
import { INSTRUMENTS, ScoreCue, type ScoreOverride } from '../model/schema';
import { compose, cueDuration, midiName } from '../score/compose';
import { cueToMidi } from '../score/midi';
import { addLib, deleteLib, updateLib } from '../store/actions';
import { useData } from '../store/store';
import { INST_COLOR, NoteRoll } from '../timeline/ClipViz';

const KEYS = ScoreCue.shape.key.unwrap().options;
const MODES = ScoreCue.shape.mode.unwrap().options;

export function ScorePage() {
  const data = useData();
  const navigate = useNavigate();
  const cues = Object.values(data.cues);
  return (
    <>
      <Header crumbs={[{ label: 'Score' }]}>
        <button className="btn primary" onClick={() => navigate(`/score/${addLib('cues', 'New cue')}`)}>＋ Cue</button>
      </Header>
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>Score</h1>
            <p>Deterministic composer: a cue is a seed plus a few musical parameters. The same cue always renders the same notes and audio,
              so agents and people can tweak it safely. Export MIDI to edit in LMMS / MuseScore / Ardour, then drop the edited .mid or a
              mixed .wav back in as the cue’s replacement.</p>
          </div>
        </div>
        <div className="grid lg">
          {cues.map((c) => (
            <Link key={c.id} to={`/score/${c.id}`} className="tile">
              <div className="roll-wrap sm"><NoteRoll cue={c} offset={0} duration={cueDuration(c)} width={300} /></div>
              <div className="body">
                <div className="title">{c.name}</div>
                <div className="meta">
                  <span className="tag mono">seed {c.seed}</span>
                  <span className="tag">{c.key} {c.mode}</span>
                  <span className="tag">{c.tempo} bpm · {c.bars} bars</span>
                  {c.replacement && <span className="tag" style={{ color: 'var(--accent)' }}>replaced</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}

export function CuePage() {
  const { id = '' } = useParams();
  const data = useData();
  const navigate = useNavigate();
  const cue = data.cues[id];
  const [playing, setPlaying] = useState<{ stop: () => void; seek: (t: number) => void; position: () => number } | null>(null);
  const [pos, setPos] = useState(0);
  const raf = useRef(0);
  const scrubbing = useRef(false);
  const lastSeekAt = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const playGen = useRef(0);
  const comp = useMemo(() => (cue ? compose(cue) : null), [cue]);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => () => {
    playingRef.current?.stop();
    cancelAnimationFrame(raf.current);
  }, []);
  if (!cue || !comp) return <div className="empty">Cue not found</div>;
  const dur = cueDuration(cue);
  const up = (fn: (c: ScoreCue) => void, k?: string) => updateLib('cues', id, fn, k);
  const uses = Object.values(data.scenes).flatMap((sc) => [
    ...sc.tracks.score.filter((s) => s.cueId === id).map(() => ({ to: `/ep/${sc.episodeId}/sc/${sc.id}?view=timeline`, label: `scene ${sc.title}` })),
    ...sc.shots.flatMap((sh) => sh.tracks.score.filter((s) => s.cueId === id).map(() => ({ to: `/ep/${sc.episodeId}/sc/${sc.id}/sh/${sh.id}?view=timeline`, label: `shot ${sh.name}` }))),
  ]).concat(Object.values(data.episodes).filter((e) => e.tracks.score.some((s) => s.cueId === id)).map((e) => ({ to: `/ep/${e.id}?view=timeline`, label: `episode ${e.title}` })));

  const playFrom = async (start: number) => {
    const token = ++playGen.current;
    playingRef.current?.stop();
    cancelAnimationFrame(raf.current);
    transport.stop();
    const buf = await loadCue(cue);
    if (!buf || token !== playGen.current) return;
    const h = transport.audition(buf, start, () => {
      if (token !== playGen.current) return;
      cancelAnimationFrame(raf.current);
      setPlaying(null);
    });
    if (token !== playGen.current) {
      h.stop();
      return;
    }
    if (pendingSeek.current != null) {
      h.seek(pendingSeek.current);
      pendingSeek.current = null;
    }
    setPlaying(h);
    const tick = () => {
      if (!scrubbing.current) setPos(h.position());
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const play = () => {
    if (playing) {
      playGen.current++;
      playing.stop();
      cancelAnimationFrame(raf.current);
      setPlaying(null);
      return;
    }
    const start = pos >= dur - 0.05 ? 0 : pos;
    void playFrom(start);
  };

  const timeAt = (e: PointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.min(dur, Math.max(0, ((e.clientX - r.left) / r.width) * dur));
  };

  const onScrubDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    const t = timeAt(e, e.currentTarget);
    setPos(t);
    if (playingRef.current) playingRef.current.seek(t);
    else {
      pendingSeek.current = t;
      void playFrom(t);
    }
  };

  const onScrubMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current) return;
    const t = timeAt(e, e.currentTarget);
    setPos(t);
    const now = performance.now();
    if (now - lastSeekAt.current < 40) {
      pendingSeek.current = t;
      return;
    }
    lastSeekAt.current = now;
    if (playingRef.current) {
      playingRef.current.seek(t);
      pendingSeek.current = null;
    } else pendingSeek.current = t;
  };

  const onScrubUp = () => {
    scrubbing.current = false;
    if (pendingSeek.current != null && playingRef.current) {
      playingRef.current.seek(pendingSeek.current);
      setPos(pendingSeek.current);
      pendingSeek.current = null;
    }
  };

  const wav = async () => {
    const buf = await loadCue(cue);
    if (!buf) return;
    download(`${cue.id}.wav`, encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate) as BlobPart, 'audio/wav');
  };

  return (
    <>
      <Header crumbs={[{ label: 'Score', to: '/score' }, { label: cue.name }]}>
        <button className="btn danger" onClick={() => confirm(`Delete cue ${cue.name}?`) && (deleteLib('cues', id), navigate('/score'))}>Delete</button>
      </Header>
      <div className="page">
        <div className="page-head">
          <div className="grow col" style={{ gap: 4 }}>
            <TextInput className="input bare" value={cue.name} onChange={(v) => up((c) => void (c.name = v), 'name')} />
            <div className="muted">{comp.notes.length} notes · {dur.toFixed(1)}s · {cue.bars} bars of {cue.beatsPerBar}/4 at {cue.tempo} bpm
              {cue.replacement && <> · <b style={{ color: 'var(--accent)' }}>using replacement {cue.replacement.split('/').pop()}</b></>}</div>
          </div>
          <button className="btn primary" onClick={() => void play()}>{playing ? '■ Stop' : '▶ Play cue'}</button>
          <button className="btn" onClick={() => download(`${cue.id}.mid`, cueToMidi(cue) as BlobPart, 'audio/midi')}>⇩ MIDI</button>
          <button className="btn" onClick={() => void wav()}>⇩ WAV</button>
        </div>

        <div className="roll-wrap scrub" onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubUp} onPointerCancel={onScrubUp}>
          <NoteRoll cue={cue} offset={0} duration={dur} width={1200} />
          <div className="ph" style={{ left: `${(Math.min(pos, dur) / dur) * 100}%` }} />
        </div>
        <div className="legend">
          {INSTRUMENTS.map((i) => <span key={i}><i style={{ background: INST_COLOR[i] }} />{i}</span>)}
          <span className="grow" />
          <span className="mono">chords: {comp.chords.filter((_, i) => i < 8).map((c) => midiName(c.midi[0])).join(' · ')}{comp.chords.length > 8 ? ' …' : ''}</span>
        </div>

        <div className="detail" style={{ marginTop: 18 }}>
          <div className="card pad col" style={{ gap: 12 }}>
            <h3>Generator</h3>
            <div className="fields">
              <Field label="Seed">
                <div className="row" style={{ gap: 4 }}>
                  <NumInput value={cue.seed} step={1} onChange={(v) => up((c) => void (c.seed = Math.round(v)))} />
                  <button className="btn icon" title="Previous seed" onClick={() => up((c) => void (c.seed -= 1))}>‹</button>
                  <button className="btn icon" title="Next seed" onClick={() => up((c) => void (c.seed += 1))}>›</button>
                  <button className="btn icon" title="Random seed" onClick={() => up((c) => void (c.seed = Math.floor(Math.random() * 1e6)))}>⚄</button>
                </div>
              </Field>
              <Field label="Key">
                <select className="select" value={cue.key} onChange={(e) => up((c) => void (c.key = e.target.value as ScoreCue['key']))}>{KEYS.map((k) => <option key={k}>{k}</option>)}</select>
              </Field>
              <Field label="Mode">
                <select className="select" value={cue.mode} onChange={(e) => up((c) => void (c.mode = e.target.value as ScoreCue['mode']))}>{MODES.map((k) => <option key={k}>{k}</option>)}</select>
              </Field>
              <Field label="Tempo (bpm)"><NumInput value={cue.tempo} step={1} min={30} max={220} onChange={(v) => up((c) => void (c.tempo = v))} /></Field>
              <Field label="Bars"><NumInput value={cue.bars} step={1} min={1} max={256} onChange={(v) => up((c) => void (c.bars = Math.round(v)))} /></Field>
              <Field label="Beats / bar"><NumInput value={cue.beatsPerBar} step={1} min={2} max={7} onChange={(v) => up((c) => void (c.beatsPerBar = Math.round(v)))} /></Field>
              <Field label="Density"><NumInput value={cue.density} step={0.05} min={0} max={1} onChange={(v) => up((c) => void (c.density = v))} /></Field>
            </div>
            <h3>Instruments</h3>
            <div className="inst muted" style={{ fontSize: 11 }}><span>instrument</span><span>on</span><span>enters at (0–1)</span><span>gain</span></div>
            {INSTRUMENTS.map((i) => {
              const cfg = cue.instruments[i] ?? { on: false, enter: 0, gain: 0.5 };
              const set = (patch: Partial<typeof cfg>) => up((c) => void (c.instruments[i] = { ...cfg, ...patch }));
              return (
                <div key={i} className="inst">
                  <span><span style={{ color: INST_COLOR[i] }}>■</span> {i}</span>
                  <input type="checkbox" checked={cfg.on} onChange={(e) => set({ on: e.target.checked })} />
                  <NumInput value={cfg.enter} step={0.05} min={0} max={1} onChange={(v) => set({ enter: v })} />
                  <NumInput value={cfg.gain} step={0.05} min={0} max={2} onChange={(v) => set({ gain: v })} />
                </div>
              );
            })}
          </div>

          <div className="col" style={{ gap: 14 }}>
            <div className="card pad col" style={{ gap: 10 }}>
              <h3 className="row">Overrides <span className="grow" />
                <button className="btn sm" onClick={() => up((c) => void c.overrides.push({ op: 'mute', instrument: 'lead', bars: [0, 3], value: 0 }))}>＋ Override</button>
              </h3>
              <div className="muted" style={{ fontSize: 12 }}>Applied after generation: mute, transpose (semitones) or scale velocity (gain) for an instrument and bar range.</div>
              {cue.overrides.map((o, k) => (
                <div key={k} className="row" style={{ gap: 4 }}>
                  <select className="select" value={o.op} onChange={(e) => up((c) => void (c.overrides[k].op = e.target.value as ScoreOverride['op']))}>
                    {['mute', 'transpose', 'gain'].map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <select className="select" value={o.instrument ?? ''} onChange={(e) => up((c) => void (c.overrides[k].instrument = (e.target.value || undefined) as ScoreOverride['instrument']))}>
                    <option value="">all</option>
                    {INSTRUMENTS.map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <NumInput value={o.bars?.[0] ?? 0} step={1} min={0} title="from bar" onChange={(v) => up((c) => void (c.overrides[k].bars = [Math.round(v), c.overrides[k].bars?.[1] ?? cue.bars - 1]))} />
                  <NumInput value={o.bars?.[1] ?? cue.bars - 1} step={1} min={0} title="to bar" onChange={(v) => up((c) => void (c.overrides[k].bars = [c.overrides[k].bars?.[0] ?? 0, Math.round(v)]))} />
                  {o.op !== 'mute' && <NumInput value={o.value} step={o.op === 'gain' ? 0.1 : 1} title="value" onChange={(v) => up((c) => void (c.overrides[k].value = v))} />}
                  <button className="btn sm ghost danger" onClick={() => up((c) => void c.overrides.splice(k, 1))}>✕</button>
                </div>
              ))}
            </div>

            <div className="card pad col" style={{ gap: 10 }}>
              <h3>Replacement</h3>
              <div className="muted" style={{ fontSize: 12 }}>Edited the MIDI in an open-source DAW? Drop the .mid (track names pad/bass/arp/lead/perc keep their instruments) or a final .wav mix here — it replaces the generated music everywhere, including the Blender export.</div>
              {cue.replacement ? (
                <div className="row"><span className="mono grow">{cue.replacement}</span><button className="btn sm" onClick={() => up((c) => void (c.replacement = undefined))}>Use generator again</button></div>
              ) : (
                <Upload dir="media/audio/score" accept=".mid,.midi,.wav" onDone={(p) => up((c) => void (c.replacement = p))}>Drop .mid or .wav</Upload>
              )}
            </div>

            <div className="card pad">
              <h3>Used in</h3>
              <div className="list">
                {uses.map((u, k) => <Link key={k} to={u.to}>{u.label}</Link>)}
                {!uses.length && <div className="muted">Not placed on any timeline yet — add a Score clip in a timeline.</div>}
              </div>
            </div>
            <Field label="Notes"><TextInput multiline value={cue.notes} onChange={(v) => up((c) => void (c.notes = v), 'notes')} /></Field>
          </div>
        </div>
      </div>
    </>
  );
}
