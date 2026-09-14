// isWeekend() / isHoliday() used to live here. They now live in WorkCalendar.js,
// which is also what the other automations reach through the MissionHQ library —
// one holiday list for the whole org. The call sites below are unchanged.

function fallbackProcessEmailsAndSendSlackMessage () {
  processEmailsAndSendSlackMessage()
}

function getOrCreateColumnIndex_(sheet, columnName) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
    .map(header => header.toString().trim());
  const existing = headers.indexOf(columnName);
  if (existing !== -1) return { index: existing, created: false };

  const newCol = lastCol + 1;
  sheet.insertColumnAfter(lastCol); // grows the grid so newCol always exists
  sheet.getRange(1, newCol).setValue(columnName);
  SpreadsheetApp.flush();
  return { index: newCol - 1, created: true };
}

function processEmailsAndSendSlackMessage() {
  if (isWeekend() || isHoliday()) {
    console.log("Today is a weekend or holiday. No messages will be sent.");
    return {
      success: true,
      message: "No processing on weekends"
    };
  }
  try {
    const props = PropertiesService.getScriptProperties();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
    if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);
    let data = sheet.getDataRange().getDisplayValues(); // Initial data fetch
    let headers = data[0].map(header => header.toString().trim());
    const nameColIndex = headers.indexOf("Full Name");
    const emailColIndex = headers.indexOf("Email Address");
    const baseDateColIndex = headers.indexOf("Date");
    if (nameColIndex === -1 || emailColIndex === -1 || baseDateColIndex === -1) throw new Error(`Required columns (Full Name, Email Address, Date) not found`);
    const today = new Date();
    const todayDate = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    console.log(todayDate);
    // console.log(headers);
    let dateColIndex = headers.indexOf(todayDate); // Use todayDate, not today
    // console.log(dateColIndex);
    if (dateColIndex === -1) {
      console.log("Creating new date column");
      sheet.insertColumnAfter(baseDateColIndex + 1);
      sheet.getRange(1, baseDateColIndex + 2).setValue(todayDate);
      SpreadsheetApp.flush();
      dateColIndex = baseDateColIndex + 1;
      // Refresh the sheet data and headers after inserting the new column
      data = sheet.getDataRange().getDisplayValues();
      headers = data[0].map(header => header.toString().trim());
      // console.log("Refreshed headers:", headers); // Log to confirm refreshed headers
    }

    try {
      const leaveSyncResult = syncZohoPeopleLeavesForDate(todayDate);
      Logger.log(`Zoho People leave sync completed before Slack prompts: ${JSON.stringify(leaveSyncResult)}`);
      data = sheet.getDataRange().getDisplayValues();
      headers = data[0].map(header => header.toString().trim());
      dateColIndex = headers.indexOf(todayDate);
    } catch (leaveSyncError) {
      Logger.log(`Zoho People leave sync failed before Slack prompts: ${leaveSyncError.message}`);
      logToDumpSheet(`Zoho People leave sync failed before Slack prompts: ${leaveSyncError.message}`);
    }

    const slackIdCol = getOrCreateColumnIndex_(sheet, SLACK_USER_ID_COLUMN);
    if (slackIdCol.created) {
      data = sheet.getDataRange().getDisplayValues();
      headers = data[0].map(header => header.toString().trim());
      dateColIndex = headers.indexOf(todayDate);
    }
    const slackIdColIndex = slackIdCol.index;

    // Offboarded people and approved exceptions. Skipped before any Slack call,
    // so a deactivated account is never messaged and their cell stays blank —
    // which is what marks them absent-by-design rather than unanswered.
    const exemptCol = getOrCreateColumnIndex_(sheet, WFO_EXEMPT_COLUMN);
    if (exemptCol.created) {
      data = sheet.getDataRange().getDisplayValues();
      headers = data[0].map(header => header.toString().trim());
      dateColIndex = headers.indexOf(todayDate);
    }
    const exemptColIndex = exemptCol.index;

    // Optional columns whose values ride along inside the Submit button value.
    const deptColIndex = headers.indexOf("Department");
    const locColIndex = headers.indexOf("Location");

    const locations = getLocationsList();

    let currentStep = parseInt(props.getProperty('currentStep') || '0', 10);
    let currentFact = parseInt(props.getProperty('currentFact') || '0', 10);
    let sentCount = 0;
    let failedCount = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row) {
        if (exemptColIndex !== -1 && isWfoExempt_(row[exemptColIndex])) {
          Logger.log(`Skipping row ${i + 1}: ${WFO_EXEMPT_COLUMN} = "${row[exemptColIndex]}"`);
          continue;
        }
        if (row[dateColIndex]) {
          if (row[dateColIndex] === "Leave") {
            Logger.log(`Skipping row ${i + 1}: Approved Zoho leave for ${todayDate}`);
          } else {
            Logger.log(`Skipping row ${i + 1}: Already processed for ${todayDate}`);
          }
          continue;
        }
        const email = row[emailColIndex]?.toString().trim();
        const name = row[nameColIndex]?.toString().trim();
        if (!email || !name) {
          Logger.log(`Skipping row ${i + 1}: Empty email or name`);
          failedCount++;
          continue;
        }
        const department = deptColIndex !== -1 ? (row[deptColIndex]?.toString().trim() || "") : "";
        const location = locColIndex !== -1 ? (row[locColIndex]?.toString().trim() || "") : "";
        try {
          let slackId = slackIdColIndex !== -1 ? (row[slackIdColIndex]?.toString().trim() || "") : "";
          if (!slackId) {
            const userInfo = getUserInfoByEmail(email);
            if (!userInfo || !userInfo.id) throw new Error(`No user found for email ${email}`);
            slackId = userInfo.id;
            if (slackIdColIndex !== -1) {
              sheet.getRange(i + 1, slackIdColIndex + 1).setValue(slackId); // cache for next run
            }
          }
          const result = collectEmployeeLocationMessage(slackId, name, email, currentStep, currentFact, department, location, locations);
          if (result.success) {
            // Re-read the LIVE cell instead of trusting `data`, which is a
            // snapshot taken minutes ago at the top of this loop. A fast user
            // can answer between the DM landing and this line, and stamping
            // "Pending" blindly would erase the answer they just gave.
            const promptCell = sheet.getRange(i + 1, dateColIndex + 1);
            if (!promptCell.getDisplayValue().toString().trim()) {
              promptCell.setValue("Pending");
              SpreadsheetApp.flush();
            } else {
              Logger.log(`Row ${i + 1}: answered before the Pending marker was written — left as is`);
            }
            sentCount++;
          } else {
            throw new Error(result.message);
          }
          Utilities.sleep(1000);
        } catch (emailError) {
          Logger.log(`Failed to send message to ${email}: ${emailError.message}`);
          failedCount++;
        }
      }
    }

    if (sentCount > 0) {
      // Warn the admin when the trivia list is almost exhausted. `currentFact`
      // here is the index shown today (before the increment below), so this
      // fires on each of the last 3 facts (indices length-3, length-2,
      // length-1), giving buffer time to add fresh facts before it wraps.
      if (currentFact >= TRIVIA.length - 3) {
        try {
          const factsLeftAfterToday = TRIVIA.length - 1 - currentFact;
          sendSlackConfirmationMessage(
            ALERT_USER_ID,
            `⚠️ MissionHQ trivia is almost out: ${factsLeftAfterToday} fun fact(s) left after today before the list repeats. Add fresh facts to the TRIVIA array in Code.js (then reset the currentFact Script Property to 0). 🔁`
          );
          Logger.log(`Sent trivia-refill alert (${factsLeftAfterToday} left) to ALERT_USER_ID`);
        } catch (alertError) {
          Logger.log(`Failed to send trivia-refill alert: ${alertError.message}`);
        }
      }

      currentStep = (currentStep + 1) % MESSAGES.length;
      props.setProperty('currentStep', currentStep.toString());
      Logger.log(`Updated currentStep to: ${currentStep}`);
      console.log("currentStep: ", currentStep)

      currentFact = (currentFact + 1) % TRIVIA.length;
      props.setProperty('currentFact', currentFact.toString());
      Logger.log(`Updated currentFact to: ${currentFact}`);
      console.log("currentFact: ", currentFact)
    } else {
      Logger.log(`No messages sent — keeping currentStep=${currentStep}, currentFact=${currentFact}`);
    }

    Logger.log(`Email processing completed: ${sentCount} sent, ${failedCount} failed`);
    return {
      success: true,
      sent: sentCount,
      failed: failedCount
    };
  } catch (error) {
    Logger.log(`Error processing emails: ${error.message}`);
    return {
      success: false,
      message: `Error processing emails: ${error.message}`
    };
  }
}


