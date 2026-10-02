// ---------------------------------------------------------------------------
// ONE-OFF: turn the MissionHQ Log into SQL for the Postgres migration.
//
// Run generateSupabaseBackfillSql() from the editor. It writes .sql files to a
// Drive folder and logs their links; open each, copy, run in the Supabase SQL
// editor IN THE ORDER LOGGED. It writes nothing to the sheet and calls no API,
// so it is safe to run as many times as you like — and the SQL it emits is
// idempotent, so re-running the SQL is safe too.
//
// WHY IT EMITS EMPLOYEES FIRST
// ---------------------------------------------------------------------------
// `attendance.email` references `mission-hq.employees(email)`. The Log has ~376
// people; the Zoho feed behind `public.employees` has ~351. Those ~25 — leavers
// whose history is still in the sheet, and the handful whose Zoho record sits
// under a different address — would fail the foreign key and take their
// attendance history with them. So every email in the Log gets an employees row
// first.
//
// A row CREATED by that insert is, by definition, one the Zoho mirror did not
// already seed — i.e. somebody the feed does not list — so it is stamped
// `exited_at = now()`: their history imports, but they are not prompted on
// Monday. Clear the cell for anyone who should be. Rows that already exist are
// left alone apart from WFO Exempt, which is MissionHQ's own field and only
// lives in the sheet.
//
// WHAT COUNTS AS DATA
// ---------------------------------------------------------------------------
// A blank cell is NOT a row. Blank means no prompt reached that person that day
// and it has to stay absent, because the summary arithmetic treats blank and
// "Pending" as different things — blank leaves the denominator, Pending stays
// in it. Emitting blanks as 'Pending' would silently charge everybody for every
// day they were never asked about.
// ---------------------------------------------------------------------------

// The SQL editor rejects a statement past roughly a megabyte ("Query is too
// large to be run via the SQL Editor") — a dashboard limit, not a Postgres one.
// 2000 tuples lands near 100 KB and goes through comfortably.
const BACKFILL_SQL_CHUNK_ROWS = 2000;

// CSV has no such ceiling; the chunk here only keeps the browser's importer
// responsive on a file it has to parse client-side.
const BACKFILL_CSV_CHUNK_ROWS = 50000;

const BACKFILL_FOLDER_NAME = "MissionHQ Supabase backfill";

/**
 * CSV for the attendance rows — the one to use. Table editor -> attendance ->
 * Import data from CSV, one drag and drop per file.
 *
 * Employees stays SQL whichever mode you pick: it is ~376 rows, nowhere near
 * the editor's limit, and it needs an ON CONFLICT clause that a CSV import
 * cannot express.
 *
 * NOTE the importer does plain inserts, so it is NOT re-runnable: a second
 * import of the same file fails on the primary key. Import once; if you need to
 * start over, `truncate "mission-hq".attendance;` first, or use the SQL mode,
 * which is idempotent.
 */
function generateSupabaseBackfillCsv() {
  return buildSupabaseBackfill_("csv");
}

/**
 * The same data as SQL, in small chunks. Slower to paste, but idempotent — an
 * existing row for the same person and day is left alone — so it is the mode to
 * use if a run has to be resumed or repeated.
 */
function generateSupabaseBackfillSql() {
  return buildSupabaseBackfill_("sql");
}

