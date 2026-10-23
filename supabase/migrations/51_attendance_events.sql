-- 51 — an append-only history of admin corrections to attendance.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
--
-- A correction used to overwrite the row and leave `source = 'manual'` and a
-- one-line `note`. The NEXT correction overwrote that too, so the record kept
-- only the last editor's name and nothing of what had been there before. For a
-- table that decides how people are scored, "who changed this, from what, and
-- why" has to be answerable after the fact.
--
-- This is that answer. One row per correction: the person and day, the status
-- before (null if there was no row, i.e. nobody had been asked), the status
-- after, the reason the editor typed, who they are, and when.
--
-- ---------------------------------------------------------------------------
-- DESIGN CHOICES
-- ---------------------------------------------------------------------------
--
--   * APPEND-ONLY, ENFORCED. No update or delete grant, and a trigger that
--     refuses both even for the service role, which bypasses grants. A history
--     that can be edited is not one.
--   * NO FOREIGN KEY on email. `attendance` cascades on employee delete; this
--     must not. The record of a correction outlives the person's row.
--   * The member's own `answered_at` is not touched by a correction (see the
--     action), so "when they answered" and "when an admin changed it" stay two
--     different facts: the first lives on `attendance`, the second here.
--
-- NON-DESTRUCTIVE: one new table. Nothing existing is altered.

create table if not exists "mission-hq".attendance_events (
  id          bigint generated always as identity primary key,
  email       text        not null,
  day         date        not null,
  old_status  text,
  new_status  text        not null,
  reason      text        not null,
  actor       text        not null,
  source      text        not null default 'manual',
  at          timestamptz not null default now()
);

comment on table "mission-hq".attendance_events is
  'Append-only history of corrections to attendance: who changed which day, from '
  'what, to what, and why. old_status is null when no row existed.';

create index if not exists attendance_events_person_idx
  on "mission-hq".attendance_events (email, day desc, at desc);

create or replace function "mission-hq".attendance_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'attendance_events is append-only: % is not allowed', tg_op;
end $$;

drop trigger if exists attendance_events_no_change on "mission-hq".attendance_events;
create trigger attendance_events_no_change
  before update or delete on "mission-hq".attendance_events
  for each row execute function "mission-hq".attendance_events_append_only();

alter table "mission-hq".attendance_events enable row level security;
revoke all on "mission-hq".attendance_events from anon, authenticated;
grant select, insert on "mission-hq".attendance_events to service_role;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--
--   select count(*) from "mission-hq".attendance_events;                  -- 0, then grows
--   update "mission-hq".attendance_events set reason = 'x';               -- must raise
--   delete from "mission-hq".attendance_events;                           -- must raise
