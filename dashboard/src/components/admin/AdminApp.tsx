"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Check, TriangleAlert } from "lucide-react";
import { C, Button, Modal, pageMotion } from "@/components/ui";
import { istToday } from "@/lib/format";
import type { Employee } from "@/lib/domain/types";
import type { Person } from "@/lib/domain/access-types";
import { AdminProvider, registerPeople, useAdminData, useRouteState, type AdminCtx, type DialogState, type Route } from "./context";
import { AdminShell, browserSignOut, type Access } from "./AdminShell";
import { AdminLoadingBody } from "./AdminLoading";
import { ago } from "./ui";
import { FilterBanner } from "./FilterBanner";
import OverviewPage from "./pages/OverviewPage";
import PeoplePage from "./pages/PeoplePage";
import MemberPage from "./pages/MemberPage";
import PersonSettingsPage from "./pages/PersonSettingsPage";
import TeamsPage from "./pages/TeamsPage";
import TeamDetailPage from "./pages/TeamDetailPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import AttentionPage from "./pages/AttentionPage";
import AdministrationPage from "./pages/AdministrationPage";
import CorrectionDialog from "./dialogs/CorrectionDialog";
import { GrantDialog, ManageAccessDialog } from "./dialogs/AccessDialogs";
import { MembersDialog, RosterDialog } from "./dialogs/GroupDialogs";
import OperationDialog from "./dialogs/OperationDialog";

/**
 * The admin workspace (Petrol & Oat design, 23 Oct 2026).
 *
 * It replaces the tabbed dashboard. Everything it shows is computed from the
 * one attendance payload the page already loaded plus `/api/admin`, using the
 * same policy code as the member view and the Slack report, so there is one
 * answer to "what is this person's score" on every screen.
 */
