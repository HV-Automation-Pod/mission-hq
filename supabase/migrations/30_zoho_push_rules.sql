-- ===========================================================================
-- What gets pushed to Zoho, and for how much of a day.
--
-- LEAVE IS NOT PUSHED. A leave day pushed as a 09:30-18:30 check-in makes the
-- muster roll read PRESENT, having worked nine hours, on a day the person was
-- on leave. Zoho's own leave tracker already holds that day — it is where this
-- system read the leave from in the first place — so pushing attendance for it
-- makes one half of Zoho contradict the other. The Apps Script version pushed
-- it, skipping only `Pending`, and that has been quietly wrong since August.
--
-- HALF DAYS ARE PUSHED AS HALF A DAY. Somebody on `Half Day Office Leave` was
-- at work for half of it, and a full 09:30-18:30 would overstate them exactly
-- as much as pushing nothing would understate them. `day_fraction` carries it,
-- and the push function turns 0.5 into a 09:30-13:30 pair.
--
-- The fraction comes from the weights already on `locations`, so it cannot
-- drift from the scoring: a status that counts as half a worked day in the
-- report is half a worked day to Zoho.
-- ===========================================================================

-- `create or replace view` can only APPEND columns: adding `day_fraction` in
-- the middle reads to Postgres as renaming `updated_at`, which it refuses.
-- Nothing depends on this view, so dropping it is free.
drop view if exists "mission-hq".zoho_push_queue;

create view "mission-hq".zoho_push_queue as
  select
    a.email,
    a.day,
    a.status,
    e.emp_id,
    -- Zoho's `location` is a geographic punch SITE (Bengaluru, Mumbai), not a
    -- work mode. Office/Home belong in the status, never here.
    "mission-hq".site(e) as site,
    -- How much of a day was actually worked. Leave never reaches here, so this
    -- is 1 for a full day and 0.5 for either half-day status.
    (l.w_wfo + l.w_wfh + l.w_wfa)::numeric as day_fraction,
    a.updated_at
  from "mission-hq".attendance a
  join "mission-hq".employees e on e.email = a.email
  join "mission-hq".locations l on l.status = a.status
 where a.status <> 'Pending'
   -- Nothing that is wholly leave. A half-day leave still has worked time and
   -- is kept; a full `Leave` day has none and is Zoho's own business.
   and (l.w_wfo + l.w_wfh + l.w_wfa) > 0
   and e.emp_id is not null
   and e.emp_id <> ''
   and a.day >= (current_date - 60)
   and (a.zoho_pushed_at is null or a.updated_at > a.zoho_pushed_at);

comment on view "mission-hq".zoho_push_queue is
  'Attendance Zoho has not been told about yet. Excludes Pending, excludes '
  'whole-leave days, and excludes rows with no Zoho employee id: one of those '
  'in a batch fails the entire batch.';

grant select on "mission-hq".zoho_push_queue to service_role;

-- A whole-leave day can never be owed again, so stamp the ones already in the
-- table rather than leaving them looking permanently unpushed.
update "mission-hq".attendance a
   set zoho_pushed_at = now()
  from "mission-hq".locations l
 where l.status = a.status
   and (l.w_wfo + l.w_wfh + l.w_wfa) = 0
   and a.zoho_pushed_at is null;

select count(*) as owed_now,
       count(*) filter (where day_fraction < 1) as half_days
  from "mission-hq".zoho_push_queue;
