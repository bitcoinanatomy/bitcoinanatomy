/** Where a cue's music comes from: generated (seed) or an edited MIDI replacement. */
import tonejsMidi from '@tonejs/midi';
import type { Instrument, ScoreCue } from '../model/schema';
import { INSTRUMENTS } from '../model/schema';
import { compose, type Composition, type Note } from './compose';

// @tonejs/midi is CommonJS: use the default export so Node ESM and Vite agree
const { Midi } = tonejsMidi;

/** Turn an edited MIDI file back into a Composition. Track names map to instruments. */
export function compositionFromMidi(bytes: Uint8Array, cue: ScoreCue): Composition {
  const midi = new Midi(bytes);
  const notes: Note[] = [];
  const spb = 60 / (midi.header.tempos[0]?.bpm ?? cue.tempo);
  const barLen = spb * cue.beatsPerBar;
  for (const tr of midi.tracks) {
    const name = tr.name.toLowerCase();
    const inst: Instrument =
      (INSTRUMENTS as readonly string[]).includes(name) ? (name as Instrument) : tr.channel === 9 ? 'perc' : 'lead';
    for (const n of tr.notes) notes.push({ instrument: inst, time: n.time, dur: n.duration, midi: n.midi, vel: n.velocity, bar: Math.floor(n.time / barLen) });
  }
  notes.sort((a, b) => a.time - b.time);
  const duration = Math.max(midi.duration, ...notes.map((n) => n.time + n.dur), 0);
  return { notes, duration, secondsPerBeat: spb, chords: [] };
}

export function compositionFor(cue: ScoreCue, midiBytes?: Uint8Array): Composition {
  if (midiBytes && cue.replacement?.toLowerCase().endsWith('.mid')) return compositionFromMidi(midiBytes, cue);
  return compose(cue);
}
