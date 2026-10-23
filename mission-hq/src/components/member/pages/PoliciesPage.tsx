"use client";

import { addDays, format, parseISO } from "date-fns";
import { Building2, CircleHelp, Globe, Home, Leaf, type LucideIcon } from "lucide-react";
import { C, Card, btnPrimary, focusRing, RiseCard, Stagger, CountUp } from "@/components/ui";
import { fmtDays } from "@/lib/domain/policy";
import { type PageProps } from "../model";
import { PageHead, PersonalChip } from "../parts/PageHead";

export function PoliciesPage({ view, setPage }: PageProps) {
  const t = view.thisWeek;
  const weekStart = parseISO(view.weekDays[0]);
  const range = `${format(weekStart, "d")}–${format(addDays(weekStart, 4), "d MMMM yyyy")}`;
  const included = Math.min(t.wfh, 1);
  const rows: { Icon: LucideIcon; title: string; note: string; value: number }[] = [
    { Icon: Building2, title: "Office", note: "Counted in full", value: t.wfo },
    { Icon: Home, title: "Home", note: t.wfhExcess > 0.001 ? `${fmtDays(included)} included weekly · ${fmtDays(t.wfhExcess)} beyond allowance` : "Within your weekly WFH day", value: t.wfh },
    { Icon: Leaf, title: "Leave", note: "Excluded from the calculation", value: t.leave },
    { Icon: Globe, title: "Work from anywhere", note: "Within your annual balance, excluded from the score", value: t.wfa },
  ];
  const shown = rows.filter((r) => r.value > 0.001 || r.title === "Office");

  return (
    <>
      <PageHead crumb="MY WORKSPACE / POLICIES" title="Policies" sub="Understand the rules behind your attendance. No guesswork, no hidden calculations." aside={<PersonalChip />} />
      <Stagger className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {([
          [Home, "01", "Work from home", "1 day per calendar week, on any weekday."],
          [Globe, "02", "Work from anywhere", "Your annual balance is separate from your weekly WFH day."],
          [Leaf, "03", "Time off", "Leave is excluded from your attendance score."],
        ] as [LucideIcon, string, string, string][]).map(([Icon, n, title, body]) => (
          <RiseCard key={n}>
            <div className="flex items-start justify-between"><span style={{ color: C.primary }}><Icon size={24} /></span><span className="text-[11px]" style={{ color: C.muted }}>{n}</span></div>
            <h2 className="text-[20px] font-semibold mt-5">{title}</h2>
            <p className="text-[13px] mt-2 leading-snug" style={{ color: C.text2 }}>{body}</p>
          </RiseCard>
        ))}
      </Stagger>

      <Stagger className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-6">
        <RiseCard>
          <h2 className="text-[22px] font-semibold">How your week is counted</h2>
          <div className="text-[13px] mt-1.5" style={{ color: C.muted }}>Your current week &middot; {range}</div>
          <ul className="mt-5">
            {shown.map((r, i) => (
              <li key={r.title} className="flex items-center gap-4 py-4" style={i > 0 ? { borderTop: `1px solid ${C.border}` } : undefined}>
                <span style={{ color: C.muted }}><r.Icon size={18} /></span>
                <div className="flex-1 min-w-0"><div className="text-[14px] font-medium">{r.title}</div><div className="text-[12px]" style={{ color: C.muted }}>{r.note}</div></div>
                <div className="text-[14px] font-semibold">{fmtDays(r.value)} {r.value === 1 ? "day" : "days"}</div>
              </li>
            ))}
          </ul>
        </RiseCard>

        <RiseCard tone="tint" className="!p-6">
          <div className="text-[11px] tracking-[0.14em] font-semibold" style={{ color: C.primary }}>YOUR WEEK</div>
          <div className="text-[64px] leading-none font-semibold tracking-tight mt-6">{t.pct === null ? "n/a" : <><CountUp value={t.pct} />%</>}</div>
          {t.available > 0.001 ? (
            <>
              <p className="text-[16px] font-medium mt-5">{fmtDays(t.adherent)} of {fmtDays(t.available)} counted days met the policy</p>
              <p className="text-[13px] mt-4 leading-snug" style={{ color: C.text2 }}>
                {fmtDays(t.wfo)} office {t.wfo === 1 ? "day" : "days"} + {fmtDays(included)} included home {included === 1 ? "day" : "days"} &divide; {fmtDays(t.available)} counted days
              </p>
              <div className="mt-5 pt-4 text-[13px]" style={{ borderTop: `1px solid ${C.border}`, color: C.text2 }}>
                {t.wfhExcess > 0.001 ? "Your second home day is the difference."
                  : t.pending > 0 ? "Unanswered days count against the score." : "Every counted day met the policy."}
              </div>
            </>
          ) : <p className="text-[14px] mt-5" style={{ color: C.text2 }}>No days this week count towards the score yet.</p>}
        </RiseCard>

        <RiseCard>
          <h2 className="text-[22px] font-semibold">Other days, explained</h2>
          <dl className="mt-5 space-y-5">
            {[
              ["Split days", "Half office + half home. Two half-home days use your weekly day."],
              ["Client visits, travel and compensatory WFH", "Count toward attendance in the same way as office days."],
              ["Missing answers", "An unanswered check-in counts against the score. A day with no check-in request does not."],
            ].map(([k, v]) => <div key={k}><dt className="text-[14px] font-semibold">{k}</dt><dd className="text-[13px] mt-1" style={{ color: C.text2 }}>{v}</dd></div>)}
          </dl>
        </RiseCard>

        <RiseCard className="flex flex-col">
          <CircleHelp size={24} style={{ color: C.primary }} />
          <h2 className="text-[22px] font-semibold mt-4">Something doesn&apos;t add up?</h2>
          <p className="text-[13px] mt-2" style={{ color: C.text2 }}>People &amp; Culture can help explain a rule or review an older record.</p>
          <button onClick={() => setPage("allowances")} className={`mt-6 w-full text-[14px] font-semibold ${focusRing}`} style={btnPrimary}>View my allowances</button>
        </RiseCard>
      </Stagger>
      <p className="text-[12px] mt-6" style={{ color: C.muted }}>Calculated from recorded check-ins. Annual allowances follow your account&apos;s configured entitlement.</p>
    </>
  );
}
