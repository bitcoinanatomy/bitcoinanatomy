/**
 * Writes export/<episode>/: bundle.json + media/ (copied project media, rendered score WAVs,
 * GIF boards converted to MP4 for Blender) + a copy of the Blender import script.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { encodeWav } from '../src/audio/wav';
import { buildBundle } from '../src/export/bundle';
import type { ProjectData } from '../src/model/schema';
import { renderComposition } from '../src/score/render';
import { compositionFor } from '../src/score/source';
import { cueToMidi } from '../src/score/midi';
import { mediaPath, ROOT } from './projectFs';

const hasFfmpeg = () => spawnSync('ffmpeg', ['-version']).status === 0;

export function exportEpisode(data: ProjectData, episodeId: string, outRoot = path.join(ROOT, 'export')) {
  const bundle = buildBundle(data, episodeId);
  const out = path.join(outRoot, episodeId);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'media'), { recursive: true });
  const warnings: string[] = [];
  const ffmpeg = hasFfmpeg();
  const renamed = new Map<string, string>();

  for (const rel of bundle.media) {
    let src: string;
    try {
      src = mediaPath(rel);
    } catch (e) {
      warnings.push(String(e));
      continue;
    }
    if (!fs.existsSync(src)) {
      warnings.push(`missing media: ${rel}`);
      continue;
    }
    const dst = path.join(out, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (rel.toLowerCase().endsWith('.gif')) {
      // Blender can't read GIFs: convert to an MP4 movie strip
      const mp4 = rel.replace(/\.gif$/i, '.mp4');
      if (ffmpeg) {
        const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', path.join(out, mp4)]);
        if (r.status === 0) {
          renamed.set(rel, mp4);
          continue;
        }
        warnings.push(`ffmpeg failed on ${rel}`);
      } else warnings.push(`ffmpeg not found; ${rel} copied as GIF (Blender cannot read it)`);
    }
    fs.copyFileSync(src, dst);
  }
  for (const s of bundle.strips.storyboard) s.file = renamed.get(s.file) ?? s.file;

  for (const id of bundle.cues) {
    const cue = data.cues[id];
    if (!cue) {
      warnings.push(`missing score cue ${id}`);
      continue;
    }
    const dst = path.join(out, 'media/audio/score', `${id}.wav`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (cue.replacement?.toLowerCase().endsWith('.wav')) fs.copyFileSync(mediaPath(cue.replacement), dst);
    else {
      const midi = cue.replacement?.toLowerCase().endsWith('.mid') ? new Uint8Array(fs.readFileSync(mediaPath(cue.replacement))) : undefined;
      const pcm = renderComposition(compositionFor(cue, midi), cue);
      fs.writeFileSync(dst, encodeWav([pcm.left, pcm.right], pcm.sampleRate));
    }
    if (!cue.replacement) fs.writeFileSync(path.join(out, 'media/audio/score', `${id}.mid`), cueToMidi(cue));
  }

  const { media: _m, cues: _c, ...clean } = bundle;
  fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify(clean, null, 2));
  fs.copyFileSync(path.join(ROOT, 'blender/import_project.py'), path.join(out, 'import_project.py'));
  return { dir: out, bundle: clean, warnings };
}
