// Zoho People auth, shared by the leave sync and the attendance push.
//
// Refresh tokens do not expire, so there is nothing to persist and nothing to
// go stale. This deliberately does not cache the access token: one extra call
// per run is cheaper than the failure mode of a cached token that has been
// revoked, which presents as every subsequent call failing for no visible
// reason.
export async function zohoAccessToken(): Promise<string> {
  const base = Deno.env.get("MISSION_HQ_ZOHO_ACCOUNTS_URL") || "https://accounts.zoho.in";
  const params = new URLSearchParams({
    refresh_token: Deno.env.get("MISSION_HQ_ZOHO_REFRESH_TOKEN") || "",
    client_id: Deno.env.get("MISSION_HQ_ZOHO_CLIENT_ID") || "",
    client_secret: Deno.env.get("MISSION_HQ_ZOHO_CLIENT_SECRET") || "",
    grant_type: "refresh_token",
  });
  const response = await fetch(`${base}/oauth/v2/token?${params}`, { method: "POST" });
  const json = await response.json();
  if (!json.access_token) {
    throw new Error(`zoho token refresh failed: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.access_token;
}

export const zohoDomain = () =>
  Deno.env.get("MISSION_HQ_ZOHO_API_DOMAIN") || "https://people.zoho.in";
