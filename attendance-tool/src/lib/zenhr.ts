import { prisma } from "./db";
import type { DateStr } from "./dates";

// ZenHR API v3 client - reads and the one write this tool makes.
//
// Auth: OAuth 2.0. authorization_code once via /admin/connect-zenhr, then
// refresh_token forever after. Rate limit is 15 req / 4s in production, so
// paginated reads pause briefly between pages.
//
// Endpoint shapes below were taken from ZenHR's published API collection
// (https://api-docs.zenhr.com). Worth knowing, because the spec assumed a
// single "accumulative attendance report": no such endpoint exists. What it
// describes is composed here from two reads - attendance_records (the clock
// data) and timeoff_transactions (the approved leave covering a day).

const PROTOCOL = process.env.ZENHR_PROTOCOL || "https";
const SCOPES =
  process.env.ZENHR_SCOPES ||
  "read:employee read:branch read:attendance_record read:timeoff write:timeoff";

function env(name: string): string {
  return process.env[name] || "";
}

function apiOrigin(): string {
  // e.g. "app.zenhr.com"
  return `${PROTOCOL}://${env("ZENHR_BASE_URL") || "app.zenhr.com"}`;
}

export function getAuthorizeUrl(state: string): string {
  const url = new URL(`${apiOrigin()}/oauth/authorize`);
  url.searchParams.set("client_id", env("ZENHR_CLIENT_ID"));
  url.searchParams.set("redirect_uri", env("ZENHR_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${apiOrigin()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(
      `ZenHR token request failed (${res.status}): ${await res.text().catch(() => "")}`
    );
  }
  return res.json();
}

async function saveToken(token: TokenResponse) {
  const data = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    scope: token.scope || SCOPES,
  };
  await prisma.zenhrOAuthToken.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });
}

export async function exchangeCodeForToken(code: string) {
  const token = await requestToken({
    grant_type: "authorization_code",
    code,
    client_id: env("ZENHR_CLIENT_ID"),
    client_secret: env("ZENHR_CLIENT_SECRET"),
    redirect_uri: env("ZENHR_REDIRECT_URI"),
  });
  await saveToken(token);
  return token;
}

const EXPIRY_BUFFER_MS = 60_000;

// How this tool authenticates to ZenHR, in the order it tries them. Set
// whichever your ZenHR account supports; no browser step is involved in any
// of them except OAUTH_REDIRECT.
//
//   API_KEY         ZENHR_API_KEY + ZENHR_API_SECRET, exchanged for a token
//                   through the client_credentials grant. This is the
//                   Integration Setup > API Keys route, where Read / Write /
//                   Update are ticked per key.
//   STATIC_TOKEN    ZENHR_ACCESS_TOKEN sent as-is. Simplest, but the token
//                   expires unless ZENHR_REFRESH_TOKEN is set too.
//   REFRESH_TOKEN   ZENHR_REFRESH_TOKEN from ZenHR's "Manage Tokens" screen,
//                   exchanged for access tokens indefinitely. Their docs call
//                   this renewing a token without Global Admin credentials.
//   OAUTH_REDIRECT  The one-time browser authorisation at
//                   /admin/connect-zenhr, refreshing itself afterwards.
//
// Note on permissions: what a credential may write is decided by its scopes
// (or the Read/Write/Update ticks on an API key), not by which of these was
// used to obtain it.
export type AuthMode = "API_KEY" | "STATIC_TOKEN" | "REFRESH_TOKEN" | "OAUTH_REDIRECT" | "NONE";

export function authMode(): AuthMode {
  if (env("ZENHR_API_KEY") && env("ZENHR_API_SECRET")) return "API_KEY";
  if (env("ZENHR_ACCESS_TOKEN")) return "STATIC_TOKEN";
  if (env("ZENHR_REFRESH_TOKEN")) return "REFRESH_TOKEN";
  return "OAUTH_REDIRECT";
}

