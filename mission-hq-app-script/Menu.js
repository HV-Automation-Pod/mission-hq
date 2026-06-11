function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("MissionHQ")
    .addItem("Sync Zoho Leaves Today", "syncTodayZohoPeopleLeaves")
    .addToUi();
}
