/**
 * Small CLI for agents and humans.
 *   npm run fm -- tree                         outline of the project
 *   npm run fm -- show ep01_sc02 [sh01]        print a scene or shot as JSON
 *   npm run fm -- add-shot ep01_sc02 "Name" [--duration 4] [--after sh01] [--vo "line"] [--visual "..."]
 *   npm run fm -- set ep01_sc02 sh01 status done      (any top-level shot field; JSON values allowed)
 *   npm run fm -- cue cue_ep01 seed 42                (set a score cue field)
 */
import { Shot } from '../src/model/schema';
import { estimateSpeech, fmtDuration, sceneDuration, uid } from '../src/model/timeline';
import { loadProject, saveDoc } from '../server/projectFs';
import { autoPoses } from './lib/poses';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest.splice(i, 2)[1] : undefined;
};
const parse = (v: string) => {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const { data } = loadProject();
const scene = (id: string) => {
  const sc = data.scenes[id];
  if (!sc) throw new Error(`unknown scene ${id} (try: npm run fm -- tree)`);
  return sc;
};
const save = (id: string) => saveDoc({ kind: 'scene', id, episodeId: data.scenes[id].episodeId }, data.scenes[id]);

switch (cmd) {
  case 'tree': {
    for (const epId of data.project.episodes) {
      const ep = data.episodes[epId];
      console.log(`${ep.id}  ${ep.title}  [${ep.status}]`);
      for (const scId of ep.scenes) {
        const sc = data.scenes[scId];
        console.log(`  ${sc.id}  ${sc.title}  (${fmtDuration(sceneDuration(sc))}, env ${sc.environmentId ?? '-'})`);
        for (const sh of sc.shots) console.log(`    ${sh.id}  ${sh.duration}s  [${sh.status}]  ${sh.name}`);
      }
    }
    break;
  }
  case 'show': {
    const sc = scene(rest[0]);
    console.log(JSON.stringify(rest[1] ? sc.shots.find((s) => s.id === rest[1]) : sc, null, 2));
    break;
  }
  case 'add-shot': {
    const duration = Number(flag('duration') ?? 4);
    const after = flag('after');
    const vo = flag('vo');
    const visual = flag('visual');
    const [scId, name = 'New shot'] = rest;
    const sc = scene(scId);
    let n = 1;
    while (sc.shots.some((s) => s.id === `sh${String(n).padStart(2, '0')}`)) n++;
    const id = `sh${String(n).padStart(2, '0')}`;
    const shot = Shot.parse({
      id, name, duration, description: visual ?? '',
      tracks: { dialog: vo ? [{ id: uid('dlg'), start: 0.5, duration: estimateSpeech(vo), characterId: 'narrator', text: vo }] : [] },
    });
    const i = after ? sc.shots.findIndex((s) => s.id === after) + 1 : sc.shots.length;
    sc.shots.splice(i, 0, shot);
    save(scId);
    console.log(`added ${scId}/${id}`);
    break;
  }
  case 'set': {
    const [scId, shId, field, value] = rest;
    const sh = scene(scId).shots.find((s) => s.id === shId);
    if (!sh) throw new Error(`unknown shot ${shId}`);
    (sh as Record<string, unknown>)[field] = parse(value);
    save(scId);
    console.log(`${scId}/${shId}.${field} = ${JSON.stringify(parse(value))}`);
    break;
  }
  case 'auto-poses': {
    // fill body poses from dialog + story beats, for shots that don't have any yet (--force: all)
    const force = rest.includes('--force');
    for (const [id, sc] of Object.entries(data.scenes)) {
      let n = 0;
      for (const sh of sc.shots)
        if (force || !sh.poses) {
          sh.poses = autoPoses(sh);
          if (sh.poses) n++;
        }
      if (n) {
        save(id);
        console.log(`${id}: posed ${n} shot(s)`);
      }
    }
    break;
  }
  case 'cue': {
    const [id, field, value] = rest;
    const cue = data.cues[id];
    if (!cue) throw new Error(`unknown cue ${id}`);
    (cue as Record<string, unknown>)[field] = parse(value);
    saveDoc({ kind: 'cue', id }, cue);
    console.log(`${id}.${field} = ${value}`);
    break;
  }
  default:
    console.log('commands: tree | show <scene> [shot] | add-shot <scene> <name> [--duration s] [--after shotId] [--vo text] [--visual text] | set <scene> <shot> <field> <value> | cue <cue> <field> <value>');
}
