import { NextResponse } from "next/server";
import { requireDb } from "@/lib/db";
import { getViewer } from "@/lib/session";

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
    return NextResponse.json(
      { success: false, error: "Sign in with your HyperVerge account" },
      { status: 401 },
    );
  }

  // 90 days by default, not the full history. Everything on first paint — the
  // snapshot, the week trend, streaks, weekly compliance — fits comfortably
  // inside a quarter, and the whole archive is 942 KB of JSON that takes four
  // seconds to build. A screen asking for a wider range passes ?days=.
  const days = Number(new URL(request.url).searchParams.get("days") ?? 90);

  try {
    const { data, error } = await requireDb().rpc("dashboard_payload", {
      p_days: Number.isFinite(days) && days > 0 && days <= 1000 ? days : 90,
      p_email: viewer.role === "admin" ? null : viewer.email,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json(
      { ...(data as object), viewer: { email: viewer.email, role: viewer.role } },
      // Attendance changes all morning; a cached copy is worse than a slow one.
      // `private` matters more than usual here: the payload differs per viewer.
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
