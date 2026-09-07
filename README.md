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

Directory, profile, auth (admin/view-only), settings (holidays, job-role category
rules, ZenHR↔Bricks name overrides, user management, new-hire confirmation), and
downloadable reports (PDF/Excel, per-employee and joint) are built and verified
locally against seeded demo data.

**Not yet live**: the ZenHR/Bricks sync. Employee list and the attendance-records
endpoint are carried over from an earlier build (job title field name is an
educated guess); leave-by-hour, vacation-by-day/balances, and per-employee shift
patterns have no confirmed ZenHR endpoint yet. See `docs/api-endpoint-mapping.md`
for exactly what's confirmed vs. still needed before the sync can run for real.

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

1. Set `ZENHR_CLIENT_ID` / `ZENHR_CLIENT_SECRET` / `ZENHR_REDIRECT_URI` and
   `BRICKS_API_KEY` in the backend's environment.
2. As an admin, visit `/api/sync/zenhr/connect` once to complete the ZenHR OAuth
   handshake (redirects back to `ZENHR_REDIRECT_URI`).
3. Trigger a sync from **Settings → Data sync → Sync now**, or schedule
   `POST /api/sync/cron` (with `Authorization: Bearer $SYNC_CRON_SECRET`) on
   whatever cron your host provides.

This will surface errors immediately for the two unconfirmed ZenHR endpoints
(leave-by-hour, vacation-by-day/balances) and the shift-pattern endpoint, which
currently raise `NotImplementedError` — see `docs/api-endpoint-mapping.md`.
