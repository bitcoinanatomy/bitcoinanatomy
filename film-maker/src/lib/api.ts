import type { ProjectData } from '../model/schema';
import type { DocRef, LoadIssue } from '../../server/projectFs';
import type { TtsRequest, TtsResult } from '../../server/tts';

export type { DocRef, LoadIssue };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body instanceof Blob ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

export const api = {
  project: () => call<{ data: ProjectData; issues: LoadIssue[]; tts: { piper: boolean; voices: string[] } }>('GET', '/api/project'),
  save: (ref: DocRef, doc: unknown) => call<{ doc: unknown }>('PUT', '/api/doc', { ref, doc }),
  remove: (ref: DocRef) => call<{ ok: true }>('DELETE', '/api/doc', { ref }),
  tts: (req: TtsRequest) => call<TtsResult>('POST', '/api/tts', req),
  upload: (file: Blob, dir: string, name: string) =>
    call<{ path: string }>('POST', `/api/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`, file),
  media: (dir: string) => call<{ files: string[] }>('GET', `/api/media?dir=${encodeURIComponent(dir)}`),
  exportEpisode: (episodeId: string) => call<{ dir: string; warnings: string[]; frames: number }>('POST', '/api/export', { episodeId }),
};

/** URL for a project-relative media path */
export const mediaUrl = (rel?: string) => (rel ? (/^(https?:|data:|blob:)/.test(rel) ? rel : `/project/${rel}`) : undefined);

export function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
