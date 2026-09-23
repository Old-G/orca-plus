#!/usr/bin/env bash
# Snapshots the agent configs Orca+ shares with a stock Orca, to prove a launch left them alone.
#
#   scripts/orca-plus-shared-config-snapshot.sh save  <dir>   copy + hash them into <dir>
#   scripts/orca-plus-shared-config-snapshot.sh check <dir>   exit 1 and show a diff if any changed
#
# Restore by copying back from <dir>/files.
set -euo pipefail

mode=${1:-}
dir=${2:-}
if [ -z "$mode" ] || [ -z "$dir" ]; then
  sed -n 2,7p "$0" >&2
  exit 2
fi

shared=(.claude/settings.json .codex/config.toml .codex/hooks.json .orca)

hash_all() {
  (cd "$HOME" && for p in "${shared[@]}"; do
    [ -e "$p" ] && find "$p" -type f -print0 | xargs -0 shasum
  done) | sort -k2
}

case "$mode" in
  save)
    mkdir -p "$dir/files"
    (cd "$HOME" && for p in "${shared[@]}"; do
      [ -e "$p" ] && rsync -aR "$p" "$dir/files/"
    done)
    hash_all >"$dir/shared.sha"
    echo "orca-plus-shared-config-snapshot: saved $(wc -l <"$dir/shared.sha" | tr -d ' ') files to $dir"
    ;;
  check)
    if hash_all | diff "$dir/shared.sha" -; then
      echo "orca-plus-shared-config-snapshot: unchanged"
    else
      echo "orca-plus-shared-config-snapshot: CHANGED (backup in $dir/files)" >&2
      exit 1
    fi
    ;;
  *)
    echo "orca-plus-shared-config-snapshot: unknown mode $mode" >&2
    exit 2
    ;;
esac
