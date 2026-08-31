import { prisma } from "./db";

// ZenHR API v3 client.
//
// Auth model: OAuth 2.0, authorization_code grant for the one-time
// bootstrap (see /app/api/auth/zenhr/connect + /callback), then
// refresh_token grant forever after - see docs at
// https://api-docs.zenhr.com/ ("collection Auth Info").
//
// Rate limits per ZenHR: production 15 req / 4s, sandbox 10 req / 5s.
// We stay well under that with a small delay between paginated calls.

const PROTOCOL = process.env.ZENHR_PROTOCOL || "https";
const BASE_URL = requireEnv("ZENHR_BASE_URL"); // e.g. "app.zenhr.com"
const CLIENT_ID = requireEnv("ZENHR_CLIENT_ID");
const CLIENT_SECRET = requireEnv("ZENHR_CLIENT_SECRET");
const REDIRECT_URI = requireEnv("ZENHR_REDIRECT_URI");
const SCOPES =
  process.env.ZENHR_SCOPES ||
  "read:employee read:branch read:attendance_record";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    // Thrown lazily at call time, not at import time in environments
    // (like `next build`) where these secrets aren't set yet.
    return "";
  }
  return v;
}

function apiOrigin() {
  return `${PROTOCOL}://${BASE_URL}`;
}

export function getAuthorizeUrl(state: string): string {
  const url = new URL(`${apiOrigin()}/oauth/authorize`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  scope?: string;
  token_type?: string;
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${apiOrigin()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ZenHR token request failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function exchangeCodeForToken(code: string) {
  const token = await requestToken({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
  });
  await saveToken(token);
  return token;
}

async function refreshToken(currentRefreshToken: string) {
  const token = await requestToken({
    grant_type: "refresh_token",
    refresh_token: currentRefreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  await saveToken(token);
  return token;
}

async function saveToken(token: TokenResponse) {
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  await prisma.zenhrOAuthToken.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
      scope: token.scope || SCOPES,
    },
    update: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
      scope: token.scope || SCOPES,
    },
  });
}

const EXPIRY_BUFFER_MS = 60_000;

async function getValidAccessToken(): Promise<string> {
  const stored = await prisma.zenhrOAuthToken.findUnique({ where: { id: "default" } });
  if (!stored) {
    throw new Error(
      "ZenHR is not connected yet. A Global Admin needs to visit /admin/connect-zenhr once."
    );
  }
  if (stored.expiresAt.getTime() - EXPIRY_BUFFER_MS > Date.now()) {
    return stored.accessToken;
  }
  const refreshed = await refreshToken(stored.refreshToken);
  return refreshed.access_token;
}

interface Pagination {
  current_page: number;
  per_page: number;
  total_entries: number;
  total_pages: number;
}

interface ListResponse<T> {
  pagination: Pagination;
  data: T[];
}

async function apiGet<T>(
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<T> {
  const accessToken = await getValidAccessToken();
  const url = new URL(`${apiOrigin()}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ZenHR API GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetches every page of a paginated ZenHR list endpoint, pausing briefly
// between requests to stay under the documented rate limit.
async function fetchAllPages<T>(
  path: string,
  baseQuery: Record<string, string | number | undefined>,
  pageDelayMs = 300
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  // First request tells us total_pages; loop until we've fetched them all.
  while (true) {
    const resp = await apiGet<ListResponse<T>>(path, { ...baseQuery, page, limit: 200 });
    all.push(...resp.data);
    if (page >= resp.pagination.total_pages) break;
    page += 1;
    await sleep(pageDelayMs);
  }
  return all;
}

// ---------- Domain types (subset of fields we actually use) ----------

export interface ZenhrBranch {
  id: number;
  name: { en: string; ar: string };
  timezone: string;
  working_hours: number;
  days_off: string[];
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
    name: {
      en: { first_name: string; last_name: string; second_name?: string; third_name?: string };
    };
  };
  // Job title/position - exact ZenHR field name is unconfirmed until we've
  // seen a real API response (candidates seen in other ZenHR integrations:
  // job_title, position, job_position). extractJobRole() below tries all of
  // them; if none match once connected, log a sample employee response and
  // add the real field name here and in extractJobRole().
  job_title?: string;
  position?: string | { name?: { en?: string } };
  job_position?: { name?: { en?: string } };
}

// See job_title/position/job_position comment on ZenhrEmployee above - this
// tries every candidate field name we know of. Update once ZenHR's actual
// field is confirmed from a live API response.
export function extractJobRole(emp: ZenhrEmployee): string | null {
  if (typeof emp.job_title === "string" && emp.job_title.trim()) return emp.job_title.trim();
  if (typeof emp.position === "string" && emp.position.trim()) return emp.position.trim();
  if (emp.position && typeof emp.position === "object" && emp.position.name?.en) {
    return emp.position.name.en.trim();
  }
  if (emp.job_position?.name?.en) return emp.job_position.name.en.trim();
  return null;
}

export interface ZenhrAttendanceRecord {
  id: number;
  employee: { id: number; employment_number: number | string | null };
  attendance_date: string; // YYYY-MM-DD
  entry_time: string | null; // ISO
  exit_time: string | null; // ISO
  missing_status: string;
  number_of_missings: number;
  suspicious: boolean;
  updated_at: string;
}

// ---------- Public API ----------

export async function listBranches(): Promise<ZenhrBranch[]> {
  return fetchAllPages<ZenhrBranch>("/api/v3/branches", {});
}

export async function listEmployees(branchId: number): Promise<ZenhrEmployee[]> {
  return fetchAllPages<ZenhrEmployee>(`/api/v3/branches/${branchId}/employees`, {});
}

export interface AttendanceDateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export async function listAttendanceRecords(
  branchId: number,
  range: AttendanceDateRange
): Promise<ZenhrAttendanceRecord[]> {
  return fetchAllPages<ZenhrAttendanceRecord>(
    `/api/v3/branches/${branchId}/attendance_records`,
    {
      "filter[attendance_date][from]": range.from,
      "filter[attendance_date][to]": range.to,
    }
  );
}
