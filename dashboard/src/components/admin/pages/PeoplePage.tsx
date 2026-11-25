"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Pencil } from "lucide-react";
import { format, parseISO } from "date-fns";
import { C, Button, Card, Item, SearchInput, Select, Stagger } from "@/components/ui";
import { useAdmin } from "../context";
import { ExitedCard, PersonCard } from "../PersonCard";
import { ChipTabs, EmptyState, PageHeading, useScope, type PersonRow } from "../ui";
import { ALL, siteOf } from "@/lib/domain/analytics";

type Chip = "all" | "missing" | "wfa" | "exempt" | "exited";
const PAGE_SIZE = 12;

export default function PeoplePage() {
  const { route, setFilter, openMember, openDialog, viewer, people } = useAdmin();
  const scope = useScope();
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [page, setPage] = useState(0);

  // Search runs over everyone in the department and site chosen, so the chips'
  // counts and the list always describe the same people.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scope.rows;
    return scope.rows.filter((r) => r.name.toLowerCase().includes(q) || r.employee.email.toLowerCase().includes(q) || (r.person?.emp_id ?? "").toLowerCase().includes(q));
  }, [scope.rows, query]);

  const exited = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inPayload = new Set(scope.everyone.map((r) => r.employee.email));
    return [...people.values()].filter((p) => p.exited_at && !inPayload.has(p.email)
      && (route.site === ALL || siteOf(p) === route.site)
      && (!q || (p.full_name ?? "").toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || (p.emp_id ?? "").toLowerCase().includes(q)));
  }, [people, scope.everyone, query, route.site]);

  const counts = useMemo(() => ({
    all: searched.length,
    missing: searched.filter((r) => r.missing.length > 0).length,
    wfa: searched.filter((r) => r.wfaOver).length,
    exempt: searched.filter((r) => !!r.person?.wfo_exempt).length,
    exited: exited.length,
  }), [searched, exited]);

  const list = useMemo(() => {
    const by = (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name);
    if (chip === "missing") return searched.filter((r) => r.missing.length > 0).sort(by);
    if (chip === "wfa") return searched.filter((r) => r.wfaOver).sort(by);
    if (chip === "exempt") return searched.filter((r) => !!r.person?.wfo_exempt).sort(by);
    return [...searched].sort(by);
  }, [searched, chip]);

  // Back to the first page whenever what is being listed changes.
  useEffect(() => setPage(0), [query, chip, route.dept, route.site, route.period]);

  const showingExited = chip === "exited";
  const total = showingExited ? exited.length : list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = page * PAGE_SIZE;
  const periodName = scope.period.key === "all" ? "Whole period summary" : `${format(parseISO(scope.period.from), "MMMM yyyy")} summary`;

  return (
    <>
      <PageHeading title="People" sub="Find anyone, understand their record, and make a correction from their profile." />

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_264px_264px] gap-4 mb-6">
        <SearchInput label="Search people" placeholder="Search name, email or employee ID" value={query} onChange={setQuery} />
        <Select label="Department" value={route.dept} onChange={(v) => setFilter({ dept: v })}
          options={[{ value: ALL, label: "All departments" }, ...scope.depts.map((d) => ({ value: d, label: d }))]} />
        <Select label="Site" value={route.site} onChange={(v) => setFilter({ site: v })}
          options={[{ value: ALL, label: "All sites" }, ...scope.sites.map((s) => ({ value: s, label: s }))]} />
      </div>

      <ChipTabs<Chip> label="Filter people" value={chip} onChange={setChip} items={[
        { id: "all", label: "All people", count: counts.all },
        { id: "missing", label: "Missing answers", count: counts.missing },
        { id: "wfa", label: "WFA over limit", count: counts.wfa },
        { id: "exempt", label: "Exempt", count: counts.exempt },
        { id: "exited", label: "Exited", count: counts.exited },
      ]} />

      <div className="flex items-center justify-between mt-7 mb-4 text-[13px]" style={{ color: C.text2 }}>
        <span>{total.toLocaleString()} {total === 1 ? "person" : "people"} {"·"} Sorted by name</span>
        {!showingExited && <span>{periodName}</span>}
      </div>

      {total === 0 ? (
        <EmptyState title="No one matches" body="Try a different search, or clear the department and site filters."
          action={<Button variant="outline" onClick={() => { setQuery(""); setChip("all"); setFilter({ dept: ALL, site: ALL }); }}>Clear filters</Button>} />
      ) : (
        <Stagger key={`${chip}-${page}-${query}`} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {showingExited
            ? exited.slice(from, from + PAGE_SIZE).map((p) => <Item key={p.email}><ExitedCard person={p} /></Item>)
            : list.slice(from, from + PAGE_SIZE).map((r) => <Item key={r.employee.email}><PersonCard row={r} onOpen={() => openMember(r.employee.email)} /></Item>)}
        </Stagger>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-7">
          <span className="text-[13px]" style={{ color: C.text2 }}>Showing {from + 1}{"–"}{Math.min(from + PAGE_SIZE, total)} of {total.toLocaleString()} {total === 1 ? "person" : "people"}</span>
          <div className="flex gap-3">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next {Math.min(PAGE_SIZE, total - from - PAGE_SIZE) > 0 ? Math.min(PAGE_SIZE, total - from - PAGE_SIZE) : ""} <ArrowRight size={14} /></Button>
          </div>
        </div>
      )}

      <Card tone="tint" className="mt-8 flex flex-col sm:flex-row sm:items-center gap-5 !p-6">
        <span style={{ color: C.primary }}><Pencil size={22} /></span>
        <div className="flex-1">
          <h2 className="text-[18px] font-semibold">Need to correct an older attendance record?</h2>
          <p className="text-[13px] mt-1.5" style={{ color: C.text2 }}>Open a person&apos;s profile. Admin editors can choose any past date, including outside the current reporting period.</p>
        </div>
        {viewer.canEdit && <Button variant="outline" onClick={() => openDialog({ type: "correct" })}>Correct a record</Button>}
      </Card>
    </>
  );
}
