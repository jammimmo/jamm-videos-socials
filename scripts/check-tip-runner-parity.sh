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

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir -- "$scratch/home"
clean=(env -i "PATH=$PATH" "HOME=$scratch/home" "TMPDIR=$scratch" LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC
  npm_config_globalconfig=/dev/null)
for tool in python ffmpeg ffprobe; do
  if ! command -v "$tool" >/dev/null; then
    echo "Missing required renderer tool: $tool" >&2
    exit 1
  fi
done
python_dir=$(dirname -- "$(command -v python)")
if [[ -d "$python_dir/../lib" ]]; then
  clean+=("LD_LIBRARY_PATH=$(cd -- "$python_dir/../lib" && pwd -P)")
fi
if [[ "$("${clean[@]}" node --version)" != v22.20.0 || "$("${clean[@]}" npm --version)" != 10.9.3 ]] \
  || ! "${clean[@]}" python -c 'import sys; sys.exit(sys.version_info[:2] != (3, 11))'; then
  echo 'Expected Node 22.20.0, npm 10.9.3 and Python 3.11.' >&2
  exit 1
fi
ffmpeg=$(command -v ffmpeg)
ffprobe=$(command -v ffprobe)

if [[ "$output" != --checks-only ]]; then
  if [[ -e "$output" || -L "$output" || ! -d "$(dirname -- "$output")" || "$(id -u)" -eq 0 ]]; then
    echo 'Use a non-root runner and an unused receipt path in an existing directory.' >&2
    exit 1
  fi
  sudo -n unshare --net -- true
fi

"${clean[@]}" npm ci --no-audit --no-fund
"${clean[@]}" npm run lint
"${clean[@]}" npm run test:dispatch
"${clean[@]}" python -m unittest discover -s scripts -p 'test_*align*.py'
"${clean[@]}" python -m unittest discover -s scripts -p 'test_audit_tip_v11*.py'
git diff --exit-code HEAD --quiet --

if [[ "$output" == --checks-only ]]; then
  exit 0
fi

"${clean[@]}" npm exec --offline -- remotion browser ensure
user=$(id -un)
sudo -n unshare --net -- bash -euo pipefail -c '
  ip link set lo up
  user=$1; fixture_log=$2; receipt=$3; expected=$4; ffmpeg=$5; ffprobe=$6
  shift 6
  exec runuser -u "$user" -- "$@" OFFLINE_SMOKE_NETWORK_ISOLATED=1 \
    bash -euo pipefail -c '\''
      node scripts/offline-tip-v11-smoke.mjs | tee "$1"
      node scripts/write-tip-runner-parity.mjs "$@"
    '\'' _ "$fixture_log" "$receipt" "$expected" "$ffmpeg" "$ffprobe"
' _ "$user" "$scratch/fixture.log" "$scratch/receipt.json" "$expected" "$ffmpeg" "$ffprobe" "${clean[@]}"
git diff --exit-code HEAD --quiet --
(set -o noclobber; cat -- "$scratch/receipt.json" >"$output")
