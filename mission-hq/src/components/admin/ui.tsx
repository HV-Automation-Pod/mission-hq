"use client";

/**
 * The pieces the admin pages share: a page heading, the filter bar, a metric
 * card, the empty and error states, and `useScope`, which turns the route's
 * filters and period into the rows and totals every page draws.
 */

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import { C, Button, CountUp, LinkButton, Select, focusRing } from "@/components/ui";
import { useAdmin } from "./context";
import {
  ALL, aggregate, departmentsOf, inScope, periodsFor, rowFor, siteOf, type Aggregate, type Period, type PersonRow,
} from "@/lib/domain/analytics";

export function PageHeading({ title, sub, aside }: { title: string; sub?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-7 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight">{title}</h1>
        {sub && <p className="text-[14px] mt-3 max-w-[640px]" style={{ color: C.text2 }}>{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

/** The scope of the page: who it is about, over which period. */
export function useScope(day?: string) {
  const { employees, dates, today, people, filters, route } = useAdmin();
  const periods = useMemo(() => periodsFor(dates, today), [dates, today]);
  const period: Period = periods.find((p) => p.key === route.period) ?? periods[0];
  const chosenDay = day ?? today;

  const everyone = useMemo(
    () => employees.map((e) => rowFor(e, people.get(e.email), dates, period, chosenDay, today)),
    [employees, people, dates, period, chosenDay, today],
  );
  const rows = useMemo(
    () => everyone.filter((r) => inScope(r.employee, r.person, filters)),
    [everyone, filters],
  );
  const agg: Aggregate = useMemo(() => aggregate(rows), [rows]);
  const depts = useMemo(() => departmentsOf(everyone), [everyone]);
  const sites = useMemo(
    () => Array.from(new Set(employees.map((e) => siteOf(people.get(e.email))))).sort(),
    [employees, people],
  );
  return { periods, period, everyone, rows, agg, depts, sites, today, day: chosenDay };
}

export type Scope = ReturnType<typeof useScope>;

/** Not a period: choosing it fetches the earlier months instead. */
const EARLIER = "__earlier__";

/** Period, department and site, with a way back to "everything". */
export function FilterBar({ scope, showPeriod = true, leading }: { scope: Scope; showPeriod?: boolean; leading?: React.ReactNode }) {
  const { route, setFilter, history } = useAdmin();
  const dirty = route.dept !== ALL || route.site !== ALL || (showPeriod && route.period !== "") || !!route.day;
  return (
    <div className="flex flex-wrap items-end gap-4 mb-6">
      {leading}
      {showPeriod && (
        <Select label="Period" hideLabel className="w-[270px]" value={scope.period.key}
          onChange={(v) => { if (v === EARLIER) void history.load(); else setFilter({ period: v }); }}
          // Only a quarter is loaded to start with, because the first screen should be quick.
          // Asking for more is one click, and then every earlier month is a choice here.
          options={[
            ...scope.periods.map((p) => ({ value: p.key, label: p.label })),
            ...(history.full ? [] : [{ value: EARLIER, label: history.loading ? "Loading earlier months\u2026" : "Earlier months\u2026", hint: history.loading ? "" : "back to 2025" }]),
          ]} />
      )}
      <Select label="Department" hideLabel className="w-[220px]" value={route.dept} onChange={(v) => setFilter({ dept: v })}
        options={[{ value: ALL, label: "All departments" }, ...scope.depts.map((d) => ({ value: d, label: d }))]} />
      <Select label="Site" hideLabel className="w-[190px]" value={route.site} onChange={(v) => setFilter({ site: v })}
        options={[{ value: ALL, label: "All sites" }, ...scope.sites.map((s) => ({ value: s, label: s }))]} />
      {dirty && (
        <div className="h-11 flex items-center ml-auto">
          <LinkButton onClick={() => setFilter({ dept: ALL, site: ALL, period: "", day: null })}>Reset filters</LinkButton>
        </div>
      )}
    </div>
  );
}

/** A headline number. A button when it leads somewhere. */
export function Kpi({ label, value, sub, numeric, format, onClick, tone, valueNode }: {
  label: string; value?: string | number; sub?: string; numeric?: number; format?: (n: number) => string; onClick?: () => void;
  tone?: "warn"; valueNode?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const inner = (
    <>
      <div className="text-[13px]" style={{ color: C.text2 }}>{label}</div>
      <div className="text-[44px] leading-none font-semibold tracking-tight mt-4" style={{ color: tone === "warn" ? C.warn : C.text }}>
        {valueNode ?? (numeric !== undefined ? <CountUp value={numeric} format={format} /> : value)}
      </div>
      {sub && <div className="text-[12px] mt-3.5" style={{ color: C.muted }}>{sub}</div>}
    </>
  );
  const box = "rounded-2xl p-5 text-left w-full h-full";
  const style = { background: C.surface, border: `1px solid ${C.border}`, boxShadow: "var(--shadow-xs), var(--shadow-sm)" };
  return onClick ? (
    <motion.button onClick={onClick} className={`${box} ${focusRing}`} style={style}
      whileHover={reduce ? undefined : { y: -2, boxShadow: "0 6px 18px rgb(23 43 44 / 8%)" }} whileTap={reduce ? undefined : { scale: 0.99 }}>
      {inner}
    </motion.button>
  ) : <div className={box} style={style}>{inner}</div>;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl py-14 px-6 text-center" style={{ background: C.surface, border: `1px dashed ${C.border}` }}>
      <span className="mx-auto w-11 h-11 rounded-full flex items-center justify-center" style={{ background: C.inset, color: C.muted }}><Inbox size={20} /></span>
      <div className="text-[16px] font-semibold mt-4">{title}</div>
      {body && <p className="text-[13px] mt-1.5 max-w-[420px] mx-auto" style={{ color: C.text2 }}>{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Unavailable is not empty, and never zero. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl py-12 px-6 text-center" style={{ background: C.warnSoft, border: "1px solid #EBD9A8" }}>
      <span className="mx-auto w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "#FCEBC8", color: C.warn }}><AlertCircle size={20} /></span>
      <div className="text-[16px] font-semibold mt-4">This could not be loaded</div>
      <p className="text-[13px] mt-1.5 max-w-[460px] mx-auto" style={{ color: C.text2 }}>{message}</p>
      {onRetry && <div className="mt-5 flex justify-center"><Button variant="outline" onClick={onRetry}><RefreshCw size={15} /> Try again</Button></div>}
    </div>
  );
}

/** A segmented row of chips; the active one is filled. */
export function ChipTabs<T extends string>({ value, onChange, items, label }: {
  value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[]; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button key={it.id} role="tab" aria-selected={on} onClick={() => onChange(it.id)}
            className={`h-9 px-4 rounded-full text-[12px] font-medium transition-colors ${focusRing}`}
            style={on ? { background: C.selected, color: C.primary } : { background: C.inset, color: C.text2 }}>
            {it.label}{it.count !== undefined && <span className="ml-1.5 font-semibold">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export type { PersonRow };

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(from: Date | string | null | undefined, now = Date.now()): string {
  if (!from) return "";
  const minutes = Math.max(0, Math.round((now - new Date(from).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
