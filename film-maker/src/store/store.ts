/**
 * App state: the whole project in memory, undo/redo, debounced per-document autosave,
 * and live reload when files change on disk (e.g. an agent edited project/*.json).
 */
import { create } from 'zustand';
import { api, type DocRef, type LoadIssue } from '../lib/api';
import type { ProjectData } from '../model/schema';

type DocEntry = { ref: DocRef; doc: unknown };

/** Flatten a project into its on-disk documents, keyed by a stable string. */
export function docsOf(d: ProjectData): Map<string, DocEntry> {
  const m = new Map<string, DocEntry>();
  m.set('project', { ref: { kind: 'project', id: 'project' }, doc: d.project });
  for (const e of Object.values(d.episodes)) m.set(`episode:${e.id}`, { ref: { kind: 'episode', id: e.id }, doc: e });
  for (const s of Object.values(d.scenes)) {
    const { episodeId, ...doc } = s;
    m.set(`scene:${s.id}`, { ref: { kind: 'scene', id: s.id, episodeId }, doc });
  }
  for (const c of Object.values(d.characters)) m.set(`character:${c.id}`, { ref: { kind: 'character', id: c.id }, doc: c });
  for (const e of Object.values(d.environments)) m.set(`environment:${e.id}`, { ref: { kind: 'environment', id: e.id }, doc: e });
  for (const a of Object.values(d.assets)) m.set(`asset:${a.id}`, { ref: { kind: 'asset', id: a.id }, doc: a });
  for (const c of Object.values(d.cues)) m.set(`cue:${c.id}`, { ref: { kind: 'cue', id: c.id }, doc: c });
  for (const c of Object.values(d.credits ?? {})) m.set(`credits:${c.id}`, { ref: { kind: 'credits', id: c.id }, doc: c });
  for (const t of Object.values(d.treatments ?? {})) m.set(`treatment:${t.id}`, { ref: { kind: 'treatment', id: t.id }, doc: t });
  return m;
}

interface State {
  data: ProjectData | null;
  issues: LoadIssue[];
  tts: { piper: boolean; voices: string[] };
  saving: 'idle' | 'pending' | 'saving' | 'error';
  error?: string;
  past: { data: ProjectData; label: string }[];
  future: { data: ProjectData; label: string }[];
  lastLabel?: { key: string; at: number };
  toast?: { text: string; at: number };
  load: () => Promise<void>;
  /** Apply an edit. `fn` mutates a draft copy. `coalesce` merges rapid edits (typing) into one undo step. */
  mutate: (label: string, fn: (d: ProjectData) => void, coalesce?: string) => void;
  undo: () => void;
  redo: () => void;
  notify: (text: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let missedReload: string[] | null = null; // a disk change arrived while we had unsaved edits
type Saved = { json: string; ref: DocRef };
let savedDocs = new Map<string, Saved>(); // what we believe is on disk

const serialize = (d: ProjectData) => {
  const m = new Map<string, Saved>();
  for (const [k, v] of docsOf(d)) m.set(k, { json: JSON.stringify(v.doc), ref: v.ref });
  return m;
};

async function flush() {
  const { data } = useStore.getState();
  if (!data) return;
  useStore.setState({ saving: 'saving' });
  const docs = docsOf(data);
  const now = serialize(data);
  try {
    for (const [k, cur] of now) {
      if (savedDocs.get(k)?.json !== cur.json) {
        await api.save(cur.ref, docs.get(k)!.doc);
        savedDocs.set(k, cur);
      }
    }
    for (const [k, old] of [...savedDocs]) {
      if (!now.has(k)) {
        await api.remove(old.ref);
        savedDocs.delete(k);
      }
    }
    useStore.setState({ saving: 'idle', error: undefined });
    if (missedReload) {
      const files = missedReload;
      missedReload = null;
      void reloadFromDisk(files);
    }
  } catch (e) {
    useStore.setState({ saving: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

const scheduleSave = () => {
  useStore.setState({ saving: 'pending' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 350);
};

export const useStore = create<State>((set, get) => ({
  data: null,
  issues: [],
  tts: { piper: false, voices: [] },
  saving: 'idle',
  past: [],
  future: [],
  async load() {
    const r = await api.project();
    savedDocs = serialize(r.data);
    set({ data: r.data, issues: r.issues, tts: r.tts });
  },
  mutate(label, fn, coalesce) {
    const { data, past, lastLabel } = get();
    if (!data) return;
    const draft = structuredClone(data);
    fn(draft);
    const now = Date.now();
    const merge = coalesce && lastLabel?.key === coalesce && now - lastLabel.at < 1500;
    set({
      data: draft,
      past: merge ? past : [...past.slice(-199), { data, label }],
      future: [],
      lastLabel: coalesce ? { key: coalesce, at: now } : undefined,
    });
    scheduleSave();
  },
  undo() {
    const { past, data, future } = get();
    const prev = past.at(-1);
    if (!prev || !data) return;
    set({ data: prev.data, past: past.slice(0, -1), future: [{ data, label: prev.label }, ...future], lastLabel: undefined });
    get().notify(`Undo: ${prev.label}`);
    scheduleSave();
  },
  redo() {
    const { past, data, future } = get();
    const next = future[0];
    if (!next || !data) return;
    set({ data: next.data, past: [...past, { data, label: next.label }], future: future.slice(1), lastLabel: undefined });
    get().notify(`Redo: ${next.label}`);
    scheduleSave();
  },
  notify(text) {
    set({ toast: { text, at: Date.now() } });
  },
}));

/** Live reload: Vite pushes `fm:changed` when project/*.json changes on disk. */
if (import.meta.hot) {
  import.meta.hot.on('fm:changed', (msg: { files: string[] }) => reloadFromDisk(msg.files));
}

async function reloadFromDisk(files: string[]) {
  const st = useStore.getState();
  if (!st.data) return;
  if (st.saving !== 'idle') {
    missedReload = [...(missedReload ?? []), ...files];
    return;
  }
  const r = await api.project();
  const incoming = serialize(r.data);
  const changed =
    [...incoming].some(([k, v]) => savedDocs.get(k)?.json !== v.json) || [...savedDocs.keys()].some((k) => !incoming.has(k));
  savedDocs = incoming;
  if (!changed) {
    useStore.setState({ issues: r.issues });
    return;
  }
  useStore.setState({
    data: r.data,
    issues: r.issues,
    past: [...st.past, { data: st.data, label: 'external edit' }],
    future: [],
  });
  st.notify(`Reloaded from disk: ${files.slice(0, 3).join(', ')}${files.length > 3 ? '…' : ''}`);
}

// ---------------------------------------------------------------- selectors / helpers

export const useData = () => useStore((s) => s.data!);
