-- ===========================================================================
-- Leave must be able to go away again, not just appear.
--
-- `mark_leave` only ever ADDED. If somebody's approved leave is cancelled, the
-- `Leave` row stayed and they were never prompted again for that day. Apps
-- Script had the same one-way behaviour, and it was survivable there only
-- because the sync ran minutes before the prompt. Running it every morning
-- makes it worse, not better: a cancellation has all day to be missed.
--
-- So the day's approved list is now authoritative in BOTH directions. Rows this
-- job wrote (`source = 'zoho-leave'`) for people no longer on the list are
-- removed, and they go back into the prompt.
--
-- ONLY rows this job wrote. A human marking somebody Leave on the dashboard, or
-- a person answering "On Leave / Unavailable" themselves, has `source` of
-- `manual` or `slack` and is never touched. The distinction is the whole reason
-- `source` exists.
-- ===========================================================================

-- The return type gains a `removed` column, and Postgres will not replace a
-- function whose OUT parameters change. Dropped first, deliberately: this is
-- the one case where `create or replace` is not enough.
drop function if exists "mission-hq".mark_leave(date, jsonb);

create or replace function "mission-hq".mark_leave(p_day date, p_people jsonb)
returns table (matched int, removed int, unmatched jsonb)
language plpgsql
security definer
set search_path = "mission-hq", public
as $$
declare
  m int;
  d int;
  u jsonb;
begin
  create temp table _leave on commit drop as
  select
    p.value ->> 'emp_id' as emp_id,
    p.value ->> 'name'   as name,
    (select e.email from "mission-hq".employees e
      where (p.value ->> 'emp_id') is not null
        and lower(e.emp_id) = lower(p.value ->> 'emp_id') limit 1) as by_id,
    (select e.email from "mission-hq".employees e
      where "mission-hq".norm_(e.full_name) = "mission-hq".norm_(p.value ->> 'name') limit 1) as by_name
  from jsonb_array_elements(p_people) p;

  create temp table _resolved on commit drop as
  select distinct coalesce(by_id, by_name) as email from _leave
   where coalesce(by_id, by_name) is not null;

  with written as (
    insert into "mission-hq".attendance as a (email, day, status, source)
    select r.email, p_day, 'Leave', 'zoho-leave' from _resolved r
    on conflict (email, day) do update
       set status = 'Leave', source = 'zoho-leave', updated_at = now()
     where a.status = 'Pending'
    returning 1
  )
  select count(*)::int into m from written;

  -- Cancelled since we last looked. Only rows this job owns.
  with gone as (
    delete from "mission-hq".attendance a
     where a.day = p_day
       and a.source = 'zoho-leave'
       and a.status = 'Leave'
       and not exists (select 1 from _resolved r where r.email = a.email)
    returning 1
  )
  select count(*)::int into d from gone;

  select coalesce(jsonb_agg(jsonb_build_object('emp_id', emp_id, 'name', name)), '[]'::jsonb)
    into u from _leave where by_id is null and by_name is null;

  return query select m, d, u;
end $$;

grant execute on function "mission-hq".mark_leave(date, jsonb) to service_role;
