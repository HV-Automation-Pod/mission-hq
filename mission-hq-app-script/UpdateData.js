function updateEmployeeMessageTS(email = "user@example.com", messageTs = "MESSAGE_TS") {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName("Messages TS");
    if (!logSheet) {
      Logger.log('Error: Location Logs sheet not found');
      return {
        success: false,
        message: 'Location Logs sheet not found'
      };
    }

    const headers = logSheet.getDataRange().getValues()[0];
    const newRow = Array(headers.length).fill("");
    let today = new Date()
    today = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');


    // Map values to correct columns
    headers.forEach((header, index) => {
      const key = header.trim().toLowerCase();
      if (key === 'email id') newRow[index] = email;
      if (key === 'message ts') newRow[index] = `"${messageTs}"`;
      if (key === 'date') newRow[index] = today;
    });

    logSheet.appendRow(newRow);

    Logger.log('New row appended successfully');
    return {
      success: true,
      message: 'Row appended to Location Logs'
    };

  } catch (error) {
    Logger.log('Error: ' + error.message);
    return {
      success: false,
      message: 'Exception occurred: ' + error.message
    };
  }
}

function updateLocationByEmailID(userEmail = "user@example.com", location = "Client-Location", date = "2025-05-15") {
  try {
    // Validate inputs
    if (!userEmail || typeof userEmail !== 'string' || userEmail.trim() === "") {
      throw new Error("Invalid or empty email provided");
    }
    if (!location || typeof location !== 'string' || location.trim() === "") {
      throw new Error("Invalid or empty location provided");
    }

    const trimmedUserEmail = userEmail.trim();
    const trimmedLocation = location.trim();

    // Get sheet and data
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName(CANDIDATE_SHEET_NAME);
    if (!logSheet) {
      logToDumpSheet('Error: Slack Responses sheet not found');
      return {
        success: false,
        message: 'Slack Responses sheet not found'
      };
    }

    // Get all data and headers
    const data = logSheet.getDataRange().getValues();
    if (data.length < 1) {
      throw new Error('No data found in sheet');
    }
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    // console.log(headers)

    // Find email column
    const emailColIndex = headers.indexOf('email address');
    if (emailColIndex === -1) {
      logToDumpSheet('Error: Email column not found');
      return {
        success: false,
        message: 'Email column not found'
      };
    }

    // Standardize input date to YYYY-MM-DD
    let inputDate;
    try {
      inputDate = new Date(date);
      if (isNaN(inputDate)) throw new Error('Invalid date format');
      inputDate = Utilities.formatDate(inputDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } catch (e) {
      logToDumpSheet('Error: Invalid input date format');
      return {
        success: false,
        message: 'Invalid input date format: ' + e.message
      };
    }

    // Find date column by matching formatted dates
    let dateColIndex = -1;
    for (let i = 0; i < headers.length; i++) {
      try {
        const headerDate = new Date(headers[i]);
        if (isNaN(headerDate)) continue;
        const formattedHeaderDate = Utilities.formatDate(headerDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        if (formattedHeaderDate === inputDate) {
          dateColIndex = i;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (dateColIndex === -1) {
      logToDumpSheet('Error: Date column not found for ' + inputDate);
      return {
        success: false,
        message: 'Date column not found for ' + inputDate
      };
    }

    // Find and update the row with matching email
    for (let i = 1; i < data.length; i++) {
      if (data[i][emailColIndex].toString().trim() === trimmedUserEmail) {
        // Get value from getValueByLocation, fallback to original location
        logSheet.getRange(i + 1, dateColIndex + 1).setValue(formatLocationValueForSheet_(location));
        logToDumpSheet(`Location updated for Email: ${trimmedUserEmail} on ${inputDate} with value: ${location}`);
        return {
          success: true,
          message: 'Location updated successfully'
        };
      }
    }

    logToDumpSheet('Email not found: ' + trimmedUserEmail);
    return {
      success: false,
      message: 'Email not found'
    };

  } catch (error) {
    logToDumpSheet('Error: ' + error.message);
    return {
      success: false,
      message: 'Exception occurred: ' + error.message
    };
  }
}

function formatLocationValueForSheet_(location) {
  if (location === "Office-Client") return "Office + Client";
  return location.replace(/-/g, " ");
}

// Helper function to get authenticated user's ID
function getAuthenticatedUserId(token = SLACK_USER_TOKEN) {
  const url = 'https://slack.com/api/users.identity';
  const options = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const jsonResponse = JSON.parse(response.getContentText());
    if (jsonResponse.ok && jsonResponse.user && jsonResponse.user.id) {
      return { id: jsonResponse.user.id };
    } else {
      Logger.log(`Error fetching authenticated user ID: ${jsonResponse.error || 'No user ID returned'}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Error fetching authenticated user ID: ${error.message}`);
    return null;
  }
}

function updateNamesFromSlack() {
  // Get the active spreadsheet and the sheet named "MissionHQ Log"
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName("MissionHQ Log");

  if (!sheet) {
    Logger.log("Sheet 'MissionHQ Log' not found.");
    return;
  }

  // Get all data from the sheet
  const dataRange = sheet.getDataRange();
  const data = dataRange.getValues();

  // Assuming headers are in the first row
  const headers = data[0];
  const emailColIndex = headers.indexOf("Email Address");
  const nameColIndex = headers.indexOf("Full Name");

  if (emailColIndex === -1 || nameColIndex === -1) {
    Logger.log("Required columns 'Full Name' or 'Email Address' not found.");
    return;
  }

  // Process each row starting from the second row (index 1)
  for (let i = 1; i < data.length; i++) {
    const email = data[i][emailColIndex]?.toString().trim();
    const name = data[i][nameColIndex]?.toString().trim();

    // Check if email exists and name is empty
    if (email && !name) {
      // Fetch user info from Slack
      const userInfo = getUserInfoByEmail(email, SLACK_BOT_TOKEN);

      if (userInfo && userInfo.name) {
        // Update the name in the sheet (adding 1 to row index since sheet rows are 1-based)
        sheet.getRange(i + 1, nameColIndex + 1).setValue(userInfo.name);
        Logger.log(`Updated name for ${email} to ${userInfo.name}`);
      } else {
        Logger.log(`No user info found for ${email}`);
      }
    }
  }

  // Flush any pending changes
  SpreadsheetApp.flush();
}
