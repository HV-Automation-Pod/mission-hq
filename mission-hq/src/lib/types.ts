import type { Allowance } from "./policy";
export type LocationStatus = "Office" | "Home" | "Client Location" | "Split Day" | "Travel" | "Leave" | "Anywhere" | "Pending";

export interface Employee {
  name: string;
  email: string;
  department: string;
  departments: string[]; // individual departments parsed from comma-separated department field
  statuses: Record<string, LocationStatus | string>;
  /** WFA days spent this calendar year before the data window opens. Lets the
   *  client apply the annual allowance the same way `member_metrics()` does.
   *  Absent until migration 38 is applied; see `lib/policy.ts`. */
  wfaBefore?: number;
  /** The above, resolved against the window and the cap by `fetchAllData` so
   *  every caller of `scorePeriod` can just hand it over. Absent means "score
   *  without the cap", which is the pre-migration-38 behaviour. */
  allowance?: Allowance;
}

/** Parse a comma-separated department string into trimmed individual departments */
export function parseDepartments(department: string): string[] {
  if (!department) return [];
  return department.split(",").map((d) => d.trim()).filter(Boolean);
}

export interface ApiResponse {
  success: boolean;
  error?: string;
  dates: string[];
  employees: Employee[];
  totalEmployees: number;
  totalDates: number;
  fetchedAt: string;
  /** Annual work-from-anywhere allowance. Added by migration 38. */
  wfaCap?: number;
  /** Jan 1 of the year that allowance applies to. Added by migration 38. */
  yearStart?: string;
  /** Who the server decided is asking. The payload is already scoped to them;
   *  this is for deciding what to draw, never for deciding what is allowed. */
  viewer?: { email: string; role: string };
}

/**
 * One person's week, scored by the policy in `lib/policy.ts` — the same
 * arithmetic the fortnightly Slack report runs in SQL.
 *
 * These are day COUNTS and they are FRACTIONAL: a Split Day is half an office
 * day and half a WFH day. Format them, and never compare them with `===`.
 */
export interface WeekCompliance {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  /** Days this person was actually asked about. Holidays, weekends and days
   *  before they joined are not in here, because no attendance row exists. */
  promptedDays: number;
  /** Days they could have been in an office: prompted minus leave minus WFA. */
  availableDays: number;
  /** Office days plus WFH that fell on a Wednesday. Wednesday is the default
   *  WFH day, so a Wednesday at home scores like an office day. */
  adherentDays: number;
  /** WFH on a weekday that is not Wednesday — the actual miss. */
  wfhOffWedDays: number;
  /** adherentDays / availableDays, 0-100. Null for a week with nothing
   *  available: somebody on leave all week has no rate, and 0% would be a lie. */
  pct: number | null;
  isCompliant: boolean;
}

export interface EmployeeAnalytics {
  name: string;
  email: string;
  department: string;
  departments: string[];
  office: number;
  home: number;
  clientLocation: number;
  splitDay: number;
  travel: number;
  leave: number;
  anywhere: number;
  pending: number;
  totalDays: number;
  complianceRate: number; // percentage of weeks meeting 4-day requirement
  weeklyCompliance: WeekCompliance[];
  currentStreak: number;          // consecutive recent office days (Office/Client/Split)
  longestStreak: number;          // longest office streak across all dates
  currentAttendanceStreak: number; // consecutive days with any reported status
  longestAttendanceStreak: number; // longest attendance streak
}

export const STATUS_COLORS: Record<string, string> = {
  "Office": "#22c55e",
  "Home": "#3b82f6",
  "Client Location": "#f59e0b",
  "Split Day": "#8b5cf6",
  "Travel": "#ec4899",
  "Leave": "#6b7280",
  "Anywhere": "#06b6d4",
  "Pending": "#ef4444",
};

export const STATUS_BG_COLORS: Record<string, string> = {
  "Office": "bg-green-100 text-green-800",
  "Home": "bg-blue-100 text-blue-800",
  "Client Location": "bg-amber-100 text-amber-800",
  "Split Day": "bg-violet-100 text-violet-800",
  "Travel": "bg-pink-100 text-pink-800",
  "Leave": "bg-gray-100 text-gray-600",
  "Anywhere": "bg-cyan-100 text-cyan-800",
  "Pending": "bg-red-100 text-red-800",
};
