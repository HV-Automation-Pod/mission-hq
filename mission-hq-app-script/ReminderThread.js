/**
 * Threaded reminders.
 *
 * The afternoon reminder used to be posted as a NEW DM, which left the day's
 * conversation looking like two unrelated messages — the prompt with its Submit
 * button, then a nag with no button attached to it. It is now posted as a reply
 * in the thread of that day's prompt, so the reminder sits directly under the
 * message the person has to act on, and the whole day is one thread.
 *
 * Finding the parent: the prompt's Submit button carries
 * `submit_location_<date>...` in its value, so the day's prompt is identified by
 * reading the DM history and matching that date — no message timestamp needs to
 * be stored anywhere. The "Messages TS" sheet is consulted first purely as a
 * free shortcut; the Slack lookup is what makes it correct.
 *
 * Needs bot scopes im:write (conversations.open), im:history
 * (conversations.history) and chat:write.
 *
 * The one-off cleanup that deleted the old standalone reminder DMs lived here
 * and has been removed now that it has run, in the same way the confirmation
 * backfill was. If it is ever needed again: page conversations.history per DM,
 * match /please submit your location for today/i on messages carrying a
 * bot_id/app_id, and chat.delete them. Threaded replies are never returned by
 * conversations.history, so current reminders are not at risk.
 */

// The reminder body, appended after the @-mention.
const REMINDER_BODY =
  "please submit your location for today. Are you at HQ, home, or on-site? Update now to keep MissionHQ informed.";

// Caches the DM channel id per employee so the reminder run does not call
// conversations.open for everyone every day.
const DM_CHANNEL_COLUMN = "DM Channel ID";

/**
 * Posts the daily reminder as a threaded reply under that day's prompt.
 *
 * The user is tagged with a real Slack mention (<@U…>) rather than their plain
 * name: a thread reply is easy to miss, and the mention is what actually raises
 * a notification.
 *
 * Falls back to a normal top-level DM if the day's prompt cannot be found —
 * a reminder that is threaded wrong is better than no reminder at all.
 *
 * @return {{success: boolean, threaded: boolean, message: string}}
 */
function sendLocationReminder_(slackId, dmChannel, date, email) {
  const text = `📍 <@${slackId}>, ${REMINDER_BODY}`;

  let threadTs = "";
  try {
    threadTs = findPromptMessageTs_(dmChannel, date, email) || "";
  } catch (error) {
    Logger.log(`Could not locate the prompt for ${slackId} on ${date}: ${error.message}`);
  }

  const payload = { channel: dmChannel || slackId, text: text };
  if (threadTs) payload.thread_ts = threadTs;

  const json = slackPost_("https://slack.com/api/chat.postMessage", payload);
  if (!json.ok) {
    return { success: false, threaded: false, message: `Slack API error: ${json.error}` };
  }
  return {
    success: true,
    threaded: !!threadTs,
    message: threadTs ? `Threaded under ${threadTs}` : "Posted as a new message (prompt not found)"
  };
}

/**
 * Finds the timestamp of the prompt message for `date` in this DM.
 *
 * Matches on the Submit button's value (`submit_location_<date>...`) rather than
 * the message text, because the greeting line rotates daily through MESSAGES
 * while the button value always names the date it records against.
 */
function findPromptMessageTs_(dmChannel, date, email) {
  if (!dmChannel) return "";

  // From the sheet first — free, and correct for anything sent today.
  const cached = lookupMessageTsFromSheet_(email, date);
  if (cached) return cached;

  const oldest = Math.floor(new Date(`${date}T00:00:00+05:30`).getTime() / 1000);
  const latest = oldest + 36 * 60 * 60; // the prompt is same-day; allow slack for late runs
  const url =
    `https://slack.com/api/conversations.history?channel=${encodeURIComponent(dmChannel)}` +
    `&limit=50&oldest=${oldest}&latest=${latest}`;

  const json = slackGet_(url);
  if (!json.ok) return "";

  const marker = `submit_location_${date}`;
  const match = (json.messages || []).find(message =>
    (message.blocks || []).some(block =>
      (block.elements || []).some(element =>
        typeof element.value === "string" && element.value.indexOf(marker) === 0
      )
    )
  );
  return match ? match.ts : "";
}

/**
 * The prompt flow already appends each sent message's ts to "Messages TS", so
 * check there before spending a Slack API call.
 *
 * Matched on Email ID, not Channel ID: updateEmployeeMessageTS() only ever fills
 * Email ID / Message Ts / Date, so the Channel ID column is empty even though
 * the header exists. Values are written wrapped in quotes to stop Sheets
 * coercing them to numbers, hence the strip.
 */
function lookupMessageTsFromSheet_(email, date) {
  if (!email) return "";
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Messages TS");
    if (!sheet) return "";
    const data = sheet.getDataRange().getDisplayValues();
    if (data.length < 2) return "";
    const headers = data[0].map(h => h.toString().trim().toLowerCase());
    const emailCol = headers.indexOf("email id");
    const tsCol = headers.indexOf("message ts");
    const dateCol = headers.indexOf("date");
    if (tsCol === -1 || dateCol === -1 || emailCol === -1) return "";

    const target = email.toLowerCase();
    // Newest first — a resent prompt should win.
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][dateCol].toString().trim() !== date) continue;
      if (data[i][emailCol].toString().trim().toLowerCase() !== target) continue;
      const ts = data[i][tsCol].toString().trim().replace(/^"|"$/g, "");
      if (ts) return ts;
    }
  } catch (error) {
    Logger.log(`Messages TS lookup failed: ${error.message}`);
  }
  return "";
}

/** Opens (or reuses) the DM channel for a Slack user id. */
function openDmChannelId_(slackId) {
  const json = slackPost_("https://slack.com/api/conversations.open", { users: slackId });
  return json.ok && json.channel && json.channel.id ? json.channel.id : "";
}
