/**
 * Dialog text-to-speech. Prefers Kokoro via MLX Audio (`npm run setup:tts`),
 * then Piper, then macOS `say`.
 * Output is cached by hash(engine, voice, text) in project/media/audio/dialog/.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wavDuration } from '../src/audio/wav';
import { PROJECT_DIR, ROOT } from './projectFs';

const PIPER = path.join(ROOT, 'tools/piper-venv/bin/piper');
const MLX_PY = path.join(ROOT, 'tools/mlx-venv/bin/python');
const MLX_WORKER = path.join(ROOT, 'scripts/mlx_tts.py');
const VOICES = path.join(ROOT, 'tools/voices');
export const MLX_MODEL = 'mlx-community/Kokoro-82M-bf16';

/** Kokoro presets used by the characters. American (a*) and British (b*). */
export const KOKORO_VOICES = [
  'af_heart', 'af_bella', 'af_sarah', 'af_sky', 'af_nicole',
  'am_adam', 'am_michael', 'am_echo', 'am_fenrir',
  'bf_emma', 'bf_isabella', 'bm_george', 'bm_daniel',
];

export interface TtsRequest {
  text: string;
  voice?: string;
  engine?: 'mlx' | 'piper' | 'say';
  /** pitch in semitones, speed multiplier — gives each character its own voice */
  tune?: { pitch?: number; speed?: number };
}
export interface TtsResult {
  audio: string; // relative to project/
  audioHash: string;
  duration: number;
  engine: 'mlx' | 'piper' | 'say';
  cached: boolean;
}

export function piperAvailable(voice?: string) {
  return fs.existsSync(PIPER) && (!voice || fs.existsSync(path.join(VOICES, `${voice}.onnx`)));
}

export function mlxAvailable() {
  return fs.existsSync(MLX_PY) && fs.existsSync(MLX_WORKER);
}

export function listPiperVoices(): string[] {
  return fs.existsSync(VOICES) ? fs.readdirSync(VOICES).filter((f) => f.endsWith('.onnx')).map((f) => f.slice(0, -5)) : [];
}

const looksPiper = (voice: string) => /^[a-z]{2}_[A-Z]{2}-/.test(voice);
const looksKokoro = (voice: string) => /^(af|am|bf|bm)_/.test(voice);

/** Which engine + voice will actually be used for a request. */
export function resolveEngine(req: TtsRequest): { engine: 'mlx' | 'piper' | 'say'; voice: string } {
  const voice = req.voice || (req.engine === 'mlx' ? 'am_adam' : 'en_US-lessac-medium');
  if ((req.engine ?? 'piper') === 'mlx' && mlxAvailable() && !looksPiper(voice)) return { engine: 'mlx', voice: looksKokoro(voice) ? voice : 'am_adam' };
  if ((req.engine ?? 'piper') !== 'say' && looksPiper(voice) && piperAvailable(voice)) return { engine: 'piper', voice };
  return { engine: 'say', voice: looksPiper(voice) || looksKokoro(voice) ? '' : voice };
}

const tuneOf = (req: TtsRequest) => ({ pitch: req.tune?.pitch ?? 0, speed: req.tune?.speed ?? 1 });

export function ttsHash(req: TtsRequest) {
  const { engine, voice } = resolveEngine(req);
  const { pitch, speed } = tuneOf(req);
  const tune = pitch || speed !== 1 ? `|${pitch}|${speed}` : '';
  const model = engine === 'mlx' ? `|${MLX_MODEL}` : '';
  return crypto.createHash('sha1').update(`${engine}|${voice}|${req.text.trim()}${tune}${model}`).digest('hex').slice(0, 12);
}

function wavSampleRate(file: string) {
  const b = fs.readFileSync(file);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 12;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') return v.getUint32(o + 12, true);
    o += 8 + size + (size % 2);
  }
  return 22050;
}

/** One Kokoro process for the whole session so the model is not reloaded per line. */
let mlxChain: Promise<unknown> = Promise.resolve();
let mlxProc: ReturnType<typeof spawn> | null = null;
let mlxBuf = '';
let mlxWait: { resolve: () => void; reject: (e: Error) => void } | null = null;

function mlxProcAlive() {
  if (!mlxProc || mlxProc.exitCode !== null) {
    mlxProc = spawn(MLX_PY, [MLX_WORKER], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MLX_TTS_MODEL: MLX_MODEL } });
    mlxBuf = '';
    mlxProc.stdout!.on('data', (d) => {
      mlxBuf += d.toString();
      let nl: number;
      while ((nl = mlxBuf.indexOf('\n')) >= 0) {
        const line = mlxBuf.slice(0, nl).trim();
        mlxBuf = mlxBuf.slice(nl + 1);
        if (!line.startsWith('{')) continue;
        const wait = mlxWait;
        mlxWait = null;
        if (!wait) continue;
        try {
          const msg = JSON.parse(line) as { ok: boolean; error?: string };
          if (msg.ok) wait.resolve();
          else wait.reject(new Error(msg.error || 'mlx tts failed'));
        } catch (e) {
          wait.reject(e as Error);
        }
      }
    });
    mlxProc.unref();
    mlxProc.stdout?.unref();
    mlxProc.stdin?.unref();
    mlxProc.stderr?.unref();
    mlxProc.on('exit', () => {
      mlxWait?.reject(new Error('mlx tts worker exited'));
      mlxWait = null;
      mlxProc = null;
    });
  }
  return mlxProc;
}

function mlxSpeak(text: string, voice: string, speed: number, out: string) {
  const job = mlxChain.then(() => new Promise<void>((resolve, reject) => {
    const p = mlxProcAlive();
    mlxWait = { resolve, reject };
    p.stdin!.write(JSON.stringify({ text, voice, speed, out }) + '\n');
  }));
  mlxChain = job.then(() => undefined, () => undefined);
  return job;
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
    if (engine === 'mlx') {
      await mlxSpeak(text, voice, speed, tmp);
    } else if (engine === 'piper') {
      await run(PIPER, ['-m', path.join(VOICES, `${voice}.onnx`), '--length-scale', String(1 / speed), '-f', tmp], text + '\n');
    } else {
      await run('say', [...(voice ? ['-v', voice] : []), '-r', String(Math.round(180 * speed)), '--data-format=LEI16@22050', '-o', tmp, text]);
    }
    if (pitch) {
      // shift pitch without changing duration: resample up/down, then time-stretch back
      const ratio = Math.pow(2, pitch / 12);
      const sr = wavSampleRate(tmp);
      const shifted = `${out}.pitch.wav`;
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af', `asetrate=${sr}*${ratio.toFixed(5)},aresample=${sr},atempo=${(1 / ratio).toFixed(5)}`, shifted]);
      fs.renameSync(shifted, tmp);
    }
    fs.renameSync(tmp, out);
  }
  const duration = wavDuration(new Uint8Array(fs.readFileSync(out)));
  return { audio: rel, audioHash, duration, engine, cached };
}
