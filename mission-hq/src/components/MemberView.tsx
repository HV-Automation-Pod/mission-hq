"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  addDays, addMonths, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, startOfWeek, subDays,
} from "date-fns";
import {
  AlertCircle, ArrowLeftRight, ArrowRight, Building2, CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp,
  Flame, Globe, Home, Info, LayoutGrid, Leaf, Loader2, Lock, LogOut, MapPin, Menu, Pencil, Plane, X, type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import Tooltip from "@/components/Tooltip";
import { answerMyAttendance } from "@/lib/actions";
import { calculateWeeklyCompliance } from "@/lib/utils";
import { DAY_WEIGHTS, fmtDays, isRealWeek, scorePeriod, type PeriodScore } from "@/lib/policy";
import type { Employee } from "@/lib/types";

/**
 * The member view, in the "Petrol & Oat" design (Penpot export, 23 Oct 2026).
 *
 * A sidebar and four pages: Overview, My attendance, Policies, Allowances. On
 * a phone the sidebar becomes a top bar and a bottom tab bar.
 *
 * HOW THE PALETTE IS APPLIED. The rest of the app is built on CSS variables
 * (`--bg-surface`, `--text-primary`, the `.card` class). This subtree redefines
 * those same variables, so every existing class inside it takes the design's
 * colours without being rewritten, and nothing outside it changes. The design
 * is light only, so the page drops the `dark` class while mounted.
 *
 * WHAT IT DOES NOT DECIDE. Who may answer which day is `answerMyAttendance` on
 * the server; scoring is `lib/policy.ts`. This file only decides what is worth
 * OFFERING and how to show it. A day still Pending TODAY is left out of every
 * rate here, because it is not a miss yet.
 */

// ─── Palette ────────────────────────────────────────────────

const C = {
  canvas: "#F7F8F5", surface: "#FFFFFF", text: "#172B2C", text2: "#536467", muted: "#65767A",
  border: "#DDE5E2", primary: "#125B60", brand: "#16727A", selected: "#E9F3F1", inset: "#F0F3F0",
  office: "#18734B", officeSoft: "#EAF6EE", home: "#4338CA", homeSoft: "#EEF2FF",
  warn: "#995510", warnSoft: "#FFFAEB", bad: "#B42318", leave: "#5F6B6E", leaveSoft: "#EEF1F0",
} as const;

const SCOPE = {
  "--bg-app": C.canvas, "--bg-surface": C.surface, "--bg-surface-secondary": C.inset,
  "--bg-surface-hover": "#EEF3F1", "--bg-inset": C.inset,
  "--border-default": C.border, "--border-subtle": "#E7EDEA", "--border-strong": "#C3D0CC",
  "--text-primary": C.text, "--text-secondary": C.text2, "--text-muted": C.muted, "--text-faint": "#9AA9AC",
  "--accent": C.primary, "--accent-hover": "#0E4A4E", "--accent-light": C.selected, "--accent-muted": "#BFDAD5",
  "--shadow-xs": "0 1px 2px 0 rgb(0 0 0 / 4%)", "--shadow-sm": "0 2px 4px 0 rgb(0 0 0 / 2%)",
  "--shadow-lg": "0 12px 32px rgb(23 43 44 / 14%)", "--shadow-glow": "0 0 0 3px rgb(18 91 96 / 18%)",
  "--radius-lg": "16px",
  fontFamily: 'var(--font-geist), -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  letterSpacing: "0",
  background: C.canvas, color: C.text,
} as React.CSSProperties;

const WEEKDAYS = 5;
const WEEKS_SHOWN = 8;
/** Mirrors BACKFILL_DAYS in lib/actions.ts. The server is the one that enforces it. */
const BACKFILL_DAYS = 60;

type View = { verb: string; short: string; Icon: LucideIcon; color: string; bg: string };
const mk = (verb: string, short: string, Icon: LucideIcon, color: string, bg: string): View => ({ verb, short, Icon, color, bg });

const OFFICE = (v: string, s: string, i: LucideIcon = Building2) => mk(v, s, i, C.office, C.officeSoft);
const VIEWS: Record<string, View> = {
  "Office":                OFFICE("In the office", "Office"),
  "Office + Client":       OFFICE("Office and client", "Office"),
  "Compensatory WFH":      OFFICE("Compensatory day", "Comp"),
  "Client Location":       OFFICE("At a client site", "Client", MapPin),
  "Travel":                OFFICE("Travelling", "Travel", Plane),
  "Home":                  mk("Working from home", "Home", Home, C.home, C.homeSoft),
  "Half Day WFH Leave":    mk("Half day, home", "Half", Home, C.home, C.homeSoft),
  "Split Day":             mk("Split day", "Split", ArrowLeftRight, C.brand, C.selected),
  "Leave":                 mk("On leave", "Leave", Leaf, C.leave, C.leaveSoft),
  "Half Day Office Leave": mk("Half day, office", "Half", Leaf, C.leave, C.leaveSoft),
  "Anywhere":              mk("Working from anywhere", "Anywhere", Globe, C.primary, C.selected),
  "Pending":               mk("Not answered yet", "Pending", AlertCircle, C.warn, C.warnSoft),
};
const viewOf = (s: string): View => VIEWS[s] ?? mk(s, s, MapPin, C.leave, C.leaveSoft);

// ─── Helpers ────────────────────────────────────────────────

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const dayLabel = (d: string) => format(parseISO(d), "EEE d MMM");
const istNow = () => new Date(Date.now() + 5.5 * 3600_000);

function pctColor(pct: number | null): string {
  if (pct === null) return C.muted;
  // The report's own cut-offs (migration 50): 80+ is "just short" or better, 60-79
  // "some way short", under 60 "needs attention". Colours follow the same lines
  // so a member never sees green here and a worse band in the report.
  return pct >= 80 ? C.office : pct >= 60 ? C.warn : C.bad;
}
const greeting = (h: number) => (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");

function weekVerdict(s: PeriodScore): { label: string; detail: string; color: string; bg: string } {
  if (s.wfhExcess > 0.001) return { label: "Over the WFH limit", color: C.warn, bg: C.warnSoft,
    detail: "You have worked from home more than one day this week. Only one is included." };
  if (s.pending > 0) return { label: "Unanswered days", color: C.warn, bg: C.warnSoft,
    detail: `${s.pending} past ${s.pending === 1 ? "day has" : "days have"} no answer.` };
  if (s.available <= 0.001) return { label: "Nothing to score", color: C.leave, bg: C.leaveSoft, detail: "No days this week count towards the score yet." };
  return { label: "On track", color: C.office, bg: C.officeSoft,
    detail: `${fmtDays(s.adherent)} of ${fmtDays(s.available)} counted ${s.available === 1 ? "day" : "days"} met the policy.` };
}


type Option = { value: string; status: string };
type Holiday = { day: string; name: string; kind: "closed" | "optional" };
type Page = "overview" | "attendance" | "policies" | "allowances";

const NAV: { id: Page; label: string; Icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", Icon: LayoutGrid },
  { id: "attendance", label: "My attendance", Icon: CalendarDays },
  { id: "policies", label: "Policies", Icon: Info },
  { id: "allowances", label: "Allowances", Icon: Globe },
];

// ─── Small pieces ───────────────────────────────────────────

function Card({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <section className={`rounded-2xl p-5 sm:p-6 ${className}`}
    style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "var(--shadow-xs), var(--shadow-sm)", ...style }}>{children}</section>;
}

function Pill({ children, color, bg, className = "" }: { children: React.ReactNode; color: string; bg: string; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full ${className}`} style={{ color, background: bg }}>{children}</span>;
}

const btnPrimary: React.CSSProperties = { background: C.primary, color: "#fff", borderRadius: 10, minHeight: 44 };
const btnOutline: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 10, minHeight: 44 };
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#125B60]";

function LinkButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className={`inline-flex items-center gap-1.5 text-[13px] font-medium rounded ${focusRing}`} style={{ color: C.home }}>{children}</button>;
}

/** `cap` segments, `used` of them filled. */
function Segments({ cap, used, color = C.home }: { cap: number; used: number; color?: string }) {
  const n = Math.max(1, Math.round(cap));
  return (
    <div className="flex gap-1.5" role="img" aria-label={`${fmtDays(used)} of ${fmtDays(cap)} days used`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="h-2 flex-1 rounded-full" style={{ background: i < Math.floor(used + 0.001) ? color : i < used ? `${color}88` : C.inset }} />
      ))}
    </div>
  );
}

// ─── Data shape shared by the pages ─────────────────────────

type ViewData = {
  weekDays: string[]; thisWeek: PeriodScore; overall: PeriodScore; missed: string[]; weekPct: Map<string, number | null>;
  wfa: { cap: number; before: number; rows: { day: string; used: number }[]; used: number; year: string } | null;
  streak: { current: number; best: number }; weeksMet: number; weeksTotal: number;
  recent: ReturnType<typeof calculateWeeklyCompliance>;
};

type PageProps = {
  employee: Employee; view: ViewData; today: string; now: Date; oldest: string;
  month: Date; setMonth: (fn: (m: Date) => Date) => void; earliest: Date;
  canAnswer: (day: string) => boolean; onAnswer: (day: string) => void; onWeek: (weekStart: string) => void;
  setPage: (p: Page) => void; holidays: Holiday[]; isWeekend: boolean; onReview: () => void;
};

// ─── The component ──────────────────────────────────────────

export default function MemberView({ employee: loaded, dates, viewer, options, holidays, onChanged, onBackToAdmin }: {
  employee: Employee | null;
  dates: string[];
  viewer: { email: string; role: string };
  options: Option[];
  holidays: Holiday[];
  /** Set for an admin looking at their own attendance: the way back. */
  onBackToAdmin?: () => void;
  /** Re-fetch the payload after an answer is saved. */
  onChanged: () => Promise<void> | void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPageState] = useState<Page>(() => {
    if (typeof window === "undefined") return "overview";
    const p = new URLSearchParams(window.location.search).get("page");
    return (NAV.some((n) => n.id === p) ? p : "overview") as Page;
  });
  const setPage = (p: Page) => { setPageState(p); setMenuOpen(false); window.scrollTo({ top: 0 }); };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (page === "overview") params.delete("page"); else params.set("page", page);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", next);
  }, [page]);

  // The design is light only. The theme provider puts `dark` on <html>; take it
  // off while this view is mounted and give it back if it was on.
  useEffect(() => {
    const root = document.documentElement;
    const was = root.classList.contains("dark");
    root.classList.remove("dark");
    // Smooth only while this view is up: the admin dashboard keeps its own feel.
    const behaviour = root.style.scrollBehavior;
    root.style.scrollBehavior = "smooth";
    return () => { if (was) root.classList.add("dark"); root.style.scrollBehavior = behaviour; };
  }, []);

  const [answering, setAnswering] = useState<string | null>(null);
  const [weekOpen, setWeekOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  // "Review missing days": the days to walk through, oldest first. Null when not reviewing.
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(null);
  const [month, setMonth] = useState(() => startOfMonth(parseISO(istNow().toISOString().slice(0, 10))));
  // Answers saved but not yet confirmed by a refetch, laid over the server's data
  // so the page changes the instant somebody saves.
  const [pendingSaves, setPendingSaves] = useState<Record<string, string>>({});

  const employee = useMemo(
    () => (loaded && Object.keys(pendingSaves).length ? { ...loaded, statuses: { ...loaded.statuses, ...pendingSaves } } : loaded),
    [loaded, pendingSaves],
  );

  const today = istNow().toISOString().slice(0, 10);
  /** After a day is answered or skipped during a review, open the next one. */
  const advanceReview = (day: string) => {
    const next = reviewQueue?.[reviewQueue.indexOf(day) + 1];
    if (next) setAnswering(next); else { setAnswering(null); setReviewQueue(null); }
  };
  const startReview = () => {
    const q = view?.missed ?? [];
    if (q.length === 0) return;
    setReviewQueue(q);
    setAnswering(q[0]);
  };
  const submitAnswer = (day: string, value: string, status: string) => {
    if (reviewQueue) advanceReview(day); else setAnswering(null);
    setPendingSaves((p) => ({ ...p, [day]: status }));
    setToast(`${day === today ? "Today" : dayLabel(day)} saved as ${viewOf(status).verb.toLowerCase()}`);
    answerMyAttendance(day, value).then((r) => {
      if (!r.ok) setToast(r.error);
      // Success or not, drop the local copy: the refetch carries the truth, or the
      // answer was refused and the old state should come back.
      return Promise.resolve(onChanged()).finally(() =>
        setPendingSaves((p) => { const { [day]: _gone, ...rest } = p; return rest; }));
    });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const now = parseISO(today); // local midnight of the IST date, for date-fns arithmetic
  const hour = istNow().getUTCHours();
  const oldest = iso(subDays(now, BACKFILL_DAYS));
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  const view = useMemo<ViewData | null>(() => {
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
    // `now` is rebuilt every render; `today` only changes at midnight.
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
  const name = fullName ?? viewer.email.split("@")[0];
  const firstName = name.split(/[\s._-]+/)[0];
  const initials = name.split(/[\s._-]+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const earliest = startOfMonth(parseISO(dates[0] ?? today));

  const signOut = async () => {
    setLeaving(true);
    try {
      await createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!).auth.signOut();
    } finally {
      // Navigate either way: a failed sign-out that leaves somebody on a page they
      // think they have left is the worse outcome, and the middleware sends them
      // back to /login if the cookie survived.
      location.href = "/login";
    }
  };

  const shared: PageProps | null = employee && view ? { employee, view, today, now, oldest, month, setMonth, earliest, canAnswer,
    onAnswer: setAnswering, onWeek: setWeekOpen, setPage, holidays, isWeekend, onReview: startReview } : null;

  return (
    <div className="min-h-dvh" style={SCOPE}>

      {/* ── Sidebar (desktop) ── */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[232px] flex-col z-30" style={{ background: C.canvas, borderRight: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-3 px-6 pt-7 pb-8">
          <BrandMark size={40} />
          <div>
            <div className="text-[19px] font-semibold leading-tight tracking-tight">MissionHQ</div>
            <div className="text-[10px] tracking-[0.18em]" style={{ color: C.muted }}>HYPERVERGE</div>
          </div>
        </div>
        <div className="px-6 pb-3 text-[11px] tracking-[0.14em]" style={{ color: C.muted }}>MY WORKSPACE</div>
        <nav className="px-3 space-y-1" aria-label="My workspace">
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setPage(id)} aria-current={page === id ? "page" : undefined}
              className={`relative w-full flex items-center gap-3 px-3.5 h-11 rounded-xl text-[14px] font-medium transition-colors hover:bg-[#EEF3F1] ${focusRing}`}
              style={page === id ? { background: C.selected, color: C.text } : { color: C.text2 }}>
              {page === id && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r" style={{ background: C.primary }} />}
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto p-3 space-y-3">
          <div className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 text-[13px] font-medium"><Lock size={14} /> Your own record</div>
            <p className="text-[12px] mt-1.5 leading-snug" style={{ color: C.muted }}>Attendance and balances, in one personal view.</p>
          </div>
          <div className="flex items-center gap-3 px-3 h-10 text-[13px]" style={{ color: C.text2 }}><CircleHelp size={17} /> People &amp; Culture</div>
          {onBackToAdmin && (
            <button onClick={onBackToAdmin} className={`w-full flex items-center gap-2.5 px-3 h-10 rounded-xl text-[13px] font-medium hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.primary }}>
              <ArrowRight size={15} className="rotate-180" /> Back to team view
            </button>
          )}
          <div className="pt-3 flex items-center gap-3 px-1" style={{ borderTop: `1px solid ${C.border}` }}>
            <span className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0" style={{ background: C.selected, color: C.primary }}>{initials}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium truncate">{name}</div>
              <div className="text-[11px]" style={{ color: C.muted }}>{onBackToAdmin ? "Admin" : "Member"}</div>
            </div>
            <Tooltip label="Sign out" side="top">
              <button onClick={() => setConfirmOut(true)} aria-label="Sign out"
                className={`p-2 rounded-lg hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.muted }}>
                <LogOut size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      </aside>

      {/* ── Top bar (phone) ── */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-5 h-16" style={{ background: C.canvas, borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-3">
          <BrandMark size={34} />
          <div>
            <div className="text-[15px] font-semibold leading-tight">MissionHQ</div>
            <div className="text-[9px] tracking-[0.18em]" style={{ color: C.muted }}>HYPERVERGE</div>
          </div>
        </div>
        <button onClick={() => setMenuOpen((v) => !v)} aria-label="Menu" aria-expanded={menuOpen} className={`p-2 rounded-lg ${focusRing}`} style={{ color: C.text2 }}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        {menuOpen && (
          <div className="absolute right-4 top-[60px] w-64 rounded-2xl p-3 z-50" style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "var(--shadow-lg)" }}>
            <div className="flex items-center gap-3 px-2 pb-3 mb-2" style={{ borderBottom: `1px solid ${C.border}` }}>
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold" style={{ background: C.selected, color: C.primary }}>{initials}</span>
              <div className="min-w-0"><div className="text-[13px] font-medium truncate">{name}</div><div className="text-[11px] truncate" style={{ color: C.muted }}>{viewer.email}</div></div>
            </div>
            {onBackToAdmin && <button onClick={onBackToAdmin} className="w-full text-left px-2 h-10 text-[13px] font-medium" style={{ color: C.primary }}>Back to team view</button>}
            <button onClick={() => { setMenuOpen(false); setConfirmOut(true); }} className="w-full flex items-center gap-2 px-2 h-10 text-[13px] font-medium" style={{ color: C.text2 }}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        )}
      </header>

      {/* ── Page ── */}
      <div className="lg:pl-[232px]">
        <main className="mx-auto max-w-[1168px] px-5 lg:px-10 pt-6 lg:pt-8 pb-28 lg:pb-14">
          {!shared ? (
            <Card>
              <p className="text-[15px] font-semibold">We could not find an attendance record for you.</p>
              <p className="text-[13px] mt-1.5" style={{ color: C.text2 }}>
                {viewer.email} is signed in, but it is not in the attendance list. New joiners appear after the next
                morning sync. If you have been here a while, tell People &amp; Culture.
              </p>
            </Card>
          ) : page === "overview" ? (
            <Overview {...shared} firstName={firstName} hour={hour} />
          ) : page === "attendance" ? (
            <AttendancePage {...shared} />
          ) : page === "policies" ? (
            <PoliciesPage {...shared} />
          ) : (
            <AllowancesPage {...shared} />
          )}
        </main>
      </div>

      {/* ── Tab bar (phone) ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 gap-2 p-3" style={{ background: C.canvas, borderTop: `1px solid ${C.border}` }} aria-label="My workspace">
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setPage(id)} aria-current={page === id ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 rounded-xl h-[52px] text-[11px] font-medium ${focusRing}`}
            style={page === id ? { background: C.selected, color: C.primary } : { background: C.surface, color: C.text2, border: `1px solid ${C.border}` }}>
            <Icon size={16} /> {id === "attendance" ? "Attendance" : label}
          </button>
        ))}
      </nav>

      {confirmOut && (
        <Modal onClose={() => !leaving && setConfirmOut(false)}>
          <h2 className="text-[18px] font-semibold">Sign out of MissionHQ?</h2>
          <p className="text-[13px] mt-2" style={{ color: C.text2 }}>You will need to sign in with Google again to see your attendance.</p>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setConfirmOut(false)} disabled={leaving} className={`px-4 h-11 rounded-[10px] text-[14px] font-medium hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}>Cancel</button>
            <button onClick={signOut} disabled={leaving} className={`px-6 inline-flex items-center gap-2 text-[14px] font-semibold disabled:opacity-60 ${focusRing}`} style={btnPrimary}>
              {leaving && <Loader2 size={15} className="animate-spin" />} Sign out
            </button>
          </div>
        </Modal>
      )}
      {answering && employee && (
        <AnswerDialog key={answering} day={answering} isToday={answering === today} current={employee.statuses[answering]} options={options}
          progress={reviewQueue && reviewQueue.includes(answering) ? { index: reviewQueue.indexOf(answering) + 1, total: reviewQueue.length } : undefined}
          onSkip={reviewQueue ? () => advanceReview(answering) : undefined}
          onClose={() => { setAnswering(null); setReviewQueue(null); }} onSubmit={(value, status) => submitAnswer(answering, value, status)} />
      )}
      {weekOpen && employee && (
        <WeekDialog weekStart={weekOpen} statuses={employee.statuses} allowance={employee.allowance} today={today} onClose={() => setWeekOpen(null)} />
      )}
      {toast && (
        <div role="status" className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium"
          style={{ background: C.text, color: "#fff", boxShadow: "var(--shadow-lg)" }}>
          <Check size={15} style={{ color: "#86EFAC" }} /> {toast}
        </div>
      )}
    </div>
  );
}

function PageHead({ crumb, title, sub, aside }: { crumb?: string; title: string; sub: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-6 lg:mb-8 flex items-start justify-between gap-4">
      <div>
        {crumb && <div className="text-[11px] tracking-[0.14em] mb-3" style={{ color: C.muted }}>{crumb}</div>}
        <h1 className="text-[34px] lg:text-[32px] font-semibold leading-tight tracking-tight">{title}</h1>
        <p className="text-[14px] mt-2 max-w-[560px]" style={{ color: C.text2 }}>{sub}</p>
      </div>
      {aside}
    </div>
  );
}

const PersonalChip = () => (
  <span className="hidden lg:inline-flex items-center gap-2 text-[12px] px-3 h-8 rounded-full flex-shrink-0" style={{ background: C.inset, color: C.muted }}>
    <Lock size={12} /> Personal view
  </span>
);

// ─── Overview ───────────────────────────────────────────────

function Overview(p: PageProps & { firstName: string; hour: number }) {
  const { employee, view, today, now, canAnswer, onAnswer, setPage, holidays, isWeekend } = p;
  const v = weekVerdict(view.thisWeek);
  const weekStart = parseISO(view.weekDays[0]);
  const range = `${format(weekStart, "d")}–${format(addDays(weekStart, 4), "d MMMM")}`;
  const missed = view.missed;

  return (
    <>
      <div className="mb-6 lg:mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] lg:text-[13px] mb-3 lg:mb-4 uppercase lg:normal-case tracking-[0.08em] lg:tracking-normal" style={{ color: C.muted }}>
            {format(now, "EEEE, d MMMM")}<span className="hidden lg:inline">{format(now, " yyyy")}</span>
          </div>
          <h1 className="text-[34px] lg:text-[32px] font-semibold leading-tight tracking-tight">{greeting(p.hour)}, {p.firstName}.</h1>
          <p className="hidden lg:block text-[14px] mt-3" style={{ color: C.text2 }}>Your personal attendance, with a clear view of what&apos;s next.</p>
        </div>
        <PersonalChip />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        {/* The left column is the shorter one. It stays pinned while the page
            scrolls through the longer right column, then lets go at the end:
            no nested scrollbar, one scroll, nothing fighting for the wheel. */}
        <StickyColumn className="space-y-6 min-w-0">
          <TodayCard employee={employee} today={today} isWeekend={isWeekend} editable={canAnswer(today)} onAnswer={() => onAnswer(today)} />

          {/* Phone: the design shows this week as five cards, with History for the rest. */}
          <section className="lg:hidden">
            <div className="flex items-end justify-between mb-3">
              <div>
                <h2 className="text-[20px] font-semibold">My attendance</h2>
                <div className="text-[13px] mt-1" style={{ color: C.muted }}>{range}</div>
              </div>
              <LinkButton onClick={() => setPage("attendance")}>History <ArrowRight size={14} /></LinkButton>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {view.weekDays.map((d) => <WeekCell key={d} day={d} today={today} status={employee.statuses[d]}
                open={canAnswer(d)} onAnswer={() => onAnswer(d)} />)}
            </div>
          </section>

          <div className="hidden lg:block">
            <CalendarCard {...p} />
          </div>

        <Card className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 !py-5">
          <div className="text-[34px] font-semibold tracking-tight leading-none" style={{ color: pctColor(view.overall.pct) }}>
            {view.overall.pct === null ? "n/a" : `${view.overall.pct}%`}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">Policy adherence since {format(parseISO(p.employee.allowance?.windowDates[0] ?? view.recent[0]?.weekStart ?? today), "d MMMM")}</div>
            <div className="text-[12px] mt-0.5" style={{ color: C.muted }}>
              {view.weeksTotal > 0 ? `${view.weeksMet} of ${view.weeksTotal} completed weeks fully met` : "No completed weeks yet"}
              {view.streak.current > 0 && <> &middot; <Flame size={11} className="inline -mt-0.5" style={{ color: "#c2410c" }} /> {view.streak.current}-day office streak (best {view.streak.best})</>}
            </div>
          </div>
          <LinkButton onClick={() => setPage("policies")}>Understand your record <ArrowRight size={14} /></LinkButton>
        </Card>
        </StickyColumn>

        <div className="space-y-6 min-w-0">
          {missed.length > 0 ? <MissingCard missed={missed} onAnswer={onAnswer} onReview={p.onReview} />
            : <Card className="flex items-center gap-3"><span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: C.officeSoft, color: C.office }}><Check size={17} /></span>
                <div><div className="text-[15px] font-semibold">Your record is complete</div><div className="text-[12px]" style={{ color: C.muted }}>Nothing is waiting for an answer.</div></div></Card>}

          <Card>
            <h2 className="text-[17px] font-semibold">This week</h2>
            <div className="text-[13px] mt-1" style={{ color: C.muted }}>{range}</div>
            <div className="flex items-center gap-5 mt-5">
              <div className="text-[44px] leading-none font-semibold tracking-tight" style={{ color: v.label === "On track" ? C.text : pctColor(view.thisWeek.pct) }}>
                {view.thisWeek.pct === null ? "n/a" : `${view.thisWeek.pct}%`}
              </div>
              <p className="text-[13px] leading-snug" style={{ color: C.text2 }}>{v.detail}</p>
            </div>
            <div className="h-2 rounded-full mt-4" style={{ background: C.inset }}>
              <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${view.thisWeek.pct ?? 0}%`, background: C.primary }} />
            </div>
            {view.thisWeek.wfh > 0.001 && (
              <p className="text-[12px] mt-3" style={{ color: view.thisWeek.wfhExcess > 0.001 ? C.warn : C.muted }}>
                {fmtDays(view.thisWeek.wfh)} home {view.thisWeek.wfh === 1 ? "day" : "days"} recorded &middot; {fmtDays(Math.min(view.thisWeek.wfh, 1))} included weekly
              </p>
            )}
            <div className="mt-4 flex"><LinkButton onClick={() => setPage("policies")}>View weekly breakdown <ArrowRight size={14} /></LinkButton></div>
          </Card>

          <WfaCard view={view} onMore={() => setPage("allowances")} />

          {holidays.length > 0 && (
            <Card>
              <h2 className="text-[17px] font-semibold mb-4">Coming up</h2>
              <ul className="space-y-3.5">
                {holidays.slice(0, 3).map((h) => {
                  const d = parseISO(h.day);
                  const n = differenceInCalendarDays(d, now);
                  return (
                    <li key={h.day} className="flex items-center gap-3.5">
                      <span className="w-11 h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0" style={{ background: C.inset }}>
                        <span className="text-[15px] font-semibold leading-none">{format(d, "dd")}</span>
                        <span className="text-[9px] tracking-wide mt-0.5" style={{ color: C.muted }}>{format(d, "MMM").toUpperCase()}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium truncate">{h.name}</span>
                        <span className="block text-[11px]" style={{ color: h.kind === "closed" ? C.muted : C.home }}
                          title={h.kind === "closed" ? "The office is closed" : "Restricted holiday: optional, taken per person. The office is open."}>
                          {h.kind === "closed" ? "Office closed" : "Optional holiday"}
                        </span>
                      </span>
                      <span className="text-[11px] flex-shrink-0" style={{ color: C.muted }}>{n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n}d`}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>

    </>
  );
}

