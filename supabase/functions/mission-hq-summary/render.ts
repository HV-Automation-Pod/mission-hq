// ===========================================================================
// Turning numbers into the message people actually read.
//
// The ranking tables are CODE BLOCKS because that is the only way Slack gives
// column alignment. Emoji do not render inside one, which is why movement is
// drawn with text markers rather than arrows-as-emoji.
//
// The methodology sits at the BOTTOM as small print. It is reference material,
// not the headline, and when it sat at the top it swamped the message.
// ===========================================================================
import { ordinal } from "./period.ts";

export type Member = {
  email: string;
  full_name: string | null;
  available: number;
  adherent: number;
  pending: number;
  wfh: number;
  wfh_excess: number;
  wfa_over_cap: number;
  wfa_ytd: number;
  standard_pct: number;
  ci_pct: number;
  tier: string;
  delta: number | null;
};

// Slack rejects a message over 50 blocks outright, and truncates nothing
// helpfully when a section exceeds 3000 characters.
const BLOCK_LIMIT = 50;
const SECTION_CHARS = 2900;

// Six bands, and NO PERCENTAGE IN ANY HEADING. The number is already on every
// row, four columns wide, beside a bar. The old headings led with the band's
// floor — "Good progress, 60%+ but short of the standard" — which printed a
// member at 90% under the worst true thing about their position, three rows
// above a 63%. That is the one thing a manager queried about this report.
//
// S and A are day counts (every available day); B through E are percentage
// bands. B starts at 80, four days of five, so the boundary has the same shape
// as the standard rather than being a round number chosen for roundness.
const TIERS = [
  { key: "S", emoji: ":large_green_circle:",  label: "Exceeding the standard, in office every day" },
  { key: "A", emoji: ":large_blue_circle:",   label: "Meeting the standard, 4 days in office with 1 day WFH" },
  { key: "B", emoji: ":large_yellow_circle:", label: "Just short of the standard" },
  { key: "C", emoji: ":large_orange_circle:", label: "Some way short of the standard" },
  { key: "D", emoji: ":red_circle:",          label: "Needs attention" },
  { key: "E", emoji: ":white_circle:",        label: "Check-in not active" },
];

// A day count can be a half, so render 9.5 but never 10.0.
const days = (n: number) => (Math.round(n * 10) % 10 === 0 ? String(Math.round(n)) : n.toFixed(1));

const bar = (pct: number) => {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
};

/**
 * Movement since the last snapshot. Bold at 10 points, an arrow at 15, nothing
 * below that: a report where every row is annotated annotates nothing.
 */
const movement = (d: number | null) => {
  if (d === null || Math.abs(d) < 10) return "";
  const arrow = Math.abs(d) >= 15 ? (d > 0 ? "▲ " : "▼ ") : "";
  return `${arrow}${d > 0 ? "+" : ""}${d}`;
};

function table(rows: Member[], startRank: number): string[] {
  const nameWidth = Math.max(4, ...rows.map((r) => (r.full_name || r.email).length));
  const lines = rows.map((r, i) => {
    const rank = String(startRank + i).padStart(2);
    const name = (r.full_name || r.email).padEnd(nameWidth);
    const pct = `${r.standard_pct}%`.padStart(4);
    const count = `${days(r.adherent)}/${days(r.available)}`.padStart(7);
    return `${rank}  ${name}  ${bar(r.standard_pct)}  ${pct}  ${count}  ${movement(r.delta)}`.trimEnd();
  });

  // One tier can outgrow a section. Split rather than let Slack drop the tail.
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 1 > SECTION_CHARS && current.length) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}

