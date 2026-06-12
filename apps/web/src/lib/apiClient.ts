/**
 * Thin typed fetch wrapper for portal and admin surfaces.
 *
 * Every call site goes through `apiGet` / `apiPost` / `apiPatch` — no raw
 * `fetch` is duplicated in components. Responses are JSON-parsed and typed by
 * the caller; non-2xx responses throw an `ApiError` carrying the normalized
 * server message.
 *
 * CSRF (double-submit, interoperates with the #77 wiring): the server sets a
 * readable `__Host-csrf-token` cookie on login. For mutating requests we echo
 * that value in the `X-CSRF-Token` header. GET requests need no token.
 *
 * Canonical docs: docs/prd.md §5.9 — Producer Payout Portal
 * Issues: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 *         feat: Finance Admin UI — data-gap / completeness review queue (#101)
 */

/** Error thrown for non-2xx responses, carrying status + normalized message + full parsed body. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Full parsed JSON response body (when the server returns JSON). */
    public readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Read a cookie value by name from document.cookie, or null when absent. */
function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('__Host-csrf-token');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

/** Typed GET against `/api<path>`. */
export const apiGet = <T>(path: string): Promise<T> => request<T>('GET', path);

/** Typed POST against `/api<path>` with a JSON body. */
export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  request<T>('POST', path, body);

/** Typed PATCH against `/api<path>` with a JSON body. */
export const apiPatch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>('PATCH', path, body);

/** Typed DELETE against `/api<path>`. */
export const apiDelete = <T>(path: string): Promise<T> => request<T>('DELETE', path);
