import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requireDb } from "./db";

/**
 * Who is asking, and what they are allowed to see.
 *
 * TWO ROLES, and the difference is a row in `dashboard_access`:
 *
 *   member  anybody with a company Google account. Sees their own attendance
 *           and nothing else. This is most of the company.
 *   admin   on the allowlist. Sees everyone, and may edit if `can_edit`.
 *
 * The domain check is what makes somebody a member: a Google account at this
 * company is proof of employment, which is all a member needs to be. It is NOT
 * proof that they should see 350 people's records, which is why admin is a
 * separate, explicit list.
 *
 * Scoping is enforced in SQL (`dashboard_payload(p_email)`), not here. This
 * function decides the role; the database decides what a role can fetch. A UI
 * that filters is a presentation choice, not a control.
 */
const ALLOWED_DOMAINS = ["hyperverge.co"];

export type Role = "admin" | "member";
export type Viewer = { email: string; role: Role; canEdit: boolean };

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Server Components have read-only cookies; the middleware refreshes
            // the session instead, so dropping this is safe.
          }
        },
      },
    },
  );
}

/** The signed-in viewer, or null when the account is not a company one. */
export async function getViewer(): Promise<Viewer | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return null;

  const domain = email.split("@")[1];
  if (!ALLOWED_DOMAINS.includes(domain)) return null;

  const { data: row } = await requireDb()
    .from("dashboard_access")
    .select("can_edit")
    .eq("email", email)
    .maybeSingle();

  return row
    ? { email, role: "admin", canEdit: row.can_edit === true }
    : { email, role: "member", canEdit: false };
}

/** For pages that only admins may open. */
export async function requireAdmin() {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "admin") return null;
  return viewer;
}
