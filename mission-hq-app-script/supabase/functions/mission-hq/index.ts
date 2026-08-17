const encoder = new TextEncoder();

type SlackPayload = {
  type?: string;
  actions?: Array<{
    type?: string;
    value?: string;
    selected_option?: SelectedOption;
  }>;
  channel?: { id?: string };
  user?: { id?: string };
  message?: {
    ts?: string;
    text?: string;
    blocks?: Array<Record<string, unknown>>;
  };
  state?: {
    values?: Record<string, Record<string, { selected_option?: SelectedOption }>>;
  };
};

type SelectedOption = { value?: string; text?: { text?: string } };

function textResponse(body = "", status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function hmacSha256Hex(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySlackSignature(req: Request, rawBody: string) {
  const signingSecret = Deno.env.get("MISSION_HQ_SLACK_SIGNING_SECRET");
  if (!signingSecret) return;

  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const slackSignature = req.headers.get("x-slack-signature") || "";
  const requestAgeSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || requestAgeSeconds > 60 * 5) {
    throw new Error("stale Slack request");
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${await hmacSha256Hex(signingSecret, base)}`;
  if (!timingSafeEqualHex(expected, slackSignature)) {
    throw new Error("invalid Slack signature");
  }
}

function parseSlackPayload(rawBody: string) {
  const params = new URLSearchParams(rawBody);
  const payloadText = params.get("payload");
  if (!payloadText) return null;
  return JSON.parse(payloadText) as SlackPayload;
}

function parseSubmitDate(actionValue: string) {
  const raw = actionValue.replace("submit_location_", "");
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : raw;
}

// Identity metadata embedded in newer Submit button values after a "|":
//   submit_location_<date>_<fact>|e=<email>&d=<dept>&l=<location>
// Older messages have no "|" segment, so every field comes back empty and the
// caller falls back to the users.info API for the email.
function parseSubmitMeta(actionValue: string) {
  const meta = { email: "", department: "", location: "" };
  const sep = actionValue.indexOf("|");
  if (sep === -1) return meta;
  const params = new URLSearchParams(actionValue.slice(sep + 1));
  meta.email = (params.get("e") || "").trim();
  meta.department = (params.get("d") || "").trim();
  meta.location = (params.get("l") || "").trim();
  return meta;
}

function selectedOption(payload: SlackPayload): SelectedOption | undefined {
  const direct = payload.actions?.[0]?.selected_option;
  if (direct?.value) return direct;

  const stateValues = payload.state?.values || {};
  for (const block of Object.values(stateValues)) {
    for (const action of Object.values(block)) {
      if (action.selected_option?.value) return action.selected_option;
    }
  }

  return undefined;
}

// Human-readable label Slack shows for the picked option (with emoji),
// falling back to the raw value.
function optionLabel(option: SelectedOption) {
  return option.text?.text || option.value || "";
}

function extractFunFact(payload: SlackPayload) {
  const blockTexts = (payload.message?.blocks || [])
    .map((block) => {
      const text = block.text as { text?: string } | undefined;
      return text?.text || "";
    })
    .filter(Boolean);
  const text = [payload.message?.text || "", ...blockTexts].join("\n\n");
  const match = text.match(/\*Fun Fact:\*\s*([\s\S]*)$/);
  if (!match?.[1]) return "";
  return `*Fun Fact:* ${match[1].trim()}`;
}

async function updateSlackMessage(payload: SlackPayload, date: string, option: SelectedOption) {
  const channel = payload.channel?.id;
  const ts = payload.message?.ts;
  if (!channel || !ts) return;

  const label = optionLabel(option);
  const responseLine = label
    ? `Thank you for your update! We received your response *${label}* for ${date}.`
    : `Thank you for your update! We received your response for ${date}.`;
  const funFact = extractFunFact(payload);
  const text = `${responseLine}${funFact ? `\n\n${funFact}` : ""}`;

  const response = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      authorization: `Bearer ${getRequiredEnv("MISSION_HQ_SLACK_BOT_TOKEN")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      channel,
      ts,
      text,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text },
        },
      ],
    }),
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Slack chat.update failed: ${result.error || "unknown_error"}`);
  }
}

// Maps a selected location value to the Slack profile status to set.
const STATUS_CONFIG: Record<string, { text: string; emoji: string }> = {
  "Home": { text: "WFH", emoji: ":working-from-home:" },
  "Compensatory-WFH": { text: "WFH", emoji: ":working-from-home:" },
  "Leave": { text: "On Leave", emoji: ":palm_tree:" },
  "Client-Location": { text: "Client Location", emoji: ":round_pushpin:" },
  "Travel": { text: "Travel", emoji: ":luggage:" },
};

// yyyy-MM-dd in Asia/Kolkata.
function istDateString(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Sets the submitting user's Slack profile status instantly. Skips if the user
 * already has any status set (so we never overwrite a manual status — this is
 * what replaces the old Coimbatore special-case). Only runs for today's prompt.
 */
async function updateSlackProfileStatus(payload: SlackPayload, option: SelectedOption, date: string) {
  const userId = payload.user?.id;
  const value = option.value || "";
  const cfg = STATUS_CONFIG[value];
  if (!userId || !cfg) return;

  const istToday = istDateString(new Date());
  if (date !== istToday) return; // only set for today's prompt, not backfilled dates

  const userToken = getRequiredEnv("MISSION_HQ_SLACK_USER_TOKEN");

  // Do not overwrite an existing status.
  const getResp = await fetch(`https://slack.com/api/users.profile.get?user=${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${userToken}` },
  });
  const getJson = await getResp.json();
  const current = getJson.profile || {};
  const hasStatus = (current.status_text && current.status_text.trim() !== "") ||
    (current.status_emoji && current.status_emoji.trim() !== "");
  if (hasStatus) return;

  // Expire at end of the IST day (23:59:59 IST = 18:29:59 UTC same date).
  const [y, m, d] = istToday.split("-").map(Number);
  const expiration = Math.floor(Date.UTC(y, m - 1, d, 18, 29, 59) / 1000);

  const setResp = await fetch("https://slack.com/api/users.profile.set", {
    method: "POST",
    headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      user: userId,
      profile: { status_text: cfg.text, status_emoji: cfg.emoji, status_expiration: expiration },
    }),
  });
  const setJson = await setResp.json();
  if (!setJson.ok) throw new Error(`Slack profile.set failed: ${setJson.error || "unknown_error"}`);
}

