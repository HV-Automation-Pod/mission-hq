"use client";

import { Lock } from "lucide-react";
import { C } from "@/components/ui";

export function PageHead({ crumb, title, sub, aside }: { crumb?: string; title: string; sub: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-6 lg:mb-8 flex items-start justify-between gap-4">
      <div>
        {crumb && <div className="text-[11px] tracking-[0.14em] mb-3" style={{ color: C.muted }}>{crumb}</div>}
        <h1 className="text-[34px] lg:text-[32px] font-semibold leading-tight tracking-tight">{title}</h1>
        <p className="text-[14px] mt-2 max-w-[560px]" style={{ color: C.text2 }}>{sub}</p>
      </div>
      {aside}
    </div>
  );
}

export const PersonalChip = () => (
  <span className="hidden lg:inline-flex items-center gap-2 text-[12px] px-3 h-8 rounded-full flex-shrink-0" style={{ background: C.inset, color: C.muted }}>
    <Lock size={12} /> Personal view
  </span>
);