// The header carrying the credential. ZenHR's published API takes
// "Authorization: Bearer <token>"; these two are configurable only so an
// account whose API keys work differently can be pointed at the right shape
// without a code change.
function authHeaders(token: string): Record<string, string> {
  const header = env("ZENHR_AUTH_HEADER") || "Authorization";
  const scheme = process.env.ZENHR_AUTH_SCHEME ?? "Bearer";
  return { [header]: scheme ? `${scheme} ${token}` : token };
}

// Tokens obtained from a key or refresh token are cached in the same row the
// OAuth flow uses, so a serverless invocation does not re-exchange on every
// request.
async function cachedToken(): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const stored = await prisma.zenhrOAuthToken.findUnique({ where: { id: "default" } });
  if (!stored) return null;
  return stored.expiresAt.getTime() - EXPIRY_BUFFER_MS > Date.now() ? stored : null;
}

async function accessToken(): Promise<string> {
  const mode = authMode();

  // A statically supplied token is used exactly as given.
  if (mode === "STATIC_TOKEN") return env("ZENHR_ACCESS_TOKEN");

  const cached = await cachedToken();
  if (cached) return cached.accessToken;

  if (mode === "API_KEY") {
    const token = await requestToken({
      grant_type: "client_credentials",
      client_id: env("ZENHR_API_KEY"),
      client_secret: env("ZENHR_API_SECRET"),
      ...(SCOPES ? { scope: SCOPES } : {}),
    });
    await saveToken(token);
    return token.access_token;
  }

  if (mode === "REFRESH_TOKEN") {
    const token = await requestToken({
      grant_type: "refresh_token",
      refresh_token: env("ZENHR_REFRESH_TOKEN"),
      client_id: env("ZENHR_CLIENT_ID"),
      client_secret: env("ZENHR_CLIENT_SECRET"),
    });
    await saveToken(token);
    return token.access_token;
  }

  const stored = await prisma.zenhrOAuthToken.findUnique({ where: { id: "default" } });
  if (!stored) {
    throw new Error(
      "ZenHR is not connected. Set ZENHR_API_KEY and ZENHR_API_SECRET (Integration Setup > " +
        "API Keys), or ZENHR_REFRESH_TOKEN (Manage Tokens), or authorise once at /admin/connect-zenhr."
    );
  }
  const refreshed = await requestToken({
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
    client_id: env("ZENHR_CLIENT_ID"),
    client_secret: env("ZENHR_CLIENT_SECRET"),
  });
  await saveToken(refreshed);
  return refreshed.access_token;
}

export async function isConnected(): Promise<boolean> {
  if (authMode() !== "OAUTH_REDIRECT") return true;
  return Boolean(await prisma.zenhrOAuthToken.findUnique({ where: { id: "default" } }));
}

// Calls ZenHR's who_am_i and reports what the credential actually is and what
// it is allowed to do. This is how we establish, from evidence rather than
// documentation, whether a given key carries write access.
export interface ConnectionTest {
  ok: boolean;
  mode: AuthMode;
  message: string;
  scopes?: string[];
  company?: string | number;
  canWriteTimeoff?: boolean;
}

export async function testConnection(): Promise<ConnectionTest> {
  const mode = authMode();
  try {
    const who = await apiGet<{
      token_info?: {
        scopes?: string[];
        props?: { company_id?: number; name?: string; branch_id?: number };
      };
    }>("/api/v3/who_am_i");

    const scopes = who.token_info?.scopes ?? [];
    // ZenHR has used both "write:timeoff" and "write.timeoff" spellings.
    const canWriteTimeoff = scopes.some((s) => /write[.:]timeoff/i.test(s));
    return {
      ok: true,
      mode,
      message: scopes.length
        ? `Connected. ZenHR reports these permissions: ${scopes.join(", ")}.`
        : "Connected, though ZenHR returned no scope list for this credential.",
      scopes,
      company: who.token_info?.props?.company_id,
      canWriteTimeoff,
    };
  } catch (err) {
    return { ok: false, mode, message: (err as Error).message };
  }
}

type Query = Record<string, string | number | undefined | (string | number)[]>;

