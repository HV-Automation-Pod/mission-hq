"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { C, Avatar, Button, FieldLabel, ModalHeader, TextInput, focusRing } from "@/components/ui";
import { setRoster } from "@/lib/actions/groups";
import { groupMembers } from "@/lib/domain/analytics";
import { useAdmin } from "../context";

function useDirectory() {
  const { employees, people } = useAdmin();
  return useMemo(() => {
    const m = new Map<string, { name: string; sub: string }>();
    for (const p of people.values()) m.set(p.email, { name: p.full_name || p.email, sub: p.team || "No department" });
    for (const e of employees) m.set(e.email, { name: e.name || e.email, sub: e.department || "No department" });
    return m;
  }, [employees, people]);
}

/** Edit a hand-kept roster. It must keep at least one member, and it never touches a department. */
export function RosterDialog({ groupKey, onClose }: { groupKey: string; onClose: () => void }) {
  const { admin, reloadAdmin, notify } = useAdmin();
  const dir = useDirectory();
  const group = admin?.groups.find((g) => g.key === groupKey);
  const [draft, setDraft] = useState<string[]>(group?.roster ?? []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!group) return <div><ModalHeader eyebrow="ADMINISTRATION" title="Edit roster" onClose={onClose} /><p className="text-[13px]" style={{ color: C.text2 }}>That report group no longer exists.</p></div>;

  const inDraft = new Set(draft);
  const needle = q.trim().toLowerCase();
  const suggestions = needle
    ? [...dir.entries()].filter(([email, p]) => !inDraft.has(email) && `${p.name} ${email}`.toLowerCase().includes(needle)).slice(0, 6) : [];
  const visible = needle ? draft.filter((e) => `${dir.get(e)?.name ?? ""} ${e}`.toLowerCase().includes(needle)) : draft;
  const changed = draft.length !== group.roster.length || draft.some((e) => !group.roster.includes(e));

  const save = async () => {
    setBusy(true); setError(null);
    const r = await setRoster(group.key, draft);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await reloadAdmin(); notify(`${group.name} roster saved`); onClose();
  };

  return (
    <div>
      <ModalHeader eyebrow="ADMINISTRATION" title={`Edit ${group.name} roster`} onClose={onClose} />
      <p className="text-[13px] -mt-3 mb-6" style={{ color: C.text2 }}>Custom report group {"·"} {draft.length} {draft.length === 1 ? "member" : "members"}</p>

      <FieldLabel htmlFor="roster-q">Add people</FieldLabel>
      <div className="relative">
        <input id="roster-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" autoComplete="off"
          className={`w-full h-11 pl-4 pr-10 text-[14px] rounded-[10px] ${focusRing}`} style={{ background: C.surface, border: `1px solid ${C.border}` }} />
        <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.muted }} />
      </div>
      {suggestions.length > 0 && (
        <ul className="mt-2 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }} aria-label="People to add">
          {suggestions.map(([email, p]) => (
            <li key={email}><button type="button" onClick={() => { setDraft((d) => [...d, email]); setQ(""); }} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[#F3F6F5]">
              <Avatar name={p.name} size={30} /><span className="min-w-0 flex-1"><span className="block text-[13px] font-medium truncate">{p.name}</span><span className="block text-[11px]" style={{ color: C.muted }}>{p.sub}</span></span>
              <span className="text-[12px] font-medium" style={{ color: C.primary }}>Add</span>
            </button></li>
          ))}
        </ul>
      )}

      <ul className="mt-5 max-h-[300px] overflow-y-auto" aria-label="Members">
        {visible.map((email) => {
          const p = dir.get(email);
          return (
            <li key={email} className="flex items-center gap-4 py-3.5" style={{ borderBottom: `1px solid ${C.border}` }}>
              <Avatar name={p?.name ?? email} size={36} />
              <div className="min-w-0 flex-1"><div className="text-[15px] font-semibold truncate">{p?.name ?? email}</div><div className="text-[11px] mt-0.5" style={{ color: C.muted }}>Included in this report group</div></div>
              <button onClick={() => setDraft((d) => d.filter((x) => x !== email))} aria-label={`Remove ${p?.name ?? email}`} className={`p-2 rounded-lg hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.muted }}><X size={17} /></button>
            </li>
          );
        })}
        {visible.length === 0 && <li className="py-6 text-[13px]" style={{ color: C.muted }}>{needle ? "No members match that search." : "Nobody is in this roster yet."}</li>}
      </ul>

      <p className="text-[12px] mt-5" style={{ color: draft.length === 0 ? C.bad : C.muted }}>
        {draft.length === 0 ? "A roster must keep at least one member." : "Keep at least one member. This does not change anyone’s department."}
      </p>
      {error && <p role="alert" className="text-[13px] mt-3" style={{ color: C.bad }}>{error}</p>}
      <div className="flex items-center justify-between gap-4 mt-7">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button className="min-w-[240px]" disabled={!changed || draft.length === 0} loading={busy} onClick={save}>Save roster</Button>
      </div>
    </div>
  );
}

/** A read-only list of who a group covers right now. */
export function MembersDialog({ groupKey, onClose }: { groupKey: string; onClose: () => void }) {
  const { admin, employees, people } = useAdmin();
  const dir = useDirectory();
  const group = admin?.groups.find((g) => g.key === groupKey);
  const [q, setQ] = useState("");
  const emails = useMemo(() => (group ? groupMembers(group, employees, people) : []), [group, employees, people]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? emails.filter((e) => `${dir.get(e)?.name ?? ""} ${e}`.toLowerCase().includes(needle)) : emails;
  if (!group) return <div><ModalHeader eyebrow="REPORT GROUP" title="Members" onClose={onClose} /></div>;

  return (
    <div>
      <ModalHeader eyebrow="REPORT GROUP" title={group.name} onClose={onClose} />
      <p className="text-[13px] -mt-3 mb-6" style={{ color: C.text2 }}>
        {group.match_kind === "roster" ? "Custom roster" : "Membership comes from Zoho and changes with it"} {"·"} {emails.length} {emails.length === 1 ? "member" : "members"}
      </p>
      <TextInput label="Search" value={q} onChange={setQ} placeholder="Name or email" />
      <ul className="mt-4 max-h-[360px] overflow-y-auto" aria-label="Members">
        {shown.map((email) => (
          <li key={email} className="flex items-center gap-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
            <Avatar name={dir.get(email)?.name ?? email} size={34} />
            <div className="min-w-0"><div className="text-[14px] font-semibold truncate">{dir.get(email)?.name ?? email}</div><div className="text-[11px]" style={{ color: C.muted }}>{dir.get(email)?.sub}</div></div>
          </li>
        ))}
        {shown.length === 0 && <li className="py-6 text-[13px]" style={{ color: C.muted }}>No members match.</li>}
      </ul>
      <div className="flex justify-end mt-6"><Button variant="outline" onClick={onClose}>Close</Button></div>
    </div>
  );
}
