/**
 * Body acting for the story: picks poses from each line of dialog (greetings wave, "look"
 * points, questions think, triumphs cheer) plus a few story beats, then returns to idle.
 * Used by `npm run seed` and `npm run fm -- auto-poses` (which only fills shots without poses).
 */
import type { Pose, PoseKey, Shot } from '../../src/model/schema';

const LINE_RULES: [RegExp, Pose][] = [
  [/\b(we did it|handshake done|hooray|woo+|same direction|in the block)\b|^yes\b/i, 'cheer'],
  [/\b(hello|hi|hey)\b/i, 'wave'],
  [/\b(look|there!|this way|down there|over there)\b/i, 'point'],
  [/\b(don'?t know|not sure|who knows|why am i)\b/i, 'shrug'],
  [/^(hmm|so\b)|\b(how many|why|wonder|what was that|we need)\b/i, 'think'],
  [/\b(heavy stuff|heavy!)\b/i, 'lift'],
  [/\b(dead end|too heavy)\b/i, 'reach'],
  [/\bpassing it on\b|\btake its hello\b/i, 'point'],
  [/\bjust being supportive\b/i, 'arms_crossed'],
];

/** whole-shot beats keyed by shot name: [character, pose, from (fraction of the shot)] */
const BEATS: Record<string, [string, Pose, number][]> = {
  'Enter Bit': [['bit', 'lift', 0]],
  'Show off': [['bit', 'lift', 0], ['mili', 'arms_crossed', 0.2]],
  'Supportive': [['bit', 'arms_crossed', 0.1]],
  'Heavy!': [['bit', 'lift', 0]],
  'Heavy lifting': [['bit', 'lift', 0]],
  'Dead end': [['mili', 'reach', 0]],
  'Too heavy': [['sati', 'reach', 0.05], ['mili', 'crouch', 0.3]],
  'Penny drops': [['sati', 'think', 0.1], ['mili', 'think', 0.4]],
  'Sati listens': [['sati', 'think', 0.15]],
  'Jaws drop': [['mili', 'crouch', 0.15], ['sati', 'shrug', 0.3]],
  'Whoa': [['mili', 'shrug', 0.2]],
  'The whole city saw': [['folk1', 'cheer', 0.3], ['folk3', 'wave', 0.4], ['folk5', 'cheer', 0.5]],
  'Bonk': [['mili', 'crouch', 0]],
  'Sealed': [['sati', 'cheer', 0.6], ['bit', 'cheer', 0.7]],
  'Same direction': [['sati', 'cheer', 0.75], ['bit', 'cheer', 0.8], ['mili', 'cheer', 0.7]],
  'The hall of blocks': [['bit', 'arms_crossed', 0.2]],
  'Into the dark': [['mili', 'crouch', 0.1]],
  'Almost': [['mili', 'reach', 0.15]],
  'The target': [['folk2', 'reach', 0.1], ['sati', 'point', 0.35]],
  'The joints hold': [['bit', 'reach', 0.05], ['sati', 'think', 0.2]],
  'Still reaching': [['mili', 'reach', 0.1]],
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function autoPoses(shot: Pick<Shot, 'name' | 'duration' | 'characters' | 'tracks'>): Record<string, PoseKey[]> | undefined {
  const out: Record<string, PoseKey[]> = {};
  const key = (id: string, t: number, pose: Pose) => (out[id] ??= []).push({ t: r3(Math.max(0, t)), pose });
  for (const [id, pose, f] of BEATS[shot.name] ?? []) if (shot.characters.includes(id)) key(id, f * shot.duration, pose);
  for (const d of shot.tracks.dialog) {
    const rule = LINE_RULES.find(([re]) => re.test(d.text));
    if (!rule || out[d.characterId]?.some((k) => k.t <= d.start && k.pose !== 'idle')) continue;
    key(d.characterId, d.start - 0.15, rule[1]);
    // settle back to idle shortly after the line (talk gestures take over while speaking)
    if (d.start + d.duration + 0.6 < shot.duration) key(d.characterId, d.start + d.duration + 0.4, 'idle');
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.t - b.t);
  return Object.keys(out).length ? out : undefined;
}
