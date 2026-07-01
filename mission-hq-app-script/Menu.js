function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("MissionHQ")
    .addItem("Authorize Zoho People", "startZohoPeopleAuthorization")
    .addSeparator()
    .addItem("Sync Zoho Leaves (Today)", "syncTodayZohoPeopleLeaves")
    .addSeparator()
    .addItem("Preview Attendance Push (Today)", "testLogZohoAttendancePayload")
    .addItem("Push Attendance to Zoho (Today)", "syncTodayAttendanceToZoho")
    .addToUi();
}
