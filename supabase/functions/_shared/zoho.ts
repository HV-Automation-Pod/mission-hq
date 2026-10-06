// Zoho People auth, shared by the leave sync and the attendance push.
//
// THE ACCESS TOKEN IS CACHED, and it has to be.
//
// This used to refresh on every call, and the reasoning was explicitly "one
// extra call per run is cheaper than a stale token". That was true while there
// was one call per run: the 19:30 batch. Then the Slack submit handler began
// pushing each answer as it arrived, so a morning of 348 people became 348
// token refreshes, and Zoho's OAuth endpoint started answering:
//
//   "You have made too many requests continuously. Please try again after
//    some time." — Access Denied
//
// Which it is entitled to do. A refresh is not a free operation just because
// it is a small one, and the assumption that made skipping the cache safe was
// invalidated by a change somewhere else entirely.
//
// Cached in module scope, which survives between invocations while an isolate
// is warm and is simply re-fetched when it is not. Expiry comes from Zoho's
// own `expires_in`, minus a minute so a token cannot go stale mid-batch.
let cached: { token: string; expiresAt: number } | null = null;

export async function zohoAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const base = Deno.env.get("MISSION_HQ_ZOHO_ACCOUNTS_URL") || "https://accounts.zoho.in";
  const params = new URLSearchParams({
    refresh_token: Deno.env.get("MISSION_HQ_ZOHO_REFRESH_TOKEN") || "",
    client_id: Deno.env.get("MISSION_HQ_ZOHO_CLIENT_ID") || "",
    client_secret: Deno.env.get("MISSION_HQ_ZOHO_CLIENT_SECRET") || "",
    grant_type: "refresh_token",
  });
  // The credentials go in the BODY, not the query string.
  //
  // Zoho's own examples put them in the URL and it accepts both, but a query
  // string is the one part of a request that gets written down: access logs at
  // every hop, proxy logs, and anything that records a URL for debugging. A
  // client secret and a non-expiring refresh token are the two worst things to
  // leave there, and the refresh token is the one that does not rotate.
  const response = await fetch(`${base}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json = await response.json();
  if (!json.access_token) {
    // Do not cache a failure. The next caller should try again rather than
    // inherit this one's bad luck.
    throw new Error(`zoho token refresh failed: ${JSON.stringify(json).slice(0, 200)}`);
  }

  // `expires_in` is seconds and Zoho sends 3600. The minute of slack means a
  // token handed out at the edge of its life still outlives the batch using it.
  const ttlMs = (Number(json.expires_in) || 3600) * 1000;
  cached = { token: json.access_token, expiresAt: Date.now() + ttlMs - 60_000 };
  return json.access_token;
}

export const zohoDomain = () =>
  Deno.env.get("MISSION_HQ_ZOHO_API_DOMAIN") || "https://people.zoho.in";
