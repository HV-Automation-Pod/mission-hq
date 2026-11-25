import "server-only";
import { createClient } from "@supabase/supabase-js";

function buildClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "mission-hq" },
  });
}

let cached: ReturnType<typeof buildClient> = null;
let attempted = false;

export function getSupabaseAdmin() {
  if (!attempted) {
    cached = buildClient();
    attempted = true;
  }
  return cached;
}
