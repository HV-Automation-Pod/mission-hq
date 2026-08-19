function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("MissionHQ")
    .addItem("Sync Employees from Zoho", "syncEmployeesFromZohoOrgTree")
    .addSeparator()
    .addItem("Mark WFO Exempt…", "promptMarkWfoExempt")
    .addSeparator()
    .addItem("Authorize Zoho People", "startZohoPeopleAuthorization")
    .addSeparator()
    .addToUi();
}
