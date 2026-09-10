/**
 * The Managers roster, taken from the managers Slack channel.
 *
 * Why it is not the PMS Level column
 * ----------------------------------
 * The Managers summary group used to select rows whose `PMS Level` matched
 * /^m\d+$/. That column is populated from the PMS master sheet by
 * syncPmsLevelsToLog(), and it is currently EMPTY for most of the Log — so the
 * group resolved to 22 people out of the 62 sitting in the channel, which is
 * what Gunjan and Chinmaya flagged on 2026-09-01 ("only 22/62 members captured
 * in the WFO report").
 *
 * The channel is the definition anyone actually maintains: people are added to
 * it when they become a manager. So the channel membership IS the roster, and
 * this sync mirrors it into a "Managers" tab that the summary reads exactly the
 * way it reads the hand-maintained FLG tab.
 *
 * The tab is MACHINE-OWNED — every sync clears and rewrites it, so a hand-typed
 * row does not survive. Add the person to the Slack channel instead; that is
 * the one place membership lives, and it is the place that is already kept up
 * to date.
 *
 * Emails come from the MissionHQ Log's own `Slack User ID` column wherever
 * possible (free, and an exact join), and only fall back to a users.info call
 * per unmatched member. After one employee sync that fallback is rare.
 *
 * Needs the bot scopes channels:read (public channel) or groups:read + channel
 * membership (private), plus users:read / users:read.email for the fallback.
 */

// Kept in step by hand with the "managers" group in SUMMARY_GROUPS
// (FortnightlySummary.js), which spells both out as literals — see the comment
// there for why it cannot read these constants directly.
const MANAGERS_ROSTER_SHEET_NAME = "Managers";
const MANAGERS_GROUP_KEY = "managers";
const MANAGERS_ROSTER_HEADERS = ["Full Name", "Email Address", "Slack User ID", "Source"];

// conversations.members is Tier 2 (~20 req/min); pages are 200 ids each, so a
// channel of any realistic size is one or two calls.
const MANAGERS_MEMBERS_PAGE_SIZE = 200;
const MANAGERS_MEMBERS_MAX_PAGES = 10;

/**
 * Rebuilds the "Managers" tab from the managers Slack channel.
 *
 * Menu: **Sync Managers Roster**. Also runs automatically at the start of every
 * real summary send, so the fortnightly report never goes out against a stale
 * membership list.
 *
 * @return {{success: boolean, members: number, matched: number, lookedUp: number,
 *           bots: number, skipped: number, message: string}}
 */
