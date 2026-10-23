"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, addMonths, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, startOfWeek, subDays } from "date-fns";
import {
  AlertCircle, ArrowLeftRight, Building2, CalendarDays, Check, ChevronLeft, ChevronRight, Flame, Globe, Home, MapPin, Moon, Pencil, Plane, Sun, TreePalm, X, type LucideIcon,
} from "lucide-react";
import AccountMenu from "@/components/AccountMenu";
import ViewSwitch from "@/components/ViewSwitch";
import { useTheme } from "@/lib/theme";
import { answerMyAttendance } from "@/lib/actions";
import { calculateWeeklyCompliance } from "@/lib/utils";
import { DAY_WEIGHTS, fmtDays, isRealWeek, scorePeriod, type PeriodScore } from "@/lib/policy";
import { STATUS_COLORS, type Employee } from "@/lib/types";

/**
 * What a member sees: their own attendance, and the means to fix it.
 *
 * The month calendar is the page. Zoho People, BambooHR and every attendance
 * guide converge on it because a person reads their own pattern fastest as a
 * grid of days: a streak of home days or a hatched gap jumps out, where a list
 * or a chart makes them work for it. The side column answers the other two
 * questions (where am I today, am I on track this week) and nothing else.
 *
 * Every cell carries its status as text and an aria-label, never colour alone.
 *
 * The rules for who may answer what live in `answerMyAttendance` on the
 * server. This file only decides what is worth OFFERING: a missed (Pending)
 * day inside the backfill window, and today. An answered past day is a record
 * and gets no button.
 *
 * Scoring is `lib/policy.ts`, untouched, so these numbers agree with the
 * fortnightly Slack report. The one deliberate difference: a day still Pending
 * TODAY is left out of the rate, because it is not a miss yet.
 */

const WEEKDAYS = 5;
const WEEKS_SHOWN = 8;
/** Mirrors BACKFILL_DAYS in lib/actions.ts. The server is the one that enforces it. */
const BACKFILL_DAYS = 60;

type View = { verb: string; short: string; Icon: LucideIcon; color: string };

const VIEWS: Record<string, View> = {
  "Office":                { verb: "In the office",         short: "Office",   Icon: Building2,      color: STATUS_COLORS["Office"] },
  "Office + Client":       { verb: "Office and client",     short: "Office",   Icon: Building2,      color: STATUS_COLORS["Office"] },
  "Compensatory WFH":      { verb: "Compensatory day",      short: "Comp",     Icon: Building2,      color: STATUS_COLORS["Office"] },
  "Home":                  { verb: "Working from home",     short: "Home",     Icon: Home,           color: STATUS_COLORS["Home"] },
  "Client Location":       { verb: "At a client site",      short: "Client",   Icon: MapPin,         color: STATUS_COLORS["Client Location"] },
  "Split Day":             { verb: "Split day",             short: "Split",    Icon: ArrowLeftRight, color: STATUS_COLORS["Split Day"] },
  "Travel":                { verb: "Travelling",            short: "Travel",   Icon: Plane,          color: STATUS_COLORS["Travel"] },
  "Leave":                 { verb: "On leave",              short: "Leave",    Icon: TreePalm,       color: STATUS_COLORS["Leave"] },
  "Half Day Office Leave": { verb: "Half day, office",      short: "Half",     Icon: TreePalm,       color: STATUS_COLORS["Leave"] },
  "Half Day WFH Leave":    { verb: "Half day, home",        short: "Half",     Icon: TreePalm,       color: STATUS_COLORS["Home"] },
  "Anywhere":              { verb: "Working from anywhere", short: "Anywhere", Icon: Globe,          color: STATUS_COLORS["Anywhere"] },
  "Pending":               { verb: "Not answered yet",      short: "Pending",  Icon: AlertCircle,    color: "#f59e0b" },
};

function viewOf(status: string): View {
  return VIEWS[status] ?? { verb: status, short: status, Icon: MapPin, color: "#6b7280" };
}

const soft = (color: string) => `${color}22`;
const iso = (d: Date) => format(d, "yyyy-MM-dd");
const dayLabel = (d: string) => format(parseISO(d), "EEE d MMM");

