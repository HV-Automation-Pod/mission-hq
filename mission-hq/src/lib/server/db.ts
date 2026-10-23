import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * The database, server-side only.
 *
 * `server-only` is the guard that matters: importing this from a client
 * component fails the BUILD rather than shipping a service-role key to the
 * browser. The key is read from SUPABASE_SERVICE_ROLE_KEY, deliberately not
 * NEXT_PUBLIC_*, so it cannot end up in the bundle by accident.
 *
 * The service role bypasses RLS, which is why the `mission-hq` schema can be
 * deny-all for everyone else: there is exactly one way in, and it runs here.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const db = url && key
  ? createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "mission-hq" },
    })
  : null;

export function requireDb() {
  if (!db) throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return db;
}

/** `public` schema, for the tables WeCare owns and MissionHQ only reads. */
export const publicDb = url && key
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
