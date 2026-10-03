import { NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { getAdmins, getTriage, getJobs, getPeople, getGroups } from "@/lib/admin-queries";

/**
 * Everything the Admin tab draws, in one request.
 *
 * Admins only, checked here rather than in the component that renders the tab:
 * hiding a tab hides a tab. The five queries are small and independent, so they
 * go out together — the tab is one screen and should paint in one round trip.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Sign in with your HyperVerge account" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  try {
    const [admins, triage, jobs, people, groups] = await Promise.all([
      getAdmins(), getTriage(), getJobs(), getPeople(), getGroups(),
    ]);
    return NextResponse.json(
      { admins, triage, jobs, people, groups, viewer },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
