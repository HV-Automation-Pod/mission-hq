function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("MissionHQ")
    .addItem("Sync Employees from Zoho", "syncEmployeesFromZohoOrgTree")
    .addSeparator()
    .addItem("Authorize Zoho People", "startZohoPeopleAuthorization")
    .addSeparator()
    .addItem("Preview Missed Responses", "previewMissedResponses")
    .addItem("Fix Missed Responses", "fixMissedResponses")
    .addSeparator()
    .addItem("Preview Delete Old Reminders", "previewDeleteStandaloneReminders")
    .addItem("Delete Old Reminders", "deleteStandaloneReminders")
    .addSeparator()
    .addToUi();
}
