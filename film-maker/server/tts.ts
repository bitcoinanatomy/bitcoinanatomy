/**
 * Dialog text-to-speech. Prefers Piper (open source, offline; `npm run setup:tts`),
 * falls back to macOS `say` so the pipeline works out of the box.
 * Output is cached by hash(engine, voice, text) in project/media/audio/dialog/.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wavDuration } from '../src/audio/wav';
import { PROJECT_DIR, ROOT } from './projectFs';

const PIPER = path.join(ROOT, 'tools/piper-venv/bin/piper');
const VOICES = path.join(ROOT, 'tools/voices');

export interface TtsRequest {
  text: string;
  voice?: string;
  engine?: 'piper' | 'say';
  /** pitch in semitones, speed multiplier — gives each character its own voice */
  tune?: { pitch?: number; speed?: number };
}
export interface TtsResult {
  audio: string; // relative to project/
  audioHash: string;
  duration: number;
  engine: 'piper' | 'say';
  cached: boolean;
}

export function piperAvailable(voice?: string) {
  return fs.existsSync(PIPER) && (!voice || fs.existsSync(path.join(VOICES, `${voice}.onnx`)));
}

export function listPiperVoices(): string[] {
  return fs.existsSync(VOICES) ? fs.readdirSync(VOICES).filter((f) => f.endsWith('.onnx')).map((f) => f.slice(0, -5)) : [];
}

/** Which engine + voice will actually be used for a request. */
export function resolveEngine(req: TtsRequest): { engine: 'piper' | 'say'; voice: string } {
  const voice = req.voice || 'en_US-lessac-medium';
  const looksPiper = /^[a-z]{2}_[A-Z]{2}-/.test(voice);
  if ((req.engine ?? 'piper') === 'piper' && looksPiper && piperAvailable(voice)) return { engine: 'piper', voice };
  return { engine: 'say', voice: looksPiper ? '' : voice };
}

const tuneOf = (req: TtsRequest) => ({ pitch: req.tune?.pitch ?? 0, speed: req.tune?.speed ?? 1 });

export function ttsHash(req: TtsRequest) {
  const { engine, voice } = resolveEngine(req);
  const { pitch, speed } = tuneOf(req);
  const tune = pitch || speed !== 1 ? `|${pitch}|${speed}` : '';
  return crypto.createHash('sha1').update(`${engine}|${voice}|${req.text.trim()}${tune}`).digest('hex').slice(0, 12);
}

function run(cmd: string, args: string[], stdin?: string) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.slice(-400)}`))));
    if (stdin !== undefined) p.stdin.end(stdin);
    else p.stdin.end();
  });
}

export async function synthesize(req: TtsRequest): Promise<TtsResult> {
  const text = req.text.trim();
  if (!text) throw new Error('empty text');
  const { engine, voice } = resolveEngine(req);
  const audioHash = ttsHash(req);
  const rel = `media/audio/dialog/${audioHash}.wav`;
  const out = path.join(PROJECT_DIR, rel);
  let cached = fs.existsSync(out);
  if (!cached) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = `${out}.tmp.wav`;
    const { pitch, speed } = tuneOf(req);
    if (engine === 'piper') {
      await run(PIPER, ['-m', path.join(VOICES, `${voice}.onnx`), '--length-scale', String(1 / speed), '-f', tmp], text + '\n');
    } else {
      await run('say', [...(voice ? ['-v', voice] : []), '-r', String(Math.round(180 * speed)), '--data-format=LEI16@22050', '-o', tmp, text]);
    }
    if (pitch) {
      // shift pitch without changing duration: resample up/down, then time-stretch back
      const ratio = Math.pow(2, pitch / 12);
      const shifted = `${out}.pitch.wav`;
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af', `asetrate=22050*${ratio.toFixed(5)},aresample=22050,atempo=${(1 / ratio).toFixed(5)}`, shifted]);
      fs.renameSync(shifted, tmp);
    }
    fs.renameSync(tmp, out);
  }
  const duration = wavDuration(new Uint8Array(fs.readFileSync(out)));
  return { audio: rel, audioHash, duration, engine, cached };
}
