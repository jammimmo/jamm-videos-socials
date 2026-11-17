#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# == 1 && "$1" == /* && -d "$1" && ! -e "$1/receipt.json" ]]
output=$1
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
expected=${TIP_PARITY_EXPECTED_SHA:-}
[[ "$expected" =~ ^[a-f0-9]{40}$ && "$(git rev-parse --verify HEAD)" == "$expected" ]]
[[ -z "$(git status --porcelain --untracked-files=normal)" && "$(uname -sm)" == 'Linux x86_64' ]]
[[ $(node --version) == v22.20.0 && $(npm --version) == 10.9.3 ]]
for tool in ffmpeg ip unshare; do command -v "$tool" >/dev/null; done
scratch=$(mktemp -d "$RUNNER_TEMP/tip-codec.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
mkdir "$scratch/home" "$scratch/media"
clean=(env -i "PATH=$PATH" "HOME=$scratch/home" "TMPDIR=$scratch" LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC npm_config_globalconfig=/dev/null)
"${clean[@]}" npm ci --ignore-scripts --no-audit --no-fund
host_uid=$(id -u)
[[ "$host_uid" -ne 0 ]]
host_network=$(readlink /proc/self/ns/net)
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
isolation_mode=rootless
network_namespace=(unshare --user --map-root-user --net --)
isolated_identity=()
if ! run_isolated true 2>/dev/null; then
  isolation_mode=sudo
  network_namespace=(sudo -n unshare --net --)
  isolated_identity=(runuser -u "$(id -un)" --)
  run_isolated true
fi
printf 'JPEG oracle network isolation: %s\n' "$isolation_mode"
run_isolated "${clean[@]}" "TIP_PARITY_EXPECTED_SHA=$expected" node scripts/diagnose-tip-jpeg-preencoder.mjs "$scratch/media/receipt.json"
git diff --exit-code HEAD --quiet --
cp -- "$scratch/media/receipt.json" "$output/receipt.json"
# Trap removes temporary fixture copies. Only the numeric receipt leaves this wrapper.
