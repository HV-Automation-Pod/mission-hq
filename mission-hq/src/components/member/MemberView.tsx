"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { parseISO, startOfMonth, subDays } from "date-fns";
import { ArrowRight, Check, CircleHelp, Lock, LogOut, Menu, X } from "lucide-react";
import { BrandMark, Button, C, Card, Modal, PETROL_VARS, Tooltip, focusRing, pageMotion, useLightOnly, viewOf } from "@/components/ui";
import { answerMyAttendance } from "@/lib/actions/member";
import type { Employee } from "@/lib/domain/types";
import { dayLabel, initialsOf, iso, istNow } from "@/lib/format";
import { BACKFILL_DAYS, NAV, computeViewData, type Holiday, type Option, type Page, type PageProps } from "./model";
import { AnswerDialog } from "./dialogs/AnswerDialog";
import { WeekDialog } from "./dialogs/WeekDialog";
import { AllowancesPage } from "./pages/AllowancesPage";
import { AttendancePage } from "./pages/AttendancePage";
import { OverviewPage } from "./pages/OverviewPage";
import { PoliciesPage } from "./pages/PoliciesPage";

/**
 * The member view, in the "Petrol & Oat" design (Penpot export, 23 Oct 2026).
 *
 * A sidebar and four pages: Overview, My attendance, Policies, Allowances. On
 * a phone the sidebar becomes a top bar and a bottom tab bar.
 *
 * This file is the shell: who is looking, which page, the dialogs, and the
 * answer-and-refresh round trip. Each page and each card is in its own file.
 *
 * WHAT IT DOES NOT DECIDE. Who may answer which day is `answerMyAttendance` on
 * the server; scoring is `lib/domain/policy.ts`. The shell only decides what is
 * worth OFFERING and how to show it.
 */
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
  useLightOnly();

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

  const [answering, setAnswering] = useState<string | null>(null);
  const [weekOpen, setWeekOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
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
  const now = parseISO(today); // local midnight of the IST date, for date-fns arithmetic
  const hour = istNow().getUTCHours();
  const oldest = iso(subDays(now, BACKFILL_DAYS));
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  const view = useMemo(
    () => (employee ? computeViewData(employee, dates, today, now, oldest) : null),
    // `now` is rebuilt every render; `today` only changes at midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employee, dates, today],
  );

  const notify = (message: string) => setToast({ id: Date.now(), message });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

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
    notify(`${day === today ? "Today" : dayLabel(day)} saved as ${viewOf(status).verb.toLowerCase()}`);
    answerMyAttendance(day, value).then((r) => {
      if (!r.ok) notify(r.error);
      // Success or not, drop the local copy: the refetch carries the truth, or the
      // answer was refused and the old state should come back.
      return Promise.resolve(onChanged()).finally(() =>
        setPendingSaves((p) => { const { [day]: _gone, ...rest } = p; return rest; }));
    });
  };

  /** May the member answer or change this day? Mirrors the server's rules. */
  const canAnswer = (day: string): boolean => {
    const s = employee?.statuses[day];
    if (!s || day > today || day < oldest) return false;
    if (day === today) return s !== "Leave";
    return s === "Pending";
  };

  const name = employee?.name ?? viewer.email.split("@")[0];
  const firstName = name.split(/[\s._-]+/)[0];
  const initials = initialsOf(name);
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
    <div className="min-h-dvh" style={PETROL_VARS}>

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
        <LayoutGroup id="member-nav">
          <nav className="px-3 space-y-1" aria-label="My workspace">
            {NAV.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setPage(id)} aria-current={page === id ? "page" : undefined}
                className={`relative w-full flex items-center gap-3 px-3.5 h-11 rounded-xl text-[14px] font-medium transition-colors ${page === id ? "" : "hover:bg-[#EEF3F1]"} ${focusRing}`}
                style={{ color: page === id ? C.text : C.text2 }}>
                {page === id && <motion.span layoutId="member-nav-active" className="absolute inset-0 rounded-xl" style={{ background: C.selected }} transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                {page === id && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r" style={{ background: C.primary }} />}
                <Icon size={18} className="relative flex-shrink-0" />
                <span className="relative whitespace-nowrap">{label}</span>
              </button>
            ))}
          </nav>
        </LayoutGroup>
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
              <button onClick={() => setConfirmOut(true)} aria-label="Sign out" className={`p-2 rounded-lg hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.muted }}>
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
        <AnimatePresence>
          {menuOpen && (
            <motion.div initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.16 }}
              className="absolute right-4 top-[60px] w-64 rounded-2xl p-3 z-50" style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "var(--shadow-lg)", transformOrigin: "top right" }}>
              <div className="flex items-center gap-3 px-2 pb-3 mb-2" style={{ borderBottom: `1px solid ${C.border}` }}>
                <span className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold" style={{ background: C.selected, color: C.primary }}>{initials}</span>
                <div className="min-w-0"><div className="text-[13px] font-medium truncate">{name}</div><div className="text-[11px] truncate" style={{ color: C.muted }}>{viewer.email}</div></div>
              </div>
              {onBackToAdmin && <button onClick={onBackToAdmin} className="w-full text-left px-2 h-10 text-[13px] font-medium" style={{ color: C.primary }}>Back to team view</button>}
              <button onClick={() => { setMenuOpen(false); setConfirmOut(true); }} className="w-full flex items-center gap-2 px-2 h-10 text-[13px] font-medium" style={{ color: C.text2 }}>
                <LogOut size={15} /> Sign out
              </button>
            </motion.div>
          )}
        </AnimatePresence>
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
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={page} variants={pageMotion} initial="initial" animate="animate" exit="exit">
                {page === "overview" ? <OverviewPage {...shared} firstName={firstName} hour={hour} />
                  : page === "attendance" ? <AttendancePage {...shared} />
                  : page === "policies" ? <PoliciesPage {...shared} />
                  : <AllowancesPage {...shared} />}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>

      {/* ── Tab bar (phone) ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 gap-2 p-3" style={{ background: C.canvas, borderTop: `1px solid ${C.border}` }} aria-label="My workspace">
        <LayoutGroup id="member-tabs">
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setPage(id)} aria-current={page === id ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center gap-0.5 rounded-xl h-[52px] text-[11px] font-medium ${focusRing}`}
              style={page === id ? { color: C.primary } : { background: C.surface, color: C.text2, border: `1px solid ${C.border}` }}>
              {page === id && <motion.span layoutId="member-tab-active" className="absolute inset-0 rounded-xl" style={{ background: C.selected }} transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <Icon size={16} className="relative" /> <span className="relative">{id === "attendance" ? "Attendance" : label}</span>
            </button>
          ))}
        </LayoutGroup>
      </nav>

      <AnimatePresence>
        {confirmOut && (
          <Modal label="Sign out" width={440} onClose={() => !leaving && setConfirmOut(false)}>
            <h2 className="text-[18px] font-semibold">Sign out of MissionHQ?</h2>
            <p className="text-[13px] mt-2" style={{ color: C.text2 }}>You will need to sign in with Google again to see your attendance.</p>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setConfirmOut(false)} disabled={leaving}>Cancel</Button>
              <Button onClick={signOut} loading={leaving}>Sign out</Button>
            </div>
          </Modal>
        )}
        {answering && employee && (
          <Modal key="answer" label="Answer attendance" width={448} onClose={() => { setAnswering(null); setReviewQueue(null); }}>
            <AnswerDialog key={answering} day={answering} isToday={answering === today} current={employee.statuses[answering]} options={options}
              progress={reviewQueue && reviewQueue.includes(answering) ? { index: reviewQueue.indexOf(answering) + 1, total: reviewQueue.length } : undefined}
              onSkip={reviewQueue ? () => advanceReview(answering) : undefined}
              onClose={() => { setAnswering(null); setReviewQueue(null); }} onSubmit={(value, status) => submitAnswer(answering, value, status)} />
          </Modal>
        )}
        {weekOpen && employee && (
          <Modal key="week" label="Why this week scored what it did" width={448} onClose={() => setWeekOpen(null)}>
            <WeekDialog weekStart={weekOpen} statuses={employee.statuses} allowance={employee.allowance} today={today} onClose={() => setWeekOpen(null)} />
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.22 }}
            className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium"
            style={{ background: C.text, color: "#fff", boxShadow: "var(--shadow-lg)" }}>
            <Check size={15} style={{ color: "#86EFAC" }} /> {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
