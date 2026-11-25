/**
 * Everything the admin screens say about attendance, computed from the one
 * payload the dashboard already loads, with the one policy in `policy.ts`.
 *
 * THE RULE THAT MATTERS HERE: aggregate scores are credited days divided by
 * counted days, summed over people and weeks AFTER each person's allowances have
 * been applied per calendar week. Averaging percentages would let a person with
 * two counted days weigh as much as one with twenty, and would hide a week's
 * WFH excess inside a mean. So nothing in this file averages a percentage.
 *
 * AND THE IDENTITY THAT KEEPS THE SCREENS HONEST:
 *     counted - credited = unanswered + home beyond the weekly day + WFA beyond the cap
 * so "days without credit" is always explained by exactly three causes and the
 * three add up to it.
 *
 * A day still Pending TODAY is left out of every rate: it is not a miss yet.
 */
import { format, parseISO, startOfWeek } from "date-fns";
import { DAY_WEIGHTS, scorePeriod, type PeriodScore } from "@/lib/domain/policy";
import { calculateWeeklyCompliance } from "@/lib/domain/scoring";
import type { Employee } from "@/lib/domain/types";
import type { Group, Person } from "@/lib/domain/access-types";

export const ALL = "All";

export type Filters = { dept: string; site: string };

export const siteOf = (p?: Person): string => (p?.location_override || p?.location || "").trim() || "Unassigned";

export function inScope(e: Employee, p: Person | undefined, f: Filters): boolean {
  if (f.dept !== ALL && !e.departments.includes(f.dept)) return false;
  if (f.site !== ALL && siteOf(p) !== f.site) return false;
  return true;
}

// ─── Periods ────────────────────────────────────────────────

export type Period = { key: string; label: string; from: string; to: string };

/** The months the data reaches back through, newest first, plus the whole span. */
export function periodsFor(dates: string[], today: string): Period[] {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const out: Period[] = [];
  const seen = new Set<string>();
  for (const d of [...sorted].reverse()) {
    const ym = d.slice(0, 7);
    if (seen.has(ym)) continue;
    seen.add(ym);
    const inMonth = sorted.filter((x) => x.startsWith(ym));
    const first = inMonth[0], last = inMonth[inMonth.length - 1] > today ? today : inMonth[inMonth.length - 1];
    out.push({ key: ym, label: rangeLabel(first, last), from: first, to: last });
  }
  out.push({ key: "all", label: `Whole period \u00b7 ${rangeLabel(sorted[0], today)}`, from: sorted[0], to: today });
  return out;
}

/** "1–23 Oct 2026", or "27 Jul – 23 Oct 2026" across months. */
export function rangeLabel(from: string, to: string): string {
  const a = parseISO(from), b = parseISO(to);
  if (format(a, "yyyy-MM") === format(b, "yyyy-MM")) return `${format(a, "d")}–${format(b, "d MMM yyyy")}`;
  return `${format(a, "d MMM")} – ${format(b, "d MMM yyyy")}`;
}

export const datesIn = (dates: string[], p: Period) => dates.filter((d) => d >= p.from && d <= p.to);

/** The days that count: answered ones, and past ones. Pending TODAY is not a miss yet. */
export const countedDates = (e: Employee, dates: string[], today: string) =>
  dates.filter((d) => d < today || (e.statuses[d] && e.statuses[d] !== "Pending"));

// ─── Statuses ───────────────────────────────────────────────

export type Bucket = "office" | "home" | "anywhere" | "leave" | "waiting";

/** Which of the five headline groups a status belongs to. Half days go to their non-leave half. */
export function bucketOf(status: string | undefined): Bucket | null {
  if (!status) return null; // not asked
  if (status === "Pending") return "waiting";
  const w = DAY_WEIGHTS[status];
  if (!w) return "waiting";
  if (w.wfa >= 0.5) return "anywhere";
  if (w.leave >= 1) return "leave";
  return w.wfo >= w.wfh ? "office" : "home";
}

// ─── One person ─────────────────────────────────────────────

export type PersonRow = {
  employee: Employee;
  person: Person | undefined;
  name: string;
  site: string;
  /** Status today (or on the chosen day): undefined = not asked. */
  dayStatus: string | undefined;
  score: PeriodScore;
  /** Past days asked and never answered, oldest first, across the loaded window. */
  missing: string[];
  wfaUsed: number | null;
  wfaCap: number | null;
  wfaOver: boolean;
};

