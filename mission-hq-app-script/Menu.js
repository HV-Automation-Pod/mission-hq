function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("MissionHQ")
    .addItem("Sync Employees from Zoho", "syncEmployeesFromZohoOrgTree")
    .addItem("Sync PMS Levels", "syncPmsLevelsToLog")
    .addSeparator()
    .addItem("Audit Slack vs Zoho", "auditSlackAccountsNotInZoho")
    .addItem("Preview Slack vs Zoho", "previewSlackAccountsNotInZoho")
    .addItem("Apply Attendance Prompt Decisions", "applyAttendancePromptDecisions")
    .addItem("Preview Attendance Prompt Decisions", "previewAttendancePromptDecisions")
    .addSeparator()
    .addItem("Mark WFO Exempt…", "promptMarkWfoExempt")
    .addSeparator()
    .addItem("Authorize Zoho People", "startZohoPeopleAuthorization")
    .addSeparator()
    .addToUi();
}
