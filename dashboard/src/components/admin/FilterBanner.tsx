"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ListFilter, X } from "lucide-react";
import { C, LinkButton, Tooltip, focusRing } from "@/components/ui";
import { ALL, inScope, periodsFor } from "@/lib/domain/analytics";
import { useAdmin } from "./context";

/**
 * Says out loud when a filter is changing what the page shows.
 *
 * The department, site and period are kept in the address and carried from page
 * to page, so a filter chosen on People is still in force on Overview. That is
 * useful and it is invisible, and an invisible filter is how a screen ends up
 * showing one person and nobody noticing. So whenever one is active, every page
 * it affects wears this: what is applied, how many people it leaves, and one
 * click to remove each part or all of it.
 */
export function FilterBanner() {
  const { route, setFilter, employees, people, dates, today } = useAdmin();

  const periodLabel = useMemo(
    () => (route.period ? periodsFor(dates, today).find((p) => p.key === route.period)?.label ?? null : null),
    [route.period, dates, today],
  );
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (route.dept !== ALL) chips.push({ key: "dept", label: `Department: ${route.dept}`, clear: () => setFilter({ dept: ALL }) });
  if (route.site !== ALL) chips.push({ key: "site", label: `Site: ${route.site}`, clear: () => setFilter({ site: ALL }) });
  if (periodLabel) chips.push({ key: "period", label: `Period: ${periodLabel}`, clear: () => setFilter({ period: "" }) });

  const inView = useMemo(
    () => employees.filter((e) => inScope(e, people.get(e.email), { dept: route.dept, site: route.site })).length,
    [employees, people, route.dept, route.site],
  );
  const peopleFiltered = route.dept !== ALL || route.site !== ALL;

  return (
    <AnimatePresence initial={false}>
      {chips.length > 0 && (
        <motion.div key="filters" role="status" aria-live="polite"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }} animate={{ opacity: 1, height: "auto", marginBottom: 24 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.22 }} style={{ overflow: "hidden" }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl px-4 py-3" style={{ background: C.selected, border: "1px solid #BFDAD5" }}>
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold" style={{ color: C.primary }}>
              <ListFilter size={15} /> Filtered view
            </span>
            {peopleFiltered && (
              <span className="text-[13px]" style={{ color: C.text2 }}>
                Showing <span className="font-semibold" style={{ color: C.text }}>{inView.toLocaleString()}</span> of {employees.length.toLocaleString()} {employees.length === 1 ? "person" : "people"}
              </span>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-1.5 pl-3 pr-1 h-7 rounded-full text-[12px] font-medium" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                  {c.label}
                  <Tooltip label="Remove this filter" side="bottom">
                    <button onClick={c.clear} aria-label={`Remove filter: ${c.label}`} className={`w-5 h-5 rounded-full flex items-center justify-center hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.muted }}><X size={12} /></button>
                  </Tooltip>
                </span>
              ))}
            </div>
            <span className="ml-auto"><LinkButton onClick={() => setFilter({ dept: ALL, site: ALL, period: "", day: null })}>Clear all filters</LinkButton></span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
