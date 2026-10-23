"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { C, Avatar, Button, Card, Item, LinkButton, Pill, Stagger } from "@/components/ui";
import { useAdmin, type AttentionTab } from "../context";
import { ChipTabs, EmptyState, FilterBar, PageHeading, useScope } from "../ui";
import { formatDays, plural } from "@/lib/domain/analytics";
import { fmtDays } from "@/lib/domain/policy";

const PAGE = 8;

export default function AttentionPage() {
  const { route, setFilter, go, openMember, admin, today } = useAdmin();
  const scope = useScope();
  const tab = route.attention;
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [tab, route.dept, route.site]);

  const missing = useMemo(
    () => scope.rows.filter((r) => r.missing.length > 0).sort((a, b) => a.missing[0].localeCompare(b.missing[0]) || a.name.localeCompare(b.name)),
    [scope.rows],
  );
  const waiting = useMemo(() => scope.rows.filter((r) => r.dayStatus === "Pending").sort((a, b) => a.name.localeCompare(b.name)), [scope.rows]);
  const wfa = useMemo(() => scope.rows.filter((r) => r.wfaOver).sort((a, b) => ((b.wfaUsed ?? 0) - (b.wfaCap ?? 0)) - ((a.wfaUsed ?? 0) - (a.wfaCap ?? 0))), [scope.rows]);
  const directory = admin?.triage ?? [];
  const missingDays = missing.reduce((n, r) => n + r.missing.length, 0);

  const items: { id: AttentionTab; label: string; count: number }[] = [
    { id: "missing", label: "Past missing", count: missingDays }, { id: "waiting", label: "Waiting today", count: waiting.length },
    { id: "wfa", label: "WFA over limit", count: wfa.length }, { id: "directory", label: "Directory", count: directory.length },
  ];
  const list = tab === "missing" ? missing : tab === "waiting" ? waiting : tab === "wfa" ? wfa : [];
  const total = tab === "directory" ? directory.length : list.length;
  const from = page * PAGE;

  const heading = tab === "missing" ? `${missingDays.toLocaleString()} unanswered ${missingDays === 1 ? "day" : "days"} across ${plural(missing.length, "person", "people")}`
    : tab === "waiting" ? `${plural(waiting.length, "person", "people")} still waiting today`
    : tab === "wfa" ? `${plural(wfa.length, "person", "people")} over the annual WFA allowance`
    : `${plural(directory.length, "account")} to review`;
  const sub = tab === "missing" ? "Oldest unanswered first · Dates outside the member window can be corrected by an admin."
    : tab === "waiting" ? "Asked today and not yet answered. These are not misses until the day is over."
    : tab === "wfa" ? "Days beyond the annual cap stay in the denominator without office credit."
    : "Slack accounts with no matching Zoho employee record.";

  return (
    <>
      <PageHeading title="Needs attention" sub="A focused queue of records to review. Resolve the context before making a correction." />
      <FilterBar scope={scope} />
      <ChipTabs<AttentionTab> label="Queues" value={tab} onChange={(v) => setFilter({ attention: v })} items={items} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-7 items-start">
        <Card className="!p-7">
          <h2 className="text-[24px] font-semibold tracking-tight">{heading}</h2>
          <p className="text-[13px] mt-2.5" style={{ color: C.muted }}>{sub}</p>

          {total === 0 ? (
            <div className="mt-6"><EmptyState title="Nothing in this queue" body="Everything in this scope is accounted for." /></div>
          ) : (
            <Stagger key={`${tab}-${page}`} className="mt-4">
              {tab === "directory"
                ? directory.slice(from, from + PAGE).map((t) => (
                  <Item key={t.email}>
                    <Row name={t.full_name || t.slack_name || t.email} sub={t.email}
                      detail={t.exited ? "Exited in Zoho" : t.possible_zoho_match ? "Possible email mismatch" : "No Zoho match"}
                      pill={<Pill color={C.warn} bg={C.warnSoft}>Review</Pill>}
                      cta="Review account" onClick={() => go({ page: "administration", tab: "directory" })} />
                  </Item>))
                : list.slice(from, from + PAGE).map((r) => (
                  <Item key={r.employee.email}>
                    <Row name={r.name} sub={r.employee.department || "No department"}
                      detail={tab === "missing" ? formatDays(r.missing) : tab === "waiting" ? `Waiting on ${format(parseISO(today), "d MMMM")}` : `${fmtDays(r.wfaUsed ?? 0)} of ${fmtDays(r.wfaCap ?? 0)} days used`}
                      pill={tab === "missing" ? <Pill color={C.warn} bg={C.warnSoft}>{plural(r.missing.length, "day")}</Pill>
                        : tab === "waiting" ? <Pill color={C.warn} bg={C.warnSoft}>Waiting</Pill>
                        : <Pill color={C.bad} bg={C.badSoft}>{fmtDays((r.wfaUsed ?? 0) - (r.wfaCap ?? 0))} over</Pill>}
                      cta="Open record" onClick={() => openMember(r.employee.email, tab === "missing" ? r.missing[0] : null)} />
                  </Item>))}
            </Stagger>
          )}

          {total > PAGE && (
            <div className="flex items-center justify-between mt-6 pt-5" style={{ borderTop: `1px solid ${C.border}` }}>
              <span className="text-[13px]" style={{ color: C.muted }}>Showing {from + 1}{"–"}{Math.min(from + PAGE, total)} of {total.toLocaleString()} {total === 1 ? "person" : "people"}</span>
              <div className="flex gap-3">
                <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button variant="outline" disabled={from + PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next people</Button>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-6 min-w-0">
          <Card tone="tint" className="!p-7">
            <h2 className="text-[24px] font-semibold tracking-tight">A missing answer is a gap.</h2>
            <p className="text-[14px] mt-5 leading-relaxed" style={{ color: C.text2 }}>It does not tell you where the person worked. Check with the member before choosing a work location.</p>
            <p className="text-[13px] mt-6 pt-5 leading-relaxed" style={{ borderTop: `1px solid ${C.border}`, color: C.text2 }}>
              Admin editors can correct any past date. Members can only complete unanswered days within their window.
            </p>
          </Card>
          <Card className="!p-7">
            <h2 className="text-[22px] font-semibold tracking-tight">Need to send a reminder?</h2>
            <p className="text-[13px] mt-4 leading-relaxed" style={{ color: C.text2 }}>Open Operations to review the scope of the existing reminder job before sending.</p>
            <Button variant="outline" className="w-full mt-6" onClick={() => go({ page: "administration", tab: "operations" })}>Open operations</Button>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ name, sub, detail, pill, cta, onClick }: { name: string; sub: string; detail: string; pill: React.ReactNode; cta: string; onClick: () => void }) {
  return (
    <div className="flex items-start gap-4 py-6" style={{ borderBottom: `1px solid ${C.border}` }}>
      <Avatar name={name} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[17px] font-semibold truncate">{name}</div>
            <div className="text-[12px] mt-1.5" style={{ color: C.muted }}>{sub}</div>
          </div>
          {pill}
        </div>
        <p className="text-[13px] mt-3" style={{ color: C.text2 }}>{detail}</p>
        <div className="mt-3 flex justify-end"><LinkButton onClick={onClick}>{cta} <ArrowRight size={13} /></LinkButton></div>
      </div>
    </div>
  );
}
