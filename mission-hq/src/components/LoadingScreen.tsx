/**
 * Loading.
 *
 * The brand mark and a thin bar, centred. Nothing that imitates the page's
 * layout: a skeleton that does not match what arrives (admin and member
 * screens differ) reads as a glitch when the real thing replaces it.
 *
 * Was a staged "uplink / syncing / calibrating" animation with a radar sweep,
 * which took about four seconds of theatre to say "wait". The data is fast
 * now, so this is meant to be seen for a moment and then be gone.
 */
import { BrandMark } from "@/components/BrandMark";

export default function LoadingScreen() {
  return (
    <div className="min-h-dvh grid place-items-center" style={{ background: "var(--bg-app)" }} role="status" aria-label="Loading">
      <div className="flex flex-col items-center gap-5">
        <div className="animate-pulse-soft"><BrandMark size={48} /></div>
        <div className="h-[3px] w-28 rounded-full overflow-hidden" style={{ background: "var(--bg-inset)" }}>
          <div className="h-full w-1/2 rounded-full loading-slide" style={{ background: "linear-gradient(90deg, #6366f1, #8b5cf6)" }} />
        </div>
      </div>
    </div>
  );
}
