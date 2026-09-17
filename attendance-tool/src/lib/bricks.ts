// BricksRep Visits API client. Visit data is a reference signal for
// delivery agents and a presence signal for sales/collectors - never a
// deduction driver on its own.

const BASE_URL = process.env.BRICKS_BASE_URL || "https://fullstock.bricks-rep.com";

function apiKey(): string {
  const key = process.env.BRICKS_API_KEY;
  if (!key) throw new Error("BRICKS_API_KEY is not set");
  return key;
}

export interface BricksVisit {
  id: string;
  status: string;
  is_planned: boolean;
  is_successful?: boolean;
  owner_id: string;
  owner: { id: string; name: string };
  visit_time: string; // ISO
  contact?: { name?: string };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BRICKS-API-KEY": apiKey() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Bricks POST ${path} failed (${res.status}): ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

const PAGE_SIZE = 500;

// Every visit in the window, paged until Bricks returns a short page.
export async function listVisits(fromISO: string, toISO: string): Promise<BricksVisit[]> {
  const all: BricksVisit[] = [];
  let offset = 0;
  while (true) {
    const resp = await post<{ visits: BricksVisit[] }>("/api/v1/visits/list", {
      filters: { created_from: fromISO, created_to: toISO, include_planned: false },
      pagination: { limit: PAGE_SIZE, offset },
      preloads: { contact: true },
      sort: { sort_key: "visit_time", sort_direction: "asc" },
    });
    const batch = resp.visits ?? [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export function isBricksConfigured(): boolean {
  return Boolean(process.env.BRICKS_API_KEY);
}
