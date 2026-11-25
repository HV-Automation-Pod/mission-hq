"use client";

import { useId } from "react";
import { Search } from "lucide-react";
import { C, focusRing } from "./theme";

/** Form fields in the design's shape. Text inputs only: dropdowns and dates have their own components. */

export function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="block text-[11px] tracking-[0.12em] uppercase mb-2" style={{ color: C.muted }}>{children}</label>;
}

export const controlStyle: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, minHeight: 44, color: C.text };

/** A single-line input. Browser autofill history is switched off: it is not our dropdown. */
export function TextInput({ value, onChange, label, id, placeholder, maxLength, invalid = false, autoFocus, className = "", hideLabel = false }: {
  value: string; onChange: (v: string) => void; label: string; id?: string; placeholder?: string; maxLength?: number;
  invalid?: boolean; autoFocus?: boolean; className?: string; hideLabel?: boolean;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={className}>
      {hideLabel ? <label htmlFor={fid} className="sr-only">{label}</label> : <FieldLabel htmlFor={fid}>{label}</FieldLabel>}
      <input id={fid} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} autoFocus={autoFocus}
        autoComplete="off" spellCheck={false} aria-invalid={invalid || undefined}
        className={`w-full h-11 px-4 text-[14px] ${focusRing}`} style={{ ...controlStyle, borderColor: invalid ? C.bad : C.border }} />
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, label, id, className = "" }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string; id?: string; className?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={className}>
      <FieldLabel htmlFor={fid}>{label}</FieldLabel>
      <div className="relative">
        <input id={fid} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false}
          className={`w-full h-11 pl-4 pr-10 text-[14px] ${focusRing}`} style={controlStyle} />
        <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.muted }} />
      </div>
    </div>
  );
}

export function TextArea({ value, onChange, placeholder, label, id, rows = 3, invalid = false }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label: string; id?: string; rows?: number; invalid?: boolean;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div>
      <FieldLabel htmlFor={fid}>{label}</FieldLabel>
      <textarea id={fid} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        autoComplete="off" spellCheck={false} aria-invalid={invalid || undefined}
        className={`w-full px-4 py-3 text-[14px] resize-none ${focusRing}`} style={{ ...controlStyle, minHeight: 0, borderColor: invalid ? C.bad : C.border }} />
    </div>
  );
}

/** An on/off switch, drawn by us rather than a checkbox. */
export function Switch({ checked, onChange, label, children }: { checked: boolean; onChange: (v: boolean) => void; label: string; children?: React.ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-3 h-10 pl-1.5 pr-4 rounded-full text-[12px] font-medium transition-colors ${focusRing}`}
      style={{ background: checked ? C.selected : C.inset, color: checked ? C.primary : C.text2 }}>
      <span className="w-7 h-7 rounded-full flex items-center transition-colors" style={{ background: checked ? C.primary : "#C3D0CC", padding: 3, justifyContent: checked ? "flex-end" : "flex-start" }}>
        <span className="w-[22px] h-[22px] rounded-full bg-white" />
      </span>
      {children}
    </button>
  );
}
