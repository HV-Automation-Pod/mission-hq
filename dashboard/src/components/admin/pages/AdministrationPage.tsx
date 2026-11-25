"use client";

import { C, focusRing } from "@/components/ui";
import { useAdmin, type AdminTab } from "../context";
import { ErrorState, PageHeading } from "../ui";
import { AdminLoadingBody } from "../AdminLoading";
import AccessTab from "./administration/AccessTab";
import DirectoryTab from "./administration/DirectoryTab";
import GroupsTab from "./administration/GroupsTab";
import OperationsTab from "./administration/OperationsTab";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "access", label: "Access" }, { id: "directory", label: "Directory" }, { id: "groups", label: "Report groups" }, { id: "operations", label: "Operations" },
];

const HEADINGS: Record<AdminTab, { title: string; sub: string }> = {
  access: { title: "Administration", sub: "Manage the people, connections and routines that keep MissionHQ accurate." },
  directory: { title: "Directory reconciliation", sub: "Review Slack accounts that do not have a matching Zoho employee record." },
  groups: { title: "Report groups", sub: "Control who is included in each fortnightly report without changing their department." },
  operations: { title: "Operations", sub: "Review scheduled routines and recover a missed run when needed." },
};

export default function AdministrationPage() {
  const { route, go, admin, adminError, reloadAdmin } = useAdmin();
  const h = HEADINGS[route.tab];

  return (
    <>
      <PageHeading title={h.title} sub={h.sub} />
      <div role="tablist" aria-label="Administration" className="flex flex-wrap gap-3 mb-7">
        {TABS.map((t) => {
          const on = route.tab === t.id;
          return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => go({ page: "administration", tab: t.id })}
              className={`relative h-11 px-6 rounded-[10px] text-[14px] font-medium transition-colors ${focusRing}`}
              style={{ background: on ? C.selected : C.surface, color: on ? C.primary : C.text2, border: `1px solid ${on ? "#BFDAD5" : C.border}` }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {adminError ? <ErrorState message={adminError} onRetry={reloadAdmin} />
        : !admin ? <AdminLoadingBody page="administration" />
        : (
          // No wrapper fade: AccessTab, GroupsTab and OperationsTab already
          // stagger their own cards in, and a fade-out/fade-in around that
          // made the tab blink empty and then animate twice.
          <div key={route.tab}>
            {route.tab === "access" ? <AccessTab /> : route.tab === "directory" ? <DirectoryTab /> : route.tab === "groups" ? <GroupsTab /> : <OperationsTab />}
          </div>
        )}
    </>
  );
}
