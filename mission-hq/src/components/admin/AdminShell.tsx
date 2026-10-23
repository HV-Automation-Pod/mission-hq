"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import {
  Building2, CircleAlert, LayoutGrid, LineChart, Lock, LogOut, RefreshCw, Settings, Users, type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/ui";
import { Tooltip } from "@/components/ui";
import { C, Avatar, Button, Modal, PETROL_VARS, focusRing, useLightOnly } from "@/components/ui";
import type { AdminPage } from "./context";

/**
 * The frame every admin screen sits in: the 232px sidebar, the breadcrumb and
 * the "updated" line. Pure presentation. It takes what it draws as props so the
 * loading screen can use the very same frame before anything is known, which is
 * what keeps the page from rearranging itself when the data lands.
 */

const MAIN: { id: AdminPage; label: string; Icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", Icon: LayoutGrid },
  { id: "people", label: "People", Icon: Users },
  { id: "teams", label: "Teams & departments", Icon: Building2 },
  { id: "analytics", label: "Analytics", Icon: LineChart },
  { id: "attention", label: "Needs attention", Icon: CircleAlert },
];
const MANAGE: { id: AdminPage; label: string; Icon: LucideIcon }[] = [
  { id: "administration", label: "Administration", Icon: Settings },
];

export const CRUMB: Record<AdminPage, string> = {
  overview: "OVERVIEW", people: "PEOPLE", teams: "TEAMS & DEPARTMENTS", analytics: "ANALYTICS",
  attention: "NEEDS ATTENTION", administration: "ADMINISTRATION",
};

export type Access = { canEdit: boolean } | "checking";

