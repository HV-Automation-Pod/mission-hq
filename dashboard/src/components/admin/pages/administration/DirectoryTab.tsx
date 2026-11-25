"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { C, Avatar, Button, Card, LinkButton, Pill, SearchInput, TextInput, focusRing } from "@/components/ui";
import { setExempt, setPromptOptIn } from "@/lib/actions/people";
import type { TriageRow } from "@/lib/domain/access-types";
import { useAdmin } from "../../context";
import { ago, EmptyState } from "../../ui";

const reasonOf = (t: TriageRow) => t.exited ? "Exited in Zoho" : t.possible_zoho_match ? "Possible email mismatch" : "No Zoho match";

export default function DirectoryTab() {
  const { admin, viewer, reloadAdmin, notify } = useAdmin();
  const rows = admin?.triage ?? [];
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(rows[0]?.email ?? null);
  const [exempting, setExempting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.full_name ?? ""} ${r.slack_name ?? ""} ${r.email}`.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
  const current = rows.find((r) => r.email === selected) ?? shown[0] ?? null;

  // After one is resolved the list shrinks; keep a valid selection.
  useEffect(() => { if (current && current.email !== selected) setSelected(current.email); }, [current, selected]);
  useEffect(() => { setExempting(false); setReason(""); setError(null); }, [selected]);

  const act = async (run: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true); setError(null);
    const r = await run();
    if (!r.ok) { setBusy(false); setError(r.error ?? "Could not save"); notify("That change was not saved", "error"); return; }
    await reloadAdmin();
    setBusy(false); setExempting(false);
    notify(done);
  };

  const keepForLater = () => {
    const i = shown.findIndex((r) => r.email === current?.email);
    setSelected(shown[(i + 1) % shown.length]?.email ?? null);
  };

  if (rows.length === 0) {
    return <EmptyState title="Every Slack account is matched" body="There are no accounts waiting for a decision." />;
  }
  const canEdit = viewer.canEdit;

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-6">
        <Pill color={C.warn} bg={C.warnSoft}>{rows.length} need review</Pill>
        <span className="text-[12px]" style={{ color: C.muted }}>{admin?.slackSyncedAt ? `Slack directory last synced ${ago(admin.slackSyncedAt)}` : "Slack directory sync time is not available"}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] gap-6 items-start">
        <Card className="!p-6">
          <h2 className="text-[22px] font-semibold tracking-tight">Accounts to review</h2>
          <SearchInput className="mt-5" label="Search" placeholder="Name or email" value={query} onChange={setQuery} />
          <ul className="mt-5 space-y-1.5 max-h-[520px] overflow-y-auto pr-1" aria-label="Accounts to review">
            {shown.map((r) => {
              const on = r.email === current?.email;
              const name = r.full_name || r.slack_name || r.email;
              return (
                <li key={r.email}>
                  <button onClick={() => setSelected(r.email)} aria-current={on} className={`w-full flex items-center gap-3 text-left rounded-xl px-3.5 py-3.5 transition-colors ${on ? "" : "hover:bg-[#F3F6F5]"} ${focusRing}`} style={{ background: on ? C.selected : "transparent" }}>
                    <Avatar name={name} size={36} />
                    <span className="min-w-0"><span className="block text-[14px] font-semibold truncate">{name}</span><span className="block text-[12px] mt-0.5" style={{ color: C.muted }}>{reasonOf(r)}</span></span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="text-[13px] py-4" style={{ color: C.muted }}>No accounts match that search.</li>}
          </ul>
          <p className="text-[12px] mt-5" style={{ color: C.muted }}>{shown.findIndex((r) => r.email === current?.email) + 1} of {shown.length} {shown.length === 1 ? "account" : "accounts"} selected</p>
        </Card>

        {current && (
          <Card className="!p-8">
            <div className="flex items-start gap-5">
              <Avatar name={current.full_name || current.slack_name || current.email} size={52} />
              <div className="min-w-0">
                <h2 className="text-[28px] font-semibold tracking-tight truncate">{current.full_name || current.slack_name || current.email}</h2>
                <p className="text-[13px] mt-2" style={{ color: C.muted }}>{current.email}</p>
              </div>
            </div>
            <div className="mt-6 pb-6" style={{ borderBottom: `1px solid ${C.border}` }}><Pill color={C.warn} bg={C.warnSoft}>{current.exited ? "Exited in Zoho" : "Not matched in Zoho"}</Pill></div>

            <h3 className="text-[20px] font-semibold tracking-tight mt-7">What the sources say</h3>
            <dl className="mt-5 space-y-5 text-[14px]">
              <div><dt className="font-semibold">Slack</dt><dd className="mt-1.5" style={{ color: C.text2 }}>Active account {"·"} Seen in the latest directory sync{current.slack_name ? ` as ${current.slack_name}` : ""}</dd></div>
              <div><dt className="font-semibold">Zoho</dt><dd className="mt-1.5" style={{ color: C.text2 }}>{current.exited ? "Marked as exited" : current.possible_zoho_match ? `Possible match: ${current.possible_zoho_match}` : "No employee record found for this email"}</dd></div>
              <div><dt className="font-semibold">MissionHQ</dt><dd className="mt-1.5" style={{ color: C.text2 }}>{current.wfo_exempt ? `Exempt from prompts: ${current.wfo_exempt}` : current.prompt_opt_in ? "Opted in to attendance prompts" : "Not currently opted in to attendance prompts"}</dd></div>
            </dl>

            <h3 className="text-[20px] font-semibold tracking-tight mt-9">Choose what should happen</h3>
            <p className="text-[13px] mt-2.5" style={{ color: C.text2 }}>Verify the identity with People &amp; Culture before changing prompting.</p>

            {exempting ? (
              <div className="mt-5">
                <TextInput label="Reason, kept with your name and the date" value={reason} onChange={setReason} maxLength={200} placeholder="Why this account should not be prompted" autoFocus />
                <div className="flex gap-3 mt-4">
                  <Button loading={busy} disabled={reason.trim().length < 3} onClick={() => act(() => setExempt(current.email, reason.trim()), "Exemption saved")}>Save exemption</Button>
                  <Button variant="ghost" onClick={() => setExempting(false)} disabled={busy}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4 mt-5">
                <Button disabled={!canEdit || busy} loading={busy} onClick={() => act(() => setPromptOptIn(current.email, true), "Included in prompts")}>Include in prompts</Button>
                <Button variant="outline" disabled={!canEdit || busy} onClick={() => setExempting(true)}>Set an exemption</Button>
                <LinkButton onClick={keepForLater}>Keep for later</LinkButton>
              </div>
            )}
            {!canEdit && <p className="text-[12px] mt-4" style={{ color: C.muted }}>View only. An admin editor is needed to change prompting.</p>}
            {current.wfo_exempt && !exempting && <p className="text-[12px] mt-4 inline-flex items-start gap-2" style={{ color: C.warn }}><Info size={14} className="mt-0.5" /> Including this person in prompts clears their existing exemption.</p>}
            {error && <p role="alert" className="text-[13px] mt-4" style={{ color: C.bad }}>{error}</p>}
            <p className="text-[12px] mt-8" style={{ color: C.muted }}>These actions control prompting; they do not merge or rewrite the Zoho record.</p>
          </Card>
        )}
      </div>
    </>
  );
}