// Resolves a Slack user id to their email via users.info (bot token).
async function resolveUserEmail(userId: string) {
  const resp = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${getRequiredEnv("MISSION_HQ_SLACK_BOT_TOKEN")}` },
  });
  const json = await resp.json();
  return json.ok ? (json.user?.profile?.email || "") : "";
}

// Forwards a clean, pre-processed record to Apps Script, which only writes the
// Google Sheet: { email, date, status }.
/**
 * Posts to #automation-alerts when a response is about to be lost, matching the
 * shape sendErrorAlert() uses in the Apps Script side (SlackAlerts.js) so every
 * HV automation's failures read the same in the channel.
 *
 * Best effort: alerting must never be the reason a request fails.
 *
 * This Supabase project is shared by every HV automation and sits at the 100-
 * secret cap, so both lookups fall back to secrets that already exist rather
 * than requiring new ones:
 *   channel: MISSION_HQ_ALERT_CHANNEL_ID -> ALERT_SLACK_CHANNEL_ID
 *   token:   MISSION_HQ_ALERT_BOT_TOKEN  -> MISSION_HQ_SLACK_BOT_TOKEN
 * On the fallback token the attendance bot must be a member of the channel.
 * No-ops entirely if no channel is configured.
 */
async function alertLostResponse(record: { email: string; date: string; status: string }, reason: string) {
  const alertChannel = Deno.env.get("MISSION_HQ_ALERT_CHANNEL_ID") ||
    Deno.env.get("ALERT_SLACK_CHANNEL_ID");
  if (!alertChannel) return;
  try {
    const token = Deno.env.get("MISSION_HQ_ALERT_BOT_TOKEN") ||
      getRequiredEnv("MISSION_HQ_SLACK_BOT_TOKEN");
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        channel: alertChannel,
        unfurl_links: false,
        text:
          `:rotating_light: *MissionHQ Alert*\n\n` +
          `*Error:* \`Attendance response LOST — the user was told it was saved: ${reason}\`\n` +
          `*Function:* \`mission-hq edge function / forwardToAppsScript\`\n` +
          `*Details:* \`${record.email}\` on \`${record.date}\` (response \`${record.status}\`). ` +
          `The sheet still shows \`Pending\`. The 20:00 sweep recovers it from the Slack DM.`,
      }),
    });
    const json = await response.json();
    if (!json.ok) console.error("MissionHQ alert rejected by Slack", json.error);
  } catch (alertError) {
    console.error("MissionHQ alert failed", alertError);
  }
}

