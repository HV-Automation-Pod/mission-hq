-- ===========================================================================
-- One name, from one place: employees.full_name.
--
-- A `display_name` column was briefly added here to carry the spreadsheet's
-- own name across, because the stored per-person scores are keyed by whatever
-- name the last report printed and Zoho's legal name does not always match it.
-- That is a real mismatch, but it is worth one cycle of blank deltas rather
-- than a third name to keep in step for ever.
--
-- It stops mattering after the next send regardless: scores are keyed by EMAIL
-- from here on, so a renamed person keeps their history and this class of bug
-- cannot recur. The one-time cost is that people whose published name differs
-- from their Zoho name show no movement on the first report.
--
-- Written as a drop so it is safe whether or not 16_display_name.sql was run.
-- ===========================================================================

drop function if exists "mission-hq".shown_name("mission-hq".employees);

alter table "mission-hq".employees
  drop column if exists display_name;
