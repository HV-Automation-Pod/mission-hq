import { requireDb } from "@/lib/server/db";
import { getViewer } from "@/lib/server/session";

/**
 * What every server action shares: the shape of a result, the way a refusal is
 * told apart from an outage, and the permission and token helpers.
 *
 * This file has no "use server" directive on purpose. A "use server" module may
 * only export async functions, and these are types, a class and helpers; the
 * action modules import them from here.
 */
/**
 * Every action returns its outcome instead of throwing it.
 *
 * A server action that throws does NOT deliver its message to the browser in
 * production. Next.js replaces an uncaught server-action error with a generic
 * string and a digest, deliberately, so that an internal message cannot leak
 * to a client. Correct in general, and it meant every considered message in
 * this file reached the screen as "An unexpected response was received from
 * the server": "you have read-only access", "this is the last administrator
 * who can edit", "an empty roster is refused". Each of those is the entire
 * reason the button did not work.
 *
 * So the throws stay as throws INSIDE the action — they read better and they
 * keep the early-return shape — and this converts them at the boundary, which
 * is the one place the conversion has to happen.
 */
export type ActionResult = { ok: true; [key: string]: unknown } | { ok: false; error: string; code?: string };

/** A refusal a screen should be able to tell apart from an outage: `code` says which. */
export class ActionError extends Error {
  constructor(public code: "view-only" | "conflict" | "invalid", message: string) { super(message); }
}

export async function attempt(run: () => Promise<Record<string, unknown> | void>): Promise<ActionResult> {
  try {
    const value = await run();
    return { ok: true, ...(value ?? {}) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Something went wrong",
      code: error instanceof ActionError ? error.code : undefined,
    };
  }
}

export async function requireEditor() {
  const viewer = await getViewer();
  if (!viewer) throw new Error("Not signed in");
  if (viewer.role !== "admin") throw new Error("Admins only");
  if (!viewer.canEdit) throw new Error("You have read-only access to MissionHQ");
  return viewer;
}

/** Adding, changing and removing admins: editors, and workspace admins. */
export async function requireAccessManager() {
  const viewer = await getViewer();
  if (!viewer) throw new Error("Not signed in");
  if (viewer.role !== "admin") throw new Error("Admins only");
  if (!viewer.canManageAccess) throw new Error("Managing access needs an editor or a workspace admin");
  return viewer;
}

/** Today (or a day offset from it) in IST, as yyyy-MM-dd. */
/** Today in IST. Vercel runs in UTC, and between 00:00 and 05:30 IST the UTC
 *  date is still yesterday, which would let a member answer "tomorrow". */
export function istDay(offsetDays = 0): string {
  const d = new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * The token the edge functions accept.
 *
 * NOT the service-role key, and that distinction cost an outage. The functions
 * gate on `settings.edge_invoke_key` (see `_shared/auth.ts`), which is a random
 * value and deliberately not the service-role key — so presenting the latter is
 * rejected 403 like any other stranger. This file carried on sending the
 * service-role key after the gate changed, which took out all seven "Run now"
 * buttons and the access-grant DM at once.
 *
 * Read, not cached: rotating the token should take effect without a redeploy,
 * which is most of the point of keeping it in a table.
 */
export async function invokeToken(): Promise<string> {
  const { data, error } = await requireDb()
    .from("settings").select("value").eq("key", "edge_invoke_key").maybeSingle();
  if (error) throw new Error(`Could not read the invoke token: ${error.message}`);
  const token = data?.value as string | undefined;
  if (!token) throw new Error("settings.edge_invoke_key is not set");
  return token;
}
