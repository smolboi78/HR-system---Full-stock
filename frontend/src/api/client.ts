// In local dev, Vite proxies "/api" to the backend (see vite.config.ts) so
// the relative path is enough. In production the frontend and backend are
// separate deploys - set VITE_API_BASE_URL (e.g. to the Railway backend's
// https://...up.railway.app URL, no trailing slash) at build time.
const BASE = import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/api` : "/api";

const TOKEN_STORAGE_KEY = "fullstock_token";

// Frontend and backend live on different origins/subdomains, so a cookie-
// based session is a third-party cookie - browsers increasingly block those
// by default. Using an explicit Bearer token instead sidesteps that
// entirely: it's just a header we attach ourselves, not cookie storage.
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, typeof body.detail === "string" ? body.detail : res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// For endpoints the browser needs to hit directly (file downloads, the
// ZenHR OAuth redirect) rather than through fetch - these can't carry our
// Authorization header, so the token goes as a query param instead. The
// backend accepts either form (see deps.py's get_current_user).
export function authedUrl(path: string): string {
  const token = getToken();
  const separator = path.includes("?") ? "&" : "?";
  return `${BASE}${path}${token ? `${separator}token=${encodeURIComponent(token)}` : ""}`;
}
