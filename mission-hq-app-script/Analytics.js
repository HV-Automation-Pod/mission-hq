function countValueInEmailRow(email = "user@example.com", value = "Pending") {
  const sheetName = "MissionHQ Log";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log(`Sheet "${sheetName}" not found`);
    return 0;
  }

  if (!email || !value) {
    Logger.log('Email and value are required');
    return 0;
  }

  // Get headers
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const emailColIndex = headers.indexOf('Email Address');

  if (emailColIndex === -1) {
    Logger.log('Column "Email Address" not found');
    return 0;
  }

  // Get all data starting from row 2
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No data found in sheet');
    return 0;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const emailLower = email.toString().trim().toLowerCase();
  const valueLower = value.toString().trim().toLowerCase();

  // Pre-process: Create array of {processedEmail, processedCells} for efficiency
  const processedData = data.map(row => {
    const processedEmail = row[emailColIndex] ? row[emailColIndex].toString().trim().toLowerCase() : '';
    const processedCells = row.map(cell =>
      cell ? cell.toString().trim().toLowerCase() : ''
    );
    return { processedEmail, processedCells };
  });

  // Filter matching rows, then reduce to count occurrences
  const matchingRows = processedData.filter(item => item.processedEmail === emailLower);
  const totalCount = matchingRows.reduce((sum, item) => {
    const rowCount = item.processedCells.filter(cell => cell === valueLower).length;
    return sum + rowCount;
  }, 0);

  Logger.log(`Total count of "${value}" for email "${email}": ${totalCount}`);
  return totalCount;
}

function checkMissingEmailsInAnalytics() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Get "MissionHQ Log" sheet
  const logSheet = ss.getSheetByName("MissionHQ Log");
  if (!logSheet) {
    Logger.log('Sheet "MissionHQ Log" not found');
    return;
  }

  // Get "Analytics" sheet
  const analyticsSheet = ss.getSheetByName("Analytics");
  if (!analyticsSheet) {
    Logger.log('Sheet "Analytics" not found');
    return;
  }

  // Get headers for both sheets
  const logHeaders = logSheet.getRange(1, 1, 1, logSheet.getLastColumn()).getValues()[0];
  const analyticsHeaders = analyticsSheet.getRange(1, 1, 1, analyticsSheet.getLastColumn()).getValues()[0];

  const logEmailColIndex = logHeaders.indexOf('Email Address');
  const analyticsEmailColIndex = analyticsHeaders.indexOf('Email Address');

  if (logEmailColIndex === -1) {
    Logger.log('Column "Email Address" not found in "MissionHQ Log"');
    return;
  }

  if (analyticsEmailColIndex === -1) {
    Logger.log('Column "Email Address" not found in "Analytics"');
    return;
  }

  // Get data starting from row 2 for both sheets
  const logLastRow = logSheet.getLastRow();
  const analyticsLastRow = analyticsSheet.getLastRow();

  if (logLastRow < 2 || analyticsLastRow < 2) {
    Logger.log('No data found in one or both sheets');
    return;
  }

  const logData = logSheet.getRange(2, 1, logLastRow - 1, logSheet.getLastColumn()).getValues();
  const analyticsData = analyticsSheet.getRange(2, 1, analyticsLastRow - 1, analyticsSheet.getLastColumn()).getValues();

  // Extract and normalize emails (lowercase, trimmed) into Sets for fast lookup
  const analyticsEmailsSet = new Set();
  analyticsData.forEach(row => {
    const email = row[analyticsEmailColIndex];
    if (email) {
      const normalizedEmail = email.toString().trim().toLowerCase();
      analyticsEmailsSet.add(normalizedEmail);
    }
  });

  // Find missing emails from "MissionHQ Log"
  const missingEmails = [];
  logData.forEach(row => {
    const email = row[logEmailColIndex];
    if (email) {
      const normalizedEmail = email.toString().trim().toLowerCase();
      if (!analyticsEmailsSet.has(normalizedEmail)) {
        missingEmails.push(email.toString().trim()); // Keep original casing for logging
      }
    }
  });

  // Log results
  if (missingEmails.length === 0) {
    Logger.log('No missing emails found in "Analytics". All emails from "MissionHQ Log" are present.');
  } else {
    Logger.log(`Found ${missingEmails.length} missing emails in "Analytics":`);
    missingEmails.forEach((email, index) => {
      Logger.log(`  ${index + 1}. ${email}`);
    });
  }

  // Optional: Write missing emails to a new sheet or log sheet for persistence
  // Uncomment and customize if needed
  /*
  if (missingEmails.length > 0) {
    const logSheetName = 'Missing Emails Log';
    let missingLogSheet = ss.getSheetByName(logSheetName);
    if (!missingLogSheet) {
      missingLogSheet = ss.insertSheet(logSheetName);
      missingLogSheet.getRange(1, 1).setValue('Missing Email');
      missingLogSheet.getRange(1, 2).setValue('Timestamp');
    }
    const timestamp = new Date();
    missingEmails.forEach(email => {
      missingLogSheet.appendRow([email, timestamp]);
    });
    Logger.log(`Missing emails logged to sheet "${logSheetName}"`);
  }
  */
}

