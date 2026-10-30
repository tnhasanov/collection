# Hosting the demo (MVP preview with a permanent address)

Everything here keeps the demo exactly as it is: synthetic data, mock dialer, local outbound log, no bank connection.
The same Docker image (`Dockerfile` + `scripts/start-all.sh`) runs migrations, seeds the demo when the database is
empty, and starts the background worker and the web app together. Any host that runs a container and provides a
PostgreSQL 16 connection string works.

| Option | Best for | Cost (check the provider's current pricing) | Notes |
|---|---|---|---|
| **GitHub Codespaces** (already set up) | Trying it yourself, short demos | Free quota (about 60 h/month) | Stops when idle; link needs the Ports tab or public visibility |
| **Render** (`render.yaml` included) | One-click permanent address | Free web + free database, or about 7 USD/month each for always-on | Free web service sleeps after 15 min idle (first request takes ~1 min); free database has a limited lifetime |
| **Railway** | Simplest always-on MVP | Hobby plan, about 5 USD/month of usage included | Detects the Dockerfile; PostgreSQL added with one click; no sleeping |
| **Fly.io** | Teams already using it | Pay as you go | Needs the `flyctl` CLI; a card on file |

Recommendation for an MVP that colleagues open over several weeks: **Railway** (nothing sleeps, one project holds
the database and the app). For a free, temporary preview: **Render** with the blueprint below.

## Render (blueprint)

1. Push the branch you want to host (the blueprint deploys what is in the repository).
2. In the Render dashboard choose **New → Blueprint**, connect the GitHub repository, pick the branch, keep the name
   `atb-collections` and click **Apply**. Render creates the PostgreSQL database and the web service from `render.yaml`.
3. The first deploy builds the image (about 5 to 8 minutes), applies the migrations, seeds the synthetic data and
   starts the worker and the web app. The service URL is `https://atb-collections.onrender.com` (or a suffixed
   variant); open `/login` and sign in with a demo identity and the password `demo1234`.
4. Every push to the branch redeploys automatically (`autoDeploy: true`); data in the database is kept.

Limits of the free plans: the web service sleeps after about 15 minutes without traffic and wakes on the next request
(up to a minute), which also pauses the worker while asleep; the free database is deleted after Render's free period
unless upgraded. For an always-on demo set `plan: starter` on the service and `plan: basic-256mb` on the database in
`render.yaml` before applying.

## Railway

1. Create a project, choose **Deploy from GitHub repo**, select the repository and branch. Railway detects the
   `Dockerfile`.
2. Add **PostgreSQL** to the project (New → Database → PostgreSQL).
3. On the app service open **Variables** and add: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference to the
   database), `SESSION_SECRET` = any long random string, `APP_MODE` = `DEMO`, `DEMO_CLOCK_MODE` = `offset`,
   `PGBOSS_SCHEMA` = `pgboss`, and the five `CONNECTOR_*` values from `.env.example` (`mock`, `local-demo`).
4. Under **Settings → Networking** generate a public domain. The first deploy migrates, seeds and starts both
   processes; sign in at `/login`.

## Operating the hosted demo

- Reset the demo data: connect to the database and drop the schemas, or temporarily run `npm run db:reset` from a
  shell on the host (Render Shell, Railway CLI). The next boot reseeds automatically because the seed only runs on an
  empty database.
- Logs: both processes write to the container log; look for `[boot]` lines, `[worker] … started` and `Ready`.
- The demo identities and the payment simulator exist only while `APP_MODE=DEMO`; `INTEGRATION` mode disables them
  and requires the real adapters, which do not exist yet.
- Do not put real customer data into the hosted demo: the demo logins are shared and the connectors are mocks.

## Running a controlled pilot (PILOT mode)

PILOT keeps synthetic data and mock integrations but replaces the shared demo logins with **individual tester
identities**: no shared password, no role switching, a personal password set at first sign-in, sign-in attempts rate
limited per IP and per username, every action attributed to the tester. Nothing real is connected.

