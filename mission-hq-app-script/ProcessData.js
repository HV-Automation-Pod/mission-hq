function isWeekend() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekendDay = dayOfWeek === 0 || dayOfWeek === 6;

  console.log(`Today is ${isWeekendDay ? '' : 'not '}a weekend day.`);
  return isWeekendDay;
}

function isHoliday() {
  // List of holidays in "MM/DD" format
  const holidays = ["01/01", "01/15", "01/26", "03/04", "03/20", "03/31", "04/03", "05/01", "08/15", "10/02", "11/01", "11/09", "11/10", "12/25"];
  let checkDate;
  // If no date provided, use today
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(today.getDate()).padStart(2, '0');
  checkDate = `${month}/${day}`;

  const isHolidayToday = holidays.includes(checkDate);

  console.log(`Today (${checkDate}) is ${isHolidayToday ? '' : 'not '}a holiday.`);

  return isHolidayToday;
}

function fallbackProcessEmailsAndSendSlackMessage () {
  processEmailsAndSendSlackMessage()
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

    // Optional columns whose values ride along inside the Submit button value.
    const deptColIndex = headers.indexOf("Department");
    const locColIndex = headers.indexOf("Location");

    let currentStep = parseInt(props.getProperty('currentStep') || '0', 10);
    let currentFact = parseInt(props.getProperty('currentFact') || '0', 10);
    let sentCount = 0;
    let failedCount = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row) {
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
          const userInfo = getUserInfoByEmail(email);
          if (!userInfo || !userInfo.id) throw new Error(`No user found for email ${email}`);
          const result = collectEmployeeLocationMessage(userInfo.id, name, email, currentStep, currentFact, department, location);
          if (result.success) {
            sheet.getRange(i + 1, dateColIndex + 1).setValue("Pending");
            SpreadsheetApp.flush();
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

    let sentCount = 0;
    let failedCount = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      let status = row[dateColIndex];
      if (status === "Pending") { // Changed from = to === for correct comparison
        const email = row[emailColIndex]?.toString().trim();
        const name = row[nameColIndex]?.toString().trim();
        if (!email || !name) {
          Logger.log(`Skipping row ${i + 1}: Empty email or name`);
          failedCount++;
          continue;
        }
        console.log(email);
        try {
          const userInfo = getUserInfoByEmail(email);
          if (!userInfo || !userInfo.id) throw new Error(`No user found for email ${email}`);
          let textMessage = `📍 ${name}, please submit your location for today. Are you at HQ, home, or on-site? Update now to keep MissionHQ informed.`
          const result = sendSlackConfirmationMessage(userInfo.id, textMessage);
          if (result.success) {
            sheet.getRange(i + 1, dateColIndex + 1).setValue("Pending");
            SpreadsheetApp.flush();
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
