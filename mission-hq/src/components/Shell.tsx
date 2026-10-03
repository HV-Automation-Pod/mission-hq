import Link from "next/link";
import { SignOut } from "./SignOut";
import type { Viewer } from "@/lib/session";

const NAV = [
  { href: "/", label: "Today" },
  { href: "/people", label: "People" },
  { href: "/reports", label: "Reports" },
  { href: "/health", label: "Health" },
];

/**
 * The frame. Deliberately plain: this is a tool somebody opens to answer a
 * question, not a product to explore, so the chrome stays out of the way and
 * the page owns the screen.
 */
export function Shell({
  viewer,
  current,
  title,
  subtitle,
  actions,
  children,
}: {
  viewer: Viewer;
  current: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border sticky top-0 z-20 bg-bg/85 backdrop-blur">
        <div className="mx-auto max-w-[1180px] px-5 h-14 flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <span className="h-6 w-6 rounded-[7px] bg-accent grid place-items-center">
              <span className="text-accent-text text-[11px] font-semibold">M</span>
            </span>
            <span className="font-semibold text-[15px] tracking-[-0.01em]">MissionHQ</span>
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto">
            {NAV.map((item) => {
              const active = current === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`px-3 h-8 inline-flex items-center rounded-[7px] text-sm transition ${
                    active ? "bg-surface-2 text-text font-medium" : "text-text-2 hover:text-text"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3 shrink-0">
            <span className="text-text-3 text-xs hidden sm:block">{viewer.email}</span>
            <SignOut />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-8">
        <div className="flex items-start gap-4 mb-6">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] leading-tight">{title}</h1>
            {subtitle && <p className="text-text-2 text-sm mt-1">{subtitle}</p>}
          </div>
          {actions && <div className="ml-auto shrink-0">{actions}</div>}
        </div>
        {children}
      </main>
    </div>
  );
}
