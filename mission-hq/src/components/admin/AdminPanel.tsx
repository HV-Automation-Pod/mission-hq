"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Shield, Users, GitCompareArrows, ListChecks, PlayCircle, Search, Plus, Trash2,
  AlertTriangle, CheckCircle2, Loader2, RefreshCw, Lock, MapPin, BellOff, BellRing,
} from "lucide-react";
import Tooltip from "../Tooltip";
import { useAction } from "./useAction";
import {
  setExempt, setPromptOptIn, setSiteOverride, setRoster, grantAdmin, revokeAdmin, runJob,
} from "@/lib/actions";

/*
 * The Admin tab: everything PnC used to do by hand.
 *
 * That work was never only reporting. It was also input — somebody typed a
 * reason into a "WFO Exempt" column, flipped a "Send Attendance Prompt?"
 * dropdown, pasted a roster — and those edits drove what the bot did the next
 * morning. Moving the data to Postgres without moving those controls would
 * have left those hand edits as the only way to operate the system.
 *
 * Read access and write access are separate on purpose. Most people who need
 * this screen need to look at it; `canEdit` gates every control that changes
 * something, and the server action re-checks it regardless of what renders.
 */

type Section = "access" | "triage" | "people" | "rosters" | "jobs";

type Admin = { email: string; can_edit: boolean; note: string | null; added_by: string | null; created_at: string };
type TriageRow = {
  email: string; slack_name: string | null; slack_user_id: string | null;
  in_mission_hq: boolean; full_name: string | null; wfo_exempt: string | null;
  prompt_opt_in: boolean; notes: string | null; exited: boolean; possible_zoho_match: string | null;
};
type Person = {
  email: string; full_name: string | null; team: string | null; location: string | null;
  location_override: string | null; emp_id: string | null; exited_at: string | null;
  wfo_exempt: string | null; prompt_opt_in: boolean; notes: string | null;
};
type Group = {
  key: string; name: string; channel_id: string; match_kind: "column" | "roster";
  match_column: string | null; match_values: string[] | null; active: boolean;
  snapshot_no: number; last_period: string | null; roster: string[];
};
type JobRow = { jobname: string; schedule: string; active: boolean };

type AdminData = {
  admins: Admin[]; triage: TriageRow[]; jobs: JobRow[]; people: Person[]; groups: Group[];
  slackSyncedAt: string | null;
  viewer: { email: string; role: string; canEdit: boolean };
};

export default function AdminPanel() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("access");

  const load = async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  };

  useEffect(() => { load(); }, []);

  if (error) {
    return (
      <div className="card p-8 text-center">
        <AlertTriangle size={28} className="mx-auto text-amber-500 mb-3" />
        <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{error}</div>
        <button onClick={load} className="mt-4 px-3 py-1.5 text-xs font-semibold rounded-lg"
          style={{ background: "var(--accent)", color: "#fff" }}>Try again</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card p-10 flex items-center justify-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <Loader2 size={15} className="animate-spin" /> Loading admin data…
      </div>
    );
  }

  const canEdit = data.viewer.canEdit;
  const sections: { id: Section; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "access",  label: "Access",        icon: <Shield size={14} />,           count: data.admins.length },
    { id: "triage",  label: "Slack vs Zoho", icon: <GitCompareArrows size={14} />, count: data.triage.length },
    { id: "people",  label: "People",        icon: <Users size={14} />,            count: data.people.length },
    { id: "rosters", label: "Rosters",       icon: <ListChecks size={14} />,       count: data.groups.length },
    { id: "jobs",    label: "Jobs",          icon: <PlayCircle size={14} />,       count: data.jobs.length },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      {!canEdit && (
        <div className="card p-3 flex items-center gap-2.5 text-[12px]" style={{ color: "var(--text-secondary)" }}>
          <Lock size={14} className="text-amber-500 flex-shrink-0" />
          You have read-only admin access. Everything here is visible; nothing here will save.
        </div>
      )}

      <div className="card p-1.5">
        <div className="flex gap-1 flex-wrap">
          {sections.map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold rounded-lg transition-all"
              style={{
                background: section === s.id ? "var(--accent-light)" : "transparent",
                color: section === s.id ? "var(--accent)" : "var(--text-muted)",
              }}>
              {s.icon} {s.label}
              {s.count !== undefined && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: "var(--bg-inset)", color: "var(--text-muted)" }}>{s.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {section === "access"  && <AccessSection  admins={data.admins} people={data.people} viewer={data.viewer} canEdit={canEdit} reload={load} />}
      {section === "triage"  && <TriageSection  rows={data.triage} syncedAt={data.slackSyncedAt} canEdit={canEdit} reload={load} />}
      {section === "people"  && <PeopleSection  people={data.people} canEdit={canEdit} reload={load} />}
      {section === "rosters" && <RostersSection groups={data.groups} people={data.people} canEdit={canEdit} reload={load} />}
      {section === "jobs"    && <JobsSection    jobs={data.jobs} canEdit={canEdit} />}
    </div>
  );
}

// ─── shared bits ────────────────────────────────────────────────────────────

