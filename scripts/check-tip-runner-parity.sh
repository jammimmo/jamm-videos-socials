#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 || ( "$1" != --checks-only && "$1" != /* ) ]]; then
  echo 'Usage: TIP_PARITY_EXPECTED_SHA=<commit> bash scripts/check-tip-runner-parity.sh <absolute receipt path|--checks-only>' >&2
  exit 2
fi

output=$1
expected=${TIP_PARITY_EXPECTED_SHA:-}
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ ! "$expected" =~ ^[a-f0-9]{40}$ || "$(git rev-parse --verify HEAD)" != "$expected" \
  || -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo 'Expected an exact renderer commit in a clean checkout.' >&2
  exit 1
fi
if [[ "$(uname -sm)" != 'Linux x86_64' ]]; then
  echo 'Renderer parity requires Linux x86_64.' >&2
  exit 1
fi

# The real hosted and mini-PC fixture prepares the same speech runtime as the
# source/render workflows. Source-only unit checks need no ASR model download.
if [[ "$output" != --checks-only ]]; then
  source scripts/prepare-tip-runtime.sh --install
fi

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir -- "$scratch/home"
clean=(env -i "PATH=$PATH" "HOME=$scratch/home" "TMPDIR=$scratch" LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC
  npm_config_globalconfig=/dev/null)
if [[ "$output" != --checks-only ]]; then
  clean+=("TIP_SOURCE_PYTHON=$TIP_SOURCE_PYTHON" "HF_HUB_CACHE=$HF_HUB_CACHE"
    HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONNOUSERSITE=1)
fi
for tool in python ffmpeg ffprobe; do
  if ! command -v "$tool" >/dev/null; then
    echo "Missing required renderer tool: $tool" >&2
    exit 1
  fi
done
python_base=$(python -I -c 'import sys; print(sys.base_prefix)')
if [[ -d "$python_base/lib" ]]; then
  clean+=("LD_LIBRARY_PATH=$python_base/lib")
fi
if [[ "$("${clean[@]}" node --version)" != v22.20.0 || "$("${clean[@]}" npm --version)" != 10.9.3 ]] \
  || ! "${clean[@]}" python -c 'import sys; sys.exit(sys.version_info[:3] != (3, 11, 14))'; then
  echo 'Expected Node 22.20.0, npm 10.9.3 and Python 3.11.14.' >&2
  exit 1
fi
ffmpeg=$(command -v ffmpeg)
ffprobe=$(command -v ffprobe)

run_isolated() {
  "${network_namespace[@]}" bash -euo pipefail -c '
    if [[ "$1" == rootless ]]; then
      read -r mapped_uid owner_uid mapped_count < /proc/self/uid_map
      [[ "$mapped_uid" == 0 && "$owner_uid" == "$2" && "$mapped_count" == 1 ]]
    fi
    [[ "$(readlink /proc/self/ns/net)" != "$3" ]]
    shift 3
    ip link set lo up
    exec "$@"
  ' _ "$isolation_mode" "$host_uid" "$host_network" "${isolated_identity[@]}" "$@"
}

if [[ "$output" != --checks-only ]]; then
  host_uid=$(id -u)
  if [[ -e "$output" || -L "$output" || ! -d "$(dirname -- "$output")" || "$host_uid" -eq 0 ]]; then
    echo 'Use a non-root runner and an unused receipt path in an existing directory.' >&2
    exit 1
  fi
  host_network=$(readlink /proc/self/ns/net)
  isolation_mode=rootless
  network_namespace=(unshare --user --map-root-user --net --)
  isolated_identity=()
  if ! run_isolated true 2>/dev/null; then
    isolation_mode=sudo
    network_namespace=(sudo -n unshare --net --)
    isolated_identity=(runuser -u "$(id -un)" --)
    run_isolated true
  fi
  printf 'Renderer parity network isolation: %s\n' "$isolation_mode"
fi

"${clean[@]}" npm ci --no-audit --no-fund
"${clean[@]}" npm run lint
"${clean[@]}" npm run test:dispatch
"${clean[@]}" node --test scripts/tip-decoded-media-fingerprint.test.mjs
"${clean[@]}" python -m unittest discover -s scripts -p 'test_*align*.py'
"${clean[@]}" python -m unittest discover -s scripts -p 'test_audit_tip_v11*.py'
git diff --exit-code HEAD --quiet --

if [[ "$output" == --checks-only ]]; then
  exit 0
fi

"${clean[@]}" npm exec --offline -- remotion browser ensure
run_isolated "${clean[@]}" OFFLINE_SMOKE_NETWORK_ISOLATED=1 bash -euo pipefail -c '
  node scripts/offline-tip-v11-smoke.mjs | tee "$1"
  node scripts/write-tip-runner-parity.mjs "$@"
' _ "$scratch/fixture.log" "$scratch/receipt.json" "$expected" "$ffmpeg" "$ffprobe"
git diff --exit-code HEAD --quiet --
(set -o noclobber; cat -- "$scratch/receipt.json" >"$output")
