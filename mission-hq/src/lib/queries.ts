import "server-only";
import { requireDb } from "./db";

/**
 * Every read the dashboard does.
 *
 * All of it is aggregated or indexed in Postgres rather than fetched and
 * reduced here. The screen this replaces called an Apps Script web app which
 * read a 376 x 346 cell grid and returned the whole thing; the cold start alone
 * was three to four seconds before a single byte of data moved.
 */

export type Overview = {
  day: string;
  is_working_day: boolean;
  expected: number;
  answered: number;
  pending: number;
  on_leave: number;
  not_prompted: number;
  in_office: number;
};

export async function getOverview(): Promise<Overview | null> {
  const { data, error } = await requireDb().rpc("today_overview");
  if (error) throw new Error(error.message);
  return (data as Overview[])?.[0] ?? null;
}

export type DayRow = {
  email: string;
  full_name: string | null;
  status: string;
  source: string;
  answered_at: string | null;
  team: string | null;
  site: string | null;
};

/** Today's answers, newest first, so the screen shows movement as it happens. */
export async function getToday(day: string): Promise<DayRow[]> {
  const { data, error } = await requireDb()
    .from("attendance")
    .select("email,status,source,answered_at,employees!inner(full_name,team,location,location_override)")
    .eq("day", day)
    .order("answered_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(error.message);

  type Joined = {
    email: string; status: string; source: string; answered_at: string | null;
    employees: { full_name: string | null; team: string | null; location: string | null; location_override: string | null };
  };
  return (data as unknown as Joined[]).map((r) => ({
    email: r.email,
    full_name: r.employees?.full_name ?? null,
    status: r.status,
    source: r.source,
    answered_at: r.answered_at,
    team: r.employees?.team ?? null,
    site: r.employees?.location_override || r.employees?.location || null,
  }));
}

/** Who has not been asked yet today. Empty on a weekend or a holiday. */
export async function getGaps(): Promise<{ email: string; full_name: string | null; slack_user_id: string | null }[]> {
  const { data, error } = await requireDb()
    .from("prompt_gaps")
    .select("email,full_name,slack_user_id")
    .order("full_name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type Person = {
  email: string;
  full_name: string | null;
  team: string | null;
  location: string | null;
  location_override: string | null;
  emp_id: string | null;
  wfo_exempt: string | null;
  prompt_opt_in: boolean;
  exited_at: string | null;
};

export async function getPeople(search?: string): Promise<Person[]> {
  let q = requireDb()
    .from("employees")
    .select("email,full_name,team,location,location_override,emp_id,wfo_exempt,prompt_opt_in,exited_at")
    .order("full_name")
    .limit(600);
  if (search) q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getPerson(email: string) {
  const [person, history] = await Promise.all([
    requireDb().from("employees").select("*").eq("email", email).maybeSingle(),
    requireDb()
      .from("attendance")
      .select("day,status,source,answered_at,zoho_pushed_at")
      .eq("email", email)
      .order("day", { ascending: false })
      .limit(90),
  ]);
  if (person.error) throw new Error(person.error.message);
  if (history.error) throw new Error(history.error.message);
  return { person: person.data as Person | null, history: history.data ?? [] };
}

export async function getLocations(): Promise<{ value: string; label: string; status: string }[]> {
  const { data, error } = await requireDb()
    .from("locations").select("value,label,status").eq("active", true).order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}
