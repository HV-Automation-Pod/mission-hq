"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Lock, Pencil } from "lucide-react";
import { Tooltip } from "@/components/ui";
import { C, Bone, Button, Card, CountUp, Item, LinkButton, Pill, Stagger, viewOf } from "@/components/ui";
import { iso } from "@/lib/format";
import { getAttendanceRecord } from "@/lib/actions/attendance";
import { fmtDays, isRealWeek, scorePeriod } from "@/lib/domain/policy";
import { calculateWeeklyCompliance } from "@/lib/domain/scoring";
import { countedDates, istStamp, siteOf, sourceLabel, wfaOf, weekEffect } from "@/lib/domain/analytics";
import type { AttendanceRecord } from "@/lib/domain/access-types";
import { useAdmin } from "../context";
import AdminCalendar from "../AdminCalendar";
import { EmptyState, Kpi, PageHeading } from "../ui";

type RecordState = { state: "loading" } | { state: "ready"; record: AttendanceRecord } | { state: "error"; message: string };

/** One person's record. Cached per day so moving between days does not flash. */
function useRecord(email: string, day: string | null, statusNow: string | undefined) {
  const [rec, setRec] = useState<RecordState>({ state: "loading" });
  const cache = useRef(new Map<string, AttendanceRecord>());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!day) return;
    const key = `${email}|${day}|${statusNow ?? ""}`;
    const hit = cache.current.get(key);
    if (hit && attempt === 0) { setRec({ state: "ready", record: hit }); return; }
    let live = true;
    setRec({ state: "loading" });
    getAttendanceRecord(email, day).then((r) => {
      if (!live) return;
      if (!r.ok) { setRec({ state: "error", message: r.error }); return; }
      const record = r.record as AttendanceRecord;
      cache.current.set(key, record);
      setRec({ state: "ready", record });
    });
    return () => { live = false; };
  }, [email, day, statusNow, attempt]);

  return { rec, retry: () => setAttempt((n) => n + 1) };
}