export function buildMessage(args: {
  groupName: string;
  period: { from: string; to: string; label: string };
  snapshotNo: number;
  members: Member[];
  unranked: Member[];
  workingDays: number;
  wfaCap: number;
}) {
  const { groupName, period, snapshotNo, members, unranked, workingDays, wfaCap } = args;

  const totalAvailable = members.reduce((s, m) => s + m.available, 0);
  const totalAdherent = members.reduce((s, m) => s + m.adherent, 0);
  const totalPending = members.reduce((s, m) => s + m.pending, 0);
  const groupPct = totalAvailable > 0 ? Math.round((totalAdherent / totalAvailable) * 100) : 0;
  const meeting = members.filter((m) => m.tier === "S" || m.tier === "A").length;
  const ciPct = members.length
    ? Math.round(members.reduce((s, m) => s + m.ci_pct, 0) / members.length)
    : 0;

  const blocks: Record<string, unknown>[] = [
    // No header block: the bot's display name already says which group this is
    // ("G&A Attendance Summary"), and a header repeated it right underneath.
    {
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `*${period.label}* · ${workingDays} working days · ${members.length} people · ` +
              `our ${ordinal(snapshotNo)} attendance snapshot`,
      }],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*True WFO Adherence*  ${bar(groupPct)}  *${groupPct}%*` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Check-in rate*\n${ciPct}%` },
        { type: "mrkdwn", text: `*Pending days*\n${days(totalPending)}` },
        { type: "mrkdwn", text: `*Meeting the standard*\n${meeting} of ${members.length}` },
        { type: "mrkdwn", text: `*Days counted*\n${days(totalAvailable)}` },
      ],
    },
    { type: "divider" },
  ];

  let rank = 1;
  for (const tier of TIERS) {
    const rows = members.filter((m) => m.tier === tier.key);
    if (!rows.length) continue;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${tier.emoji} *${tier.label}* · ${rows.length} ` +
              `${rows.length === 1 ? "member" : "members"}`,
      },
    });
    for (const chunk of table(rows, rank)) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: "```\n" + chunk + "\n```" } });
    }
    rank += rows.length;
  }

  if (unranked.length) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `*Not ranked this period* (no available days, on leave throughout): ` +
              unranked.map((m) => m.full_name || m.email).join(", ") + ".",
      }],
    });
  }

  // Who has spent the annual WFA entitlement. The number in brackets is their
  // YEAR-TO-DATE total, not this period's, because the cap is annual and that is
  // the figure they can check against.
  //
  // The cap is read from settings rather than written into the sentence. The
  // published report said "(10/yr)" for weeks after PnC raised it to 15, because
  // the number lived in the prose.
  const overCap = members.filter((m) => m.wfa_over_cap > 0);
  if (overCap.length) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `:warning: *WFA annual cap (${wfaCap}/yr) reached:* ` +
              overCap.map((m) => `${m.full_name || m.email} (${days(m.wfa_ytd)})`).join(", "),
      }],
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Our ask*\n" +
        ":one: *Check in every morning.* Office, Client, WFH, Travel, Leave and WFA all count. " +
        "Five seconds, every day.\n" +
        ":two: *One WFH day a week, any day.* Wednesday is the default, and you may swap it. " +
        "A second day at home in the same week does not count.\n" +
        ":three: *Pending is invisible.* A pending day cannot be credited as office presence, " +
        "even if you were there.",
    },
  });
  // Named directly, because a ranking that lists somebody at 0% without telling
  // them what to do about it is just a scoreboard.
  const inactive = members.filter((m) => m.tier === "E");
  if (inactive.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:wave: *${inactive.map((m) => m.full_name || m.email).join(", ")}*, please DM ` +
              `People & Culture so we can fix the check-in gap before the next snapshot.`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: `*How this is calculated* · *Available days* = ${workingDays} working days, minus ` +
            `leave, minus WFA, minus any day no check-in prompt was sent to you. Leave and WFA ` +
            `up to the ${wfaCap}-day yearly entitlement are excluded, counting neither for nor ` +
            `against you. WFA days beyond ${wfaCap}/year DO count against adherence. ` +
            `· *Standard adherence* = (office days + up to ONE WFH day per week) ÷ available ` +
            `days. Wednesday is the default WFH day and you may swap it for another, so the ` +
            `weekday does not matter; a SECOND day at home in the same week does not count. ` +
            `· *Exceeding* = in the office every available day · *Meeting* = four days in the ` +
            `office with at most one day at home each week · *Office* = ` +
            `Office, Client, Client Location, Travel, Office + Client, Compensatory WFH ` +
            `· *Half days split in two*: Split Day = ½ office + ½ home, Half Day Office Leave = ` +
            `½ office + ½ leave, Half Day WFH Leave = ½ home + ½ leave.`,
    }],
  });

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "Thank you :pray: · People & Culture" }],
  });

  const text = `${groupName} attendance, ${period.label}`;
  return { text, blocks: blocks.slice(0, BLOCK_LIMIT) };
}
