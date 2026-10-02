// PostgREST access for every MissionHQ function.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// The service role bypasses RLS, which is why `mission-hq` is deny-all for
// everyone else.
//
// `Accept-Profile` / `Content-Profile` select the non-`public` schema and are
// not optional. The schema must also be listed under Settings -> API -> Exposed
// schemas, and `service_role` must hold table grants — a custom schema inherits
// neither from `public`. Missing the first gives a 404, the second a 42501, and
// neither error mentions schemas.
export const PG_SCHEMA = "mission-hq";

export async function pg(path: string, init: RequestInit & { profile?: string } = {}) {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");

  const write = (init.method || "GET") !== "GET";
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      [write ? "content-profile" : "accept-profile"]: init.profile || PG_SCHEMA,
      ...(init.headers || {}),
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`postgrest ${init.method || "GET"} ${path} -> ${response.status} ${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : null;
}

/** Today in IST, as yyyy-MM-dd. Everything here is an Indian working day. */
export function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
