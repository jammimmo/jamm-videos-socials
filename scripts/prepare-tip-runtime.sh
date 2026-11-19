#!/usr/bin/env bash
# Shared by source qualification, V11 rendering and the Linux mini-PC fixture.
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ $# == 1 && ( "$1" == --install || "$1" == --verify ) ]] || {
  echo 'Usage: bash scripts/prepare-tip-runtime.sh --install|--verify' >&2; exit 2;
}
[[ "$(uname -sm)" == 'Linux x86_64' && "$(node --version)" == v22.20.0 && "$(npm --version)" == 10.9.3 ]] || {
  echo 'Use Linux x86_64 with Node 22.20.0 and npm 10.9.3.' >&2; exit 1;
}
python -I -c 'import sys; sys.exit(sys.version_info[:3] != (3,11,14))'
[[ -n "${RUNNER_TEMP:-}" && -d "$RUNNER_TEMP" && ! -L "$RUNNER_TEMP" ]] || {
  echo 'Use a private runner temporary directory.' >&2; exit 1;
}
runtime_dir="$RUNNER_TEMP/jamm-tip-speech-runtime"
export HF_HUB_CACHE="${HF_HUB_CACHE:-${HF_HOME:-$HOME/.cache/huggingface}/hub}"
if [[ "$1" == --install ]]; then
  python -I scripts/install_tip_ffmpeg.py
  # Each workflow uses a fresh private venv. No global/user Python is mutated.
  [[ ! -e "$runtime_dir" && ! -L "$runtime_dir" ]] || {
    echo 'Refusing to replace an existing runner speech environment.' >&2; exit 1;
  }
  python -I -m venv "$runtime_dir"
  "$runtime_dir/bin/python" -I -m pip --isolated install --disable-pip-version-check \
    --require-hashes --only-binary=:all: -r scripts/tip-runtime-linux-py311.txt
  "$runtime_dir/bin/python" -I -m pip --isolated check
  "$runtime_dir/bin/python" -I -c 'import json; from huggingface_hub import snapshot_download; a=json.load(open("scripts/tip-runtime-lock.json"))["asr"]; snapshot_download(repo_id=a["repository"],revision=a["revision"])'
fi
export TIP_SOURCE_PYTHON="$runtime_dir/bin/python"
export PATH="$runtime_dir/bin:$PATH"
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONNOUSERSITE=1
node scripts/tip-runtime.mjs measure
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'TIP_SOURCE_PYTHON=%s\nHF_HUB_CACHE=%s\nHF_HUB_OFFLINE=1\nTRANSFORMERS_OFFLINE=1\nPYTHONNOUSERSITE=1\n' "$TIP_SOURCE_PYTHON" "$HF_HUB_CACHE" >> "$GITHUB_ENV"
  # setup-python's original interpreter remains visible, after this private venv.
  printf '%s\n' "$runtime_dir/bin" >> "$GITHUB_PATH"
fi