/**
 * A column that sticks while a taller neighbour scrolls past it.
 *
 * A column taller than the screen cannot simply be `top: 24px`: its bottom
 * would stay below the fold until the very end of the page. So `top` is
 * negative by exactly the overhang, and the column pins when ITS BOTTOM reaches
 * the bottom of the screen. That is the whole trick, and it needs the column's
 * real height, which changes (dialogs, week/month view), hence the observer.
 */
function StickyColumn({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(24);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setTop(Math.min(24, window.innerHeight - el.offsetHeight - 24));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  return <div ref={ref} className={`lg:sticky ${className}`} style={{ top }}>{children}</div>;
}

// ─── Today ──────────────────────────────────────────────────

function TodayCard({ employee, today, isWeekend, editable, onAnswer }: {
  employee: Employee; today: string; isWeekend: boolean; editable: boolean; onAnswer: () => void;
}) {
  const status = employee.statuses[today];
  const answered = !!status && status !== "Pending";
  const tone = status ? viewOf(status) : mk(isWeekend ? "No check-in on weekends" : "No check-in today", "", Building2, C.leave, C.leaveSoft);
  const sub = !status ? (isWeekend ? "Your week starts on Monday." : "You were not asked today, so nothing counts for or against you.")
    : status === "Pending" ? "Tell us where you are working today. It takes a few seconds."
    : status === "Leave" ? "Left out of your score. Leave is managed in Zoho."
    : "You can change today’s answer until midnight IST.";

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] tracking-[0.14em]" style={{ color: C.muted }}>TODAY</div>
        {answered && <Pill color={C.office} bg={C.officeSoft}><Check size={12} /> Saved</Pill>}
        {status === "Pending" && <Pill color={C.warn} bg={C.warnSoft}>Needs your answer</Pill>}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 mt-3">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <span className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: tone.bg, color: tone.color }}><tone.Icon size={26} /></span>
          <div className="min-w-0">
            <div className="text-[26px] sm:text-[28px] leading-tight font-semibold tracking-tight">{tone.verb}</div>
            <p className="text-[13px] mt-1" style={{ color: C.text2 }}>{sub}</p>
          </div>
        </div>
        {editable && (
          <button onClick={onAnswer} className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 text-[14px] font-semibold transition-opacity hover:opacity-90 flex-shrink-0 ${focusRing}`} style={btnPrimary}>
            {status === "Pending" ? "Answer now" : <><Pencil size={15} /> Change answer</>}
          </button>
        )}
      </div>
    </Card>
  );
}

// ─── Missing answers ────────────────────────────────────────

function MissingCard({ missed, onAnswer, onReview, compact = false }: {
  missed: string[]; onAnswer: (d: string) => void; onReview: () => void; compact?: boolean;
}) {
  const shown = missed.slice(0, compact ? 8 : 4);
  const chips = shown.map((d) => (
    <button key={d} onClick={() => onAnswer(d)} className={`h-9 px-3.5 rounded-lg text-[13px] font-medium transition-colors hover:bg-[#E3EAE7] ${focusRing}`} style={{ background: C.inset }}>
      {format(parseISO(d), "d MMM")}
    </button>
  ));
  const more = missed.length > shown.length && <span className="text-[12px] self-center" style={{ color: C.muted }}>+ {missed.length - shown.length} more</span>;

  // On its own page it is one slim row; in the side column it stacks, and is
  // smaller than it was: a prompt for a few days should not out-weigh the week.
  if (compact) {
    return (
      <Card className="!p-4 sm:!px-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <Pill color={C.warn} bg={C.warnSoft}><Info size={12} /> {missed.length} missing</Pill>
            <div>
              <h2 className="text-[15px] font-semibold leading-tight">Complete your record</h2>
              <p className="text-[12px]" style={{ color: C.text2 }}>You can answer each missed day once.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 flex-1 min-w-[200px]">{chips}{more}</div>
          <button onClick={onReview} className={`px-5 h-10 text-[13px] font-semibold hover:opacity-90 ${focusRing}`} style={{ ...btnPrimary, minHeight: 40 }}>Review missing days</button>
        </div>
      </Card>
    );
  }
  return (
    <Card className="!p-5">
      <Pill color={C.warn} bg={C.warnSoft}><Info size={12} /> {missed.length} missing</Pill>
      <h2 className="text-[17px] font-semibold mt-2.5">Complete your record</h2>
      <p className="text-[12px] mt-1" style={{ color: C.text2 }}>You can answer each missed day once.</p>
      <div className="flex flex-wrap gap-2 mt-3">{chips}{more}</div>
      <button onClick={onReview} className={`mt-3.5 w-full h-10 text-[13px] font-semibold hover:opacity-90 ${focusRing}`} style={{ ...btnPrimary, minHeight: 40 }}>Review missing days</button>
    </Card>
  );
}

// ─── Work from anywhere (card) ──────────────────────────────

function WfaCard({ view, onMore }: { view: ViewData; onMore: () => void }) {
  return (
    <Card>
      <div className="flex items-center gap-2.5 mb-4"><Globe size={17} style={{ color: C.muted }} /><h2 className="text-[15px] font-semibold">Work from anywhere</h2></div>
      {view.wfa ? (() => {
        const { cap, used } = view.wfa;
        const left = cap - used;
        return (
          <>
            <div className="flex items-baseline gap-3">
              <span className="text-[40px] leading-none font-semibold tracking-tight" style={{ color: left < -0.001 ? C.bad : C.text }}>{fmtDays(Math.abs(left))}</span>
              <span className="text-[13px]" style={{ color: C.muted }}>{left < -0.001 ? "days over" : "days remaining"}</span>
            </div>
            <div className="mt-4"><Segments cap={cap} used={used} /></div>
            <p className="text-[12px] mt-3" style={{ color: C.muted }}>{fmtDays(used)} of {fmtDays(cap)} used in {view.wfa.year}</p>
          </>
        );
      })() : <p className="text-[13px]" style={{ color: C.muted }}>Your balance is not available right now.</p>}
      <div className="mt-3 flex"><LinkButton onClick={onMore}>All allowances <ArrowRight size={14} /></LinkButton></div>
    </Card>
  );
}

// ─── My attendance (page) ───────────────────────────────────

function AttendancePage(p: PageProps) {
  const missed = p.view.missed;
  return (
    <>
      <PageHead crumb="MY WORKSPACE / MY ATTENDANCE" title="My attendance" aside={<PersonalChip />}
        sub="Every day on record. Tap a day marked Answer to fill it in; past answers are read-only." />
      <div className="space-y-6">
        {missed.length > 0 && <MissingCard compact missed={missed} onAnswer={p.onAnswer} onReview={p.onReview} />}
        <CalendarCard {...p} />
      </div>
    </>
  );
}

// ─── The calendar ───────────────────────────────────────────

function CalendarCard({ employee, view, today, oldest, month, setMonth, earliest, canAnswer, onAnswer, onWeek }: PageProps) {
  const statuses = employee.statuses;
  // WEEK OR MONTH (requested 22 Oct 2026). Month is the default; week is one row with room to read.
  const [mode, setMode] = useState<"month" | "week">("month");
  const thisWeek = startOfWeek(parseISO(today), { weekStartsOn: 1 });
  const [weekStart, setWeekStart] = useState(thisWeek);
  const firstWeek = startOfWeek(earliest, { weekStartsOn: 1 });

  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const weeks: Date[][] = [];
  if (mode === "week") {
    weeks.push(Array.from({ length: WEEKDAYS }, (_, i) => addDays(weekStart, i)));
  } else {
    for (let w = startOfWeek(first, { weekStartsOn: 1 }); w <= last; w = addDays(w, 7)) {
      const days = Array.from({ length: WEEKDAYS }, (_, i) => addDays(w, i));
      // A row with no day in this month is somebody else's week with this month's header.
      if (days.some((d) => d.getMonth() === first.getMonth())) weeks.push(days);
    }
  }

  const periodDates = mode === "week" ? weeks[0].map(iso) : Array.from({ length: last.getDate() }, (_, i) => iso(addDays(first, i)));
  const m = scorePeriod(statuses, periodDates.filter((d) => d < today || (d === today && statuses[d] !== "Pending")), employee.allowance);
  const chips: [string, number, string, string][] = [
    ["office", m.wfo, C.office, C.officeSoft], ["home", m.wfh, C.home, C.homeSoft], ["leave", m.leave, C.leave, C.leaveSoft],
    ["anywhere", m.wfa, C.primary, C.selected], ["unanswered", m.pending, C.warn, C.warnSoft],
  ];

  const isThisMonth = iso(first) === iso(startOfMonth(parseISO(today)));
  const isThisWeek = iso(weekStart) === iso(thisWeek);
  const prevDisabled = mode === "week" ? weekStart <= firstWeek : first <= earliest;
  const nextDisabled = mode === "week" ? weekStart >= thisWeek : first >= startOfMonth(parseISO(today));
  const step = (delta: number) => (mode === "week" ? setWeekStart((w) => addDays(w, 7 * delta)) : setMonth((mm) => addMonths(mm, delta)));
  const goNow = () => (mode === "week" ? setWeekStart(thisWeek) : setMonth(() => startOfMonth(parseISO(today))));

  // Keyboard: arrows move, W/M switch, T comes back. Never while typing, inside a
  // dialog, or with a modifier key.
  const stepRef = useRef(step); stepRef.current = step;
  const goNowRef = useRef(goNow); goNowRef.current = goNow;
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
      else if (k === "t") goNowRef.current();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevDisabled, nextDisabled]);

  const subtitle = mode === "week" ? `${format(weekStart, "d MMM")} - ${format(addDays(weekStart, 4), "d MMM yyyy")}` : format(first, "MMMM yyyy");
  const cols = "grid grid-cols-[repeat(5,minmax(0,1fr))_46px] gap-2";

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight">My attendance</h2>
          <div className="text-[14px] mt-2" style={{ color: C.text2 }}>{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg p-0.5" role="group" aria-label="Calendar view" style={{ background: C.inset }}>
            {(["week", "month"] as const).map((mm) => (
              <button key={mm} onClick={() => setMode(mm)} aria-pressed={mode === mm} className={`px-3 h-8 rounded-md text-[12px] font-medium ${focusRing}`}
                style={mode === mm ? { background: C.surface, color: C.text, boxShadow: "var(--shadow-xs)" } : { color: C.text2 }}>
                {mm === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
          <button onClick={goNow} disabled={mode === "week" ? isThisWeek : isThisMonth} className={`px-4 h-10 text-[13px] font-medium disabled:opacity-40 ${focusRing}`} style={btnOutline}>Today</button>
          <Tooltip label={mode === "week" ? "Previous week" : "Previous month"} shortcut="←"><button onClick={() => step(-1)} disabled={prevDisabled} aria-label={mode === "week" ? "Previous week" : "Previous month"} className={`w-10 h-10 rounded-lg flex items-center justify-center disabled:opacity-30 hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}><ChevronLeft size={19} /></button></Tooltip>
          <Tooltip label={mode === "week" ? "Next week" : "Next month"} shortcut="→"><button onClick={() => step(1)} disabled={nextDisabled} aria-label={mode === "week" ? "Next week" : "Next month"} className={`w-10 h-10 rounded-lg flex items-center justify-center disabled:opacity-30 hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}><ChevronRight size={19} /></button></Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {chips.filter(([, n]) => n > 0.001).map(([label, n, color, bg]) => <Pill key={label} color={color} bg={bg}>{fmtDays(n)} {label}</Pill>)}
      </div>

      <div className={`${cols} mt-6 mb-2`}>
        {["MON", "TUE", "WED", "THU", "FRI"].map((d) => <div key={d} className="text-[11px] tracking-[0.1em]" style={{ color: C.muted }}>{d}</div>)}
        <div className="text-[11px] tracking-[0.1em] text-center" style={{ color: C.muted }}>WEEK</div>
      </div>

      <div className="space-y-2">
        {weeks.map((week) => {
          const pct = view.weekPct.get(iso(week[0])) ?? null;
          return (
            <div key={iso(week[0])} className={cols}>
              {week.map((d) => (
                <Cell key={iso(d)} date={d} inMonth={mode === "week" || d.getMonth() === first.getMonth()} tall={mode === "week"}
                  today={today} oldest={oldest} status={statuses[iso(d)]} open={canAnswer(iso(d))} onAnswer={() => onAnswer(iso(d))} />
              ))}
              {pct === null ? <div /> : (
                <button onClick={() => onWeek(iso(week[0]))} title="Why this score?" aria-label={`Week score ${pct} percent. Why?`}
                  className={`flex items-center justify-center rounded-lg text-[12px] font-semibold underline decoration-dotted underline-offset-4 hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: pctColor(pct) }}>
                  {pct}%
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 mt-6 pt-4 text-[12px]" style={{ borderTop: `1px solid ${C.border}`, color: C.muted }}>
        <span className="inline-flex items-center gap-2"><Lock size={12} /> Past answers are read-only.</span>
        <span className="inline-flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5"><span className="w-4 h-3 rounded-[4px]" style={{ background: C.warnSoft, border: "1px solid #EBD9A8" }} /> Needs an answer</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-4 h-3 rounded-[4px]" style={{ background: "#FEF3F2", border: `1px solid ${C.bad}33` }} /> Unanswered, past the answer window</span>
          <span>All dates in IST</span>
        </span>
      </div>
    </Card>
  );
}

function Cell({ date, inMonth, today, oldest, status, open, onAnswer, tall = false }: {
  date: Date; inMonth: boolean; today: string; oldest: string; status?: string; open: boolean; onAnswer: () => void; tall?: boolean;
}) {
  const key = iso(date);
  const isToday = key === today;
  const base = `relative ${tall ? "h-[132px]" : "h-[76px]"} rounded-xl p-2.5 flex flex-col justify-between text-left`;
  if (!inMonth) return <div className={`${base} opacity-0`} aria-hidden />;

  const num = (
    <span className="flex items-center gap-2 text-[13px] font-medium leading-none">
      {date.getDate()}
      {isToday && <span className="text-[9px] tracking-[0.1em] font-semibold" style={{ color: C.primary }}>TODAY</span>}
    </span>
  );
  const ring = isToday ? { border: `1.5px solid ${C.primary}`, background: C.selected } : { border: `1px solid ${C.border}`, background: C.surface };
  const name = format(date, "EEEE d MMMM");
  const future = key > today;

  if (future) return <div className={base} style={{ background: C.inset, border: `1px solid ${C.inset}` }} aria-label={`${name}: upcoming`}>{num}<span className="text-[11px]" style={{ color: C.muted }}>Upcoming</span></div>;
  if (!status) return <div className={base} style={ring} aria-label={`${name}: no check-in`}>{num}<span className="text-[11px]" style={{ color: C.muted }}>No check-in</span></div>;

  const v = viewOf(status);
  if (status === "Pending") {
    // Same anatomy as every other day (number, then a pill), in the design's
    // warning tint. Past the answer window it turns to the error tint and stops
    // being a button: it is a fact about the record, not a task.
    const tooOld = key < oldest;
    const content = (
      <>
        {num}
        <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-medium px-2 py-1 rounded-md"
          style={{ background: tooOld ? "#FEE4E2" : "#FCEBC8", color: tooOld ? C.bad : C.warn }}>
          {open ? <Pencil size={12} /> : <AlertCircle size={12} />} {open ? "Answer" : tooOld ? "Unanswered" : "Pending"}
        </span>
      </>
    );
    const style = { background: tooOld ? "#FEF3F2" : C.warnSoft, border: `1px solid ${tooOld ? `${C.bad}33` : "#EBD9A8"}` };
    return open
      ? <button onClick={onAnswer} className={`${base} transition-transform hover:scale-[1.03] ${focusRing}`} style={style} aria-label={`${name}: not answered. Answer now`}>{content}</button>
      : <div className={base} style={style} aria-label={`${name}: not answered`}>{content}</div>;
  }

  const content = (
    <>
      {num}
      <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-medium px-2 py-1 rounded-md" style={{ background: v.bg, color: v.color }}>
        <v.Icon size={12} /> {v.short}
      </span>
    </>
  );
  return open
    ? <button onClick={onAnswer} className={`${base} transition-transform hover:scale-[1.03] ${focusRing}`} style={ring} aria-label={`${name}: ${status}. Change`}>{content}</button>
    : <div className={base} style={ring} aria-label={`${name}: ${status}`}>{content}</div>;
}

/** One weekday as a small card, for the phone's week strip. */
function WeekCell({ day, today, status, open, onAnswer }: { day: string; today: string; status?: string; open: boolean; onAnswer: () => void }) {
  const d = parseISO(day);
  const future = day > today;
  const v = status && !future ? viewOf(status) : null;
  const pending = status === "Pending";
  const body = (
    <>
      <span className="text-[10px] tracking-wide" style={{ color: C.muted }}>{format(d, "EEE").toUpperCase()}</span>
      <span className="text-[20px] font-semibold leading-none my-1.5">{d.getDate()}</span>
      <span className="h-5 flex items-center" style={{ color: v?.color ?? C.muted }}>{v && <v.Icon size={16} />}</span>
      <span className="text-[11px] mt-1" style={{ color: pending ? C.warn : C.text2 }}>{pending ? (open ? "Answer" : "Pending") : v ? v.short : future ? "" : "None"}</span>
    </>
  );
  const style: React.CSSProperties = pending
    ? { background: C.warnSoft, border: "1px solid #EBD9A8", boxShadow: "var(--shadow-xs)" }
    : { background: day === today ? C.selected : C.surface, border: `${day === today ? 1.5 : 1}px solid ${day === today ? C.primary : C.border}`, boxShadow: "var(--shadow-xs)" };
  const cls = "rounded-2xl py-3 flex flex-col items-center min-w-0";
  return open ? <button onClick={onAnswer} className={`${cls} ${focusRing}`} style={style} aria-label={`${format(d, "EEEE d MMMM")}: ${status}`}>{body}</button>
    : <div className={cls} style={style}>{body}</div>;
}

// ─── Policies ───────────────────────────────────────────────

function PoliciesPage({ view, setPage }: PageProps) {
  const t = view.thisWeek;
  const weekStart = parseISO(view.weekDays[0]);
  const range = `${format(weekStart, "d")}–${format(addDays(weekStart, 4), "d MMMM yyyy")}`;
  const included = Math.min(t.wfh, 1);
  const rows: { Icon: LucideIcon; title: string; note: string; value: number }[] = [
    { Icon: Building2, title: "Office", note: "Counted in full", value: t.wfo },
    { Icon: Home, title: "Home", note: t.wfhExcess > 0.001 ? `${fmtDays(included)} included weekly · ${fmtDays(t.wfhExcess)} beyond allowance` : "Within your weekly WFH day", value: t.wfh },
    { Icon: Leaf, title: "Leave", note: "Excluded from the calculation", value: t.leave },
    { Icon: Globe, title: "Work from anywhere", note: "Within your annual balance, excluded from the score", value: t.wfa },
  ];
  const shown = rows.filter((r) => r.value > 0.001 || r.title === "Office");

  return (
    <>
      <PageHead crumb="MY WORKSPACE / POLICIES" title="Policies" sub="Understand the rules behind your attendance. No guesswork, no hidden calculations." aside={<PersonalChip />} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {([
          [Home, "01", "Work from home", "1 day per calendar week, on any weekday."],
          [Globe, "02", "Work from anywhere", "Your annual balance is separate from your weekly WFH day."],
          [Leaf, "03", "Time off", "Leave is excluded from your attendance score."],
        ] as [LucideIcon, string, string, string][]).map(([Icon, n, title, body]) => (
          <Card key={n}>
            <div className="flex items-start justify-between"><span style={{ color: C.primary }}><Icon size={24} /></span><span className="text-[11px]" style={{ color: C.muted }}>{n}</span></div>
            <h2 className="text-[20px] font-semibold mt-5">{title}</h2>
            <p className="text-[13px] mt-2 leading-snug" style={{ color: C.text2 }}>{body}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-6">
        <Card>
          <h2 className="text-[22px] font-semibold">How your week is counted</h2>
          <div className="text-[13px] mt-1.5" style={{ color: C.muted }}>Your current week &middot; {range}</div>
          <ul className="mt-5">
            {shown.map((r, i) => (
              <li key={r.title} className="flex items-center gap-4 py-4" style={i > 0 ? { borderTop: `1px solid ${C.border}` } : undefined}>
                <span style={{ color: C.muted }}><r.Icon size={18} /></span>
                <div className="flex-1 min-w-0"><div className="text-[14px] font-medium">{r.title}</div><div className="text-[12px]" style={{ color: C.muted }}>{r.note}</div></div>
                <div className="text-[14px] font-semibold">{fmtDays(r.value)} {r.value === 1 ? "day" : "days"}</div>
              </li>
            ))}
          </ul>
        </Card>

        <section className="rounded-2xl p-6" style={{ background: C.selected, border: `1px solid ${C.border}` }}>
          <div className="text-[11px] tracking-[0.14em] font-semibold" style={{ color: C.primary }}>YOUR WEEK</div>
          <div className="text-[64px] leading-none font-semibold tracking-tight mt-6">{t.pct === null ? "n/a" : `${t.pct}%`}</div>
          {t.available > 0.001 ? (
            <>
              <p className="text-[16px] font-medium mt-5">{fmtDays(t.adherent)} of {fmtDays(t.available)} counted days met the policy</p>
              <p className="text-[13px] mt-4 leading-snug" style={{ color: C.text2 }}>
                {fmtDays(t.wfo)} office {t.wfo === 1 ? "day" : "days"} + {fmtDays(included)} included home {included === 1 ? "day" : "days"} &divide; {fmtDays(t.available)} counted days
              </p>
              <div className="mt-5 pt-4 text-[13px]" style={{ borderTop: `1px solid ${C.border}`, color: C.text2 }}>
                {t.wfhExcess > 0.001 ? "Your second home day is the difference."
                  : t.pending > 0 ? "Unanswered days count against the score." : "Every counted day met the policy."}
              </div>
            </>
          ) : <p className="text-[14px] mt-5" style={{ color: C.text2 }}>No days this week count towards the score yet.</p>}
        </section>

        <Card>
          <h2 className="text-[22px] font-semibold">Other days, explained</h2>
          <dl className="mt-5 space-y-5">
            {[
              ["Split days", "Half office + half home. Two half-home days use your weekly day."],
              ["Client visits, travel and compensatory WFH", "Count toward attendance in the same way as office days."],
              ["Missing answers", "An unanswered check-in counts against the score. A day with no check-in request does not."],
            ].map(([k, v]) => <div key={k}><dt className="text-[14px] font-semibold">{k}</dt><dd className="text-[13px] mt-1" style={{ color: C.text2 }}>{v}</dd></div>)}
          </dl>
        </Card>

        <Card className="flex flex-col">
          <CircleHelp size={24} style={{ color: C.primary }} />
          <h2 className="text-[22px] font-semibold mt-4">Something doesn&apos;t add up?</h2>
          <p className="text-[13px] mt-2" style={{ color: C.text2 }}>People &amp; Culture can help explain a rule or review an older record.</p>
          <button onClick={() => setPage("allowances")} className={`mt-6 w-full text-[14px] font-semibold ${focusRing}`} style={btnPrimary}>View my allowances</button>
        </Card>
      </div>
      <p className="text-[12px] mt-6" style={{ color: C.muted }}>Calculated from recorded check-ins. Annual allowances follow your account&apos;s configured entitlement.</p>
    </>
  );
}

// ─── Allowances ─────────────────────────────────────────────

function AllowancesPage({ view, employee, today }: PageProps) {
  const t = view.thisWeek;
  const weekStart = parseISO(view.weekDays[0]);
  const range = `${format(weekStart, "d")}–${format(addDays(weekStart, 4), "d MMMM")}`;
  const w = view.wfa;
  const over = w ? w.cap - w.used < -0.001 : false;

  return (
    <>
      <PageHead crumb="MY WORKSPACE / ALLOWANCES" title="Allowances" sub="Know what you've used, what remains, and which balance each workday belongs to." aside={<PersonalChip />} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3"><Globe size={20} style={{ color: C.primary }} /><h2 className="text-[20px] font-semibold">Work from anywhere</h2></div>
            {w && <Pill color={C.text2} bg={C.inset}>{w.year}</Pill>}
          </div>
          {w ? (
            <>
              <div className="flex items-baseline gap-5 mt-8">
                <span className="text-[64px] leading-none font-semibold tracking-tight" style={{ color: over ? C.bad : C.text }}>{fmtDays(Math.abs(w.cap - w.used))}</span>
                <span className="text-[16px]" style={{ color: C.text2 }}>{over ? "days over" : "days remaining"}</span>
              </div>
              <div className="mt-6"><Segments cap={w.cap} used={w.used} color={C.primary} /></div>
              <div className="flex justify-between text-[13px] mt-4"><span className="font-semibold" style={{ color: C.primary }}>{fmtDays(w.used)} used</span><span style={{ color: C.text2 }}>{fmtDays(w.cap)}-day annual allowance</span></div>
              {over && <p className="text-[13px] mt-3" style={{ color: C.warn }}>Days beyond the allowance stay in the calculation without office credit.</p>}
            </>
          ) : <p className="text-[14px] mt-6" style={{ color: C.muted }}>Your balance is not available right now. Nothing is shown rather than a wrong number.</p>}
        </Card>

        <Card>
          <div className="flex items-center gap-3"><Home size={20} style={{ color: C.primary }} /><h2 className="text-[20px] font-semibold">Work from home</h2></div>
          <div className="text-[13px] mt-4" style={{ color: C.muted }}>{range}</div>
          <div className="flex items-baseline gap-3 mt-3"><span className="text-[44px] leading-none font-semibold">{fmtDays(t.wfh)}</span><span className="text-[13px]" style={{ color: C.text2 }}>days recorded / 1 included</span></div>
          {t.wfhExcess > 0.001 && <Pill color={C.warn} bg={C.warnSoft} className="mt-5 w-full !rounded-xl !py-2"><Info size={13} /> {fmtDays(t.wfhExcess)} {t.wfhExcess === 1 ? "day" : "days"} over the weekly allowance</Pill>}
          <p className="text-[12px] mt-4" style={{ color: C.muted }}>This does not use your annual WFA balance.</p>
        </Card>

        <Card>
          <h2 className="text-[20px] font-semibold">Work-from-anywhere history</h2>
          {w ? (
            <>
              <p className="text-[13px] mt-1.5" style={{ color: C.muted }}>{fmtDays(w.used)} recorded {w.used === 1 ? "day" : "days"} against your annual allowance</p>
              <div className="mt-5 rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                <div className="grid grid-cols-[1.2fr_1fr_80px] px-4 h-10 items-center text-[11px] tracking-[0.12em]" style={{ background: C.inset, color: C.muted }}><span>DATE</span><span>LOCATION</span><span className="text-right">DAYS USED</span></div>
                {w.before > 0.001 && (
                  <div className="grid grid-cols-[1.2fr_1fr_80px] px-4 h-14 items-center text-[14px]" style={{ borderTop: `1px solid ${C.border}` }}>
                    <span style={{ color: C.text2 }}>Earlier in {w.year}</span><span className="text-[13px]" style={{ color: C.muted }}>Before {format(parseISO(employee.allowance!.windowDates[0] ?? today), "d MMM")}</span><span className="text-right">{fmtDays(w.before)}</span>
                  </div>
                )}
                {[...w.rows].reverse().map((r) => (
                  <div key={r.day} className="grid grid-cols-[1.2fr_1fr_80px] px-4 h-14 items-center text-[14px]" style={{ borderTop: `1px solid ${C.border}` }}>
                    <span>{format(parseISO(r.day), "d MMMM yyyy")}</span>
                    <span className="inline-flex items-center gap-2" style={{ color: C.text2 }}><Globe size={14} /> Anywhere</span>
                    <span className="text-right">{fmtDays(r.used)}</span>
                  </div>
                ))}
                {w.rows.length === 0 && w.before <= 0.001 && <div className="px-4 h-14 flex items-center text-[13px]" style={{ borderTop: `1px solid ${C.border}`, color: C.muted }}>No work-from-anywhere days recorded this year.</div>}
                <div className="grid grid-cols-[1fr_100px] px-4 h-14 items-center text-[14px] font-semibold" style={{ borderTop: `1px solid ${C.border}` }}><span>Total used in {w.year}</span><span className="text-right">{fmtDays(w.used)} {w.used === 1 ? "day" : "days"}</span></div>
              </div>
            </>
          ) : <p className="text-[13px] mt-3" style={{ color: C.muted }}>History is not available right now.</p>}
        </Card>

        <Card>
          <h2 className="text-[20px] font-semibold">Two different allowances</h2>
          <dl className="mt-5 space-y-5">
            {[
              ["Weekly WFH", "One day per calendar week. You can use it on any weekday."],
              ["Annual WFA", "Within your allowance, Anywhere days are excluded from your score."],
              ["Beyond the annual limit", "Additional Anywhere days stay in the calculation but don't count as office attendance."],
            ].map(([k, v]) => <div key={k}><dt className="text-[14px] font-semibold">{k}</dt><dd className="text-[13px] mt-1 leading-snug" style={{ color: C.text2 }}>{v}</dd></div>)}
          </dl>
        </Card>

        <Card className="lg:col-span-2 flex items-center gap-5">
          <span className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: C.inset, color: C.muted }}><Leaf size={24} /></span>
          <div>
            <h2 className="text-[18px] font-semibold">Looking for your leave balance?</h2>
            <p className="text-[14px] mt-1" style={{ color: C.text2 }}>Leave is managed in Zoho. MissionHQ shows its effect on your attendance record.</p>
            <p className="text-[12px] mt-1.5" style={{ color: C.muted }}>Leave and WFA are separate balances.</p>
          </div>
        </Card>
      </div>
      <p className="text-[12px] mt-6" style={{ color: C.muted }}>Attendance records determine usage. Need a correction? Contact People &amp; Culture.</p>
    </>
  );
}

// ─── Dialogs ────────────────────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="animate-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(23,43,44,0.45)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div role="dialog" aria-modal="true" className="animate-modal w-full sm:max-w-md p-6 rounded-t-2xl sm:rounded-2xl" style={{ background: C.surface, boxShadow: "var(--shadow-lg)" }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function WeekDialog({ weekStart, statuses, allowance, today, onClose }: {
  weekStart: string; statuses: Record<string, string>; allowance?: Employee["allowance"]; today: string; onClose: () => void;
}) {
  const start = parseISO(weekStart);
  const days = Array.from({ length: WEEKDAYS }, (_, i) => iso(addDays(start, i)));
  // Same rule as the page: a day still Pending today is not a miss yet.
  const counted = days.filter((d) => statuses[d] && d <= today && (d < today || statuses[d] !== "Pending"));
  const s = scorePeriod(statuses, counted, allowance);

  const reasons: { ok: boolean; text: string }[] = [];
  if (s.available <= 0.001) reasons.push({ ok: true, text: "No days this week counted towards a score, so there is no percentage to explain." });
  else {
    reasons.push({ ok: s.isCompliant, text: `${fmtDays(s.adherent)} of ${fmtDays(s.available)} counted days met the policy.` });
    if (s.wfo > 0.001) reasons.push({ ok: true, text: `${fmtDays(s.wfo)} office ${s.wfo === 1 ? "day" : "days"} counted in full.` });
    if (s.wfh > 0.001) reasons.push({ ok: s.wfhExcess < 0.001, text: s.wfhExcess > 0.001
      ? `${fmtDays(s.wfh)} days at home. One is included, so ${fmtDays(s.wfhExcess)} counted against you.` : "Your one WFH day this week was within the allowance." });
    if (s.pending > 0) reasons.push({ ok: false, text: `${s.pending} ${s.pending === 1 ? "day was" : "days were"} never answered. Unanswered days count as missed.` });
  }
  if (s.leave > 0.001) reasons.push({ ok: true, text: `${fmtDays(s.leave)} leave ${s.leave === 1 ? "day was" : "days were"} left out of the score.` });
  if (s.wfaWithin > 0.001) reasons.push({ ok: true, text: `${fmtDays(s.wfaWithin)} work-from-anywhere ${s.wfaWithin === 1 ? "day was" : "days were"} left out (within your annual balance).` });

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[17px] font-semibold">Week of {format(start, "d MMM")}</h2>
          <div className="text-[30px] font-semibold leading-tight" style={{ color: pctColor(s.pct) }}>{s.pct === null ? "No score" : `${s.pct}%`}</div>
        </div>
        <Tooltip label="Close" shortcut="Esc" side="bottom"><button onClick={onClose} aria-label="Close" className={`p-1.5 -mr-1.5 rounded-lg hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.muted }}><X size={17} /></button></Tooltip>
      </div>
      <div className="grid grid-cols-5 gap-2 mb-4">
        {days.map((d) => {
          const st = statuses[d]; const v = st ? viewOf(st) : null;
          return (
            <div key={d} className="flex flex-col items-center gap-1">
              <span className="text-[11px]" style={{ color: C.muted }}>{format(parseISO(d), "EEE d")}</span>
              <div className="w-full h-11 rounded-lg flex items-center justify-center" style={v ? { background: v.bg, color: v.color } : { border: `1.5px dashed ${C.border}` }}>{v && <v.Icon size={18} />}</div>
              <span className="text-[10px] truncate max-w-full" style={{ color: C.text2 }}>{v ? v.short : "None"}</span>
            </div>
          );
        })}
      </div>
      <ul className="space-y-2">
        {reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[13px]" style={{ color: C.text2 }}>
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: r.ok ? C.office : C.bad }} />{r.text}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function AnswerDialog({ day, isToday, current, options, onClose, onSubmit, progress, onSkip }: {
  day: string; isToday: boolean; current?: string; options: Option[]; onClose: () => void; onSubmit: (value: string, status: string) => void;
  /** Set while walking through missing days: "Day 2 of 4". */
  progress?: { index: number; total: number }; onSkip?: () => void;
}) {
  // Preselect what is stored now, so "change" starts from the truth.
  const [picked, setPicked] = useState<string | null>(() => options.find((o) => o.status === current)?.value ?? null);
  // A past day can be answered once and never changed, so it gets a second look.
  const [confirming, setConfirming] = useState(false);
  const chosen = options.find((o) => o.value === picked);
  const save = () => {
    if (!chosen) return;
    if (!isToday && !confirming) { setConfirming(true); return; }
    onSubmit(chosen.value, chosen.status);
  };

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-[18px] font-semibold">{isToday ? "Where are you working today?" : `Where were you on ${dayLabel(day)}?`}</h2>
        <Tooltip label="Close" shortcut="Esc" side="bottom"><button onClick={onClose} aria-label="Close" className={`p-1.5 -mr-1.5 rounded-lg hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.muted }}><X size={17} /></button></Tooltip>
      </div>
      <p className="text-[13px] mb-4" style={{ color: C.muted }}>
        {isToday ? "You can change this again until midnight IST." : "You can answer a missed day once. After you save, it cannot be changed."}
      </p>
      {options.length === 0 ? (
        <p className="py-8 text-center text-[13px]" style={{ color: C.muted }}>The options did not load. Refresh the page and try again.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[52vh] overflow-y-auto pr-0.5">
          {options.map((o) => {
            const v = viewOf(o.status); const on = picked === o.value;
            return (
              <button key={o.value} onClick={() => { setPicked(o.value); setConfirming(false); }} aria-pressed={on}
                className={`flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors ${focusRing}`}
                style={{ border: `1.5px solid ${on ? C.primary : C.border}`, background: on ? C.selected : C.surface }}>
                <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: v.bg, color: v.color }}><v.Icon size={17} /></span>
                <span className="text-[13px] font-medium leading-tight">{v.verb}</span>
              </button>
            );
          })}
        </div>
      )}
      {confirming && chosen && (
        <div role="alert" className="mt-4 rounded-lg px-3.5 py-3 text-[13px]" style={{ background: C.warnSoft, color: C.warn }}>
          Save <span className="font-semibold">{viewOf(chosen.status).verb}</span> for {dayLabel(day)}? Past answers cannot be changed afterwards.
        </div>
      )}
      <div className="flex items-center gap-2 mt-5">
        {progress && (
          <span className="mr-auto text-[12px]" style={{ color: C.muted }}>
            Day {progress.index} of {progress.total}
            {onSkip && !confirming && <button onClick={onSkip} className={`ml-3 font-medium underline underline-offset-2 ${focusRing}`} style={{ color: C.text2 }}>Skip</button>}
          </span>
        )}
        {!progress && <span className="mr-auto" />}
        <button onClick={confirming ? () => setConfirming(false) : onClose} className={`px-4 h-11 rounded-[10px] text-[14px] font-medium hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}>{confirming ? "Back" : "Cancel"}</button>
        <button onClick={save} disabled={!picked} className={`px-6 text-[14px] font-semibold disabled:opacity-40 ${focusRing}`} style={btnPrimary}>{confirming ? "Yes, save" : "Save"}</button>
      </div>
    </Modal>
  );
}