function syncManagersRosterFromSlack(preReadLog) {
  const channelId = getManagersChannelId_();
  const fetched = fetchSlackChannelMemberIds_(channelId);
  if (!fetched.ok) {
    throw new Error(`Could not read members of ${channelId}: ${fetched.error}`);
  }
  Logger.log(`Managers channel ${channelId}: ${fetched.ids.length} member(s) reported by Slack.`);

  const bySlackId = buildLogIndexBySlackId_(preReadLog);
  const rows = [];
  const seenEmails = {};
  // Bots are kept apart from people on purpose. A channel like this always has
  // at least one app in it (the HV Automation bot posts the summary there), so
  // lumping them together would fire the alert below on every single sync — and
  // an alert that always fires is one nobody reads. A skipped BOT is the system
  // working; a skipped PERSON is a missing row in a published ranking.
  const skippedBots = [];
  const skippedPeople = [];
  let matched = 0;
  let lookedUp = 0;

  fetched.ids.forEach(slackId => {
    let name = "";
    let email = "";
    let source = "";

    const logRow = bySlackId[slackId];
    if (logRow) {
      name = logRow.name;
      email = logRow.email;
      source = "MissionHQ Log";
      matched++;
    } else {
      // Not in the Log by Slack id — either a new hire whose id has not been
      // cached yet, or a bot. users.info settles both.
      //
      // ALWAYS the attendance bot, never fetched.token. That token is whichever
      // one could read the channel, and the whole reason the fallback exists is
      // a private channel the attendance bot cannot see — in exactly that case
      // fetched.token is the HV Automation bot, which holds chat:write and
      // chat:write.customize and NOT users:read.email. Every lookup would come
      // back missing_scope and drop the member, and the people needing the
      // lookup are the recent hires whose Slack id the Log has not cached yet.
      // Dropping them quietly is a smaller copy of the 22-of-62 bug this file
      // exists to fix. users.info needs no channel access, so the attendance
      // bot can answer it whether or not it is in the channel.
      const info = fetchSlackUserForRoster_(slackId, SLACK_BOT_TOKEN);
      lookedUp++;
      if (!info.ok) {
        // Unknown, so treated as a person: a lookup that failed is exactly the
        // case worth being told about.
        skippedPeople.push(`${slackId} (${info.error})`);
        return;
      }
      if (info.isBot) {
        skippedBots.push(slackId);
        return;
      }
      if (info.deleted || !info.email) {
        skippedPeople.push(`${slackId} (${info.deleted ? "deactivated" : "no email"})`);
        return;
      }
      name = info.name;
      email = info.email;
      source = "Slack users.info";
    }

    const key = email.toLowerCase();
    if (!key || key in seenEmails) return;
    seenEmails[key] = true;
    rows.push([name, key, slackId, source]);
  });

  if (rows.length === 0) {
    // Never blank the tab on an empty read — a transient Slack failure would
    // otherwise wipe the roster and take the Managers summary down with it.
    throw new Error(
      `Managers channel ${channelId} resolved to 0 usable members — the "${MANAGERS_ROSTER_SHEET_NAME}" tab was left untouched`
    );
  }

  rows.sort((a, b) => a[0].localeCompare(b[0]));
  writeManagersRosterSheet_(rows);

  if (skippedBots.length > 0) {
    Logger.log(`Managers roster: ${skippedBots.length} bot(s) in the channel, not rostered — ${skippedBots.join(", ")}`);
  }
  if (skippedPeople.length > 0) {
    Logger.log(`Managers roster: ${skippedPeople.length} member(s) skipped — ${skippedPeople.join(", ")}`);
    // The execution log is where a short Managers report went unnoticed for a
    // fortnight. A channel member who does not reach the roster is a person
    // missing from a published ranking, so say it out loud. The count stays OUT
    // of the title: sendErrorAlert dedupes on function + message, and a varying
    // number there would defeat the 30-minute cooldown.
    sendErrorAlert(
      `Managers roster: some channel members could not be resolved and are missing from the summary`,
      {
        functionName: 'syncManagersRosterFromSlack',
        sheetName: MANAGERS_ROSTER_SHEET_NAME,
        additionalInfo:
          `${skippedPeople.length} of ${fetched.ids.length} member(s) of <#${channelId}> were skipped: ` +
          `${skippedPeople.join(", ")}. Each one is a person in the channel who will be missing from ` +
          `the next Managers summary.`,
      }
    );
  }
  const message =
    `Managers roster: ${rows.length} written (${matched} from the Log, ${lookedUp} looked up in Slack, ` +
    `${skippedBots.length} bot(s), ${skippedPeople.length} skipped) from ${fetched.ids.length} channel member(s).`;
  Logger.log(message);
  logToDumpSheet(message);

  return {
    success: true,
    members: rows.length,
    matched: matched,
    lookedUp: lookedUp,
    bots: skippedBots.length,
    skipped: skippedPeople.length,
    message: message
  };
}

/**
 * Refreshes the roster without letting a Slack failure take the summary run
 * down with it — a stale roster still produces a report, no roster does not.
 */
