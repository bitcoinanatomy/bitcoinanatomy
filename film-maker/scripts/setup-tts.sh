#!/usr/bin/env bash
# Installs Piper TTS (open source, offline) into film-maker/tools and downloads voices.
# Usage: npm run setup:tts [-- extra_voice_id ...]
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PYTHON:-}
if [ -z "$PY" ]; then
  for c in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$c" >/dev/null 2>&1; then PY=$c; break; fi
  done
fi
ver=$("$PY" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')
major=${ver%%.*}; minor=${ver#*.}
if [ "$major" -lt 3 ] || [ "$minor" -lt 10 ]; then
  echo "mlx-audio needs Python 3.10+ (found $PY $ver). Install with: brew install python@3.12" >&2
  exit 1
fi
mkdir -p tools/voices
if [ ! -x tools/piper-venv/bin/piper ]; then
  echo "→ creating venv tools/piper-venv"
  "$PY" -m venv tools/piper-venv
  tools/piper-venv/bin/pip install --upgrade pip >/dev/null
  tools/piper-venv/bin/pip install piper-tts
fi
voice_url() { # en_US-lessac-medium → en/en_US/lessac/medium/en_US-lessac-medium
  local id=$1; local loc=${id%%-*}; local rest=${id#*-}; local name=${rest%-*}; local q=${rest##*-}
  echo "https://huggingface.co/rhasspy/piper-voices/resolve/main/${loc%%_*}/${loc}/${name}/${q}/${id}"
}
for v in en_US-lessac-medium en_US-amy-medium en_US-joe-medium en_GB-alan-medium "$@"; do
  if [ ! -f "tools/voices/$v.onnx" ]; then
    echo "→ downloading voice $v"
    curl -fsSL -o "tools/voices/$v.onnx" "$(voice_url "$v").onnx"
    curl -fsL -o "tools/voices/$v.onnx.json" "$(voice_url "$v").onnx.json"
  fi
done
echo "→ test"
echo "Piper is ready." | tools/piper-venv/bin/piper -m tools/voices/en_US-lessac-medium.onnx -f tools/test.wav && echo "ok: tools/test.wav"

if [ ! -x tools/mlx-venv/bin/python ]; then
  echo "→ creating venv tools/mlx-venv"
  "$PY" -m venv tools/mlx-venv
  tools/mlx-venv/bin/pip install --upgrade pip >/dev/null
fi
echo "→ installing mlx-audio (Kokoro)"
tools/mlx-venv/bin/pip install -U 'mlx-audio' 'misaki[en]' soundfile loguru
echo "→ warming Kokoro"
printf '%s\n' '{"text":"Kokoro is ready.","voice":"am_adam","speed":1,"out":"tools/kokoro-test.wav"}' | tools/mlx-venv/bin/python scripts/mlx_tts.py | tee /tmp/kokoro-warm.json
grep -q '"ok": true' /tmp/kokoro-warm.json
echo "ok: tools/kokoro-test.wav"
