/**
 * A short-lived copy of the last payloads, so a revisit paints at once and the
 * fresh data swaps in behind it.
 *
 * sessionStorage, not localStorage: it belongs to this tab and goes when the tab
 * does. It is also wiped on sign-out and whenever the login page loads, so a
 * different person signing in on the same tab can never be shown the previous
 * person's attendance. The copy only ever STARTS the screen; every visit still
 * fetches, and the response replaces it.
 */
const PREFIX = "missionhq-cache:";
const MAX_AGE = 30 * 60 * 1000;

export function readCache<T>(name: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + name);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: T };
    return Date.now() - at < MAX_AGE ? value : null;
  } catch {
    return null;
  }
}

export function writeCache(name: string, value: unknown) {
  try { sessionStorage.setItem(PREFIX + name, JSON.stringify({ at: Date.now(), value })); }
  catch { /* full or unavailable: the next visit just loads normally */ }
}

export function clearCache() {
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => sessionStorage.removeItem(k));
  } catch { /* nothing to clear */ }
}
