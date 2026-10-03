import "server-only";
import { requireDb } from "./db";

export type Admin = { email: string; can_edit: boolean; note: string | null; added_by: string | null; created_at: string };

export async function getAdmins(): Promise<Admin[]> {
  const { data, error } = await requireDb()
    .from("dashboard_access").select("*").order("email");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type TriageRow = {
  email: string;
  slack_name: string | null;
  slack_user_id: string | null;
  in_mission_hq: boolean;
  full_name: string | null;
  wfo_exempt: string | null;
  prompt_opt_in: boolean;
  notes: string | null;
  exited: boolean;
  possible_zoho_match: string | null;
};

/**
 * Slack accounts with no Zoho record: the spreadsheet tab, as a live view.
 *
 * Both sides are already synced daily — Slack at 02:00, Zoho at 06:30 — so this
 * is a join, not a job. The tab it replaces paged the whole Slack directory on
 * every run and merged into a sheet while trying not to clobber the two columns
 * somebody had typed in.
 */
export async function getTriage(): Promise<TriageRow[]> {
  const { data, error } = await requireDb()
    .from("slack_not_in_zoho")
    .select("*")
    .order("prompt_opt_in", { ascending: false })
    .order("email");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type JobRun = { jobname: string; schedule: string; active: boolean };

/** What is scheduled, from pg_cron itself rather than from a list in the code. */
export async function getJobs(): Promise<JobRun[]> {
  const { data, error } = await requireDb().rpc("scheduled_jobs");
  if (error) return [];
  return (data as JobRun[]) ?? [];
}

export type Person = {
  email: string;
  full_name: string | null;
  team: string | null;
  location: string | null;
  location_override: string | null;
  emp_id: string | null;
  exited_at: string | null;
  wfo_exempt: string | null;
  prompt_opt_in: boolean;
  notes: string | null;
};

/**
 * Everyone MissionHQ knows about, with the three fields a human owns.
 *
 * The mirrored columns (name, team, location) come back from Zoho on every
 * sync and are read-only here; `wfo_exempt`, `prompt_opt_in` and
 * `location_override` are the ones PnC used to keep in spreadsheet columns.
 */
export async function getPeople(): Promise<Person[]> {
  const { data, error } = await requireDb()
    .from("employees")
    .select("email,full_name,team,location,location_override,emp_id,exited_at,wfo_exempt,prompt_opt_in,notes")
    .order("full_name", { nullsFirst: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type Group = {
  key: string;
  name: string;
  channel_id: string;
  match_kind: "column" | "roster";
  match_column: string | null;
  match_values: string[] | null;
  active: boolean;
  snapshot_no: number;
  last_period: string | null;
  /** Only meaningful for match_kind='roster'. A column group has no list to
   *  keep: its membership is whatever Zoho says today. */
  roster: string[];
};

/** The fortnightly report's groups, with the hand-kept rosters attached. */
export async function getGroups(): Promise<Group[]> {
  const db = requireDb();
  const [{ data: groups, error: gErr }, { data: rosters, error: rErr }] = await Promise.all([
    db.from("summary_groups")
      .select("key,name,channel_id,match_kind,match_column,match_values,active,snapshot_no,last_period")
      .order("sort_order"),
    db.from("rosters").select("group_key,email"),
  ]);
  if (gErr) throw new Error(gErr.message);
  if (rErr) throw new Error(rErr.message);

  const byGroup = new Map<string, string[]>();
  for (const r of rosters ?? []) {
    const list = byGroup.get(r.group_key) ?? [];
    list.push(r.email);
    byGroup.set(r.group_key, list);
  }
  return (groups ?? []).map((g) => ({
    ...g,
    roster: (byGroup.get(g.key) ?? []).sort(),
  })) as Group[];
}
