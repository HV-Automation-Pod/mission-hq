"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export interface SelectItem {
  value: string;
  label: string;
  sub?: string;
}

interface Props {
  items: SelectItem[];
  value: string;
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  placeholder?: string;
  active?: boolean;
  buttonLabel?: string;
  ariaLabel?: string;
  className?: string;
  align?: "left" | "right";
  searchable?: boolean;
  searchPlaceholder?: string;
  footer?: React.ReactNode;
}

export function CustomSelect({
  items,
  value,
  onChange,
  icon,
  placeholder = "Select…",
  active,
  buttonLabel,
  ariaLabel,
  className,
  align = "left",
  searchable,
  searchPlaceholder = "Search…",
  footer,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = items.find((i) => i.value === value);
  const displayLabel = buttonLabel ?? selected?.label ?? placeholder;

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter((i) =>
      i.label.toLowerCase().includes(q) ||
      i.value.toLowerCase().includes(q) ||
      (i.sub?.toLowerCase().includes(q) ?? false)
    );
  }, [items, query, searchable]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const idx = filtered.findIndex((i) => i.value === value);
    const target = idx >= 0 ? idx : 0;
    setHighlighted(target);
    requestAnimationFrame(() => {
      if (searchable) searchRef.current?.focus();
      const el = menuRef.current?.querySelector(`[data-idx="${target}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest" });
    });
  }, [open, value, filtered, searchable]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlighted(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlighted(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[highlighted];
      if (item) {
        onChange(item.value);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="flex items-center gap-2 pl-3 pr-2.5 py-2 text-[13px] border rounded-lg cursor-pointer focus:outline-none transition-all"
        style={{
          background: active ? "var(--accent-light)" : "var(--bg-surface-secondary)",
          borderColor: active ? "var(--accent-muted)" : "var(--border-default)",
          color: "var(--text-primary)",
        }}
      >
        {icon && <span className="flex-shrink-0" style={{ color: "var(--text-muted)" }}>{icon}</span>}
        <span className="truncate font-medium">{displayLabel}</span>
        <ChevronDown
          size={12}
          className="flex-shrink-0 transition-transform"
          style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute top-full mt-1.5 z-40 min-w-full rounded-lg flex flex-col"
          style={{
            [align === "right" ? "right" : "left"]: 0,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-lg)",
            minWidth: 220,
          }}
        >
          {searchable && (
            <div className="relative p-1.5 border-b" style={{ borderColor: "var(--border-subtle)" }}>
              <Search size={11} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-7 pr-7 py-1.5 text-[12px] rounded-md focus:outline-none"
                style={{
                  background: "var(--bg-inset)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(""); searchRef.current?.focus(); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: "var(--text-faint)" }}
                  aria-label="Clear search"
                >
                  <X size={9} className="text-white" />
                </button>
              )}
            </div>
          )}

          <div ref={menuRef} className="p-1 overflow-y-auto scrollbar-thin" style={{ maxHeight: 280 }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-center" style={{ color: "var(--text-muted)" }}>
                {query ? `No matches for "${query}"` : "No options"}
              </div>
            ) : (
              filtered.map((item, i) => {
                const isSelected = item.value === value;
                const isHighlighted = i === highlighted;
                return (
                  <button
                    key={item.value}
                    data-idx={i}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => { onChange(item.value); setOpen(false); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-[12.5px] rounded-md text-left transition-colors"
                    style={{
                      background: isHighlighted ? "var(--accent-light)" : "transparent",
                      color: isSelected ? "var(--accent)" : "var(--text-primary)",
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >
                    <Check size={12} className="flex-shrink-0" style={{ opacity: isSelected ? 1 : 0, color: "var(--accent)" }} />
                    <div className="flex-1 min-w-0 flex items-baseline gap-2">
                      <span className="truncate">{item.label}</span>
                      {item.sub && <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: "var(--text-muted)" }}>{item.sub}</span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {footer && (
            <div className="px-3 py-1.5 border-t text-[10.5px]" style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}>
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
