#!/usr/bin/env bash
# Stops the mortgage calculator dev server started by start.sh.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

PID_FILE=".dev-server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No PID file found. Is the dev server running?"
  exit 0
fi

PID="$(cat "$PID_FILE")"

if kill -0 "$PID" 2>/dev/null; then
  # Negative PID targets the whole process group (see setsid in start.sh),
  # so the child vite process gets killed too, not just the npm wrapper.
  kill -- "-$PID" 2>/dev/null || kill "$PID"
  echo "Stopped dev server (PID $PID)."
else
  echo "No running process with PID $PID."
fi

rm -f "$PID_FILE"
