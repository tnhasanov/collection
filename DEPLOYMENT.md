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
