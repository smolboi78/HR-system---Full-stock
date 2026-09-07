# ZenHR + Bricks API endpoint mapping

Status of every endpoint the dashboard needs, current as of the ZenHR
Postman collection (`ZenHR_APIs_Documentation.postman_collection.json`,
provided directly) and the Bricks OpenAPI spec (`visitslistcount.openapi.json`,
also provided directly). Both are now source-of-truth references, not
guesses — see each section for what's confirmed vs. still open.

## 1. Employee master data — CONFIRMED

`GET /api/v3/branches/{branch_id}/employees` (paginated). Fields in use:
`id`, `branch_id`, `employment_number`, `active`, `hiring_date`,
`termination_date`, `user.name.en.{first_name,last_name}`.

**Job title, department, and manager are NOT on this endpoint** - they
live on a separate per-employee "professional data" record (#2 below).
Photo/avatar URL: not present on this endpoint either; not yet modeled.

## 2. Professional data (job title / department / manager) — CONFIRMED

`GET /api/v3/branches/{branch_id}/employees/{employee_id}/professional_data/active`
returns the employee's current record directly (no need to filter
`effective_on`/`expires_on` ourselves):

```json
{
  "position": { "id": 123, "name": "HR Manager" },
  "department": { "id": 584, "name": "HR Department" },
  "manager": { "id": 191211, "name": "123 123" },
  "site": { "id": 580, "name": "Amman123" },
  "section": { "id": null, "name": null },
  "project": { "id": 11102, "name": "Karam Department" },
  "hierarchy_group": { "id": 4618, "name": "Managers" }
}
```

`position.name` → `Employee.job_title`, `department.name` → `Employee.department`,
`manager.{name,id}` → `Employee.manager_name`/`manager_zenhr_id`.

