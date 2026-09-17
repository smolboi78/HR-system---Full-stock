# Full Stock — Attendance & Deduction Tool

A standalone daily-use tool for reconciling attendance and applying deductions. It pulls ZenHR and
Bricks live, auto-resolves the obvious days, surfaces only genuine exceptions, and writes the
deduction straight back to ZenHR — no exports, no import file, no manual upload.

Separate from the live HR/performance dashboard in the repository root: its own app, own database,
own deploy. The two may merge later; nothing here depends on that one.

## Running it

```bash
cp .env.example .env    # fill in the values
npm install
npx prisma migrate deploy
npm run seed            # roster, reason list, leave buckets
npm run dev             # http://localhost:3001
npm test                # the resolution engine's rules
```

First boot, in order:

1. Sign in with `APP_PASSWORD`.
2. **ZenHR connection** → authorise the integration once (OAuth; the tool refreshes its own token
   after that).
3. **Settings** → map each bucket (Emergency / Annual / Unpaid / Business Mission) onto the real
   ZenHR leave type, and set the yearly entitlements.
4. **Review** → pick a range and pull.

Step 3 matters: until a bucket is mapped, applying a deduction that draws on it fails with a message
saying so rather than writing something wrong.

## How a day gets decided

The engine (`src/lib/reconcile.ts`) is pure — no I/O — so the rules are testable on their own, and
`tests/reconcile.test.ts` covers each one. For every employee and every date in the range:

| Situation | Outcome |
|---|---|
| Approved time-off transaction covering the day | **On leave**, tagged with that leave type — never an absence, clock-in or not |
| Public holiday, or a weekly day off | **Day off** |
| Before hiring / after termination | **Not employed** |
| Clocked in and out | **Present**, with hours |
| Clocked in, never out | **Exception** → suggests Missing checkout (half day) |
| Clocked ≤ 1h, hours-tracked or delivery role | **Exception**, flagged irregular, reason left **blank** |
| No ZenHR record, presence-only or delivery role with a Bricks visit | **Present** via Bricks |
| No ZenHR record and no time-off transaction | **Exception** → suggests Full-day absence |
| Employee 211's uncovered gap | **Exception** → suggests Business mission (he files one whenever out) |
| On the roster, no ZenHR employee with that number | **Unmatched** — raised once per person, not per day, and never chargeable |

Two rules the code holds to deliberately:

- **A reference flag never drives a deduction.** A delivery agent with no Bricks visits on a day
  they were otherwise present stays *present*, with a red flag beside it.
- **An unresolvable day gets a blank reason, not a guess.** A 45-minute day could be a personal
  excuse, a mission, or a broken reader; the tool refuses to pick.

Tracking method comes from the job role: hours matter for management and warehouse; presence in
either system is enough for sales, collectors and support; delivery agents are judged on ZenHR
hours with Bricks alongside as a signal. Employees 101, 103 and 210 are excluded from all attendance
rules and produce no rows at all.

Bricks↔ZenHR name matching uses the fixed alias table on the roster only — no fuzzy matching, by
design. A Bricks name matching no alias is reported rather than guessed at.

## Applying

`Apply & next` writes one ZenHR time-off transaction for the day and advances to the next case.
Batch apply sends every ticked row in one call; each row succeeds or fails on its own and the
response says which. A reason whose bucket is "no deduction" is recorded as reviewed and writes
nothing.

Every applied day is stored in `AppliedDeduction`, unique on (employee, date). That row is what
stops a replayed or double-clicked Apply from charging the same day twice, and applied days drop out
of the next pull's queue.

## ZenHR endpoints this uses

Taken from ZenHR's published API collection (<https://api-docs.zenhr.com>), which also settles three
of the spec's open items:

| Purpose | Endpoint |
|---|---|
| Clock data | `GET /api/v3/branches/:branch/attendance_records` — `filter[attendance_date][from\|to]` |
| Approved leave covering a day | `GET /api/v3/branches/:branch/timeoff_transactions` |
| Leave types (for the bucket mapping) | `GET /api/v3/branches/:branch/timeoffs` |
| Shift assignment | `GET /api/v3/branches/:branch/employees/:id/employee_shifts` + `GET .../work_shifts` |
| Roster matching | `GET /api/v3/branches/:branch/employees` |
| **The write** | `POST /api/v3/branches/:branch/timeoff_transaction_requests` — `multipart/form-data`: `employee_id`, `timeoff_id`, `from_date`, `to_date`, `effective_date`, `notes` |

Resolved while building:

- **The write payload** is the form-data POST above, not JSON.
- **There is no single "accumulative attendance report" endpoint.** What the spec describes —
  attendance and time-off together, per employee per day — is composed here from
  `attendance_records` + `timeoff_transactions`. Same outcome, two reads.
- **Shifts and clock duration come from different places.** Duration is on the attendance record;
  the shift assignment needs its own per-employee call, which is why `?shifts=0` can skip it.
- **ZenHR's public API exposes no leave-balance endpoint.** Balances in the review pane are
  therefore derived: the entitlement set at Settings minus that leave type's approved transactions
  this calendar year. Keep the entitlements current, or the Emergency/Annual default will lean the
  wrong way. Statutory entitlement bookkeeping (the 6→7 day change) stays out of scope, as specified.

Still worth confirming with the business, as the spec flagged: that employee 211's
Business-Mission-covers-absence exception still holds.

## Deploying to Railway

Add a Postgres plugin, point the service at this subdirectory, and set the variables from
`.env.example`. `railway.json` builds with `npm ci && npm run build` and starts with `npm run start`,
which runs `prisma migrate deploy` and the seed before booting, so a fresh deploy comes up with the
roster already in place. `ZENHR_REDIRECT_URI` has to match the deployed domain, and the same URL
must be registered on the ZenHR OAuth application.

## Layout

```
src/lib/reconcile.ts   the rules, pure and tested
src/lib/pull.ts        ZenHR + Bricks + roster -> engine input
src/lib/apply.ts       reviewed row -> ZenHR transaction, with the double-charge guard
src/lib/zenhr.ts       API v3 client: OAuth, the reads, the one write
src/lib/bricks.ts      visits client
src/lib/roster-seed.ts the standing roster, roles and aliases as handed over
src/app/review/        the core UX: queue, detail pane, apply
src/app/roster/        editable roster
src/app/settings/      leave-type mapping, entitlements, reason list
```
