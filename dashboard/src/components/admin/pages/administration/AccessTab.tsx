"use client";

import { Users } from "lucide-react";
import { C, Avatar, Button, Card, Item, LinkButton, Pill, Stagger } from "@/components/ui";
import { useAdmin } from "../../context";
import { ArrowRight } from "lucide-react";

export default function AccessTab() {
  const { admin, employees, viewer, openDialog } = useAdmin();
  const admins = admin?.admins ?? [];
  const editors = admins.filter((a) => a.can_edit).length;
  const managers = admins.filter((a) => a.can_manage_access).length;
  const nameOf = (email: string) => employees.find((e) => e.email === email)?.name || admin?.people.find((p) => p.email === email)?.full_name || email.split("@")[0];

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-[26px] font-semibold tracking-tight">Admin access</h2>
          <p className="text-[13px] mt-2.5" style={{ color: C.muted }}>{admins.length} {admins.length === 1 ? "admin" : "admins"} {"·"} {editors} {editors === 1 ? "editor" : "editors"} {"·"} {admins.length - editors} {admins.length - editors === 1 ? "viewer" : "viewers"}{managers > 0 ? <> {"·"} {managers} {managers === 1 ? "workspace admin" : "workspace admins"}</> : null}</p>
        </div>
        {viewer.canManageAccess && <Button onClick={() => openDialog({ type: "grant" })}><Users size={16} /> Add administrator</Button>}
      </div>

      <Stagger className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {admins.map((a) => {
          const name = nameOf(a.email);
          const you = a.email === viewer.email;
          return (
            <Item key={a.email}>
              <Card className="!p-6 h-full flex flex-col">
                <div className="flex items-start gap-4">
                  <Avatar name={name} size={44} />
                  <div className="min-w-0">
                    <div className="text-[19px] font-semibold truncate">{name}</div>
                    <div className="text-[12px] truncate mt-1" style={{ color: C.muted }}>{a.email}</div>
                    <div className="mt-3"><Pill color={a.can_edit ? C.primary : C.text2} bg={a.can_edit ? C.selected : C.inset}>{a.can_edit ? "Editor" : "Viewer"}{a.can_manage_access ? " · Workspace admin" : ""}{you ? " · You" : ""}</Pill></div>
                  </div>
                </div>
                <p className="text-[13px] mt-5" style={{ color: C.text2 }}>{a.can_edit ? "View all people and edit records" : "View all people; no editing"}{a.can_manage_access && !a.can_edit ? "; manages admin access" : ""}</p>
                {a.note && <p className="text-[12px] mt-2" style={{ color: C.muted }}>{a.note}</p>}
                <div className="mt-auto pt-5"><div className="pt-5" style={{ borderTop: `1px solid ${C.border}` }}>
                  {viewer.canManageAccess ? <LinkButton onClick={() => openDialog({ type: "access", email: a.email })}>Manage access <ArrowRight size={13} /></LinkButton>
                    : <span className="text-[12px]" style={{ color: C.muted }}>Needs an editor or workspace admin</span>}
                </div></div>
              </Card>
            </Item>
          );
        })}
      </Stagger>

      <Card tone="tint" className="mt-8 !p-7">
        <h2 className="text-[22px] font-semibold tracking-tight">Viewing and editing are separate permissions.</h2>
        <p className="text-[13px] mt-4" style={{ color: C.text2 }}>Viewers can explore all attendance. Editors can correct days, manage people, change rosters and run operations. Workspace admins can add and remove viewers without editing records. Giving or taking away editing stays with editors, who can also manage access.</p>
        <p className="text-[13px] mt-3" style={{ color: C.text2 }}>You cannot remove your own access. At least one editor must remain.</p>
      </Card>
    </>
  );
}
