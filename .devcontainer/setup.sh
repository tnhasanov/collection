#!/usr/bin/env bash
# One-time setup when the dev container is created: dependencies, database, seed, production build.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[setup] waiting for PostgreSQL (service 'postgres')"
for i in $(seq 1 90); do
  if (echo > /dev/tcp/postgres/5432) 2>/dev/null; then break; fi
  sleep 1
done

if [ ! -f .env ]; then
  # Same template as a local run; the database host is the compose service instead of localhost.
  sed 's#@localhost:5432#@postgres:5432#g' .env.example > .env
  echo "[setup] wrote .env from .env.example"
fi

echo "[setup] installing dependencies"
npm ci
npx prisma generate

echo "[setup] applying migrations and seeding the synthetic demo"
npm run db:migrate
npm run db:seed

echo "[setup] building the web app (production mode)"
npm run build

echo "[setup] done: the web app and the worker start automatically (see .devcontainer/start.sh)"
