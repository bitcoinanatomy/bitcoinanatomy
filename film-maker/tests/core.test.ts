import { describe, expect, it } from 'vitest';
import { encodeWav, wavDuration } from '../src/audio/wav';
import { buildBundle } from '../src/export/bundle';
import { ScoreCue } from '../src/model/schema';
import { expressionAt, bodyPoseAt, poseAt, resolveTimeline, sampleCamera, sceneDuration } from '../src/model/timeline';
import { compose } from '../src/score/compose';
import { cueToMidi } from '../src/score/midi';
import { renderCue } from '../src/score/render';
import { compositionFromMidi } from '../src/score/source';
import { creditVars, fillCredit } from '../src/model/credits';
import { loadProject } from '../server/projectFs';
import { ttsHash } from '../server/tts';

const cue = ScoreCue.parse({ id: 't', name: 't', seed: 42, bars: 8 });

describe('score', () => {
  it('is deterministic for a seed', () => {
    expect(compose(cue)).toEqual(compose({ ...cue }));
    const a = renderCue(cue, 8000);
    const b = renderCue(cue, 8000);
    expect(Buffer.from(a.left.buffer).equals(Buffer.from(b.left.buffer))).toBe(true);
  });
  it('changes with the seed', () => {
    expect(compose({ ...cue, seed: 43 }).notes).not.toEqual(compose(cue).notes);
  });
  it('applies overrides', () => {
    const muted = compose({ ...cue, overrides: [{ op: 'mute', instrument: 'pad', value: 0 }] });
    expect(muted.notes.some((n) => n.instrument === 'pad')).toBe(false);
  });
  it('round-trips through MIDI', () => {
    const notes = compose(cue).notes;
    const back = compositionFromMidi(cueToMidi(cue), cue).notes;
    expect(back.length).toBe(notes.length);
    expect(back[0].midi).toBe(notes[0].midi);
    expect(back[0].instrument).toBe(notes[0].instrument);
  });
});

describe('wav', () => {
  it('encodes and measures duration', () => {
    const wav = encodeWav([new Float32Array(22050)], 22050);
    expect(wavDuration(wav)).toBeCloseTo(1, 5);
  });
});

describe('timeline + export on the test project', () => {
  const { data, issues } = loadProject();
  it('loads cleanly', () => expect(issues).toEqual([]));
  it('lays shots end to end', () => {
    const tl = resolveTimeline(data, { kind: 'episode', episodeId: 'ep01' });
    const total = data.episodes.ep01.scenes.reduce((s, id) => s + sceneDuration(data.scenes[id]), 0);
    const intro = data.credits.intro.duration;
    const outro = data.credits.outro.duration;
    expect(tl.duration).toBeCloseTo(intro + total + outro);
    expect(tl.shots[0].start).toBeCloseTo(intro);
    tl.shots.slice(1).forEach((s, i) => expect(s.start).toBeCloseTo(tl.shots[i].end));
  });
  it('wraps episodes in the global credits, with music, and honours per-episode opt-out', () => {
    const tl = resolveTimeline(data, { kind: 'episode', episodeId: 'ep01' });
    expect(tl.credits.map((c) => c.kind)).toEqual(['intro', 'outro']);
    expect(tl.credits[1].end).toBeCloseTo(tl.duration);
    expect(tl.clips.filter((c) => c.credits).map((c) => (c.clip as { cueId: string }).cueId)).toEqual(['cue_intro', 'cue_outro']);
    const off = structuredClone(data);
    off.episodes.ep01.credits.intro = false;
    const tl2 = resolveTimeline(off, { kind: 'episode', episodeId: 'ep01' });
    expect(tl2.credits.map((c) => c.kind)).toEqual(['outro']);
    expect(tl2.shots[0].start).toBe(0);
    // scene scope never shows credits
    expect(resolveTimeline(data, { kind: 'scene', episodeId: 'ep01', sceneId: data.episodes.ep01.scenes[0] }).credits).toEqual([]);
  });
  it('fills credit placeholders per episode', () => {
    const v = creditVars(data, 'ep02');
    expect(fillCredit('Episode {episode.number}: {episode.title}', v)).toBe(`Episode 2: ${data.episodes.ep02.title}`);
  });
  it('windows a scene and keeps episode score clipped in', () => {
    const scId = data.episodes.ep01.scenes[1];
    const tl = resolveTimeline(data, { kind: 'scene', episodeId: 'ep01', sceneId: scId });
    expect(tl.duration).toBeCloseTo(sceneDuration(data.scenes[scId]));
    const score = tl.clips.find((c) => c.track === 'score')!;
    expect(score.owner.kind).toBe('episode');
    expect(score.start).toBeLessThan(0);
    expect(tl.shots[0].start).toBe(0);
  });
  it('uses scene-level score cues in episode 2', () => {
    const tl = resolveTimeline(data, { kind: 'episode', episodeId: 'ep02' });
    const scores = tl.clips.filter((c) => c.track === 'score' && !c.credits);
    expect(scores.length).toBe(data.episodes.ep02.scenes.length);
    expect(scores.every((c) => c.owner.kind === 'scene')).toBe(true);
  });
  it('interpolates cameras', () => {
    const cam = data.scenes.ep02_sc01.shots[0].tracks.camera[0];
    const mid = sampleCamera(cam, cam.duration / 2);
    expect(mid.position[2]).toBeLessThan(cam.keys[0].position[2]);
    expect(mid.position[2]).toBeGreaterThan(cam.keys[1].position[2]);
  });
  it('builds a frame-accurate Blender bundle', () => {
    const b = buildBundle(data, 'ep01');
    expect(b.scenes.length).toBe(data.episodes.ep01.scenes.length);
    expect(b.scenes[0].frame_start).toBe(Math.round(data.credits.intro.duration * data.project.fps) + 1);
    expect(b.credits.map((c) => c.kind)).toEqual(['intro', 'outro']);
    expect(b.credits[0].cards.find((c) => c.lines[0].text.startsWith('Episode'))?.lines[1].text).toBe(data.episodes.ep01.title);
    for (let i = 1; i < b.scenes.length; i++) expect(b.scenes[i].frame_start).toBe(b.scenes[i - 1].frame_end + 1);
    expect(b.cues).toEqual(['cue_ep01', 'cue_intro', 'cue_outro']);
    expect(b.strips.dialog.every((d) => d.file)).toBe(true);
  });
  it('carries per-shot blocking into the bundle', () => {
    const b = buildBundle(data, 'ep01');
    const i = data.scenes.ep01_sc03.shots.findIndex((s) => s.positions?.bit?.moves?.length);
    const shot = data.scenes.ep01_sc03.shots[i];
    const bs = b.scenes.find((s) => s.id === 'ep01_sc03')!.shots[i];
    const bit = bs.characters.find((c) => c.id === 'bit')!;
    expect(bit.position).toEqual(shot.positions!.bit.position);
    expect(bit.rotationY).toBe(shot.positions!.bit.rotationY);
    // moves become absolute frames inside the shot
    expect(bit.moves.length).toBe(shot.positions!.bit.moves!.length);
    expect(bit.moves[0].frame).toBeGreaterThan(bs.frame_start);
    expect(bit.moves[0].frame).toBeLessThanOrEqual(bs.frame_end + 1);
  });
});

