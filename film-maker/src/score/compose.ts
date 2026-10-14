/**
 * Deterministic composer: ScoreCue (seed + a few musical parameters) → note list.
 * Same cue in, same notes out — on any machine, in the browser or in Node.
 * Tweak a cue by changing its parameters or adding `overrides`; or export it to
 * MIDI, edit it in LMMS / MuseScore / Ardour and set it as the cue's `replacement`.
 */
import type { Instrument, ScoreCue } from '../model/schema';
import { INSTRUMENTS } from '../model/schema';

export interface Note {
  instrument: Instrument;
  time: number; // seconds from cue start
  dur: number; // seconds
  midi: number;
  vel: number; // 0..1
  bar: number;
}

export interface Composition {
  notes: Note[];
  duration: number;
  secondsPerBeat: number;
  chords: { bar: number; degree: number; midi: number[] }[];
}

/** mulberry32 — tiny, fast, good enough, and identical everywhere */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MODES: Record<ScoreCue['mode'], number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
// scale-degree progressions (0-based), 4 chords each
const PROGRESSIONS = [
  [0, 5, 3, 4],
  [0, 3, 5, 4],
  [0, 5, 2, 6],
  [0, 6, 5, 6],
  [0, 3, 0, 4],
  [5, 3, 0, 4],
  [0, 2, 3, 3],
  [0, 4, 5, 3],
];
const BASS_PATTERNS = [
  [[0, 1]], // whole bar
  [[0, 0.5], [0.5, 0.5]],
  [[0, 0.375], [0.375, 0.125], [0.5, 0.5]],
  [[0, 0.25], [0.5, 0.25], [0.75, 0.25]],
];

export function cueDuration(cue: ScoreCue) {
  return (cue.bars * cue.beatsPerBar * 60) / cue.tempo;
}

