import { addDays, startOfWeek } from "date-fns";
import { CalendarDays, Globe, Info, LayoutGrid, type LucideIcon } from "lucide-react";
import { DAY_WEIGHTS, fmtDays, isRealWeek, scorePeriod, type PeriodScore } from "@/lib/domain/policy";
import { calculateWeeklyCompliance } from "@/lib/domain/scoring";
import type { Employee } from "@/lib/domain/types";
import { iso } from "@/lib/format";
import { C } from "@/components/ui";

/**
 * What the member view knows and the pages share: the constants, the page list,
 * the figures computed once from the person's record, and the props every page
 * takes. Nothing here draws anything.
 */

export const WEEKDAYS = 5;
export const WEEKS_SHOWN = 8;
/** Mirrors BACKFILL_DAYS in lib/actions/member.ts. The server is the one that enforces it. */
export const BACKFILL_DAYS = 60;

export type Option = { value: string; status: string };
export type Holiday = { day: string; name: string; kind: "closed" | "optional" };
export type Page = "overview" | "attendance" | "policies" | "allowances";

export const NAV: { id: Page; label: string; Icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", Icon: LayoutGrid },
  { id: "attendance", label: "My attendance", Icon: CalendarDays },
  { id: "policies", label: "Policies", Icon: Info },
  { id: "allowances", label: "Allowances", Icon: Globe },
];

export const greeting = (h: number) => (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");

export function weekVerdict(s: PeriodScore): { label: string; detail: string; color: string; bg: string } {
  if (s.wfhExcess > 0.001) return { label: "Over the WFH limit", color: C.warn, bg: C.warnSoft,
    detail: "You have worked from home more than one day this week. Only one is included." };
  if (s.pending > 0) return { label: "Unanswered days", color: C.warn, bg: C.warnSoft,
    detail: `${s.pending} past ${s.pending === 1 ? "day has" : "days have"} no answer.` };
  if (s.available <= 0.001) return { label: "Nothing to score", color: C.leave, bg: C.leaveSoft, detail: "No days this week count towards the score yet." };
  return { label: "On track", color: C.office, bg: C.officeSoft,
    detail: `${fmtDays(s.adherent)} of ${fmtDays(s.available)} counted ${s.available === 1 ? "day" : "days"} met the policy.` };
}

// ─── The figures ────────────────────────────────────────────

export type ViewData = {
  weekDays: string[]; thisWeek: PeriodScore; overall: PeriodScore; missed: string[]; weekPct: Map<string, number | null>;
  wfa: { cap: number; before: number; rows: { day: string; used: number }[]; used: number; year: string } | null;
  streak: { current: number; best: number }; weeksMet: number; weeksTotal: number;
  recent: ReturnType<typeof calculateWeeklyCompliance>;
};

/**
 * Everything the pages show about one person, computed once, with the one policy
 * in `lib/domain/policy.ts`. A day still Pending TODAY is left out of every rate:
 * it is not a miss yet.
 */
export function computeViewData(employee: Employee, dates: string[], today: string, now: Date, oldest: string): ViewData {
  const statuses = employee.statuses;
  const counted = dates.filter((d) => d < today || (statuses[d] && statuses[d] !== "Pending"));

  const monday = startOfWeek(now, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: WEEKDAYS }, (_, i) => iso(addDays(monday, i)));
  const thisWeek = scorePeriod(statuses, counted.filter((d) => weekDays.includes(d)), employee.allowance);
  const overall = scorePeriod(statuses, counted, employee.allowance);

  const weeks = calculateWeeklyCompliance(statuses, counted, employee.allowance);
  const weekPct = new Map(weeks.map((w) => [w.weekStart, isRealWeek(w.availableDays) ? w.pct : null]));
  const realWeeks = weeks.filter((w) => w.weekStart < iso(monday) && isRealWeek(w.availableDays));

  const missed = dates.filter((d) => d < today && d >= oldest && statuses[d] === "Pending").sort();

  // Annual work-from-anywhere: neutral only up to the yearly cap.
  const al = employee.allowance;
  const wfaRows = al ? al.windowDates
    .filter((d) => d >= al.yearStart && d <= today && (DAY_WEIGHTS[statuses[d] ?? ""]?.wfa ?? 0) > 0)
    .map((d) => ({ day: d, used: DAY_WEIGHTS[statuses[d]].wfa })) : [];
  const wfa = al ? { cap: al.cap, before: al.spentBeforeWindow, rows: wfaRows,
    used: al.spentBeforeWindow + wfaRows.reduce((n, r) => n + r.used, 0), year: al.yearStart.slice(0, 4) } : null;

  // Personal streak. Weekends and holidays are not in `dates`, so they never
  // break one; neither does leave. Anything else that is not office does.
  const OFFICE_SET = new Set(["Office", "Client Location", "Split Day", "Office + Client", "Compensatory WFH"]);
  const neutral = (st: string) => st === "Leave" || st === "Half Day Office Leave" || st === "Half Day WFH Leave";
  const ordered = [...counted].sort();
  let best = 0, run = 0, current = 0;
  for (const d of ordered) {
    const st = statuses[d];
    if (!st || neutral(st)) continue;
    if (OFFICE_SET.has(st)) { run++; best = Math.max(best, run); } else run = 0;
  }
  for (const d of [...ordered].reverse()) {
    const st = statuses[d];
    if (!st || neutral(st)) continue;
    if (OFFICE_SET.has(st)) current++; else break;
  }

  return {
    weekDays, thisWeek, overall, missed, weekPct, wfa, streak: { current, best },
    weeksMet: realWeeks.filter((w) => w.isCompliant).length, weeksTotal: realWeeks.length,
    recent: weeks.filter((w) => w.weekStart < iso(monday)).slice(-WEEKS_SHOWN),
  };
}

// ─── Props every page takes ─────────────────────────────────

export type PageProps = {
  employee: Employee; view: ViewData; today: string; now: Date; oldest: string;
  month: Date; setMonth: (fn: (m: Date) => Date) => void; earliest: Date;
  canAnswer: (day: string) => boolean; onAnswer: (day: string) => void; onWeek: (weekStart: string) => void;
  setPage: (p: Page) => void; holidays: Holiday[]; isWeekend: boolean; onReview: () => void;
};
