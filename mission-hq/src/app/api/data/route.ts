import { publicDb, requireDb } from "@/lib/server/db";
import { getViewer } from "@/lib/server/session";
import { fail, messageOf, ok } from "@/lib/server/respond";

/**
 * The dashboard's data, straight from Postgres, scoped to who is asking.
 *
 * An admin gets everyone. A member gets their own row and nothing else, and
 * that is enforced by passing their email into the SQL rather than by filtering
 * the response: a member's request never loads another person's attendance into
 * this process at all.
 *
 * SAME RESPONSE SHAPE AS BEFORE, deliberately. This used to proxy a web app
 * that read a 376 x 346 grid on every call, with a three to four second cold
 * start before any data moved. Keeping the contract means every
 * tab, chart, streak and heatmap keeps working untouched.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) {
    return fail(401, "Sign in with your HyperVerge account");
  }

  // 90 days by default, not the full history. Everything on first paint — the
  // snapshot, the week trend, streaks, weekly compliance — fits comfortably
  // inside a quarter, and the whole archive is 942 KB of JSON that takes four
  // seconds to build. A screen asking for a wider range passes ?days=.
  const days = Number(new URL(request.url).searchParams.get("days") ?? 90);

  try {
    const db = requireDb();
    // The picker's options ride along, fetched in parallel, so opening it is
    // instant instead of a server round trip. Admins get them too, for their
    // own "My attendance" view.
    const [payload, options] = await Promise.all([
      db.rpc("dashboard_payload", {
        p_days: Number.isFinite(days) && days > 0 && days <= 1000 ? days : 90,
        p_email: viewer.role === "admin" ? null : viewer.email,
      }),
      db.from("locations").select("value,status").eq("active", true).order("sort_order"),
    ]);
    if (payload.error) throw new Error(payload.error.message);

    const holidays = await upcomingHolidays();

    // Attendance changes all morning; a cached copy is worse than a slow one,
    // and `respond.ts` never lets one be stored: the payload differs per viewer.
    return ok({
      ...(payload.data as object),
      statusOptions: options.data ?? undefined,
      holidays,
      viewer: { email: viewer.email, role: viewer.role, canEdit: viewer.canEdit },
    });
  } catch (err) {
    return fail(500, messageOf(err, "Unknown error"));
  }
}

/**
 * The next few holidays that matter, from `public.holidays` (WeCare's list, the
 * same one `is_business_day()` reads).
 *
 * TWO KINDS, and telling them apart is the whole job (migration 45):
 *   counts = true    the office is closed. A real holiday.
 *   counts = false   a RESTRICTED holiday. Optional, taken per person, and the
 *                    office is open, so most people are at work.
 * Showing a restricted one as "holiday" tells people the office is shut when it
 * is not, which is the same mistake migration 45 fixed in the prompt job.
 *
 * Weekend dates are dropped: a holiday on a Sunday changes nothing for anybody.
 * Fails soft, because a nice-to-know must never take the attendance payload down.
 */
async function upcomingHolidays(): Promise<{ day: string; name: string; kind: "closed" | "optional" }[]> {
  try {
    if (!publicDb) return [];
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const { data, error } = await publicDb
      .from("holidays").select("day,name,counts").gte("day", today).order("day").limit(30);
    if (error || !data) return [];
    return data
      .filter((h) => { const d = new Date(`${h.day}T00:00:00Z`).getUTCDay(); return d !== 0 && d !== 6; })
      .slice(0, 5)
      .map((h) => ({ day: String(h.day), name: String(h.name ?? "Holiday"), kind: h.counts === false ? "optional" as const : "closed" as const }));
  } catch {
    return [];
  }
}