export default function MemberPage() {
  const { route, employees, people, dates, today, viewer, go, setFilter, openDialog } = useAdmin();
  const email = route.member as string;
  const employee = employees.find((e) => e.email === email);
  const person = people.get(email);

  // Default to the latest working day with a record, else today.
  const defaultDay = useMemo(() => {
    if (!employee) return today;
    const withRecord = Object.keys(employee.statuses).filter((d) => d <= today).sort();
    return employee.statuses[today] ? today : withRecord[withRecord.length - 1] ?? today;
  }, [employee, today]);
  const day = route.day && route.day <= today ? route.day : defaultDay;
  const [month, setMonth] = useState(() => startOfMonth(parseISO(day)));
  useEffect(() => { setMonth(startOfMonth(parseISO(day))); /* follow a day chosen elsewhere */ }, [route.day]); // eslint-disable-line react-hooks/exhaustive-deps

  const { rec, retry } = useRecord(email, day, employee?.statuses[day]);

  const stats = useMemo(() => {
    if (!employee) return null;
    const counted = countedDates(employee, dates, today);
    const overall = scorePeriod(employee.statuses, counted, employee.allowance);
    const thisMonday = iso(startOfWeek(parseISO(today), { weekStartsOn: 1 }));
    const weeks = calculateWeeklyCompliance(employee.statuses, counted, employee.allowance)
      .filter((w) => w.weekStart < thisMonday && isRealWeek(w.availableDays));
    const missing = dates.filter((d) => d < today && employee.statuses[d] === "Pending").sort();
    return { overall, met: weeks.filter((w) => w.isCompliant).length, total: weeks.length, missing, wfa: wfaOf(employee, today) };
  }, [employee, dates, today]);

  if (!employee || !stats) {
    return (
      <>
        <button onClick={() => go({ page: "people" })} className="mb-6 inline-flex items-center gap-2 text-[13px] font-medium" style={{ color: C.primary }}><ChevronLeft size={15} /> All people</button>
        <EmptyState title={person ? `${person.full_name ?? email} has no attendance on file` : "We could not find that person"}
          body={person?.exited_at ? "They have left, so they are no longer prompted or counted." : "Their record may have been removed, or the link may be out of date."}
          action={<Button variant="outline" onClick={() => go({ page: "people" })}>Back to people</Button>} />
      </>
    );
  }

  const name = employee.name || person?.full_name || email;
  const first = [...dates].sort()[0];
  const earliest = startOfMonth(parseISO(first ?? today));
  const status = employee.statuses[day];
  const canEdit = viewer.canEdit;
  const v = status ? viewOf(status) : null;

  // The week's score as it is, and what Office on this day would make it.
  const effect = status && status !== "Office" ? weekEffect(employee, dates, today, day, "Office") : null;
  const weekRange = (() => { const m = startOfWeek(parseISO(day), { weekStartsOn: 1 }); return `${format(m, "d")}–${format(addDays(m, 4), "d MMMM")}`; })();

  return (
    <>
      <PageHeading title={name}
        sub={`${employee.department || "No department"} · ${siteOf(person)} · ${email} · ${person?.exited_at ? "Exited" : "Active employee"}`} />

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <Pill color={C.primary} bg={C.selected}>Admin view of member</Pill>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => go({ page: "people", member: email, settings: true })}>Person settings</Button>
          <Tooltip label={canEdit ? "Correct any day for this person" : "Correcting attendance needs an admin editor"} side="bottom">
            <Button disabled={!canEdit} onClick={() => openDialog({ type: "correct", email, day })}><Pencil size={15} /> Correct attendance</Button>
          </Tooltip>
        </div>
      </div>

      <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Item><Kpi label="Policy score" valueNode={stats.overall.pct === null ? "n/a" : <><CountUp value={stats.overall.pct} />%</>} sub={first ? `Since ${format(parseISO(first), "d MMMM")}` : undefined} /></Item>
        <Item><Kpi label="Fully met weeks" valueNode={<><CountUp value={stats.met} /> <span style={{ color: C.muted, fontWeight: 500 }}>/ {stats.total}</span></>} sub="Completed weeks only" /></Item>
        <Item><Kpi label="Missing answers" tone={stats.missing.length ? "warn" : undefined}
          valueNode={<><CountUp value={stats.missing.length} /> <span className="text-[26px]" style={{ fontWeight: 600 }}>{stats.missing.length === 1 ? "day" : "days"}</span></>}
          sub={stats.missing.length === 0 ? "Nothing outstanding" : new Set(stats.missing.map((d) => d.slice(0, 7))).size === 1 ? `All within ${format(parseISO(stats.missing[0]), "MMMM")}` : `Since ${format(parseISO(stats.missing[0]), "d MMM")}`} /></Item>
        <Item>{stats.wfa
          ? <Kpi label="WFA remaining" valueNode={<><CountUp value={Math.max(0, stats.wfa.cap - stats.wfa.used)} format={(n) => fmtDays(n)} /> <span className="text-[26px]" style={{ fontWeight: 600 }}>days</span></>} sub={`${fmtDays(stats.wfa.used)} of ${fmtDays(stats.wfa.cap)} used this year`} />
          : <Kpi label="WFA remaining" value="n/a" sub="Allowance not available" />}</Item>
      </Stagger>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-6 items-start">
        <AdminCalendar employee={employee} today={today} month={month} onMonth={setMonth} earliest={earliest}
          selected={day} onSelect={(d) => setFilter({ day: d })} />

        <div className="space-y-6 min-w-0">
          <Card className="!p-7">
            <Pill color={C.primary} bg={C.selected}>Selected {"·"} {format(parseISO(day), "EEE d MMM")}</Pill>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={day} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                <h2 className="text-[34px] font-semibold tracking-tight mt-6 leading-tight">{status === "Pending" ? "Not answered" : status ?? "No check-in"}</h2>
                <p className="text-[13px] mt-3" style={{ color: C.text2 }}>
                  Source: {rec.state === "ready" ? sourceLabel(rec.record.source) : rec.state === "loading" ? "loading…" : "unavailable"}
                </p>
                <p className="text-[13px] mt-5 leading-relaxed" style={{ color: C.text2 }}>
                  {status === "Pending"
                    ? "This was asked and never answered, so it counts against the week. Check with the member before choosing a work location."
                    : !status ? "Nobody was asked about this day, so nothing counts for or against the person. An admin editor can still record one."
                    : effect && effect.before !== null && effect.after !== null && effect.after > effect.before
                      ? `Changing it to Office would move the week of ${weekRange} from ${effect.before}% to ${effect.after}%.`
                      : `Part of the week of ${weekRange}.`}
                </p>
              </motion.div>
            </AnimatePresence>
            {canEdit
              ? <Button className="w-full mt-6" onClick={() => openDialog({ type: "correct", email, day })}>Correct this day</Button>
              : <p className="mt-6 text-[12px] inline-flex items-center gap-2" style={{ color: C.muted }}><Lock size={12} /> View only. An admin editor is needed to correct a day.</p>}
          </Card>

          <Card>
            <h2 className="text-[20px] font-semibold tracking-tight">Looking further back?</h2>
            <p className="text-[13px] mt-3" style={{ color: C.text2 }}>Choose a date outside the current calendar.</p>
            <div className="mt-6">
              {canEdit ? <LinkButton onClick={() => openDialog({ type: "correct", email })}>Choose any past date {"→"}</LinkButton>
                : <span className="text-[12px]" style={{ color: C.muted }}>Needs an admin editor.</span>}
            </div>
          </Card>

          <SyncCard day={day} today={today} status={status} rec={rec} onRetry={retry} />
        </div>
      </div>
    </>
  );
}