function SectionCard({ title, subtitle, icon, children, action }: {
  title: string; subtitle: string; icon: React.ReactNode;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--accent-light)", color: "var(--accent)" }}>{icon}</div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
            <p className="text-[11px] max-w-2xl" style={{ color: "var(--text-muted)" }}>{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Feedback({ error, done }: { error: string | null; done: string | null }) {
  if (!error && !done) return null;
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium mt-2"
      style={{ color: error ? "#ef4444" : "#10b981" }}>
      {error ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
      {error ?? done}
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left py-2.5 px-3 font-medium ${className}`} style={{ color: "var(--text-secondary)" }}>
      {children}
    </th>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <tr className="table-row-hover" style={{ borderTop: "1px solid var(--border-subtle)" }}>{children}</tr>;
}

function TableShell({ head, children, max = "520px" }: {
  head: React.ReactNode; children: React.ReactNode; max?: string;
}) {
  return (
    <div className="overflow-auto scrollbar-thin rounded-lg border" style={{ borderColor: "var(--border-subtle)", maxHeight: max }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10" style={{ background: "var(--bg-surface-secondary)" }}>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-12 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>{children}</div>;
}

function Avatar({ name, muted = false }: { name: string; muted?: boolean }) {
  const initials = name.split(/[\s.@]+/).filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="avatar w-7 h-7 text-[10px] flex-shrink-0"
      style={muted
        ? { background: "var(--bg-inset)", color: "var(--text-muted)" }
        : { background: "var(--accent-light)", color: "var(--accent)" }}>
      {initials}
    </div>
  );
}

/**
 * `title` here renders the app's own tooltip, never the browser's. Several of
 * these explain why a control is disabled, and a disabled button swallows the
 * hover that a native `title=` needs — so the wrapper carries it instead.
 */
function Btn({ children, onClick, disabled, tone = "ghost", title, tipSide = "top", tipWidth }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  tone?: "ghost" | "primary" | "danger"; title?: string;
  tipSide?: "top" | "bottom"; tipWidth?: number;
}) {
  const styles = {
    primary: { background: "var(--accent)", color: "#fff", borderColor: "transparent" },
    danger:  { background: "transparent", color: "#ef4444", borderColor: "rgba(239,68,68,0.35)" },
    ghost:   { background: "var(--bg-inset)", color: "var(--text-secondary)", borderColor: "var(--border-subtle)" },
  }[tone];
  const button = (
    <button onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
      style={styles}>
      {children}
    </button>
  );
  return title ? <Tooltip label={title} side={tipSide} width={tipWidth}>{button}</Tooltip> : button;
}

function Field({ value, onChange, placeholder, onEnter, type = "text" }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  onEnter?: () => void; type?: string;
}) {
  return (
    <input type={type} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
      className="px-2.5 py-1.5 text-[12px] rounded-lg border focus:outline-none w-full"
      style={{ background: "var(--bg-surface-secondary)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
  );
}

/** Search box with the magnifier, used by three of the five sections. */
function SearchBox({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div className="relative flex-1 min-w-[200px]">
      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border focus:outline-none"
        style={{ background: "var(--bg-surface-secondary)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
    </div>
  );
}

// ─── 1. Access ──────────────────────────────────────────────────────────────

/**
 * Who can open this dashboard as an admin.
 *
 * Anybody with a @hyperverge.co account can sign in and see their OWN
 * attendance; this list is the separate right to see everybody's. `can_edit`
 * is a second step again, because reading 350 people's records and changing
 * them are different powers and most people only need the first.
 */
function AccessSection({ admins, people, viewer, canEdit, reload }: {
  admins: Admin[]; people: Person[]; viewer: { email: string }; canEdit: boolean; reload: () => void;
}) {
  // `dashboard_access` stores an email and nothing else, on purpose: access is
  // granted to an ACCOUNT, and somebody can hold one without being in the Zoho
  // feed. The name is looked up for display rather than stored, so it stays
  // right when HR changes it and degrades to the address when there is none.
  const nameOf = useMemo(() => {
    const map = new Map(people.map((p) => [p.email, p.full_name]));
    return (email: string) => map.get(email) || email.split("@")[0];
  }, [people]);
  const { run, pending, error, done } = useAction();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [withEdit, setWithEdit] = useState(false);

  const [outcome, setOutcome] = useState<string | null>(null);

  const add = () => {
    const target = email.trim().toLowerCase();
    setOutcome(null);
    run(
      async () => {
        const result = await grantAdmin(target, withEdit, note) as
          { ok: boolean; error?: string; notified?: boolean; reason?: string };
        if (!result.ok) throw new Error(result.error || "Could not grant access");
        // Granted and told, granted and not told, and not granted are three
        // different things. The second one used to look exactly like the first.
        setOutcome(
          result?.notified
            ? `${target} can now ${withEdit ? "view and edit" : "view"}, and has been sent a Slack message.`
            : `${target} can now ${withEdit ? "view and edit" : "view"}. We could not message them on Slack: ${result?.reason ?? "unknown reason"}. Tell them yourself.`,
        );
      },
      "Saved",
      () => { setEmail(""); setNote(""); setWithEdit(false); reload(); },
    );
  };

  const editors = admins.filter((a) => a.can_edit).length;

  return (
    <SectionCard
      icon={<Shield size={18} />}
      title="Dashboard access"
      subtitle="Everyone with a HyperVerge account can sign in and see their own record. The people below can see everybody's.">
      <div className="p-3.5 rounded-xl border mb-4" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--text-muted)" }}>
          Give someone access
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex-1 min-w-[220px]">
            <Field value={email} onChange={setEmail} placeholder="name@hyperverge.co" onEnter={add} />
          </div>
          <div className="flex-1 min-w-[180px]">
            <Field value={note} onChange={setNote} placeholder="Why, e.g. PnC team" onEnter={add} />
          </div>
          <label className="flex items-center gap-1.5 text-[11px] font-medium cursor-pointer select-none px-2"
            style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={withEdit} onChange={(e) => setWithEdit(e.target.checked)}
              className="accent-[var(--accent)]" />
            Can edit
          </label>
          <Btn tone="primary" onClick={add} disabled={!canEdit || pending || !email.trim()}>
            {pending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Grant
          </Btn>
        </div>
        <Feedback error={error} done={outcome ? null : done} />
        {outcome && !error && (
          <div className="flex items-start gap-1.5 text-[11px] font-medium mt-2"
            style={{ color: outcome.includes("could not message") ? "#f59e0b" : "#10b981" }}>
            {outcome.includes("could not message")
              ? <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
              : <CheckCircle2 size={11} className="mt-0.5 flex-shrink-0" />}
            <span>{outcome}</span>
          </div>
        )}
        <p className="text-[10px] mt-2.5" style={{ color: "var(--text-muted)" }}>
          Leave &ldquo;Can edit&rdquo; off for someone who needs to read the data. Editing changes attendance records,
          exemptions and rosters, and the last remaining editor cannot be removed. Whoever you add gets a Slack
          message telling them what they can now do.
        </p>
      </div>

      {admins.length === 0 ? <Empty>Nobody has admin access yet.</Empty> : (
        <TableShell head={<><Th>Person</Th><Th>Access</Th><Th className="hidden md:table-cell">Note</Th><Th className="hidden lg:table-cell">Granted by</Th><Th className="w-10" /></>}>
          {admins.map((a) => (
            <AccessRow key={a.email} admin={a} name={nameOf(a.email)} isSelf={a.email === viewer.email}
              canEdit={canEdit} lastEditor={a.can_edit && editors <= 1} reload={reload}
              grantedBy={a.added_by ? nameOf(a.added_by) : null} />
          ))}
        </TableShell>
      )}
    </SectionCard>
  );
}

function AccessRow({ admin, name, grantedBy, isSelf, canEdit, lastEditor, reload }: {
  admin: Admin; name: string; grantedBy: string | null;
  isSelf: boolean; canEdit: boolean; lastEditor: boolean; reload: () => void;
}) {
  const { run, pending, error } = useAction();
  const [confirming, setConfirming] = useState(false);

  // Why a control is unavailable, in the tooltip, rather than a dead button.
  const blocked = isSelf
    ? "You cannot remove your own access"
    : lastEditor
      ? "This is the last administrator who can edit"
      : !canEdit
        ? "You have read-only access"
        : undefined;

  return (
    <Row>
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={name} />
          <div>
            <div className="font-medium text-[13px] flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
              {name}
              {isSelf && <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: "var(--accent-light)", color: "var(--accent)" }}>you</span>}
            </div>
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{admin.email}</div>
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3">
        <Tooltip width={200} label={
          admin.can_edit && lastEditor ? "The last administrator who can edit. Add another before changing this one."
            : !canEdit ? "You have read-only access"
            : admin.can_edit ? "Click to make read-only" : "Click to let them edit"}>
          <button
            onClick={() => run(() => grantAdmin(admin.email, !admin.can_edit, admin.note ?? undefined),
              admin.can_edit ? "Now read-only" : "Can now edit", reload)}
            disabled={!canEdit || pending || (admin.can_edit && lastEditor)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all disabled:cursor-not-allowed"
            style={admin.can_edit
              ? { background: "rgba(16,185,129,0.12)", color: "#10b981" }
              : { background: "var(--bg-inset)", color: "var(--text-muted)" }}>
            {pending ? <Loader2 size={10} className="animate-spin" /> : null}
            {admin.can_edit ? "View and edit" : "View only"}
          </button>
        </Tooltip>
        {error && <div className="text-[10px] mt-1" style={{ color: "#ef4444" }}>{error}</div>}
      </td>
      <td className="py-2.5 px-3 hidden md:table-cell text-[12px]" style={{ color: "var(--text-muted)" }}>
        {admin.note || <span style={{ color: "var(--text-faint)" }}>&mdash;</span>}
      </td>
      <td className="py-2.5 px-3 hidden lg:table-cell text-[11px]" style={{ color: "var(--text-muted)" }}>
        {grantedBy ?? <span style={{ color: "var(--text-faint)" }}>&mdash;</span>}
      </td>
      <td className="py-2.5 px-3 text-right">
        {confirming ? (
          <div className="flex items-center gap-1 justify-end">
            <Btn tone="danger" onClick={() => run(() => revokeAdmin(admin.email), "Removed", reload)} disabled={pending}>
              {pending ? <Loader2 size={11} className="animate-spin" /> : null} Confirm
            </Btn>
            <Btn onClick={() => setConfirming(false)}>Cancel</Btn>
          </div>
        ) : (
          <Tooltip label={blocked ?? "Remove access"} width={blocked ? 190 : undefined}>
            <button onClick={() => setConfirming(true)} disabled={!!blocked}
              className="p-1.5 rounded-lg transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
              style={{ color: "var(--text-muted)" }}>
              <Trash2 size={13} />
            </button>
          </Tooltip>
        )}
      </td>
    </Row>
  );
}

// ─── 2. Slack vs Zoho ───────────────────────────────────────────────────────

/**
 * Active Slack accounts with no Zoho org-tree record.
 *
 * This list is also an input: somebody reads it, decides a person is a real
 * employee whose HR record sits under a different email, and sets
 * "Send Attendance Prompt? = yes". That decision is the only
 * thing that gets a live employee prompted when Zoho has never heard of them.
 *
 * Both sides sync themselves daily — Slack at 02:00, Zoho at 06:30 — so the
 * list is a join, not a job. There is nothing to refresh.
 */
function TriageSection({ rows, syncedAt, canEdit, reload }: {
  rows: TriageRow[]; syncedAt: string | null; canEdit: boolean; reload: () => void;
}) {
  const [query, setQuery] = useState("");
  const [onlyUndecided, setOnlyUndecided] = useState(false);
  /*
   * No domain filter here any more, deliberately.
   *
   * This screen briefly hid anything not on @hyperverge.co, because the list
   * was 133 rows of which most were vendors. But the domain was never the
   * signal: Slack guests hold company addresses too, so that filter let them
   * through while being capable of hiding a genuine contractor who is a full
   * workspace member on an external domain.
   *
   * `mission-hq.slack_accounts` now carries Slack's own flags, and the view
   * excludes bots, guests and deactivated accounts before the data gets here.
   * That took the list from 133 rows to 12, every one of them a real question.
   */
  const pool = rows;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool.filter((r) => {
      if (onlyUndecided && (r.prompt_opt_in || r.wfo_exempt)) return false;
      if (!q) return true;
      return r.email.toLowerCase().includes(q)
        || (r.slack_name ?? "").toLowerCase().includes(q)
        || (r.full_name ?? "").toLowerCase().includes(q);
    });
  }, [pool, query, onlyUndecided]);

  const optedIn = pool.filter((r) => r.prompt_opt_in).length;
  const undecided = pool.filter((r) => !r.prompt_opt_in && !r.wfo_exempt).length;

  return (
    <SectionCard
      icon={<GitCompareArrows size={18} />}
      title="Slack accounts with no Zoho record"
      subtitle="Bots, guests and deactivated accounts are already excluded, so what is left is a real question: usually a contractor, an intern, or a live employee whose HR record sits under a different email. Opting someone in is what gets them the daily prompt."
      action={<SyncAge at={syncedAt} />}>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Unmatched" value={pool.length} hint="Active in Slack, absent from Zoho" />
        <Stat label="Prompted anyway" value={optedIn} hint="Someone decided they are staff" tone="emerald" />
        <Stat label="Undecided" value={undecided} hint="Nobody has ruled on these yet" tone={undecided > 0 ? "amber" : undefined} />
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <SearchBox value={query} onChange={setQuery} placeholder="Search name or email…" />
        <label className="flex items-center gap-1.5 text-[11px] font-medium cursor-pointer select-none"
          style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={onlyUndecided} onChange={(e) => setOnlyUndecided(e.target.checked)}
            className="accent-[var(--accent)]" />
          Only undecided
        </label>
      </div>

      {filtered.length === 0 ? (
        <Empty>{pool.length === 0 ? "Every HyperVerge Slack account has a Zoho record." : "Nothing matches that search."}</Empty>
      ) : (
        <TableShell head={<><Th>Slack account</Th><Th className="hidden md:table-cell">Possible Zoho match</Th><Th>Decision</Th><Th className="hidden lg:table-cell">Note</Th></>}>
          {filtered.map((r) => <TriageRowView key={r.email} row={r} canEdit={canEdit} reload={reload} />)}
        </TableShell>
      )}
    </SectionCard>
  );
}

function TriageRowView({ row, canEdit, reload }: { row: TriageRow; canEdit: boolean; reload: () => void }) {
  const { run, pending, error } = useAction();

  return (
    <Row>
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={row.slack_name || row.email} muted={!row.prompt_opt_in} />
          <div className="min-w-0">
            <div className="font-medium text-[13px] truncate" style={{ color: "var(--text-primary)" }}>
              {row.slack_name || row.full_name || row.email.split("@")[0]}
            </div>
            <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{row.email}</div>
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3 hidden md:table-cell text-[12px]" style={{ color: "var(--text-muted)" }}>
        {row.possible_zoho_match
          ? <span className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "var(--bg-inset)" }}>{row.possible_zoho_match}</span>
          : <span style={{ color: "var(--text-faint)" }}>no obvious match</span>}
      </td>
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Btn
            tone={row.prompt_opt_in ? "primary" : "ghost"}
            disabled={!canEdit || pending}
            title={row.prompt_opt_in
              ? "Stop sending this person the daily attendance prompt"
              : "Send this person the daily attendance prompt from tomorrow"}
            tipWidth={190}
            onClick={() => run(
              () => setPromptOptIn(row.email, !row.prompt_opt_in),
              row.prompt_opt_in ? "No longer prompted" : "Will be prompted from tomorrow",
              reload,
            )}>
            {pending ? <Loader2 size={11} className="animate-spin" />
              : row.prompt_opt_in ? <BellRing size={11} /> : <BellOff size={11} />}
            {row.prompt_opt_in ? "Prompted" : "Prompt them"}
          </Btn>
          {row.wfo_exempt && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-inset)", color: "var(--text-muted)" }}>
              exempt
            </span>
          )}
        </div>
        {error && <div className="text-[10px] mt-1" style={{ color: "#ef4444" }}>{error}</div>}
      </td>
      <td className="py-2.5 px-3 hidden lg:table-cell text-[11px] max-w-[220px] truncate" style={{ color: "var(--text-muted)" }}>
        {row.notes || row.wfo_exempt || <span style={{ color: "var(--text-faint)" }}>&mdash;</span>}
      </td>
    </Row>
  );
}

function Stat({ label, value, hint, tone }: {
  label: string; value: number; hint: string; tone?: "emerald" | "amber";
}) {
  const color = tone === "emerald" ? "#10b981" : tone === "amber" ? "#f59e0b" : "var(--text-primary)";
  return (
    <div className="p-3.5 rounded-xl border" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-2xl font-bold font-mono" style={{ color }}>{value}</div>
      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{hint}</div>
    </div>
  );
}

// ─── 3. People ──────────────────────────────────────────────────────────────

/**
 * The three fields a human owns, for everyone MissionHQ knows about.
 *
 * Name, team and location are mirrored from Zoho and overwritten on every
 * sync, so they are shown and not editable here — typing over them would last
 * until 06:30 tomorrow. What a human owns is: whether somebody is prompted,
 * why they are exempt, and which site they are reported under.
 */
function PeopleSection({ people, canEdit, reload }: {
  people: Person[]; canEdit: boolean; reload: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "exempt" | "optin" | "override" | "exited">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (filter === "exempt"   && !p.wfo_exempt) return false;
      if (filter === "optin"    && !p.prompt_opt_in) return false;
      if (filter === "override" && !p.location_override) return false;
      if (filter === "exited"   && !p.exited_at) return false;
      if (!q) return true;
      return p.email.toLowerCase().includes(q)
        || (p.full_name ?? "").toLowerCase().includes(q)
        || (p.team ?? "").toLowerCase().includes(q);
    });
  }, [people, query, filter]);

  const filters: { id: typeof filter; label: string; n: number }[] = [
    { id: "all",      label: "Everyone",      n: people.length },
    { id: "exempt",   label: "Exempt",        n: people.filter((p) => p.wfo_exempt).length },
    { id: "optin",    label: "Opted in",      n: people.filter((p) => p.prompt_opt_in).length },
    { id: "override", label: "Site override", n: people.filter((p) => p.location_override).length },
    { id: "exited",   label: "Exited",        n: people.filter((p) => p.exited_at).length },
  ];

  return (
    <SectionCard
      icon={<Users size={18} />}
      title="People"
      subtitle="Name, team and site come from Zoho and are rewritten on every sync. The exemption, the prompt override and the site correction are MissionHQ's own, and this is where they are set.">
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <SearchBox value={query} onChange={setQuery} placeholder="Search name, email or team…" />
        <div className="flex gap-1 p-0.5 rounded-lg flex-wrap" style={{ background: "var(--bg-inset)" }}>
          {filters.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className="px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-all"
              style={{
                background: filter === f.id ? "var(--bg-surface)" : "transparent",
                color: filter === f.id ? "var(--text-primary)" : "var(--text-muted)",
                boxShadow: filter === f.id ? "var(--shadow-xs)" : "none",
              }}>
              {f.label} <span className="font-mono opacity-60">{f.n}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? <Empty>Nobody matches.</Empty> : (
        <TableShell max="620px"
          head={<><Th>Person</Th><Th className="hidden md:table-cell">Team</Th><Th>Prompting</Th><Th className="hidden lg:table-cell">Reported site</Th></>}>
          {filtered.slice(0, 200).map((p) => <PersonRow key={p.email} person={p} canEdit={canEdit} reload={reload} />)}
        </TableShell>
      )}
      {filtered.length > 200 && (
        <p className="text-[11px] mt-2.5 text-center" style={{ color: "var(--text-muted)" }}>
          Showing the first 200 of {filtered.length}. Narrow the search to reach the rest.
        </p>
      )}
    </SectionCard>
  );
}

function PersonRow({ person, canEdit, reload }: { person: Person; canEdit: boolean; reload: () => void }) {
  const { run, pending, error } = useAction();
  const [editingExempt, setEditingExempt] = useState(false);
  const [reason, setReason] = useState(person.wfo_exempt ?? "");
  const [editingSite, setEditingSite] = useState(false);
  const [site, setSite] = useState(person.location_override ?? "");

  const saveExempt = () => run(
    () => setExempt(person.email, reason.trim() || null),
    reason.trim() ? "Exempt" : "Prompting resumed",
    () => { setEditingExempt(false); reload(); },
  );
  const saveSite = () => run(
    () => setSiteOverride(person.email, site.trim() || null),
    site.trim() ? `Reported under ${site.trim()}` : "Back to the Zoho site",
    () => { setEditingSite(false); reload(); },
  );

  return (
    <Row>
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={person.full_name || person.email} muted={!!person.exited_at} />
          <div className="min-w-0">
            <div className="font-medium text-[13px] truncate flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
              {person.full_name || person.email.split("@")[0]}
              {person.exited_at && (
                <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: "var(--bg-inset)", color: "var(--text-muted)" }}>exited</span>
              )}
            </div>
            <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{person.email}</div>
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3 hidden md:table-cell text-[12px]" style={{ color: "var(--text-muted)" }}>
        {person.team || <span style={{ color: "var(--text-faint)" }}>&mdash;</span>}
      </td>

      {/* Prompting: exempt reason, or the opt-in override */}
      <td className="py-2.5 px-3">
        {editingExempt ? (
          <div className="flex items-center gap-1.5 min-w-[220px]">
            <Field value={reason} onChange={setReason} onEnter={saveExempt}
              placeholder="Reason, e.g. Maternity leave" />
            <Btn tone="primary" onClick={saveExempt} disabled={pending}>
              {pending ? <Loader2 size={11} className="animate-spin" /> : null} Save
            </Btn>
            <Btn onClick={() => { setEditingExempt(false); setReason(person.wfo_exempt ?? ""); }}>Cancel</Btn>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {person.wfo_exempt ? (
              <Tooltip width={220} label={person.wfo_exempt}>
                <button onClick={() => canEdit && setEditingExempt(true)} disabled={!canEdit}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold max-w-[200px] disabled:cursor-not-allowed"
                  style={{ background: "var(--bg-inset)", color: "var(--text-muted)" }}>
                  <BellOff size={10} className="flex-shrink-0" />
                  <span className="truncate">{person.wfo_exempt}</span>
                </button>
              </Tooltip>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold"
                style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}>
                <BellRing size={10} /> Prompted
              </span>
            )}
            {person.prompt_opt_in && (
              <Tooltip width={220}
                label="Prompted by an explicit human decision, which outranks every automatic exit signal.">
                <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
                  opted in
                </span>
              </Tooltip>
            )}
            {canEdit && !person.wfo_exempt && (
              <Tooltip label="Stop prompting this person">
                <button onClick={() => setEditingExempt(true)}
                  className="p-1 rounded transition-colors" style={{ color: "var(--text-faint)" }}>
                  <BellOff size={11} />
                </button>
              </Tooltip>
            )}
          </div>
        )}
        {error && <div className="text-[10px] mt-1" style={{ color: "#ef4444" }}>{error}</div>}
      </td>

      {/* Reported site: Zoho's, or the override that corrects it */}
      <td className="py-2.5 px-3 hidden lg:table-cell">
        {editingSite ? (
          <div className="flex items-center gap-1.5 min-w-[200px]">
            <Field value={site} onChange={setSite} onEnter={saveSite} placeholder="e.g. Coimbatore" />
            <Btn tone="primary" onClick={saveSite} disabled={pending}>Save</Btn>
            <Btn onClick={() => { setEditingSite(false); setSite(person.location_override ?? ""); }}>Cancel</Btn>
          </div>
        ) : (
          <Tooltip width={210} label={person.location_override
            ? `Zoho says ${person.location || "nothing"}; MissionHQ reports ${person.location_override}.`
            : "Set a site correction"}>
            <button onClick={() => canEdit && setEditingSite(true)} disabled={!canEdit}
              className="inline-flex items-center gap-1.5 text-[12px] disabled:cursor-default"
              style={{ color: person.location_override ? "var(--accent)" : "var(--text-muted)" }}>
              <MapPin size={11} className="flex-shrink-0" />
              {person.location_override || person.location || <span style={{ color: "var(--text-faint)" }}>&mdash;</span>}
              {person.location_override && <span className="text-[9px] opacity-70">(override)</span>}
            </button>
          </Tooltip>
        )}
      </td>
    </Row>
  );
}

// ─── 4. Rosters ─────────────────────────────────────────────────────────────

/**
 * Who each fortnightly report covers.
 *
 * Two kinds of membership, because two different things are true. A 'column'
 * group is derived from Zoho — "everyone whose site is Bengaluru" — and keeps
 * itself current; there is no list to edit and editing one would be a lie.
 * A 'roster' group is a list somebody keeps by hand, because no Zoho field
 * names it: FLG, Managers. Those are editable here, and Managers additionally
 * rebuilds itself from a Slack channel when the directory job runs.
 */
function RostersSection({ groups, people, canEdit, reload }: {
  groups: Group[]; people: Person[]; canEdit: boolean; reload: () => void;
}) {
  return (
    <SectionCard
      icon={<ListChecks size={18} />}
      title="Report groups"
      subtitle="Who each fortnightly summary covers. Groups matched on a Zoho column maintain themselves; hand-kept rosters are edited here.">
      <div className="space-y-3">
        {groups.length === 0 ? <Empty>No report groups are configured.</Empty> : groups.map((g) => (
          <GroupCard key={g.key} group={g} people={people} canEdit={canEdit} reload={reload} />
        ))}
      </div>
    </SectionCard>
  );
}

function GroupCard({ group, people, canEdit, reload }: {
  group: Group; people: Person[]; canEdit: boolean; reload: () => void;
}) {
  const { run, pending, error, done } = useAction();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(group.roster);
  const [add, setAdd] = useState("");

  const byEmail = useMemo(() => new Map(people.map((p) => [p.email, p])), [people]);
  const dirty = draft.join(",") !== group.roster.join(",");
  const isRoster = group.match_kind === "roster";

  const suggestions = useMemo(() => {
    const q = add.trim().toLowerCase();
    if (q.length < 2) return [];
    return people
      .filter((p) => !draft.includes(p.email) && !p.exited_at)
      .filter((p) => p.email.toLowerCase().includes(q) || (p.full_name ?? "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [add, people, draft]);

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-3 p-3.5 text-left"
        style={{ background: "var(--bg-inset)" }}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold flex items-center gap-2 flex-wrap" style={{ color: "var(--text-primary)" }}>
            {group.name}
            {!group.active && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>paused</span>
            )}
            <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
              style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>
              {isRoster ? "hand-kept list" : `Zoho ${group.match_column}`}
            </span>
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {isRoster
              ? `${group.roster.length} ${group.roster.length === 1 ? "person" : "people"}`
              : `everyone where ${group.match_column} is ${(group.match_values ?? []).join(" or ")}`}
            {group.last_period && ` · last sent ${group.last_period}`}
            {group.snapshot_no > 0 && ` · snapshot #${group.snapshot_no}`}
          </div>
        </div>
        <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: "var(--accent)" }}>
          {open ? "Close" : isRoster ? "Edit list" : "View"}
        </span>
      </button>

      {open && (
        <div className="p-3.5" style={{ background: "var(--bg-surface)" }}>
          {!isRoster ? (
            <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
              This group has no list to keep. Its membership is whatever Zoho says today, so correcting somebody&rsquo;s
              site in <strong style={{ color: "var(--text-secondary)" }}>People</strong> is what moves them in or out
              of this report.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {draft.length === 0 && (
                  <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>Nobody on this list yet.</span>
                )}
                {draft.map((email) => {
                  const p = byEmail.get(email);
                  return (
                    <Tooltip key={email} width={p ? undefined : 200}
                      label={p ? email : `${email} (not in the employee list, so this row scores nothing)`}>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md border"
                        style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                        {p?.full_name || email.split("@")[0]}
                        {!p && <span className="text-amber-500">!</span>}
                        {canEdit && (
                          <button onClick={() => setDraft(draft.filter((e) => e !== email))}
                            className="opacity-50 hover:opacity-100" aria-label={`Remove ${email}`}>
                            <Trash2 size={10} />
                          </button>
                        )}
                      </span>
                    </Tooltip>
                  );
                })}
              </div>

              {canEdit && (
                <div className="relative mb-3 max-w-md">
                  <Field value={add} onChange={setAdd} placeholder="Add somebody by name or email" />
                  {suggestions.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg border overflow-hidden"
                      style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", boxShadow: "var(--shadow-lg)" }}>
                      {suggestions.map((p) => (
                        <button key={p.email} onClick={() => { setDraft([...draft, p.email].sort()); setAdd(""); }}
                          className="w-full text-left px-3 py-2 text-[12px] hover:bg-[var(--bg-surface-hover)]"
                          style={{ color: "var(--text-primary)" }}>
                          {p.full_name || p.email.split("@")[0]}
                          <span className="ml-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>{p.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Btn tone="primary" disabled={!canEdit || !dirty || pending || draft.length === 0}
                  title={draft.length === 0 ? "An empty roster is refused: it would silently empty the report" : undefined}
                  tipWidth={200}
                  onClick={() => run(() => setRoster(group.key, draft), `${group.name} roster saved`, reload)}>
                  {pending ? <Loader2 size={11} className="animate-spin" /> : null}
                  Save list{dirty ? ` (${draft.length})` : ""}
                </Btn>
                {dirty && <Btn onClick={() => setDraft(group.roster)}>Discard changes</Btn>}
                {group.key === "managers" && (
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    Rebuilt from the Slack channel nightly. Run <strong style={{ color: "var(--text-secondary)" }}>Directory sync</strong> under Jobs to refresh it now.
                  </span>
                )}
              </div>
              <Feedback error={error} done={done} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 5. Jobs ────────────────────────────────────────────────────────────────

/**
 * What is scheduled, read from pg_cron itself rather than from a list in the
 * code, plus a way to run one now.
 *
 * Running one by hand is for recovery, not routine: these are the same
 * functions cron calls, so a second prompt run will not double-DM anybody
 * (the row is written before the message) but a summary send is a real send.
 * The ones that are safe to repeat say so; the one that is not asks first.
 */
const RUNNABLE: { id: Parameters<typeof runJob>[0]; label: string; what: string; risky?: boolean }[] = [
  { id: "directory", label: "Directory sync",  what: "Retire Slack-deactivated people and rebuild the Managers roster from the Slack channel." },
  { id: "prompt",    label: "Send prompts",    what: "Ask today's attendance question. Already-answered people are skipped." },
  { id: "verify",    label: "Verify prompts",  what: "Check everyone who should have been asked today actually was, and alert if not." },
  { id: "remind",    label: "Send reminders",  what: "Re-ask the people still pending, after re-checking Slack rather than trusting the morning's list." },
  { id: "leave",     label: "Pull Zoho leave", what: "Mark approved leave from Zoho so those days leave the denominator." },
  { id: "zoho-push", label: "Push to Zoho",    what: "Send yesterday's attendance to Zoho People. Already-pushed days are skipped." },
  { id: "summary",   label: "Fortnightly summary", what: "Post the fortnightly report to Slack. This is a real send and it moves the snapshot number.", risky: true },
];

function JobsSection({ jobs, canEdit }: { jobs: JobRow[]; canEdit: boolean }) {
  return (
    <SectionCard
      icon={<PlayCircle size={18} />}
      title="Scheduled jobs"
      subtitle="The schedule is read from pg_cron itself, so this is what is actually set rather than what the code believes. Running one by hand is for recovery.">
      {jobs.length > 0 && (
        <div className="mb-4 rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "var(--bg-surface-secondary)" }}>
              <tr><Th>Scheduled job</Th><Th>Cron (UTC)</Th><Th className="w-20">State</Th></tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <Row key={j.jobname}>
                  <td className="py-2 px-3 text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{j.jobname}</td>
                  <td className="py-2 px-3 text-[12px] font-mono" style={{ color: "var(--text-muted)" }}>{j.schedule}</td>
                  <td className="py-2 px-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold"
                      style={j.active
                        ? { background: "rgba(16,185,129,0.12)", color: "#10b981" }
                        : { background: "var(--bg-inset)", color: "var(--text-muted)" }}>
                      {j.active ? "active" : "paused"}
                    </span>
                  </td>
                </Row>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {RUNNABLE.map((j) => <JobCard key={j.id} job={j} canEdit={canEdit} />)}
      </div>
    </SectionCard>
  );
}

function JobCard({ job, canEdit }: { job: typeof RUNNABLE[number]; canEdit: boolean }) {
  const { run, pending, error } = useAction();
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const go = () => {
    setResult(null);
    setConfirming(false);
    run(async () => {
      const r = await runJob(job.id) as
        { ok: boolean; error?: string; status?: number; body?: string };
      // Two different failures. `ok:false` is the action itself refusing — not
      // signed in, read-only, unknown job. A `status` outside 2xx is the job
      // having run and come back unhappy, and its body is the useful part.
      if (!r.ok) throw new Error(r.error || "Could not run the job");
      const okStatus = typeof r.status === "number" && r.status >= 200 && r.status < 300;
      setResult(okStatus ? r.body || "Done" : `HTTP ${r.status}: ${r.body ?? ""}`);
      if (!okStatus) throw new Error(`The job returned HTTP ${r.status}`);
    }, "Finished");
  };

  return (
    <div className="p-3.5 rounded-xl border" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
          {job.label}
          {job.risky && <AlertTriangle size={11} className="text-amber-500" />}
        </div>
        {confirming ? (
          <div className="flex gap-1 flex-shrink-0">
            <Btn tone="danger" onClick={go} disabled={pending}>Send it</Btn>
            <Btn onClick={() => setConfirming(false)}>No</Btn>
          </div>
        ) : (
          <Btn disabled={!canEdit || pending} onClick={() => (job.risky ? setConfirming(true) : go())}>
            {pending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Run now
          </Btn>
        )}
      </div>
      <p className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>{job.what}</p>
      {error && <div className="text-[10px] mt-2" style={{ color: "#ef4444" }}>{error}</div>}
      {result && (
        <pre className="mt-2 p-2 rounded-lg text-[10px] font-mono overflow-auto max-h-28 whitespace-pre-wrap break-all"
          style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}>{result}</pre>
      )}
    </div>
  );
}

/**
 * How long ago the Slack directory sync last ran.
 *
 * This list drops accounts the sync has stopped seeing, which is how a
 * deactivated account disappears from it. The flip side is that a STALLED sync
 * would also make the list shrink, and it would look like good news. Showing
 * the age means a stall reads as a stall.
 */
function SyncAge({ at }: { at: string | null }) {
  if (!at) return null;
  const hours = (Date.now() - new Date(at).getTime()) / 3_600_000;
  const stale = hours > 36;
  const when = hours < 1 ? "just now"
    : hours < 24 ? `${Math.round(hours)}h ago`
    : `${Math.round(hours / 24)}d ago`;
  return (
    <Tooltip width={230} side="bottom" label={
      stale
        ? `The Slack directory sync last ran ${when}. Until it runs, leavers stay on this list and new joiners are missing from it.`
        : `Slack directory synced ${when}. Accounts it has stopped seeing are treated as deactivated and left off this list.`}>
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold"
        style={stale
          ? { background: "rgba(245,158,11,0.12)", color: "#f59e0b" }
          : { background: "var(--bg-inset)", color: "var(--text-muted)" }}>
        {stale && <AlertTriangle size={10} />}
        Slack synced {when}
      </span>
    </Tooltip>
  );
}
