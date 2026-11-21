#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 3 || "$1" != /* || "$2" != /* || "$3" != /* || -e "$2" || -L "$2" ]]; then
  printf '%s\n' 'Usage: bash capture-surface-repeat-linux.sh EXACT_CHECKOUT NEW_OUTPUT OFFICIAL_CHROMIUM' >&2
  exit 2
fi
[[ "$(uname -sm)" == 'Linux x86_64' && "$(id -u)" != 0 ]]
for tool in node git ip unshare timeout python3 ffmpeg ffprobe; do command -v "$tool" >/dev/null; done
[[ "$(node --version)" == v22.20.0 ]]
python_base=$(python3 -I -c 'import sys; print(sys.base_prefix)')
[[ "$python_base" == /* ]]
python_runtime=()
if [[ -d "$python_base/lib" ]]; then
  python_runtime=("LD_LIBRARY_PATH=$python_base/lib")
fi
repository=$1
output=$2
browser=$3
harness=$(cd -- "$(dirname -- "$0")" && pwd -P)
scratch=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jamm-v11-png-prefix.XXXXXXXX")
trap 'node -e "require(\"node:fs\").rmSync(process.argv[1], {recursive: true, force: true})" "$scratch"' EXIT
mkdir "$scratch/home" "$scratch/tmp"
host_uid=$(id -u)
host_network=$(readlink /proc/self/ns/net)

run_isolated() {
  "${namespace[@]}" bash -euo pipefail -c '
    if [[ "$1" == rootless ]]; then
      read -r mapped_uid owner_uid mapped_count < /proc/self/uid_map
      [[ "$mapped_uid" == 0 && "$owner_uid" == "$2" && "$mapped_count" == 1 ]]
    fi
    [[ "$(readlink /proc/self/ns/net)" != "$3" ]]
    shift 3
    ip link set lo up
    exec "$@"
  ' _ "$mode" "$host_uid" "$host_network" "${identity[@]}" "$@"
}

mode=rootless
namespace=(unshare --user --map-root-user --net --)
identity=()
if ! run_isolated true 2>/dev/null; then
  mode=sudo
  namespace=(sudo -n unshare --net --)
  identity=(runuser -u "$(id -un)" --)
  run_isolated true
fi
run_isolated env -i "PATH=$PATH" "HOME=$scratch/home" "TMPDIR=$scratch/tmp" \
  LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC OFFLINE_SMOKE_NETWORK_ISOLATED=1 \
  "${python_runtime[@]}" \
  timeout --kill-after=5s 180s node "$harness/capture-png-repeat.mjs" "$repository" "$output" "$browser"
