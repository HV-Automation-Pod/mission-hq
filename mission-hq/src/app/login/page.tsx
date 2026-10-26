import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Building2, Check, CircleAlert, Home, type LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/ui";
import { getViewer, supabaseServer } from "@/lib/server/session";
import { SignIn } from "./SignIn";

export const metadata = { title: "Sign in · MissionHQ" };

/**
 * Three states, and they are deliberately different screens.
 *
 * Signed out, signed in but not allowed, and a failed sign-in. The middle one
 * is the one that matters: somebody with a company Google account who is not on
 * the allowlist has done nothing wrong and should be told plainly what to do,
 * rather than being bounced back to a sign-in button that will keep working.
 *
 * Design: "Petrol & Oat" (Penpot export, 23 Oct 2026). Light only, on its own
 * palette rather than the app's theme variables, because this is the one screen
 * seen before the theme is known.
 */
const C = { canvas: "#F7F8F5", text: "#172B2C", text2: "#536467", muted: "#65767A", border: "#DDE5E2", primary: "#125B60", selected: "#E9F3F1", accent: "#DCE6BA" };

const WEEK: { day: string; label: string; Icon: LucideIcon }[] = [
  { day: "MON", label: "Office", Icon: Building2 },
  { day: "TUE", label: "Office", Icon: Building2 },
  { day: "WED", label: "Home", Icon: Home },
  { day: "THU", label: "Office", Icon: Building2 },
  { day: "FRI", label: "Office", Icon: Building2 },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // An outage in the access check still shows the sign-in screen rather than
  // an error page. Kept apart from redirect(), which works by throwing.
  const viewer = await getViewer().catch(() => null);
  if (viewer) redirect(next || "/");

  // Anybody signed in with a non-company account. They are not "blocked from
  // MissionHQ" so much as signed into the wrong Google account, which is a
  // different problem and needs a different instruction.
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const wrongAccount = data.user?.email ?? null;
  const host = (await headers()).get("host") ?? "";

  return (
    <main className="min-h-dvh flex flex-col" style={{ background: C.canvas, color: C.text, fontFamily: "var(--font-geist), system-ui, sans-serif" }}>
      <header className="flex items-center justify-between px-6 sm:px-16 pt-10">
        <div className="flex items-center gap-3">
          <BrandMark size={44} />
          <div>
            <div className="text-[20px] font-semibold leading-tight tracking-tight">MissionHQ</div>
            <div className="text-[10px] tracking-[0.18em]" style={{ color: C.muted }}>HYPERVERGE</div>
          </div>
        </div>
        <div className="hidden md:block text-[11px] tracking-[0.12em]" style={{ color: C.muted }}>YOUR PERSONAL ATTENDANCE WORKSPACE</div>
      </header>

      <div className="flex-1 grid md:grid-cols-2 items-center gap-10 lg:gap-6 px-6 sm:px-16 py-10 lg:py-14 max-w-[1440px] w-full mx-auto">
        <div className="max-w-[500px]">
          <h1 className="text-[40px] sm:text-[48px] font-semibold leading-[1.1] tracking-tight">A little clarity for every working day.</h1>
          <p className="text-[17px] leading-relaxed mt-8" style={{ color: C.text2 }}>
            Your attendance, policies and allowances.<br />All together. All about your workday.
          </p>

          <div className="mt-12">
            {wrongAccount ? (
              <>
                <p className="text-[15px] leading-relaxed mb-5" style={{ color: C.text2 }}>
                  You are signed in as <span className="font-semibold" style={{ color: C.text }}>{wrongAccount}</span>, which is
                  not a HyperVerge account. Switch to your work Google account to continue.
                </p>
                <SignIn next={next} variant="switch" />
              </>
            ) : (
              <>
                <SignIn next={next} variant="primary" />
                <p className="text-[12px] mt-4" style={{ color: C.muted }}>Use your HyperVerge Google account to sign in.</p>
                {error && (
                  <div role="alert" className="mt-4 flex items-start gap-3 rounded-lg px-4 py-3 max-w-[490px]" style={{ background: "#FEF2F2", color: "#B42318" }}>
                    <CircleAlert size={17} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-[13px] font-semibold">We couldn&apos;t complete sign-in.</div>
                      <div className="text-[12px] mt-0.5">Try again with your HyperVerge account.</div>
                    </div>
                  </div>
                )}
              </>
            )}
            <p className="text-[13px] font-medium mt-8" style={{ color: C.primary }}>Need access? Contact People &amp; Culture</p>
          </div>
        </div>

        <aside className="rounded-[32px] p-8 sm:p-10" style={{ background: C.selected }}>
          <div className="text-[11px] tracking-[0.16em] font-semibold" style={{ color: C.primary }}>MAKE YOUR WEEK MAKE SENSE</div>
          <div className="h-[3px] rounded-full mt-6 mb-8" style={{ background: C.accent }} />
          <div className="rounded-2xl p-6 bg-white" style={{ boxShadow: "0 1px 2px rgb(0 0 0 / 4%), 0 2px 4px rgb(0 0 0 / 2%)", border: `1px solid ${C.border}` }}>
            <h2 className="text-[22px] font-semibold tracking-tight">Your week. In one place.</h2>
            <p className="text-[13px] mt-2" style={{ color: C.text2 }}>A simple record of where you work.</p>
            <div className="grid grid-cols-5 gap-2 mt-6">
              {WEEK.map(({ day, label, Icon }, i) => (
                <div key={day} className="rounded-xl py-3 flex flex-col items-center gap-2" style={{ background: i === 4 ? "#DCEBE7" : C.selected }}>
                  <span className="text-[9px] tracking-wide" style={{ color: C.muted }}>{day}</span>
                  <span style={{ color: C.primary }}><Icon size={18} /></span>
                  <span className="text-[10px]" style={{ color: C.text2 }}>{label}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2.5 mt-5 text-[13px]" style={{ color: C.text2 }}>
              <Check size={15} style={{ color: C.primary }} /> A complete record, without the guesswork.
            </div>
          </div>
          <h3 className="text-[22px] font-semibold tracking-tight mt-10">Check in once. Stay in the picture.</h3>
          <p className="text-[14px] mt-3 leading-relaxed max-w-[340px]" style={{ color: C.text2 }}>
            See what&apos;s recorded, what needs an answer, and how much flexibility you have left.
          </p>
        </aside>
      </div>

      <footer className="flex items-center justify-between px-6 sm:px-16 py-6 text-[12px] mx-6 sm:mx-16" style={{ borderTop: `1px solid ${C.border}`, color: C.muted }}>
        <span className="font-medium" style={{ color: C.text }}>MissionHQ</span>
        <span>{host}</span>
      </footer>
    </main>
  );
}