// How long the reminder run may spend on its pre-send DM check before giving up
// on it and reminding the remaining rows the old way. Sized against Apps
// Script's 6-minute execution cap, with room for the reminders themselves.
//
// Measured from the top of the loop, not the top of the function — the sheet
// read and the getOrCreateColumnIndex_ calls before it cost a few seconds that
// this budget does not see. The margin is wide enough that it does not matter.
const REMINDER_DM_CHECK_BUDGET_MS = 3.5 * 60 * 1000;

function processPendingEmailsAndSendSlackReminder() {
  if (isWeekend() || isHoliday()) {
    console.log("Today is a weekend or holiday. No messages will be sent.");
    return {
      success: true,
      message: "No processing on weekends or holidays"
    };
  }
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
    if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);
    let data = sheet.getDataRange().getDisplayValues(); // Initial data fetch
    let headers = data[0].map(header => header.toString().trim());
    const nameColIndex = headers.indexOf("Full Name");
    const emailColIndex = headers.indexOf("Email Address");
    const baseDateColIndex = headers.indexOf("Date");
    if (nameColIndex === -1 || emailColIndex === -1 || baseDateColIndex === -1) throw new Error(`Required columns (Full Name, Email Address, Date) not found`);
    const today = new Date();
    const todayDate = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    console.log(todayDate);
    let dateColIndex = headers.indexOf(todayDate); // Use todayDate, not today
    if (dateColIndex === -1) {
      console.log("Creating new date column");
      sheet.insertColumnAfter(baseDateColIndex + 1);
      sheet.getRange(1, baseDateColIndex + 2).setValue(todayDate);
      SpreadsheetApp.flush();
      dateColIndex = baseDateColIndex + 1;
      // Refresh the sheet data and headers after inserting the new column
      data = sheet.getDataRange().getDisplayValues();
      headers = data[0].map(header => header.toString().trim());
    }

    try {
      const leaveSyncResult = syncZohoPeopleLeavesForDate(todayDate);
      Logger.log(`Zoho People leave sync completed before Slack reminders: ${JSON.stringify(leaveSyncResult)}`);
      data = sheet.getDataRange().getDisplayValues();
      headers = data[0].map(header => header.toString().trim());
      dateColIndex = headers.indexOf(todayDate);
    } catch (leaveSyncError) {
      Logger.log(`Zoho People leave sync failed before Slack reminders: ${leaveSyncError.message}`);
      logToDumpSheet(`Zoho People leave sync failed before Slack reminders: ${leaveSyncError.message}`);
    }

    // Reuse the cached Slack user IDs written by the prompt flow so reminders
    // don't call users.lookupByEmail again for each pending user.
    const slackIdCol = getOrCreateColumnIndex_(sheet, SLACK_USER_ID_COLUMN);
    if (slackIdCol.created) {
      data = sheet.getDataRange().getDisplayValues();
      headers = data[0].map(header => header.toString().trim());
      dateColIndex = headers.indexOf(todayDate);
    }
    const slackIdColIndex = slackIdCol.index;

    // DM channel ids are cached alongside the Slack user ids so the reminder
    // run doesn't re-open every conversation each afternoon.
    const dmCol = getOrCreateColumnIndex_(sheet, DM_CHANNEL_COLUMN);
    if (dmCol.created) {
      data = sheet.getDataRange().getDisplayValues();
      headers = data[0].map(header => header.toString().trim());
      dateColIndex = headers.indexOf(todayDate);
    }
    const dmColIndex = dmCol.index;

    // Same exemption as the prompt flow. It matters here too: someone marked
    // exempt today may still carry a "Pending" from this morning's run, and must
    // not be nagged about it.
    const exemptCol = getOrCreateColumnIndex_(sheet, WFO_EXEMPT_COLUMN);
    if (exemptCol.created) {
      data = sheet.getDataRange().getDisplayValues();
      headers = data[0].map(header => header.toString().trim());
      dateColIndex = headers.indexOf(todayDate);
    }
    const exemptColIndex = exemptCol.index;

    // The pre-send DM check costs one conversations.history call per pending
    // person on top of the reminder itself, and this loop already sleeps a
    // second per row. On a day with hundreds of Pending cells that is enough to
    // run into the 6-minute execution cap, which would leave the tail of the
    // sheet with no reminder at all. So the check is given a budget: past it,
    // the remaining rows are reminded the way they were before this existed.
    // The recovery sweep still repairs anything it would have caught.
    const reminderStarted = Date.now();
    let dmCheckSkippedForTime = 0;

    // Read once per run: the Locations tab, mapped label -> sheet value, so a
    // confirmation found in Slack can be written back byte-identically to what
    // the live submit path would have written.
    let labelMap = null;
    try {
      labelMap = buildLocationLabelMap_();
    } catch (labelMapError) {
      Logger.log(`Could not build the location label map — pre-reminder DM check disabled: ${labelMapError.message}`);
    }

    let sentCount = 0;
    let failedCount = 0;
    const recovered = [];      // answered in Slack, sheet repaired here, no reminder sent
    const answeredNoLabel = []; // answered in Slack but the label is unusable
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (exemptColIndex !== -1 && isWfoExempt_(row[exemptColIndex])) {
        Logger.log(`Skipping row ${i + 1}: ${WFO_EXEMPT_COLUMN} = "${row[exemptColIndex]}"`);
        continue;
      }
      let status = row[dateColIndex];
      if (status === "Pending") { // Changed from = to === for correct comparison
        const email = row[emailColIndex]?.toString().trim();
        const name = row[nameColIndex]?.toString().trim();
        if (!email || !name) {
          Logger.log(`Skipping row ${i + 1}: Empty email or name`);
          failedCount++;
          continue;
        }
        // `data` was snapshotted at the top of this loop and the loop sleeps a
        // second per user, so by the time we reach this row the snapshot can be
        // many minutes stale. Re-read live: the person may have answered
        // already, in which case they must not be nagged — and must certainly
        // not be marked Pending again.
        const liveStatus = sheet.getRange(i + 1, dateColIndex + 1).getDisplayValue().toString().trim();
        if (liveStatus !== "Pending") {
          Logger.log(`Row ${i + 1}: answered since the snapshot (now "${liveStatus}") — reminder skipped`);
          continue;
        }

        console.log(email);
        try {
          let slackId = slackIdColIndex !== -1 ? (row[slackIdColIndex]?.toString().trim() || "") : "";
          if (!slackId) {
            const userInfo = getUserInfoByEmail(email);
            if (!userInfo || !userInfo.id) throw new Error(`No user found for email ${email}`);
            slackId = userInfo.id;
            if (slackIdColIndex !== -1) {
              sheet.getRange(i + 1, slackIdColIndex + 1).setValue(slackId); // cache for next run
            }
          }
          // Reminder goes into the thread of today's prompt, not as a new DM,
          // so it sits directly under the message with the Submit button. The
          // user is @-mentioned inside it — a thread reply alone is easy to
          // miss, the mention is what raises the notification.
          let dmChannel = dmColIndex !== -1 ? (row[dmColIndex]?.toString().trim() || "") : "";
          if (!dmChannel) {
            dmChannel = openDmChannelId_(slackId);
            if (dmChannel && dmColIndex !== -1) {
              sheet.getRange(i + 1, dmColIndex + 1).setValue(dmChannel); // cache for next run
            }
          }

          // "Pending" in the sheet is not proof the person did not answer — it
          // is only proof the sheet never got the answer. When the submit path
          // dies after the edge function has already shown the confirmation
          // (see RecoverMissedResponses.js), the cell stays Pending while the
          // person is looking at "Thank you for your update!", and the reminder
          // reads as the bot losing their response. Reported by Chethan on
          // 2026-09-08: answered 10:23, nagged 14 minutes later, and the
          // recovery sweep repaired the cell afterwards.
          //
          // So ask Slack before nagging. Their DM is the source of truth: if a
          // confirmation for today is sitting there, repair the cell now and
          // stay quiet. Best-effort — if the lookup fails the reminder still
          // goes out, because a missing reminder is worse than a stray one.
          if (labelMap && Date.now() - reminderStarted > REMINDER_DM_CHECK_BUDGET_MS) {
            dmCheckSkippedForTime++;
          } else if (labelMap) {
            const answer = findDmAnswerForDate_(slackId, dmChannel, todayDate, labelMap);
            if (!answer.ok) {
              Logger.log(`Row ${i + 1}: DM check failed (${answer.error}) — reminding anyway`);
            } else if (answer.answered && answer.value) {
              const cell = sheet.getRange(i + 1, dateColIndex + 1);
              cell.setValue(answer.value);
              cell.setNote(
                `Recovered from the Slack DM confirmation (answered ${answer.confirmedAt}).\n` +
                `Label: ${answer.label}\nBackfilled before the reminder run.`
              );
              SpreadsheetApp.flush();
              logToDumpSheet(
                `Reminder run recovered a lost response: ${email} ${todayDate} -> ${answer.value} ` +
                `(confirmed in Slack at ${answer.confirmedAt})`
              );
              Logger.log(`Row ${i + 1}: ${email} already answered "${answer.label}" at ${answer.confirmedAt} — cell repaired, no reminder`);
              recovered.push({ name: name, email: email, value: answer.value, confirmedAt: answer.confirmedAt });
              // This row skips the send, but it still called conversations.history
              // — Tier 3, ~50/min. Pace it exactly like the sweep does. At 500ms
              // a burst of recoveries runs at ~100/min and earns a 429, and a
              // single Retry-After on Tier 3 is 30-60s: three of those eat the
              // whole budget below, and the day the check matters most is the
              // day it would switch itself off.
              Utilities.sleep(MISSED_SCAN_SLACK_PAUSE_MS);
              continue;
            } else if (answer.answered) {
              // They answered, but the confirmation does not name a usable
              // option (an old message with no label, or wording the Locations
              // tab no longer has), so there is nothing to write into the cell.
              //
              // The reminder still goes out. Staying quiet here would leave the
              // cell on "Pending", and Pending is NOT neutral: the fortnightly
              // summary counts it in the denominator and not in the numerator,
              // so silence would cost them a day in a published ranking. The
              // recovery sweep cannot rescue it either — it resolves labels
              // through the same map and fails identically. Asking again is the
              // only thing that actually fixes the day, and it is a genuinely
              // different situation from "we already have your answer".
              Logger.log(`Row ${i + 1}: ${email} answered at ${answer.confirmedAt} but the label is unusable (${answer.reason}) — reminding so the cell can be filled`);
              answeredNoLabel.push({ name: name, email: email, label: answer.label, reason: answer.reason, confirmedAt: answer.confirmedAt });
            }
          }

          const result = sendLocationReminder_(slackId, dmChannel, todayDate, email);
          if (result.success) {
            Logger.log(`Reminder to ${email}: ${result.message}`);
            // Deliberately does NOT write "Pending" back. The cell already said
            // Pending — that is the only reason a reminder was sent — so this
            // write was a no-op in the happy path. Its one real effect was to
            // overwrite answers that arrived between the snapshot at the top of
            // this loop and the loop reaching this row, which is how the
            // majority of the confirmed lost responses were destroyed.
            sentCount++;
          } else {
            throw new Error(result.message);
          }
          Utilities.sleep(1000);
        } catch (emailError) {
          Logger.log(`Failed to send message to ${email}: ${emailError.message}`);
          failedCount++;
        }
      }
    }

    Logger.log(
      `Email processing completed: ${sentCount} sent, ${failedCount} failed, ` +
      `${recovered.length} recovered before reminding, ${answeredNoLabel.length} answered but unrecoverable`
    );
    if (dmCheckSkippedForTime > 0) {
      Logger.log(
        `Pre-send DM check ran out of budget: ${dmCheckSkippedForTime} row(s) were reminded without it. ` +
        `The recovery sweep still covers them.`
      );
    }
    alertRemindersSuppressedByDmCheck_(todayDate, recovered, answeredNoLabel);

    return {
      success: true,
      sent: sentCount,
      failed: failedCount,
      recovered: recovered.length,
      answeredNoLabel: answeredNoLabel.length,
      dmCheckSkipped: dmCheckSkippedForTime
    };
  } catch (error) {
    Logger.log(`Error processing emails: ${error.message}`);
    return {
      success: false,
      message: `Error processing emails: ${error.message}`
    };
  }
}

