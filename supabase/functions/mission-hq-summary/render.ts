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
  wfh_off_wed: number;
  wfa_over_cap: number;
  wfa_ytd: number;
  standard_pct: number;
  ci_pct: number;
  tier: string;
  delta: number | null;
  offWedDays: string[];
};

// Slack rejects a message over 50 blocks outright, and truncates nothing
// helpfully when a section exceeds 3000 characters.
const BLOCK_LIMIT = 50;
const SECTION_CHARS = 2900;

const TIERS = [
  { key: "S", emoji: ":large_green_circle:",  label: "Exceeding the standard, in office every day" },
  { key: "A", emoji: ":large_blue_circle:",   label: "Meeting the standard, office 4 days with WFH on Wednesday" },
  { key: "B", emoji: ":large_yellow_circle:", label: "Good progress, 60%+ but short of the standard" },
  { key: "C", emoji: ":large_orange_circle:", label: "Needs attention, below 60%" },
  { key: "D", emoji: ":red_circle:",          label: "Check-in not active" },
];

// A day count can be a half, so render 9.5 but never 10.0.
const days = (n: number) => (Math.round(n * 10) % 10 === 0 ? String(Math.round(n)) : n.toFixed(1));

/**
 * Dates in the footnote as bare day numbers: "3, 10, 14" rather than
 * "2026-08-03, 2026-08-10, 2026-08-14".
 *
 * The period never spans more than one month and the header already names it,
 * so the year and month on every entry are nine characters of noise repeated a
 * few hundred times. On a large group that is the difference between a footnote
 * somebody skims and one they scroll past.
 */
const dayNums = (days: string[]) =>
  days.map((d) => String(Number(d.slice(8, 10)))).join(", ");

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
  wednesdays: number;
  wfaCap: number;
}) {
  const { groupName, period, snapshotNo, members, unranked, workingDays, wednesdays, wfaCap } = args;

  const totalAvailable = members.reduce((s, m) => s + m.available, 0);
  const totalAdherent = members.reduce((s, m) => s + m.adherent, 0);
  const totalPending = members.reduce((s, m) => s + m.pending, 0);
  const groupPct = totalAvailable > 0 ? Math.round((totalAdherent / totalAvailable) * 100) : 0;
  const meeting = members.filter((m) => m.tier === "S" || m.tier === "A").length;
  const ciPct = members.length
    ? Math.round(members.reduce((s, m) => s + m.ci_pct, 0) / members.length)
    : 0;

  const blocks: Record<string, unknown>[] = [
    { type: "header", text: { type: "plain_text", text: `${groupName} · Attendance Snapshot` } },
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

  // Named only when the WEEKDAY IS THE WHOLE STORY: move these WFH days to
  // Wednesdays and the person would be AT the standard, not merely closer to it.
  // That last clause is the one that matters. Without it the list names everyone
  // with a stray WFH day, including somebody at 36% who would still be at 50%,
  // and a footnote naming seventy people says nothing about any of them.
  //
  // Pending days disqualify too, deliberately: that person's gap is checking in
  // at all, not which day they were at home, and telling them otherwise points
  // them at the wrong fix.
  const wouldMeet = members.filter(
    (m) =>
      m.tier !== "S" && m.tier !== "A" &&
      m.pending === 0 &&
      m.wfh_off_wed > 0 &&
      // Day counts are halves, so compare with a tolerance rather than equality.
      m.adherent + m.wfh_off_wed >= m.available - 0.01 &&
      // AND THE SWAP HAS TO BE POSSIBLE. A fortnight holds about three
      // Wednesdays; somebody WFH on eight other days cannot move them all onto
      // Wednesdays that do not exist, so telling them the weekday was the
      // problem is false and points them at the wrong fix. Their issue is the
      // volume: the policy allows WFH on Wednesdays, so at most three.
      m.wfh_off_wed <= wednesdays - (m.wfh - m.wfh_off_wed) + 0.01,
  );
  if (wouldMeet.length) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: "*Would be meeting the standard if these WFH days had been Wednesdays:* " +
              wouldMeet.map((m) =>
                `${m.full_name || m.email}${m.offWedDays.length ? ` (${dayNums(m.offWedDays)})` : ""}`
              ).join("; ") + ".",
      }],
    });
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
        ":two: *Wednesday is the default WFH day.* A Wednesday at home counts in full, the same " +
        "as an office day. WFH on any other day does not.\n" +
        ":three: *Pending is invisible.* A pending day cannot be credited as office presence, " +
        "even if you were there.",
    },
  });
  // Named directly, because a ranking that lists somebody at 0% without telling
  // them what to do about it is just a scoreboard.
  const inactive = members.filter((m) => m.tier === "D");
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
            `· *Standard adherence* = (office days + WFH Wednesdays) ÷ available days. Wednesday ` +
            `is the default WFH day, so a Wednesday at home counts in full: four office days plus ` +
            `a Wednesday at home is 100%, not 80%. WFH on any other weekday does not count. ` +
            `· *Exceeding* = in the office every available day · *Meeting* = every available day ` +
            `either in the office or a WFH Wednesday · *Office* = Office, Client, Client Location, ` +
            `Travel, Office + Client, Compensatory WFH · *Half days split in two*: Split Day = ` +
            `½ office + ½ home, Half Day Office Leave = ½ office + ½ leave, Half Day WFH Leave = ` +
            `½ home + ½ leave.`,
    }],
  });

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "Thank you :pray: · People & Culture" }],
  });

  const text = `${groupName} attendance, ${period.label}`;
  return { text, blocks: blocks.slice(0, BLOCK_LIMIT) };
}
