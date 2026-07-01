function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("MissionHQ")
    .addItem("Sync Employees from Zoho", "syncEmployeesFromZohoOrgTree")
    .addToUi();
}
