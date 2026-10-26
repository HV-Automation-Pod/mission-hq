"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { DEFAULT_DAYS, FULL_HISTORY_DAYS, fetchAllData } from "@/lib/api/attendance";
import { Employee } from "@/lib/domain/types";
import AdminApp from "@/components/admin/AdminApp";
import AdminLoading from "@/components/admin/AdminLoading";
import MemberLoading from "@/components/member/MemberLoading";
import MemberView from "@/components/member/MemberView";
import { Button, C, PETROL_VARS, useLightOnly } from "@/components/ui";

/**
 * The one page. It loads the attendance payload and hands it to whichever
 * workspace the viewer belongs in: the admin workspace for admins, the personal
 * view for everybody else, and for an admin who has asked for their own record
 * (?view=me) the personal view too.
 *
 * WHO IS LOOKING decides what is drawn, never what is allowed. The payload is
 * already scoped on the server (a member's request never loads anybody else's
 * attendance) and every action re-checks role and edit permission.
 */
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000;

type Viewer = { email: string; role: string; canEdit?: boolean; canManageAccess?: boolean };

export default function Dashboard() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [statusOptions, setStatusOptions] = useState<{ value: string; status: string }[]>([]);
  const [holidays, setHolidays] = useState<{ day: string; name: string; kind: "closed" | "optional" }[]>([]);
  const isAdmin = viewer?.role === "admin";
  // How far back the data reaches. Starts at a quarter; an admin can ask for the
  // whole archive, and every refresh after that keeps asking for it.
  const days = useRef(DEFAULT_DAYS);
  const [fullHistory, setFullHistory] = useState(false);

  // The role is not known until the data arrives, but the loading screen has to
  // be on screen before that. Remember it from the last visit: admins get their
  // own, everybody else the member one. Unknown (first visit, or the server
  // render) means member, the common case.
  const [roleHint, setRoleHint] = useState<string | null>(null);
  useEffect(() => { try { setRoleHint(localStorage.getItem("missionhq-role")); } catch { /* private mode: no hint */ } }, []);

  // An admin can look at their own attendance like anybody else. Kept in the
  // URL (?view=me) so a refresh or a shared link lands where it was left.
  const [myView, setMyView] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("view") === "me";
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (myView) params.set("view", "me"); else params.delete("view");
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", next);
    }
  }, [myView]);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const data = await fetchAllData(days.current);
      setEmployees(data.employees);
      setDates(data.dates);
      setViewer(data.viewer ?? null);
      try { if (data.viewer) localStorage.setItem("missionhq-role", data.viewer.role); } catch { /* ignore */ }
      setStatusOptions(data.statusOptions ?? []);
      setHolidays(data.holidays ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      // A failed background refresh must not throw away a screen that is
      // already showing good data: keep it, and say so only on first load.
      if (!isRefresh) setError(err instanceof Error ? err.message : "Failed to load data");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { setMounted(true); loadData(); }, [loadData]);
  useEffect(() => {
    const interval = setInterval(() => loadData(true), AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadData]);

  // Somebody answers in Slack and comes back to check: refresh when the tab
  // regains focus, instead of making them find a refresh button.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && viewer) loadData(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [viewer, loadData]);

  /** Earlier months, on request: widen the window once, then keep it. */
  const loadHistory = async () => {
    days.current = FULL_HISTORY_DAYS;
    await loadData(true);
    setFullHistory(true);
  };

  // ─── Loading ──────────────────────────────────────────
  // An admin opening their own member view (?view=me) is loading THAT screen, so
  // the address outranks the remembered role.
  if (!mounted || loading) return roleHint === "admin" && !myView ? <AdminLoading /> : <MemberLoading />;

  // ─── Error ────────────────────────────────────────────
  if (error || !viewer) return <ErrorScreen message={error ?? "We could not tell who is signed in."} onRetry={() => loadData()} />;

  // ─── Personal view: every member, and an admin who asked for it ───
  if (!isAdmin || myView) {
    // No fallback to "the first row": for an admin that would be somebody
    // else's attendance. A member's payload is one row, an admin's is everyone's.
    return (
      <MemberView employee={employees.find((e) => e.email === viewer.email) ?? null} dates={dates} viewer={viewer}
        options={statusOptions} holidays={holidays} onChanged={() => loadData(true)}
        onBackToAdmin={isAdmin ? () => setMyView(false) : undefined} />
    );
  }

  // ─── Admin workspace ──────────────────────────────────
  return (
    <AdminApp employees={employees} dates={dates} viewer={{ email: viewer.email, canEdit: viewer.canEdit === true, canManageAccess: viewer.canManageAccess === true }}
      statusOptions={statusOptions} lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => loadData(true)}
      fullHistory={fullHistory} onLoadHistory={loadHistory} onMyView={() => setMyView(true)} />
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  useLightOnly();
  return (
    <div className="min-h-dvh grid place-items-center px-6" style={PETROL_VARS}>
      <div role="alert" className="max-w-md w-full text-center rounded-2xl p-8" style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "var(--shadow-xs), var(--shadow-sm)" }}>
        <span className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ background: C.warnSoft, color: C.warn }}><TriangleAlert size={22} /></span>
        <h1 className="text-[20px] font-semibold mt-5">We could not load your workspace</h1>
        <p className="text-[13px] mt-2" style={{ color: C.text2 }}>{message}</p>
        <Button className="mt-6" onClick={onRetry}><RefreshCw size={15} /> Try again</Button>
      </div>
    </div>
  );
}
