import { getViewer } from "@/lib/server/session";
import { fail, messageOf, ok } from "@/lib/server/respond";
import { getAdmins, getTriage, getJobs, getPeople, getGroups, getSlackSyncedAt } from "@/lib/server/admin-queries";

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
    return fail(401, "Sign in with your HyperVerge account");
  }
  if (viewer.role !== "admin") {
    return fail(403, "Admins only");
  }

  try {
    const [admins, triage, jobs, people, groups, slackSyncedAt] = await Promise.all([
      getAdmins(), getTriage(), getJobs(), getPeople(), getGroups(), getSlackSyncedAt(),
    ]);
    return ok({ admins, triage, jobs, people, groups, slackSyncedAt, viewer });
  } catch (err) {
    return fail(500, messageOf(err, "Unknown error"));
  }
}
