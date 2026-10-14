#!/usr/bin/env bash
# Installs Piper TTS (open source, offline) into film-maker/tools and downloads voices.
# Usage: npm run setup:tts [-- extra_voice_id ...]
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PYTHON:-python3}
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
