function collectEmployeeLocationMessage(userId, name, email, currentStep, currentFact) {
  const url = 'https://slack.com/api/chat.postMessage';

  if (currentStep === undefined || currentStep === null || isNaN(currentStep)) {
    currentStep = 0;
  }
  if (currentFact === undefined || currentFact === null || isNaN(currentFact)) {
    currentFact = 0;
  }
  currentStep = currentStep % MESSAGES.length;
  currentFact = currentFact % TRIVIA.length;

  const message = MESSAGES[currentStep].replace('{name}', name);
  const trivia = TRIVIA[currentFact];

  const fullMessage = `${message}\n\n*Fun Fact:* ${trivia}`;

  const locations = getLocationsList();
  // Logger.log(`Retrieved locations: ${JSON.stringify(locations)}`);

  // Check if locations are available and valid
  if (!locations || locations.length === 0 || !locations.every(item => item.location && item.value)) {
    Logger.log(`Error: Invalid or empty locations from ${LOCATIONS_SHEET_NAME} for user ${userId}`);
    return {
      ts: null,
      success: false,
      message: `Invalid or empty locations in ${LOCATIONS_SHEET_NAME}`
    };
  }

  // Format locations for Slack dropdown
  const locationOptions = locations.map(item => ({
    text: { type: "plain_text", text: item.location },
    value: item.value.replace(/\s+/g, "-") // Replace spaces with hyphens
  }));

  const today = new Date();
  const date = Utilities.formatDate(today, 'Asia/Kolkata', 'yyyy-MM-dd');
  const actionElements = [
    {
      type: "static_select",
      action_id: `location_select_${date}`,
      placeholder: {
        type: "plain_text",
        text: "Choose a location"
      },
      options: locationOptions
    },
    {
      type: "button",
      text: {
        type: "plain_text",
        text: "Submit",
        emoji: true
      },
      style: "primary",
      value: `submit_location_${date}_${currentFact}`,
      action_id: "submit_location"
    }
  ];

  const payload = JSON.stringify({
    channel: userId,
    text: message,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${fullMessage}`
        }
      },
      {
        type: "actions",
        elements: actionElements
      }
    ]
  });

  // Logger.log(`Sending payload to user ${userId}: ${payload}`);

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
    },
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    // Logger.log(`HTTP response code: ${response.getResponseCode()}`);
    const jsonResponse = JSON.parse(response.getContentText());

    if (jsonResponse.ok) {
      const messageTimestamp = jsonResponse.ts;
      // Logger.log(`Location collection message sent successfully to user ${userId} with timestamp ${messageTimestamp}`);

      // Log to a spreadsheet
      updateEmployeeMessageTS(email, messageTimestamp);

      return {
        ts: messageTimestamp,
        success: true,
        message: `Location collection message sent to ${userId}`
      };
    } else {
      Logger.log(`Slack API error for user ${userId}: ${jsonResponse.error}`);
      return {
        ts: null,
        success: false,
        message: `Slack API error: ${jsonResponse.error}`
      };
    }
  } catch (e) {
    Logger.log(`Error sending location collection message to ${userId}: ${e.message}`);
    return {
      ts: null,
      success: false,
      message: `Error sending location collection message: ${e.message}`
    };
  }
}

function processMessagesdaraboina() {
  // Get the "Messages TS" sheet
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName("Messages TS");

  if (!sheet) {
    console.log("Error: Sheet 'Messages TS' not found.");
    return;
  }

  // Get all data from the sheet
  const data = sheet.getDataRange().getValues();

  // Get header row (assuming first row is header)
  const headers = data[0];

  // Find indices of "Message Ts" and "Channel ID" headers
  const tsIndex = headers.indexOf("Message Ts");
  const channelIdIndex = headers.indexOf("Channel ID");

  // Log missing headers
  if (tsIndex === -1) {
    console.log("Error: Header 'Message Ts' not found.");
  }
  if (channelIdIndex === -1) {
    console.log("Error: Header 'Channel ID' not found.");
  }

  // Exit if either header is missing
  if (tsIndex === -1 || channelIdIndex === -1) {
    return;
  }

  // Process each row (skip header row)
  for (let i = 1; i < data.length; i++) {
    const messageTs = data[i][tsIndex];
    const channelId = data[i][channelIdIndex];

    // Ensure both values exist
    if (messageTs && channelId) {
      try {
        // Call the existing deleteSlackMessage function
        deleteSlackMessage(channelId, messageTs);
        console.log(`Processed row ${i + 1}: Channel ID = ${channelId}, Message Ts = ${messageTs}`);
      } catch (error) {
        console.log(`Error processing row ${i + 1}: ${error.message}`);
      }

      // Flush to ensure changes are applied
      SpreadsheetApp.flush();

      // Wait 500ms before processing the next row
      Utilities.sleep(500);
    } else {
      console.log(`Skipped row ${i + 1}: Missing Channel ID or Message Ts`);
    }
  }

  console.log("Processing complete.");
}

function deleteSlackMessage(channelId = "CHANNEL_ID", messageTimestamp = "MESSAGE_TS") {
  const url = 'https://slack.com/api/chat.delete';
  const payload = {
    channel: channelId,
    ts: messageTimestamp,
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
      logToDumpSheet(`Message with timestamp ${messageTimestamp} deleted successfully.`);
      Logger.log(`Message with timestamp ${messageTimestamp} deleted successfully.`);
    } else {
      logToDumpSheet('Error deleting message: ' + responseData.error);
      Logger.log('Error deleting message: ' + responseData.error);
    }
  } catch (error) {
    logToDumpSheet('Error deleting message: ' + error.toString());
    Logger.log('Error deleting message: ' + error.toString());
  }
}

function sendSlackConfirmationMessage(channelId, message) {
  const url = 'https://slack.com/api/chat.postMessage';
  const payload = JSON.stringify({
    channel: channelId,
    text: message
  });

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
    },
    payload: payload
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const jsonResponse = JSON.parse(response.getContentText());
    if (jsonResponse.ok) {
      logToDumpSheet(`Confirmation message sent to ${channelId}: ${message}`);
      return {
        success: true,
        message: `Confirmation message sent to ${channelId}`
      };
    } else {
      logToDumpSheet(`Error sending confirmation message to ${channelId}: ${jsonResponse.error}`);
      return {
        success: false,
        message: `Error sending confirmation message: ${jsonResponse.error}`
      };
    }
  } catch (e) {
    logToDumpSheet(`Error sending confirmation message to ${channelId}: ${e.message}`);
    return {
      success: false,
      message: `Error sending confirmation message: ${e.message}`
    };
  }
}
