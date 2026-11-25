import { createBrowserClient } from "@supabase/ssr";

/**
 * A short-lived copy of the last payloads, so a revisit paints at once and the
 * fresh data swaps in behind it.
 *
 * sessionStorage, not localStorage: it belongs to this tab and goes when the tab
 * does. Every entry is also stamped with the id of the user who fetched it, read
 * from the Supabase session in this browser (a local read, no network), and is
 * used only when that is still who is signed in. So a different person signing
 * in on this tab, including via another tab, never sees the previous person's
 * attendance. It is also wiped on sign-out, whenever the login page loads, and
 * when a fetch is refused (401/403). The copy only ever STARTS the screen; every
 * visit still fetches, and the response replaces it.
 */
const PREFIX = "missionhq-cache:";
const MAX_AGE = 30 * 60 * 1000;

/** Who is signed in in this browser, or null. */
async function currentOwner(): Promise<string | null> {
  try {
    const { data } = await createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!).auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

export async function readCache<T>(name: string): Promise<T | null> {
  try {
    const raw = sessionStorage.getItem(PREFIX + name);
    if (!raw) return null;
    const { at, owner, value } = JSON.parse(raw) as { at: number; owner: string; value: T };
    if (Date.now() - at >= MAX_AGE) return null;
    return owner && owner === (await currentOwner()) ? value : null;
  } catch {
    return null;
  }
}

export async function writeCache(name: string, value: unknown) {
  try {
    const owner = await currentOwner();
    if (!owner) return;
    sessionStorage.setItem(PREFIX + name, JSON.stringify({ at: Date.now(), owner, value }));
  } catch { /* full or unavailable: the next visit just loads normally */ }
}

export function clearCache() {
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => sessionStorage.removeItem(k));
  } catch { /* nothing to clear */ }
}
