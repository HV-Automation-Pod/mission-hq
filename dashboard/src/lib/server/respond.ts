import "server-only";
import { NextResponse } from "next/server";

/**
 * The one response format for every API route.
 *
 *   success   { ok: true,  data: ... }
 *   failure   { ok: false, error: "what happened, in words a person can read" }
 *
 * Before this, three routes answered three ways (`{ success, ... }`, a bare
 * object, `{ error }`), so each client had its own idea of what a failure looked
 * like. One envelope means `lib/api/client.ts` can be the only place that
 * decides.
 *
 * Nothing here is cacheable. Every route is per-viewer, and a cached copy of
 * somebody's attendance served to somebody else is the failure to design out.
 */
const NO_STORE = { "cache-control": "private, no-store" } as const;

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: NO_STORE });
}

export function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

/** For a `catch`: the message if there is one, never the thrown object itself. */
export function messageOf(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