function buildUrl(path: string, query: Query): string {
  const url = new URL(`${apiOrigin()}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function apiGet<T>(path: string, query: Query = {}): Promise<T> {
  const res = await fetch(buildUrl(path, query), {
    headers: authHeaders(await accessToken()),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `ZenHR GET ${path} failed (${res.status}): ${await res.text().catch(() => "")}`
    );
  }
  return res.json();
}

// The write endpoint takes multipart/form-data, not JSON - see
// "Create Timeoff Transaction Request" in ZenHR's collection.
async function apiPostForm<T>(path: string, fields: Record<string, string>): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);

  const res = await fetch(`${apiOrigin()}${path}`, {
    method: "POST",
    headers: authHeaders(await accessToken()),
    body: form,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`ZenHR POST ${path} failed (${res.status}): ${text}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ListResponse<T> {
  pagination: { current_page: number; per_page: number; total_entries: number; total_pages: number };
  data: T[];
}

async function fetchAllPages<T>(path: string, query: Query = {}, pageDelayMs = 300): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  while (true) {
    const resp = await apiGet<ListResponse<T>>(path, { ...query, page, limit: 200 });
    all.push(...(resp.data ?? []));
    const totalPages = resp.pagination?.total_pages ?? 1;
    if (page >= totalPages) break;
    page += 1;
    await sleep(pageDelayMs);
  }
  return all;
}

// ---------- Types (only the fields this tool reads) ----------

export interface ZenhrBranch {
  id: number;
  name: { en: string; ar: string } | string;
  timezone?: string;
  working_hours?: number;
  days_off?: string[];
}

export interface ZenhrEmployee {
  id: number;
  branch_id: number;
  employment_number: string;
  active: boolean;
  hiring_date: string | null;
  termination_date: string | null;
  user: {
    id: number;
    short_name?: { en?: string; ar?: string };
    name?: {
      en?: { first_name?: string; second_name?: string; third_name?: string; last_name?: string };
    };
  };
}

export function employeeNameEn(emp: ZenhrEmployee): string {
  if (emp.user?.short_name?.en) return emp.user.short_name.en;
  const n = emp.user?.name?.en;
  return [n?.first_name, n?.second_name, n?.third_name, n?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export interface ZenhrAttendanceRecord {
  id: number;
  employee: { id: number; employment_number: number | string | null };
  attendance_date: DateStr;
  entry_time: string | null;
  exit_time: string | null;
  first_in: string | null;
  last_out: string | null;
  work_shift_id: number | null;
  missing_status: string; // "complete" | "missing_out" | ...
  number_of_missings: number;
  suspicious: boolean;
}

export interface ZenhrTimeoffTransaction {
  id: number;
  employee: { id: number };
  timeoff: { id: number };
  from_date: string; // ISO datetime
  to_date: string;
  amount: number;
  notes: string;
  status: string; // "approved" | "pending" | "cancelled" | "withdrawn" | ...
  class_name: string;
}

export interface ZenhrTimeoff {
  id: number;
  name: { en: string; ar: string };
  class_name: string;
  accumulative: boolean;
}

export interface ZenhrEmployeeShift {
  id: number;
  employee: { id: number };
  work_shift: { id: number };
  from_date: string;
  to_date: string;
}

export interface ZenhrWorkShift {
  id: number;
  name: string;
  type: string;
  // Weekday names, lowercase, e.g. ["friday", "saturday"]. This is where an
  // employee's days off actually live - per shift, not per branch.
  days_off?: string[];
  from_time?: string;
  to_time?: string;
  // Note the singular key: ZenHR returns `work_shift_interval` in responses
  // even though the create/update body takes `work_shift_intervals_attributes`.
  work_shift_interval?: { from_time?: string; to_time?: string; required_hours?: number | null }[];
  // Per-weekday overrides of the shift's hours.
  work_exceptions?: { day?: string; from_time?: string; to_time?: string }[];
}

// ZenHR names days off; the engine works in Date#getUTCDay numbers.
const WEEKDAY_NUMBERS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function weekdayNumbers(dayNames: string[] | undefined): number[] {
  if (!dayNames) return [];
  return dayNames
    .map((d) => WEEKDAY_NUMBERS[d.trim().toLowerCase()])
    .filter((n): n is number => n !== undefined);
}

// A business mission is time recorded in ZenHR for someone who was working,
// not leave - so it must never read as "on leave" and never be deducted.
// Matched on ZenHR's class_name first, then on the leave type's name.
export function isBusinessMission(timeoff: ZenhrTimeoff): boolean {
  if (/businessmission|mission/i.test(timeoff.class_name ?? "")) return true;
  const name = `${timeoff.name?.en ?? ""} ${timeoff.name?.ar ?? ""}`.toLowerCase();
  return /business mission|mission|مأمورية|مهمة عمل/.test(name);
}

// ---------- Reads ----------

export function listBranches(): Promise<ZenhrBranch[]> {
  return fetchAllPages<ZenhrBranch>("/api/v3/branches");
}

export function listEmployees(branchId: number): Promise<ZenhrEmployee[]> {
  return fetchAllPages<ZenhrEmployee>(`/api/v3/branches/${branchId}/employees`);
}

export function listAttendanceRecords(
  branchId: number,
  from: DateStr,
  to: DateStr
): Promise<ZenhrAttendanceRecord[]> {
  return fetchAllPages<ZenhrAttendanceRecord>(`/api/v3/branches/${branchId}/attendance_records`, {
    "filter[attendance_date][from]": from,
    "filter[attendance_date][to]": to,
  });
}

// Any transaction that overlaps the window: it may have started before
// `from` (a week of annual leave spanning the range boundary) and still
// cover days inside it, so the filter is on to_date >= from.
export function listTimeoffTransactions(
  branchId: number,
  from: DateStr,
  to: DateStr
): Promise<ZenhrTimeoffTransaction[]> {
  return fetchAllPages<ZenhrTimeoffTransaction>(
    `/api/v3/branches/${branchId}/timeoff_transactions`,
    { "filter[to_date][from]": from, "filter[from_date][to]": to }
  );
}

export function listTimeoffs(branchId: number): Promise<ZenhrTimeoff[]> {
  return fetchAllPages<ZenhrTimeoff>(`/api/v3/branches/${branchId}/timeoffs`);
}

export function listEmployeeTimeoffTransactions(
  branchId: number,
  employeeId: number,
  from: DateStr,
  to: DateStr
): Promise<ZenhrTimeoffTransaction[]> {
  return fetchAllPages<ZenhrTimeoffTransaction>(
    `/api/v3/branches/${branchId}/employees/${employeeId}/timeoff_transactions`,
    { "filter[from_date][from]": from, "filter[from_date][to]": to }
  );
}

export function listEmployeeShifts(
  branchId: number,
  employeeId: number
): Promise<ZenhrEmployeeShift[]> {
  return fetchAllPages<ZenhrEmployeeShift>(
    `/api/v3/branches/${branchId}/employees/${employeeId}/employee_shifts`
  );
}

export function listWorkShifts(branchId: number): Promise<ZenhrWorkShift[]> {
  return fetchAllPages<ZenhrWorkShift>(`/api/v3/branches/${branchId}/work_shifts`, {
    "include[]": "work_shift.work_shift_intervals",
  });
}

// ---------- The one write ----------

export interface CreateTimeoffRequestInput {
  branchId: number;
  employeeId: number;
  timeoffId: number;
  fromDate: DateStr;
  toDate: DateStr;
  effectiveDate?: DateStr;
  notes?: string;
}

// POST /api/v3/branches/:branch_id/timeoff_transaction_requests
// Creates the leave transaction that carries the deduction. ZenHR returns
// the created transaction, whose id we keep as the receipt.
export async function createTimeoffTransactionRequest(
  input: CreateTimeoffRequestInput
): Promise<{ id?: number; status?: string; amount?: number }> {
  return apiPostForm(`/api/v3/branches/${input.branchId}/timeoff_transaction_requests`, {
    employee_id: String(input.employeeId),
    timeoff_id: String(input.timeoffId),
    from_date: input.fromDate,
    to_date: input.toDate,
    effective_date: input.effectiveDate ?? input.fromDate,
    notes: input.notes ?? "",
  });
}
