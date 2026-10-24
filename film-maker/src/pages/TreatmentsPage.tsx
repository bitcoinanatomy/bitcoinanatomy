import { useState } from 'react';
import { Field, Header, StatusSelect, TextInput } from '../components/ui';
import { mediaUrl } from '../lib/api';
import { TREATMENTS_MEDIA, type Treatment, type TreatmentMedium } from '../model/schema';
import { useData, useStore } from '../store/store';

const BOARDS = ['media/boards/treatment-board.jpg', 'media/boards/treatment-iconic.jpg'];
const CAST = ['mili', 'sati', 'bit'] as const;

const MEDIUM_LABEL: Record<TreatmentMedium, string> = {
  cinematic: '3D cinematic',
  cartoon: '2D cartoon',
  storybook: 'Storybook',
  retro: 'Retro',
  anime: 'Anime',
  iconic: 'Minimal',
  stopmotion: 'Stop-motion',
  clay: '3D clay',
  animatic: 'Line sketch',
  geometric: 'Geometric',
  collage: 'Paper cutout',
  bw: 'Black & white',
  custom: 'Custom',
};

function edit(id: string, fn: (t: Treatment) => void, coalesce?: string) {
  useStore.getState().mutate('edit treatment', (d) => {
    const t = d.treatments[id];
    if (t && !t.reference) fn(t);
  }, coalesce && `treatment:${id}:${coalesce}`);
}

function nextId(existing: Record<string, Treatment>, base: string) {
  let id = base;
  for (let i = 2; existing[id]; i++) id = `${base}_${i}`;
  return id;
}