function SyncCard({ day, today, status, rec, onRetry }: { day: string; today: string; status?: string; rec: RecordState; onRetry: () => void }) {
  const lines: { k: string; v: string }[] = [];
  if (rec.state === "ready") {
    const r = rec.record;
    if (r.answeredAt) lines.push({ k: r.source === "dashboard" ? "Dashboard answer" : r.source === "slack" ? "Slack answer" : "Answered", v: istStamp(r.answeredAt) });
    const win = new Date(`${today}T00:00:00Z`).getTime() - 60 * 86_400_000;
    if (!r.status || r.status === "Pending") lines.push({ k: "Zoho push", v: "Not applicable until it is answered" });
    else if (r.status === "Leave") lines.push({ k: "Zoho push", v: "Not sent: leave comes from Zoho" });
    else if (r.zohoPushedAt) lines.push({ k: "Zoho push", v: istStamp(r.zohoPushedAt) });
    else if (new Date(`${day}T00:00:00Z`).getTime() >= win) lines.push({ k: "Zoho push", v: "Queued for the 19:30 run" });
    else lines.push({ k: "Zoho push", v: "Outside the 60-day sync window. It will not be sent." });
    if (r.source === "manual" && r.note) lines.push({ k: "Last correction", v: r.note.replace(/^Corrected by /, "") });
    if (r.updatedAt && r.source === "manual") lines.push({ k: "Updated", v: istStamp(r.updatedAt) });
  }
  return (
    <Card>
      <h2 className="text-[20px] font-semibold tracking-tight">Sync &amp; source</h2>
      {rec.state === "loading" && <div className="mt-5 space-y-3"><Bone w="80%" h={12} soft /><Bone w="65%" h={12} soft /></div>}
      {rec.state === "error" && (
        <div className="mt-4 text-[13px]" style={{ color: C.text2 }}>
          We could not load this day&apos;s sync details. {rec.message}
          <div className="mt-3"><LinkButton onClick={onRetry}>Try again</LinkButton></div>
        </div>
      )}
      {rec.state === "ready" && (
        <dl className="mt-5 space-y-3 text-[13px]">
          {lines.length === 0 && <p style={{ color: C.muted }}>No record for this day.</p>}
          {lines.map((l) => (
            <div key={l.k} className="leading-snug"><dt className="inline" style={{ color: C.muted }}>{l.k} {"·"} </dt><dd className="inline" style={{ color: C.text2 }}>{l.v}</dd></div>
          ))}
        </dl>
      )}
    </Card>
  );
}

