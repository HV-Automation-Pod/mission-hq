"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Building2, Users } from "lucide-react";
import { C, Button, Card, CountUp, GrowBar, Item, Stagger } from "@/components/ui";
import { useAdmin } from "../context";
import { ChipTabs, EmptyState, FilterBar, PageHeading, useScope } from "../ui";
import { aggregate, groupMembers, plural, type Aggregate } from "@/lib/domain/analytics";

type View = "departments" | "groups";

export default function TeamsPage() {
  const { go, admin, employees, people, openDialog } = useAdmin();
  const scope = useScope();
  const [view, setView] = useState<View>("departments");

  const departments = useMemo(
    () => scope.depts.map((name) => {
      const rows = scope.rows.filter((r) => r.employee.departments.includes(name));
      return { name, a: aggregate(rows) };
    }).filter((d) => d.a.people > 0).sort((x, y) => y.a.people - x.a.people),
    [scope.depts, scope.rows],
  );

  const groups = useMemo(() => (admin?.groups ?? []).map((g) => {
    const emails = new Set(groupMembers(g, employees, people));
    return { g, a: aggregate(scope.rows.filter((r) => emails.has(r.employee.email))), size: emails.size };
  }), [admin, employees, people, scope.rows]);

  return (
    <>
      <PageHeading title="Teams & departments" sub="Start with a department summary, then open the people and days behind it." />
      <FilterBar scope={scope} />

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <ChipTabs<View> label="Grouping" value={view} onChange={setView} items={[{ id: "departments", label: "Departments" }, { id: "groups", label: "Report groups" }]} />
        <span className="text-[12px]" style={{ color: C.muted }}>People may belong to multiple report groups. Group totals can overlap.</span>
      </div>

      {view === "departments" ? (
        departments.length === 0 ? <EmptyState title="No departments in this scope" body="Try clearing the site filter." /> : (
          <Stagger className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {departments.map(({ name, a }, i) => <Item key={name}><TeamCard icon={<Building2 size={22} />} name={name} a={a} delay={i * 0.04}
              foot={`${a.waiting} waiting today`} action="Open" onOpen={() => go({ page: "teams", team: name })} /></Item>)}
            <Item><Card tone="tint" className="h-full flex flex-col !p-7">
              <h2 className="text-[24px] font-semibold tracking-tight">Need a different group?</h2>
              <p className="text-[14px] mt-5 leading-relaxed" style={{ color: C.text2 }}>Manage custom rosters for the fortnightly reports. Department membership stays connected to Zoho.</p>
              <div className="mt-auto pt-6"><Button variant="outline" className="w-full" onClick={() => go({ page: "administration", tab: "groups" })}>Manage report groups</Button></div>
            </Card></Item>
          </Stagger>
        )
      ) : groups.length === 0 ? (
        <EmptyState title={admin ? "No report groups" : "Report groups are loading"} body="Groups define who appears in each fortnightly Slack report." />
      ) : (
        <Stagger className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {groups.map(({ g, a, size }, i) => <Item key={g.key}><TeamCard icon={<Users size={22} />} name={g.name} a={a} delay={i * 0.04} people={size}
            foot={g.match_kind === "roster" ? "Custom roster" : "From Zoho"} action="View members" onOpen={() => openDialog({ type: "members", group: g.key })} /></Item>)}
        </Stagger>
      )}

      <Card className="mt-8 flex items-start gap-4 !p-6">
        <span style={{ color: C.muted }} aria-hidden>{"ⓘ"}</span>
        <div>
          <h2 className="text-[16px] font-semibold">Compare the same period and denominator.</h2>
          <p className="text-[13px] mt-2" style={{ color: C.text2 }}>Policy score = credited days {"÷"} counted days, with each person&apos;s WFH allowance applied per calendar week.</p>
        </div>
      </Card>
    </>
  );
}

function TeamCard({ icon, name, a, foot, action, onOpen, delay = 0, people }: {
  icon: React.ReactNode; name: string; a: Aggregate; foot: string; action: string; onOpen: () => void; delay?: number; people?: number;
}) {
  const n = people ?? a.people;
  return (
    <button onClick={onOpen} className="w-full h-full text-left rounded-2xl p-7 transition-shadow hover:shadow-[0_8px_22px_rgb(23_43_44/9%)]"
      style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "var(--shadow-xs), var(--shadow-sm)" }} aria-label={`${action} ${name}`}>
      <span style={{ color: C.primary }}>{icon}</span>
      <h2 className="text-[26px] font-semibold tracking-tight mt-5 leading-tight">{name}</h2>
      <p className="text-[13px] mt-3" style={{ color: C.muted }}>{plural(n, "person", "people")}</p>
      <div className="flex items-baseline gap-4 mt-7">
        <span className="text-[44px] leading-none font-semibold tracking-tight">{a.pct === null ? "n/a" : <><CountUp value={a.pct} />%</>}</span>
        <span className="text-[12px]" style={{ color: C.muted }}>Policy score</span>
      </div>
      <div className="mt-5"><GrowBar pct={a.pct ?? 0} delay={delay} /></div>
      <div className="flex items-center justify-between mt-6 text-[12px]">
        <span style={{ color: C.muted }}>{foot}</span>
        <span className="font-medium inline-flex items-center gap-1.5 text-[13px]" style={{ color: C.primary }}>{action} <ArrowRight size={13} /></span>
      </div>
    </button>
  );
}

