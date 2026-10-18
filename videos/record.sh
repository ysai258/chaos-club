#!/usr/bin/env bash
# Film one demo, at most $VIDEO_SLOTS (default 3) at a time across all callers.
# Six phones per film is heavy; more than three films at once makes the
# recordings stutter.
#   videos/record.sh <game> <server-port> <web-port>
set -euo pipefail
game=$1; sport=$2; wport=$3
slots=${VIDEO_SLOTS:-3}
dir=$(cd "$(dirname "$0")" && pwd)
cd "$dir/.."
while true; do
  for i in $(seq 1 "$slots"); do
    exec {fd}>"$dir/.record-slot-$i.lock"
    if flock -n "$fd"; then
      echo "[record.sh] $game filming in slot $i"
      VIDEO_SERVER_PORT=$sport VIDEO_WEB_PORT=$wport npx playwright test -c videos/playwright.video.config.ts "$game"
      exit $?
    fi
    exec {fd}>&-
  done
  sleep 5
done
