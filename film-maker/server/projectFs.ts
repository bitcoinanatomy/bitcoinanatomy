/**
 * Reads and writes the on-disk project (`film-maker/project/`).
 * Shared by the Vite dev API, the CLI scripts and the exporter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMAS, type DocKind, type ProjectData } from '../src/model/schema';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_DIR = path.join(ROOT, 'project');

const LIB_DIRS: Record<string, string> = {
  character: 'characters',
  environment: 'environments',
  asset: 'assets',
  cue: 'score',
  credits: 'credits',
};

export interface DocRef {
  kind: DocKind;
  id: string;
  /** required for scenes */
  episodeId?: string;
}

export function docPath(ref: DocRef): string {
  const safe = (s: string) => {
    if (!/^[\w-]+$/.test(s)) throw new Error(`invalid id "${s}"`);
    return s;
  };
  switch (ref.kind) {
    case 'project':
      return path.join(PROJECT_DIR, 'project.json');
    case 'episode':
      return path.join(PROJECT_DIR, 'episodes', safe(ref.id), 'episode.json');
    case 'scene':
      if (!ref.episodeId) throw new Error('scene requires episodeId');
      return path.join(PROJECT_DIR, 'episodes', safe(ref.episodeId), 'scenes', `${safe(ref.id)}.json`);
    default:
      return path.join(PROJECT_DIR, LIB_DIRS[ref.kind], `${safe(ref.id)}.json`);
  }
}

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const listJson = (dir: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];

export interface LoadIssue {
  file: string;
  message: string;
}

/** Load the whole project. Invalid files are reported, not thrown. */
export function loadProject(): { data: ProjectData; issues: LoadIssue[] } {
  const issues: LoadIssue[] = [];
  const parse = <K extends DocKind>(kind: K, file: string) => {
    try {
      return SCHEMAS[kind].parse(readJson(file)) as ReturnType<(typeof SCHEMAS)[K]['parse']>;
    } catch (e) {
      issues.push({ file: path.relative(ROOT, file), message: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
  };

  const project = parse('project', docPath({ kind: 'project', id: 'project' })) ?? SCHEMAS.project.parse({ title: 'Untitled' });
  const data: ProjectData = { project, episodes: {}, scenes: {}, characters: {}, environments: {}, assets: {}, cues: {}, credits: {} };

  const epRoot = path.join(PROJECT_DIR, 'episodes');
  const epIds = fs.existsSync(epRoot) ? fs.readdirSync(epRoot).filter((d) => fs.existsSync(path.join(epRoot, d, 'episode.json'))) : [];
  for (const epId of epIds) {
    const ep = parse('episode', path.join(epRoot, epId, 'episode.json'));
    if (!ep) continue;
    data.episodes[ep.id] = ep;
    const scDir = path.join(epRoot, epId, 'scenes');
    for (const f of listJson(scDir)) {
      const sc = parse('scene', path.join(scDir, f));
      if (sc) data.scenes[sc.id] = { ...sc, episodeId: ep.id };
    }
  }
  const lib = <K extends 'character' | 'environment' | 'asset' | 'cue' | 'credits'>(kind: K, target: Record<string, unknown>) => {
    const dir = path.join(PROJECT_DIR, LIB_DIRS[kind]);
    for (const f of listJson(dir)) {
      const doc = parse(kind, path.join(dir, f)) as { id: string } | undefined;
      if (doc) target[doc.id] = doc;
    }
  };
  lib('character', data.characters);
  lib('environment', data.environments);
  lib('asset', data.assets);
  lib('cue', data.cues);
  lib('credits', data.credits);
  return { data, issues };
}

/** Validate and write one document. Returns the normalized document. */
export function saveDoc(ref: DocRef, doc: unknown) {
  const clean = SCHEMAS[ref.kind].parse(doc);
  const file = docPath(ref);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(clean, null, 2) + '\n';
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
  return clean;
}

export function deleteDoc(ref: DocRef) {
  const file = docPath(ref);
  if (ref.kind === 'episode') fs.rmSync(path.dirname(file), { recursive: true, force: true });
  else fs.rmSync(file, { force: true });
}

/** Resolve a project-relative media path, refusing anything outside project/. */
export function mediaPath(rel: string) {
  const p = path.resolve(PROJECT_DIR, rel);
  if (!p.startsWith(PROJECT_DIR + path.sep)) throw new Error(`path escapes project: ${rel}`);
  return p;
}

/** Write every document of a ProjectData (used by generators/importers). */
export function saveAll(data: ProjectData) {
  saveDoc({ kind: 'project', id: 'project' }, data.project);
  for (const ep of Object.values(data.episodes)) saveDoc({ kind: 'episode', id: ep.id }, ep);
  for (const sc of Object.values(data.scenes)) saveDoc({ kind: 'scene', id: sc.id, episodeId: sc.episodeId }, sc);
  for (const c of Object.values(data.characters)) saveDoc({ kind: 'character', id: c.id }, c);
  for (const e of Object.values(data.environments)) saveDoc({ kind: 'environment', id: e.id }, e);
  for (const a of Object.values(data.assets)) saveDoc({ kind: 'asset', id: a.id }, a);
  for (const c of Object.values(data.cues)) saveDoc({ kind: 'cue', id: c.id }, c);
  for (const c of Object.values(data.credits ?? {})) saveDoc({ kind: 'credits', id: c.id }, c);
}
