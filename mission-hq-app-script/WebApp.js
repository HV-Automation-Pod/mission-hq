function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.code) {
      return handleZohoPeopleOAuthCallback_(e.parameter.code);
    }

    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "all";
    let result;

    switch (action) {
      case "zohoPeopleAuthUrl":
        result = { success: true, authUrl: buildZohoPeopleAuthorizationUrl_() };
        break;
      case "syncZohoPeopleLeaves":
        result = e.parameter.date ? syncZohoPeopleLeavesForDate(e.parameter.date) : syncTodayZohoPeopleLeaves();
        break;
      case "all":
        result = getAllEmployeeData();
        break;
      case "today":
        result = getTodayData();
        break;
      case "daterange":
        result = getDateRangeData(e.parameter.from, e.parameter.to);
        break;
      case "departments":
        result = getDepartmentData();
        break;
      case "analytics":
        result = getAnalyticsData();
        break;
      case "summary":
        result = getSummaryData();
        break;
      default:
        result = { error: "Invalid action. Use: all, today, daterange, departments, analytics, summary, zohoPeopleAuthUrl, syncZohoPeopleLeaves" };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Reads the MissionHQ Log sheet and returns parsed headers + data.
 */
function _getSheetData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error("Sheet '" + CANDIDATE_SHEET_NAME + "' not found");

  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0].map(function(h) { return h.toString().trim(); });

  const nameCol = headers.indexOf("Full Name");
  const emailCol = headers.indexOf("Email Address");
  const deptCol = headers.indexOf("Department");

  if (nameCol === -1 || emailCol === -1) {
    throw new Error("Required columns 'Full Name' or 'Email Address' not found");
  }

  // Collect date columns (any header matching YYYY-MM-DD pattern)
  var dateColumns = [];
  for (var j = 0; j < headers.length; j++) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(headers[j])) {
      dateColumns.push({ date: headers[j], colIndex: j });
    }
  }

  // Sort dates chronologically
  dateColumns.sort(function(a, b) { return a.date.localeCompare(b.date); });

  return {
    data: data,
    headers: headers,
    nameCol: nameCol,
    emailCol: emailCol,
    deptCol: deptCol,
    dateColumns: dateColumns
  };
}

/**
 * Returns all employee data with their date-wise statuses.
 */
