"use client";

import { useMemo } from "react";
import { ArrowRight, Bell, Clock } from "lucide-react";
import { C, Button, Card, Item, LinkButton, Stagger } from "@/components/ui";
import type { JobRow } from "@/lib/domain/access-types";
import { useAdmin } from "../../context";

/** The routines an editor may run by hand, and what each one does. */
export const OPERATIONS: { id: "directory" | "leave" | "prompt" | "verify" | "remind" | "zoho-push" | "summary"; title: string; what: string; audience: string }[] = [
  { id: "directory", title: "Directory sync", what: "Refresh employees and retire inactive accounts.", audience: "Everyone in the Slack directory" },
  { id: "leave", title: "Pull Zoho leave", what: "Bring approved time off into attendance.", audience: "People with approved leave in Zoho" },
  { id: "prompt", title: "Send prompts", what: "Ask today’s attendance question.", audience: "Everyone prompted who has not been asked today" },
  { id: "verify", title: "Verify prompts", what: "Check everyone eligible was asked.", audience: "Everyone prompted today" },
  { id: "remind", title: "Send reminders", what: "Re-ask people still waiting after a fresh check.", audience: "People whose check-in is still unanswered" },
  { id: "zoho-push", title: "Push to Zoho", what: "Sync eligible attendance updates.", audience: "Answers not yet sent to Zoho" },
  { id: "summary", title: "Fortnightly summary", what: "Posts a real report to Slack and advances the snapshot.", audience: "Each active report group's channel" },
];

const DOW: Record<string, string> = { "1-5": "Weekdays", "*": "Daily", "1": "Mondays", "5": "Fridays" };

/** "30 8 * * 1-5" (UTC) as "Weekdays 14:00 IST". Anything unusual is shown as it is. */
export function scheduleText(cron: string): string {
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  if (![m, h].every((x) => /^\d+$/.test(x ?? "")) || dom !== "*" || mon !== "*") return `${cron} (UTC)`;
  const total = (Number(h) * 60 + Number(m) + 330) % (24 * 60);
  const when = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")} IST`;
  return `${DOW[dow] ?? `Days ${dow}`} · ${when}`;
}

export function schedulesFor(id: string, jobs: JobRow[]): JobRow[] {
  return jobs.filter((j) => j.jobname === `mission-hq-${id}` || j.jobname.startsWith(`mission-hq-${id}-`));
}

export default function OperationsTab() {
  const { admin, openDialog } = useAdmin();
  const jobs = admin?.jobs ?? [];
  const paused = jobs.filter((j) => !j.active).length;
  const summary = OPERATIONS.find((o) => o.id === "summary")!;

  const cards = useMemo(() => OPERATIONS.filter((o) => o.id !== "summary"), []);

  return (
    <>
      <Card tone="tint" className="!p-6 flex items-start gap-4">
        <span style={{ color: C.primary }} aria-hidden><Clock size={22} /></span>
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight">{jobs.length === 0 ? "Schedules could not be read" : paused > 0 ? `${paused} ${paused === 1 ? "schedule is" : "schedules are"} paused` : "Schedules active"}</h2>
          <p className="text-[13px] mt-2" style={{ color: C.text2 }}>Times below are shown in IST. Check a run&apos;s result before treating it as successful.</p>
        </div>
      </Card>

      <Stagger className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
        {cards.map((o) => {
          const sched = schedulesFor(o.id, jobs);
          return (
            <Item key={o.id}>
              <Card className="!p-6 h-full flex flex-col">
                <h2 className="text-[20px] font-semibold tracking-tight">{o.title}</h2>
                <p className="text-[13px] mt-3" style={{ color: C.text2 }}>{o.what}</p>
                <p className="text-[12px] mt-5" style={{ color: sched.some((s) => !s.active) ? C.warn : C.muted }}>
                  {sched.length === 0 ? "Schedule from service" : sched.map((s) => `${scheduleText(s.schedule)}${s.active ? "" : " (paused)"}`).join("  ·  ")}
                </p>
                <div className="mt-auto pt-4 flex justify-end"><LinkButton onClick={() => openDialog({ type: "operation", job: o.id })}>Review run <ArrowRight size={13} /></LinkButton></div>
              </Card>
            </Item>
          );
        })}
      </Stagger>

      <Card className="mt-6 !p-6 flex flex-col sm:flex-row sm:items-center gap-5">
        <span style={{ color: C.warn }} aria-hidden><Bell size={22} /></span>
        <div className="flex-1">
          <h2 className="text-[20px] font-semibold tracking-tight">{summary.title}</h2>
          <p className="text-[13px] mt-2" style={{ color: C.text2 }}>{summary.what} Review before sending.</p>
        </div>
        <Button variant="outline" onClick={() => openDialog({ type: "operation", job: "summary" })}>Review send</Button>
      </Card>
    </>
  );
}
