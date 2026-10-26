"""Kokoro worker for dialog WAV files. One JSON request per stdin line.

{"text", "voice", "speed", "out"} -> {"ok": true} or {"ok": false, "error": "..."}

The model stays loaded for the life of the process. lang_code follows the voice
prefix: af_/am_ are American English, bf_/bm_ are British English.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from mlx_audio.tts.utils import load_model

MODEL = os.environ.get("MLX_TTS_MODEL", "mlx-community/Kokoro-82M-bf16")
model = load_model(MODEL)


def lang_for(voice: str) -> str:
    return "b" if voice.startswith("b") else "a"


def speak(text: str, voice: str, speed: float, out: str) -> None:
    chunks = []
    rate = 24000
    for result in model.generate(text=text, voice=voice, speed=speed, lang_code=lang_for(voice)):
        chunks.append(np.array(result.audio).reshape(-1))
        rate = int(result.sample_rate)
    if not chunks:
        raise RuntimeError("model returned no audio")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sf.write(out, np.concatenate(chunks), rate)


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            speak(req["text"], req.get("voice") or "af_heart", float(req.get("speed") or 1), req["out"])
            sys.stdout.write(json.dumps({"ok": True}) + "\n")
        except Exception as e:
            sys.stdout.write(json.dumps({"ok": False, "error": str(e)}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