/**
 * Forwards the record to Apps Script, retrying transient failures.
 *
 * The confirmation has already been shown to the user by this point, so giving
 * up here loses their answer with nobody the wiser. That is how the reported
 * glitch stayed invisible. Three attempts with backoff cover the Apps Script
 * concurrency errors seen during the post-prompt submit burst; if all three
 * fail we alert rather than swallow.
 *
 * Apps Script answers HTTP 200 even when the sheet write failed, so the JSON
 * body is inspected too — `response.ok` alone is not evidence of success.
 */
async function forwardToAppsScript(record: { email: string; date: string; status: string; department?: string; location?: string }) {
  const appsScriptUrl = getRequiredEnv("MISSION_HQ_APPS_SCRIPT_URL");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sharedSecret = Deno.env.get("MISSION_HQ_APPS_SCRIPT_SHARED_SECRET");
  if (sharedSecret) headers["x-mission-hq-secret"] = sharedSecret;

  const attempts = 3;
  let lastReason = "";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(appsScriptUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(record),
      });
      const body = await response.text();

      if (!response.ok) {
        lastReason = `HTTP ${response.status} ${body.slice(0, 300)}`;
      } else {
        // A 200 carrying {"success":false} is a failed write wearing a success
        // status code — treat it as the failure it is.
        let succeeded = true;
        try {
          const parsed = JSON.parse(body);
          if (parsed && parsed.success === false) {
            succeeded = false;
            lastReason = `Apps Script reported: ${parsed.message || parsed.error || "success:false"}`;
          }
        } catch {
          // Non-JSON 200 (e.g. an Apps Script error page) — assume the worst.
          succeeded = false;
          lastReason = `non-JSON response: ${body.slice(0, 300)}`;
        }
        if (succeeded) return;
      }
    } catch (error) {
      lastReason = `fetch threw: ${error instanceof Error ? error.message : String(error)}`;
    }

    console.error(`MissionHQ forward attempt ${attempt}/${attempts} failed: ${lastReason}`);
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  await alertLostResponse(record, lastReason);
  throw new Error(`Apps Script forward failed after ${attempts} attempts: ${lastReason}`);
}

async function processSlackInteraction(payload: SlackPayload) {
  const firstAction = payload.actions?.[0];
  const actionType = firstAction?.type || "";
  const actionValue = firstAction?.value || "";

  if (actionType === "static_select") return;
  if (!actionValue.startsWith("submit_location_")) return;

  const option = selectedOption(payload);
  if (!option?.value) return;

  const date = parseSubmitDate(actionValue);
  const meta = parseSubmitMeta(actionValue);

  // 1) Update the Slack confirmation message.
  await updateSlackMessage(payload, date, option);

  // 2) Set the Slack profile status (also today-only, checked inside; isolated
  //    so it never blocks the sheet write).
  try {
    await updateSlackProfileStatus(payload, option, date);
  } catch (statusError) {
    console.error("MissionHQ profile status update failed", statusError);
  }

  // 3) Prefer the email embedded in the button value (new messages); fall back
  //    to the users.info API for older messages that predate it. Then hand Apps
  //    Script a clean record to write to the sheet. Department/location are
  //    forwarded for later use; the sheet-writer ignores them for now.
  const userId = payload.user?.id;
  let email = meta.email;
  if (!email) {
    email = userId ? await resolveUserEmail(userId) : "";
  }
  if (!email) {
    console.error("MissionHQ: could not resolve email for user", userId);
    return;
  }
  await forwardToAppsScript({
    email,
    date,
    status: option.value,
    department: meta.department,
    location: meta.location,
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return textResponse("method not allowed", 405);

  const rawBody = await req.text();

  try {
    await verifySlackSignature(req, rawBody);
    const payload = parseSlackPayload(rawBody);
    if (!payload || payload.type !== "block_actions") return textResponse("");

    const backgroundTask = processSlackInteraction(payload).catch((error) => {
      console.error("MissionHQ background task failed", error);
    });

    const edgeRuntime = globalThis as typeof globalThis & {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    };
    if (edgeRuntime.EdgeRuntime?.waitUntil) {
      edgeRuntime.EdgeRuntime.waitUntil(backgroundTask);
    }

    return textResponse("");
  } catch (error) {
    console.error("MissionHQ request failed", error);
    return textResponse("");
  }
});
