// Slack calls, and the alert channel.
//
// Two different bots, deliberately: the attendance bot owns the DMs, and the HV
// Automation bot owns #automation-alerts because that is the channel it is a
// member of. Sending an alert with the attendance bot would silently fail with
// `not_in_channel`, which is the worst possible failure for an alerting path.

const SLACK = "https://slack.com/api";

export async function slack(method: string, token: string, payload: unknown) {
  const response = await fetch(`${SLACK}/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  return await response.json();
}

/**
 * Posts to #automation-alerts. Never throws — an alerting path that can fail
 * the job it is reporting on turns one problem into two.
 *
 * There is deliberately no "all good" counterpart. Every one of these means
 * somebody has to look; a job that also reports success trains people to skim.
 */
export async function alert(title: string, detail: string, fn: string) {
  try {
    const token = Deno.env.get("MISSION_HQ_ALERT_BOT_TOKEN") || Deno.env.get("MISSION_HQ_SLACK_BOT_TOKEN");
    const channel = Deno.env.get("MISSION_HQ_ALERT_CHANNEL_ID");
    if (!token || !channel) {
      console.error(`alert not sent (token/channel unset): ${title} — ${detail}`);
      return;
    }
    const text =
      `:rotating_light: *MissionHQ Alert*\n\n*Error:* \`${title}\`\n` +
      `*Function:* \`${fn}\`\n` +
      (detail ? `*Details:* ${detail}\n` : "");
    const json = await slack("chat.postMessage", token, { channel, text, unfurl_links: false });
    if (!json.ok) console.error(`alert post failed: ${json.error}`);
  } catch (error) {
    console.error("alert threw", error);
  }
}
