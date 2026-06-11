function logDuplicateEmailsInMissionHQLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheetName = "MissionHQ Log";
  const duplicateLogSheetName = "Duplicate Emails Log";
  const sourceSheet = ss.getSheetByName(sourceSheetName);

  if (!sourceSheet) {
    Logger.log(`Sheet "${sourceSheetName}" not found`);
    return { success: false, message: `Sheet "${sourceSheetName}" not found` };
  }

  const lastRow = sourceSheet.getLastRow();
  const lastColumn = sourceSheet.getLastColumn();

  if (lastRow < 2) {
    Logger.log(`No employee rows found in "${sourceSheetName}"`);
    return { success: true, duplicates: 0, message: "No employee rows found" };
  }

  const headers = sourceSheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const emailColIndex = headers.indexOf("Email Address");
  const nameColIndex = headers.indexOf("Full Name");

  if (emailColIndex === -1) {
    Logger.log(`Column "Email Address" not found in "${sourceSheetName}"`);
    return { success: false, message: `Column "Email Address" not found in "${sourceSheetName}"` };
  }

  const data = sourceSheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const emailMap = {};

  data.forEach(function(row, index) {
    const email = row[emailColIndex] ? row[emailColIndex].toString().trim() : "";
    if (!email) return;

    const normalizedEmail = email.toLowerCase();
    if (!emailMap[normalizedEmail]) {
      emailMap[normalizedEmail] = {
        email: email,
        rows: [],
        names: []
      };
    }

    emailMap[normalizedEmail].rows.push(index + 2);

    if (nameColIndex !== -1) {
      const name = row[nameColIndex] ? row[nameColIndex].toString().trim() : "";
      if (name) emailMap[normalizedEmail].names.push(name);
    }
  });

  const timestamp = new Date();
  const duplicateRows = Object.keys(emailMap)
    .filter(function(email) {
      return emailMap[email].rows.length > 1;
    })
    .map(function(email) {
      const duplicate = emailMap[email];
      const uniqueNames = Array.from(new Set(duplicate.names));
      return [
        duplicate.email,
        duplicate.rows.length,
        duplicate.rows.join(", "),
        uniqueNames.join(", "),
        timestamp
      ];
    });

  let duplicateLogSheet = ss.getSheetByName(duplicateLogSheetName);
  if (!duplicateLogSheet) {
    duplicateLogSheet = ss.insertSheet(duplicateLogSheetName);
  }

  duplicateLogSheet.clearContents();
  duplicateLogSheet.getRange(1, 1, 1, 5).setValues([[
    "Email Address",
    "Duplicate Count",
    "Rows",
    "Full Names",
    "Checked At"
  ]]);

  if (duplicateRows.length > 0) {
    duplicateLogSheet.getRange(2, 1, duplicateRows.length, 5).setValues(duplicateRows);
    Logger.log(`Found ${duplicateRows.length} duplicate email(s). Logged to "${duplicateLogSheetName}".`);
  } else {
    Logger.log(`No duplicate emails found in "${sourceSheetName}".`);
  }

  return {
    success: true,
    duplicates: duplicateRows.length,
    message: `Logged ${duplicateRows.length} duplicate email(s) to "${duplicateLogSheetName}"`
  };
}