export function compose(cue: ScoreCue): Composition {
  const rnd = mulberry32(cue.seed);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const spb = 60 / cue.tempo;
  const barLen = spb * cue.beatsPerBar;
  const scale = MODES[cue.mode];
  const root = 48 + KEYS.indexOf(cue.key); // C3-based
  const deg = (d: number, octave = 0) => {
    const o = Math.floor(d / 7);
    const i = ((d % 7) + 7) % 7;
    return root + scale[i] + 12 * (o + octave);
  };

  // structural choices — each drawn in a fixed order so seeds stay stable
  const prog = pick(PROGRESSIONS);
  const chordBars = cue.tempo < 70 ? 2 : 1;
  const bassPattern = pick(BASS_PATTERNS);
  const arpRate = pick([2, 3, 4]); // notes per beat
  const arpShape = pick(['up', 'down', 'updown', 'random'] as const);
  const motif = Array.from({ length: 4 + Math.floor(rnd() * 3) }, () => ({
    step: Math.floor(rnd() * 5) - 1,
    len: pick([0.5, 0.5, 1, 1, 1.5, 2]),
  }));

  // a second stream for feel (fills, walk-ups, humanizing) so the picks above stay stable per seed
  const feel = mulberry32(cue.seed ^ 0x5bd1e995);
  const backbeat = cue.density >= 0.6;
  const percEntry = Math.floor((cue.instruments.perc?.enter ?? 0) * cue.bars);

  const notes: Note[] = [];
  const chords: Composition['chords'] = [];
  const entered = (inst: Instrument, bar: number) => {
    const cfg = cue.instruments[inst];
    return !!cfg && cfg.on && bar >= Math.floor(cfg.enter * cue.bars);
  };

  for (let bar = 0; bar < cue.bars; bar++) {
    const t0 = bar * barLen;
    const d = prog[Math.floor(bar / chordBars) % prog.length];
    const chord = [deg(d, 1), deg(d + 2, 1), deg(d + 4, 1)];
    chords.push({ bar, degree: d, midi: chord });
    const last = bar === cue.bars - 1;

    if (entered('pad', bar)) {
      for (const m of chord) notes.push({ instrument: 'pad', time: t0, dur: barLen * 1.02, midi: m, vel: 0.55, bar });
      if (rnd() < 0.5) notes.push({ instrument: 'pad', time: t0, dur: barLen, midi: deg(d + 6, 1), vel: 0.3, bar });
    } else rnd();

    if (entered('bass', bar)) {
      // walk up into the next chord on the last eighth when the music is busy enough
      const nextD = prog[Math.floor((bar + 1) / chordBars) % prog.length];
      const walk = !last && cue.density >= 0.5 && nextD !== d && (bar + 1) % chordBars === 0;
      const end = walk ? 0.875 : 1;
      for (const [p, l] of bassPattern) {
        if (p >= end) continue;
        const len = Math.min(l, end - p);
        notes.push({ instrument: 'bass', time: t0 + p * barLen, dur: len * barLen * 0.95, midi: deg(d, -1), vel: p === 0 ? 0.9 : 0.7, bar });
      }
      if (walk) {
        const approach = feel() < 0.5 ? deg(nextD - 1, -1) : deg(nextD + 1, -1);
        notes.push({ instrument: 'bass', time: t0 + 0.875 * barLen, dur: 0.125 * barLen * 0.9, midi: approach, vel: 0.75, bar });
      }
    }

    // arp: always consume the same amount of randomness per bar
    const steps = arpRate * cue.beatsPerBar;
    const tones = [chord[0], chord[1], chord[2], chord[0] + 12];
    for (let i = 0; i < steps; i++) {
      const r = rnd();
      const r2 = rnd();
      if (!entered('arp', bar) || last) continue;
      if (r > 0.35 + cue.density * 0.65) continue;
      let idx = i % tones.length;
      if (arpShape === 'down') idx = tones.length - 1 - idx;
      if (arpShape === 'updown') idx = Math.floor(i / tones.length) % 2 ? tones.length - 1 - idx : idx;
      if (arpShape === 'random') idx = Math.floor(r2 * tones.length);
      notes.push({ instrument: 'arp', time: t0 + (i * spb) / arpRate, dur: (spb / arpRate) * 0.9, midi: tones[idx] + 12, vel: 0.42 + r2 * 0.22 + (i % arpRate === 0 ? 0.14 : 0), bar });
    }

    // lead: the motif, re-rooted on the chord, played on alternating bars (density-gated)
    const playLead = rnd() < 0.4 + cue.density * 0.5;
    if (entered('lead', bar) && playLead && !last) {
      let beat = 0;
      for (const n of motif) {
        if (beat >= cue.beatsPerBar) break;
        const len = Math.min(n.len, cue.beatsPerBar - beat);
        notes.push({ instrument: 'lead', time: t0 + beat * spb, dur: len * spb * 0.92, midi: deg(d + 2 + n.step, 2), vel: 0.6, bar });
        beat += n.len;
      }
    } else if (entered('lead', bar) && last) {
      // land on the chord's third and hold it
      notes.push({ instrument: 'lead', time: t0, dur: barLen * 0.95, midi: chord[1] + 12, vel: 0.55, bar });
    }

    // perc: kick on downbeats, soft ticks on off-beats; busy cues add a backbeat, fills and crashes
    // (GM drums: 36 kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, 49 crash)
    const percOn = entered('perc', bar);
    const fill = backbeat && percOn && !last && (bar % 4 === 3 || bar === cue.bars - 2);
    const fillFrom = cue.beatsPerBar - 1; // the fill takes the last beat
    const hit = (time: number, midi: number, vel: number, dur = 0.1) => notes.push({ instrument: 'perc', time, dur, midi, vel, bar });
    for (let b = 0; b < cue.beatsPerBar * 2; b++) {
      const r = rnd();
      if (!percOn || last) continue;
      const t = t0 + (b * spb) / 2;
      if (fill && b / 2 >= fillFrom) continue;
      if (b % 4 === 0) hit(t, 36, 0.9, 0.3);
      else if (r < 0.3 + cue.density * 0.6) hit(t, 42, 0.25 + r * 0.3, 0.05);
      if (backbeat && b % 4 === 2) {
        hit(t, 38, 0.7);
        hit(t, 39, 0.45);
      }
      if (backbeat && b === cue.beatsPerBar * 2 - 1 && !fill && feel() < 0.4) hit(t, 46, 0.35);
    }
    if (backbeat && percOn && !last && (bar === percEntry || (bar > percEntry && bar % 4 === 0))) hit(t0, 49, 0.6, 1.5);
    if (fill) {
      const tf = t0 + fillFrom * spb;
      if (feel() < 0.6) for (let k = 0; k < 4; k++) hit(tf + (k * spb) / 4, 38, 0.35 + k * 0.15); // snare roll
      else {
        hit(tf, 38, 0.6);
        hit(tf + spb * 0.5, 38, 0.55);
        hit(tf + spb * 0.75, 38, 0.8);
        hit(tf + spb * 0.75, 36, 0.8, 0.3);
      }
    }
    if (last && percOn && cue.instruments.perc?.on) {
      // button ending
      hit(t0, 36, 1, 0.3);
      if (backbeat) hit(t0, 49, 0.75, 2);
    }
  }

  // humanize: a few ms of push/pull and some velocity variation (kicks stay on the grid)
  for (const n of notes) {
    const j = feel() * 2 - 1;
    const v = feel() * 2 - 1;
    if (n.instrument === 'pad' || (n.instrument === 'perc' && (n.midi === 36 || n.midi === 49))) continue;
    n.time = Math.max(0, n.time + j * (n.instrument === 'bass' ? 0.004 : 0.009));
    n.vel = Math.max(0.05, Math.min(1, n.vel * (1 + 0.12 * v)));
  }

  // overrides
  let out = notes;
  for (const ov of cue.overrides) {
    const match = (n: Note) =>
      (!ov.instrument || ov.instrument === n.instrument) && (!ov.bars || (n.bar >= ov.bars[0] && n.bar <= ov.bars[1]));
    if (ov.op === 'mute') out = out.filter((n) => !match(n));
    else if (ov.op === 'transpose') out = out.map((n) => (match(n) ? { ...n, midi: n.midi + ov.value } : n));
    else if (ov.op === 'gain') out = out.map((n) => (match(n) ? { ...n, vel: Math.max(0, Math.min(1, n.vel * ov.value)) } : n));
  }

  out.sort((a, b) => a.time - b.time || INSTRUMENTS.indexOf(a.instrument) - INSTRUMENTS.indexOf(b.instrument));
  return { notes: out, duration: cue.bars * barLen, secondsPerBeat: spb, chords };
}

export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const midiName = (m: number) => `${KEYS[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
