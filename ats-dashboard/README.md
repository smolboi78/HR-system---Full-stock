# Fullstock ATS dashboard

Per-job recruitment dashboard: Applied / Messaged, Interviewed, Shortlisted and Rejected counts, each clickable to list the candidates behind it, with interview scores and scorecard reports.

Same stack as `candidate-signoff-board/` (Express + `node:sqlite`, static frontend in `public/`) so the two can be merged later.

## Run

```
npm install
ATS_ADMIN_KEY=... ATS_VIEW_KEY=... node server.js
```

Environment variables:

| Variable | Purpose |
|---|---|
| `ATS_ADMIN_KEY` | Full access (HR) |
| `ATS_VIEW_KEY` | Read-only access (view link: `https://<host>/?key=<ATS_VIEW_KEY>`) |
| `DB_PATH` | SQLite file, defaults to `./data/ats.db` (on Railway: `/app/data/ats.db` on a volume) |

## API

Every `/api` route needs the `x-access-key` header. Writes need the admin key.

- `GET /api/data` jobs, candidates and evaluations in one payload (files excluded)
- `POST /api/jobs`, `PATCH /api/jobs/:id` fields: `title`, `department`, `location`, `hiringManager`, `dateOpened`, `status` (`open` | `on_hold` | `closed`), `archived`
- `POST /api/candidates`, `PATCH /api/candidates/:id` fields: `jobId`, `name`, `phone`, `email`, `source` (`applied` | `messaged`), `linkedinUrl`, `notes`, `stage` (`applied` | `interviewed` | `shortlisted` | `rejected_before` | `rejected_after`), `interviewDateTime`, `decision` (Hesham's decision, shown as the row comment), `primaryInterviewer` (whose scores show on the row, default `Hesham`), `cvFileName` + `cvBase64`, `reportFileName` + `reportBase64` (data URLs), `evaluations`, `archived`
- `PUT /api/candidates/:id/evaluations` body `{ "evaluations": [{ "interviewer", "sheet", "techScore", "techMax", "behScore", "behMax", "comment" }] }`
- `GET /api/candidates/:id/cv`, `GET /api/candidates/:id/report`

Columns: Interviewed = `interviewed` + `shortlisted` + `rejected_after`; Rejected = `rejected_before` + `rejected_after`.
