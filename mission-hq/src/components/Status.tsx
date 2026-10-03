/**
 * One status, one colour, everywhere.
 *
 * The colour carries meaning rather than decoration: office and home are
 * different hues from each other but both calm, and only Pending is warm. A
 * screen read by somebody scanning for a problem should make the problem the
 * only loud thing on it.
 *
 * Driven by the WEIGHTS, not by a hardcoded list of names, so a status added to
 * `locations` gets a sensible colour without a code change.
 */
const TONE: Record<string, { bg: string; fg: string }> = {
  office:  { bg: "var(--office-soft)",  fg: "var(--office)" },
  home:    { bg: "var(--home-soft)",    fg: "var(--home)" },
  leave:   { bg: "var(--leave-soft)",   fg: "var(--leave)" },
  pending: { bg: "var(--pending-soft)", fg: "var(--pending)" },
  away:    { bg: "var(--away-soft)",    fg: "var(--away)" },
};

export function toneFor(status: string): keyof typeof TONE {
  const s = status.toLowerCase();
  if (s === "pending") return "pending";
  if (s === "leave") return "leave";
  if (s === "anywhere") return "away";
  if (s.includes("home") || s === "split day") return "home";
  return "office";
}

export function StatusPill({ status }: { status: string }) {
  const tone = TONE[toneFor(status)];
  return (
    <span className="pill" style={{ background: tone.bg, color: tone.fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.fg }} />
      {status}
    </span>
  );
}

/** Where a value came from. Quiet, because it only matters when questioned. */
export function SourceTag({ source }: { source: string }) {
  const label: Record<string, string> = {
    slack: "answered in Slack",
    prompt: "awaiting answer",
    "zoho-leave": "from Zoho leave",
    backfill: "imported",
    manual: "set by hand",
  };
  return <span className="text-text-3 text-xs">{label[source] ?? source}</span>;
}
