#!/usr/bin/env bash
# Starts the mortgage calculator dev server in the background.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

PORT="${PORT:-5173}"
PID_FILE=".dev-server.pid"
LOG_FILE=".dev-server.log"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Dev server already running (PID $(cat "$PID_FILE"))."
  exit 0
fi

echo "Starting dev server on port $PORT..."
# setsid makes this its own process group leader, so stop.sh can kill the
# whole group -- otherwise killing this PID leaves the child vite process
# (npm's actual server) orphaned and still listening.
setsid nohup npm run dev -- --port "$PORT" > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Wait for the server to come up.
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT"; then
    echo "Dev server is up: http://localhost:$PORT (PID $(cat "$PID_FILE"))"
    exit 0
  fi
  sleep 0.5
done

echo "Dev server did not respond in time. Check $LOG_FILE." >&2
exit 1
