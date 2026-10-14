/**
 * Generate dialog audio for every line that is missing or stale (cached by text+voice).
 *   npm run tts [-- ep01] [--force]
 */
import type { DialogClip, Tracks } from '../src/model/schema';
import { loadProject, saveDoc } from '../server/projectFs';
import { synthesize, ttsHash } from '../server/tts';
import { ttsRequestFor } from '../src/model/tts';

const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
const force = process.argv.includes('--force');
const { data } = loadProject();
let made = 0;
let fixed = 0;

async function voice(tracks: Tracks) {
  let changed = false;
  for (const d of tracks.dialog as DialogClip[]) {
    const req = ttsRequestFor(data, d);
    if (!force && d.audio && d.audioHash === ttsHash(req)) continue;
    const r = await synthesize(req);
    Object.assign(d, { audio: r.audio, audioHash: r.audioHash, duration: Math.round(r.duration * 1000) / 1000 });
    changed = true;
    made++;
    process.stdout.write(r.cached ? '·' : '+');
  }
  return changed;
}

for (const ep of Object.values(data.episodes)) {
  if (only && ep.id !== only) continue;
  if (await voice(ep.tracks)) saveDoc({ kind: 'episode', id: ep.id }, ep);
  for (const scId of ep.scenes) {
    const sc = data.scenes[scId];
    let changed = await voice(sc.tracks);
    for (const sh of sc.shots) {
      if (await voice(sh.tracks)) {
        changed = true;
        const end = Math.max(...sh.tracks.dialog.map((d) => d.start + d.duration + 0.4));
        if (end > sh.duration) {
          sh.duration = Math.ceil(end * 2) / 2;
          fixed++;
        }
      }
    }
    if (changed) saveDoc({ kind: 'scene', id: sc.id, episodeId: ep.id }, sc);
  }
}
console.log(`\n${made} lines voiced${fixed ? `, ${fixed} shots lengthened to fit` : ''}.`);
