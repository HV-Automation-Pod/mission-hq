-- ===========================================================================
-- Push to Zoho by WHAT HAS CHANGED, not by what day it is.
--
-- The Apps Script version pushed "yesterday" and only yesterday. That misses
-- every late answer, and late answers are normal here: the confirmation DM
-- keeps its Edit button for ever, so somebody can answer a prompt from last
-- week today, and the recovery sweep repairs cells days after the fact. None of
-- those ever reached Zoho, so the muster roll quietly disagreed with the sheet
-- and nobody could see why.
--
-- `zoho_pushed_at` turns the question into "what have we not sent yet, or sent
-- before it changed", which covers yesterday AND the week-old correction with
-- the same query. A row edited again after being pushed comes back into the
-- queue on its own, because `updated_at` moves and `zoho_pushed_at` does not.
-- ===========================================================================

alter table "mission-hq".attendance
  add column if not exists zoho_pushed_at timestamptz;

comment on column "mission-hq".attendance.zoho_pushed_at is
  'When this row was last accepted by Zoho. Null, or older than updated_at, '
  'means it is still owed.';

-- The hot query is "what is owed", so index exactly that.
create index if not exists attendance_zoho_pending_idx
  on "mission-hq".attendance (day)
  where zoho_pushed_at is null;

-- ---------------------------------------------------------------------------
-- zoho_push_queue
--
-- `emp_id` is NOT optional. Zoho rejects any bulkImport array containing a
-- record identified by email with a generic 400 (code 7200) that names no
-- field, so ONE bad record takes down every record batched with it. Established
-- by probe on 2026-08-05: 50 mixed records failed, the same 50 minus the one
-- email row passed, and that row then failed alone in a batch of one. Rows
-- without an emp_id are therefore excluded here and counted separately, rather
-- than being allowed to poison a batch.
--
-- `Pending` and blank days are not presence and are never pushed.
--
-- The 60-day window stops a schema change or a cleared `zoho_pushed_at` from
-- replaying two years of history into a rate-limited API.
-- ---------------------------------------------------------------------------
create or replace view "mission-hq".zoho_push_queue as
  select
    a.email,
    a.day,
    a.status,
    e.emp_id,
    -- Zoho's `location` is a geographic punch SITE (Bengaluru, Mumbai), not a
    -- work mode. Office/Home belong in the status, never here.
    "mission-hq".site(e) as site,
    a.updated_at
  from "mission-hq".attendance a
  join "mission-hq".employees e on e.email = a.email
 where a.status <> 'Pending'
   and e.emp_id is not null
   and e.emp_id <> ''
   and a.day >= (current_date - 60)
   and (a.zoho_pushed_at is null or a.updated_at > a.zoho_pushed_at);

comment on view "mission-hq".zoho_push_queue is
  'Attendance Zoho has not been told about yet. Excludes rows with no Zoho '
  'employee id: one of those in a batch fails the entire batch.';

-- Rows that can never be pushed, so somebody can fix the employee id rather
-- than wonder why a person is absent in the muster roll for ever.
create or replace view "mission-hq".zoho_push_blocked as
  select a.email, e.full_name, count(*) as days_unpushable
    from "mission-hq".attendance a
    join "mission-hq".employees e on e.email = a.email
   where a.status <> 'Pending'
     and (e.emp_id is null or e.emp_id = '')
     and a.day >= (current_date - 60)
     and a.zoho_pushed_at is null
   group by a.email, e.full_name;

-- Marking is its own function so a batch is stamped in one statement, and only
-- after Zoho has accepted it.
create or replace function "mission-hq".mark_zoho_pushed(p_rows jsonb)
returns int
language sql
security definer
set search_path = "mission-hq", public
as $$
  with updated as (
    update "mission-hq".attendance a
       set zoho_pushed_at = now()
      from jsonb_array_elements(p_rows) r
     where a.email = (r.value ->> 'email')
       and a.day   = (r.value ->> 'day')::date
    returning 1
  )
  select count(*)::int from updated;
$$;

grant select on "mission-hq".zoho_push_queue   to service_role;
grant select on "mission-hq".zoho_push_blocked to service_role;
grant execute on function "mission-hq".mark_zoho_pushed(jsonb) to service_role;

-- Everything already in the table predates this and was pushed by Apps Script,
-- so it is stamped rather than queued. Without this the first run would try to
-- replay 40,000 rows into an API that allows ten requests per five minutes.
update "mission-hq".attendance
   set zoho_pushed_at = now()
 where zoho_pushed_at is null
   and day < current_date;

select (select count(*) from "mission-hq".zoho_push_queue)   as owed_now,
       (select count(*) from "mission-hq".zoho_push_blocked) as people_without_emp_id;
