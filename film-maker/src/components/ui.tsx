import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, mediaUrl } from '../lib/api';
import type { Status, Vec3 } from '../model/schema';
import { useStore } from '../store/store';

export const STATUSES: Status[] = ['todo', 'wip', 'review', 'done'];

export function StatusPill({ s }: { s: Status }) {
  return (
    <span className={`pill status-${s}`}>
      <span className="dot" />
      {s}
    </span>
  );
}

export function StatusSelect({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  return (
    <select className={`status status-${value}`} value={value} onChange={(e) => onChange(e.target.value as Status)} onClick={(e) => e.stopPropagation()}>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

/** Text input that edits live (coalesced into one undo step by the caller). */
export function TextInput({ value, onChange, className = 'input', placeholder, multiline, rows }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; multiline?: boolean; rows?: number;
}) {
  if (multiline)
    return <textarea className={className.replace('input', 'textarea')} rows={rows ?? 3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
  return <input className={className} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** Number input that commits on blur/enter so partial typing ("1.") works. */
export function NumInput({ value, onChange, step = 0.1, min, max, className = 'input num', title }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; className?: string; title?: string;
}) {
  const [text, setText] = useState(String(round(value)));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(round(value)));
  }, [value]);
  const commit = () => {
    let v = parseFloat(text);
    if (Number.isNaN(v)) return setText(String(round(value)));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onChange(v);
    setText(String(round(v)));
  };
  return (
    <input
      className={className}
      title={title}
      value={text}
      inputMode="decimal"
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          let v = round(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
          if (min !== undefined) v = Math.max(min, v);
          if (max !== undefined) v = Math.min(max, v);
          setText(String(v));
          onChange(v);
        }
      }}
      onChange={(e) => setText(e.target.value)}
    />
  );
}
const round = (n: number) => Math.round(n * 1000) / 1000;

export function Vec3Input({ value, onChange }: { value: Vec3; onChange: (v: Vec3) => void }) {
  return (
    <div className="vec">
      {value.map((n, i) => (
        <NumInput key={i} value={n} title={'xyz'[i]} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)) as Vec3)} />
      ))}
    </div>
  );
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="field" style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export type ViewMode = 'grid' | 'table' | 'timeline' | 'details';
export function useView(def: ViewMode): [ViewMode, (v: ViewMode) => void] {
  const [sp, setSp] = useSearchParams();
  const v = (sp.get('view') as ViewMode) ?? def;
  return [v, (nv) => setSp((p) => (p.set('view', nv), p), { replace: true })];
}

function HistoryIcon({ dir }: { dir: 'undo' | 'redo' }) {
  const flip = dir === 'redo';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <g transform={flip ? 'translate(14 0) scale(-1 1)' : undefined}>
        <path d="M4.2 4.2H8.6a3.2 3.2 0 1 1 0 6.4H6.2" />
        <path d="M6.1 2.3 3.6 4.2 6.1 6.1" />
      </g>
    </svg>
  );
}

function ViewIcon({ mode }: { mode: ViewMode }) {
  const common = { width: 11, height: 11, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, 'aria-hidden': true as const };
  if (mode === 'grid') {
    return (
      <svg {...common}>
        <rect x="1" y="1" width="4" height="4" />
        <rect x="7" y="1" width="4" height="4" />
        <rect x="1" y="7" width="4" height="4" />
        <rect x="7" y="7" width="4" height="4" />
      </svg>
    );
  }
  if (mode === 'table') {
    return (
      <svg {...common}>
        <path d="M1.5 2.5h9M1.5 6h9M1.5 9.5h9" />
      </svg>
    );
  }
  if (mode === 'timeline') {
    return (
      <svg {...common}>
        <rect x="1" y="3.5" width="10" height="5" rx="0.6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="1" y="1" width="4.2" height="10" />
      <rect x="6.8" y="1" width="4.2" height="10" />
    </svg>
  );
}

export function ViewToggle({ value, onChange, modes }: { value: ViewMode; onChange: (v: ViewMode) => void; modes: ViewMode[] }) {
  const label: Record<ViewMode, string> = { grid: 'Grid', table: 'Table', timeline: 'Timeline', details: 'Details' };
  return (
    <div className="seg">
      {modes.map((m) => (
        <button key={m} className={m === value ? 'on' : ''} onClick={() => onChange(m)}>
          <ViewIcon mode={m} />
          {label[m]}
        </button>
      ))}
    </div>
  );
}

export function Header({ crumbs, children }: { crumbs: { label: string; to?: string }[]; children?: ReactNode }) {
  const saving = useStore((s) => s.saving);
  const error = useStore((s) => s.error);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  return (
    <div className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} className="row" style={{ gap: 6 }}>
            {i > 0 && <span>/</span>}
            {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span className="cur">{c.label}</span>}
          </span>
        ))}
      </div>
      <div className="spacer" />
      {children}
      <div className="history" role="group" aria-label="Edit history">
        <button className="btn ghost icon" title="Undo (⌘Z)" aria-label="Undo" disabled={!past} onClick={() => useStore.getState().undo()}>
          <HistoryIcon dir="undo" />
        </button>
        <button className="btn ghost icon" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!future} onClick={() => useStore.getState().redo()}>
          <HistoryIcon dir="redo" />
        </button>
      </div>
      <span className={`saving ${saving}`} title={error}>
        <span className="dot" />
        {saving === 'idle' ? 'Saved' : saving === 'error' ? 'Save failed' : 'Saving…'}
      </span>
    </div>
  );
}

export function Thumb({ src, text, badge, dur }: { src?: string; text?: string; badge?: string; dur?: string }) {
  return (
    <div className="thumb">
      {src ? <img src={mediaUrl(src)} loading="lazy" alt="" /> : <div className="placeholder">{text || 'No storyboard'}</div>}
      {badge && <span className="badge">{badge}</span>}
      {dur && <span className="dur">{dur}</span>}
    </div>
  );
}

/** Drop zone / picker that uploads into project/<dir>. */
export function Upload({ dir, accept, onDone, children }: { dir: string; accept?: string; onDone: (path: string) => void; children?: ReactNode }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const send = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const r = await api.upload(f, dir, f.name);
      onDone(r.path);
    }
  };
  return (
    <div
      className={`drop ${over ? 'over' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void send(e.dataTransfer.files);
      }}
    >
      <input ref={input} type="file" hidden accept={accept} multiple onChange={(e) => void send(e.target.files)} />
      {children ?? 'Drop files or click to upload'}
    </div>
  );
}

/** Lists project media under a directory (for pickers). */
export function useMedia(dir: string) {
  const [files, setFiles] = useState<string[]>([]);
  const [n, setN] = useState(0);
  useEffect(() => {
    api.media(dir).then((r) => setFiles(r.files)).catch(() => setFiles([]));
  }, [dir, n]);
  return [files, () => setN((x) => x + 1)] as const;
}

export function MediaSelect({ dir, value, onChange, allowEmpty }: { dir: string; value?: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  const [files, refresh] = useMedia(dir);
  return (
    <select className="select" value={value ?? ''} onFocus={refresh} onChange={(e) => onChange(e.target.value)}>
      {(allowEmpty || !value) && <option value="">—</option>}
      {value && !files.includes(value) && <option value={value}>{value}</option>}
      {files.map((f) => (
        <option key={f} value={f}>
          {f.replace(`${dir}/`, '')}
        </option>
      ))}
    </select>
  );
}