export default function AdminApp({ employees, dates, viewer: viewerProp, statusOptions, lastUpdated, refreshing, onRefresh: onRefreshProp, fullHistory, onLoadHistory, onMyView }: {
  employees: Employee[];
  dates: string[];
  viewer: { email: string; canEdit: boolean; canManageAccess: boolean };
  statusOptions: { value: string; status: string }[];
  lastUpdated: Date | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  fullHistory: boolean;
  onLoadHistory: () => Promise<void>;
  onMyView: () => void;
}) {
  // The parent builds `viewer` and `onRefresh` inline, so they are new on every
  // parent render. Rebuild them from their parts / behind a ref so they do not
  // invalidate `ctx` (and every page's memoized work) when nothing changed.
  const { email: viewerEmail, canEdit: viewerCanEdit, canManageAccess: viewerCanManage } = viewerProp;
  const viewer = useMemo(() => ({ email: viewerEmail, canEdit: viewerCanEdit, canManageAccess: viewerCanManage }), [viewerEmail, viewerCanEdit, viewerCanManage]);
  const onRefreshRef = useRef(onRefreshProp);
  useEffect(() => { onRefreshRef.current = onRefreshProp; });
  const onRefresh = useCallback(() => onRefreshRef.current(), []);

  const { route: liveRoute, go, setFilter, resolveMember } = useRouteState();
  // The sidebar follows the click at once (`liveRoute`); the page body follows
  // `route`, which React renders in the background. A heavy page (Analytics
  // aggregates six weeks of history) then never blanks the screen: the old page
  // stays up, dimmed, until the new one is ready to be shown.
  //
  // Only a change of PAGE is deferred. A filter, a period, a tab or a selected
  // day is not, so those controls answer at once and never dim the page.
  const deferredRoute = useDeferredValue(liveRoute);
  const identityOf = (r: Route) => `${r.page}|${r.member ?? ""}|${r.settings}|${r.team ?? ""}`;
  const switching = identityOf(deferredRoute) !== identityOf(liveRoute);
  const route = switching ? deferredRoute : liveRoute;
  const pageKey = identityOf(route);
  const { data: admin, error: adminError, reload: reloadAdmin } = useAdminData();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string; tone: "ok" | "error" } | null>(null);
  const today = istToday();

  const people = useMemo(() => new Map<string, Person>((admin?.people ?? []).map((p) => [p.email, p])), [admin]);

  // Let the address bar speak in ids, and read a link that already does.
  useEffect(() => {
    if (!admin) return;
    registerPeople(admin.people);
    resolveMember();
  }, [admin, resolveMember]);

  // Auto-dismiss, longer for an error: it is the one worth reading.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === "error" ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback((message: string, tone: "ok" | "error" = "ok") => setToast({ id: Date.now(), message, tone }), []);

  const openMember = useCallback((email: string, day?: string | null) => go({ page: "people", member: email, day: day ?? null }), [go]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try { await onLoadHistory(); notify("Earlier months loaded"); }
    catch { notify("Earlier months could not be loaded. Try again.", "error"); }
    finally { setLoadingHistory(false); }
  }, [onLoadHistory, notify]);

  // Memoized on purpose. A fresh `filters` object every render made every page's
  // `useScope` recompute its rows (and Analytics its weekly series) on ANY
  // AdminApp render, including the urgent pass of a page change, where it would
  // redo the old page's whole computation before the nav could repaint.
  const filters = useMemo(() => ({ dept: route.dept, site: route.site }), [route.dept, route.site]);
  const ctx = useMemo<AdminCtx>(() => ({
    employees, dates, today, viewer, statusOptions, admin, adminError, reloadAdmin, refresh: onRefresh, refreshing, lastUpdated, people,
    history: { full: fullHistory, loading: loadingHistory, load: loadHistory },
    filters, route, go, setFilter, openMember, dialog, openDialog: setDialog, notify,
  }), [employees, dates, today, viewer, statusOptions, admin, adminError, reloadAdmin, onRefresh, refreshing, lastUpdated, people,
    fullHistory, loadingHistory, loadHistory, filters, route, go, setFilter, openMember, dialog, notify]);

  const name = employees.find((e) => e.email === viewer.email)?.name || admin?.people.find((p) => p.email === viewer.email)?.full_name || viewer.email.split("@")[0];
  const access: Access = { canEdit: viewer.canEdit, canManageAccess: viewer.canManageAccess };

  const memberName = route.member && admin ? employees.find((e) => e.email === route.member)?.name || people.get(route.member)?.full_name || route.member : undefined;
  const crumbTail = route.page === "people" && route.member ? `${memberName}${route.settings ? " / SETTINGS" : ""}` : route.page === "teams" && route.team ? route.team : undefined;

  // Memoized so the urgent pass of a page change reuses the very same element
  // for the old page instead of re-rendering it.
  const content = useMemo(() => {
    switch (route.page) {
      case "overview": return <OverviewPage />;
      case "people": return route.member ? (route.settings ? <PersonSettingsPage /> : <MemberPage />) : <PeoplePage />;
      case "teams": return route.team ? <TeamDetailPage /> : <TeamsPage />;
      case "analytics": return <AnalyticsPage />;
      case "attention": return <AttentionPage />;
      case "administration": return <AdministrationPage />;
    }
  }, [route.page, route.member, route.settings, route.team]);

  // The first page after the skeleton appears as it is; fading it in from
  // nothing is an empty frame. Later page changes animate.
  const shown = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  const waitingForAdmin = !admin && !adminError && route.page !== "administration";
  useEffect(() => { if (!waitingForAdmin) shown.current = true; }, [waitingForAdmin]);
  // Back to the top once the new page is what is on screen, not at the click.
  // Back and Forward leave the scroll alone, as they did before.
  const firstKey = useRef(pageKey);
  const fromHistory = useRef(false);
  useEffect(() => {
    const onPop = () => { fromHistory.current = true; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (firstKey.current === pageKey) return;
    firstKey.current = pageKey;
    if (fromHistory.current) { fromHistory.current = false; return; }
    window.scrollTo({ top: 0 });
  }, [pageKey]);
  // The old page is on its way out: it should not take clicks or focus. (`inert`
  // is not a prop in React 18, so it is set on the element.)
  useEffect(() => { if (body.current) body.current.inert = switching; }, [switching]);

  // Not on a person's own record or the settings behind it, nor Administration: a department filter means nothing there.
  const filtersApply = (route.page === "overview" || route.page === "analytics" || route.page === "attention" || route.page === "teams" || (route.page === "people" && !route.member));

  const close = () => setDialog(null);
  const dialogBody = dialog && (
    dialog.type === "correct" ? <CorrectionDialog initialEmail={dialog.email} initialDay={dialog.day} onClose={close} />
    : dialog.type === "grant" ? <GrantDialog onClose={close} />
    : dialog.type === "access" ? <ManageAccessDialog email={dialog.email} onClose={close} />
    : dialog.type === "roster" ? <RosterDialog groupKey={dialog.group} onClose={close} />
    : dialog.type === "members" ? <MembersDialog groupKey={dialog.group} onClose={close} />
    : <OperationDialog initialJob={dialog.job} onClose={close} />
  );
  const dialogLabel = dialog ? { correct: "Correct attendance", grant: "Grant admin access", access: "Manage access", roster: "Edit roster", members: "Group members", operation: "Operation" }[dialog.type] : "";

  return (
    <AdminProvider value={ctx}>
      <AdminShell page={liveRoute.page} onGo={(page) => go({ page })} access={access} name={name} onMyView={onMyView}
        onSignOut={browserSignOut} crumbTail={switching ? undefined : crumbTail}
        updated={lastUpdated ? `Updated ${ago(lastUpdated)} · IST` : undefined} onRefresh={() => { void onRefresh(); }} refreshing={refreshing}>

        {adminError && route.page !== "administration" && (
          <div role="alert" className="mb-6 rounded-xl px-4 py-3 flex items-center justify-between gap-4 text-[13px]" style={{ background: C.warnSoft, border: "1px solid #EBD9A8", color: C.text2 }}>
            <span className="flex items-center gap-2"><TriangleAlert size={16} style={{ color: C.warn }} /> Some details (sites, employee IDs, directory) could not be loaded. {adminError}</span>
            <Button variant="outline" style={{ minHeight: 36 }} onClick={() => void reloadAdmin()}>Try again</Button>
          </div>
        )}

        {/* Filters carry from page to page, so every page they affect says when one is on. */}
        {filtersApply && <FilterBanner />}

        {waitingForAdmin ? <AdminLoadingBody page={route.page} /> : (
          // No exit and no `mode="wait"`: the old page is replaced in the same
          // commit the new one is ready in, so there is never an empty frame.
          <div ref={body} style={{ opacity: switching ? 0.55 : 1, transition: "opacity 120ms ease-out" }} aria-busy={switching}>
            <MotionConfig reducedMotion="user">
              <motion.div key={pageKey} variants={pageMotion} initial={shown.current ? "initial" : false} animate="animate">{content}</motion.div>
            </MotionConfig>
          </div>
        )}
      </AdminShell>

      <AnimatePresence>{dialog && <Modal key={dialog.type} label={dialogLabel} width={dialog.type === "correct" ? 720 : 640} onClose={close}>{dialogBody}</Modal>}</AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.22 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 px-4 py-3 rounded-xl text-[13px] font-medium max-w-[min(560px,92vw)]"
            style={{ background: toast.tone === "error" ? C.bad : C.text, color: "#fff", boxShadow: "var(--shadow-lg)" }}>
            {toast.tone === "error" ? <TriangleAlert size={15} /> : <Check size={15} style={{ color: "#86EFAC" }} />} {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </AdminProvider>
  );
}

