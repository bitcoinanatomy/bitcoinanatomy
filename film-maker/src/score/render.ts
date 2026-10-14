/**
 * Small deterministic software synth: Composition → stereo PCM.
 * Pure TypeScript (no Web Audio), so the browser preview and the Node/Blender
 * export render byte-identical audio.
 *
 * Voices: detuned supersaw pad, plucky filtered bass, FM electric-piano arp,
 * two-saw filtered lead, synthesized drum kit. Bus: kick sidechain on the
 * melodic instruments, ping-pong delay, Freeverb-style reverb, soft clip.
 */
import type { Instrument, ScoreCue } from '../model/schema';
import { compose, midiToFreq, mulberry32, type Composition } from './compose';

export interface StereoPCM {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

const PAN: Record<Instrument, number> = { pad: 0, bass: 0, arp: 0.3, lead: -0.15, perc: 0 };
const RELEASE: Record<Instrument, number> = { pad: 1.4, bass: 0.12, arp: 0.6, lead: 0.35, perc: 0 };
const REVERB_SEND: Record<Instrument, number> = { pad: 0.4, bass: 0.02, arp: 0.3, lead: 0.35, perc: 0.1 };
const DELAY_SEND: Record<Instrument, number> = { pad: 0, bass: 0, arp: 0.22, lead: 0.28, perc: 0 };
/** how long each drum rings, by GM note */
const DRUM_LEN: Record<number, number> = { 36: 0.5, 38: 0.35, 39: 0.35, 42: 0.09, 46: 0.5, 49: 2.4 };
const PAD_DETUNE = [-0.011, -0.005, 0, 0.0055, 0.012];
const MASTER = 1.35;

/** band-limited step correction for saw oscillators (polyBLEP) */
function blep(ph: number, dt: number) {
  if (ph < dt) {
    const x = ph / dt;
    return x + x - x * x - 1;
  }
  if (ph > 1 - dt) {
    const x = (ph - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export function renderCue(cue: ScoreCue, sampleRate = 44100, tail = 1.5): StereoPCM {
  return renderComposition(compose(cue), cue, sampleRate, tail);
}

export function renderComposition(comp: Composition, cue: ScoreCue, sampleRate = 44100, tail = 1.5): StereoPCM {
  const sr = sampleRate;
  const len = Math.ceil((comp.duration + tail) * sr);
  // melodic bus (ducked by the kick), drum bus, effect sends
  const mL = new Float32Array(len);
  const mR = new Float32Array(len);
  const dL = new Float32Array(len);
  const dR = new Float32Array(len);
  const rev = new Float32Array(len);
  const dly = new Float32Array(len);
  const noise = mulberry32(cue.seed ^ 0x9e3779b9);
  const lpk = (fc: number) => 1 - Math.exp((-2 * Math.PI * Math.min(fc, sr * 0.45)) / sr);
  const TAU = 2 * Math.PI;
  let arpSide = 1;

  for (const n of comp.notes) {
    const inst = n.instrument;
    const g = (cue.instruments[inst]?.gain ?? 0.5) * n.vel;
    // a couple of cents of drift per note keeps unisons from sounding sequenced
    const f = midiToFreq(n.midi) * (1 + (noise() - 0.5) * 0.002);
    const i0 = Math.floor(n.time * sr);
    const nLen = Math.floor((inst === 'perc' ? (DRUM_LEN[n.midi] ?? 0.2) : n.dur + RELEASE[inst]) * sr);
    let pan = PAN[inst];
    if (inst === 'arp') pan *= arpSide = -arpSide;
    const lg = Math.cos(((pan + 1) * Math.PI) / 4);
    const rg = Math.sin(((pan + 1) * Math.PI) / 4);
    const outL = inst === 'perc' ? dL : mL;
    const outR = inst === 'perc' ? dR : mR;
    const rs = REVERB_SEND[inst] * (inst === 'perc' && n.midi === 36 ? 0.2 : 1);
    const ds = DELAY_SEND[inst];
    const ph = [noise(), noise(), noise(), noise(), noise()];
    const z = [0, 0, 0, 0];
    const lfo = noise() * TAU;
    const dt = f / sr;
    const rel = RELEASE[inst];
    const sustainEnv = (t: number, attack: number) => {
      const a = Math.min(1, t / attack);
      return t < n.dur ? a : a * Math.max(0, 1 - (t - n.dur) / rel);
    };

    for (let i = 0; i < nLen && i0 + i < len; i++) {
      const t = i / sr;
      let sL = 0;
      let sR = 0;
      switch (inst) {
        case 'pad': {
          // five detuned saws spread across the stereo field, through a slowly breathing lowpass
          const env = sustainEnv(t, 0.6);
          let l = 0;
          let r = 0;
          for (let v = 0; v < 5; v++) {
            const vdt = dt * (1 + PAD_DETUNE[v]);
            ph[v] = (ph[v] + vdt) % 1;
            const s = 2 * ph[v] - 1 - blep(ph[v], vdt);
            l += s * (1 - v / 4);
            r += s * (v / 4);
          }
          const k = lpk(f * 2 + 900 * Math.min(1, t / 1.5) * (0.75 + 0.25 * Math.sin(t * 0.6 + lfo)));
          z[0] += k * (l - z[0]);
          z[1] += k * (z[0] - z[1]);
          z[2] += k * (r - z[2]);
          z[3] += k * (z[2] - z[3]);
          sL = z[1] * 0.24 * env;
          sR = z[3] * 0.24 * env;
          break;
        }
        case 'bass': {
          // sine sub + saw with a plucky filter envelope, lightly driven
          const env = Math.min(1, t / 0.006) * (t < n.dur ? 0.75 + 0.25 * Math.exp(-t * 6) : 0.75 * Math.max(0, 1 - (t - n.dur) / rel));
          ph[0] = (ph[0] + dt) % 1;
          const saw = 2 * ph[0] - 1 - blep(ph[0], dt);
          const k = lpk(f * 1.5 + 1400 * Math.exp(-t * 14));
          z[0] += k * (saw - z[0]);
          z[1] += k * (z[0] - z[1]);
          const s = Math.tanh((Math.sin(TAU * ph[0]) * 0.8 + z[1] * 0.7) * 1.4) * 0.55;
          sL = sR = s * env;
          break;
        }
        case 'arp': {
          // two-operator FM electric piano: bright tine on the attack mellowing into a sine
          const env = Math.min(1, t / 0.003) * Math.exp(-t * 3.2) * (t < n.dur ? 1 : Math.max(0, 1 - (t - n.dur) / rel));
          ph[0] = (ph[0] + dt) % 1;
          ph[1] = (ph[1] + dt) % 1;
          ph[2] = (ph[2] + dt * 4) % 1;
          const idx = 1.8 * Math.exp(-t * 9) + 0.25;
          const s = Math.sin(TAU * ph[0] + idx * Math.sin(TAU * ph[1])) + 0.12 * Math.sin(TAU * ph[2]) * Math.exp(-t * 16);
          sL = sR = s * 0.6 * env;
          break;
        }
        case 'lead': {
          // two detuned saws, filter opening on the attack, delayed vibrato
          const env = sustainEnv(t, 0.035);
          const vib = 1 + 0.005 * Math.sin(TAU * 5.2 * t + lfo) * Math.min(1, Math.max(0, t - 0.15) / 0.35);
          const d1 = dt * vib * 1.003;
          const d2 = dt * vib * 0.997;
          ph[0] = (ph[0] + d1) % 1;
          ph[1] = (ph[1] + d2) % 1;
          const raw = (2 * ph[0] - 1 - blep(ph[0], d1) + 2 * ph[1] - 1 - blep(ph[1], d2)) * 0.5;
          const k = lpk(f * (1.8 + 2.5 * Math.exp(-t * 6)));
          z[0] += k * (raw - z[0]);
          z[1] += k * (z[0] - z[1]);
          sL = sR = (z[1] + Math.sin(TAU * ph[0]) * 0.25) * 0.9 * env;
          break;
        }
        case 'perc': {
          const w = noise() * 2 - 1;
          let s = 0;
          switch (n.midi) {
            case 36: {
              // kick: pitch-dropping sine + click
              const pf = 48 + 120 * Math.exp(-t * 32);
              ph[0] = (ph[0] + pf / sr) % 1;
              s = Math.tanh(Math.sin(TAU * ph[0]) * Math.exp(-t * 6.5) * 1.6) * 0.95 + w * Math.exp(-t * 400) * 0.25;
              break;
            }
            case 38: {
              // snare: body tone + bright noise
              ph[0] = (ph[0] + 190 / sr) % 1;
              z[0] += lpk(1800) * (w - z[0]);
              s = Math.sin(TAU * ph[0]) * Math.exp(-t * 22) * 0.45 + (w - z[0]) * Math.exp(-t * 15) * 0.6;
              break;
            }
            case 39: {
              // clap: three quick bursts then a short tail
              z[0] += lpk(1200) * (w - z[0]);
              z[1] += lpk(3000) * (w - z[0] - z[1]);
              const e = t < 0.024 ? Math.exp(-((t % 0.008) * 350)) : Math.exp(-(t - 0.024) * 16);
              s = z[1] * e * 0.9;
              break;
            }
            case 49: {
              z[0] += lpk(5000) * (w - z[0]);
              s = (w - z[0]) * Math.exp(-t * 1.6) * Math.min(1, t / 0.002) * 0.4;
              break;
            }
            default: {
              // hats: high-passed noise, closed or open
              z[0] += lpk(7000) * (w - z[0]);
              s = (w - z[0]) * Math.exp(-t * (n.midi === 46 ? 9 : 55)) * 0.5;
            }
          }
          sL = sR = s;
          break;
        }
      }
      sL *= g;
      sR *= g;
      outL[i0 + i] += sL * lg;
      outR[i0 + i] += sR * rg;
      const mono = (sL + sR) * 0.5;
      rev[i0 + i] += mono * rs;
      dly[i0 + i] += mono * ds;
    }
  }

  // sidechain: the melodic bus dips under each kick and swells back
  const kicks = comp.notes.filter((n) => n.instrument === 'perc' && n.midi === 36).map((n) => Math.floor(n.time * sr));
  if (kicks.length) {
    let ki = 0;
    let last = -Infinity;
    for (let i = 0; i < len; i++) {
      while (ki < kicks.length && kicks[ki] <= i) last = kicks[ki++];
      const duck = 1 - 0.3 * Math.exp(-((i - last) / sr) * 9);
      mL[i] *= duck;
      mR[i] *= duck;
    }
  }

  // ping-pong delay, dotted eighth, darkening on each repeat
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  const dTime = Math.max(1, Math.round(Math.min(0.6, comp.secondsPerBeat * 0.75) * sr));
  const bufL = new Float32Array(dTime);
  const bufR = new Float32Array(dTime);
  let di = 0;
  let lpL = 0;
  let lpR = 0;
  const dk = lpk(3500);
  for (let i = 0; i < len; i++) {
    const yL = bufL[di];
    const yR = bufR[di];
    lpL += dk * (yL - lpL);
    lpR += dk * (yR - lpR);
    bufL[di] = dly[i] + lpR * 0.4;
    bufR[di] = lpL * 0.4;
    di = (di + 1) % dTime;
    left[i] = mL[i] + dL[i] + yL * 0.6;
    right[i] = mR[i] + dR[i] + yR * 0.6;
    rev[i] += (yL + yR) * 0.15;
  }

  // reverb: Freeverb — 8 damped combs + 4 allpasses per side, 20 ms pre-delay
  const pre = Math.round(0.02 * sr);
  const scale = sr / 44100;
  const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const ALLPASS = [556, 441, 341, 225];
  const wet = 0.5;
  for (const [out, spread] of [
    [left, 0],
    [right, 23],
  ] as const) {
    const combs = COMBS.map((d) => new Float32Array(Math.round((d + spread) * scale)));
    const cIdx = combs.map(() => 0);
    const cLp = combs.map(() => 0);
    const aps = ALLPASS.map((d) => new Float32Array(Math.round((d + spread) * scale)));
    const aIdx = aps.map(() => 0);
    for (let i = 0; i < len; i++) {
      const x = (i >= pre ? rev[i - pre] : 0) * 0.03;
      let acc = 0;
      for (let c = 0; c < combs.length; c++) {
        const b = combs[c];
        const y = b[cIdx[c]];
        cLp[c] = y * 0.75 + cLp[c] * 0.25;
        b[cIdx[c]] = x + cLp[c] * 0.84;
        cIdx[c] = (cIdx[c] + 1) % b.length;
        acc += y;
      }
      for (let a = 0; a < aps.length; a++) {
        const b = aps[a];
        const bo = b[aIdx[a]];
        b[aIdx[a]] = acc + bo * 0.5;
        aIdx[a] = (aIdx[a] + 1) % b.length;
        acc = bo - acc;
      }
      out[i] += acc * wet;
    }
  }

  // soft clip
  for (let i = 0; i < len; i++) {
    left[i] = Math.tanh(left[i] * MASTER);
    right[i] = Math.tanh(right[i] * MASTER);
  }
  return { sampleRate, left, right };
}
