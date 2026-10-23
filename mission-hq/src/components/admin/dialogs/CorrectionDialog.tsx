"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Lock, Search } from "lucide-react";
import { C, Avatar, Button, DatePicker, FieldLabel, ModalHeader, Pill, TextArea, focusRing, viewOf } from "@/components/ui";
import { correctAttendance, getAttendanceRecord } from "@/lib/actions/attendance";
import { istStamp, siteOf, sourceLabel, weekEffect } from "@/lib/domain/analytics";
import type { AttendanceRecord } from "@/lib/domain/access-types";
import { useAdmin } from "../context";

type Step = "form" | "review" | "saved";
type Problem = null | { kind: "view-only" } | { kind: "conflict" } | { kind: "failed"; message: string };
type Current = { state: "idle" } | { state: "loading" } | { state: "ready"; record: AttendanceRecord } | { state: "error"; message: string };

type Person = { email: string; name: string; sub: string };

/** The member box: type to search anyone, pick from the list. */
function MemberPicker({ people, value, onPick }: { people: Person[]; value: Person | null; onPick: (p: Person) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(needle)).slice(0, 6);
  }, [q, people]);
  return (
    <div className="relative">
      <FieldLabel htmlFor="corr-member">Member</FieldLabel>
      <div className="relative">
        <input id="corr-member" autoComplete="off" role="combobox" aria-expanded={open && matches.length > 0} aria-controls="corr-member-list"
          value={open ? q : value ? `${value.name} · ${value.email}` : q} placeholder="Search name or email"
          onFocus={() => { setOpen(true); setQ(""); }} onBlur={() => setTimeout(() => setOpen(false), 120)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          className={`w-full h-11 pl-4 pr-10 text-[14px] rounded-[10px] ${focusRing}`} style={{ background: C.surface, border: `1px solid ${C.border}` }} />
        <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.muted }} />
      </div>
      {open && matches.length > 0 && (
        <ul id="corr-member-list" role="listbox" className="absolute z-10 left-0 right-0 mt-1.5 rounded-xl overflow-hidden" style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "var(--shadow-lg)" }}>
          {matches.map((p) => (
            <li key={p.email} role="option" aria-selected={value?.email === p.email}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(p); setOpen(false); setQ(""); }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[#F3F6F5]">
                <Avatar name={p.name} size={30} /><span className="min-w-0"><span className="block text-[13px] font-medium truncate">{p.name}</span><span className="block text-[11px] truncate" style={{ color: C.muted }}>{p.sub}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CorrectionDialog({ initialEmail, initialDay, onClose }: { initialEmail?: string; initialDay?: string; onClose: () => void }) {
  const { employees, people, dates, today, viewer, statusOptions, refresh, openMember, notify } = useAdmin();

  const directory = useMemo<Person[]>(() => {
    const map = new Map<string, Person>();
    for (const p of people.values()) map.set(p.email, { email: p.email, name: p.full_name || p.email, sub: `${p.team || "No department"} · ${siteOf(p)}${p.exited_at ? " · Exited" : ""}` });
    for (const e of employees) map.set(e.email, { email: e.email, name: e.name || e.email, sub: `${e.department || "No department"} · ${siteOf(people.get(e.email))}` });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [people, employees]);

  const [member, setMember] = useState<Person | null>(() => directory.find((p) => p.email === initialEmail) ?? null);
  const [day, setDay] = useState(initialDay && initialDay <= today ? initialDay : "");
  const [status, setStatus] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem>(viewer.canEdit ? null : { kind: "view-only" });
  const [current, setCurrent] = useState<Current>({ state: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ updatedAt: string; by: string; previous: string | null; historyRecorded: boolean; withinZohoWindow: boolean } | null>(null);
  const savedReason = useRef("");

  const employee = member ? employees.find((e) => e.email === member.email) : undefined;
  const weekend = day ? [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()) : false;

  // The record as it stands, fetched whenever member or date changes. Its version
  // travels with the correction so a stale save is refused, not applied.
  useEffect(() => {
    if (!member || !day || weekend) { setCurrent({ state: "idle" }); return; }
    let live = true;
    setCurrent({ state: "loading" });
    getAttendanceRecord(member.email, day).then((r) => {
      if (!live) return;
      setCurrent(r.ok ? { state: "ready", record: r.record as AttendanceRecord } : { state: "error", message: r.error });
    });
    return () => { live = false; };
  }, [member, day, weekend, reloadKey]);

  const currentStatus = current.state === "ready" ? current.record.status : undefined;
  const effect = employee && day && status && !weekend ? weekEffect(employee, dates, today, day, status) : null;

  const errors = {
    member: !member ? "Choose a member" : "",
    day: !day ? "Choose a date" : weekend ? "That date is a weekend; nobody is asked on weekends" : day > today ? "A correction cannot be for a future date" : "",
    status: !status ? "Choose a work location" : status === currentStatus ? "That day is already recorded as this" : "",
    reason: reason.trim().length < 3 ? "Add a reason for the correction" : "",
    record: current.state === "error" ? "The current record could not be loaded" : current.state === "loading" ? "Still loading the current record" : "",
  };
  const firstError = errors.member || errors.day || errors.record || errors.status || errors.reason;

  const toReview = () => { setTouched(true); if (!firstError) setStep("review"); };

  const save = async () => {
    if (!member || !day || !status || current.state !== "ready") return;
    setSaving(true);
    const r = await correctAttendance({ email: member.email, day, status, reason, expectedUpdatedAt: current.record.updatedAt });
    setSaving(false);
    if (!r.ok) {
      setProblem(r.code === "view-only" ? { kind: "view-only" } : r.code === "conflict" ? { kind: "conflict" } : { kind: "failed", message: r.error });
      return;
    }
    savedReason.current = reason;
    setResult({ updatedAt: r.updatedAt as string, by: r.by as string, previous: (r.previous as string | null) ?? null, historyRecorded: !!r.historyRecorded, withinZohoWindow: !!r.withinZohoWindow });
    setStep("saved");
    await refresh();
  };

  const dayLong = day ? format(parseISO(day), "EEEE, d MMMM yyyy") : "";
  const nowStamp = result ? istStamp(result.updatedAt).replace(/^\d+ \w+, /, "Today at ") : "";

  // ── The three states the design keeps apart from the happy path ──────────
  if (problem) {
    return (
      <div>
        <ModalHeader eyebrow="ADMIN CORRECTION" title="Editing states" onClose={onClose} />
        {problem.kind === "view-only" && (
          <div className="rounded-2xl p-6" style={{ background: C.inset, border: `1px solid ${C.border}` }}>
            <h3 className="text-[18px] font-semibold flex items-center gap-3"><Lock size={18} /> You have view-only access</h3>
            <p className="text-[13px] mt-4 leading-relaxed" style={{ color: C.text2 }}>You can view every member&apos;s record. An admin editor is needed to make a correction.</p>
            <Button variant="outline" className="w-full mt-6" onClick={onClose}>Back to record</Button>
          </div>
        )}
        {problem.kind === "conflict" && (
          <div role="alert" className="rounded-2xl p-6" style={{ background: C.warnSoft, border: "1px solid #EBD9A8" }}>
            <h3 className="text-[18px] font-semibold">This record changed while you were editing.</h3>
            <p className="text-[13px] mt-4 leading-relaxed" style={{ color: C.text2 }}>Another update was saved after you opened this day. Your proposed correction has not been saved.</p>
            <Button className="w-full mt-6" onClick={() => { setProblem(null); setStep("form"); setStatus(null); setReloadKey((n) => n + 1); }}>Reload latest record</Button>
          </div>
        )}
        {problem.kind === "failed" && (
          <div role="alert" className="rounded-2xl p-6" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <h3 className="text-[18px] font-semibold">The correction was not saved.</h3>
            <p className="text-[13px] mt-4 leading-relaxed" style={{ color: C.text2 }}>Your selected date, status and reason are still here. Check your connection and try again.</p>
            <p className="text-[12px] mt-3" style={{ color: C.muted }}>{problem.message}</p>
            <Button className="w-full mt-6" onClick={() => { setProblem(null); setStep("review"); }}>Try again</Button>
          </div>
        )}
        <p className="text-[12px] mt-8 leading-relaxed" style={{ color: C.muted }}>Member and date stay visible throughout the correction flow. Missing and unavailable records are never shown as zero attendance.</p>
      </div>
    );
  }

  return (
    <div>
      {step === "form" && (
        <>
          <ModalHeader eyebrow="ADMIN CORRECTION" title="Correct an attendance record" onClose={onClose} />
          <p className="text-[14px] -mt-3 mb-7" style={{ color: C.text2 }}>Any member. Any past date. Review the current record before saving.</p>

          <MemberPicker people={directory} value={member} onPick={(p) => { setMember(p); setStatus(null); }} />
          {touched && errors.member && <p role="alert" className="text-[12px] mt-2" style={{ color: C.bad }}>{errors.member}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-6">
            <div>
              <DatePicker label="Date · IST" value={day} today={today} max={today} placeholder="Choose a date"
                isDisabled={(d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())}
                onChange={(v) => { setDay(v); setStatus(null); }} />
            </div>
            <div>
              <FieldLabel>Current record</FieldLabel>
              <div className="h-11 px-4 flex items-center text-[14px] rounded-[10px]" style={{ background: C.inset, border: `1px solid ${C.border}`, color: current.state === "ready" ? C.text : C.muted }} aria-live="polite">
                {current.state === "idle" ? "Choose a member and date"
                  : current.state === "loading" ? "Loading…"
                  : current.state === "error" ? "Unavailable"
                  : current.record.status ? `${current.record.status} · ${sourceLabel(current.record.source)}` : "No record · nobody was asked"}
              </div>
            </div>
          </div>
          <p className="text-[12px] mt-3" style={{ color: touched && errors.day ? C.bad : C.muted }}>{touched && errors.day ? errors.day : "Choose any past date, including outside the current reporting window."}</p>
          {current.state === "error" && <p role="alert" className="text-[12px] mt-2" style={{ color: C.bad }}>{current.message}</p>}
          {current.state === "ready" && !current.record.status && (
            <p className="text-[12px] mt-2" style={{ color: C.warn }}>No record exists for this day. Saving creates one, which adds the day to the person&apos;s counted days.</p>
          )}

          <h3 className="text-[18px] font-semibold mt-8 mb-4">Correct work location</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" role="radiogroup" aria-label="Work location">
            {statusOptions.map((o) => {
              const v = viewOf(o.status);
              const on = status === o.status;
              return (
                <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => setStatus(o.status)}
                  className={`flex items-center gap-3 px-3.5 h-11 rounded-[10px] text-left text-[13px] font-medium transition-colors ${on ? "" : "hover:bg-[#F7F9F8]"} ${focusRing}`}
                  style={{ background: on ? C.selected : C.surface, border: `1.5px solid ${on ? C.primary : C.border}` }}>
                  <span style={{ color: on ? C.primary : C.text2 }}><v.Icon size={16} /></span><span className="truncate">{o.status}</span>
                </button>
              );
            })}
          </div>
          {touched && errors.status && <p role="alert" className="text-[12px] mt-3" style={{ color: C.bad }}>{errors.status}</p>}

          <div className="mt-7">
            <TextArea label="Reason for correction" value={reason} onChange={setReason} placeholder="Member confirmed office attendance for this date." invalid={touched && !!errors.reason} />
            <p className="text-[12px] mt-3" style={{ color: touched && errors.reason ? C.bad : C.muted }}>{touched && errors.reason ? errors.reason : "Your name and correction details will be recorded. The member’s original answer time is preserved."}</p>
          </div>

          <div className="flex items-center justify-between gap-4 mt-8 pt-6" style={{ borderTop: `1px solid ${C.border}` }}>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="min-w-[240px]" onClick={toReview} aria-disabled={!!firstError && touched}>Review correction</Button>
          </div>
        </>
      )}

      {step === "review" && member && status && (
        <>
          <ModalHeader eyebrow="ADMIN CORRECTION" title="Review correction" onClose={onClose} />
          <div className="text-[20px] font-semibold">{member.name}</div>
          <p className="text-[13px] mt-3" style={{ color: C.muted }}>{dayLong} {"·"} IST</p>
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="rounded-2xl p-5" style={{ background: C.inset, border: `1px solid ${C.border}` }}><div className="text-[11px] tracking-[0.1em]" style={{ color: C.muted }}>CURRENT</div><div className="text-[26px] font-semibold tracking-tight mt-5">{currentStatus ?? "No record"}</div></div>
            <div className="rounded-2xl p-5" style={{ background: C.selected, border: `1px solid ${C.border}` }}><div className="text-[11px] tracking-[0.1em]" style={{ color: C.muted }}>CORRECTED</div><div className="text-[26px] font-semibold tracking-tight mt-5">{status}</div></div>
          </div>

          <h3 className="text-[18px] font-semibold mt-8">What changes</h3>
          <ul className="mt-4 space-y-2 text-[13px] leading-relaxed" style={{ color: C.text2 }}>
            {effect && effect.before !== null && effect.after !== null
              ? <li>Week of {format(parseISO(effect.weekStart), "d")}{"–"}{format(parseISO(effect.weekEnd), "d MMMM")}: {effect.before}% {"→"} {effect.after}%</li>
              : <li>The weekly score effect cannot be shown for this date, because that week is outside the loaded period. It will be recalculated from the real record.</li>}
            <li>{effect && Math.abs(effect.wfaAfter - effect.wfaBefore) > 0.001
              ? `WFA allowance: ${effect.wfaAfter > effect.wfaBefore ? "uses" : "gives back"} ${Math.abs(effect.wfaAfter - effect.wfaBefore)} ${Math.abs(effect.wfaAfter - effect.wfaBefore) === 1 ? "day" : "days"}`
              : "WFA allowance: no change"}</li>
            <li>One day for one person will be updated.</li>
            {!currentStatus && <li style={{ color: C.warn }}>No record existed, so this adds a day to the person&apos;s counted days.</li>}
          </ul>

          <h3 className="text-[15px] font-semibold mt-7">Reason</h3>
          <p className="text-[13px] mt-2" style={{ color: C.text2 }}>{reason.trim()}</p>

          <div className="flex items-center justify-between gap-4 mt-8 pt-6" style={{ borderTop: `1px solid ${C.border}` }}>
            <Button variant="outline" onClick={() => setStep("form")} disabled={saving}>Back</Button>
            <Button className="min-w-[250px]" onClick={save} loading={saving}>Save correction</Button>
          </div>
        </>
      )}

      {step === "saved" && member && status && result && (
        <>
          <ModalHeader eyebrow="ADMIN CORRECTION" title="Attendance corrected" onClose={onClose} />
          <Pill color={C.office} bg={C.officeSoft}><Check size={12} /> Saved in MissionHQ</Pill>
          <div className="text-[24px] font-semibold tracking-tight mt-6">{member.name.split(" ")[0]} {"·"} {format(parseISO(day), "d MMMM yyyy")}</div>
          <p className="text-[18px] mt-4" style={{ color: C.text2 }}>{result.previous ?? "No record"} {"→"} {status}</p>
          <p className="text-[12px] mt-5" style={{ color: C.muted }}>Updated by {result.by.split("@")[0]} {"·"} {nowStamp}</p>

          <div className="mt-6 pt-6" style={{ borderTop: `1px solid ${C.border}` }}>
            <h3 className="text-[18px] font-semibold">Record details</h3>
            <ul className="mt-4 space-y-1.5 text-[13px]" style={{ color: C.text2 }}>
              <li>Source: Manual correction</li>
              <li>Original member answer time: unchanged</li>
              {effect?.after != null && <li>Weekly score: {effect.after}% after this correction</li>}
              {!result.historyRecorded && <li style={{ color: C.warn }}>The correction history entry could not be written. The change itself is saved.</li>}
            </ul>
          </div>

          <div className="rounded-2xl p-5 mt-6 text-[13px] leading-relaxed" style={{ background: C.inset, border: `1px solid ${C.border}`, color: C.text2 }}>
            Saved here does not mean synced to Zoho.<br />
            {result.withinZohoWindow ? "This correction is within the 60-day window and will be sent at the 19:30 IST run. Check the push status on the person’s profile." : "This date is outside the 60-day sync window, so it will not be sent to Zoho automatically."}
          </div>
          <Button className="w-full mt-6" onClick={() => { onClose(); openMember(member.email, day); notify("Correction saved"); }}>Back to member profile</Button>
        </>
      )}
    </div>
  );
}

// The shell wraps the dialog in <Modal>; this keeps the animation between steps.
export function StepFade({ stepKey, children }: { stepKey: string; children: React.ReactNode }) {
  return <AnimatePresence mode="wait" initial={false}><motion.div key={stepKey} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>{children}</motion.div></AnimatePresence>;
}
