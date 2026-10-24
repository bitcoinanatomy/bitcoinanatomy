import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Table } from '../components/Table';
import { Field, Header, MediaSelect, NumInput, TextInput, Upload, useView, Vec3Input, ViewToggle } from '../components/ui';
import { mediaUrl } from '../lib/api';
import { EXPRESSIONS } from '../model/schema';
import type { Asset, Character, Environment, ProjectData } from '../model/schema';
import { LOOK_LABEL, LOOKS, useLook } from '../preview/look';
import { envThumbnail, glbThumbnail, mountCharacterCard, SceneView } from '../preview/SceneView';
import type { CardOptions } from '../preview/SceneView';
import { addLib, deleteLib, updateLib } from '../store/actions';
import { useData, useStore } from '../store/store';

type Kind = 'characters' | 'environments' | 'assets';
type Doc = Character | Environment | Asset;
const TITLE: Record<Kind, string> = { characters: 'Characters', environments: 'Environments', assets: 'Assets' };
const BLURB: Record<Kind, string> = {
  characters: 'Who appears or speaks. Each character has a TTS voice, a colour and optionally a glTF mesh.',
  environments: 'Sets: background, fog, lighting, placed props and character marks. Used by the 3D preview and the Blender export.',
  assets: 'Props and set pieces as glTF 2.0 (.glb) with PBR metal-rough textures — loads in three.js and Blender alike.',
};

/** Which shots use a library item */
function usages(data: ProjectData, kind: Kind, id: string) {
  const out: { to: string; label: string }[] = [];
  for (const sc of Object.values(data.scenes)) {
    for (const sh of sc.shots) {
      const env = sh.environmentId ?? sc.environmentId;
      const uses =
        kind === 'characters' ? sh.characters.includes(id) || sh.tracks.dialog.some((d) => d.characterId === id)
        : kind === 'environments' ? env === id
        : sh.assets.includes(id) || (!!env && !!data.environments[env]?.props.some((p) => p.assetId === id));
      if (uses) out.push({ to: `/ep/${sc.episodeId}/sc/${sc.id}/sh/${sh.id}`, label: `${data.episodes[sc.episodeId]?.title} › ${sc.title} › ${sh.name}` });
    }
  }
  return out;
}

function MeshThumb({ mesh, color }: { mesh?: string; color: string }) {
  const [src, setSrc] = useState<string>();
  const [look] = useLook();
  useEffect(() => {
    let live = true;
    void glbThumbnail(mesh, color, [320, 200], look).then((s) => live && setSrc(s));
    return () => void (live = false);
  }, [mesh, color, look]);
  return <div className="thumb" style={{ background: `radial-gradient(circle at 50% 40%, ${color}22, #000)` }}>{src && <img src={src} alt="" style={{ objectFit: 'contain' }} />}</div>;
}

