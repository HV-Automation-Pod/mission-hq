function deleteMessagesFromSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Message Ts");
    if (!sheet) {
      throw new Error("Sheet 'Message Ts' not found");
    }

    // Get all data from the sheet
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(header => header.toString().trim());
    const tsColIndex = headers.indexOf("Message Ts");
    const emailColIndex = headers.indexOf("Channel ID");

    if (tsColIndex === -1 || emailColIndex === -1) {
      throw new Error("Column 'Message Ts' or 'Email ID' not found in sheet");
    }

    let deletedCount = 0;
    let failedCount = 0;

    // Start from row 1 to skip header
    for (let i = 1; i < data.length; i++) {
      const messageTs = data[i][tsColIndex]?.toString().trim();
      const email = data[i][emailColIndex]?.toString().trim();
      
      if (!messageTs || !email) {
        Logger.log(`Skipping row ${i + 1}: Empty Message Ts or Email ID (Email: ${email || 'N/A'})`);
        continue;
      }

      try {
        // Fetch user ID using email
        // const userInfo = getUserInfoByEmail(email, SLACK_BOT_TOKEN);
        // if (!userInfo || !userInfo.id) {
        //   throw new Error(`No user found for email ${email}`);
        // }

        // Call deleteMessageFromUserDM with user ID and messageTs
        const result = deleteSlackMessage(email, messageTs);
        if (result.success) {
          Logger.log(`Deleted message with ts ${messageTs} for email ${email} (row ${i + 1})`);
          deletedCount++;
        } else {
          Logger.log(`Failed to delete message with ts ${messageTs} for email ${email} (row ${i + 1}): ${result.message}`);
          failedCount++;
        }
      } catch (error) {
        Logger.log(`Error deleting message with ts ${messageTs} for email ${email} (row ${i + 1}): ${error.message}`);
        failedCount++;
      }

      // Wait for 1 second before processing the next row
      Utilities.sleep(1000);
    }

    Logger.log(`Message deletion completed: ${deletedCount} deleted, ${failedCount} failed`);
    return {
      success: true,
      deleted: deletedCount,
      failed: failedCount,
      message: `Processed ${deletedCount} deletions, ${failedCount} failed`
    };
  } catch (error) {
    Logger.log(`Error processing Message Ts sheet: ${error.message}`);
    return {
      success: false,
      message: `Error processing Message Ts sheet: ${error.message}`
    };
  }
}

function deleteMessageFromUserDM(userEmail = "user@example.com", messageTs = "MESSAGE_TS") {
  try {
    if (!userEmail || typeof userEmail !== 'string' || userEmail.trim() === "") {
      throw new Error("Invalid or empty user email provided");
    }

    const trimmedUserEmail = userEmail.trim();
    const userInfo = getUserInfoByEmail(trimmedUserEmail, SLACK_BOT_TOKEN);
    if (!userInfo || !userInfo.id) {
      throw new Error(`No Slack user found for email ${trimmedUserEmail}`);
    }

    const userID = userInfo.id;
    const openDmUrl = 'https://slack.com/api/conversations.open';
    const openDmOptions = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + SLACK_BOT_TOKEN
      },
      payload: JSON.stringify({ users: userID })
    };

    const openDmResponse = UrlFetchApp.fetch(openDmUrl, openDmOptions);
    const openDmJson = JSON.parse(openDmResponse.getContentText());

    if (!openDmJson.ok) {
      throw new Error(`Failed to open DM with ${trimmedUserEmail}: ${openDmJson.error}`);
    }

    const channelID = openDmJson.channel.id;
    Logger.log(`DM channel ID for ${trimmedUserEmail} (${userID}): ${channelID}`);

    // Fetch message to check if it exists
    const fetchUrl = `https://slack.com/api/conversations.history?channel=${channelID}&latest=${messageTs}&limit=1&inclusive=true`;
    const fetchOptions = {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + SLACK_BOT_TOKEN }
    };
    const fetchResponse = UrlFetchApp.fetch(fetchUrl, fetchOptions);
    const fetchJson = JSON.parse(fetchResponse.getContentText());

    if (!fetchJson.ok) {
      Logger.log(`Failed to fetch message with ts ${messageTs} in channel ${channelID}: ${fetchJson.error}`);
      return { success: false, message: `Failed to fetch message: ${fetchJson.error}` };
    }

    if (fetchJson.messages.length === 0 || !fetchJson.messages.some(message => message.ts === messageTs)) {
      Logger.log(`Message with ts ${messageTs} not found in channel ${channelID}. It may already be deleted.`);
      return { success: true, message: `Message not found or already deleted` };
    }

    // Delete the message
    const deleteUrl = 'https://slack.com/api/chat.delete';
    const deleteOptions = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + SLACK_BOT_TOKEN },
      payload: JSON.stringify({ channel: channelID, ts: messageTs })
    };

    const deleteResponse = UrlFetchApp.fetch(deleteUrl, deleteOptions);
    const deleteJson = JSON.parse(deleteResponse.getContentText());

    if (deleteJson.ok) {
      Logger.log(`Message deleted from channel ${channelID} with ts ${messageTs}`);
      return { success: true, message: `Message deleted successfully` };
    } else {
      throw new Error(`Failed to delete message from channel ${channelID}: ${deleteJson.error}`);
    }
  } catch (error) {
    Logger.log(`Error in deleteMessageFromUserDM for email ${userEmail}, ts ${messageTs}: ${error.message}`);
    return { success: false, message: `Error deleting message: ${error.message}` };
  }
}
