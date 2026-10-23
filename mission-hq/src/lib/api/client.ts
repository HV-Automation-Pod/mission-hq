/**
 * The browser's way of calling this app's own API routes.
 *
 * It knows the envelope the routes answer with (`lib/server/respond.ts`) and
 * turns every way a call can go wrong into one `ApiError` carrying a message a
 * person can read, so no caller has to inspect a status code or guess a shape:
 *
 *   - the network is down or the server is unreachable (status 0)
 *   - the server answered with something that is not our envelope
 *   - the server said no (401 signed out, 403 not allowed, 500 broke)
 */
export type ApiOk<T> = { ok: true; data: T };
export type ApiFail = { ok: false; error: string };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function apiGet<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  } catch {
    throw new ApiError("We could not reach the server. Check your connection and try again.", 0);
  }

  let body: ApiOk<T> | ApiFail;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(`The server sent something we could not read (HTTP ${res.status}).`, res.status);
  }

  if (!res.ok || !body.ok) {
    throw new ApiError("error" in body && body.error ? body.error : `The request failed (HTTP ${res.status}).`, res.status);
  }
  return body.data;
}