export function TreatmentsPage() {
  const data = useData();
  const all = Object.values(data.treatments).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const refs = all.filter((t) => t.reference);
  const plans = all.filter((t) => !t.reference);
  const [sel, setSel] = useState<string | null>(plans.find((p) => p.chosen)?.id ?? plans[0]?.id ?? refs[0]?.id ?? null);
  const current = (sel && data.treatments[sel]) || plans[0] || refs[0];

  const fork = (src: Treatment) => {
    const id = nextId(data.treatments, `tx_${src.medium}`);
    useStore.getState().mutate('plan treatment', (d) => {
      for (const t of Object.values(d.treatments)) if (!t.reference) t.chosen = false;
      const n = Object.values(d.treatments).filter((t) => !t.reference).length;
      d.treatments[id] = {
        ...structuredClone(src),
        id,
        name: `${src.name} plan`,
        reference: false,
        chosen: true,
        status: 'wip',
        order: 10 + n,
        notes: '',
      };
    });
    setSel(id);
  };

  const blank = () => {
    const id = nextId(data.treatments, 'tx_plan');
    useStore.getState().mutate('new treatment', (d) => {
      d.treatments[id] = {
        id,
        name: 'New treatment',
        status: 'todo',
        order: 10 + Object.values(d.treatments).filter((t) => !t.reference).length,
        reference: false,
        chosen: !Object.values(d.treatments).some((t) => t.chosen && !t.reference),
        medium: 'custom',
        adjectives: [],
        principles: [],
        palette: ['#f4efe4', '#ffd9a0', '#1c2430'],
        characters: { mili: '', sati: '', bit: '' },
        camera: '',
        light: '',
        line: '',
        materials: '',
        notes: '',
      };
    });
    setSel(id);
  };

  const choose = (id: string) => {
    useStore.getState().mutate('choose treatment', (d) => {
      for (const t of Object.values(d.treatments)) if (!t.reference) t.chosen = t.id === id;
    });
    setSel(id);
  };

  const remove = (id: string) => {
    useStore.getState().mutate('delete treatment', (d) => {
      delete d.treatments[id];
    });
    setSel(plans.find((p) => p.id !== id)?.id ?? refs[0]?.id ?? null);
  };

  return (
    <>
      <Header crumbs={[{ label: 'Treatments' }]} />
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>Treatments</h1>
            <p>Compare the style board, then fork one look into a working plan. The plan is where the film’s lighting, line, materials and the trio’s shapes get decided. References stay locked.</p>
          </div>
          <button className="btn primary" onClick={blank}>New plan</button>
        </div>

        {BOARDS.map((src) => (
          <img key={src} className="tx-board" src={mediaUrl(src)} alt="" />
        ))}

        <div className="tx-layout">
          <div>
            <h3>Style board</h3>
            <div className="tx-grid">
              {refs.map((t) => (
                <button key={t.id} className={`tx-card ${current?.id === t.id ? 'on' : ''}`} onClick={() => setSel(t.id)}>
                  <Still t={t} />
                  <div className="tx-card-body">
                    <div className="tx-kicker">{String(t.order).padStart(2, '0')} · {MEDIUM_LABEL[t.medium]}</div>
                    <div className="title">{t.name}</div>
                    <div className="tx-adj">{t.adjectives.join(' · ')}</div>
                  </div>
                </button>
              ))}
            </div>
            {plans.length > 0 && (
              <>
                <h3>Plans</h3>
                <div className="tx-grid">
                  {plans.map((t) => (
                    <button key={t.id} className={`tx-card ${current?.id === t.id ? 'on' : ''}`} onClick={() => setSel(t.id)}>
                      <Still t={t} />
                      <div className="tx-card-body">
                        <div className="tx-kicker">{t.chosen ? 'Chosen' : 'Plan'} · {MEDIUM_LABEL[t.medium]}</div>
                        <div className="title">{t.name}</div>
                        <div className="tx-adj">{t.adjectives.join(' · ') || 'No adjectives yet'}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {current && (
            <aside className="tx-editor card pad">
              <div className="row" style={{ marginBottom: 12 }}>
                <span className="pill"><span className="dot" />{current.reference ? 'reference' : current.chosen ? 'chosen' : 'plan'}</span>
                <span className="grow" />
                {current.reference ? (
                  <button className="btn primary" onClick={() => fork(current)}>Plan from this</button>
                ) : (
                  <>
                    {!current.chosen && <button className="btn" onClick={() => choose(current.id)}>Make this the look</button>}
                    <button className="btn danger" onClick={() => remove(current.id)}>Delete</button>
                  </>
                )}
              </div>
              {current.board && <img className="tx-board" src={mediaUrl(current.board)} alt="" />}
              {current.reference ? <Reference t={current} /> : <Plan t={current} />}
            </aside>
          )}
        </div>
      </div>
    </>
  );
}

function Still({ t }: { t: Treatment }) {
  const [skin, glow, accent, ground] = [t.palette[0] || '#f4efe4', t.palette[1] || '#ffd9a0', t.palette[2] || '#7eb6ff', t.palette[3] || '#141820'];
  return (
    <div className={`tx-still tx-${t.medium}`} style={{ background: ground, ['--skin' as string]: skin, ['--glow' as string]: glow, ['--accent' as string]: accent }}>
      <span className="fig s" />
      <span className="fig m" />
      <span className="fig l" />
    </div>
  );
}

function Reference({ t }: { t: Treatment }) {
  return (
    <div className="col" style={{ gap: 14 }}>
      <div>
        <div className="tx-kicker">{String(t.order).padStart(2, '0')}</div>
        <h2 style={{ marginTop: 4 }}>{t.name}</h2>
        <div className="tx-adj">{t.adjectives.join(' · ')}</div>
      </div>
      <Swatches colors={t.palette} />
      <ul className="tx-principles">
        {t.principles.map((p) => <li key={p}>{p}</li>)}
      </ul>
      <div className="fields">
        <Field label="Camera" wide><p className="sub">{t.camera}</p></Field>
        <Field label="Light" wide><p className="sub">{t.light}</p></Field>
        <Field label="Line" wide><p className="sub">{t.line}</p></Field>
        <Field label="Materials" wide><p className="sub">{t.materials}</p></Field>
      </div>
      {CAST.map((id) => t.characters[id] && (
        <Field key={id} label={id} wide><p className="sub">{t.characters[id]}</p></Field>
      ))}
    </div>
  );
}

function Plan({ t }: { t: Treatment }) {
  const set = (coalesce: string, fn: (x: Treatment) => void) => edit(t.id, fn, coalesce);
  const chars = [...new Set([...CAST, ...Object.keys(t.characters)])];
  return (
    <div className="col" style={{ gap: 12 }}>
      <TextInput className="input bare" value={t.name} onChange={(v) => set('name', (x) => { x.name = v; })} />
      <div className="fields">
        <Field label="Status">
          <StatusSelect value={t.status} onChange={(s) => edit(t.id, (x) => { x.status = s; })} />
        </Field>
        <Field label="Medium">
          <select className="select" value={t.medium} onChange={(e) => edit(t.id, (x) => { x.medium = e.target.value as TreatmentMedium; })}>
            {TREATMENTS_MEDIA.map((m) => <option key={m} value={m}>{MEDIUM_LABEL[m]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Adjectives" wide>
        <TextInput value={t.adjectives.join(', ')} placeholder="clean, bold, quiet" onChange={(v) => set('adj', (x) => {
          const parts = v.split(',').map((s) => s.trim());
          x.adjectives = /[,\s]$/.test(v) ? parts : parts.filter(Boolean);
        })} />
      </Field>
      <Field label="Palette" wide>
        <div className="row wrap">
          {t.palette.map((c, i) => (
            <input key={i} className="input" type="color" value={toHex(c)} title={c} onChange={(e) => set('pal', (x) => { x.palette[i] = e.target.value; })} />
          ))}
          {t.palette.length < 6 && <button className="btn sm" onClick={() => edit(t.id, (x) => { x.palette.push('#888888'); })}>Add</button>}
          {t.palette.length > 1 && <button className="btn sm" onClick={() => edit(t.id, (x) => { x.palette.pop(); })}>Remove</button>}
        </div>
      </Field>
      <Field label="Principles" wide>
        <TextInput multiline rows={4} value={t.principles.join('\n')} placeholder="One principle per line" onChange={(v) => set('pr', (x) => {
          const parts = v.split('\n');
          x.principles = v.endsWith('\n') ? parts : parts.map((s) => s.trim()).filter(Boolean);
        })} />
      </Field>
      <div className="fields">
        <Field label="Camera" wide><TextInput multiline rows={2} value={t.camera} onChange={(v) => set('cam', (x) => { x.camera = v; })} /></Field>
        <Field label="Light" wide><TextInput multiline rows={2} value={t.light} onChange={(v) => set('light', (x) => { x.light = v; })} /></Field>
        <Field label="Line" wide><TextInput multiline rows={2} value={t.line} onChange={(v) => set('line', (x) => { x.line = v; })} /></Field>
        <Field label="Materials" wide><TextInput multiline rows={2} value={t.materials} onChange={(v) => set('mat', (x) => { x.materials = v; })} /></Field>
      </div>
      <h3 style={{ marginTop: 8 }}>Characters</h3>
      {chars.map((id) => (
        <Field key={id} label={id} wide>
          <TextInput multiline rows={2} value={t.characters[id] ?? ''} onChange={(v) => set(`ch:${id}`, (x) => { x.characters[id] = v; })} />
        </Field>
      ))}
      <Field label="Notes" wide>
        <TextInput multiline rows={4} value={t.notes} placeholder="What this plan changes, and what is still open" onChange={(v) => set('notes', (x) => { x.notes = v; })} />
      </Field>
    </div>
  );
}

function Swatches({ colors }: { colors: string[] }) {
  return (
    <div className="row">
      {colors.map((c) => <span key={c} className="tx-swatch" style={{ background: c }} title={c} />)}
    </div>
  );
}

function toHex(c: string) {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#888888';
}
