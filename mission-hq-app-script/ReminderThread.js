/**
 * Threaded reminders + cleanup of the old standalone reminder DMs.
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
 * (conversations.history) and chat:write. Deleting also needs the messages to
 * have been posted by this same bot.
 */

// The standalone reminder text, used both to send and to find/delete the old ones.
const REMINDER_BODY =
  "please submit your location for today. Are you at HQ, home, or on-site? Update now to keep MissionHQ informed.";
const REMINDER_MATCH_RE = /please submit your location for today/i;

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

// ---------------------------------------------------------------------------
// Cleanup of the old standalone reminder DMs
// ---------------------------------------------------------------------------

/** DRY RUN — lists the standalone reminder messages that would be deleted. */
function previewDeleteStandaloneReminders() {
  return cleanUpStandaloneReminders_(true);
}

/** REAL RUN — deletes every standalone reminder DM this bot has posted. */
function deleteStandaloneReminders() {
  return cleanUpStandaloneReminders_(false);
}

/**
 * Walks every employee's DM and removes the old top-level reminder messages.
 *
 * conversations.history returns only top-level messages, so the new threaded
 * reminders are never returned here and cannot be deleted by mistake — only the
 * standalone ones this is meant to clean up.
 *
 * Checkpoints its progress like the recovery scan, since deleting across ~350
 * DMs cannot finish inside one execution. Run repeatedly until it says COMPLETE.
 */
function cleanUpStandaloneReminders_(dryRun) {
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  const cursorKey = "REMINDER_CLEANUP_ROW";
  const startRow = parseInt(props.getProperty(cursorKey) || "1", 10);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0].map(h => h.toString().trim());
  const emailColIndex = headers.indexOf("Email Address");
  const slackIdColIndex = headers.indexOf(SLACK_USER_ID_COLUMN);
  if (emailColIndex === -1) throw new Error("Email Address column not found");

  Logger.log("=".repeat(78));
  Logger.log(`Standalone reminder cleanup — ${dryRun ? "PREVIEW (nothing deleted)" : "DELETING"}`);
  Logger.log(`Resuming from data row ${startRow + 1} of ${data.length - 1}`);
  Logger.log("=".repeat(78));

  let scanned = 0;
  let found = 0;
  let deleted = 0;
  let failed = 0;
  let timedOut = false;
  let lastRow = startRow;

  for (let i = Math.max(startRow, 1); i < data.length; i++) {
    lastRow = i;
    if (Date.now() - started > MISSED_SCAN_TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    const email = (data[i][emailColIndex] || "").toString().trim();
    if (!email) continue;

    let slackId = slackIdColIndex !== -1 ? (data[i][slackIdColIndex] || "").toString().trim() : "";
    if (!slackId) {
      const info = getUserInfoByEmail(email);
      slackId = info && info.id ? info.id : "";
    }
    if (!slackId) continue;

    const dmChannel = openDmChannelId_(slackId);
    if (!dmChannel) {
      Logger.log(`row ${i + 1} ${email}: could not open DM — skipped`);
      continue;
    }
    scanned++;

    const reminders = findStandaloneReminders_(dmChannel);
    reminders.forEach(ts => {
      found++;
      if (dryRun) {
        Logger.log(`WOULD DELETE  ${email}  ts=${ts}  (${formatSlackTs_(parseFloat(ts))})`);
        return;
      }
      const result = slackPost_("https://slack.com/api/chat.delete", { channel: dmChannel, ts: ts });
      if (result.ok) {
        deleted++;
        Logger.log(`DELETED  ${email}  ts=${ts}`);
      } else {
        failed++;
        Logger.log(`FAILED   ${email}  ts=${ts}: ${result.error}`);
      }
      Utilities.sleep(400); // chat.delete is Tier 3
    });

    Utilities.sleep(MISSED_SCAN_SLACK_PAUSE_MS);
  }

  const complete = !timedOut;
  if (complete) {
    props.deleteProperty(cursorKey);
  } else {
    props.setProperty(cursorKey, lastRow.toString());
  }

  Logger.log("-".repeat(78));
  Logger.log(`DMs scanned        : ${scanned}`);
  Logger.log(`Reminders found    : ${found}`);
  if (!dryRun) {
    Logger.log(`Deleted            : ${deleted}`);
    Logger.log(`Failed to delete   : ${failed}`);
  }
  Logger.log(`Status             : ${complete ? "COMPLETE" : "PAUSED — run again to resume"}`);
  if (dryRun) Logger.log("Dry run — nothing was deleted. Run deleteStandaloneReminders() to apply.");

  return { success: true, complete: complete, scanned: scanned, found: found, deleted: deleted, failed: failed };
}

/** Every top-level reminder message this bot posted in the given DM. */
function findStandaloneReminders_(dmChannel) {
  const timestamps = [];
  let cursor = "";

  for (let page = 0; page < MISSED_SCAN_MAX_HISTORY_PAGES; page++) {
    let url = `https://slack.com/api/conversations.history?channel=${encodeURIComponent(dmChannel)}&limit=200`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const json = slackGet_(url);
    if (!json.ok) break;

    (json.messages || []).forEach(message => {
      const text = (message.text || "").toString();
      if (!REMINDER_MATCH_RE.test(text)) return;
      // Only this bot's own messages can be deleted with the bot token.
      if (!message.bot_id && !message.app_id) return;
      timestamps.push(message.ts);
    });

    cursor = (json.response_metadata && json.response_metadata.next_cursor) || "";
    if (!json.has_more || !cursor) break;
  }

  return timestamps;
}

/** Clears the cleanup checkpoint so the next run starts from the first row. */
function resetReminderCleanup() {
  PropertiesService.getScriptProperties().deleteProperty("REMINDER_CLEANUP_ROW");
  Logger.log("Reminder cleanup cursor cleared.");
}