export function wfaOf(e: Employee, today: string): { used: number; cap: number } | null {
  const al = e.allowance;
  if (!al) return null;
  const used = al.spentBeforeWindow + al.windowDates
    .filter((d) => d >= al.yearStart && d <= today)
    .reduce((n, d) => n + (DAY_WEIGHTS[e.statuses[d] ?? ""]?.wfa ?? 0), 0);
  return { used, cap: al.cap };
}

export function rowFor(e: Employee, p: Person | undefined, dates: string[], period: Period, day: string, today: string): PersonRow {
  const counted = countedDates(e, datesIn(dates, period), today);
  const wfa = wfaOf(e, today);
  return {
    employee: e, person: p, name: e.name || p?.full_name || e.email, site: siteOf(p),
    dayStatus: e.statuses[day],
    score: scorePeriod(e.statuses, counted, e.allowance),
    missing: dates.filter((d) => d < today && e.statuses[d] === "Pending").sort(),
    wfaUsed: wfa?.used ?? null, wfaCap: wfa?.cap ?? null,
    wfaOver: wfa ? wfa.used - wfa.cap > 0.001 : false,
  };
}

// ─── A group of people ──────────────────────────────────────

export type Aggregate = {
  people: number;
  /** On the chosen day. */
  asked: number; notPrompted: number; recorded: number; waiting: number;
  mix: Record<Bucket, number>;
  /** Over the period. */
  requested: number; excluded: number; counted: number; credited: number;
  unanswered: number; wfhOver: number; wfaOverDays: number; peopleOverWfa: number;
  pct: number | null;
  /** Answered / asked, over the period. A different thing from the policy score. */
  coverage: number | null;
  /** People with at least one unanswered past day. */
  peopleMissing: number; missingDays: number;
};

export function aggregate(rows: PersonRow[]): Aggregate {
  const a: Aggregate = {
    people: rows.length, asked: 0, notPrompted: 0, recorded: 0, waiting: 0,
    mix: { office: 0, home: 0, anywhere: 0, leave: 0, waiting: 0 },
    requested: 0, excluded: 0, counted: 0, credited: 0, unanswered: 0, wfhOver: 0, wfaOverDays: 0, peopleOverWfa: 0,
    pct: null, coverage: null, peopleMissing: 0, missingDays: 0,
  };
  let answered = 0;
  for (const r of rows) {
    const b = bucketOf(r.dayStatus);
    if (b === null) a.notPrompted++;
    else { a.asked++; a.mix[b]++; if (b === "waiting") a.waiting++; else a.recorded++; }

    const s = r.score;
    a.requested += s.prompted;
    a.excluded += s.leave + s.wfaWithin;
    a.counted += s.available;
    a.credited += s.adherent;
    a.unanswered += s.pending;
    a.wfhOver += s.wfhExcess;
    a.wfaOverDays += s.wfa - s.wfaWithin;
    answered += s.prompted - s.pending;
    if (r.wfaOver) a.peopleOverWfa++;
    if (r.missing.length) { a.peopleMissing++; a.missingDays += r.missing.length; }
  }
  a.pct = a.counted > 0.001 ? Math.round((a.credited / a.counted) * 100) : null;
  a.coverage = a.requested > 0 ? Math.round((answered / a.requested) * 100) : null;
  return a;
}

export function departmentsOf(rows: PersonRow[]): string[] {
  return Array.from(new Set(rows.flatMap((r) => r.employee.departments))).filter(Boolean).sort();
}

// ─── Weekly series ──────────────────────────────────────────

export type WeekPoint = { weekStart: string; label: string; pct: number | null; credited: number; counted: number; provisional: boolean };

/**
 * Like-for-like calendar weeks across a group, newest last. A week that opens
 * before the loaded window is left out (its first days are unknown), and the
 * current week is marked provisional.
 */
