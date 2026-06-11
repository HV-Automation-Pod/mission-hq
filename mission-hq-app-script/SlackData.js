
function fetchSlackUsersAndSaveToSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Slack Users");
  if (!sheet) {
    Logger.log(`Sheet with name "Slack Users" not found.`);
    return;
  }

  // Check if the sheet is empty (only headers or completely empty)
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['User Name', 'User ID', 'Email']);
  }

  // Get existing emails from the sheet
  const existingEmails = sheet.getLastRow() > 1
    ? sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues().flat().filter(email => email)
    : []; // If no data rows exist, initialize as an empty array

  // Fetch users from the channel
  const url = `https://slack.com/api/conversations.members?channel=${SLACK_CHANNEL_ID}`;
  const options = {
    method: 'get',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`
    }
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());

    if (!data.ok) {
      Logger.log(`Error fetching members: ${data.error}`);
      return;
    }

    const userIds = data.members;
    const users = [];

    // Fetch user details for each user ID
    userIds.forEach(userId => {
      const userInfo = fetchSlackUserDetailsWithEmail(userId, SLACK_BOT_TOKEN, existingEmails);
      if (userInfo) {
        users.push(userInfo);
        existingEmails.push(userInfo.email); // Update existing emails list to prevent duplicates
      }
    });

    // Write the data to the sheet
    if (users.length > 0) {
      const rows = users.map(user => [user.name, user.id, user.email]);
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
      Logger.log('User data successfully written to the sheet.');
    } else {
      Logger.log('No new users found or added to the sheet.');
    }
  } catch (error) {
    Logger.log(`Error fetching data: ${error.message}`);
  }
}

function fetchSlackUserDetailsWithEmail(userId, token, existingEmails) {
  const url = `https://slack.com/api/users.info?user=${userId}`;
  const options = {
    method: 'get',
    headers: {
      Authorization: `Bearer ${token}`
    }
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());

    if (data.ok) {
      const user = data.user;
      const email = user.profile && user.profile.email ? user.profile.email : null;

      // Skip if email is not found or already exists in the sheet
      if (!email || existingEmails.includes(email)) {
        Logger.log(`Skipping user ${user.real_name} (ID: ${user.id}) - Email not found or already exists.`);
        return null;
      }

      return { name: user.real_name, id: user.id, email: email };
    } else {
      Logger.log(`Error fetching user details for ID ${userId}: ${data.error}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Error fetching user details for ID ${userId}: ${error.message}`);
    return null;
  }
}