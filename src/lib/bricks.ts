// BricksRep Visits API client.
// Spec: https://fullstock.bricks-rep.com (X-BRICKS-API-KEY header auth).
// Phase 2 (sales visits / performance) - not wired into the dashboard yet,
// scaffolded now since the API is already fully specified.

const BASE_URL = "https://fullstock.bricks-rep.com";

function apiKey(): string {
  const key = process.env.BRICKS_API_KEY;
  if (!key) throw new Error("BRICKS_API_KEY is not set");
  return key;
}

export interface VisitFilters {
  assignee_id?: string[];
  created_from?: string; // ISO date-time
  created_to?: string; // ISO date-time
  is_successful?: boolean;
  is_offline?: boolean;
  include_planned?: boolean;
}

export interface BricksVisit {
  id: string;
  serial_num: number;
  contact_id: string;
  status: string;
  is_planned: boolean;
  is_successful?: boolean;
  doubled: boolean;
  owner_id: string;
  owner: { id: string; name: string };
  mode: string;
  visit_time: string;
  duration?: number;
  planned_at?: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BRICKS-API-KEY": apiKey(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bricks API POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function listVisits(
  filters: VisitFilters,
  pagination: { limit?: number; offset?: number } = {}
): Promise<{ visits: BricksVisit[] }> {
  return post("/api/v1/visits/list", {
    filters,
    pagination,
    preloads: { contact: true },
    sort: { sort_key: "visit_time", sort_direction: "desc" },
  });
}

export async function countVisits(filters: VisitFilters): Promise<{ count: number }> {
  return post("/api/v1/visits/count", { filters });
}