export function weeklySeries(rows: PersonRow[], dates: string[], today: string, limit = 8): WeekPoint[] {
  if (dates.length === 0) return [];
  const firstKnown = [...dates].sort()[0];
  const thisMonday = format(startOfWeek(parseISO(today), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const byWeek = new Map<string, { credited: number; counted: number }>();
  for (const r of rows) {
    const weeks = calculateWeeklyCompliance(r.employee.statuses, countedDates(r.employee, dates, today), r.employee.allowance);
    for (const w of weeks) {
      const cur = byWeek.get(w.weekStart) ?? { credited: 0, counted: 0 };
      cur.credited += w.adherentDays;
      cur.counted += w.availableDays;
      byWeek.set(w.weekStart, cur);
    }
  }
  return [...byWeek.entries()]
    // A week whose Monday falls before the window opens has days we cannot see.
    .filter(([ws, v]) => ws >= firstKnown && v.counted > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([ws, v]) => ({
      weekStart: ws, label: format(parseISO(ws), "d MMM"), credited: v.credited, counted: v.counted,
      pct: v.counted > 0.001 ? Math.round((v.credited / v.counted) * 100) : null, provisional: ws >= thisMonday,
    }));
}

// ─── Wording ────────────────────────────────────────────────

/** "7, 9, 11 and 15 September", or across months "29 and 30 September; 1 October". */
export function formatDays(days: string[]): string {
  const byMonth = new Map<string, number[]>();
  for (const d of [...days].sort()) {
    const dt = parseISO(d);
    const key = format(dt, "MMMM");
    byMonth.set(key, [...(byMonth.get(key) ?? []), dt.getDate()]);
  }
  return [...byMonth.entries()].map(([month, nums]) => {
    const list = nums.length > 1 ? `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}` : String(nums[0]);
    return `${list} ${month}`;
  }).join("; ");
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ─── What a correction would do ─────────────────────────────

/**
 * The week of `day`, scored as it is and as it would be if `day` read `status`.
 * This is what the review step shows: not a guess, the same policy run twice on
 * the real record. Null when the day is outside the loaded window, because the
 * week's other days are then unknown and a partial score would mislead.
 */
export function weekEffect(
  e: Employee, dates: string[], today: string, day: string, status: string,
): { weekStart: string; weekEnd: string; before: number | null; after: number | null; wfaBefore: number; wfaAfter: number } | null {
  const monday = startOfWeek(parseISO(day), { weekStartsOn: 1 });
  const days = Array.from({ length: 5 }, (_, i) => format(new Date(monday.getTime() + i * 86_400_000), "yyyy-MM-dd"));
  // A week that opens before the loaded window has days we cannot see.
  if (dates.length === 0 || days[0] < [...dates].sort()[0]) return null;

  const score = (statuses: Record<string, string>) => {
    const counted = days.filter((d) => d <= today && statuses[d] && (d < today || statuses[d] !== "Pending"));
    return scorePeriod(statuses, counted, e.allowance);
  };
  const before = score(e.statuses);
  const after = score({ ...e.statuses, [day]: status });
  return {
    weekStart: days[0], weekEnd: days[4], before: before.pct, after: after.pct,
    wfaBefore: before.wfa, wfaAfter: after.wfa,
  };
}

// ─── Wording for records ────────────────────────────────────

/** "19 Oct, 09:14 IST". */
export function istStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${parts.replace(" at ", ", ").replace(/, /, ", ")} IST`;
}

const SOURCES: Record<string, string> = {
  slack: "Slack check-in", prompt: "Awaiting an answer", manual: "Manual correction", "zoho-leave": "Zoho leave",
  recovered: "Recovered from Slack", backfill: "Imported history", dashboard: "Answered in the dashboard",
};
export const sourceLabel = (s: string | null | undefined) => (s ? SOURCES[s] ?? s : "No record");

// ─── Report groups ──────────────────────────────────────────


/**
 * Who a report group covers. A roster group is its hand-kept list; a column
 * group is whoever the named column matches today, which is why it has no list
 * of its own to edit. Groups overlap: do not add their sizes up as headcount.
 */
export function groupMembers(g: Group, employees: Employee[], people: Map<string, Person>): string[] {
  if (g.match_kind === "roster") return g.roster;
  const values = (g.match_values ?? []).map((v) => v.toLowerCase());
  const col = (g.match_column ?? "").toLowerCase();
  return employees.filter((e) => {
    const p = people.get(e.email);
    if (col === "department" || col === "team") return e.departments.some((d) => values.includes(d.toLowerCase()));
    if (col === "location" || col === "site") return values.includes(siteOf(p).toLowerCase()) || values.includes((p?.location ?? "").toLowerCase());
    return false;
  }).map((e) => e.email);
}

/** Person-weeks in which somebody was home more than the one day allowed. */
export function excessWeeks(rows: PersonRow[], dates: string[], today: string, period: Period): number {
  let n = 0;
  for (const r of rows) {
    for (const w of calculateWeeklyCompliance(r.employee.statuses, countedDates(r.employee, dates, today), r.employee.allowance)) {
      if (w.weekStart >= period.from && w.weekStart <= period.to && w.wfhExcessDays > 0.001) n++;
    }
  }
  return n;
}
