import { redirect } from "next/navigation";
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
 */
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
    <main className="min-h-dvh grid place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="h-9 w-9 rounded-[10px] bg-accent grid place-items-center mb-5">
            <span className="text-accent-text font-semibold text-sm">M</span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">MissionHQ</h1>
          <p className="text-text-2 text-sm mt-1.5">Attendance for HyperVerge.</p>
        </div>

        {wrongAccount ? (
          <div className="card p-5">
            <p className="text-sm">
              You are signed in as{" "}
              <span className="font-medium">{wrongAccount}</span>, which is not a
              HyperVerge account.
            </p>
            <p className="text-text-2 text-sm mt-3">
              Switch to your work Google account to continue.
            </p>
            <SignIn next={next} variant="switch" />
          </div>
        ) : (
          <div className="card p-5">
            <SignIn next={next} variant="primary" />
            <p className="text-text-3 text-xs mt-4 leading-relaxed">
              Use your HyperVerge Google account. You will see your own
              attendance; People &amp; Culture see everyone&apos;s.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
