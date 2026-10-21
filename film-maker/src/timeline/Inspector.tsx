import { Link } from 'react-router-dom';
import { Field, MediaSelect, NumInput, StatusSelect, TextInput, Upload, Vec3Input } from '../components/ui';
import { api, mediaUrl } from '../lib/api';
import type { CameraClip, DialogClip, ProjectData, ScoreClip, SfxClip, StoryboardClip, SubtitleClip, TrackKind } from '../model/schema';
import { ownerKey, sampleCamera, type ResolvedClip, type ResolvedTimeline, type ShotSpan } from '../model/timeline';
import { removeClip, updateClip, updateShot } from '../store/actions';
import { useStore } from '../store/store';
import type { ViewportHandle } from './Monitor';
import { ttsRequestFor } from '../model/tts';

export const TRACK_LABEL: Record<TrackKind, string> = {
  storyboard: 'Storyboard', camera: 'Camera', subtitles: 'Subtitles', dialog: 'Dialog', sfx: 'Sound FX', score: 'Score',
};

function ownerLabel(data: ProjectData, rc: ResolvedClip) {
  const o = rc.owner;
  if (o.kind === 'episode') return `episode ${data.episodes[o.episodeId]?.title}`;
  const sc = data.scenes[o.sceneId];
  if (o.kind === 'scene') return `scene “${sc?.title}”`;
  return `shot “${sc?.shots.find((s) => s.id === o.shotId)?.name}” in ${sc?.title}`;
}

export function Inspector({ data, tl, sel, shot, time, viewport, onDeselect }: {
  data: ProjectData; tl: ResolvedTimeline; sel: ResolvedClip | undefined; shot: ShotSpan | undefined; time: number;
  viewport: React.RefObject<ViewportHandle | null>; onDeselect: () => void;
}) {
  if (sel) return <ClipInspector data={data} rc={sel} time={time} viewport={viewport} onDeselect={onDeselect} />;
  if (shot) return <ShotInspector data={data} span={shot} tl={tl} />;
  return <div className="inspector muted">Select a clip or a shot.</div>;
}

