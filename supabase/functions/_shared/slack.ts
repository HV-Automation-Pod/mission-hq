// Slack calls, and the alert channel.
//
// Two different bots, deliberately: the attendance bot owns the DMs, and the HV
// Automation bot owns #automation-alerts because that is the channel it is a
// member of. Sending an alert with the attendance bot would silently fail with
// `not_in_channel`, which is the worst possible failure for an alerting path.

const SLACK = "https://slack.com/api";

/**
 * A Slack Web API call, with the one retry that is always worth making.
 *
 * RATE LIMITING IS HANDLED HERE, and it was not before. `mission-hq-prompt`
 * carried a comment saying "a 429 is still handled below rather than assumed
 * away" and nothing in the codebase read a 429, a `Retry-After`, or the
 * `ratelimited` error string. A throttled send would have failed outright.
 *
 * Why it has not bitten: `chat.postMessage` is special-cased by Slack at about
 * one per second PER CHANNEL, and every DM is its own channel, so 348 sends to
 * 348 people never compete. The methods that do share a bucket are the ones
 * called once per run. That is an argument for why this is rare, not for why
 * it cannot happen, and the cost of being wrong is somebody silently not
 * being asked whether they came to the office.
 *
 * Slack says exactly how long to wait, so waiting is the whole fix. Bounded at
 * three attempts: beyond that the run has a wall clock to respect, and a
 * failure that persists through two waits is not a transient one.
 */
/** The fields every caller here actually reads, plus whatever else came back. */
export type SlackResponse = {
  ok?: boolean;
  error?: string;
  channel?: string;
  ts?: string;
  members?: string[];
  [key: string]: unknown;
};

export async function slack(
  method: string,
  token: string,
  payload: unknown,
  attempt = 1,
): Promise<SlackResponse> {
  const MAX_ATTEMPTS = 3;
  const MAX_WAIT_S = 30;

  const response = await fetch(`${SLACK}/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  // A 429 body is not always JSON, so the header is read before parsing.
  if (response.status === 429 && attempt < MAX_ATTEMPTS) {
    const after = Number(response.headers.get("retry-after")) || 1;
    await response.body?.cancel();
    await new Promise((r) => setTimeout(r, Math.min(after, MAX_WAIT_S) * 1000));
    return slack(method, token, payload, attempt + 1);
  }

  let body: SlackResponse;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: `non-JSON response (HTTP ${response.status})` };
  }

  // Slack also reports throttling as a 200 with `ok:false, error:"ratelimited"`.
  if (body?.ok === false && body?.error === "ratelimited" && attempt < MAX_ATTEMPTS) {
    const after = Number(response.headers.get("retry-after")) || 1;
    await new Promise((r) => setTimeout(r, Math.min(after, MAX_WAIT_S) * 1000));
    return slack(method, token, payload, attempt + 1);
  }

  return body;
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