1. Set `APP_MODE=PILOT` on the service (the committed `render.yaml` already does; keep the `CONNECTOR_*` mocks and a
   strong `SESSION_SECRET`). PILOT runs on the real clock (the demo offset applies to DEMO only); the worker's
   catch-up ages the synthetic portfolio to the current Baku business date at the first start.
2. Tester identities come from `pilot-users.json` in the repository (seven roles by default: two agents, a senior
   agent, a team lead, a head, an integration operator, an administrator). At every boot `scripts/start-all.sh`
   creates the ones that do not exist yet (`npm run pilot:users -- --if-missing pilot-users.json`); existing
   passwords are never reset. The **one-time temporary passwords of newly created testers are printed once in the
   deploy log** (Render → the service → Logs, block "One-time temporary passwords"); copy them from there and hand them
   over privately. Each tester must set a personal password at first sign-in. To add testers later, extend the JSON
   file and redeploy, or run the script from a shell on the host. For a different file set `PILOT_USERS_FILE`.
3. The shared demo identities are deactivated automatically at boot in PILOT mode (their history stays; the sign-in
   page warns while any shared identity is still active). To do it by hand: `npm run pilot:users -- --disable-demo-identities`.
4. The payment simulator (`/payments`) stays available to `payment.simulate` roles so testers can post synthetic
   payments against any active loan; the "L-DEMO-001" and every other loan are searchable there.
5. Reference data that an existing database needs for the pilot features (payment-instruction SMS templates,
   related persons) is applied idempotently at every boot by `scripts/start-all.sh` (`npm run db:seed:pilot`).

The sign-in rate limiter is in-memory per web instance; with more than one web instance move it to a shared store
(PostgreSQL or Redis) before widening the pilot.

## Health checks, background jobs and backups

- **Health**: `GET /api/health/live` always answers 200 while the process runs (restart signal for the host);
  `GET /api/health/ready` answers 200 only when PostgreSQL is reachable and every migration is applied (503
  otherwise) and reports the worker heartbeat (`checks.worker.online`, last catch-up, provider capabilities). The
  blueprint's `healthCheckPath` points at `/api/health/ready`. Both routes are public.
- **Plans**: the blueprint uses `starter` for the web service and `basic-256mb` for the database (always on; data
  kept). Both are paid plans (check Render's current prices, roughly 7 USD/month each); set both back to `free` in
  `render.yaml` and sync the blueprint for a cost-free demo that sleeps when idle.
- **Worker**: one process (`src/worker/main.ts`) owns the dialer adapter and runs the durable jobs on pg-boss:
  outbox dispatch (1 s), allocation (2 s), maintenance (15 s), promise maturation / reminders / provider
  reconciliation (every minute), mock source refresh and daily aging (every 2 min), SMS campaigns (5 min), daily
  decision run (05:00 Asia/Baku). On start it hydrates the provider view from persisted facts and runs an idempotent
  catch-up (aging for the current business date, attribution backfill, promise maturation, due work, reconciliation,
  reminders, and the day's decision run if missing after 05:00). It can be restarted at any time: nothing is lost,
  nothing runs twice. The worker heartbeat (`WorkerHeartbeat`) is what the topbar, operations screen and readiness
  check read.
- **Multi-day pilot on Render**: the free web plan sleeps and pauses the worker; use an always-on plan (`starter`) for
  a pilot that spans days, otherwise reminders and aging run only while a request keeps the service awake (the
  catch-up then does the missed work at wake-up).
- **Migrations**: `prisma migrate deploy` runs at every boot before the processes start; migrations are additive
  (new tables/columns/enum values) and safe to apply on a database with pilot history.
- **Backups**: enable the database provider's automated backups (Render: Postgres backups on paid plans; Railway:
  volume snapshots) and take a manual dump before each deploy during the pilot:
  `pg_dump "$DATABASE_URL" --format=custom --file=atb-pilot-$(date +%F).dump`. Restore with `pg_restore --clean
  --if-exists --dbname "$DATABASE_URL" <file>`. Synthetic data only; never load a production dump into the pilot.
- **Secrets**: `.env.example` carries no secrets; set `SESSION_SECRET` and `DATABASE_URL` in the host's environment.