// Function to calculate user status counts and return the data with full names
function calculateUserStatusCounts() {
  // Get the active spreadsheet and the "MissionHQ Log" sheet
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName("MissionHQ Log");

  if (!sheet) {
    Logger.log("Sheet 'MissionHQ Log' not found.");
    return null;
  }

  // Get all data from the sheet
  var data = sheet.getDataRange().getValues();

  // Initialize an object to store user status counts and full names
  var userStatusCounts = {};

  // Define valid statuses (case-insensitive)
  var validStatuses = ["office", "home", "client location", "split day", "travel", "leave", "anywhere", "pending"];

  // Assuming headers are in the first row
  var headers = data[0];

  // Find the column indices for Full Name, Email Address, and the first date column
  var fullNameColIndex = headers.indexOf("Full Name");
  var emailColIndex = headers.indexOf("Email Address");
  var firstDateColIndex = headers.findIndex(function (header) {
    return /^\d{4}-\d{2}-\d{2}$/.test(header.toString().trim());
  });

  if (emailColIndex === -1 || fullNameColIndex === -1) {
    Logger.log("Required column 'Email Address' or 'Full Name' not found.");
    return null;
  }

  if (firstDateColIndex === -1) {
    Logger.log("No date columns found in YYYY-MM-DD format.");
    return userStatusCounts;
  }

  // Iterate through each row (skip header row)
  for (var i = 1; i < data.length; i++) {
    var email = data[i][emailColIndex] ? data[i][emailColIndex].toString().trim().toLowerCase() : "";
    var fullName = data[i][fullNameColIndex] ? data[i][fullNameColIndex].toString().trim() : "";

    // Skip rows with no email
    if (!email) continue;

    // Initialize user object if not exists
    if (!userStatusCounts[email]) {
      userStatusCounts[email] = {
        fullName: fullName,
        office: 0,
        home: 0,
        "client location": 0,
        "split day": 0,
        travel: 0,
        leave: 0,
        anywhere: 0,
        pending: 0
      };
    } else {
      // Update full name if a newer one is found (optional, keeps first encountered name if preferred)
      userStatusCounts[email].fullName = fullName || userStatusCounts[email].fullName;
    }

    // Iterate through date columns
    for (var j = firstDateColIndex; j < headers.length; j++) {
      var status = data[i][j] ? data[i][j].toString().trim().toLowerCase() : "";

      // Check if the status is valid
      if (validStatuses.includes(status)) {
        userStatusCounts[email][status]++;
      }
    }
  }

  return userStatusCounts;
}

// Function to update the Analytics sheet with user status counts and full names
function updateAnalyticsSheet() {
  // Get the user status counts
  var userStatusCounts = calculateUserStatusCounts();

  if (!userStatusCounts) {
    Logger.log("No data to process.");
    return;
  }

  // Get or create the Analytics sheet
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var analyticsSheet = spreadsheet.getSheetByName("Analytics") || spreadsheet.insertSheet("Analytics");

  // Get existing data from Analytics sheet
  var existingData = analyticsSheet.getDataRange().getValues();

  // Default headers if none exist
  var defaultHeaders = ["Full Name", "Email", "Office", "Home", "Client Location", "Split Day", "Travel", "Leave", "Pending", "Anywhere"];

  // Check if the sheet is empty or headers don't exist
  var headers = [];
  var headersExist = existingData.length > 0 && existingData[0].some(cell => cell.toString().trim() !== "");

  if (headersExist) {
    // Use existing headers from the first row
    headers = existingData[0].map(header => header.toString().trim());
  } else {
    // Use default headers and write them
    headers = defaultHeaders;
    analyticsSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    existingData = [headers];
  }

  // Map header names to their column indices (case-insensitive)
  var headerMap = {};
  headers.forEach((header, index) => {
    headerMap[header.toLowerCase()] = index;
  });

  // Validate required headers
  var requiredHeaders = ["full name", "email", "office", "home", "client location", "split day", "travel", "leave", "pending", "anywhere"];
  for (var requiredHeader of requiredHeaders) {
    if (!(requiredHeader in headerMap)) {
      Logger.log(`Required header "${requiredHeader}" not found in Analytics sheet.`);
      return;
    }
  }

  // Map existing emails to their row indices
  var existingEmails = {};
  for (var i = 1; i < existingData.length; i++) {
    var email = existingData[i][headerMap["email"]] ? existingData[i][headerMap["email"]].toString().trim().toLowerCase() : "";
    if (email) {
      existingEmails[email] = i + 1; // Store row number (1-based)
    }
  }

  // Prepare new data for writing
  var outputData = [];
  var nextRow = existingData.length + 1; // Start appending after existing data

  for (var email in userStatusCounts) {
    var userData = userStatusCounts[email];

    // Initialize row data with null values for all columns
    var rowData = new Array(headers.length).fill(0);

    // Map data to the correct columns based on header positions
    rowData[headerMap["full name"]] = userData.fullName;
    rowData[headerMap["email"]] = email;
    rowData[headerMap["office"]] = userData.office;
    rowData[headerMap["home"]] = userData.home;
    rowData[headerMap["client location"]] = userData["client location"];
    rowData[headerMap["split day"]] = userData["split day"];
    rowData[headerMap["travel"]] = userData.travel;
    rowData[headerMap["leave"]] = userData.leave;
    rowData[headerMap["pending"]] = userData.pending;
    rowData[headerMap["anywhere"]] = userData.anywhere;

    // If email exists, update the existing row
    if (existingEmails[email]) {
      analyticsSheet.getRange(existingEmails[email], 1, 1, headers.length).setValues([rowData]);
    } else {
      // If email doesn't exist, add to outputData for appending
      outputData.push(rowData);
    }
  }

  // Append new rows if any
  if (outputData.length > 0) {
    analyticsSheet.getRange(nextRow, 1, outputData.length, headers.length).setValues(outputData);
  }

  Logger.log("Analytics sheet updated successfully.");
}
