function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("MissionHQ")
    .addItem("Sync Employees from Zoho", "syncEmployeesFromZohoOrgTree")
    .addSeparator()
    .addItem("Authorize Zoho People", "startZohoPeopleAuthorization")
    .addSeparator()
    .addItem("Preview Attendance Push (dry run)", "testLogZohoAttendancePayload")
    .addItem("Push Attendance to Zoho (Today)", "syncTodayAttendanceToZoho")
    .addToUi();
}
