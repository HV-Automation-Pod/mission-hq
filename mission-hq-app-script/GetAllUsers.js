function getSlackUsersToSheet() {
  const slackToken = SLACK_BOT_TOKEN
  
  if (!slackToken) {
    throw new Error('Slack bot token not found. Please set SLACK_BOT_TOKEN in Script Properties.');
  }

  // Initialize Google Spreadsheet
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName('Users');
  
  // Create Users sheet if it doesn't exist
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Users');
    // Set headers for all user and profile fields (excluding email)
    sheet.getRange('A1:U1').setValues([[
      'User ID', 'Team ID', 'Name', 'Deleted', 'Color', 'Real Name', 'Time Zone', 
      'Time Zone Label', 'Time Zone Offset', 'Avatar Hash', 'Status Text', 'Status Emoji', 
      'Display Name', 'Real Name Normalized', 'Display Name Normalized', 'Image Original', 
      'Image 24', 'Image 32', 'Image 48', 'Is Admin', 'Is Owner'
    ]]);
  } else {
    // Clear existing content except headers
    sheet.getRange('A2:U1' + sheet.getLastRow()).clearContent();
  }

  // Slack API endpoint for users.list
  const url = 'https://slack.com/api/users.list';
  const options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + slackToken
    },
    muteHttpExceptions: true
  };

  // Fetch users from Slack API
  let cursor = '';
  let allUsers = [];
  
  do {
    const apiUrl = cursor ? `${url}?cursor=${cursor}` : url;
    const response = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(response.getContentText());

    if (json.ok === false) {
      throw new Error('Slack API error: ' + json.error);
    }

    // Collect user profile data (excluding email, bots, and deleted users)
    json.members.forEach(member => {
      if (!member.deleted && !member.is_bot) { // Exclude deleted users and bots
        allUsers.push([
          member.id || 'N/A',
          member.team_id || 'N/A',
          member.name || 'N/A',
          member.deleted ? 'Yes' : 'No',
          member.color || 'N/A',
          member.real_name || 'N/A',
          member.tz || 'N/A',
          member.tz_label || 'N/A',
          member.tz_offset || 'N/A',
          member.profile.avatar_hash || 'N/A',
          member.profile.status_text || 'N/A',
          member.profile.status_emoji || 'N/A',
          member.profile.display_name || 'N/A',
          member.profile.real_name_normalized || 'N/A',
          member.profile.display_name_normalized || 'N/A',
          member.profile.image_original || 'N/A',
          member.profile.image_24 || 'N/A',
          member.profile.image_32 || 'N/A',
          member.profile.image_48 || 'N/A',
          member.is_admin ? 'Yes' : 'No',
          member.is_owner ? 'Yes' : 'No',
        ]);
      }
    });

    cursor = json.response_metadata ? json.response_metadata.next_cursor : '';
  } while (cursor); // Continue if there's a next page

  // Write users to the sheet
  if (allUsers.length > 0) {
    sheet.getRange(2, 1, allUsers.length, 21).setValues(allUsers);
    Logger.log(`Successfully added ${allUsers.length} users to the Users sheet.`);
  } else {
    Logger.log('No active, non-bot users found.');
  }
}