function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("MissionHQ")
    .addItem("Sync Employees from Zoho", "syncEmployeesFromZohoOrgTree")
    .addItem("Sync PMS Levels", "syncPmsLevelsToLog")
    .addSeparator()
    .addItem("Mark WFO Exempt…", "promptMarkWfoExempt")
    .addSeparator()
    .addItem("Authorize Zoho People", "startZohoPeopleAuthorization")
    .addSeparator()
    .addToUi();
}