function ShotInspector({ data, span }: { data: ProjectData; span: ShotSpan; tl: ResolvedTimeline }) {
  const sh = span.shot;
  const sc = data.scenes[span.sceneId];
  const up = (fn: Parameters<typeof updateShot>[2], c?: string) => updateShot(span.sceneId, sh.id, fn, c);
  return (
    <div className="inspector">
      <h3>
        Shot <span className="muted mono">{sh.id}</span>
        <span className="grow" />
        <Link className="btn sm" to={`/ep/${sc.episodeId}/sc/${sc.id}/sh/${sh.id}`}>Open</Link>
      </h3>
      <div className="owner">{sc.title} · starts {span.start.toFixed(2)}s</div>
      <div className="col">
        <Field label="Name"><TextInput value={sh.name} onChange={(v) => up((s) => void (s.name = v), 'name')} /></Field>
        <div className="fields">
          <Field label="Duration (s)"><NumInput value={sh.duration} min={0.1} step={0.5} onChange={(v) => up((s) => void (s.duration = v))} /></Field>
          <Field label="Status"><StatusSelect value={sh.status} onChange={(v) => up((s) => void (s.status = v))} /></Field>
        </div>
        <Field label="Environment">
          <select className="select" value={sh.environmentId ?? ''} onChange={(e) => up((s) => void (s.environmentId = e.target.value || undefined))}>
            <option value="">(scene default: {sc.environmentId ? data.environments[sc.environmentId]?.name : 'none'})</option>
            {Object.values(data.environments).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Characters">
          <div className="row wrap">
            {Object.values(data.characters).map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={sh.characters.includes(c.id)}
                  onChange={(e) => up((s) => void (s.characters = e.target.checked ? [...s.characters, c.id] : s.characters.filter((x) => x !== c.id)))} />
                {c.name}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Visual / description"><TextInput multiline rows={4} value={sh.description} onChange={(v) => up((s) => void (s.description = v), 'desc')} /></Field>
        <Field label="Notes"><TextInput multiline rows={4} value={sh.notes} onChange={(v) => up((s) => void (s.notes = v), 'notes')} /></Field>
      </div>
    </div>
  );
}

function ClipInspector({ data, rc, time, viewport, onDeselect }: {
  data: ProjectData; rc: ResolvedClip; time: number; viewport: React.RefObject<ViewportHandle | null>; onDeselect: () => void;
}) {
  const { track, owner } = rc;
  const id = rc.clip.id;
  const up = <K extends TrackKind>(k: K) => (fn: Parameters<typeof updateClip<K>>[3], c?: string) => updateClip(owner, k, id, fn, c);
  const base = up(track);
  if (rc.credits) {
    return (
      <div className="inspector">
        <h3>{rc.credits === 'intro' ? 'Intro' : 'Outro'} credits music</h3>
        <p className="muted">Credits are global and shared by every episode.</p>
        <Link className="btn sm" to={`/credits/${rc.credits}`}>Edit {rc.credits} credits →</Link>
      </div>
    );
  }
  if (rc.derived) {
    return (
      <div className="inspector">
        <h3>Subtitle (from dialog)</h3>
        <p className="muted">This subtitle is generated from a dialog line. Edit the line on the Dialog track, or untick “show as subtitle”.</p>
      </div>
    );
  }
  const local = time - rc.start;
  return (
    <div className="inspector" key={ownerKey(owner) + id}>
      <h3>
        <span style={{ color: `var(--t-${track})` }}>●</span> {TRACK_LABEL[track]} clip
        <span className="grow" />
        <button className="btn sm danger" onClick={() => (removeClip(owner, track, id), onDeselect())}>Delete</button>
      </h3>
      <div className="owner">Owned by {ownerLabel(data, rc)}</div>
      <div className="fields">
        <Field label="Start (s)"><NumInput value={rc.clip.start} min={0} onChange={(v) => base((c) => void (c.start = v))} /></Field>
        <Field label="Duration (s)"><NumInput value={rc.clip.duration} min={0.05} onChange={(v) => base((c) => void (c.duration = v))} /></Field>
      </div>

      <div className="section col">
        {track === 'storyboard' && <StoryboardFields clip={rc.clip as StoryboardClip} up={up('storyboard')} />}
        {track === 'subtitles' && (
          <Field label="Text"><TextInput multiline value={(rc.clip as SubtitleClip).text} onChange={(v) => up('subtitles')((c) => void (c.text = v), 'text')} /></Field>
        )}
        {track === 'dialog' && <DialogFields data={data} clip={rc.clip as DialogClip} up={up('dialog')} />}
        {track === 'sfx' && <SfxFields clip={rc.clip as SfxClip} up={up('sfx')} />}
        {track === 'score' && <ScoreFields data={data} clip={rc.clip as ScoreClip} up={up('score')} />}
        {track === 'camera' && <CameraFields clip={rc.clip as CameraClip} up={up('camera')} local={local} viewport={viewport} />}
      </div>
    </div>
  );
}

type Up<T> = (fn: (c: T) => void, coalesce?: string) => void;

function StoryboardFields({ clip, up }: { clip: StoryboardClip; up: Up<StoryboardClip> }) {
  return (
    <>
      {clip.image && <img src={mediaUrl(clip.image)} style={{ width: '100%', borderRadius: 6, border: '1px solid var(--line)' }} alt="" />}
      <Field label="Image"><MediaSelect dir="media/boards" value={clip.image} onChange={(v) => up((c) => void (c.image = v))} /></Field>
      <Upload dir="media/boards" accept="image/*,video/*" onDone={(p) => up((c) => void (c.image = p))}>Drop a board (png/jpg/gif/mp4)</Upload>
      <Field label="Label"><TextInput value={clip.label ?? ''} onChange={(v) => up((c) => void (c.label = v || undefined), 'label')} /></Field>
    </>
  );
}

function DialogFields({ data, clip, up }: { data: ProjectData; clip: DialogClip; up: Up<DialogClip> }) {
  const tts = useStore((s) => s.tts);
  const ch = data.characters[clip.characterId];
  const regen = async () => {
    const r = await api.tts(ttsRequestFor(data, clip));
    up((c) => Object.assign(c, { audio: r.audio, audioHash: r.audioHash, duration: Math.round(r.duration * 1000) / 1000 }));
    useStore.getState().notify(`Audio ${r.cached ? 'cached' : 'generated'} with ${r.engine} (${r.duration.toFixed(2)}s)`);
  };
  return (
    <>
      <Field label="Character">
        <select className="select" value={clip.characterId} onChange={(e) => up((c) => Object.assign(c, { characterId: e.target.value, audio: undefined, audioHash: undefined }))}>
          {Object.values(data.characters).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Line">
        <TextInput multiline rows={4} value={clip.text} onChange={(v) => up((c) => Object.assign(c, { text: v, audio: undefined, audioHash: undefined }), 'text')} />
      </Field>
      <div className="row">
        <button className="btn sm primary" onClick={() => void regen()}>{clip.audio ? '↻ Regenerate audio' : '♪ Generate audio'}</button>
        <span className="muted" style={{ fontSize: 11.5 }}>{tts.piper ? 'Piper' : 'macOS say (run npm run setup:tts for Piper)'} · voice {ch?.voice ?? 'default'}</span>
      </div>
      {clip.audio ? <audio controls src={mediaUrl(clip.audio)} style={{ width: '100%', height: 32 }} /> : <div className="muted">No audio yet — timing is estimated.</div>}
      <div className="fields">
        <Field label="Gain"><NumInput value={clip.gain} step={0.05} min={0} max={4} onChange={(v) => up((c) => void (c.gain = v))} /></Field>
        <Field label="Subtitle">
          <label className="check"><input type="checkbox" checked={clip.subtitle} onChange={(e) => up((c) => void (c.subtitle = e.target.checked))} /> show as subtitle</label>
        </Field>
      </div>
    </>
  );
}

function SfxFields({ clip, up }: { clip: SfxClip; up: Up<SfxClip> }) {
  return (
    <>
      <Field label="File"><MediaSelect dir="media/audio/sfx" value={clip.file} onChange={(v) => up((c) => void (c.file = v))} /></Field>
      <Upload dir="media/audio/sfx" accept="audio/*" onDone={(p) => up((c) => void (c.file = p))}>Drop a sound file</Upload>
      <audio controls src={mediaUrl(clip.file)} style={{ width: '100%', height: 32 }} />
      <Field label="Gain"><NumInput value={clip.gain} step={0.05} min={0} max={4} onChange={(v) => up((c) => void (c.gain = v))} /></Field>
    </>
  );
}

function ScoreFields({ data, clip, up }: { data: ProjectData; clip: ScoreClip; up: Up<ScoreClip> }) {
  return (
    <>
      <Field label="Cue">
        <select className="select" value={clip.cueId} onChange={(e) => up((c) => void (c.cueId = e.target.value))}>
          {Object.values(data.cues).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="fields">
        <Field label="Offset into cue (s)"><NumInput value={clip.offset} min={0} onChange={(v) => up((c) => void (c.offset = v))} /></Field>
        <Field label="Gain"><NumInput value={clip.gain} step={0.05} min={0} max={4} onChange={(v) => up((c) => void (c.gain = v))} /></Field>
      </div>
      <Link className="btn sm" to={`/score/${clip.cueId}`}>Open cue in composer →</Link>
    </>
  );
}

function CameraFields({ clip, up, local, viewport }: { clip: CameraClip; up: Up<CameraClip>; local: number; viewport: React.RefObject<ViewportHandle | null> }) {
  const t = Math.max(0, Math.min(clip.duration, Math.round(local * 100) / 100));
  const setKey = () => {
    const v = viewport.current;
    const k = v ? v.getKey() : sampleCamera(clip, t);
    up((c) => {
      const near = c.keys.find((x) => Math.abs(x.t - t) < 0.05);
      if (near) Object.assign(near, k);
      else c.keys.push({ t, ...k });
      c.keys.sort((a, b) => a.t - b.t);
    });
  };
  return (
    <>
      <div className="row">
        <Field label="Label"><TextInput value={clip.label ?? ''} onChange={(v) => up((c) => void (c.label = v || undefined), 'label')} /></Field>
        <Field label="Ease">
          <select className="select" value={clip.ease} onChange={(e) => up((c) => void (c.ease = e.target.value as CameraClip['ease']))}>
            <option value="smooth">smooth</option>
            <option value="linear">linear</option>
          </select>
        </Field>
      </div>
      <div className="row">
        <button className="btn sm primary" onClick={setKey} title="Uses the 3D view (enable Pilot to frame it)">◆ Set key at playhead ({t.toFixed(2)}s)</button>
      </div>
      <div className="keys">
        {clip.keys.map((k, i) => (
          <div className="key" key={i}>
            <div className="kh">
              <span style={{ color: 'var(--t-camera)' }}>◆</span>
              <span className="muted">t</span>
              <div style={{ width: 70 }}><NumInput value={k.t} min={0} step={0.1} onChange={(v) => up((c) => void (c.keys[i].t = v))} /></div>
              <span className="muted">fov</span>
              <div style={{ width: 60 }}><NumInput value={k.fov} min={5} max={150} step={1} onChange={(v) => up((c) => void (c.keys[i].fov = v))} /></div>
              <span className="grow" />
              <button className="btn sm ghost" disabled={clip.keys.length < 2} onClick={() => up((c) => void c.keys.splice(i, 1))}>✕</button>
            </div>
            <Field label="Position"><Vec3Input value={k.position} onChange={(v) => up((c) => void (c.keys[i].position = v))} /></Field>
            <Field label="Target"><Vec3Input value={k.target} onChange={(v) => up((c) => void (c.keys[i].target = v))} /></Field>
          </div>
        ))}
      </div>
    </>
  );
}
