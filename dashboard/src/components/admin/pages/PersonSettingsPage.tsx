"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Info, Lock } from "lucide-react";
import { C, Avatar, Button, Card, FieldLabel, Pill, Select, TextInput, focusRing } from "@/components/ui";
import { setExempt, setPromptOptIn, setSiteOverride } from "@/lib/actions/people";
import { siteOf } from "@/lib/domain/analytics";
import { useAdmin } from "../context";
import { EmptyState, PageHeading } from "../ui";

/** The reason as typed, without the "(set by x, date)" suffix the server appends. */
const bareReason = (s: string | null | undefined) => (s ?? "").replace(/\s*\(set by [^)]*\)\s*$/, "").trim();

export default function PersonSettingsPage() {
  const { route, people, employees, viewer, go, reloadAdmin, notify } = useAdmin();
  const email = route.member as string;
  const person = people.get(email);
  const employee = employees.find((e) => e.email === email);
  const name = employee?.name || person?.full_name || email;
  const canEdit = viewer.canEdit;

  const [exempt, setExemptOn] = useState(!!person?.wfo_exempt);
  const [reason, setReason] = useState(bareReason(person?.wfo_exempt));
  const [optIn, setOptIn] = useState(!!person?.prompt_opt_in);
  const [site, setSite] = useState(person?.location_override ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sites = useMemo(() => {
    const all = new Set<string>();
    for (const p of people.values()) { const s = siteOf(p); if (s !== "Unassigned") all.add(s); }
    if (person?.location_override) all.add(person.location_override);
    return [...all].sort();
  }, [people, person]);

  if (!person) {
    return <>
      <button onClick={() => go({ page: "people" })} className="mb-6 inline-flex items-center gap-2 text-[13px] font-medium" style={{ color: C.primary }}><ChevronLeft size={15} /> All people</button>
      <EmptyState title="We could not find that person" body="Their record may have been removed, or the link may be out of date." />
    </>;
  }

  const hadExempt = !!person.wfo_exempt;
  const exemptChanged = hadExempt !== exempt || (exempt && reason.trim() !== bareReason(person.wfo_exempt));
  const optChanged = optIn !== person.prompt_opt_in;
  const siteChanged = (site || null) !== (person.location_override ?? null);
  const dirty = exemptChanged || optChanged || siteChanged;
  // An exemption outranks an opt-in, so asking for both is asking for nothing.
  const conflict = exempt && optIn;
  const clearsExemption = optChanged && optIn && hadExempt;
  const reasonMissing = exempt && reason.trim().length < 3;

  const status = person.exited_at ? { text: "Exited", color: C.muted, bg: C.inset }
    : hadExempt ? { text: "Exempt from prompts", color: C.warn, bg: C.warnSoft }
    : person.prompt_opt_in ? { text: "Always prompted (opted in)", color: C.primary, bg: C.selected }
    : { text: "Currently prompted", color: C.office, bg: C.officeSoft };

  const save = async () => {
    if (!dirty || conflict || reasonMissing) return;
    setSaving(true); setError(null);
    // One at a time and in this order: an opt-in clears an exemption on the server,
    // so it must not be followed by a stale exemption write.
    const steps: (() => Promise<{ ok: boolean; error?: string }>)[] = [];
    if (optChanged) steps.push(() => setPromptOptIn(email, optIn));
    if (exemptChanged && !(optChanged && optIn)) steps.push(() => setExempt(email, exempt ? reason.trim() : null));
    if (siteChanged) steps.push(() => setSiteOverride(email, site || null));
    for (const step of steps) {
      const r = await step();
      if (!r.ok) { setSaving(false); setError(r.error ?? "Could not save"); notify("The settings were not saved", "error"); await reloadAdmin(); return; }
    }
    await reloadAdmin();
    setSaving(false);
    notify("Settings saved");
  };

  return (
    <>
      <PageHeading title={`${name.split(" ")[0]}’s attendance settings`} sub="Control how MissionHQ prompts and reports this person." />
      <button onClick={() => go({ page: "people", member: email })} className={`mb-6 inline-flex items-center gap-2 h-11 px-4 rounded-[10px] text-[13px] font-semibold ${focusRing}`}
        style={{ background: C.surface, border: `1px solid ${C.border}` }}><ChevronLeft size={15} /> Back to profile</button>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-6 items-start">
        <Card className="!p-7">
          <Avatar name={name} size={56} />
          <h2 className="text-[26px] font-semibold tracking-tight mt-5">{name}</h2>
          <p className="text-[13px] mt-2" style={{ color: C.muted }}>{email}</p>
          <dl className="mt-8 space-y-6 text-[13px]">
            {[["Department", employee?.department || person.team || "Not set"], ["HR site", person.location || "Not set"], ["Employment", person.exited_at ? "Exited" : "Active"]].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4"><dt style={{ color: C.muted }}>{k}</dt><dd className="font-medium text-right">{v}</dd></div>
            ))}
          </dl>
          <p className="text-[12px] mt-9" style={{ color: C.muted }}>Name, team and HR site come from Zoho.</p>
        </Card>

        <Card className="!p-7">
          <h2 className="text-[24px] font-semibold tracking-tight">Attendance controls</h2>
          <div className="mt-5"><Pill color={status.color} bg={status.bg}>{status.text}</Pill></div>
          {!canEdit && <p className="mt-5 text-[13px] inline-flex items-center gap-2" style={{ color: C.muted }}><Lock size={13} /> View only. An admin editor is needed to change these.</p>}

          <fieldset disabled={!canEdit || saving} className="min-w-0">
            <h3 className="text-[16px] font-semibold mt-8">Exemption</h3>
            <p className="text-[13px] mt-2" style={{ color: C.text2 }}>An exemption stops attendance prompts until it is removed.</p>
            <Select className="mt-5" label="Exemption reason" value={exempt ? "yes" : "no"} onChange={(v) => setExemptOn(v === "yes")}
              options={[{ value: "no", label: "No exemption" }, { value: "yes", label: "Exempt from prompts" }]} />
            {exempt && (
              <div className="mt-4">
                <TextInput label="Reason, kept with your name and the date" value={reason} onChange={setReason} maxLength={200} placeholder="Why this person is exempt" invalid={reasonMissing} />
              </div>
            )}

            <h3 className="text-[16px] font-semibold mt-8">Prompt opt-in</h3>
            <p className="text-[13px] mt-2" style={{ color: C.text2 }}>Explicitly include this person when automatic signals miss them.</p>
            <button type="button" role="switch" aria-checked={optIn} onClick={() => setOptIn((v) => !v)}
              className={`mt-5 inline-flex items-center gap-3 h-10 pl-1.5 pr-4 rounded-full text-[12px] font-medium ${focusRing}`} style={{ background: optIn ? C.selected : C.inset, color: optIn ? C.primary : C.text2 }}>
              <span className="w-7 h-7 rounded-full flex items-center" style={{ background: optIn ? C.primary : "#C3D0CC", padding: 3, justifyContent: optIn ? "flex-end" : "flex-start", transition: "all .18s" }}>
                <span className="w-[22px] h-[22px] rounded-full bg-white" />
              </span>
              {optIn ? "On · Always prompt this person" : "Off · Use automatic eligibility"}
            </button>

            <Select className="mt-8" label="Reported site override" value={site} onChange={setSite}
              options={[{ value: "", label: `Use Zoho site · ${person.location || "not set"}` }, ...sites.map((s) => ({ value: s, label: s }))]} />
          </fieldset>

          {(clearsExemption || conflict) && (
            <div role="alert" className="mt-6 flex items-start gap-3 rounded-xl px-4 py-3 text-[13px]" style={{ background: C.warnSoft, color: C.warn }}>
              <Info size={16} className="mt-0.5 flex-shrink-0" />
              <span>{conflict ? "An exemption outranks an opt-in, so choose one or the other." : "Opting in will clear this person’s existing exemption when you save."}</span>
            </div>
          )}
          {error && <p role="alert" className="mt-4 text-[13px]" style={{ color: C.bad }}>{error}</p>}

          <div className="flex justify-end mt-8">
            <Button onClick={save} loading={saving} disabled={!canEdit || !dirty || conflict || reasonMissing}>Save settings</Button>
          </div>
        </Card>
      </div>

      <Card tone="tint" className="mt-6 !p-7">
        <h2 className="text-[20px] font-semibold tracking-tight">Settings affect future prompting and reporting.</h2>
        <p className="text-[13px] mt-3" style={{ color: C.text2 }}>They do not silently rewrite previous attendance. Use Correct attendance on the person&apos;s profile for a past-day change.</p>
        <p className="text-[13px] mt-3" style={{ color: C.text2 }}>Opting in clears an existing exemption. Review that change before saving.</p>
      </Card>
    </>
  );
}
