/** Export a cue to a Standard MIDI File — one track per instrument (GM programs). */
import tonejsMidi from '@tonejs/midi';
import type { ScoreCue } from '../model/schema';
import { INSTRUMENTS } from '../model/schema';
import { compose } from './compose';

// @tonejs/midi is CommonJS: use the default export so Node ESM and Vite agree
const { Midi } = tonejsMidi;

const PROGRAM: Record<string, number> = { pad: 89, bass: 33, arp: 46, lead: 73, perc: 0 };

export function cueToMidi(cue: ScoreCue): Uint8Array {
  const comp = compose(cue);
  const midi = new Midi();
  midi.header.setTempo(cue.tempo);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [cue.beatsPerBar, 4] });
  midi.header.name = cue.name;
  for (const inst of INSTRUMENTS) {
    const notes = comp.notes.filter((n) => n.instrument === inst);
    if (!notes.length) continue;
    const track = midi.addTrack();
    track.name = inst;
    if (inst === 'perc') track.channel = 9;
    else track.instrument.number = PROGRAM[inst];
    for (const n of notes) track.addNote({ midi: n.midi, time: n.time, duration: n.dur, velocity: n.vel });
  }
  return midi.toArray();
}
