const encoder = new TextEncoder();

type SlackPayload = {
  type?: string;
  actions?: Array<{
    type?: string;
    action_id?: string;
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
// A button value is up to three "|"-separated segments:
//
//   submit_location_<date>_<fact> | <url-encoded meta> | <option list JSON>
//
// The Apps Script prompt writes the first two. The third is added by the Edit
// button only — see packEditValue(). URLSearchParams percent-encodes "|" as
// %7C, so the separators are never ambiguous.
function splitActionValue(actionValue: string) {
  const first = actionValue.indexOf("|");
  if (first === -1) return { base: actionValue, meta: "", options: "" };
  const second = actionValue.indexOf("|", first + 1);
  return second === -1
    ? { base: actionValue.slice(0, first), meta: actionValue.slice(first + 1), options: "" }
    : {
      base: actionValue.slice(0, first),
      meta: actionValue.slice(first + 1, second),
      options: actionValue.slice(second + 1),
    };
}

function parseSubmitMeta(actionValue: string) {
  const meta = { email: "", department: "", location: "", status: "" };
  const params = new URLSearchParams(splitActionValue(actionValue).meta);
  meta.email = (params.get("e") || "").trim();
  meta.department = (params.get("d") || "").trim();
  meta.location = (params.get("l") || "").trim();
  // "s" is added by us, not by the Apps Script prompt: the answer currently on
  // record, so the Edit button can pre-select it without having to read it back
  // out of the confirmation text.
  meta.status = (params.get("s") || "").trim();
  return meta;
}

/** Prefix + meta, with `s` set to the answer now on record. No option list. */
function withStatus(actionValue: string, status: string) {
  const { base, meta } = splitActionValue(actionValue);
  const params = new URLSearchParams(meta);
  params.set("s", status);
  return `${base}|${params.toString()}`;
}

// Slack caps a button value at 2000 characters. Stay well under it.
const EDIT_VALUE_MAX = 1900;

/**
 * The option list carried inside the Edit button, so clicking Edit costs no
 * network at all.
 *
 * Rebuilding the picker needs the options, and the confirmation has no select
 * left to read them from — the first version fetched them back from the Apps
 * Script `?action=locations` endpoint, which measured 3.3–4.5s per call (all of
 * it Apps Script cold start, not transport). That delay was the entire cost of
 * clicking Edit.
 *
 * They are already in the payload at this point — the message being answered
 * still carries its select — so they can just be carried forward instead. Only
 * text and value are kept, which is all the picker needs.
 *
 * If the packed value would exceed the cap the options are dropped and the Edit
 * handler falls back to fetching, so a much longer Locations sheet degrades to
 * slow rather than broken.
 */
function packEditValue(actionValue: string, status: string, options: PickerOption[]) {
  const base = withStatus(actionValue, status);
  if (options.length === 0) return base;
  const slim = options.map((option) => ({ t: option.text.text, v: option.value }));
  const packed = `${base}|${JSON.stringify(slim)}`;
  return packed.length <= EDIT_VALUE_MAX ? packed : base;
}

function unpackOptions(actionValue: string): PickerOption[] {
  const { options } = splitActionValue(actionValue);
  if (!options) return [];
  try {
    const slim = JSON.parse(options) as Array<{ t?: string; v?: string }>;
    return slim
      .filter((option) => option.t && option.v)
      .map((option) => ({ text: { type: "plain_text", text: option.t! }, value: option.v! }));
  } catch (error) {
    console.error("MissionHQ: unreadable packed options", error);
    return [];
  }
}

/** Prefix + meta only — what the picker's own Submit button carries. */
function stripOptions(actionValue: string) {
  const { base, meta } = splitActionValue(actionValue);
  return meta ? `${base}|${meta}` : base;
}

/** The options on the message being answered — prompt or picker, either has them. */
function optionsFromMessage(payload: SlackPayload): PickerOption[] {
  const actions = (payload.message?.blocks || []).find((block) => block.type === "actions") as
    | { elements?: Array<{ type?: string; options?: PickerOption[] }> }
    | undefined;
  return actions?.elements?.find((element) => element.type === "static_select")?.options || [];
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

// Reads the fact out of the message being updated so the confirmation can keep
// it. Captures a SINGLE line, not everything to the end: once the confirmation
// carries a fact of its own, a greedy match would swallow the second copy into
// the first and the fact would grow on every edit.
function extractFunFact(payload: SlackPayload) {
  const blockTexts = (payload.message?.blocks || [])
    .map((block) => {
      const text = block.text as { text?: string } | undefined;
      return text?.text || "";
    })
    .filter(Boolean);
  const text = [payload.message?.text || "", ...blockTexts].join("\n\n");
  const match = text.match(/\*Fun Fact:\*[ \t]*([^\n]*)/);
  if (!match?.[1]) return "";
  return `*Fun Fact:* ${match[1].trim()}`;
}

type SlackBlock = Record<string, unknown>;
type PickerOption = { text: { type: string; text: string }; value: string };

// The Locations sheet, fetched through the Apps Script doGet rather than
// duplicated here — that sheet is the only place the option list lives, and a
// second copy would drift the moment someone adds a status.
//
// Cached per isolate: an Apps Script GET costs a second or two, and the list
// changes a few times a year at most. A cold isolate just pays it once.
let cachedOptions: PickerOption[] | null = null;
let cachedOptionsAt = 0;
const OPTIONS_TTL_MS = 30 * 60 * 1000;

async function fetchLocationOptions(): Promise<PickerOption[]> {
  if (cachedOptions && Date.now() - cachedOptionsAt < OPTIONS_TTL_MS) return cachedOptions;

  const url = getRequiredEnv("MISSION_HQ_APPS_SCRIPT_URL");
  const response = await fetch(`${url}?action=locations`);
  const json = await response.json();
  if (!json?.success || !Array.isArray(json.locations)) {
    throw new Error(`locations fetch returned no list: ${JSON.stringify(json).slice(0, 200)}`);
  }

  const options: PickerOption[] = json.locations
    .filter((item: { location?: string; value?: string }) => item.location && item.value)
    .map((item: { location: string; value: string }) => ({
      text: { type: "plain_text", text: item.location },
      // Same transform the Apps Script prompt applies, so a value picked here is
      // indistinguishable from one picked on the original prompt.
      value: item.value.replace(/\s+/g, "-"),
    }));
  if (options.length === 0) throw new Error("locations fetch returned an empty list");

  cachedOptions = options;
  cachedOptionsAt = Date.now();
  return options;
}

/**
 * The resting state of an answered prompt: one small Edit button, nothing else.
 *
 * The picker is deliberately NOT left on the message. This DM goes to the whole
 * org every working day and the answer is usually right, so a permanently
 * expanded dropdown is a control row of clutter on every confirmation forever.
 * Edit costs one extra click on the rare occasion someone changes their mind.
 *
 * `value` carries the date, identity metadata and the answer on record, so the
 * Edit handler needs nothing from the message text.
 */
function buildEditBlock(editValue: string): SlackBlock {
  return {
    type: "actions",
    elements: [{
      type: "button",
      text: { type: "plain_text", text: "Edit", emoji: true },
      value: editValue,
      action_id: "edit_location",
    }],
  };
}

/** The expanded picker: the same select and Submit the original prompt had. */
function buildPickerBlock(options: PickerOption[], submitValue: string, current: string): SlackBlock {
  const select: Record<string, unknown> = {
    type: "static_select",
    action_id: "location_select",
    placeholder: { type: "plain_text", text: "Choose a location" },
    options,
  };
  // initial_option must be one of `options`, matched on text AND value, so it
  // has to be the object from the list — not one reconstructed from the value.
  const selected = options.find((option) => option.value === current);
  if (selected) select.initial_option = selected;

  return {
    type: "actions",
    elements: [
      select,
      {
        type: "button",
        text: { type: "plain_text", text: "Update", emoji: true },
        style: "primary",
        value: submitValue,
        action_id: "submit_location",
      },
    ],
  };
}

/** The confirmation's own text, so a re-render never has to rebuild it. */
function messageBodyText(payload: SlackPayload) {
  const section = (payload.message?.blocks || []).find(
    (block) => block.type === "section" && (block.text as { text?: string } | undefined)?.text,
  );
  const text = (section?.text as { text?: string } | undefined)?.text;
  return text || payload.message?.text || "";
}

async function chatUpdate(channel: string, ts: string, text: string, blocks: SlackBlock[]) {
  const response = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      authorization: `Bearer ${getRequiredEnv("MISSION_HQ_SLACK_BOT_TOKEN")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ channel, ts, text, blocks }),
  });
  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Slack chat.update failed: ${result.error || "unknown_error"}`);
  }
}

async function updateSlackMessage(
  payload: SlackPayload,
  date: string,
  option: SelectedOption,
  actionValue: string,
) {
  // Built here rather than by the caller because the option list has to be
  // lifted off the message being answered, which only this function still has.
  const editValue = packEditValue(actionValue, option.value || "", optionsFromMessage(payload));
  const channel = payload.channel?.id;
  const ts = payload.message?.ts;
  if (!channel || !ts) return;

  const label = optionLabel(option);
  const responseLine = label
    ? `Thank you for your update! We received your response *${label}* for ${date}.`
    : `Thank you for your update! We received your response for ${date}.`;

  const funFact = extractFunFact(payload);
  // No "you can change this" line: the Edit button says it. The DM is read daily
  // by the whole org, so a standing instruction is noise on every confirmation
  // forever.
  //
  // The fact stays LAST. extractFunFact() reads from "*Fun Fact:*" to the end of
  // the line, so anything appended after it would be read back as part of the
  // fact on the next edit.
  const text = `${responseLine}${funFact ? `\n\n${funFact}` : ""}`;

  await chatUpdate(channel, ts, responseLine, [
    { type: "section", text: { type: "mrkdwn", text } },
    buildEditBlock(editValue),
  ]);
}

/**
 * Edit clicked: swap the button for the picker, pre-selected to the answer on
 * record. Submitting it runs the normal path and puts the Edit button back.
 *
 * Best effort — if the option list cannot be fetched the message is left exactly
 * as it was, which loses nothing: the answer already recorded still stands.
 */
async function showLocationPicker(payload: SlackPayload, actionValue: string) {
  const channel = payload.channel?.id;
  const ts = payload.message?.ts;
  if (!channel || !ts) return;

  // Normally free: the options travelled here inside the button value. The
  // fetch is only for values packed before this existed, or a Locations sheet
  // long enough to overflow the cap.
  const packed = unpackOptions(actionValue);
  const options = packed.length > 0 ? packed : await fetchLocationOptions();

  const body = messageBodyText(payload);
  const meta = parseSubmitMeta(actionValue);

  await chatUpdate(channel, ts, body.split("\n")[0], [
    { type: "section", text: { type: "mrkdwn", text: body } },
    // The picker's Submit carries no option list — the select on the message is
    // where the next confirmation reads them from.
    buildPickerBlock(options, stripOptions(actionValue), meta.status),
  ]);
}

/**
 * Put the Edit button back without recording anything.
 *
 * Used when Update is clicked but the answer has not changed. The message text
 * already names what is on record, so collapsing is purely a re-render: no
 * sheet write, no Slack profile call, no Apps Script round trip.
 */
async function collapseToEdit(payload: SlackPayload, actionValue: string) {
  const channel = payload.channel?.id;
  const ts = payload.message?.ts;
  if (!channel || !ts) return;

  const body = messageBodyText(payload);
  const editValue = packEditValue(
    actionValue,
    parseSubmitMeta(actionValue).status,
    optionsFromMessage(payload),
  );

  await chatUpdate(channel, ts, body.split("\n")[0], [
    { type: "section", text: { type: "mrkdwn", text: body } },
    buildEditBlock(editValue),
  ]);
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

  // Edit is checked before the value prefix: its value deliberately keeps the
  // `submit_location_` shape so both handlers share the date/meta parsers, and
  // only the action_id tells the two apart.
  if (firstAction?.action_id === "edit_location") {
    await showLocationPicker(payload, actionValue);
    return;
  }

  if (!actionValue.startsWith("submit_location_")) return;

  const meta = parseSubmitMeta(actionValue);
  const option = selectedOption(payload);

  // Update clicked with nothing new chosen. Two ways to land here: the person
  // re-picked the answer already on record, or they never opened the select at
  // all — Slack does not reliably report an untouched initial_option in
  // state.values, which is why the picker used to just sit there open.
  //
  // Either way there is nothing to record, so skip the write entirely and put
  // the Edit button back. `meta.status` is only set once an answer exists, so
  // an untouched *original* prompt still falls through to the silent return
  // below rather than collapsing into a confirmation for an answer nobody gave.
  const unchanged = !option?.value || option.value === meta.status;
  if (unchanged && meta.status) {
    await collapseToEdit(payload, actionValue);
    return;
  }
  if (!option?.value) return;

  const date = parseSubmitDate(actionValue);

  // 1) Update the Slack confirmation message.
  await updateSlackMessage(payload, date, option, actionValue);

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