**No branch-level bulk endpoint exists for this** - syncing it costs one
HTTP request per employee (`sync_professional_data()` in `services/sync.py`,
paced at ~3/s to stay under ZenHR's 15 req/4s limit). For an org with
hundreds of employees this step alone can take several minutes; that's
expected, not a bug.

## 3. Accumulative attendance report — CONFIRMED (endpoint), fields as coded

`GET /api/v3/branches/{branch_id}/attendance_records`, filterable by
`filter[attendance_date][from/to]`. Real shape:

```json
{
  "id": 1,
  "employee": { "id": 1152, "employment_number": 8 },
  "attendance_date": "2018-12-03",
  "entry_time": "2018-12-03T06:00:00.000Z",
  "exit_time": "2018-12-03T17:00:00.000Z",
  "missing_status": "complete",
  "number_of_missings": 0,
  "suspicious": false
}
```

Matches what `services/zenhr_client.py` already reads. `missing_status`
carries a status string ("complete" seen; the spec's business-mission/
personal-excuse/uncompleted-shift/unpaid-leave reasons presumably show up
as other values here) - we store it as-is in `AttendanceRecord.status`,
free-form, so new values need no schema change. Exact full set of
`missing_status` values not yet enumerated - will confirm once real
attendance data flows through.

## 4. Timeoff (vacation + leave, unified) — CONFIRMED

**This replaces the spec's separate "leave-by-hour" and "vacation-by-day"
concepts with what ZenHR actually has: one unified timeoff system.**

- `GET /api/v3/branches/{branch_id}/timeoffs` - the *types* of timeoff a
  company has configured (Annual Vacation, sick leave, personal excuse,
  etc.). Key fields: `id`, `name.en`, `class_name` (e.g. `"AnnualVacation"`
  marks the type(s) that are the spec's "vacation"; everything else is the
  spec's "leave"), `is_sick_vacation`. Synced into `TimeoffType`.
- `GET /api/v3/branches/{branch_id}/timeoff_transactions` - branch-level
  bulk list (no N+1), filterable by `filter[from_date][from/to]` /
  `filter[to_date][from/to]`. Shape:

  ```json
  {
    "id": 62918,
    "employee": { "id": 1159 },
    "timeoff": { "id": 816 },
    "from_date": "2018-10-08T00:00:00.000+03:00",
    "to_date": "2018-10-08T00:00:00.000+03:00",
    "amount": 1,
    "notes": "",
    "status": "cancelled"
  }
  ```

  Synced into a single `TimeoffTransaction` table (`timeoff_type_id` links
  back to `TimeoffType`); the profile UI's "Time off" tab shows all of it,
  with `is_vacation` (derived from `class_name == "AnnualVacation"`) used
  to distinguish vacation entries from other leave.

**Still unconfirmed: exact status string spellings.** The spec's
Approved / Added by HR (protected day off) vs. Pending / Withdrawn /
Rejected (not protected) distinction assumes specific strings; the only
values seen in the example data are `"cancelled"` and `"withdrawn"` (real
data, but a thin sample). `models.PROTECTED_TIMEOFF_STATUSES` currently
guesses `{"approved", "added_by_hr", "added by hr"}` - update once more
real status values are seen.

## 5. Vacation balance — NO ENDPOINT EXISTS

Checked every endpoint in ZenHR's 265-entry Postman collection - there is
**no vacation-balance endpoint**, live or otherwise (the closest is a
`timeoff_balance` field buried in payroll/salary transaction records, which
isn't a current, queryable balance). `Employee.vacation_balance_days` is
therefore **purely admin-maintained** - set once from whatever ZenHR's UI
shows, then kept current manually. There's no "sync" to fall out of date
with. (The originally-planned override-on-top-of-a-synced-value UI was
simplified away for this reason - see `PUT /employees/{id}/vacation-balance`.)

## 6. Shift assignment (per-employee working-day pattern) — CONFIRMED

Two branch-level bulk endpoints (no N+1):

- `GET /api/v3/branches/{branch_id}/work_shifts` - each shift's own
  definition, including `days_off`: an array of ZenHR weekday strings,
  `"0"` (Sunday) through `"6"` (Saturday) - e.g. `["5", "6"]` for a
  Friday/Saturday weekend (confirmed against real example data).
- `GET /api/v3/branches/{branch_id}/employee_shifts` - which `work_shift`
  applies to which `employee` for which `[from_date, to_date]` range.

`services/zenhr_client.zenhr_weekday_to_iso()` converts ZenHR's 0=Sunday
convention to the ISO weekday numbers (1=Monday..7=Sunday) used everywhere
else in the app. `sync_shifts()` picks whichever assignment currently
covers today's date (falling back to the most recent one) and sets
`Employee.off_weekdays` from that shift's `days_off`.

## 7. Bricks visit records — CONFIRMED

`POST /api/v1/visits/list` and `/api/v1/visits/count` against
`https://fullstock.bricks-rep.com`, `X-BRICKS-API-KEY` header auth, per the
official OpenAPI spec. `backend/app/services/bricks_client.py` matches it
exactly - request shape, response shape, and every field the sync code
reads off a `VisitResp`. No code changes needed.

## OAuth scopes — fixed, was wrong

A real `who_am_i` response's `token_info.scopes` confirmed ZenHR scopes use
**dots**, not colons: `read.branch`, `read.employee`, `read.professional_info`,
`read.timeoff`, `read.attendance_record`. The original client code requested
`read:employee read:branch read:attendance_record` (colons, and missing the
professional_info/timeoff scopes needed for #2 and #4 above) - fixed in
`zenhr_client.SCOPES`.

## What's still genuinely open

- Exact `missing_status` values beyond `"complete"` (attendance).
- Exact timeoff `status` values beyond `"cancelled"`/`"withdrawn"` (affects
  which count as a protected day off).
- Whether `professional_data` 404s for any employee who's never had one set
  (handled gracefully - `get_employee_active_professional_data` returns
  `None` and that employee just keeps whatever job title/department/manager
  they already had).

All three will confirm themselves the first time a real sync runs - no
further blocker to that beyond completing the ZenHR OAuth connect flow.