function refreshManagersRosterBestEffort_(preReadLog) {
  try {
    return syncManagersRosterFromSlack(preReadLog);
  } catch (error) {
    Logger.log(`Managers roster refresh failed, using the tab as it stands: ${error.message}`);
    logToDumpSheet(`Managers roster refresh failed: ${error.message}`);
    // Swallowing this is what a silently short report looks like from the
    // inside: the summary still posts, just against whatever the tab held last
    // time. Best-effort means the run survives, not that nobody is told.
    sendErrorAlert(
      `Managers roster refresh failed — the summary is being built from a stale roster: ${error.message}`,
      {
        functionName: 'refreshManagersRosterBestEffort_',
        sheetName: MANAGERS_ROSTER_SHEET_NAME,
        additionalInfo:
          `Anyone added to the managers channel since the last successful sync is missing from ` +
          `this report. Run *Sync Managers Roster* from the MissionHQ menu and re-send.`,
      }
    );
    return { success: false, message: error.message };
  }
}

/** The channel the Managers summary posts to is also where its members live. */
function getManagersChannelId_() {
  const group = SUMMARY_GROUPS.filter(item => item.key === MANAGERS_GROUP_KEY)[0];
  if (!group || !group.channelId) {
    throw new Error(`No channelId configured for the "${MANAGERS_GROUP_KEY}" summary group`);
  }
  return group.channelId;
}

/**
 * Every member id in a channel, paged.
 *
 * Tries the attendance bot first and falls back to the HV Automation bot, which
 * is the one that already posts the summary into this channel — for a private
 * channel only a member app can list it, and that is the member.
 *
 * @return {{ok: boolean, ids: string[], token: string, error: string}}
 */
