import { BrandMark } from "@/components/BrandMark";
import { redirect } from "next/navigation";
import { CalendarCheck, History, ShieldCheck } from "lucide-react";
import { getViewer, supabaseServer } from "@/lib/session";
import { SignIn } from "./SignIn";

export const metadata = { title: "Sign in · MissionHQ" };

/**
 * Three states, and they are deliberately different screens.
 *
 * Signed out, signed in but not allowed, and allowed. The middle one is the
 * one that matters: somebody with a company Google account who is not on the
 * allowlist has done nothing wrong and should be told plainly who to ask,
 * rather than being bounced back to a sign-in button that will keep working.
 *
 * Layout: a brand panel beside the form. The copy is deliberately about the
 * product, not about a role, because admins and members both land here.
 */
const FEATURES = [
  { Icon: CalendarCheck, title: "Daily check-ins", body: "One quick answer each morning, in Slack or here." },
  { Icon: ShieldCheck, title: "Measured against the policy", body: "Attendance scored the same way everywhere." },
  { Icon: History, title: "One up-to-date record", body: "Every day, every status, in a single view." },
];

const mono = { fontFamily: "var(--font-mono), ui-monospace, Menlo, monospace" } as const;

function Mark({ size = 38 }: { size?: number }) {
  return <BrandMark size={size} />;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const viewer = await getViewer();
  if (viewer) redirect(next || "/");

  // Anybody signed in with a non-company account. They are not "blocked from
  // MissionHQ" so much as signed into the wrong Google account, which is a
  // different problem and needs a different instruction.
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const wrongAccount = data.user?.email ?? null;

  return (
    <main className="min-h-dvh w-full grid lg:grid-cols-[1.05fr_1fr]">
      {/* ── Brand panel. Always dark, in MissionHQ's own indigo and violet. ── */}
      <aside className="relative hidden lg:flex flex-col justify-between p-14 overflow-hidden text-white"
        style={{ background: "radial-gradient(at 0% 0%, #1e1b4b 0%, #12112e 55%, #0a0d14 100%)" }}>
        <div aria-hidden className="pointer-events-none absolute -left-32 -top-24 h-[520px] w-[520px] rounded-full"
          style={{ background: "radial-gradient(closest-side, #6366f1 0%, transparent 70%)", opacity: 0.32, filter: "blur(8px)" }} />
        <div aria-hidden className="pointer-events-none absolute -right-32 -bottom-32 h-[440px] w-[440px] rounded-full"
          style={{ background: "radial-gradient(closest-side, #8b5cf6 0%, transparent 70%)", opacity: 0.22, filter: "blur(12px)" }} />

        <header className="relative z-10 flex items-center gap-3">
          <Mark />
          <span className="text-[17px] font-bold tracking-tight">MissionHQ</span>
        </header>

        <div className="relative z-10 max-w-lg">
          <div className="flex items-center gap-3 mb-4 text-[11px] uppercase tracking-[0.3em]" style={{ ...mono, color: "rgba(255,255,255,0.55)" }}>
            <span className="inline-block h-px w-7" style={{ background: "#818cf8" }} />
            HyperVerge attendance
          </div>
          <h1 className="font-semibold mb-4" style={{ fontSize: "clamp(36px, 4.4vw, 54px)", letterSpacing: "-0.025em", lineHeight: 1.08 }}>
            Every working day, in one place.
          </h1>
          <p className="text-[15px] leading-relaxed max-w-[440px]" style={{ color: "rgba(255,255,255,0.68)" }}>
            See where the team works, check it against the office policy, and keep the record straight.
          </p>

          <ul className="mt-9 space-y-5">
            {FEATURES.map(({ Icon, title, body }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "#a5b4fc" }}>
                  <Icon size={17} />
                </span>
                <span>
                  <span className="block text-[14px] font-semibold">{title}</span>
                  <span className="block text-[13px]" style={{ color: "rgba(255,255,255,0.6)" }}>{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <footer className="relative z-10 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em]" style={{ ...mono, color: "rgba(255,255,255,0.6)" }}>
          <span className="inline-block h-px w-7" style={{ background: "#818cf8" }} />
          People &amp; Culture team &middot; HyperVerge
        </footer>
      </aside>

      {/* ── Form panel. Follows the app theme. ── */}
      <section className="flex items-center justify-center px-6 py-12 lg:p-12" style={{ background: "var(--bg-surface)" }}>
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <Mark />
            <span className="text-[17px] font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>MissionHQ</span>
          </div>

          <div className="flex items-center gap-3 mb-3 text-[11px] uppercase tracking-[0.28em]" style={{ ...mono, color: "var(--text-muted)" }}>
            <span className="inline-block h-px w-6" style={{ background: "var(--text-muted)" }} />
            {wrongAccount ? "Wrong account" : "Sign in"}
          </div>

          {wrongAccount ? (
            <>
              <h2 className="font-semibold mb-2" style={{ fontSize: 30, letterSpacing: "-0.025em", lineHeight: 1.1, color: "var(--text-primary)" }}>
                Switch accounts.
              </h2>
              <p className="text-[14px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                You are signed in as{" "}
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{wrongAccount}</span>, which is not a
                HyperVerge account. Switch to your work Google account to continue.
              </p>
              <SignIn next={next} variant="switch" />
            </>
          ) : (
            <>
              <h2 className="font-semibold mb-2" style={{ fontSize: 30, letterSpacing: "-0.025em", lineHeight: 1.1, color: "var(--text-primary)" }}>
                Welcome back.
              </h2>
              <p className="text-[14px] mb-8" style={{ color: "var(--text-secondary)" }}>
                Use your HyperVerge Google account to continue.
              </p>
              <SignIn next={next} variant="primary" />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
