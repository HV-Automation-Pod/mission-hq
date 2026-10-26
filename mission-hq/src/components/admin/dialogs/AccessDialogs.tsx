"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { C, Avatar, Button, FieldLabel, ModalHeader, Pill, TextInput, focusRing } from "@/components/ui";
import { grantAdmin, revokeAdmin, updateAdmin } from "@/lib/actions/access";
import { useAdmin } from "../context";

const LEVELS = [
  { id: "viewer", title: "Viewer", body: "Can see all employees, teams and attendance. Cannot edit." },
  { id: "editor", title: "Editor", body: "Can correct attendance, manage people and run operations." },
] as const;

/** `locked`: only an editor may give or take away editing, so for anybody else the level is fixed. */
function LevelPicker({ value, onChange, locked }: { value: "viewer" | "editor"; onChange: (v: "viewer" | "editor") => void; locked?: boolean }) {
  return (
    <div className="space-y-3" role="radiogroup" aria-label="Permission level">
      {LEVELS.map((l) => {
        const on = value === l.id;
        return (
          <button key={l.id} type="button" role="radio" aria-checked={on} disabled={locked && !on} onClick={() => onChange(l.id)}
            className={`w-full text-left rounded-2xl px-5 py-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${focusRing}`} style={{ background: on ? C.selected : C.surface, border: `1.5px solid ${on ? C.primary : C.border}` }}>
            <div className="text-[17px] font-semibold">{l.title}</div>
            <div className="text-[13px] mt-2" style={{ color: C.text2 }}>{l.body}</div>
          </button>
        );
      })}
    </div>
  );
}

/** The workspace-admin switch: independent of the level, so it sits under it. */
function ManageAccessToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={value} onClick={() => onChange(!value)}
      className={`w-full text-left rounded-2xl px-5 py-4 mt-3 flex items-start gap-3 transition-colors ${focusRing}`} style={{ background: value ? C.selected : C.surface, border: `1.5px solid ${value ? C.primary : C.border}` }}>
      <span aria-hidden className="mt-1 w-4 h-4 rounded shrink-0 flex items-center justify-center text-[11px]" style={{ border: `1.5px solid ${value ? C.primary : C.border}`, background: value ? C.primary : "transparent", color: "#fff" }}>{value ? "✓" : ""}</span>
      <span>
        <span className="block text-[17px] font-semibold">Workspace admin</span>
        <span className="block text-[13px] mt-2" style={{ color: C.text2 }}>Can add and remove viewers and choose who else is a workspace admin. Does not allow editing records, or giving editing to anyone.</span>
      </span>
    </button>
  );
}