function fetchSlackChannelMemberIds_(channelId) {
  const tokens = [{ label: "attendance bot", token: SLACK_BOT_TOKEN }];
  try {
    const summaryToken = getSummaryBotToken_();
    if (summaryToken && summaryToken !== SLACK_BOT_TOKEN) {
      tokens.push({ label: "HV Automation bot", token: summaryToken });
    }
  } catch (error) {
    Logger.log(`No summary bot token available as a fallback: ${error.message}`);
  }

  let lastError = "unknown";
  for (let t = 0; t < tokens.length; t++) {
    const ids = [];
    let cursor = "";
    let failed = "";

    for (let page = 0; page < MANAGERS_MEMBERS_MAX_PAGES; page++) {
      let url =
        `https://slack.com/api/conversations.members?channel=${encodeURIComponent(channelId)}` +
        `&limit=${MANAGERS_MEMBERS_PAGE_SIZE}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

      const json = slackGet_(url, tokens[t].token);
      if (!json.ok) {
        failed = json.error || "conversations_members_failed";
        break;
      }
      (json.members || []).forEach(id => ids.push(id));
      cursor = (json.response_metadata && json.response_metadata.next_cursor) || "";
      if (!cursor) break;

      // Say so rather than returning a truncated list that reads like a whole
      // one. The cap is 2000 members, so this should never fire.
      if (page === MANAGERS_MEMBERS_MAX_PAGES - 1) {
        Logger.log(
          `conversations.members hit the ${MANAGERS_MEMBERS_MAX_PAGES}-page cap with more to read — ` +
          `${ids.length} id(s) collected, the rest are NOT in this roster`
        );
      }
    }

    if (!failed) return { ok: true, ids: ids, token: tokens[t].token, error: "" };

    lastError = `${failed} (as ${tokens[t].label})`;
    Logger.log(`conversations.members failed: ${lastError}`);
  }

  return { ok: false, ids: [], token: "", error: lastError };
}

/**
 * Slack user id -> { name, email } for every Log row that has both.
 *
 * `preReadLog` is an already-read `{ headers, rows }` of the same grid — the
 * summary run has one in hand, and the Log is ~350 rows wide by every date
 * column ever, so reading it twice in one run is pure waste. Anything that is
 * not that exact shape (a trigger event object, say) is ignored and the sheet is
 * read here.
 */
function buildLogIndexBySlackId_(preReadLog) {
  const usable = preReadLog &&
    Array.isArray(preReadLog.headers) &&
    Array.isArray(preReadLog.rows);

  let headers;
  let bodyRows;
  if (usable) {
    headers = preReadLog.headers.map(header => header.toString().trim());
    bodyRows = preReadLog.rows;
  } else {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
    if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);
    const data = sheet.getDataRange().getDisplayValues();
    headers = data[0].map(header => header.toString().trim());
    bodyRows = data.slice(1);
  }
  const nameColIndex = headers.indexOf("Full Name");
  const emailColIndex = headers.indexOf("Email Address");
  const slackIdColIndex = headers.indexOf(SLACK_USER_ID_COLUMN);
  if (emailColIndex === -1) throw new Error(`Column "Email Address" not found in ${CANDIDATE_SHEET_NAME}`);

  const index = {};
  if (slackIdColIndex === -1) {
    Logger.log(`No "${SLACK_USER_ID_COLUMN}" column in ${CANDIDATE_SHEET_NAME} — every member will be looked up in Slack`);
    return index;
  }

  bodyRows.forEach(row => {
    const slackId = (row[slackIdColIndex] || "").toString().trim();
    const email = (row[emailColIndex] || "").toString().trim();
    if (!slackId || !email) return;
    if (index[slackId]) return; // first row wins; duplicates are a sheet problem
    index[slackId] = {
      name: nameColIndex !== -1 ? (row[nameColIndex] || "").toString().trim() : "",
      email: email
    };
  });
  return index;
}

/** users.info for one member, for ids the Log does not know. */
function fetchSlackUserForRoster_(slackId, token) {
  const json = slackGet_(
    `https://slack.com/api/users.info?user=${encodeURIComponent(slackId)}`,
    token
  );
  if (!json.ok) return { ok: false, error: json.error || "users_info_failed" };

  const user = json.user || {};
  const profile = user.profile || {};
  return {
    ok: true,
    isBot: !!user.is_bot || slackId === "USLACKBOT",
    deleted: !!user.deleted,
    email: (profile.email || "").toString().trim(),
    name: (profile.real_name || user.real_name || user.name || "").toString().trim(),
    error: ""
  };
}

/**
 * Clears and rewrites the tab. Created on first run; the header row is rewritten
 * every time so the sheet cannot drift out of the shape readRosterEmails_()
 * expects.
 */
function writeManagersRosterSheet_(rows) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(MANAGERS_ROSTER_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(MANAGERS_ROSTER_SHEET_NAME);
    Logger.log(`Created the "${MANAGERS_ROSTER_SHEET_NAME}" tab.`);
  }

  sheet.clear();
  sheet.getRange(1, 1, 1, MANAGERS_ROSTER_HEADERS.length).setValues([MANAGERS_ROSTER_HEADERS]);
  sheet.getRange(1, 1, 1, MANAGERS_ROSTER_HEADERS.length).setFontWeight("bold");
  sheet.getRange(2, 1, rows.length, MANAGERS_ROSTER_HEADERS.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, MANAGERS_ROSTER_HEADERS.length);

  // The tab is rebuilt from Slack on every sync, so say so on the sheet itself
  // rather than only in this file.
  sheet.getRange(1, 1).setNote(
    `Rebuilt from the managers Slack channel by syncManagersRosterFromSlack().\n` +
    `Edits here are overwritten — add or remove people in the Slack channel instead.\n` +
    `Last synced: ${Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss")} IST.`
  );
  SpreadsheetApp.flush();
}

/** Logs the roster as it stands without touching Slack. */
function logManagersRoster() {
  const emails = readRosterEmails_(MANAGERS_ROSTER_SHEET_NAME);
  Logger.log(`"${MANAGERS_ROSTER_SHEET_NAME}" tab holds ${emails.length} email(s):`);
  emails.forEach(email => Logger.log(`  ${email}`));
  return emails.length;
}