function buildSupabaseBackfill_(mode) {
  const csv = mode === "csv";
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0].map(h => h.toString().trim());

  const emailCol = headers.indexOf("Email Address");
  const nameCol = headers.indexOf("Full Name");
  if (emailCol === -1 || nameCol === -1) {
    throw new Error("Required columns (Full Name, Email Address) not found");
  }
  const empIdCol = headers.indexOf(EMPLOYEE_ID_COLUMN);
  const deptCol = headers.indexOf("Department");
  const locCol = headers.indexOf("Location");
  const exemptCol = headers.indexOf(WFO_EXEMPT_COLUMN);

  // Date columns, oldest first so the generated SQL reads chronologically.
  const dateCols = [];
  for (let i = 0; i < headers.length; i++) {
    const day = normalizeDateHeader_(headers[i]);
    if (day) dateCols.push({ index: i, day: day });
  }
  dateCols.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  // A date with two columns is a known failure mode of the sheet — the whole
  // reason the new table has `primary key (email, day)`. Collapse them here
  // rather than letting the import die on a duplicate key.
  const colsByDay = {};
  dateCols.forEach(col => {
    if (!colsByDay[col.day]) colsByDay[col.day] = [];
    colsByDay[col.day].push(col.index);
  });
  const duplicateDays = Object.keys(colsByDay).filter(d => colsByDay[d].length > 1).sort();

  const employeeRows = [];
  const attendanceRows = [];
  const seenEmails = {};
  let blanks = 0;
  let pending = 0;
  let answered = 0;
  let collapsed = 0;
  let skippedRows = 0;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const email = (row[emailCol] || "").toString().trim().toLowerCase();
    if (!email) { skippedRows++; continue; }
    // A duplicate email in the Log would produce two conflicting histories.
    // First row wins, and the rest are reported rather than merged silently.
    if (seenEmails[email]) { skippedRows++; continue; }
    seenEmails[email] = true;

    employeeRows.push("(" + [
      sqlText_(email),
      sqlText_((row[nameCol] || "").toString().trim()),
      sqlText_(empIdCol !== -1 ? (row[empIdCol] || "").toString().trim() : ""),
      sqlText_(deptCol !== -1 ? (row[deptCol] || "").toString().trim() : ""),
      sqlText_(locCol !== -1 ? (row[locCol] || "").toString().trim() : ""),
      sqlText_(exemptCol !== -1 ? (row[exemptCol] || "").toString().trim() : ""),
      // Only ever applied to rows this insert CREATES — see the header. An
      // existing row keeps whatever the Zoho mirror set.
      "now()"
    ].join(",") + ")");

    Object.keys(colsByDay).forEach(day => {
      const indexes = colsByDay[day];

      // One value per day. A real answer beats "Pending" — a Pending sitting in
      // a stale duplicate column must never overwrite the answer in the live
      // one, which is precisely the bug WRITTEN_TO_DUPLICATE_COLUMN described.
      let value = "";
      for (let i = 0; i < indexes.length; i++) {
        const cell = (row[indexes[i]] || "").toString().trim();
        if (!cell) continue;
        if (!value) { value = cell; continue; }
        if (value === "Pending" && cell !== "Pending") { value = cell; collapsed++; }
        else if (cell !== value) collapsed++;
      }

      if (!value) { blanks++; return; }
      if (value === "Pending") pending++; else answered++;

      // Kept as values, not as pre-rendered SQL: the same rows have to come out
      // as either a tuple or a CSV line, and formatting once at emit time is
      // what stops the two drifting apart.
      attendanceRows.push({ email: email, day: day, status: value });
    });
  }

  // -------------------------------------------------------------------------
  // Emit
  // -------------------------------------------------------------------------
  const folder = getOrCreateBackfillFolder_();
  const files = [];

  files.push(writeBackfillFile_(folder, "01-employees.sql",
    "-- MissionHQ backfill 1/N: every person in the Log.\n" +
    "-- Run this FIRST — attendance references it.\n" +
    "-- Rows created here are people the Zoho feed does not list, so they are\n" +
    "-- stamped exited_at = now(): history imports, no prompt on Monday.\n" +
    "-- Rows that already exist keep their mirrored Zoho data untouched.\n\n" +
    "insert into \"mission-hq\".employees as e\n" +
    "  (email, full_name, emp_id, team, location, wfo_exempt, exited_at)\n" +
    "values\n" +
    employeeRows.join(",\n") + "\n" +
    "on conflict (email) do update set\n" +
    "  -- WFO Exempt only ever lived in the sheet, so bring it across; never\n" +
    "  -- overwrite a value already set on the Postgres side with a blank.\n" +
    "  wfo_exempt = coalesce(nullif(excluded.wfo_exempt, ''), e.wfo_exempt),\n" +
    "  updated_at = now();\n"));

  const chunkSize = csv ? BACKFILL_CSV_CHUNK_ROWS : BACKFILL_SQL_CHUNK_ROWS;
  const chunks = Math.ceil(attendanceRows.length / chunkSize) || 1;
  for (let c = 0; c < chunks; c++) {
    const slice = attendanceRows.slice(c * chunkSize, (c + 1) * chunkSize);
    if (!slice.length) break;
    const part = String(c + 1).padStart(2, "0");

    if (csv) {
      // Header row names the columns so the importer maps them itself. The
      // table's defaults fill created_at / updated_at.
      files.push(writeBackfillFile_(folder, `02-attendance-${part}.csv`,
        "email,day,status,source\n" +
        slice.map(r => [r.email, r.day, r.status, "backfill"].map(csvField_).join(",")).join("\n") + "\n"));
    } else {
      files.push(writeBackfillFile_(folder, `02-attendance-${part}.sql`,
        `-- MissionHQ backfill: attendance part ${c + 1} of ${chunks} (${slice.length} rows).\n` +
        "-- Safe to re-run: an existing row for the same person and day is kept.\n\n" +
        "insert into \"mission-hq\".attendance (email, day, status, source)\nvalues\n" +
        slice.map(r =>
          "(" + [sqlText_(r.email), sqlText_(r.day), sqlText_(r.status), "'backfill'"].join(",") + ")"
        ).join(",\n") + "\n" +
        "on conflict (email, day) do nothing;\n"));
    }
  }

  // A count the import can be checked against, rather than trusting it ran.
  files.push(writeBackfillFile_(folder, "03-verify.sql",
    "-- Run LAST. The numbers on the right are what this sheet held.\n\n" +
    "select\n" +
    `  (select count(*) from "mission-hq".employees)                             as employees,        -- expect >= ${employeeRows.length}\n` +
    `  (select count(*) from "mission-hq".attendance)                            as attendance,       -- expect ${attendanceRows.length}\n` +
    `  (select count(*) from "mission-hq".attendance where status = 'Pending')   as pending,          -- expect ${pending}\n` +
    `  (select count(*) from "mission-hq".attendance where status <> 'Pending')  as answered,         -- expect ${answered}\n` +
    `  (select min(day) from "mission-hq".attendance)                            as first_day,\n` +
    `  (select max(day) from "mission-hq".attendance)                            as last_day;\n`));

  Logger.log("=".repeat(78));
  Logger.log(`MissionHQ -> Supabase backfill (${csv ? "CSV" : "SQL"})`);
  Logger.log("=".repeat(78));
  Logger.log(`Sheet rows read            : ${data.length - 1}`);
  Logger.log(`People emitted             : ${employeeRows.length}`);
  Logger.log(`Rows skipped (blank/dupe)  : ${skippedRows}`);
  Logger.log(`Date columns               : ${dateCols.length} over ${Object.keys(colsByDay).length} distinct day(s)`);
  if (duplicateDays.length) {
    Logger.log(`!! Days with >1 column     : ${duplicateDays.length} (${duplicateDays.join(", ")})`);
    Logger.log(`   Collapsed cell conflicts: ${collapsed} (a real answer always beat "Pending")`);
  }
  Logger.log(`Attendance rows            : ${attendanceRows.length}`);
  Logger.log(`   of which Pending        : ${pending}`);
  Logger.log(`   of which answered       : ${answered}`);
  Logger.log(`Blank cells (NOT emitted)  : ${blanks}`);
  Logger.log("=".repeat(78));
  Logger.log(csv
    ? "Run 01 in the SQL editor, drag each .csv into Table editor -> attendance -> Import data from CSV, then run 03:"
    : "Run these in the SQL editor, in order:");
  files.forEach(f => Logger.log(`  ${f.getName()}  ${f.getUrl()}`));
  Logger.log("=".repeat(78));

  return {
    employees: employeeRows.length,
    attendance: attendanceRows.length,
    pending: pending,
    answered: answered,
    blanks: blanks,
    duplicateDays: duplicateDays,
    files: files.map(f => ({ name: f.getName(), url: f.getUrl() }))
  };
}

