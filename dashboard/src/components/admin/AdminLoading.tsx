"use client";

import { C, Bone } from "@/components/ui";
import { Lock } from "lucide-react";
import { AdminShell, type Access } from "./AdminShell";
import type { AdminPage } from "./context";

/**
 * The admin workspace while it loads: the real frame, with grey blocks where the
 * content will land, so nothing rearranges when it does.
 *
 * No numbers, no zeros. A placeholder is not a result, and a metric card that
 * said 0 for a second would be read as "nobody checked in".
 *
 * The permission card says "Checking access" until the viewer is known (the
 * design shows "Can view and edit" here, but showing an editor shell before
 * permissions are known is exactly what the guide rules out). Once the payload
 * has arrived `access` is real and the same screen is reused while the admin
 * data loads.
 */
function Box({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl p-6 ${className}`} style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "var(--shadow-xs), var(--shadow-sm)" }}>{children}</div>;
}

/** Just the content area, for use inside a shell that is already on screen. */
export function AdminLoadingBody({ page = "overview" }: { page?: AdminPage }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Getting your workspace ready</span>
      <div className="mb-7 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight tracking-tight">Getting your workspace ready</h1>
          <p className="text-[14px] mt-3" style={{ color: C.text2 }}>
            {page === "people" ? "Loading people and their records." : "Loading attendance, people and department summaries."}
          </p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-2 text-[12px] px-3 h-8 rounded-full flex-shrink-0" style={{ background: C.selected, color: C.primary }}>
          <Lock size={12} /> Loading securely
        </span>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <Bone w={254} h={44} className="!rounded-[10px]" /><Bone w={220} h={44} className="!rounded-[10px]" /><Bone w={190} h={44} className="!rounded-[10px]" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Box key={i} className="!p-5"><Bone w="45%" h={11} /><Bone w={90} h={34} soft className="mt-5" /><Bone w="70%" h={9} soft className="mt-6" /></Box>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-6">
        <Box className="h-[316px]"><Bone w={240} h={20} /><Bone w="55%" h={9} soft className="mt-4" /><Bone h={36} soft className="mt-8 !w-full" />
          <div className="flex gap-8 mt-8">{Array.from({ length: 5 }, (_, i) => <div key={i} className="flex-1"><Bone w="60%" h={9} soft /><Bone w={44} h={26} soft className="mt-3" /></div>)}</div></Box>
        <Box className="h-[316px]"><Bone w={140} h={20} />{Array.from({ length: 3 }, (_, i) => <Bone key={i} h={44} soft className="mt-5 !w-full !rounded-[10px]" />)}</Box>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-6">
        <Box className="h-[300px]"><Bone w={200} h={20} />{Array.from({ length: 3 }, (_, i) => <div key={i} className="flex gap-6 mt-8"><Bone w={120} h={10} soft /><Bone h={10} soft className="flex-1" /></div>)}</Box>
        <Box className="h-[300px]"><Bone w={120} h={20} /><Bone w={140} h={30} soft className="mt-8 !rounded-full" /><Bone w="85%" h={9} soft className="mt-8" /><Bone w="60%" h={9} soft className="mt-3" /></Box>
      </div>
      <p className="text-[12px] mt-8" style={{ color: C.muted }}>Your latest records will appear here as soon as they are ready.</p>
    </div>
  );
}

/** The whole screen: used before the payload (so before permissions) is known. */
export default function AdminLoading({ access = "checking", name }: { access?: Access; name?: string }) {
  return (
    <AdminShell page="overview" access={access} name={name}>
      <AdminLoadingBody />
    </AdminShell>
  );
}
