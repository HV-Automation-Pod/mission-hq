// Setting somebody's Slack profile status for the rest of today, shared by the
// two callers that do it: the submit handler (they just answered) and the leave
// sync (Zoho says they are off).
//
// NEVER OVERWRITES A STATUS THAT IS ALREADY THERE. A manual "In a meeting", or
// one Zoho's own Slack integration set, is the person's or somebody else's and
// is worth more than ours. It also makes the leave sync's second daily pass
// free: by then our own status is in place and the check skips it.
//
// It acts on another user's profile, so it needs the USER token
// (`users.profile:write`), not the bot token.

export type SlackStatus = { text: string; emoji: string };

/** Expire at the end of the IST day: 23:59:59 IST is 18:29:59 UTC the same date. */
function endOfIstDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 18, 29, 59) / 1000);
}

/** Returns true if a status was written, false if the person already had one. */
export async function setStatusForDay(userId: string, status: SlackStatus, day: string): Promise<boolean> {
  const token = Deno.env.get("MISSION_HQ_SLACK_USER_TOKEN");
  if (!token) throw new Error("MISSION_HQ_SLACK_USER_TOKEN is not set");

  const got = await fetch(`https://slack.com/api/users.profile.get?user=${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const current = (await got.json()).profile || {};
  if ((current.status_text || "").trim() !== "" || (current.status_emoji || "").trim() !== "") return false;

  const set = await fetch("https://slack.com/api/users.profile.set", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      user: userId,
      profile: { status_text: status.text, status_emoji: status.emoji, status_expiration: endOfIstDay(day) },
    }),
  });
  const json = await set.json();
  if (!json.ok) throw new Error(`Slack profile.set failed: ${json.error || "unknown_error"}`);
  return true;
}
