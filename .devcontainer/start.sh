#!/usr/bin/env bash
# Runs when the dev container starts and whenever the editor attaches: web app on port 3000 and the background worker
# (required for dialing, wrap-ups, outbox, SMS log and decisions). Safe to re-run: already running processes are kept.
# Logs: /tmp/atb/web.log and /tmp/atb/worker.log.
cd "$(dirname "$0")/.."
mkdir -p /tmp/atb

# setsid + closed stdin keep the processes alive after the lifecycle hook that launched them has finished.
launch() { setsid nohup "$@" < /dev/null >> "$LOG" 2>&1 & disown; }

if ! pgrep -f "next (start|dev)" > /dev/null 2>&1; then
  LOG=/tmp/atb/web.log
  if [ -f .next/BUILD_ID ]; then
    launch npm start
    echo "[start] web app (production build) starting on http://localhost:3000"
  else
    launch npm run dev
    echo "[start] web app (dev mode, no production build found) starting on http://localhost:3000"
  fi
else
  echo "[start] web app already running"
fi

if ! pgrep -f "src/worker/main.ts" > /dev/null 2>&1; then
  LOG=/tmp/atb/worker.log
  launch npm run worker
  echo "[start] worker starting"
else
  echo "[start] worker already running"
fi

echo "[start] open port 3000 from the Ports tab (globe icon); sign in with agent.a or lead and the password demo1234"
