import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { bufferNow, cueBufferNow, loadBuffer, loadCue, peaks } from '../audio/player';
import type { ScoreCue } from '../model/schema';
import { INSTRUMENTS } from '../model/schema';
import { compose } from '../score/compose';

const INST_COLOR: Record<string, string> = { pad: '#8a86a6', bass: '#6f93a8', arp: '#7fa883', lead: '#c9a66b', perc: '#a86a6a' };

function useCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio);
    c.width = Math.min(16000, w * dpr);
    c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(c.width / w, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Waveform of `url` from `offset` for `duration` seconds, stretched to the element. */
export const Waveform = memo(function Waveform({ url, offset = 0, duration, color, width }: { url: string; offset?: number; duration: number; color: string; width: number }) {
  const [buf, setBuf] = useState(() => bufferNow(url));
  useEffect(() => {
    if (!buf) void loadBuffer(url).then((b) => b && setBuf(b));
  }, [url, buf]);
  const ref = useCanvas(
    (g, w, h) => {
      if (!buf) return;
      const p = peaks(buf);
      const rate = p.length / buf.duration;
      g.fillStyle = color;
      const mid = h / 2 + 5;
      const amp = (h - 14) / 2;
      for (let x = 0; x < w; x++) {
        const t = offset + (x / w) * duration;
        const v = p[Math.floor(t * rate)] ?? 0;
        const y = Math.max(0.5, v * amp);
        g.fillRect(x, mid - y, 1, y * 2);
      }
    },
    [buf, offset, duration, color, width],
  );
  return <canvas ref={ref} />;
});

/** Mini piano-roll of a score cue (also shows render state). */
export const NoteRoll = memo(function NoteRoll({ cue, offset, duration, width }: { cue: ScoreCue; offset: number; duration: number; width: number }) {
  const comp = useMemo(() => compose(cue), [cue]);
  const [, setReady] = useState(!!cueBufferNow(cue));
  useEffect(() => {
    if (!cueBufferNow(cue)) void loadCue(cue).then(() => setReady(true));
  }, [cue]);
  const ref = useCanvas(
    (g, w, h) => {
      const notes = comp.notes.filter((n) => n.instrument !== 'perc');
      if (!notes.length) return;
      let lo = 127;
      let hi = 0;
      for (const n of notes) {
        lo = Math.min(lo, n.midi);
        hi = Math.max(hi, n.midi);
      }
      const top = 16;
      const span = Math.max(12, hi - lo + 1);
      const rh = Math.max(1, (h - top - 3) / span);
      // bar lines
      g.fillStyle = 'rgba(255,255,255,.06)';
      const barLen = comp.secondsPerBeat * cue.beatsPerBar;
      for (let b = Math.ceil(offset / barLen) * barLen; b < offset + duration; b += barLen) g.fillRect(((b - offset) / duration) * w, top, 1, h - top);
      for (const inst of INSTRUMENTS) {
        g.fillStyle = INST_COLOR[inst];
        g.globalAlpha = inst === 'pad' ? 0.35 : 0.85;
        for (const n of notes) {
          if (n.instrument !== inst || n.time + n.dur < offset || n.time > offset + duration) continue;
          const x = ((n.time - offset) / duration) * w;
          g.fillRect(x, top + (hi - n.midi) * rh, Math.max(1, (n.dur / duration) * w - 0.5), Math.max(1, rh - 0.3));
        }
      }
      g.globalAlpha = 1;
    },
    [comp, offset, duration, width],
  );
  return <canvas ref={ref} />;
});

export { INST_COLOR };
