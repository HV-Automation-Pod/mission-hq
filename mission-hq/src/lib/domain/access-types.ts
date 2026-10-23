/**
 * The shapes `/api/admin` returns, for the client. `admin-queries.ts` owns the
 * queries and is server-only, so the client cannot import its types at runtime;
 * these mirror it and are the only place the client reads them from.
 */
export type Admin = { email: string; can_edit: boolean; note: string | null; added_by: string | null; created_at: string };

export type TriageRow = {
  email: string; slack_name: string | null; slack_user_id: string | null; in_mission_hq: boolean;
  full_name: string | null; wfo_exempt: string | null; prompt_opt_in: boolean; notes: string | null;
  exited: boolean; possible_zoho_match: string | null;
};

export type Person = {
  email: string; full_name: string | null; team: string | null; location: string | null;
  location_override: string | null; emp_id: string | null; exited_at: string | null;
  wfo_exempt: string | null; prompt_opt_in: boolean; notes: string | null;
};

export type Group = {
  key: string; name: string; channel_id: string; match_kind: "column" | "roster";
  match_column: string | null; match_values: string[] | null; active: boolean;
  snapshot_no: number; last_period: string | null; roster: string[];
};

export type JobRow = { jobname: string; schedule: string; active: boolean };

export type AdminData = {
  admins: Admin[]; triage: TriageRow[]; jobs: JobRow[]; people: Person[]; groups: Group[];
  slackSyncedAt: string | null;
  viewer: { email: string; role: string; canEdit: boolean };
};

/** One attendance record as the correction flow needs to see it. */
export type AttendanceRecord = {
  email: string;
  day: string;
  /** null: no row, i.e. nobody asked this person about this day. */
  status: string | null;
  source: string | null;
  answeredAt: string | null;
  /** The record's version. A correction is refused if this has moved. */
  updatedAt: string | null;
  zohoPushedAt: string | null;
  note: string | null;
};