describe('blocking + expressions', () => {
  const b = { position: [0, 0, 0] as [number, number, number], rotationY: 170, moves: [{ t: 2, position: [4, 0, 0] as [number, number, number], rotationY: -170 }] };
  it('eases from the mark through each move, then holds', () => {
    expect(poseAt(b, 0).position).toEqual([0, 0, 0]);
    expect(poseAt(b, 1).position[0]).toBeCloseTo(2);
    expect(poseAt(b, 1).moving).toBe(true);
    expect(poseAt(b, 5)).toEqual({ position: [4, 0, 0], rotationY: -170, moving: false, speed: 0, travelled: 4 });
    expect(poseAt(b, 1).speed).toBeCloseTo(3); // peak of the eased walk: 1.5 × 4m / 2s
  });
  it('faces the direction of travel on a move without its own rotationY', () => {
    const w = { position: [0, 0, 0] as [number, number, number], rotationY: 0, moves: [{ t: 2, position: [4, 0, 0] as [number, number, number] }] };
    expect(poseAt(w, 1).rotationY).toBeCloseTo(90);
    expect(poseAt(w, 3).rotationY).toBe(0);
  });
  it('blends body poses from the previous key', () => {
    const keys = [{ t: 1, pose: 'wave' as const }, { t: 3, pose: 'cheer' as const }];
    expect(bodyPoseAt(keys, 0.5)).toEqual({ pose: 'idle', prev: 'idle', since: 0.5 });
    expect(bodyPoseAt(keys, 3.5)).toEqual({ pose: 'cheer', prev: 'wave', since: 0.5 });
  });
  it('turns the short way round', () => {
    expect(poseAt(b, 1).rotationY).toBeCloseTo(180);
  });
  it('holds the latest expression', () => {
    const keys = [{ t: 1, expression: 'happy' as const }, { t: 3, expression: 'sad' as const }];
    expect(expressionAt(keys, 0.5).expression).toBe('neutral');
    expect(expressionAt(keys, 2)).toEqual({ expression: 'happy', since: 1 });
    expect(expressionAt(keys, 9).expression).toBe('sad');
  });
});

describe('tts', () => {
  it('includes voice tuning in the cache hash', () => {
    const base = { text: 'Hello', voice: 'en_US-lessac-medium' };
    expect(ttsHash(base)).toBe(ttsHash({ ...base, tune: { pitch: 0, speed: 1 } }));
    expect(ttsHash(base)).not.toBe(ttsHash({ ...base, tune: { pitch: 3, speed: 1 } }));
    expect(ttsHash(base)).not.toBe(ttsHash({ ...base, tune: { pitch: 0, speed: 1.2 } }));
  });
});
