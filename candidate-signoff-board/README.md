# Candidate Sign-Off Board

Standalone Node/Express + SQLite app. Serves the static frontend from `public/`
and a small JSON API backed by a SQLite file.

## Run locally

```bash
cd candidate-signoff-board
npm install
npm start
```

Open http://localhost:3000

By default the SQLite file is created at `candidate-signoff-board/data/candidates.db`.
Override the location with the `DB_PATH` env var.

## API

- `GET /candidates` — list all candidates (no CV bytes, just a `hasCv` flag)
- `GET /candidates/:id/cv` — fetch the base64 CV for one candidate
- `POST /candidates` — create a candidate
- `PATCH /candidates/:id` — change status (`{ status: 'approved' | 'rejected' | 'pending', decisionComment }`)
- `DELETE /candidates/:id` — remove a candidate ("mark handled")

## Deploying to Railway

See the deployment steps in the project chat/README, or:

1. Push this folder to GitHub (as part of this repo or its own repo).
2. In Railway, create a new project from that GitHub repo, set the **root
   directory** to `candidate-signoff-board` if it's a subfolder of a bigger repo.
3. Add a **Volume** mounted at `/app/data` so the SQLite file survives restarts/deploys.
4. Set the env var `DB_PATH=/app/data/candidates.db`.
5. Set the env var `BOARD_ACCESS_KEY` to a long random string — this gates every
   `/candidates` route (see "Access control" below). Without it, the API refuses
   all requests.
6. Deploy — Railway auto-detects Node via Nixpacks and runs `npm start`.
7. Generate a public domain under Settings → Networking → Generate Domain.

## Access control

Every `/candidates` route (listing, CVs, scorecards, create/update/delete) requires
an `x-access-key` header matching the `BOARD_ACCESS_KEY` env var, or it returns 401.
`/health` and the static frontend are not gated, so the page itself always loads —
it's the key screen in the UI that prompts for the key before calling the API, and
stores it in the browser's `localStorage` so it only has to be entered once per
device. The key is never hardcoded or committed — set it only in Railway's
Variables tab (or a local `.env`, which is gitignored).
