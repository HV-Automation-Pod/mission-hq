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

function getUserData(userId) {
  const url = `https://slack.com/api/users.info?user=${userId}`;
  const options = {
    'method': 'get',
    'headers': {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
    }
  };
  const userResponse = UrlFetchApp.fetch(url, options);
  const userData = JSON.parse(userResponse.getContentText());
  console.log(userData.user)
  return userData.ok ? { email: userData.user.profile.email, name: userData.user.profile.real_name } : 'Unknown';
}

function updateSlackProfileStatus(userId, location = "Home", date = "2025-06-24") {
  const url = 'https://slack.com/api/users.profile.set';

  // Define status configurations for Home, Leave, and Client-Location
  const statusConfig = {
    'Home': {
      status_text: 'WFH',
      status_emoji: ':working-from-home:'
    },
    'Compensatory WFH': {
      status_text: 'WFH',
      status_emoji: ':working-from-home:'
    },
    'Leave': {
      status_text: 'On Leave',
      status_emoji: ':palm_tree:'
    },
    'Client-Location': {
      status_text: 'Client Location',
      status_emoji: ':round_pushpin:'
    },
    'Travel': {
      status_text: 'Travel',
      status_emoji: ':luggage:'
    },
  };

  // Check if date matches today
  const today = new Date();
  const todayString = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
  if (date !== todayString) {
    Logger.log(`No status update for user ${userId} as date ${date} is not today (${todayString})`);
    return {
      success: true,
      message: `No status update required for date ${date}`
    };
  }

  // Only process Home, Leave, or Client-Location
  if (!['Home', 'Compensatory WFH', 'Leave', 'Client-Location', 'Travel'].includes(location)) {
    Logger.log(`No status update required for location "${location}" for user ${userId}`);
    return {
      success: true,
      message: `No status update required for location "${location}"`
    };
  }

  // Calculate expiration time (midnight today, Asia/Kolkata)
  const expirationDate = new Date(today);
  expirationDate.setHours(23, 59, 59, 999); // Set to end of today
  const expirationTimestamp = Math.floor(expirationDate.getTime() / 1000);

  // Prepare profile payload
  const profile = {
    status_text: statusConfig[location].status_text,
    status_emoji: statusConfig[location].status_emoji,
    status_expiration: expirationTimestamp
  };

  const payload = JSON.stringify({
    user: userId,
    profile: profile
  });

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${SLACK_USER_TOKEN}`
    },
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    Logger.log(`Updating Slack status for user ${userId} with location ${location}: ${JSON.stringify(profile)}`);
    const response = UrlFetchApp.fetch(url, options);
    const jsonResponse = JSON.parse(response.getContentText());

    if (jsonResponse.ok) {
      Logger.log(`Successfully updated Slack status for user ${userId} to ${location}`);
      return {
        success: true,
        message: `Slack status updated for ${userId} to ${location}`
      };
    } else {
      Logger.log(`Slack API error for user ${userId}: ${jsonResponse.error}`);
      return {
        success: false,
        message: `Slack API error: ${jsonResponse.error}`
      };
    }
  } catch (error) {
    Logger.log(`Error updating Slack status for user ${userId}: ${error.message}`);
    return {
      success: false,
      message: `Error updating Slack status: ${error.message}`
    };
  }
}

function handleLocationsPayload(payload, actionValue, userEmail, channelId, messageTimestamp, userId) {
  try {
    // Extract selected option and date from static_select action
    const firstAction = payload.actions && payload.actions[0];
    const actionId = firstAction && firstAction.action_id; // e.g., location_select_2025-10-15
    let date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    let factIndex = null;
    if (actionId && actionId.startsWith('location_select_')) {
      date = actionId.replace('location_select_', '');
    } else if (actionValue && actionValue.startsWith('submit_location_')) {
      const submitMeta = parseSubmitLocationValue_(actionValue);
      date = submitMeta.date || date;
      factIndex = submitMeta.factIndex;
    }

    const directOption = firstAction && firstAction.selected_option;
    let location = directOption ? directOption.value : null;
    let locationLabel = directOption && directOption.text ? directOption.text.text : "";
    const stateValues = payload.state && payload.state.values ? payload.state.values : {};
    const blockKeys = Object.keys(stateValues);

    if (!location) {
      for (const blockId of blockKeys) {
        const actions = stateValues[blockId];
        const actionKeys = Object.keys(actions);
        for (const actionKey of actionKeys) {
          const selectedOption = actions[actionKey]?.selected_option;
          if (selectedOption && selectedOption.value) {
            location = selectedOption.value;
            locationLabel = selectedOption.text ? selectedOption.text.text : "";
            break;
          }
        }
        if (location) break;
      }
    }

    if (!location) {
      logToDumpSheet("Missing userId or location from payload.");
      return {
        success: false,
        message: "userId or location missing in payload"
      };
    }

    const funFactText = extractFunFactFromSlackMessage_(payload.message) || getFunFactTextByIndex_(factIndex);

    // Show the selected option back so mis-clicks are easy to spot.
    const statusLabel = locationLabel || formatLocationValueForSheet_(location);
    const statusLine = statusLabel ? `\n*You selected:* ${statusLabel}` : "";

    // Create confirmation message with selected status + Fun Fact
    const confirmationMessage = `Thank you for your update! We received your response for ${date}.${statusLine}${funFactText ? `\n\n${funFactText}` : ""}`;

    // Update the original message
    updateSlackMessage(channelId, messageTimestamp, confirmationMessage);

    // Coimbatore-based employees should not get the WFH status set.
    const wfhLocations = ["Home", "Compensatory WFH"];
    const baseLocation = getEmployeeBaseLocationByEmail_(userEmail);
    const skipWfhStatus = wfhLocations.includes(location) && baseLocation.toLowerCase() === "coimbatore";
    if (!skipWfhStatus) {
      updateSlackProfileStatus(userId, location, date);
    }
    return updateLocationByEmailID(userEmail, location, date);

  } catch (error) {
    logToDumpSheet("Error in handleLocationsPayload: " + error.message);
    return {
      success: false,
      message: "Exception occurred: " + error.message
    };
  }
}

// Reads the employee's base "Location" (column D) from the MissionHQ Log sheet by email.
function getEmployeeBaseLocationByEmail_(email) {
  try {
    if (!email) return "";
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
    if (!sheet) return "";

    const data = sheet.getDataRange().getDisplayValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const emailColIndex = headers.indexOf("email address");
    const locationColIndex = headers.indexOf("location");
    if (emailColIndex === -1 || locationColIndex === -1) return "";

    const target = email.toString().trim().toLowerCase();
    for (let i = 1; i < data.length; i++) {
      if (data[i][emailColIndex].toString().trim().toLowerCase() === target) {
        return data[i][locationColIndex] ? data[i][locationColIndex].toString().trim() : "";
      }
    }
    return "";
  } catch (error) {
    logToDumpSheet("Error in getEmployeeBaseLocationByEmail_: " + error.message);
    return "";
  }
}

function parseSubmitLocationValue_(actionValue) {
  const raw = actionValue.replace('submit_location_', '');
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:_(\d+))?$/);
  if (!match) return { date: raw, factIndex: null };

  return {
    date: match[1],
    factIndex: match[2] !== undefined ? parseInt(match[2], 10) : null
  };
}

function getFunFactTextByIndex_(factIndex) {
  if (factIndex === null || factIndex === undefined || isNaN(factIndex)) return "";
  if (factIndex < 0 || factIndex >= TRIVIA.length) return "";
  return `*Fun Fact:* ${TRIVIA[factIndex]}`;
}

function extractFunFactFromSlackMessage_(message) {
  const blocks = message && Array.isArray(message.blocks) ? message.blocks : [];
  const blockTexts = blocks
    .map(block => block && block.text && block.text.text ? block.text.text : "")
    .filter(Boolean);
  const text = [message && message.text ? message.text : ""].concat(blockTexts).join("\n\n");
  const match = text.match(/\*Fun Fact:\*\s*([\s\S]*)$/);
  if (!match || !match[1]) return "";

  return `*Fun Fact:* ${match[1].trim()}`;
}

// Helper function to update Slack message
function updateSlackMessage(channelId = "CHANNEL_ID", messageTimestamp = "MESSAGE_TS", text = "hi") {
  const url = 'https://slack.com/api/chat.update';
  const payload = {
    channel: channelId,
    ts: messageTimestamp,
    text: text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: text
        }
      }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + SLACK_BOT_TOKEN,
    },
    payload: JSON.stringify(payload),
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());

    if (responseData.ok) {
      logToDumpSheet(`Message with timestamp ${messageTimestamp} updated successfully.`);
      Logger.log(`Message with timestamp ${messageTimestamp} updated successfully.`);
    } else {
      logToDumpSheet('Error updating message: ' + responseData.error);
      Logger.log('Error updating message: ' + responseData.error);
    }
  } catch (error) {
    logToDumpSheet('Error updating message: ' + error.toString());
    Logger.log('Error updating message: ' + error.toString());
  }
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
