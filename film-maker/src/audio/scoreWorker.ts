/// <reference lib="webworker" />
import type { ScoreCue } from '../model/schema';
import { compositionFor } from '../score/source';
import { renderComposition } from '../score/render';

self.onmessage = (e: MessageEvent<{ id: number; cue: ScoreCue; midi?: Uint8Array; sampleRate: number }>) => {
  const { id, cue, midi, sampleRate } = e.data;
  const pcm = renderComposition(compositionFor(cue, midi), cue, sampleRate);
  (self as unknown as Worker).postMessage({ id, left: pcm.left, right: pcm.right, sampleRate }, [pcm.left.buffer, pcm.right.buffer]);
};