/** A live, animated character on a card (shared WebGL context, see mountCharacterCard). */
function CharacterCard({ c, phase, opts }: { c: Character; phase: number; opts?: CardOptions }) {
  const el = useRef<HTMLCanvasElement>(null);
  const [look] = useLook();
  const key = JSON.stringify(opts ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => mountCharacterCard(el.current!, c.mesh, c.color, phase, opts, look), [c.mesh, c.color, phase, key, look]);
  return (
    <div className="thumb" style={{ background: `radial-gradient(circle at 50% 40%, ${c.color}22, #000)` }}>
      <canvas ref={el} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

/** Library order: the hero first, then the rest of the trio, then everyone else; extras last. */
const RANK = (d: Doc) => {
  const tags = (d as Character).tags ?? [];
  return tags.includes('hero') ? 0 : tags.includes('trio') ? 1 : tags.includes('extra') ? 3 : 2;
};
export const sortLib = <T extends Doc>(items: T[]) => [...items].sort((a, b) => RANK(a) - RANK(b));

function LookToggle() {
  const [look, setLook] = useLook();
  return (
    <div className="seg" title="Preview art direction">
      {LOOKS.map((k) => (
        <button key={k} type="button" className={look === k ? 'on' : ''} onClick={() => setLook(k)}>{LOOK_LABEL[k]}</button>
      ))}
    </div>
  );
}

function EnvThumb({ data, env }: { data: ProjectData; env: Environment }) {
  const [src, setSrc] = useState<string>();
  const [look] = useLook();
  // re-render only when this environment or the assets it places change
  const key = JSON.stringify([look, env, env.props.map((p) => data.assets[p.assetId])]);
  useEffect(() => {
    let live = true;
    void envThumbnail(data, env.id, [320, 200], look).then((s) => live && setSrc(s));
    return () => void (live = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="thumb" style={{ background: env.background }}>
      {src ? <img src={src} alt="" /> : <div className="placeholder" style={{ color: '#fff9' }}>{env.props.length} props · key {env.lighting.key}</div>}
    </div>
  );
}

/** All characters side by side, live and orbitable. */
function Lineup({ data }: { data: ProjectData }) {
  const [look] = useLook();
  const el = useRef<HTMLDivElement>(null);
  const view = useRef<SceneView | null>(null);
  const framed = useRef('');
  useEffect(() => {
    const v = new SceneView(el.current!);
    view.current = v;
    v.setPilot(true);
    return () => v.dispose();
  }, []);
  useEffect(() => {
    const ids = sortLib(Object.values(data.characters)).map((c) => c.id);
    const n = ids.length;
    const positions = Object.fromEntries(ids.map((id, i) => [id, { position: [(i - (n - 1) / 2) * 2, 0, 0] as [number, number, number], rotationY: 0 }]));
    view.current?.setLook(look);
    void view.current?.setContent(data, { assets: [], characters: ids, positions }).then(() => {
      const mark = `${look}:${ids.join()}`;
      if (framed.current === mark) return;
      framed.current = mark;
      view.current?.frame([0.25, 0.3, 1], 1.1);
    });
  }, [data, look]);
  return (
    <div className="viewer" style={{ aspectRatio: '21/8', marginBottom: 16 }}>
      <div className="gl" ref={el} />
    </div>
  );
}

export function LibraryPage({ kind }: { kind: Kind }) {
  const data = useData();
  const [view, setView] = useView('grid');
  const navigate = useNavigate();
  const items = sortLib(Object.values(data[kind]) as Doc[]);
  const add = () => {
    const name = prompt(`New ${TITLE[kind].slice(0, -1).toLowerCase()} name`);
    if (name) navigate(`/${kind}/${addLib(kind, name)}`);
  };
  return (
    <>
      <Header crumbs={[{ label: TITLE[kind] }]}>
        <LookToggle />
        <ViewToggle value={view} onChange={setView} modes={['grid', 'table']} />
        <button className="btn primary" onClick={add}>＋ New</button>
      </Header>
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>{TITLE[kind]}</h1>
            <p>{BLURB[kind]}</p>
          </div>
        </div>
        {kind === 'characters' && items.length > 0 && <Lineup data={data} />}
        {view === 'table' ? (
          <Table<Doc>
            rows={items}
            rowKey={(d) => d.id}
            cols={[
              { key: 'id', label: 'Id', width: 140, className: 'num', sort: (d) => d.id, render: (d) => <Link to={`/${kind}/${d.id}`}>{d.id}</Link> },
              { key: 'name', label: 'Name', width: 180, sort: (d) => d.name, render: (d) => <TextInput className="input bare" value={d.name} onChange={(v) => updateLib(kind, d.id, (x) => void (x.name = v), 'name')} /> },
              { key: 'desc', label: 'Description', render: (d) => <TextInput multiline rows={2} className="input bare" value={d.description} onChange={(v) => updateLib(kind, d.id, (x) => void (x.description = v), 'desc')} /> },
              { key: 'mesh', label: 'Mesh', width: 200, className: 'num', sort: (d) => d.mesh ?? '', render: (d) => d.mesh?.split('/').pop() ?? '—' },
              { key: 'uses', label: 'Shots', width: 60, className: 'num', sort: (d) => usages(data, kind, d.id).length, render: (d) => usages(data, kind, d.id).length },
            ]}
          />
        ) : (
          <div className="grid">
            {items.map((d, i) => (
              <Link key={d.id} to={`/${kind}/${d.id}`} className="tile">
                {kind === 'environments' ? (
                  <EnvThumb data={data} env={d as Environment} />
                ) : kind === 'characters' ? (
                  <CharacterCard c={d as Character} phase={i * 1.3} />
                ) : (
                  <MeshThumb mesh={d.mesh} color={d.color} />
                )}
                <div className="body">
                  <div className="title">{d.name}</div>
                  <div className="desc">{d.description}</div>
                  <div className="meta">
                    {kind === 'characters' && <span className="tag">voice {(d as Character).voice ?? 'default'}</span>}
                    {kind === 'assets' && <span className="tag">{(d as Asset).kind}</span>}
                    <span>{usages(data, kind, d.id).length} shots</span>
                  </div>
                </div>
              </Link>
            ))}
            <div className="tile add" onClick={add}>＋ New</div>
          </div>
        )}
      </div>
    </>
  );
}

/** Live 3D preview of a library item (single object or a whole environment). */
const MOVES: { motion: CardOptions['motion']; label: string; note: string }[] = [
  { motion: 'idle', label: 'Idle', note: 'standing still: a breathing bounce' },
  { motion: 'walk', label: 'Walk', note: 'moving between marks: hops and a waddle' },
  { motion: 'turn', label: 'Turnaround', note: 'full 360° to check the silhouette' },
  { motion: 'sway', label: 'Sway', note: 'library card: sways and cycles expressions' },
];

/** One card per facial expression and per movement, as used by shots (`shot.expressions`, `shot.positions[].moves`). */
function CharacterSheet({ c }: { c: Character }) {
  return (
    <>
      <div className="card pad col" style={{ gap: 10 }}>
        <h3>Expressions</h3>
        <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {EXPRESSIONS.map((e, i) => (
            <div key={e} className="col" style={{ gap: 4 }}>
              <CharacterCard c={c} phase={i * 0.9} opts={{ expression: e, motion: 'idle', face: true }} />
              <div className="mono" style={{ fontSize: 12 }}>{e}</div>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>Key them per shot in <span className="mono">shot.expressions[{c.id}]</span> as <span className="mono">{'{ t, expression }'}</span>.</div>
      </div>
      <div className="card pad col" style={{ gap: 10 }}>
        <h3>Movement</h3>
        <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {MOVES.map((m, i) => (
            <div key={m.motion} className="col" style={{ gap: 4 }}>
              <CharacterCard c={c} phase={i * 1.3} opts={{ motion: m.motion, expression: m.motion === 'sway' ? undefined : 'neutral' }} />
              <div style={{ fontSize: 12.5 }}>{m.label}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{m.note}</div>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>Walks come from <span className="mono">shot.positions[{c.id}].moves</span>: <span className="mono">{'{ t, position, rotationY }'}</span>.</div>
      </div>
    </>
  );
}

function Preview({ data, kind, id }: { data: ProjectData; kind: Kind; id: string }) {
  const [look] = useLook();
  const el = useRef<HTMLDivElement>(null);
  const view = useRef<SceneView | null>(null);
  const framed = useRef('');
  useEffect(() => {
    const v = new SceneView(el.current!);
    view.current = v;
    v.setPilot(true);
    v.setSkeletonDemo(kind === 'characters');
    v.camera.position.set(4, 3, 6);
    v.controls.target.set(0, kind === 'environments' ? 1 : 0.5, 0);
    framed.current = '';
    return () => v.dispose();
  }, [kind]);
  useEffect(() => {
    view.current?.setLook(look);
    void view.current
      ?.setContent(data, {
        envId: kind === 'environments' ? id : undefined,
        assets: kind === 'assets' ? [id] : [],
        characters: kind === 'characters' ? [id] : [],
      })
      .then(() => {
        // frame once per item so later edits don't yank the camera away from the user
        if (framed.current === id) return;
        framed.current = id;
        if (kind === 'environments') view.current?.frameEnvironment();
        else if (kind === 'characters') view.current?.frame([0.35, 0.02, 1], 1.05);
        else view.current?.frame([0.5, 0.3, 1], 1);
      });
  }, [data, kind, id, look]);
  return (
    <div className="viewer">
      <div className="gl" ref={el} />
    </div>
  );
}

export function LibraryDetail({ kind }: { kind: Kind }) {
  const { id = '' } = useParams();
  const data = useData();
  const navigate = useNavigate();
  const tts = useStore((s) => s.tts);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const doc = data[kind][id] as Doc | undefined;
  const uses = useMemo(() => usages(data, kind, id), [data, kind, id]);
  useEffect(() => {
    if (!openRef) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenRef(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openRef]);
  if (!doc) return <div className="empty">Not found</div>;
  const up = (fn: (d: Doc) => void, c?: string) => updateLib(kind, id, fn as never, c);

  return (
    <>
      <Header crumbs={[{ label: TITLE[kind], to: `/${kind}` }, { label: doc.name }]}>
        <LookToggle />
        <button className="btn danger" onClick={() => {
          if (!confirm(`Delete ${doc.name}?${uses.length ? ` It is used in ${uses.length} shots.` : ''}`)) return;
          deleteLib(kind, id);
          navigate(`/${kind}`);
        }}>Delete</button>
      </Header>
      <div className="page">
        <div className="detail">
          <div className="col" style={{ gap: 14 }}>
            <Preview data={data} kind={kind} id={id} />
            <div className="muted" style={{ fontSize: 12 }}>Drag to orbit, scroll to zoom, right-drag to pan. Coordinates are metres, Y-up (Blender import converts to Z-up).</div>
            {kind === 'environments' && <EnvEditor env={doc as Environment} data={data} />}
            {kind === 'characters' && <CharacterSheet c={doc as Character} />}
            <div className="card pad">
              <h3>Used in {uses.length} shots</h3>
              <div className="list">
                {uses.map((u) => <Link key={u.to} to={u.to}>{u.label}</Link>)}
                {!uses.length && <div className="muted">Not used yet.</div>}
              </div>
            </div>
          </div>

          <div className="card pad col" style={{ gap: 12 }}>
            <div className="muted mono" style={{ fontSize: 11.5 }}>project/{kind === 'assets' ? 'assets' : kind}/{id}.json</div>
            <Field label="Name"><TextInput value={doc.name} onChange={(v) => up((d) => void (d.name = v), 'name')} /></Field>
            <Field label="Description"><TextInput multiline rows={3} value={doc.description} onChange={(v) => up((d) => void (d.description = v), 'desc')} /></Field>
            {kind === 'characters' && (
              <>
                <Field label="Role"><TextInput value={(doc as Character).role} onChange={(v) => up((d) => void ((d as Character).role = v), 'role')} /></Field>
                <Field label={`Voice (${tts.piper ? 'Piper voices installed' : 'Piper not installed — macOS say fallback'})`}>
                  <select className="select" value={(doc as Character).voice ?? ''} onChange={(e) => up((d) => void ((d as Character).voice = e.target.value || undefined))}>
                    <option value="">project default</option>
                    {tts.voices.map((v) => <option key={v} value={v}>{v}</option>)}
                    {(doc as Character).voice && !tts.voices.includes((doc as Character).voice!) && <option value={(doc as Character).voice}>{(doc as Character).voice}</option>}
                  </select>
                </Field>
                <div className="fields">
                  <Field label="Pitch (semitones)">
                    <NumInput value={(doc as Character).voiceTune.pitch} step={1} min={-12} max={12} onChange={(v) => up((d) => void ((d as Character).voiceTune.pitch = v))} />
                  </Field>
                  <Field label="Speed">
                    <NumInput value={(doc as Character).voiceTune.speed} step={0.05} min={0.5} max={2} onChange={(v) => up((d) => void ((d as Character).voiceTune.speed = v))} />
                  </Field>
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>Changing voice, pitch or speed makes existing lines stale — regenerate with “Dialog audio” in a timeline.</div>
              </>
            )}
            {kind === 'assets' && (
              <Field label="Kind">
                <select className="select" value={(doc as Asset).kind} onChange={(e) => up((d) => void ((d as Asset).kind = e.target.value as Asset['kind']))}>
                  {['prop', 'set', 'fx', 'vehicle', 'other'].map((k) => <option key={k}>{k}</option>)}
                </select>
              </Field>
            )}
            <div className="fields">
              <Field label="Colour"><input type="color" className="input" style={{ height: 30, padding: 2 }} value={doc.color} onChange={(e) => up((d) => void (d.color = e.target.value), 'color')} /></Field>
              <Field label="Scale"><NumInput value={doc.scale} min={0.001} onChange={(v) => up((d) => void (d.scale = v))} /></Field>
            </div>
            {kind === 'environments' ? null : (
              <>
                <Field label="Mesh (.glb)"><MediaSelect dir="media/meshes" allowEmpty value={doc.mesh} onChange={(v) => up((d) => void (d.mesh = v || undefined))} /></Field>
                <Upload dir="media/meshes" accept=".glb,.gltf" onDone={(p) => up((d) => void (d.mesh = p))}>Drop a .glb (export from Blender: File › Export › glTF 2.0, format “glTF Binary”)</Upload>
              </>
            )}
            <div className="section col">
              <h3>Textures (PBR metal-rough)</h3>
              {(['baseColor', 'normal', 'roughness', 'metallic', 'emissive'] as const).map((slot) => (
                <Field key={slot} label={slot}>
                  <div className="row">
                    <div className="grow"><MediaSelect dir="media/textures" allowEmpty value={doc.textures[slot]} onChange={(v) => up((d) => void (d.textures[slot] = v || undefined))} /></div>
                    {doc.textures[slot] && <img src={mediaUrl(doc.textures[slot])} style={{ width: 30, height: 30, borderRadius: 4, objectFit: 'cover' }} alt="" />}
                  </div>
                </Field>
              ))}
              <Upload dir="media/textures" accept="image/*" onDone={() => useStore.getState().notify('Texture uploaded — pick it in a slot above')}>Drop texture images</Upload>
              <div className="muted" style={{ fontSize: 11.5 }}>Textures should be embedded in the .glb for rendering; these slots document the source maps and travel with the Blender bundle.</div>
            </div>
            <div className="section col">
              <h3>Reference images</h3>
              <div className="refs">
                {doc.refs.map((r) => (
                  <div key={r} className="ref">
                    <img src={mediaUrl(r)} alt="" title={r} onClick={() => setOpenRef(r)} />
                    <button type="button" className="ref-x" title="Remove" onClick={() => up((d) => void (d.refs = d.refs.filter((x) => x !== r)))}>✕</button>
                  </div>
                ))}
              </div>
              <Upload dir={`media/refs/${id}`} accept="image/*" onDone={(p) => up((d) => void d.refs.push(p))}>Drop reference images (click to enlarge, ✕ to remove)</Upload>
              {openRef && (
                <div className="ref-modal" onClick={() => setOpenRef(null)}>
                  <img src={mediaUrl(openRef)} alt="" onClick={(e) => e.stopPropagation()} />
                </div>
              )}
            </div>
            <Field label="Tags (comma separated)">
              <TextInput value={doc.tags.join(', ')} onChange={(v) => up((d) => void (d.tags = v.split(',').map((t) => t.trim()).filter(Boolean)), 'tags')} />
            </Field>
          </div>
        </div>
      </div>
    </>
  );
}

function EnvEditor({ env, data }: { env: Environment; data: ProjectData }) {
  const up = (fn: (e: Environment) => void, c?: string) => updateLib('environments', env.id, fn, c);
  return (
    <div className="card pad col" style={{ gap: 12 }}>
      <h3>Look</h3>
      <div className="fields">
        <Field label="Background"><input type="color" className="input" style={{ height: 30, padding: 2 }} value={env.background} onChange={(e) => up((x) => void (x.background = e.target.value), 'bg')} /></Field>
        <Field label="Fog">
          <label className="check"><input type="checkbox" checked={!!env.fog} onChange={(e) => up((x) => void (x.fog = e.target.checked ? { color: x.background, near: 8, far: 30 } : undefined))} /> enabled</label>
        </Field>
        {env.fog && <Field label="Fog near"><NumInput value={env.fog.near} onChange={(v) => up((x) => void (x.fog!.near = v))} /></Field>}
        {env.fog && <Field label="Fog far"><NumInput value={env.fog.far} onChange={(v) => up((x) => void (x.fog!.far = v))} /></Field>}
        <Field label="Ambient"><NumInput value={env.lighting.ambient} step={0.05} min={0} onChange={(v) => up((x) => void (x.lighting.ambient = v))} /></Field>
        <Field label="Key light"><NumInput value={env.lighting.key} step={0.1} min={0} onChange={(v) => up((x) => void (x.lighting.key = v))} /></Field>
        <Field label="Key colour"><input type="color" className="input" style={{ height: 30, padding: 2 }} value={env.lighting.keyColor} onChange={(e) => up((x) => void (x.lighting.keyColor = e.target.value), 'kc')} /></Field>
      </div>
      <Field label="Key light position"><Vec3Input value={env.lighting.keyPosition} onChange={(v) => up((x) => void (x.lighting.keyPosition = v))} /></Field>
      <h3 className="row">Props <span className="grow" />
        <button className="btn sm" onClick={() => up((x) => void x.props.push({ assetId: Object.keys(data.assets)[0], position: [0, 0, 0], rotationY: 0, scale: 1 }))}>＋ Prop</button>
      </h3>
      {env.props.map((p, i) => (
        <div key={i} className="key">
          <div className="kh">
            <select className="select" value={p.assetId} onChange={(e) => up((x) => void (x.props[i].assetId = e.target.value))}>
              {Object.values(data.assets).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <span className="muted">rotY</span>
            <div style={{ width: 64 }}><NumInput value={p.rotationY} step={5} onChange={(v) => up((x) => void (x.props[i].rotationY = v))} /></div>
            <span className="muted">scale</span>
            <div style={{ width: 64 }}><NumInput value={p.scale} min={0.01} onChange={(v) => up((x) => void (x.props[i].scale = v))} /></div>
            <button className="btn sm ghost danger" onClick={() => up((x) => void x.props.splice(i, 1))}>✕</button>
          </div>
          <Vec3Input value={p.position} onChange={(v) => up((x) => void (x.props[i].position = v))} />
        </div>
      ))}
      <h3 className="row">Character marks <span className="grow" />
        <button className="btn sm" onClick={() => up((x) => void x.marks.push([0, 0, 0]))}>＋ Mark</button>
      </h3>
      {env.marks.map((m, i) => (
        <div key={i} className="row">
          <span className="muted mono" style={{ width: 20 }}>{i + 1}</span>
          <div className="grow"><Vec3Input value={m} onChange={(v) => up((x) => void (x.marks[i] = v))} /></div>
          <button className="btn sm ghost danger" onClick={() => up((x) => void x.marks.splice(i, 1))}>✕</button>
        </div>
      ))}
    </div>
  );
}