/** Postgres string literal, or NULL for blank. */
function sqlText_(value) {
  const text = (value === null || value === undefined ? "" : value.toString()).trim();
  if (!text) return "null";
  return "'" + text.replace(/'/g, "''") + "'";
}

/**
 * One CSV field. Everything is quoted rather than only the fields that need it:
 * a status like "Office + Client" is harmless today, but a comma added to the
 * Locations tab later would silently shift every column to its right.
 */
function csvField_(value) {
  return '"' + (value === null || value === undefined ? "" : value.toString()).replace(/"/g, '""') + '"';
}

function getOrCreateBackfillFolder_() {
  const existing = DriveApp.getFoldersByName(BACKFILL_FOLDER_NAME);
  return existing.hasNext() ? existing.next() : DriveApp.createFolder(BACKFILL_FOLDER_NAME);
}

/** One file per chunk, replaced rather than duplicated on a re-run. */
function writeBackfillFile_(folder, name, content) {
  const existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);
  return folder.createFile(name, content, MimeType.PLAIN_TEXT);
}

// ---------------------------------------------------------------------------
// ONE-OFF: the three things only the spreadsheet knows.
//
// Run generateSummarySeedSql() and run the file it writes. It covers what the
// Zoho feed cannot tell Postgres:
//
//   1. SITE CORRECTIONS. Zoho has no Coimbatore — those 22 people are filed as
//      Bengaluru. The Log's Location column carries the correction because the
//      employee sync only ever wrote it when blank, so a hand-fixed value
//      survived every run. That made this column quietly more accurate than its
//      source, and nothing recorded that it was.
//
//   2. THE FLG ROSTER. FLG is not a Zoho department — its people sit across
//      several — so no column can name them. The list is somebody's, kept by
//      hand on the FLG tab.
//
//   3. THE MANAGERS ROSTER. Mirrored from the managers Slack channel. Seeded
//      here so the first report is not short; afterwards it rebuilds itself
//      from Slack.
//
// The site SQL only writes an override where the sheet DISAGREES with Zoho, so
// it touches ~22 rows rather than ~375 and leaves the rest tracking the feed.
// ---------------------------------------------------------------------------

function generateSummarySeedSql() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(CANDIDATE_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${CANDIDATE_SHEET_NAME} not found`);

  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0].map(h => h.toString().trim());
  const emailCol = headers.indexOf("Email Address");
  const locCol = headers.indexOf("Location");
  if (emailCol === -1 || locCol === -1) throw new Error("Email Address / Location columns not found");

  const sites = [];
  const seen = {};
  for (let r = 1; r < data.length; r++) {
    const email = (data[r][emailCol] || "").toString().trim().toLowerCase();
    const loc = (data[r][locCol] || "").toString().trim();
    if (!email || !loc || seen[email]) continue;
    seen[email] = true;
    sites.push(`  (${sqlText_(email)}, ${sqlText_(loc)})`);
  }

  const flg = readSeedRoster_(spreadsheet, "FLG");
  const managers = readSeedRoster_(spreadsheet, "Managers");

  let sql =
    "-- Generated from the MissionHQ Log. Safe to re-run.\n\n" +
    "-- 1. Site corrections. Only written where the sheet disagrees with Zoho,\n" +
    "--    so the ~350 rows whose feed value is already right stay tracking it.\n" +
    "update \"mission-hq\".employees e\n" +
    "   set location_override = v.loc, updated_at = now()\n" +
    "  from (values\n" + sites.join(",\n") + "\n" +
    "       ) as v(email, loc)\n" +
    " where e.email = v.email\n" +
    "   and \"mission-hq\".norm_(v.loc) is distinct from \"mission-hq\".norm_(e.location);\n\n";

  sql += seedRosterSql_("flg", flg);
  sql += seedRosterSql_("managers", managers);

  sql +=
    "-- What it did. The site count should be about the size of the Coimbatore\n" +
    "-- group plus any other hand correction; a much larger number means the\n" +
    "-- sheet and the feed disagree far more widely than anyone thought.\n" +
    "select\n" +
    "  (select count(*) from \"mission-hq\".employees where location_override is not null) as site_overrides,\n" +
    "  (select count(*) from \"mission-hq\".rosters where group_key = 'flg')               as flg_roster,\n" +
    "  (select count(*) from \"mission-hq\".rosters where group_key = 'managers')          as managers_roster,\n" +
    "  (select count(*) from \"mission-hq\".group_members where group_key = 'coimbatore')  as coimbatore_members;\n";

  const folder = getOrCreateBackfillFolder_();
  const file = writeBackfillFile_(folder, "04-summary-seed.sql", sql);

  Logger.log("=".repeat(78));
  Logger.log(`Site values read       : ${sites.length}`);
  Logger.log(`FLG roster emails      : ${flg.length}`);
  Logger.log(`Managers roster emails : ${managers.length}`);
  Logger.log(`  ${file.getName()}  ${file.getUrl()}`);
  Logger.log("=".repeat(78));
  return { sites: sites.length, flg: flg.length, managers: managers.length, url: file.getUrl() };
}

/** Email column of a roster tab, by header name rather than position. */
function readSeedRoster_(spreadsheet, tabName) {
  const sheet = spreadsheet.getSheetByName(tabName);
  if (!sheet) { Logger.log(`No "${tabName}" tab — skipping that roster.`); return []; }
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => h.toString().trim());
  let col = -1;
  ["Email Address", "Email ID", "Email"].forEach(candidate => {
    if (col === -1) col = headers.indexOf(candidate);
  });
  if (col === -1) { Logger.log(`"${tabName}" has no email column — skipping.`); return []; }

  const seen = {};
  const emails = [];
  for (let r = 1; r < values.length; r++) {
    const email = (values[r][col] || "").toString().trim().toLowerCase();
    if (!email || seen[email]) continue;
    seen[email] = true;
    emails.push(email);
  }
  return emails;
}

/**
 * A roster is REPLACED, not merged: these tabs are the whole list, so a row
 * deleted there has to disappear here too. Wrapped per group so an empty tab
 * cannot silently wipe a roster that is fine.
 */
function seedRosterSql_(groupKey, emails) {
  if (!emails.length) {
    return `-- No rows found for the ${groupKey} roster; leaving it untouched.\n\n`;
  }
  return `-- ${groupKey} roster: ${emails.length} email(s), replacing whatever is there.\n` +
    `delete from "mission-hq".rosters where group_key = '${groupKey}';\n` +
    `insert into "mission-hq".rosters (group_key, email, source) values\n` +
    emails.map(e => `  ('${groupKey}', ${sqlText_(e)}, 'sheet')`).join(",\n") +
    "\non conflict (group_key, email) do nothing;\n\n";
}