/**
 * One alert per reminder run, not one per person: during a bad burst this can
 * be dozens of rows, and the point is that the submit path dropped responses at
 * all — the names are the evidence, not the headline.
 *
 * The counts live in the body rather than the title. sendErrorAlert dedupes on
 * function + message, so a number in the title would make every run a distinct
 * alert and defeat the 30-minute cooldown.
 *
 * Silent when nothing was recovered, which is the normal day.
 */
function alertRemindersSuppressedByDmCheck_(date, recovered, answeredNoLabel) {
  if (recovered.length === 0 && answeredNoLabel.length === 0) return;

  try {
    const lines = [];
    if (recovered.length > 0) {
      lines.push(`${recovered.length} person(s) had already answered in Slack while the sheet still said \`Pending\`. The cell was repaired and no reminder was sent.`);
      lines.push("");
      recovered.forEach(item => {
        lines.push(`• *${item.name || item.email}* — ${date} → \`${item.value}\`  _(answered ${item.confirmedAt})_`);
      });
    }
    if (answeredNoLabel.length > 0) {
      if (lines.length) lines.push("");
      lines.push(
        `${answeredNoLabel.length} answered in Slack, but their confirmation does not name an option ` +
        `we can read back, so there was nothing to write. They were reminded — an untouched \`Pending\` ` +
        `would count against them in the fortnightly report. Worth checking the Locations tab if the ` +
        `same wording keeps appearing:`
      );
      answeredNoLabel.forEach(item => {
        lines.push(`• *${item.name || item.email}* — _(answered ${item.confirmedAt}; ${item.reason})_`);
      });
    }
    lines.push("");
    lines.push("_Found by the reminder run's pre-send DM check. Recovery is automatic; this alert exists so the underlying submit-path failure does not stay invisible._");

    // Title the alert after whatever actually happened. It fires on either list,
    // so a fixed "N recovered" headline would post "0 attendance response(s)
    // were lost" over a body about people who could not be recovered.
    const title = recovered.length > 0
      ? `Attendance responses were lost by the submit path and recovered before reminding`
      : `Attendance responses were confirmed in Slack but cannot be read back`;

    sendErrorAlert(title, {
      functionName: 'processPendingEmailsAndSendSlackReminder',
      sheetName: CANDIDATE_SHEET_NAME,
      additionalInfo: lines.join("\n"),
    });
  } catch (alertError) {
    Logger.log(`Failed to send the reminder-suppression alert: ${alertError.message}`);
  }
}

