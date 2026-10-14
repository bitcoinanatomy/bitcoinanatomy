/**
 * Validates project/: schemas, cross references, media files, dialog audio freshness.
 *   npm run validate        (exit code 1 when there are errors)
 */
import fs from 'node:fs';
import type { AnyClip, DialogClip } from '../src/model/schema';
import { TRACK_KINDS } from '../src/model/schema';
import { loadProject, mediaPath } from '../server/projectFs';
import { ttsHash } from '../server/tts';
import { ttsRequestFor } from '../src/model/tts';

const { data, issues } = loadProject();
const errors: string[] = issues.map((i) => `${i.file}: ${i.message}`);
const warnings: string[] = [];
const exists = (p?: string) => {
  if (!p) return true;
  try {
    return fs.existsSync(mediaPath(p));
  } catch {
    return false;
  }
};

for (const id of data.project.episodes) if (!data.episodes[id]) errors.push(`project.json lists missing episode ${id}`);
for (const ep of Object.values(data.episodes)) {
  if (!data.project.episodes.includes(ep.id)) warnings.push(`episode ${ep.id} is not listed in project.json episodes`);
  for (const sc of ep.scenes) if (!data.scenes[sc]) errors.push(`episode ${ep.id} lists missing scene ${sc}`);
}
for (const sc of Object.values(data.scenes)) {
  if (!data.episodes[sc.episodeId]?.scenes.includes(sc.id)) warnings.push(`scene ${sc.id} is not listed in its episode`);
  if (sc.environmentId && !data.environments[sc.environmentId]) errors.push(`${sc.id}: unknown environment ${sc.environmentId}`);
  const ids = new Set<string>();
  for (const sh of sc.shots) {
    const where = `${sc.id}/${sh.id}`;
    if (ids.has(sh.id)) errors.push(`${where}: duplicate shot id`);
    ids.add(sh.id);
    if (sh.environmentId && !data.environments[sh.environmentId]) errors.push(`${where}: unknown environment ${sh.environmentId}`);
    for (const c of sh.characters) if (!data.characters[c]) errors.push(`${where}: unknown character ${c}`);
    for (const a of sh.assets) if (!data.assets[a]) errors.push(`${where}: unknown asset ${a}`);
    for (const k of TRACK_KINDS) {
      for (const clip of sh.tracks[k] as AnyClip[]) {
        if (clip.start > sh.duration) warnings.push(`${where}: ${k} clip ${clip.id} starts after the shot ends`);
      }
    }
    for (const d of sh.tracks.dialog as DialogClip[]) {
      if (!data.characters[d.characterId]) errors.push(`${where}: dialog ${d.id} unknown character ${d.characterId}`);
      if (!d.audio) warnings.push(`${where}: dialog ${d.id} has no audio (npm run tts)`);
      else if (!exists(d.audio)) errors.push(`${where}: missing audio file ${d.audio}`);
      else {
        if (d.audioHash && d.audioHash !== ttsHash(ttsRequestFor(data, d)))
          warnings.push(`${where}: dialog ${d.id} audio is stale (text or voice changed) — npm run tts`);
      }
    }
    for (const b of sh.tracks.storyboard) if (b.image && !exists(b.image)) errors.push(`${where}: missing board ${b.image}`);
    for (const s of sh.tracks.sfx) if (!exists(s.file)) errors.push(`${where}: missing sfx ${s.file}`);
  }
}
const allTracks = [...Object.values(data.episodes), ...Object.values(data.scenes), ...Object.values(data.scenes).flatMap((s) => s.shots)].map((x) => x.tracks);
for (const t of allTracks) for (const s of t.score) if (!data.cues[s.cueId]) errors.push(`score clip ${s.id}: unknown cue ${s.cueId}`);
for (const lib of [data.characters, data.assets, data.environments])
  for (const d of Object.values(lib)) if (d.mesh && !exists(d.mesh)) errors.push(`${d.id}: missing mesh ${d.mesh}`);
for (const e of Object.values(data.environments))
  for (const p of e.props) if (!data.assets[p.assetId]) errors.push(`environment ${e.id}: unknown asset ${p.assetId}`);
for (const c of Object.values(data.credits)) {
  if (c.music.cueId && !data.cues[c.music.cueId]) errors.push(`credits ${c.id}: unknown cue ${c.music.cueId}`);
  for (const card of c.cards) if (card.start + card.duration > c.duration + 1e-6) warnings.push(`credits ${c.id}: card ${card.id} runs past the end`);
}
for (const c of Object.values(data.cues)) if (c.replacement && !exists(c.replacement)) errors.push(`cue ${c.id}: missing replacement ${c.replacement}`);

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
const shots = Object.values(data.scenes).reduce((n, s) => n + s.shots.length, 0);
console.log(`\n${Object.keys(data.episodes).length} episodes, ${Object.keys(data.scenes).length} scenes, ${shots} shots — ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