/** "Grant admin access": pick a company account, a level, and say why. */
export function GrantDialog({ onClose }: { onClose: () => void }) {
  const { employees, people, admin, viewer, reloadAdmin, notify } = useAdmin();
  const [q, setQ] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [level, setLevel] = useState<"viewer" | "editor">("viewer");
  const [manage, setManage] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = useMemo(() => new Set((admin?.admins ?? []).map((a) => a.email)), [admin]);
  const pool = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people.values()) if (p.email.endsWith("@hyperverge.co") && !p.exited_at) m.set(p.email, p.full_name || p.email);
    for (const e of employees) m.set(e.email, e.name || e.email);
    return [...m.entries()].map(([em, name]) => ({ email: em, name }));
  }, [people, employees]);

  const needle = q.trim().toLowerCase();
  const matches = needle ? pool.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(needle)).slice(0, 6) : [];
  // A typed company address is allowed even if it is in no list: the server is the check.
  const typed = needle.includes("@") && needle.endsWith("@hyperverge.co") ? needle : null;
  const chosen = email ?? typed;
  const alreadyAdmin = chosen ? existing.has(chosen) : false;

  const grant = async () => {
    if (!chosen) return;
    setBusy(true); setError(null);
    const r = await grantAdmin(chosen, level === "editor", note.trim() || undefined, manage);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await reloadAdmin();
    // The grant is saved either way; the Slack heads-up is reported on its own.
    if (r.notified === false && r.reason) notify(`Access granted, but the Slack notification failed: ${String(r.reason)}`, "error");
    else notify("Access granted");
    onClose();
  };

  return (
    <div>
      <ModalHeader eyebrow="ADMINISTRATION" title="Grant admin access" onClose={onClose} />
      <div className="relative">
        <FieldLabel htmlFor="grant-q">HyperVerge account</FieldLabel>
        <div className="relative">
          <input id="grant-q" value={chosen && email ? `${pool.find((p) => p.email === email)?.name ?? email} · ${email}` : q} autoComplete="off" placeholder="Search name or company email"
            onChange={(e) => { setQ(e.target.value); setEmail(null); }}
            className={`w-full h-11 pl-4 pr-10 text-[14px] rounded-[10px] ${focusRing}`} style={{ background: C.surface, border: `1px solid ${C.border}` }} />
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.muted }} />
        </div>
        {!email && matches.length > 0 && (
          <ul role="listbox" className="mt-1.5 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            {matches.map((p) => (
              <li key={p.email} role="option" aria-selected={false}>
                <button type="button" onClick={() => setEmail(p.email)} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[#F3F6F5]">
                  <Avatar name={p.name} size={30} />
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium truncate">{p.name}</span><span className="block text-[11px] truncate" style={{ color: C.muted }}>{p.email}</span></span>
                  {existing.has(p.email) && <Pill color={C.muted} bg={C.inset}>Already an admin</Pill>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h3 className="text-[20px] font-semibold tracking-tight mt-7 mb-4">Permission level</h3>
      <LevelPicker value={level} onChange={setLevel} locked={!viewer.canEdit} />
      {!viewer.canEdit && <p className="text-[12px] mt-3" style={{ color: C.muted }}>Only an editor can make somebody an editor.</p>}
      <ManageAccessToggle value={manage} onChange={setManage} />

      <div className="mt-6">
        <TextInput label="Note" value={note} onChange={setNote} maxLength={200} placeholder="Why this person needs admin access" />
      </div>
      <p className="text-[12px] mt-4" style={{ color: C.muted }}>A new admin receives an access notification in Slack.</p>
      {alreadyAdmin && <p className="text-[13px] mt-4" style={{ color: C.text2 }}>Already an admin. Use Manage access on their card to change their level.</p>}
      {error && <p role="alert" className="text-[13px] mt-4" style={{ color: C.bad }}>{error}</p>}

      <div className="flex items-center justify-between gap-4 mt-7">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button className="min-w-[210px]" disabled={!chosen || alreadyAdmin} loading={busy} onClick={grant}>Grant access</Button>
      </div>
    </div>
  );
}

/** Change one admin's level, or remove their access. The server refuses the dangerous cases. */
export function ManageAccessDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const { admin, employees, viewer, reloadAdmin, notify } = useAdmin();
  const a = admin?.admins.find((x) => x.email === email);
  const name = employees.find((e) => e.email === email)?.name || admin?.people.find((p) => p.email === email)?.full_name || email;
  const [level, setLevel] = useState<"viewer" | "editor">(a?.can_edit ? "editor" : "viewer");
  const [manage, setManage] = useState(a?.can_manage_access === true);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!a) return <div><ModalHeader eyebrow="ADMINISTRATION" title="Manage access" onClose={onClose} /><p className="text-[13px]" style={{ color: C.text2 }}>That person no longer has admin access.</p></div>;
  const you = email === viewer.email;
  const changed = (level === "editor") !== a.can_edit || manage !== a.can_manage_access;
  // Editing is given and taken away by editors only, and removing an editor takes it away.
  const levelLocked = !viewer.canEdit;
  const removeLocked = a.can_edit && !viewer.canEdit;

  const save = async () => {
    setBusy("save"); setError(null);
    const r = await updateAdmin(email, level === "editor", manage);
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    await reloadAdmin(); notify("Permission level updated"); onClose();
  };
  const remove = async () => {
    setBusy("remove"); setError(null);
    const r = await revokeAdmin(email);
    setBusy(null);
    if (!r.ok) { setError(r.error); setConfirmRemove(false); return; }
    await reloadAdmin(); notify(`${name} no longer has admin access`); onClose();
  };

  return (
    <div>
      <ModalHeader eyebrow="ADMINISTRATION" title="Manage access" onClose={onClose} />
      <div className="flex items-center gap-4">
        <Avatar name={name} size={48} />
        <div><div className="text-[18px] font-semibold">{name}{you ? " · You" : ""}</div><div className="text-[12px] mt-1" style={{ color: C.muted }}>{email}</div></div>
      </div>
      <h3 className="text-[18px] font-semibold mt-7 mb-4">Permission level</h3>
      <LevelPicker value={level} onChange={setLevel} locked={levelLocked} />
      {levelLocked && <p className="text-[12px] mt-3" style={{ color: C.muted }}>Only an editor can give or take away editing{removeLocked ? ", or remove an editor" : ""}.</p>}
      <ManageAccessToggle value={manage} onChange={setManage} />
      {you && <p className="text-[12px] mt-4" style={{ color: C.muted }}>You cannot remove your own access or your own ability to manage it, and at least one editor must remain.</p>}
      {error && <p role="alert" className="text-[13px] mt-4" style={{ color: C.bad }}>{error}</p>}

      {confirmRemove ? (
        <div className="mt-7 rounded-2xl p-5" style={{ background: C.badSoft, border: `1px solid ${C.bad}33` }}>
          <div className="text-[15px] font-semibold">Remove {name}&apos;s admin access?</div>
          <p className="text-[13px] mt-2" style={{ color: C.text2 }}>They keep their own member view. They will no longer see other people&apos;s attendance.</p>
          <div className="flex gap-3 mt-4"><Button variant="danger" loading={busy === "remove"} onClick={remove}>Remove access</Button><Button variant="ghost" onClick={() => setConfirmRemove(false)} disabled={busy !== null}>Keep access</Button></div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 mt-8">
          <Button variant="ghost" style={{ color: C.bad }} disabled={you || removeLocked || busy !== null} onClick={() => setConfirmRemove(true)}>Remove access</Button>
          <div className="flex gap-3"><Button variant="outline" onClick={onClose} disabled={busy !== null}>Cancel</Button><Button disabled={!changed} loading={busy === "save"} onClick={save}>Save level</Button></div>
        </div>
      )}
    </div>
  );
}
