-- ===========================================================================
-- Fold `prompts` into `attendance`.
--
-- `prompts` was keyed on (email, day). So is `attendance`. A table whose key is
-- identical to another table's key is a column set, not a table — this was
-- normalisation out of habit rather than need, and it cost a join on the two
-- hottest paths (rendering a confirmation, and rendering the Edit button weeks
-- later) plus a second write on every send.
--
-- Every prompt already creates an attendance row at send time: that is what
-- `status = 'Pending'` IS. So there was never a prompt without a row to hang
-- these three columns on.
--
-- The cost is ~40,000 nulls on the backfilled history, which is a bit in the
-- null bitmap rather than a column's width.
--
-- `message_ts` stays load-bearing wherever it lives: the confirmation is a
-- chat.update of the prompt message, so without it a submitted answer cannot
-- replace the DM it came from, and the Edit button cannot reopen it a month on.
--
-- Applied by hand before this file existed; recorded here so the migration
-- history matches the database. 02's `create table prompts` is deliberately
-- left as it was — an applied migration is history and does not get edited.
-- ===========================================================================

alter table "mission-hq".attendance
  add column if not exists slack_channel text,
  add column if not exists message_ts    text,
  add column if not exists prompted_at   timestamptz;

comment on column "mission-hq".attendance.message_ts is
  'ts of the prompt DM. The confirmation is a chat.update of that message, so '
  'this is what lets an answer replace the prompt it came from.';

comment on column "mission-hq".attendance.prompted_at is
  'When the DM went out. Distinct from answered_at, and from created_at: a row '
  'can exist without a prompt (an approved leave, a manual correction).';

drop table if exists "mission-hq".prompts;
