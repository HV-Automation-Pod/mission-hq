"use client";

import { useMemo } from "react";
import { C, Button, Card, Item, Pill, Stagger } from "@/components/ui";
import { groupMembers } from "@/lib/domain/analytics";
import { useAdmin } from "../../context";
import { EmptyState } from "../../ui";

export default function GroupsTab() {
  const { admin, employees, people, viewer, openDialog } = useAdmin();
  const groups = useMemo(() => (admin?.groups ?? []).map((g) => ({ g, size: groupMembers(g, employees, people).length })), [admin, employees, people]);

  if (groups.length === 0) return <EmptyState title="No report groups" body="Report groups decide who appears in each fortnightly Slack report." />;
  const describe = (g: (typeof groups)[number]["g"]) => g.match_kind === "roster"
    ? "People selected by People & Culture"
    : `${(g.match_column ?? "Column").replace(/^./, (c) => c.toUpperCase())} = ${(g.match_values ?? []).join(", ") || "not set"}`;

  return (
    <>
      <Stagger className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {groups.map(({ g, size }) => (
          <Item key={g.key}>
            <Card className="!p-7 h-full flex flex-col">
              <h2 className="text-[26px] font-semibold tracking-tight">{g.name}</h2>
              <div className="mt-5"><Pill color={g.match_kind === "roster" ? C.primary : C.text2} bg={g.match_kind === "roster" ? C.selected : C.inset}>{g.match_kind === "roster" ? "Custom roster" : "From Zoho"}</Pill></div>
              <p className="text-[14px] mt-5" style={{ color: C.text2 }}>{describe(g)}</p>
              <div className="text-[34px] leading-none font-semibold tracking-tight mt-6">{size.toLocaleString()} {size === 1 ? "person" : "people"}</div>
              <p className="text-[12px] mt-4" style={{ color: C.muted }}>Fortnightly Slack report {"·"} {g.active ? "Active" : "Paused"}</p>
              <div className="mt-auto pt-6">
                {g.match_kind === "roster" && viewer.canEdit
                  ? <Button variant="outline" className="w-full" onClick={() => openDialog({ type: "roster", group: g.key })}>Edit roster</Button>
                  : <Button variant="outline" className="w-full" onClick={() => openDialog({ type: "members", group: g.key })}>View members</Button>}
              </div>
            </Card>
          </Item>
        ))}
      </Stagger>
      <Card tone="tint" className="mt-8 !p-7">
        <h2 className="text-[22px] font-semibold tracking-tight">Department data stays in Zoho. Report groups can overlap.</h2>
        <p className="text-[13px] mt-4" style={{ color: C.text2 }}>Custom rosters must keep at least one member. Use the group detail to review the audience before saving.</p>
      </Card>
    </>
  );
}
