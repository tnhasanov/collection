#!/usr/bin/env bash
# Runs every time the dev container starts: web app on port 3000 and the background worker (required for dialing,
# wrap-ups, outbox, SMS log and decisions). Logs: /tmp/atb/web.log and /tmp/atb/worker.log.
cd "$(dirname "$0")/.."
mkdir -p /tmp/atb

if ! pgrep -f "next (start|dev)" >/dev/null 2>&1; then
  if [ -f .next/BUILD_ID ]; then
    nohup npm start > /tmp/atb/web.log 2>&1 &
    echo "[start] web app (production build) starting on http://localhost:3000"
  else
    nohup npm run dev > /tmp/atb/web.log 2>&1 &
    echo "[start] web app (dev mode) starting on http://localhost:3000"
  fi
fi

if ! pgrep -f "src/worker/main.ts" >/dev/null 2>&1; then
  nohup npm run worker > /tmp/atb/worker.log 2>&1 &
  echo "[start] worker starting"
fi

echo "[start] sign in with any demo identity (for example agent.a or lead) and the password demo1234"