function getAllEmployeeData() {
  var sd = _getSheetData();
  var employees = [];

  for (var i = 1; i < sd.data.length; i++) {
    var row = sd.data[i];
    var email = row[sd.emailCol] ? row[sd.emailCol].toString().trim() : "";
    if (!email) continue;

    var statuses = {};
    sd.dateColumns.forEach(function(d) {
      var val = row[d.colIndex] ? row[d.colIndex].toString().trim() : "";
      if (val) statuses[d.date] = val;
    });

    employees.push({
      name: row[sd.nameCol] ? row[sd.nameCol].toString().trim() : "",
      email: email,
      department: sd.deptCol !== -1 ? (row[sd.deptCol] ? row[sd.deptCol].toString().trim() : "") : "",
      statuses: statuses
    });
  }

  return {
    success: true,
    dates: sd.dateColumns.map(function(d) { return d.date; }),
    employees: employees,
    totalEmployees: employees.length,
    totalDates: sd.dateColumns.length,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Returns today's status for all employees.
 */
function getTodayData() {
  var sd = _getSheetData();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var todayCol = sd.headers.indexOf(today);

  var employees = [];
  for (var i = 1; i < sd.data.length; i++) {
    var row = sd.data[i];
    var email = row[sd.emailCol] ? row[sd.emailCol].toString().trim() : "";
    if (!email) continue;

    employees.push({
      name: row[sd.nameCol] ? row[sd.nameCol].toString().trim() : "",
      email: email,
      department: sd.deptCol !== -1 ? (row[sd.deptCol] ? row[sd.deptCol].toString().trim() : "") : "",
      status: todayCol !== -1 ? (row[todayCol] ? row[todayCol].toString().trim() : "No Data") : "No Data"
    });
  }

  return {
    success: true,
    date: today,
    dateFound: todayCol !== -1,
    employees: employees,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Returns data for a specific date range.
 */
function getDateRangeData(from, to) {
  if (!from || !to) {
    return { success: false, error: "Both 'from' and 'to' parameters are required (YYYY-MM-DD)" };
  }

  var sd = _getSheetData();

  // Filter date columns within range
  var filteredDates = sd.dateColumns.filter(function(d) {
    return d.date >= from && d.date <= to;
  });

  var employees = [];
  for (var i = 1; i < sd.data.length; i++) {
    var row = sd.data[i];
    var email = row[sd.emailCol] ? row[sd.emailCol].toString().trim() : "";
    if (!email) continue;

    var statuses = {};
    filteredDates.forEach(function(d) {
      var val = row[d.colIndex] ? row[d.colIndex].toString().trim() : "";
      if (val) statuses[d.date] = val;
    });

    employees.push({
      name: row[sd.nameCol] ? row[sd.nameCol].toString().trim() : "",
      email: email,
      department: sd.deptCol !== -1 ? (row[sd.deptCol] ? row[sd.deptCol].toString().trim() : "") : "",
      statuses: statuses
    });
  }

  return {
    success: true,
    from: from,
    to: to,
    dates: filteredDates.map(function(d) { return d.date; }),
    employees: employees,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Returns department-wise grouped data.
 */
function getDepartmentData() {
  var allData = getAllEmployeeData();
  if (!allData.success) return allData;

  var departments = {};
  allData.employees.forEach(function(emp) {
    var depts = emp.department ? emp.department.split(",").map(function(d) { return d.trim(); }).filter(Boolean) : ["Unassigned"];
    if (depts.length === 0) depts = ["Unassigned"];
    depts.forEach(function(dept) {
      if (!departments[dept]) departments[dept] = [];
      departments[dept].push(emp);
    });
  });

  // Build department summary
  var departmentSummary = {};
  Object.keys(departments).forEach(function(dept) {
    departmentSummary[dept] = {
      count: departments[dept].length,
      employees: departments[dept]
    };
  });

  return {
    success: true,
    departments: departmentSummary,
    departmentNames: Object.keys(departments).sort(),
    dates: allData.dates,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Returns aggregated analytics from the Analytics sheet.
 */
function getAnalyticsData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Analytics");
  if (!sheet) return { success: false, error: "Analytics sheet not found" };

  var data = sheet.getDataRange().getDisplayValues();
  var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });

  var analytics = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var email = row[headers.indexOf("email")] || row[headers.indexOf("email address")] || "";
    if (!email) continue;

    analytics.push({
      name: row[headers.indexOf("full name")] || "",
      email: email,
      office: parseInt(row[headers.indexOf("office")] || "0", 10),
      home: parseInt(row[headers.indexOf("home")] || "0", 10),
      clientLocation: parseInt(row[headers.indexOf("client location")] || "0", 10),
      splitDay: parseInt(row[headers.indexOf("split day")] || "0", 10),
      travel: parseInt(row[headers.indexOf("travel")] || "0", 10),
      leave: parseInt(row[headers.indexOf("leave")] || "0", 10),
      pending: parseInt(row[headers.indexOf("pending")] || "0", 10)
    });
  }

  return { success: true, analytics: analytics, fetchedAt: new Date().toISOString() };
}

/**
 * Returns a quick summary of today's counts by status.
 */
function getSummaryData() {
  var todayData = getTodayData();
  if (!todayData.success) return todayData;

  var counts = {
    Office: 0,
    Home: 0,
    "Client Location": 0,
    "Split Day": 0,
    Travel: 0,
    Leave: 0,
    Pending: 0,
    "No Data": 0
  };

  todayData.employees.forEach(function(emp) {
    var status = emp.status;
    if (counts.hasOwnProperty(status)) {
      counts[status]++;
    } else {
      counts["No Data"]++;
    }
  });

  var total = todayData.employees.length;
  var responded = total - counts.Pending - counts["No Data"];

  // Department-wise counts for today
  var deptCounts = {};
  todayData.employees.forEach(function(emp) {
    var depts = emp.department ? emp.department.split(",").map(function(d) { return d.trim(); }).filter(Boolean) : ["Unassigned"];
    if (depts.length === 0) depts = ["Unassigned"];
    depts.forEach(function(dept) {
      if (!deptCounts[dept]) {
        deptCounts[dept] = { total: 0, office: 0, home: 0, pending: 0, leave: 0 };
      }
      deptCounts[dept].total++;
      var s = emp.status;
      if (s === "Office" || s === "Client Location" || s === "Split Day") deptCounts[dept].office++;
      else if (s === "Home") deptCounts[dept].home++;
      else if (s === "Leave") deptCounts[dept].leave++;
      else if (s === "Pending" || s === "No Data") deptCounts[dept].pending++;
    });
  });

  return {
    success: true,
    date: todayData.date,
    total: total,
    responded: responded,
    responseRate: total > 0 ? Math.round((responded / total) * 100) : 0,
    counts: counts,
    departmentBreakdown: deptCounts,
    fetchedAt: new Date().toISOString()
  };
}
