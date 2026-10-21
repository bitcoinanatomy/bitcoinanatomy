/**
 * Playback engine: one AudioContext, decoded-buffer cache, score cues rendered in a
 * worker, and a transport that schedules every audio clip of a resolved timeline.
 */
import { create } from 'zustand';
import { mediaUrl } from '../lib/api';
import type { DialogClip, ProjectData, ScoreClip, ScoreCue, SfxClip, TrackKind } from '../model/schema';
import type { ResolvedTimeline } from '../model/timeline';

let ctx: AudioContext | null = null;
export const audioCtx = () => (ctx ??= new AudioContext({ sampleRate: 44100 }));

// ---------------------------------------------------------------- buffers

const buffers = new Map<string, Promise<AudioBuffer | null>>();
const ready = new Map<string, AudioBuffer>();

export function loadBuffer(url: string): Promise<AudioBuffer | null> {
  if (!buffers.has(url)) {
    buffers.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((b) => audioCtx().decodeAudioData(b))
        .then((buf) => {
          ready.set(url, buf);
          return buf;
        })
        .catch(() => null),
    );
  }
  return buffers.get(url)!;
}
export const bufferNow = (url: string) => ready.get(url);

let worker: Worker | null = null;
let jobId = 0;
const jobs = new Map<number, (b: AudioBuffer) => void>();
const cueKey = (cue: ScoreCue) => `cue:${JSON.stringify(cue)}`;

