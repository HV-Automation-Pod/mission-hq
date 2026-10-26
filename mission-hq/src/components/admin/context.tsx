"use client";

/**
 * The admin workspace's shared state: where you are, what you may do, and the
 * data every page reads.
 *
 * WHERE YOU ARE LIVES IN THE URL, not in component state. The page, the member
 * or department open on it, the Administration tab and the filters are all
 * query parameters, written with pushState, so the browser's Back button walks
 * back through the workspace, a refresh lands where it was, and a link to a
 * person's record can be sent to a colleague. Parameters are `ap` `am` `at`
 * `atab` `ps` and `dept` `site` `period`: none of them collides with the member
 * view's (`view`, `page`) or the old dashboard's, which are retired.
 *
 * WHAT YOU MAY DO is `canEdit`, from the same viewer the server checks. It only
 * decides what to DRAW; every action re-checks role and edit permission.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchAdminData } from "@/lib/api/admin";
import type { Employee } from "@/lib/domain/types";
import type { AdminData, Person } from "@/lib/domain/access-types";
import { ALL, type Filters } from "@/lib/domain/analytics";

export type AdminPage = "overview" | "people" | "teams" | "analytics" | "attention" | "administration";
export type AdminTab = "access" | "directory" | "groups" | "operations";
export type AttentionTab = "missing" | "waiting" | "wfa" | "directory";

export type Route = {
  page: AdminPage;
  /** A person's profile, by email. */
  member: string | null;
  /** A department's detail, by name. */
  team: string | null;
  /** The person-settings screen, over a member. */
  settings: boolean;
  tab: AdminTab;
  attention: AttentionTab;
  dept: string;
  site: string;
  /** A period key from `periodsFor`: "2026-10", or "all". Empty means the newest month. */
  period: string;
  /** The person's calendar, which day is selected. */
  day: string | null;
};

const PAGES: AdminPage[] = ["overview", "people", "teams", "analytics", "attention", "administration"];
const TABS: AdminTab[] = ["access", "directory", "groups", "operations"];
const ATTN: AttentionTab[] = ["missing", "waiting", "wfa", "directory"];

export const DEFAULT_ROUTE: Route = {
  page: "overview", member: null, team: null, settings: false, tab: "access", attention: "missing",
  dept: ALL, site: ALL, period: "", day: null,
};

function readRoute(): Route {
  if (typeof window === "undefined") return DEFAULT_ROUTE;
  const q = new URLSearchParams(window.location.search);
  const page = q.get("ap") as AdminPage | null;
  const tab = q.get("atab") as AdminTab | null;
  const attention = q.get("an") as AttentionTab | null;
  return {
    page: page && PAGES.includes(page) ? page : "overview",
    member: q.get("am"), team: q.get("at"), settings: q.get("ps") === "1",
    tab: tab && TABS.includes(tab) ? tab : "access",
    attention: attention && ATTN.includes(attention) ? attention : "missing",
    dept: q.get("dept") || ALL, site: q.get("site") || ALL, period: q.get("period") || "", day: q.get("day"),
  };
}

function writeRoute(r: Route, mode: "push" | "replace") {
  const q = new URLSearchParams(window.location.search);
  // The member view's own parameters are cleared: this is the workspace now.
  q.delete("view"); q.delete("page");
  const set = (k: string, v: string | null | false, empty: string | null = null) => {
    if (v && v !== empty) q.set(k, String(v)); else q.delete(k);
  };
  set("ap", r.page, "overview");
  set("am", r.member);
  set("at", r.team);
  set("ps", r.settings ? "1" : null);
  set("atab", r.tab, "access");
  set("an", r.attention, "missing");
  set("dept", r.dept, ALL);
  set("site", r.site, ALL);
  set("period", r.period);
  set("day", r.day);
  const qs = q.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (mode === "push") window.history.pushState(null, "", url); else window.history.replaceState(null, "", url);
}

// ─── Dialogs ────────────────────────────────────────────────

export type DialogState =
  | { type: "correct"; email?: string; day?: string }
  | { type: "grant" }
  | { type: "access"; email: string }
  | { type: "roster"; group: string }
  | { type: "members"; group: string }
  | { type: "operation"; job?: string }
  | null;

// ─── The context ────────────────────────────────────────────

export type AdminCtx = {
  employees: Employee[];
  dates: string[];
  today: string;
  viewer: { email: string; canEdit: boolean; canManageAccess: boolean };
  /** The work locations an answer can be corrected to, from `locations`. */
  statusOptions: { value: string; status: string }[];
  admin: AdminData | null;
  adminError: string | null;
  reloadAdmin: () => Promise<void>;
  /** Refetch the attendance payload. */
  refresh: () => Promise<void>;
  /** How far back the data reaches. The first load is a quarter; an admin can ask for everything. */
  history: { full: boolean; loading: boolean; load: () => Promise<void> };
  refreshing: boolean;
  lastUpdated: Date | null;
  people: Map<string, Person>;
  filters: Filters;

  route: Route;
  /** Move within the workspace: pushes history, so Back works. */
  go: (to: Partial<Route>) => void;
  /** Change a filter or the period in place: replaces history, no new entry. */
  setFilter: (to: Partial<Pick<Route, "dept" | "site" | "period" | "attention" | "day">>) => void;
  openMember: (email: string, day?: string | null) => void;
  dialog: DialogState;
  openDialog: (d: DialogState) => void;
  /** A short message at the foot of the screen. */
  notify: (message: string, tone?: "ok" | "error") => void;
};

const Ctx = createContext<AdminCtx | null>(null);

export function useAdmin(): AdminCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdmin must be used inside <AdminProvider>");
  return v;
}

/** The route, kept in step with the address bar. */
export function useRouteState() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((to: Partial<Route>) => {
    setRoute((cur) => {
      // Landing on a page starts it clean: a leftover member or team from the
      // last page would open somebody's record when you only chose "People".
      const next: Route = { ...cur, member: null, team: null, settings: false, day: null, ...to };
      writeRoute(next, "push");
      window.scrollTo({ top: 0 });
      return next;
    });
  }, []);

  const setFilter = useCallback((to: Partial<Route>) => {
    setRoute((cur) => { const next = { ...cur, ...to }; writeRoute(next, "replace"); return next; });
  }, []);

  return { route, go, setFilter };
}

/** The data only admins get: access list, directory, jobs, people, groups. */
export function useAdminData() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchAdminData());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load };
}

export function AdminProvider({ value, children }: { value: AdminCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
