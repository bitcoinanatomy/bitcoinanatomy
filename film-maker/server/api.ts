/**
 * Local file API, mounted as Vite middleware (one process: `npm run dev`).
 * The browser never touches disk directly; agents can edit project/*.json and the
 * UI reloads through the `fm:changed` websocket event.
 */
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { deleteDoc, loadProject, mediaPath, PROJECT_DIR, saveDoc, type DocRef } from './projectFs';
import { exportEpisode } from './exporter';
import { listPiperVoices, piperAvailable, synthesize } from './tts';

const body = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const send = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
};

export function filmMakerApi(): Plugin {
  return {
    name: 'film-maker-api',
    configureServer(server) {
      let pending = new Set<string>();
      let timer: NodeJS.Timeout | undefined;
      const onFs = (file: string) => {
        if (!file.startsWith(PROJECT_DIR) || !file.endsWith('.json')) return;
        pending.add(path.relative(PROJECT_DIR, file));
        clearTimeout(timer);
        timer = setTimeout(() => {
          server.ws.send({ type: 'custom', event: 'fm:changed', data: { files: [...pending] } });
          pending = new Set();
        }, 150);
      };
      server.watcher.add(PROJECT_DIR);
      server.watcher.on('change', onFs).on('add', onFs).on('unlink', onFs);

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (!url.pathname.startsWith('/api/')) return next();
        try {
          const route = `${req.method} ${url.pathname}`;
          if (route === 'GET /api/project') {
            const { data, issues } = loadProject();
            return send(res, 200, { data, issues, tts: { piper: piperAvailable(), voices: listPiperVoices() } });
          }
          if (route === 'PUT /api/doc') {
            const { ref, doc } = JSON.parse((await body(req)).toString()) as { ref: DocRef; doc: unknown };
            return send(res, 200, { doc: saveDoc(ref, doc) });
          }
          if (route === 'DELETE /api/doc') {
            const { ref } = JSON.parse((await body(req)).toString()) as { ref: DocRef };
            deleteDoc(ref);
            return send(res, 200, { ok: true });
          }
          if (route === 'POST /api/tts') {
            return send(res, 200, await synthesize(JSON.parse((await body(req)).toString())));
          }
          if (route === 'POST /api/upload') {
            const dir = url.searchParams.get('dir') ?? 'media/uploads';
            const name = (url.searchParams.get('name') ?? 'file').replace(/[^\w.-]+/g, '_');
            const rel = path.posix.join(dir, name);
            const abs = mediaPath(rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, await body(req));
            return send(res, 200, { path: rel });
          }
          if (route === 'GET /api/media') {
            const dir = mediaPath(url.searchParams.get('dir') ?? 'media');
            const walk = (d: string): string[] =>
              fs.existsSync(d)
                ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
                    e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(PROJECT_DIR, path.join(d, e.name))],
                  )
                : [];
            return send(res, 200, { files: walk(dir).sort() });
          }
          if (route === 'POST /api/export') {
            const { episodeId } = JSON.parse((await body(req)).toString());
            const { data } = loadProject();
            const r = exportEpisode(data, episodeId);
            return send(res, 200, { dir: r.dir, warnings: r.warnings, frames: r.bundle.frame_end });
          }
          send(res, 404, { error: `no route ${route}` });
        } catch (e) {
          send(res, 400, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