function updateMissionHQLogFromSlackUsers() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const slackSheet = ss.getSheetByName("Slack Users");
    const logSheet = ss.getSheetByName("MissionHQ Log");

    if (!slackSheet || !logSheet) {
      throw new Error("Sheet 'Slack Users' or 'MissionHQ Log' not found");
    }

    // Get data from Slack Users sheet
    const slackData = slackSheet.getDataRange().getValues();
    const slackHeaders = slackData[0].map(header => header.toString().trim());
    const slackEmailCol = slackHeaders.indexOf("Email Address");
    const slackNameCol = slackHeaders.indexOf("Full Name");

    if (slackEmailCol === -1 || slackNameCol === -1) {
      throw new Error("Required columns 'Email ID' or 'Name' not found in Slack Users sheet");
    }

    // Get data from MissionHQ Log sheet
    const logData = logSheet.getDataRange().getValues();
    const logHeaders = logData[0].map(header => header.toString().trim());
    const logEmailCol = logHeaders.indexOf("Email Address");

    if (logEmailCol === -1) {
      throw new Error("Column 'Email ID' not found in MissionHQ Log sheet");
    }

    // Create a set of existing Email IDs for quick lookup
    const existingEmails = new Set(logData.slice(1).map(row => row[logEmailCol]?.toString().trim().toLowerCase()).filter(email => email));

    // Prepare rows to append
    const rowsToAppend = [];
    for (let i = 1; i < slackData.length; i++) {
      const email = slackData[i][slackEmailCol]?.toString().trim().toLowerCase();
      const name = slackData[i][slackNameCol]?.toString().trim();

      if (!email || !name) {
        Logger.log(`Skipping row ${i + 1} in Slack Users: Missing email or name`);
        continue;
      }

      if (!existingEmails.has(email)) {
        // Create row with Email ID and Name in the order of MissionHQ Log headers
        const newRow = new Array(logHeaders.length).fill("");
        newRow[logEmailCol] = email;
        const nameColIndex = logHeaders.indexOf("Full Name");
        if (nameColIndex !== -1) {
          newRow[nameColIndex] = name;
        }
        rowsToAppend.push(newRow);
        existingEmails.add(email); // Update set to prevent duplicates in same run
      }
    }

    // Batch append new rows
    if (rowsToAppend.length > 0) {
      logSheet.getRange(logSheet.getLastRow() + 1, 1, rowsToAppend.length, logHeaders.length).setValues(rowsToAppend);
      Logger.log(`Added ${rowsToAppend.length} new entries to MissionHQ Log`);
    } else {
      Logger.log("No new entries to add to MissionHQ Log");
    }

    return {
      success: true,
      message: `Processed ${rowsToAppend.length} new entries`
    };
  } catch (error) {
    Logger.log(`Error updating MissionHQ Log: ${error.message}`);
    return {
      success: false,
      message: `Error updating MissionHQ Log: ${error.message}`
    };
  }
}