/** Render (or fetch the replacement for) a score cue. Cached by cue content. */
export function loadCue(cue: ScoreCue): Promise<AudioBuffer | null> {
  if (cue.replacement?.toLowerCase().endsWith('.wav')) return loadBuffer(mediaUrl(cue.replacement)!);
  const key = cueKey(cue);
  if (!buffers.has(key)) {
    worker ??= (() => {
      const w = new Worker(new URL('./scoreWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; left: Float32Array; right: Float32Array; sampleRate: number }>) => {
        const { id, left, right, sampleRate } = e.data;
        const buf = audioCtx().createBuffer(2, left.length, sampleRate);
        buf.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
        buf.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
        jobs.get(id)?.(buf);
        jobs.delete(id);
      };
      return w;
    })();
    const p = (async () => {
      let midi: Uint8Array | undefined;
      if (cue.replacement?.toLowerCase().endsWith('.mid')) midi = new Uint8Array(await (await fetch(mediaUrl(cue.replacement)!)).arrayBuffer());
      const id = ++jobId;
      const buf = await new Promise<AudioBuffer>((resolve) => {
        jobs.set(id, resolve);
        worker!.postMessage({ id, cue, midi, sampleRate: 44100 });
      });
      ready.set(key, buf);
      return buf;
    })();
    buffers.set(key, p);
  }
  return buffers.get(key)!;
}
export const cueBufferNow = (cue: ScoreCue) => ready.get(cueKey(cue));

// ---------------------------------------------------------------- transport

interface PlaybackState {
  time: number;
  playing: boolean;
  loading: boolean;
}
export const usePlayback = create<PlaybackState>(() => ({ time: 0, playing: false, loading: false }));

interface AudioItem {
  track: TrackKind;
  start: number;
  end: number;
  offset: number; // seconds into the buffer at clip start
  gain: number;
  get: () => Promise<AudioBuffer | null>;
}

function audioItems(tl: ResolvedTimeline, data: ProjectData): AudioItem[] {
  const out: AudioItem[] = [];
  for (const c of tl.clips) {
    if (c.derived) continue;
    if (c.track === 'dialog') {
      const clip = c.clip as DialogClip;
      const url = mediaUrl(clip.audio);
      if (url) out.push({ track: 'dialog', start: c.start, end: c.end, offset: 0, gain: clip.gain, get: () => loadBuffer(url) });
    } else if (c.track === 'sfx') {
      const clip = c.clip as SfxClip;
      out.push({ track: 'sfx', start: c.start, end: c.end, offset: 0, gain: clip.gain, get: () => loadBuffer(mediaUrl(clip.file)!) });
    } else if (c.track === 'score') {
      const clip = c.clip as ScoreClip;
      const cue = data.cues[clip.cueId];
      if (cue) out.push({ track: 'score', start: c.start, end: c.end, offset: clip.offset, gain: clip.gain, get: () => loadCue(cue) });
    }
  }
  return out;
}

class Transport {
  private sources: AudioScheduledSourceNode[] = [];
  private master: GainNode | null = null;
  private t0 = 0; // ctx time when playback position == from
  private from = 0;
  private raf = 0;
  private end = 0;
  private loop = false;
  private session = 0;
  tl: ResolvedTimeline | null = null;
  data: ProjectData | null = null;
  muted = new Set<TrackKind>();

  /** Preload everything the timeline needs (fire and forget). */
  preload(tl: ResolvedTimeline, data: ProjectData) {
    return Promise.all(audioItems(tl, data).map((i) => i.get()));
  }

  async play(tl: ResolvedTimeline, data: ProjectData, from: number, opts: { loop?: boolean } = {}) {
    this.stop(false);
    const session = ++this.session;
    this.tl = tl;
    this.data = data;
    this.loop = !!opts.loop;
    this.end = tl.duration;
    if (from >= tl.duration - 0.05) from = 0;
    const ac = audioCtx();
    await ac.resume();
    const items = audioItems(tl, data).filter((i) => i.end > from && !this.muted.has(i.track));
    usePlayback.setState({ loading: true });
    const bufs = await Promise.all(items.map((i) => i.get()));
    if (session !== this.session) return; // stopped or restarted while loading
    usePlayback.setState({ loading: false });
    this.master = ac.createGain();
    this.master.connect(ac.destination);
    this.from = from;
    this.t0 = ac.currentTime + 0.06;
    items.forEach((it, k) => {
      const buf = bufs[k];
      if (!buf) return;
      const into = Math.max(0, from - it.start);
      const offset = it.offset + into;
      const dur = it.end - it.start - into;
      if (offset >= buf.duration || dur <= 0) return;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.value = it.gain;
      // tiny fades avoid clicks at cut points
      const at = this.t0 + Math.max(0, it.start - from);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(it.gain, at + 0.01);
      g.gain.setValueAtTime(it.gain, at + Math.max(0.01, dur - 0.03));
      g.gain.linearRampToValueAtTime(0, at + dur);
      src.connect(g).connect(this.master!);
      src.start(at, offset, dur);
      this.sources.push(src);
    });
    usePlayback.setState({ playing: true, time: from });
    const tick = () => {
      const t = this.position();
      if (t >= this.end) {
        if (this.loop && this.tl && this.data) {
          void this.play(this.tl, this.data, 0, { loop: true });
          return;
        }
        this.stop();
        usePlayback.setState({ time: this.end });
        return;
      }
      usePlayback.setState({ time: t });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  position() {
    return ctx ? this.from + (ctx.currentTime - this.t0) : this.from;
  }

  stop(updateState = true) {
    this.session++;
    cancelAnimationFrame(this.raf);
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    this.sources = [];
    this.master?.disconnect();
    this.master = null;
    if (updateState) usePlayback.setState({ playing: false, loading: false });
  }

  pause() {
    const t = this.position();
    const playing = usePlayback.getState().playing;
    this.stop();
    if (playing) usePlayback.setState({ time: Math.min(Math.max(0, t), this.end) });
  }

  seek(t: number) {
    const playing = usePlayback.getState().playing;
    usePlayback.setState({ time: Math.max(0, t) });
    if (playing && this.tl && this.data) void this.play(this.tl, this.data, Math.max(0, t), { loop: this.loop });
  }

  /** Play a single buffer (score preview, waveform audition). Returns a stop function. */
  audition(buf: AudioBuffer, offset = 0, onEnd?: () => void) {
    const ac = audioCtx();
    void ac.resume();
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.onended = () => onEnd?.();
    src.start(ac.currentTime + 0.02, offset);
    const startedAt = ac.currentTime + 0.02 - offset;
    return { stop: () => src.stop(), position: () => ac.currentTime - startedAt };
  }
}

export const transport = new Transport();

// ---------------------------------------------------------------- waveform peaks

const peakCache = new WeakMap<AudioBuffer, Float32Array>();
/** Max-abs peaks at ~200 per second, used to draw waveforms. */
export function peaks(buf: AudioBuffer): Float32Array {
  let p = peakCache.get(buf);
  if (p) return p;
  const per = Math.max(1, Math.floor(buf.sampleRate / 200));
  const n = Math.ceil(buf.length / per);
  p = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.min(d.length, (i + 1) * per);
      for (let j = i * per; j < end; j += 4) m = Math.max(m, Math.abs(d[j]));
      p[i] = Math.max(p[i], m);
    }
  }
  peakCache.set(buf, p);
  return p;
}