function pctClass(pct: number | null): string {
  if (pct === null) return "text-[var(--text-muted)]";
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function barColor(pct: number | null): string {
  if (pct === null) return "var(--border-strong)";
  return pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
}

function greeting(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** One sentence that says whether the week is fine, and if not, why. */
function weekVerdict(s: PeriodScore): { label: string; detail: string; color: string } {
  if (s.wfhExcess > 0.001) {
    return { label: "Over the WFH limit", color: "#ef4444",
      detail: "You have worked from home more than one day this week. Only one is allowed." };
  }
  if (s.pending > 0) {
    return { label: "Unanswered days", color: "#f59e0b",
      detail: `${s.pending} past ${s.pending === 1 ? "day has" : "days have"} no answer. Answer ${s.pending === 1 ? "it" : "them"} to fix your week.` };
  }
  if (s.available <= 0.001) {
    return { label: "Nothing to score", color: "#6b7280", detail: "No days this week count towards compliance yet." };
  }
  return { label: "On track", color: "#22c55e",
    detail: `${fmtDays(s.adherent)} of ${fmtDays(s.available)} counted ${s.available === 1 ? "day" : "days"} met the policy.` };
}

const primaryBtn = {
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
} as const;

function Card({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <section className={`card p-5 ${className}`} style={style}>{children}</section>;
}

function Heading({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{children}</h2>
      {right}
    </div>
  );
}

export default function MyAttendance({ employee: loaded, dates, viewer, options, holidays, onChanged, onBackToAdmin }: {
  employee: Employee | null;
  dates: string[];
  viewer: { email: string; role: string };
  options: Option[];
  holidays: { day: string; name: string; kind: "closed" | "optional" }[];
  /** Set for an admin looking at their own attendance: the way back. */
  onBackToAdmin?: () => void;
  /** Re-fetch the payload after an answer is saved. */
  onChanged: () => Promise<void> | void;
}) {
  const { theme, toggleTheme } = useTheme();
  const [answering, setAnswering] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [weekOpen, setWeekOpen] = useState<string | null>(null);
  // Answers saved but not yet confirmed by a refetch. Applied on top of the
  // server's data so the page changes the instant somebody saves.
  const [pendingSaves, setPendingSaves] = useState<Record<string, string>>({});

  const employee = useMemo(
    () => (loaded && Object.keys(pendingSaves).length
      ? { ...loaded, statuses: { ...loaded.statuses, ...pendingSaves } }
      : loaded),
    [loaded, pendingSaves],
  );

  /** Close at once, show the new state, and let the server catch up. */
  const submitAnswer = (day: string, value: string, status: string) => {
    const label = day === iso(new Date()) ? "Today" : dayLabel(day);
    setAnswering(null);
    setPendingSaves((p) => ({ ...p, [day]: status }));
    setToast(`${label} saved as ${viewOf(status).verb.toLowerCase()}`);
    answerMyAttendance(day, value).then((r) => {
      if (!r.ok) setToast(r.error);
      // Success or not, drop the local copy: either the refetch now carries the
      // truth, or the answer was refused and the old state should come back.
      return Promise.resolve(onChanged()).finally(() =>
        setPendingSaves((p) => { const { [day]: _gone, ...rest } = p; return rest; }));
    });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const now = new Date();
  const today = iso(now);
  const oldest = iso(subDays(now, BACKFILL_DAYS));

  const view = useMemo(() => {
    if (!employee) return null;
    const statuses = employee.statuses;

    const counted = dates.filter((d) => d < today || (statuses[d] && statuses[d] !== "Pending"));

    const monday = startOfWeek(now, { weekStartsOn: 1 });
    const weekDays = Array.from({ length: WEEKDAYS }, (_, i) => iso(addDays(monday, i)));

    const thisWeek = scorePeriod(statuses, counted.filter((d) => weekDays.includes(d)), employee.allowance);
    const overall = scorePeriod(statuses, counted, employee.allowance);

    const weeks = calculateWeeklyCompliance(statuses, counted, employee.allowance);
    const weekPct = new Map(weeks.map((w) => [w.weekStart, isRealWeek(w.availableDays) ? w.pct : null]));
    const realWeeks = weeks.filter((w) => w.weekStart < iso(monday) && isRealWeek(w.availableDays));

    // Missed days still inside the window, newest first.
    const missed = dates.filter((d) => d < today && d >= oldest && statuses[d] === "Pending").sort().reverse();

    // Work-from-anywhere is neutral only up to the yearly cap, so what is left
    // of it is worth knowing. Same arithmetic as `wfaWithinEntitlement`.
    const al = employee.allowance;
    const wfa = al ? {
      cap: al.cap,
      used: al.spentBeforeWindow + al.windowDates
        .filter((d) => d >= al.yearStart && d <= today)
        .reduce((n, d) => n + (DAY_WEIGHTS[statuses[d] ?? ""]?.wfa ?? 0), 0),
    } : null;

    // Personal streaks. Weekends and holidays are not in `dates`, so they never
    // break one. Leave is neutral too: approved time off should not cost
    // somebody their streak. Anything else that is not office does.
    const OFFICE = new Set(["Office", "Client Location", "Split Day", "Office + Client", "Compensatory WFH"]);
    const neutral = (st: string) => st === "Leave" || st === "Half Day Office Leave" || st === "Half Day WFH Leave";
    const ordered = [...counted].sort();
    let best = 0, run = 0, current = 0;
    for (const d of ordered) {
      const st = statuses[d];
      if (!st || neutral(st)) continue;
      if (OFFICE.has(st)) { run++; best = Math.max(best, run); } else run = 0;
    }
    for (const d of [...ordered].reverse()) {
      const st = statuses[d];
      if (!st || neutral(st)) continue;
      if (OFFICE.has(st)) current++; else break;
    }

    return {
      thisWeek, overall, missed, weekPct, wfa, streak: { current, best },
      weeksMet: realWeeks.filter((w) => w.isCompliant).length,
      weeksTotal: realWeeks.length,
    };
    // `now` changes every render but `today` only changes at midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee, dates, today]);

  /** May the member answer or change this day? Mirrors the server's rules. */
  const canAnswer = (day: string): boolean => {
    const s = employee?.statuses[day];
    if (!s || day > today || day < oldest) return false;
    if (day === today) return s !== "Leave";
    return s === "Pending";
  };

  const fullName = employee?.name ?? null;
  const firstName = (fullName ?? viewer.email.split("@")[0]).split(/[\s._-]+/)[0];
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const earliest = startOfMonth(parseISO(dates[0] ?? today));

  const todayCard = employee && view && (
    <Today employee={employee} today={today} isWeekend={isWeekend} thisWeekWfh={view.thisWeek.wfh}
      editable={canAnswer(today)} onAnswer={() => setAnswering(today)} />
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-app)" }}>
      <header className="glass border-b sticky top-0 z-40" style={{ borderColor: "var(--border-default)" }}>
        <div className="max-w-[1120px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)" }}>
              <MapPin size={16} className="text-white" />
            </div>
            <span className="text-[15px] font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>MissionHQ</span>
          </div>
          <div className="flex items-center gap-1.5">
            {onBackToAdmin && <div className="mr-1"><ViewSwitch view="me" onChange={(v) => v === "team" && onBackToAdmin()} /></div>}
            <button onClick={toggleTheme} aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              className="p-2 rounded-lg transition-all active:scale-95 hover:bg-[var(--bg-surface-hover)]"
              style={{ color: "var(--text-secondary)" }}>
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <div className="ml-1 pl-1.5" style={{ borderLeft: "1px solid var(--border-subtle)" }}>
              <AccountMenu viewer={viewer} fullName={fullName} />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1120px] mx-auto px-4 sm:px-6 py-6 pb-16">
        <div className="mb-5">
          <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
            {greeting(now.getHours())}, {firstName}
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--text-muted)" }}>{format(now, "EEEE, d MMMM yyyy")}</p>
        </div>

        {!employee || !view ? (
          <Card>
            <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
              We could not find an attendance record for you.
            </p>
            <p className="text-[13px] mt-1" style={{ color: "var(--text-muted)" }}>
              {viewer.email} is signed in, but it is not in the attendance list. New joiners appear after the
              next morning sync. If you have been here a while, tell People &amp; Culture.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">

            {/* ── The one thing that asks for action ── */}
            {view.missed.length > 0 && (
              <Card style={{ borderColor: "#f59e0b66", background: "linear-gradient(120deg, #f59e0b14, transparent 60%), var(--bg-surface)" }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: soft("#f59e0b"), color: "#f59e0b" }}>
                    <AlertCircle size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
                      {view.missed.length} {view.missed.length === 1 ? "day is" : "days are"} waiting for your answer
                    </div>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      Answer each one once. After you save, a past day cannot be changed.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {view.missed.map((d) => (
                        <button key={d} onClick={() => setAnswering(d)}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all active:scale-95 hover:border-[#f59e0b]"
                          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                          {dayLabel(d)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/*
              One grid, so phones and desktops can order the same cards
              differently: phones read Today, calendar, then the detail; wide
              screens read a row of summaries and then the calendar under it.
              The old tall side column made the page two unequal halves.
            */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">

              <div className="order-1">{todayCard}</div>

              <Card className="order-3 lg:order-2 flex flex-col">
                {(() => {
                  const v = weekVerdict(view.thisWeek);
                  return (
                    <>
                      <Heading>This week</Heading>
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full self-start mb-3"
                        style={{ background: soft(v.color), color: v.color }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: v.color }} />
                        {v.label}
                      </span>
                      <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{v.detail}</p>
                      {view.thisWeek.wfh < 1 - 0.001 && !isWeekend && view.thisWeek.wfhExcess < 0.001 && (
                        <p className="text-[12px] mt-auto pt-3" style={{ color: "var(--text-muted)" }}>
                          {view.thisWeek.wfh > 0.001 ? "Half" : "One"} WFH day still available this week.
                        </p>
                      )}
                    </>
                  );
                })()}
              </Card>

              <Card className="order-4 lg:order-3">
                <Heading>Your record</Heading>
                <div className="flex items-center gap-4">
                  <Ring pct={view.overall.pct} size={84} />
                  <div className="min-w-0">
                    <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>since {format(parseISO(dates[0] ?? today), "d MMM")}</div>
                    {view.weeksTotal > 0 && (
                      <div className="text-[13px] mt-1" style={{ color: "var(--text-secondary)" }}>
                        <span className="font-semibold font-mono" style={{ color: "var(--text-primary)" }}>
                          {view.weeksMet} of {view.weeksTotal}
                        </span>{" "}weeks fully met
                      </div>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="order-5 lg:order-4 flex flex-col justify-between gap-4">
                {view.wfa && (() => {
                  const { cap, used } = view.wfa;
                  const left = cap - used;
                  const over = left < -0.001;
                  const color = over ? "#ef4444" : left <= 2 ? "#f59e0b" : STATUS_COLORS["Anywhere"];
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Work from anywhere</h2>
                        <span className="text-[12px] font-semibold font-mono" style={{ color: over ? "#ef4444" : "var(--text-primary)" }}>
                          {over ? `${fmtDays(-left)} over` : `${fmtDays(left)} left`}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "var(--bg-inset)" }}>
                        <div className="h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, (used / (cap || 1)) * 100)}%`, background: color }} />
                      </div>
                      <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
                        {fmtDays(used)} of {fmtDays(cap)} used this year{over ? ". Extra days count against you." : "."}
                      </p>
                    </div>
                  );
                })()}

                <div className="flex items-center gap-3 pt-4" style={view.wfa ? { borderTop: "1px solid var(--border-subtle)" } : undefined}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: soft("#f97316"), color: "#f97316" }}>
                    <Flame size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                      <span className="font-mono">{view.streak.current}</span> {view.streak.current === 1 ? "day" : "days"} in the office
                    </div>
                    <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Best {view.streak.best}. Leave does not break it.</div>
                  </div>
                </div>
              </Card>

              <div className="order-2 lg:order-5 sm:col-span-2 lg:col-span-4">
                <MonthCalendar month={month} statuses={employee.statuses} today={today} oldest={oldest}
                  weekPct={view.weekPct} onWeek={setWeekOpen} canAnswer={canAnswer} onAnswer={setAnswering}
                  canPrev={month > earliest} canNext={month < startOfMonth(now)}
                  onMonth={(delta) => setMonth((m) => addMonths(m, delta))}
                  onToday={() => setMonth(startOfMonth(now))} allowance={employee.allowance}
                  earliestDay={dates[0] ?? today} />
              </div>

              {holidays.length > 0 && (
                <Card className="order-6 sm:col-span-2 lg:col-span-4 !py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8">
                    <h2 className="text-[13px] font-semibold flex items-center gap-2 flex-shrink-0" style={{ color: "var(--text-primary)" }}>
                      <CalendarDays size={15} style={{ color: "var(--text-muted)" }} /> Upcoming holidays
                    </h2>
                    <ul className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-3 flex-1">
                      {holidays.slice(0, 3).map((h) => {
                        const n = differenceInCalendarDays(parseISO(h.day), now);
                        const closed = h.kind === "closed";
                        return (
                          <li key={h.day} className="min-w-0">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{h.name}</span>
                              <span className="text-[11px] font-mono flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                                {n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n}d`}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{format(parseISO(h.day), "EEE d MMM")}</span>
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                                title={closed ? "The office is closed" : "Restricted holiday: optional, taken per person. The office is open."}
                                style={closed
                                  ? { background: soft("#f59e0b"), color: "#d97706" }
                                  : { background: "var(--accent-light)", color: "var(--accent)" }}>
                                {closed ? "Office closed" : "Optional"}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </Card>
              )}
            </div>

            <p className="text-[12px] leading-relaxed px-1 max-w-[760px]" style={{ color: "var(--text-muted)" }}>
              How this is scored: office days count in full, and you can work from home one day a week, on any
              weekday. A second day at home in the same week is the only thing that counts against you. Leave and
              work-from-anywhere days within your yearly allowance are left out.
            </p>
          </div>
        )}
      </main>

      {answering && employee && (
        <AnswerDialog day={answering} isToday={answering === today} current={employee.statuses[answering]}
          options={options} onClose={() => setAnswering(null)}
          onSubmit={(value, status) => submitAnswer(answering, value, status)} />
      )}

      {weekOpen && employee && (
        <WeekDialog weekStart={weekOpen} statuses={employee.statuses} allowance={employee.allowance}
          today={today} onClose={() => setWeekOpen(null)} />
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium animate-fade-in"
          style={{ background: "var(--text-primary)", color: "var(--bg-surface)", boxShadow: "var(--shadow-lg)" }}>
          <Check size={15} className="text-emerald-400" /> {toast}
        </div>
      )}
    </div>
  );
}

// ─── The month calendar ─────────────────────────────────────

const HATCH = (c: string) =>
  `repeating-linear-gradient(135deg, ${c}2e 0 6px, transparent 6px 12px)`;

function MonthCalendar({ month, statuses, today, oldest, weekPct, onWeek, canAnswer, onAnswer, canPrev, canNext, onMonth, onToday, allowance, earliestDay }: {
  month: Date; statuses: Record<string, string>; today: string; oldest: string;
  weekPct: Map<string, number | null>; onWeek: (weekStart: string) => void;
  canAnswer: (day: string) => boolean; onAnswer: (day: string) => void;
  canPrev: boolean; canNext: boolean; onMonth: (delta: number) => void; onToday: () => void;
  allowance?: Employee["allowance"];
  /** The first day with any record: week view cannot go back past its week. */
  earliestDay: string;
}) {
  // WEEK OR MONTH (requested 22 Oct 2026). Month is the default and unchanged;
  // week shows one Monday-to-Sunday row with room to read each day.
  const [mode, setMode] = useState<"month" | "week">("month");
  const thisWeek = startOfWeek(parseISO(today), { weekStartsOn: 1 });
  const [weekStart, setWeekStart] = useState(thisWeek);
  const firstWeek = startOfWeek(parseISO(earliestDay), { weekStartsOn: 1 });

  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const gridStart = startOfWeek(first, { weekStartsOn: 1 });
  const weeks: Date[][] = [];
  // WEEKDAYS ONLY (22 Oct 2026): Saturday and Sunday are not shown at all.
  // Nobody checks in on them and the score ignores them, so they only took
  // space. Each row is Monday to Friday plus the week's score.
  if (mode === "week") {
    weeks.push(Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)));
  } else {
    for (let w = gridStart; w <= last; w = addDays(w, 7)) {
      const days = Array.from({ length: 5 }, (_, i) => addDays(w, i));
      // A row with no day in this month is somebody else's week wearing this
      // month's header, with a score nobody asked about. Leave it out.
      if (days.some((d) => d.getMonth() === first.getMonth())) weeks.push(days);
    }
  }

  // The period's own tally doubles as the legend: a colour is named where it is used.
  const periodDates = mode === "week"
    ? weeks[0].map(iso)
    : Array.from({ length: last.getDate() }, (_, i) => iso(addDays(first, i)));
  const m = scorePeriod(statuses, periodDates.filter((d) => d <= today && statuses[d] !== "Pending" || d < today), allowance);
  const tally: [string, number, string][] = ([
    ["Office", m.wfo, STATUS_COLORS["Office"]],
    ["Home", m.wfh, STATUS_COLORS["Home"]],
    ["Leave", m.leave, STATUS_COLORS["Leave"]],
    ["Anywhere", m.wfa, STATUS_COLORS["Anywhere"]],
    ["Unanswered", m.pending, "#ef4444"],
  ] as [string, number, string][]).filter(([, n]) => n > 0.001);

  // FIVE EQUAL COLUMNS (22 Oct 2026). Weekends used to be half-width boxes,
  // which made the grid uneven; they are now not shown at all.
  const cols = "grid grid-cols-[repeat(5,minmax(0,1fr))_44px] sm:grid-cols-[repeat(5,minmax(0,1fr))_52px] gap-1.5 sm:gap-2";
  const isThisMonth = iso(startOfMonth(new Date())) === iso(first);
  const isThisWeek = iso(weekStart) === iso(thisWeek);
  const prevDisabled = mode === "week" ? weekStart <= firstWeek : !canPrev;
  const nextDisabled = mode === "week" ? weekStart >= thisWeek : !canNext;
  const step = (delta: number) => (mode === "week" ? setWeekStart((w) => addDays(w, 7 * delta)) : onMonth(delta));
  // KEYBOARD SHORTCUTS (22 Oct 2026): left/right arrows move a week or a month,
  // W and M switch the view, T comes back to now. Ignored while typing in a
  // field or while a dialog (the answer dialog) is open, and never with a
  // modifier key, so browser and system shortcuts are untouched.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowLeft" && !prevDisabled) stepRef.current(-1);
      else if (e.key === "ArrowRight" && !nextDisabled) stepRef.current(1);
      else if (k === "w") setMode("week");
      else if (k === "m") setMode("month");
      else if (k === "t") {
        if (mode === "week") setWeekStart(thisWeek);
        else onToday();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, prevDisabled, nextDisabled, thisWeek, onToday]);

  const title = mode === "week"
    ? `${format(weekStart, "d MMM")} - ${format(addDays(weekStart, 4), "d MMM yyyy")}`
    : format(first, "MMMM yyyy");

  return (
    <Card className="!p-4 sm:!p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} disabled={prevDisabled} aria-label={mode === "week" ? "Previous week" : "Previous month"} aria-keyshortcuts="ArrowLeft"
            className="p-1.5 rounded-lg transition-all disabled:opacity-30 hover:bg-[var(--bg-surface-hover)]" style={{ color: "var(--text-secondary)" }}>
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-[18px] font-semibold tracking-tight min-w-[150px] text-center" style={{ color: "var(--text-primary)" }}>
            {title}
          </h2>
          <button onClick={() => step(1)} disabled={nextDisabled} aria-label={mode === "week" ? "Next week" : "Next month"} aria-keyshortcuts="ArrowRight"
            className="p-1.5 rounded-lg transition-all disabled:opacity-30 hover:bg-[var(--bg-surface-hover)]" style={{ color: "var(--text-secondary)" }}>
            <ChevronRight size={18} />
          </button>
          {(mode === "week" ? !isThisWeek : !isThisMonth) && (
            <button onClick={() => (mode === "week" ? setWeekStart(thisWeek) : onToday())}
              className="ml-1 px-2.5 py-1 rounded-lg text-[12px] font-medium border hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
              {mode === "week" ? "This week" : "This month"}
            </button>
          )}
          {/* Week / Month switch. */}
          <div className="ml-2 inline-flex rounded-lg p-0.5" role="group" aria-label="Calendar view"
            style={{ background: "var(--bg-inset)" }}>
            {(["week", "month"] as const).map((v) => (
              <button key={v} onClick={() => setMode(v)} aria-pressed={mode === v} aria-keyshortcuts={v === "week" ? "W" : "M"}
                className="px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors"
                style={mode === v
                  ? { background: "var(--bg-surface)", color: "var(--text-primary)", boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,.2))" }
                  : { color: "var(--text-secondary)" }}>
                {v === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {tally.map(([label, n, color]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              {label} <span className="font-mono font-semibold" style={{ color: "var(--text-primary)" }}>{fmtDays(n)}</span>
            </span>
          ))}
        </div>
      </div>

      <div className={`${cols} mb-1.5`}>
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
          <div key={d} className="text-[11px] font-medium text-center" style={{ color: "var(--text-muted)" }}>{d}</div>
        ))}
        <div className="text-[11px] font-medium text-center" style={{ color: "var(--text-muted)" }}>Week</div>
      </div>

      <div className="space-y-1.5 sm:space-y-2">
        {weeks.map((week) => {
          const pct = weekPct.get(iso(week[0])) ?? null;
          return (
            <div key={iso(week[0])} className={cols}>
              {week.map((d) => (
                <Cell key={iso(d)} date={d} inMonth={mode === "week" || d.getMonth() === first.getMonth()} tall={mode === "week"} today={today} oldest={oldest}
                  status={statuses[iso(d)]} open={canAnswer(iso(d))} onAnswer={() => onAnswer(iso(d))} />
              ))}
              {pct === null ? <div /> : (
                <button onClick={() => onWeek(iso(week[0]))} title="Why this score?"
                  aria-label={`Week score ${pct} percent. Why?`}
                  className={`flex items-center justify-center rounded-lg text-[12px] font-semibold font-mono underline decoration-dotted underline-offset-4 hover:bg-[var(--bg-surface-hover)] ${pctClass(pct)}`}>
                  {pct}%
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-4 pt-3 text-[11px]"
        style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-3 rounded-[4px] border border-dashed" style={{ borderColor: "#f59e0b", background: HATCH("#f59e0b") }} />
          Waiting for your answer
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-3 rounded-[4px]" style={{ background: HATCH("#ef4444"), border: "1px solid #ef444466" }} />
          Unanswered, too old to change here
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-3 rounded-[4px] border border-dashed" style={{ borderColor: "var(--border-strong)" }} />
          No check-in
        </span>
        <span className="ml-auto hidden sm:inline-flex items-center gap-1.5">
          <Kbd>←</Kbd><Kbd>→</Kbd> move · <Kbd>W</Kbd> week · <Kbd>M</Kbd> month · <Kbd>T</Kbd> today
        </span>
      </div>
    </Card>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[18px] items-center justify-center rounded px-1 py-px font-mono text-[10px] font-semibold"
      style={{ border: "1px solid var(--border-default)", color: "var(--text-secondary)", background: "var(--bg-inset)" }}>
      {children}
    </kbd>
  );
}

function Cell({ date, inMonth, today, oldest, status, open, onAnswer, tall = false }: {
  date: Date; inMonth: boolean; today: string; oldest: string; status?: string; open: boolean; onAnswer: () => void;
  /** Week view: taller boxes, there is room for them. */
  tall?: boolean;
}) {
  const key = iso(date);
  const base = `relative ${tall ? "h-[110px] sm:h-[140px]" : "h-[64px] sm:h-[72px]"} rounded-xl p-1.5 sm:p-2 flex flex-col justify-between text-left`;

  if (!inMonth) return <div className={`${base} opacity-0`} aria-hidden />;

  const num = (
    <span className="text-[11px] sm:text-[12px] font-semibold leading-none"
      style={{ color: key === today ? "var(--accent)" : "var(--text-secondary)" }}>
      {date.getDate()}
    </span>
  );
  const ring = key === today ? { boxShadow: "0 0 0 2px var(--accent)" } : {};
  const name = format(date, "EEEE d MMMM");

  const future = key > today;
  if (!status || future) {
    return (
      <div className={base} style={{ border: "1.5px dashed var(--border-default)", ...ring }}
        aria-label={`${name}: ${future ? "upcoming" : "no check-in"}`}>
        {num}
      </div>
    );
  }

  const pending = status === "Pending";
  const v = viewOf(status);

  if (pending) {
    const tooOld = key < oldest;
    const c = key === today ? "#f59e0b" : tooOld ? "#ef4444" : "#f59e0b";
    const content = (
      <>
        {num}
        <span className="text-[10px] sm:text-[11px] font-semibold leading-tight" style={{ color: tooOld ? "#ef4444" : "#d97706" }}>
          {key === today || !tooOld ? "Answer" : "Unanswered"}
        </span>
      </>
    );
    const style = { background: HATCH(c), border: `1.5px ${tooOld ? "solid" : "dashed"} ${c}${tooOld ? "66" : ""}`, ...ring };
    return open
      ? <button onClick={onAnswer} className={`${base} transition-transform hover:scale-[1.04] active:scale-95`} style={style}
          aria-label={`${name}: not answered. Answer now`}>{content}</button>
      : <div className={base} style={style} aria-label={`${name}: not answered`}>{content}</div>;
  }

  const content = (
    <>
      {num}
      <span className="flex items-end justify-between gap-1" style={{ color: v.color }}>
        <v.Icon size={18} className="flex-shrink-0" />
        <span className="hidden sm:block text-[11px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{v.short}</span>
      </span>
    </>
  );
  const style = { background: soft(v.color), border: `1px solid ${v.color}33`, ...ring };
  return open
    ? <button onClick={onAnswer} className={`${base} transition-transform hover:scale-[1.04] active:scale-95`} style={style}
        aria-label={`${name}: ${status}. Change`}>{content}</button>
    : <div className={base} style={style} aria-label={`${name}: ${status}`}>{content}</div>;
}

// ─── Record ring ────────────────────────────────────────────

function Ring({ pct, size = 140 }: { pct: number | null; size?: number }) {
  const r = 54, c = 2 * Math.PI * r;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" strokeWidth="11" style={{ stroke: "var(--bg-inset)" }} />
        <circle cx="64" cy="64" r={r} fill="none" strokeWidth="11" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - (pct ?? 0) / 100)}
          style={{ stroke: barColor(pct), transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center font-semibold font-mono ${pctClass(pct)}`}
        style={{ fontSize: size * 0.24 }}>
        {pct === null ? "n/a" : `${pct}%`}
      </div>
    </div>
  );
}

// ─── Today ──────────────────────────────────────────────────

function Today({ employee, today, isWeekend, thisWeekWfh, editable, onAnswer }: {
  employee: Employee; today: string; isWeekend: boolean; thisWeekWfh: number;
  editable: boolean; onAnswer: () => void;
}) {
  const status = employee.statuses[today];

  let tone: View;
  let sub: string | null = null;

  if (!status) {
    tone = { verb: isWeekend ? "No check-in on weekends" : "No check-in today", short: "", Icon: Building2, color: "#6b7280" };
    sub = isWeekend ? "Your week starts on Monday." : "You were not asked today, so nothing counts for or against you.";
  } else {
    tone = viewOf(status);
    if (status === "Pending") sub = "Tell us where you are working today. It takes a few seconds.";
    else if (status === "Home") sub = thisWeekWfh > 1.001
      ? "This is more than one day at home this week."
      : "This uses your WFH day for the week.";
    else if (status === "Leave") sub = "Left out of your compliance.";
    else sub = "You can change this until the day ends.";
  }

  return (
    <Card className="h-full" style={{ borderLeft: `3px solid ${tone.color}`, background: `linear-gradient(120deg, ${soft(tone.color)}, transparent 60%), var(--bg-surface)` }}>
      <div className="text-[11px] uppercase tracking-[0.2em] mb-3 font-mono" style={{ color: "var(--text-muted)" }}>Today</div>
      <div className="flex items-center gap-3.5">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: soft(tone.color), color: tone.color }}>
          <tone.Icon size={24} />
        </div>
        <div className="min-w-0">
          <div className="text-[19px] leading-tight font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>{tone.verb}</div>
          {sub && <div className="text-[12px] mt-1" style={{ color: "var(--text-secondary)" }}>{sub}</div>}
        </div>
      </div>
      {editable && (
        <div className="mt-4">
          {status === "Pending" ? (
            <button onClick={onAnswer} className="w-full px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all active:scale-95 hover:brightness-110" style={primaryBtn}>
              Answer now
            </button>
          ) : (
            <button onClick={onAnswer} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium border transition-all active:scale-95 hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
              <Pencil size={13} /> Change answer
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Why a week scored what it did ──────────────────────────

function WeekDialog({ weekStart, statuses, allowance, today, onClose }: {
  weekStart: string; statuses: Record<string, string>; allowance?: Employee["allowance"];
  today: string; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = parseISO(weekStart);
  const days = Array.from({ length: WEEKDAYS }, (_, i) => iso(addDays(start, i)));
  // Same rule as the page: a day still Pending today is not a miss yet.
  const counted = days.filter((d) => statuses[d] && d <= today && (d < today || statuses[d] !== "Pending"));
  const s = scorePeriod(statuses, counted, allowance);

  const reasons: { ok: boolean; text: string }[] = [];
  if (s.available <= 0.001) {
    reasons.push({ ok: true, text: "No days this week counted towards a score, so there is no percentage to explain." });
  } else {
    reasons.push({ ok: s.isCompliant, text: `${fmtDays(s.adherent)} of ${fmtDays(s.available)} counted days met the policy.` });
    if (s.wfo > 0.001) reasons.push({ ok: true, text: `${fmtDays(s.wfo)} office ${s.wfo === 1 ? "day" : "days"} counted in full.` });
    if (s.wfh > 0.001) reasons.push({
      ok: s.wfhExcess < 0.001,
      text: s.wfhExcess > 0.001
        ? `${fmtDays(s.wfh)} days at home. One is allowed, so ${fmtDays(s.wfhExcess)} counted against you.`
        : "Your one WFH day this week was within the allowance.",
    });
    if (s.pending > 0) reasons.push({ ok: false, text: `${s.pending} ${s.pending === 1 ? "day was" : "days were"} never answered. Unanswered days count as missed.` });
  }
  if (s.leave > 0.001) reasons.push({ ok: true, text: `${fmtDays(s.leave)} leave ${s.leave === 1 ? "day was" : "days were"} left out of the score.` });
  if (s.wfaWithin > 0.001) reasons.push({ ok: true, text: `${fmtDays(s.wfaWithin)} work-from-anywhere ${s.wfaWithin === 1 ? "day was" : "days were"} left out (within your yearly allowance).` });

  return (
    <div className="animate-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div role="dialog" aria-modal="true" className="animate-modal card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-b-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>
              Week of {format(start, "d MMM")}
            </h2>
            <div className={`text-[26px] font-semibold font-mono leading-tight ${pctClass(s.pct)}`}>
              {s.pct === null ? "No score" : `${s.pct}%`}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)]" style={{ color: "var(--text-muted)" }}>
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-5 gap-2 mb-4">
          {days.map((d) => {
            const st = statuses[d];
            const v = st ? viewOf(st) : null;
            return (
              <div key={d} className="flex flex-col items-center gap-1">
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{format(parseISO(d), "EEE d")}</span>
                <div className="w-full h-11 rounded-lg flex items-center justify-center"
                  style={v ? { background: soft(v.color), color: v.color } : { border: "1.5px dashed var(--border-strong)" }}>
                  {v && <v.Icon size={18} />}
                </div>
                <span className="text-[10px] truncate max-w-full" style={{ color: "var(--text-secondary)" }}>{v ? v.short : "None"}</span>
              </div>
            );
          })}
        </div>

        <ul className="space-y-2">
          {reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px]" style={{ color: "var(--text-secondary)" }}>
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: r.ok ? "#22c55e" : "#ef4444" }} />
              {r.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── The picker ─────────────────────────────────────────────

type Option = { value: string; status: string };

function AnswerDialog({ day, isToday, current, options, onClose, onSubmit }: {
  day: string; isToday: boolean; current?: string; options: Option[];
  onClose: () => void; onSubmit: (value: string, status: string) => void;
}) {
  // Preselect what is stored now, so "change" starts from the truth.
  const [picked, setPicked] = useState<string | null>(() => options.find((o) => o.status === current)?.value ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    const chosen = options.find((o) => o.value === picked);
    if (chosen) onSubmit(chosen.value, chosen.status);
  };

  return (
    <div className="animate-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div role="dialog" aria-modal="true" className="animate-modal card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-b-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {isToday ? "Where are you working today?" : `Where were you on ${dayLabel(day)}?`}
          </h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)]" style={{ color: "var(--text-muted)" }}>
            <X size={16} />
          </button>
        </div>
        <p className="text-[12px] mb-4" style={{ color: "var(--text-muted)" }}>
          {isToday
            ? "You can change this again until the day ends."
            : "You can answer a missed day once. After you save, it cannot be changed."}
        </p>

        {options.length === 0 ? (
          <p className="py-8 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
            The options did not load. Refresh the page and try again.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[52vh] overflow-y-auto pr-0.5">
            {options.map((o) => {
              const v = viewOf(o.status);
              const on = picked === o.value;
              return (
                <button key={o.value} onClick={() => setPicked(o.value)} aria-pressed={on}
                  className="flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all active:scale-[0.98]"
                  style={{
                    borderColor: on ? "var(--accent)" : "var(--border-default)",
                    background: on ? "var(--accent-light)" : "var(--bg-surface)",
                    boxShadow: on ? "var(--shadow-glow)" : undefined,
                  }}>
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: soft(v.color), color: v.color }}>
                    <v.Icon size={16} />
                  </span>
                  <span className="text-[13px] font-medium leading-tight" style={{ color: "var(--text-primary)" }}>{v.verb}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-[13px] font-medium hover:bg-[var(--bg-surface-hover)]" style={{ color: "var(--text-secondary)" }}>
            Cancel
          </button>
          <button onClick={save} disabled={!picked}
            className="px-5 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-40 transition-all active:scale-95 " style={primaryBtn}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
