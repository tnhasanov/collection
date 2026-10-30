#!/usr/bin/env bash
# Container entrypoint for hosted demos: apply migrations, seed the synthetic demo if the database is empty, then run
# the background worker and the web app together. If either process dies the container exits so the host restarts it.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL is required}"
export PORT="${PORT:-3000}"

echo "[boot] applying migrations"
node node_modules/prisma/build/index.js migrate deploy

echo "[boot] seeding the synthetic demo (skipped when data already exists)"
node node_modules/tsx/dist/cli.mjs prisma/seed.ts

echo "[boot] applying idempotent pilot reference data (templates, related parties)"
node node_modules/tsx/dist/cli.mjs scripts/seed-pilot-reference.ts

if [ "${APP_MODE:-DEMO}" = "PILOT" ]; then
  # Individual tester identities from pilot-users.json: created only when missing (passwords are never reset here);
  # the one-time temporary passwords of newly created testers appear once in this log. Shared demo identities are
  # deactivated so nobody can sign in with the public demo password.
  echo "[boot] PILOT mode: provisioning tester identities that do not exist yet"
  node node_modules/tsx/dist/cli.mjs scripts/create-pilot-users.ts --if-missing "${PILOT_USERS_FILE:-pilot-users.json}"
  echo "[boot] PILOT mode: disabling shared demo identities"
  node node_modules/tsx/dist/cli.mjs scripts/create-pilot-users.ts --disable-demo-identities
fi

# Direct node processes (no npm/sh wrappers) so a TERM from the host reaches them immediately.
echo "[boot] starting the background worker"
node node_modules/tsx/dist/cli.mjs src/worker/main.ts &
WORKER=$!

echo "[boot] starting the web app on port ${PORT}"
node node_modules/next/dist/bin/next start -p "${PORT}" &
WEB=$!

stop() { kill "$WORKER" "$WEB" 2>/dev/null || true; wait "$WORKER" "$WEB" 2>/dev/null || true; }
trap 'stop; exit 0' TERM INT

wait -n "$WORKER" "$WEB"
echo "[boot] a process exited; stopping the container"
stop
exit 1
