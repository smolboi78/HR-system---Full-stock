# Full Stock HR Performance Dashboard

A live HR performance dashboard for Full Stock (F&B, Egypt): an employee directory
as a card grid, with a full profile view per employee (attendance, hours/visits,
vacation balance, leave history). Data comes from ZenHR (attendance, leave,
vacation, employee/shift data) and Bricks (field sales visit tracking).

## Stack

- **Backend**: Python, FastAPI, SQLAlchemy + Alembic, Postgres.
- **Frontend**: React + TypeScript (Vite), Tailwind CSS, React Query, React Router.
- Two separate services/deploys (e.g. backend on Render/Railway/Fly, frontend on Vercel).

## Status

Directory, profile, auth (admin/view-only), settings (holidays, job-role/
department category rules, ZenHR↔Bricks name overrides, user management), and
downloadable reports (PDF/Excel, per-employee and joint) are built and verified
locally against seeded demo data. Employees pulled from ZenHR are existing
staff, not "new hires" - there's no manual confirmation gate. A synced
employee's category is assigned straight from the department/job-title rules
in Settings, and they show up immediately under their real department tab in
the directory; anyone whose title doesn't match a rule yet just needs a rule
added (or falls back to unassigned until one is).

**Not yet run against real data**: the ZenHR/Bricks sync itself. All endpoints
are now confirmed against ZenHR's own published Postman collection and
Bricks' OpenAPI spec (see `docs/api-endpoint-mapping.md`) - vacation balance
turned out to have no live-syncable source at all (no such ZenHR endpoint
exists), so it's admin-maintained by design, not a gap. What's left is
completing the ZenHR OAuth connect flow once and running a real sync to
shake out anything the sample data in the docs didn't cover (exact status
string spellings, mainly).

## Local development

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in DATABASE_URL at minimum
alembic upgrade head
python -m app.seed            # creates the first admin user + holidays + category rules
python -m app.seed_demo       # optional: fake employees/attendance/visits for local testing
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /api to localhost:8000
```

Log in with the `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `backend/.env`.

## Adding the CEO's account (or anyone else)

Once logged in as admin, go to **Settings → Users** and add them there (choose
Admin or View only). There's no separate invite flow — it's a simple email +
password account created directly by an admin.

## Syncing real data

ZenHR's OAuth handshake and every API call after it need outbound internet
access to `app.zenhr.com`. That doesn't work from a locked-down sandbox (see
`docs/api-endpoint-mapping.md`), so this only works once the backend is
actually deployed somewhere with normal internet access — see **Deploying
(Railway)** below. Once it's deployed:

1. Set `ZENHR_CLIENT_ID` / `ZENHR_CLIENT_SECRET` / `ZENHR_REDIRECT_URI` and
   `BRICKS_API_KEY` as environment variables on the deployed backend.
2. As an admin, click **Settings → Data sync → Connect ZenHR** once. It takes
   you to ZenHR to approve access, then redirects back to the dashboard.
3. Trigger a sync from **Settings → Data sync → Sync now**, or schedule
   `POST /api/sync/cron` (with `Authorization: Bearer $SYNC_CRON_SECRET`) on
   whatever cron your host provides.

First sync pulls employees, then their professional data (job title/
department/manager - one API call per employee, so this step is the slow
one for a large org), attendance, shift assignments, timeoff transactions,
and finally Bricks visits. See `docs/api-endpoint-mapping.md` for what each
step reads and the couple of things still unconfirmed (exact status-string
spellings).

## Deploying (Railway)

The backend is Docker-ready for Railway (`backend/Dockerfile`,
`backend/railway.toml`); WeasyPrint's system libraries are baked into the
image so PDF reports work in production too.

1. On [railway.app](https://railway.app), **New Project → Deploy from GitHub
   repo**, pick this repo.
2. On the service Railway creates, set **Settings → Root Directory** to
   `backend`. It'll detect the Dockerfile automatically.
3. **New → Database → Add PostgreSQL** in the same project — Railway injects
   `DATABASE_URL` into the backend service automatically (any `postgres://`
   or `postgresql://` scheme is normalized to the psycopg3 driver the app
   needs, no manual edit required).
4. On the backend service, set these variables:
   - `JWT_SECRET` — any long random string
   - `SYNC_CRON_SECRET` — any long random string (for the scheduled-sync endpoint)
   - `FRONTEND_ORIGIN` — wherever the frontend ends up (e.g. a Vercel URL);
     update this once you have it
   - `COOKIE_SECURE` = `true`, `COOKIE_SAMESITE` = `none` (needed because the
     frontend and backend are on different domains)
   - `ZENHR_CLIENT_ID`, `ZENHR_CLIENT_SECRET`, `ZENHR_BASE_URL` = `app.zenhr.com`
   - `ZENHR_REDIRECT_URI` = `https://<your-railway-domain>/api/sync/zenhr/callback`
     — **this must exactly match the redirect URI registered on the ZenHR
     OAuth application**, or ZenHR will reject the authorization request.
   - `BRICKS_API_KEY`
   - `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` — creates
     the first admin account on deploy (the container runs `app.seed`
     automatically on every start; safe to re-run)
5. Deploy. Railway gives the service a public `*.up.railway.app` domain —
   that's what `ZENHR_REDIRECT_URI` above needs to point at.
6. Deploy the frontend separately (Vercel is the simplest fit for a Vite app)
   with its `VITE`-time API base pointed at the Railway backend URL, or serve
   it from the same Railway project as a second service.
7. Once both are live, log in as the seeded admin and follow **Syncing real
   data** above.
