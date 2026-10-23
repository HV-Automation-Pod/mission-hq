"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Info } from "lucide-react";
import { C, Button, LinkButton, ModalHeader, Pill, Select } from "@/components/ui";
import { runJob } from "@/lib/actions/operations";
import { useAdmin } from "../context";
import { OPERATIONS, schedulesFor, scheduleText } from "../pages/administration/OperationsTab";

type Result = { ok: boolean; status?: number; text: string };

const HEADLINE: Record<string, string> = {
  directory: "Refresh the Slack directory", leave: "Pull approved leave from Zoho", prompt: "Send today’s prompts", verify: "Verify everyone was asked",
  remind: "Re-check people still waiting", "zoho-push": "Push answers to Zoho", summary: "This will post to Slack.",
};
const DETAIL: Record<string, string[]> = {
  directory: ["Retires accounts Slack has deactivated and rebuilds the Managers roster.", "Changes who can be prompted from the next run."],
  leave: ["Marks approved Zoho leave on the attendance record.", "Those days leave the score’s denominator."],
  prompt: ["Asks today’s attendance question in Slack.", "People who have already been asked or answered are skipped."],
  verify: ["Checks that everyone who should have been asked today was.", "Posts an alert only if somebody was missed."],
  remind: ["The routine checks Slack again before sending.", "People who have already answered are skipped.", "The final audience can change since this preview."],
  "zoho-push": ["Sends eligible answers to Zoho People.", "Answers already pushed are skipped."],
  summary: ["The report goes to each active group’s configured channel.", "It also advances the report snapshot."],
};

export default function OperationDialog({ initialJob, onClose }: { initialJob?: string; onClose: () => void }) {
  const { viewer, admin, employees, today, go, notify } = useAdmin();
  const [job, setJob] = useState(initialJob && OPERATIONS.some((o) => o.id === initialJob) ? initialJob : "remind");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const op = OPERATIONS.find((o) => o.id === job)!;
  const isSummary = job === "summary";

  const waiting = useMemo(() => employees.filter((e) => e.statuses[today] === "Pending").length, [employees, today]);
  const groups = admin?.groups.filter((g) => g.active) ?? [];
  const sched = schedulesFor(job, admin?.jobs ?? []);

  const run = async () => {
    setRunning(true); setResult(null);
    const r = await runJob(op.id);
    setRunning(false);
    if (!r.ok) { setResult({ ok: false, text: r.error }); notify(`${op.title} did not run`, "error"); return; }
    const status = r.status as number;
    const ok = status >= 200 && status < 300;
    setResult({ ok, status, text: String(r.body ?? "") });
    notify(ok ? `${op.title} finished` : `${op.title} returned HTTP ${status}`, ok ? "ok" : "error");
  };

  return (
    <div>
      <ModalHeader eyebrow="OPERATIONS" title={isSummary ? "Review operation" : "Run an operation"} onClose={onClose} />
      {!isSummary && <p className="text-[13px] -mt-3 mb-6" style={{ color: C.text2 }}>Choose the routine you need to recover, then review its scope.</p>}

      {!isSummary && <Select label="Operation" value={job} onChange={(v) => { setJob(v); setResult(null); }} options={OPERATIONS.filter((o) => o.id !== "summary").map((o) => ({ value: o.id, label: o.title }))} />}

      <div className="mt-5">
        {isSummary ? <Pill color={C.warn} bg={C.warnSoft}>Fortnightly summary</Pill> : <Pill color={C.primary} bg={C.selected}>Preview {"·"} Today, {format(parseISO(today), "d MMMM")}</Pill>}
      </div>
      <h3 className="text-[24px] font-semibold tracking-tight mt-6">{HEADLINE[job]}</h3>
      <div className="mt-4 space-y-1 text-[14px]" style={{ color: C.text2 }}>{DETAIL[job].map((l) => <p key={l}>{l}</p>)}</div>

      {isSummary ? (
        <div className="mt-6 space-y-4">
          <div><div className="text-[11px] tracking-[0.12em] mb-2" style={{ color: C.muted }}>PERIOD</div><div className="h-11 px-4 flex items-center rounded-[10px] text-[14px]" style={{ border: `1px solid ${C.border}` }}>Latest completed fortnight</div></div>
          <div><div className="text-[11px] tracking-[0.12em] mb-2" style={{ color: C.muted }}>AUDIENCE</div><div className="h-11 px-4 flex items-center rounded-[10px] text-[14px]" style={{ border: `1px solid ${C.border}` }}>{groups.length ? `${groups.length} active report ${groups.length === 1 ? "group" : "groups"}` : "Active report groups"}</div></div>
        </div>
      ) : (
        <p className="text-[12px] mt-4" style={{ color: C.muted }}>Audience: {op.audience}.{sched.length ? ` Scheduled ${sched.map((s) => scheduleText(s.schedule)).join(", ")}.` : ""}</p>
      )}

      <div className="mt-6 rounded-2xl p-5 flex items-start gap-3 text-[13px] leading-relaxed" style={isSummary ? { background: C.warnSoft, border: "1px solid #EBD9A8", color: C.text2 } : { background: C.selected, border: `1px solid ${C.border}`, color: C.text2 }}>
        <Info size={17} className="mt-0.5 flex-shrink-0" style={{ color: isSummary ? C.warn : C.primary }} />
        <div>
          {job === "remind" && <p>{waiting} currently unanswered {waiting === 1 ? "check-in" : "check-ins"}. Running this operation sends real Slack reminders.</p>}
          {job === "prompt" && <p>Running this operation sends real Slack messages to people who have not been asked today.</p>}
          {isSummary && <><p>Review group membership and report dates first.</p><p>Sending again can create another Slack post.</p></>}
          {!["remind", "prompt", "summary"].includes(job) && <p>This runs the same routine the schedule runs. It is safe to repeat; answered or already-synced items are skipped.</p>}
        </div>
      </div>
      {isSummary && <div className="mt-4"><LinkButton onClick={() => { onClose(); go({ page: "administration", tab: "groups" }); }}>Review report groups {"→"}</LinkButton></div>}

      {result && (
        <div role="status" className="mt-5 rounded-2xl p-5" style={result.ok ? { background: C.officeSoft, border: `1px solid ${C.office}33` } : { background: C.badSoft, border: `1px solid ${C.bad}33` }}>
          <div className="text-[14px] font-semibold" style={{ color: result.ok ? C.office : C.bad }}>
            {result.ok ? `The service returned HTTP ${result.status}.` : result.status ? `The service returned HTTP ${result.status}. Treat this run as failed.` : "The operation did not run."}
          </div>
          {result.text && <pre className="mt-3 text-[11px] whitespace-pre-wrap break-all max-h-40 overflow-auto" style={{ color: C.text2 }}>{result.text}</pre>}
        </div>
      )}
      <p className="text-[12px] mt-5" style={{ color: C.muted }}>A run result will show whether the service succeeded or failed.</p>

      <div className="flex items-center justify-between gap-4 mt-7">
        <Button variant="outline" onClick={onClose} disabled={running}>{result ? "Close" : "Cancel"}</Button>
        {!viewer.canEdit
          ? <span className="text-[12px]" style={{ color: C.muted }}>View only. An editor is needed to run operations.</span>
          : <Button className="min-w-[260px]" loading={running} disabled={!!result?.ok} onClick={run}>{isSummary ? "Send summary to Slack" : `Run ${op.title.toLowerCase()}`}</Button>}
      </div>
    </div>
  );
}
