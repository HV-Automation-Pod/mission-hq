const encoder = new TextEncoder();

type SlackPayload = {
  type?: string;
  actions?: Array<{
    type?: string;
    value?: string;
    selected_option?: { value?: string };
  }>;
  channel?: { id?: string };
  message?: {
    ts?: string;
    text?: string;
    blocks?: Array<Record<string, unknown>>;
  };
  state?: {
    values?: Record<string, Record<string, { selected_option?: { value?: string } }>>;
  };
};

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

function selectedLocation(payload: SlackPayload) {
  const direct = payload.actions?.[0]?.selected_option?.value;
  if (direct) return direct;

  const stateValues = payload.state?.values || {};
  for (const block of Object.values(stateValues)) {
    for (const action of Object.values(block)) {
      const value = action.selected_option?.value;
      if (value) return value;
    }
  }

  return "";
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

async function updateSlackMessage(payload: SlackPayload, date: string) {
  const channel = payload.channel?.id;
  const ts = payload.message?.ts;
  if (!channel || !ts) return;

  const funFact = extractFunFact(payload);
  const text = `Thank you for your update! We received your response for ${date}.${funFact ? `\n\n${funFact}` : ""}`;

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

async function forwardToAppsScript(rawBody: string) {
  const appsScriptUrl = getRequiredEnv("MISSION_HQ_APPS_SCRIPT_URL");
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  const sharedSecret = Deno.env.get("MISSION_HQ_APPS_SCRIPT_SHARED_SECRET");
  if (sharedSecret) headers["x-mission-hq-secret"] = sharedSecret;

  const response = await fetch(appsScriptUrl, {
    method: "POST",
    headers,
    body: rawBody,
  });

  if (!response.ok) {
    throw new Error(`Apps Script forward failed: HTTP ${response.status} ${await response.text()}`);
  }
}

async function processSlackInteraction(payload: SlackPayload, rawBody: string) {
  const firstAction = payload.actions?.[0];
  const actionType = firstAction?.type || "";
  const actionValue = firstAction?.value || "";

  if (actionType === "static_select") return;

  if (actionValue.startsWith("submit_location_")) {
    const location = selectedLocation(payload);
    if (location) {
      await updateSlackMessage(payload, parseSubmitDate(actionValue));
    }
  }

  await forwardToAppsScript(rawBody);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return textResponse("method not allowed", 405);

  const rawBody = await req.text();

  try {
    await verifySlackSignature(req, rawBody);
    const payload = parseSlackPayload(rawBody);
    if (!payload || payload.type !== "block_actions") return textResponse("");

    const backgroundTask = processSlackInteraction(payload, rawBody).catch((error) => {
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