function NavItem({ id, label, Icon, active, onGo }: {
  id: AdminPage; label: string; Icon: LucideIcon; active: boolean; onGo?: (p: AdminPage) => void;
}) {
  return (
    <button onClick={() => onGo?.(id)} disabled={!onGo} aria-current={active ? "page" : undefined}
      className={`relative w-full flex items-center gap-3 px-3.5 h-11 rounded-xl text-[14px] font-medium transition-colors ${!active && onGo ? "hover:bg-[#EEF3F1]" : ""} ${focusRing}`}
      style={{ color: active ? C.text : C.text2 }}>
      {active && (
        <motion.span layoutId="admin-nav-active" className="absolute inset-0 rounded-xl" style={{ background: C.selected }}
          transition={{ type: "spring", stiffness: 420, damping: 36 }} />
      )}
      {active && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r" style={{ background: C.primary }} />}
      <Icon size={18} className="relative flex-shrink-0" />
      <span className="relative flex-1 min-w-0 text-left whitespace-nowrap truncate">{label}</span>
    </button>
  );
}

export function AdminShell({
  page, onGo, access, name, onMyView, onSignOut, updated, onRefresh, refreshing, children, crumbTail,
}: {
  page: AdminPage;
  onGo?: (p: AdminPage) => void;
  access: Access;
  name?: string;
  onMyView?: () => void;
  onSignOut?: () => Promise<void>;
  updated?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: React.ReactNode;
  /** After the section in the breadcrumb: a person's name, a department. */
  crumbTail?: string;
}) {
  useLightOnly();
  const reduce = useReducedMotion();
  const [confirmOut, setConfirmOut] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // The "updated" line is relative; keep it honest as time passes.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);

  const signOut = async () => { setLeaving(true); try { await onSignOut?.(); } finally { location.href = "/login"; } };

  const permission = access === "checking" ? null : access.canEdit
    ? { title: "Can view and edit", sub: "All members · All past dates" }
    : { title: "View only", sub: "All members · Editing needs an admin editor" };

  return (
    <div className="min-h-dvh" style={PETROL_VARS}>
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[232px] flex-col z-30" style={{ background: C.canvas, borderRight: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-3 px-6 pt-7 pb-5">
          <BrandMark size={40} />
          <div>
            <div className="text-[19px] font-semibold leading-tight tracking-tight">MissionHQ</div>
            <div className="text-[10px] tracking-[0.18em]" style={{ color: C.muted }}>HYPERVERGE</div>
          </div>
        </div>
        <div className="px-5 pb-6">
          <span className="block w-full text-[12px] font-medium px-3.5 py-2 rounded-full" style={{ background: C.selected, color: C.primary }}>Admin workspace</span>
        </div>

        <LayoutGroup id="admin-nav">
          <div className="px-6 pb-3 text-[11px] tracking-[0.14em]" style={{ color: C.muted }}>WORKSPACE</div>
          <nav className="px-3 space-y-1" aria-label="Workspace">
            {MAIN.map((n) => <NavItem key={n.id} {...n} active={page === n.id} onGo={onGo} />)}
          </nav>
          <div className="px-6 pt-8 pb-3 text-[11px] tracking-[0.14em]" style={{ color: C.muted }}>MANAGE</div>
          <nav className="px-3 space-y-1" aria-label="Manage">
            {MANAGE.map((n) => <NavItem key={n.id} {...n} active={page === n.id} onGo={onGo} />)}
          </nav>
        </LayoutGroup>

        <div className="mt-auto p-3 space-y-3">
          <div className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 text-[13px] font-medium"><Lock size={14} /> {permission ? permission.title : "Checking access"}</div>
            <p className="text-[12px] mt-1.5 leading-snug" style={{ color: C.muted }}>{permission ? permission.sub : "Confirming what you may do…"}</p>
          </div>
          {onMyView ? (
            <button onClick={onMyView} className={`w-full text-left px-3 h-10 rounded-xl text-[13px] font-medium hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.primary }}>My member view</button>
          ) : <div className="px-3 h-10 flex items-center text-[13px]" style={{ color: C.muted }}>My member view</div>}
          <div className="pt-3 flex items-center gap-3 px-1" style={{ borderTop: `1px solid ${C.border}` }}>
            {name ? <Avatar name={name} size={36} /> : <span className="w-9 h-9 rounded-full po-shimmer" style={{ backgroundColor: "#E3EAE7" }} />}
            <div className="min-w-0 flex-1">
              {name ? <div className="text-[13px] font-medium truncate">{name}</div> : <span className="block h-3 w-24 rounded po-shimmer" style={{ backgroundColor: "#E3EAE7" }} />}
              <div className="text-[11px]" style={{ color: C.muted }}>{access === "checking" ? "" : access.canEdit ? "Admin editor" : "Admin viewer"}</div>
            </div>
            {onSignOut && (
              <Tooltip label="Sign out" side="top">
                <button onClick={() => setConfirmOut(true)} aria-label="Sign out" className={`p-2 rounded-lg hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.muted }}><LogOut size={16} /></button>
              </Tooltip>
            )}
          </div>
        </div>
      </aside>

      <div className="lg:pl-[232px]">
        <main className="mx-auto max-w-[1240px] px-5 lg:px-10 pt-6 pb-16">
          <div className="flex items-center justify-between gap-4 mb-6 min-h-[28px]">
            <div className="text-[11px] tracking-[0.14em] truncate" style={{ color: C.muted }}>
              ADMIN WORKSPACE / {CRUMB[page]}{crumbTail ? ` / ${crumbTail.toUpperCase()}` : ""}
            </div>
            <div className="flex items-center gap-3 text-[12px] flex-shrink-0" style={{ color: C.muted }}>
              {updated ? <span>{updated}</span> : null}
              {onRefresh && (
                <Tooltip label="Refresh data" side="bottom">
                  <button onClick={onRefresh} disabled={refreshing} aria-label="Refresh data" className={`p-1.5 rounded-lg hover:bg-[#EEF3F1] disabled:opacity-60 ${focusRing}`}>
                    <RefreshCw size={14} className={refreshing && !reduce ? "animate-spin" : ""} />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
          {children}
        </main>
      </div>

      <AnimatePresence>
        {confirmOut && (
          <Modal label="Sign out" width={440} onClose={() => !leaving && setConfirmOut(false)}>
            <h2 className="text-[20px] font-semibold">Sign out of MissionHQ?</h2>
            <p className="text-[13px] mt-2" style={{ color: C.text2 }}>You will need to sign in with Google again to open the admin workspace.</p>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setConfirmOut(false)} disabled={leaving}>Cancel</Button>
              <Button onClick={signOut} loading={leaving}>Sign out</Button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Sign-out through the browser client; the shell stays free of auth details. */
export async function browserSignOut() {
  await createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!).auth.signOut();
}
