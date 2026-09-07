# ZenHR + Bricks API endpoint mapping

Status of each endpoint the rebuilt dashboard needs, as of 2026-09-07. This
covers the six endpoints called out for the directory/profile build:
employee list, accumulative attendance report, leave transactions, vacation
balances, shift patterns, and Bricks visit records.

**Why this file exists instead of code:** this session has no ZenHR/Bricks
credentials in its environment and no network egress to `api-docs.zenhr.com`
(blocked by the sandbox's egress proxy) or to the Bricks instance. The
existing client code in `src/lib/zenhr.ts` / `src/lib/bricks.ts` (from the
prior "phase 1" build) was itself written the same way — several fields are
flagged in comments as unconfirmed guesses, never validated against a real
response. Building the new leave/vacation/shift data model on more guesses
would very likely mean reworking the Prisma schema and sync logic once real
responses are seen, so this file separates **confirmed** (seen in a real
response or documented with certainty) from **assumed** (best guess, needs
verification) before that code gets written.

## 1. Employee list — ASSUMED, partially confirmed

`GET /api/v3/branches/{branch_id}/employees` (paginated), per
`src/lib/zenhr.ts`.

- Confirmed shape (from prior build): `id`, `branch_id`, `employment_number`,
  `active`, `hiring_date`, `termination_date`, `user.name.en.{first_name,last_name}`.
- **Unconfirmed: the job title / department field.** `extractJobRole()` tries
  three candidate field names (`job_title`, `position`, `job_position`) because
  the real one was never seen. This blocks auto-assigning metric type
  (Management / Sales & Collector / Delivery Agent) from job title, which the
  spec requires.
- Not yet modeled: department (spec says title *or* department can drive
  metric type), photo/avatar URL if ZenHR exposes one for the directory card.

## 2. Accumulative attendance report — NEEDS RE-CHECK

Currently implemented against `/api/v3/branches/{branch_id}/attendance_records`,
returning per-day `entry_time`/`exit_time`/`missing_status`/`number_of_missings`/
`suspicious`. This is ZenHR's raw attendance-records endpoint, not necessarily
the same as the **accumulative attendance report** the spec explicitly asks
for (business mission, personal excuse, uncompleted shift, unpaid leave, etc.
as distinct absence reasons — `missing_status` alone doesn't obviously carry
that granularity). Need to confirm whether ZenHR's API exposes the
accumulative report as its own endpoint/report export, or whether that detail
lives in `attendance_records` under a field not yet seen.

## 3. Leave-by-hour transactions — NOT IMPLEMENTED, NO ENDPOINT KNOWN

Nothing in the current codebase touches this. No endpoint path, filters, or
response shape known. Required for "leave transaction types should stay
extensible" and full leave/time-off history on the profile.

## 4. Vacation-by-day transactions + live balances — NOT IMPLEMENTED, NO ENDPOINT KNOWN

Nothing in the current codebase touches this. Need the transaction endpoint
(with `status` values — spec requires distinguishing Approved / Added by HR
[[count as protected day off]] vs Pending / Withdrawn / Rejected [[don't]])
and the live balance endpoint (which the spec also wants to support manual
override on top of).

## 5. Shift / working-day pattern per employee — NOT IMPLEMENTED, NO ENDPOINT KNOWN

Current schema only has `Branch.daysOff` (weekend at the branch level). The
spec explicitly wants each employee's actual working-day pattern from their
**ZenHR shift assignment**, not a per-branch or per-role default — that's a
different endpoint (shift/schedule assignment, likely per-employee or
per-employee-group) that hasn't been looked at yet.

## 6. Bricks visit records — CONFIRMED

`POST /api/v1/visits/list` and `/api/v1/visits/count` against
`https://fullstock.bricks-rep.com`, `X-BRICKS-API-KEY` header auth, per the
official OpenAPI spec (`visitslistcount.openapi.json`, provided directly).
`backend/app/services/bricks_client.py` matches it exactly: request shape
(`filters`/`pagination`/`preloads`/`sort` on list, `filters` on count),
response shape (`{visits: [...]}` / `{count: N}`), and every field the sync
code reads off a `VisitResp` - `id`, `owner_id`, `owner.name`, `contact_id`,
`contact.name` (via `preloads.contact`), `status`, `is_planned`,
`is_successful`, `visit_time`, `duration` (milliseconds) - all present with
matching types. No code changes needed.

Noted for later, not blocking: the spec doesn't show any delivery/route-
specific fields beyond the general visit fields above, so nothing extra to
pull in for Delivery Agents' "hours + visit count" metric right now.

## What would unblock this

Any one of the following would let me confirm the three unknown endpoints
(leave-by-hour, vacation-by-day/balances, shift pattern) and correct the two
partially-known ones (job title field, accumulative attendance report) before
the schema and sync/UI code gets written against them:

1. Add `ZENHR_CLIENT_ID` / `ZENHR_CLIENT_SECRET` (and complete the OAuth
   connect flow once) plus `BRICKS_API_KEY` as environment variables in this
   Claude Code environment's config, so the sync code can call the real APIs
   and I can inspect actual responses.
2. Paste in (or attach) the relevant pages of ZenHR's API docs
   (`api-docs.zenhr.com`) for these five report/endpoint types, and the
   Bricks OpenAPI spec — this session can't reach either domain itself
   (egress to `api-docs.zenhr.com` is proxy-blocked).
3. Paste a few sample JSON responses (redact any real employee PII) for each
   of: employee list, accumulative attendance report, a leave-by-hour
   transaction, a vacation-by-day transaction + balance, an employee's shift
   assignment, and a Bricks visit record.

Once one of those is available I'll finalize this mapping, update
`src/lib/zenhr.ts` / `src/lib/bricks.ts` accordingly, extend the Prisma
schema for leave/vacation/shift data, and move on to the card-grid directory
and profile views.
