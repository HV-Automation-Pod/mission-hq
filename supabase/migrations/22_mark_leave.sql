-- ===========================================================================
-- Write approved Zoho leave into attendance, without ever overwriting an answer.
--
-- MATCHING IS BY EMPLOYEE ID, NOT EMAIL, and that is not a preference.
-- Zoho's leave records carry no employee email at all: only `EmployeeId` (the
-- org-tree emp_id), a display `Employee` name, a ZUID, and `Employee.ID`. They
-- do sometimes carry `TeamEmailID`, which is the REPORTING MANAGER's address.
-- An earlier version of this read that field and marked the manager as on
-- leave, silently suppressing their prompts for the day. Do not reach for an
-- email here; there isn't one.
--
-- So: emp_id first, then a normalised name for rows Zoho has no emp_id for.
-- Anything that matches neither is returned to the caller to be alerted, rather
-- than dropped, because a leave that fails to apply means somebody on holiday
-- gets nagged and then scored as Pending.
--
-- THE WRITE NEVER CLOBBERS A REAL ANSWER. `do update ... where status =
-- 'Pending'` is the whole safety property: somebody who answered "Office" and
-- then had leave approved retroactively keeps what they said. A blank day and a
-- Pending day both become Leave; anything else is left exactly as it is.
-- ===========================================================================

create or replace function "mission-hq".mark_leave(p_day date, p_people jsonb)
returns table (matched int, unmatched jsonb)
language plpgsql
security definer
set search_path = "mission-hq", public
as $$
declare
  m int;
  u jsonb;
begin
  create temp table _leave on commit drop as
  select
    p.value ->> 'emp_id' as emp_id,
    p.value ->> 'name'   as name,
    (select e.email
       from "mission-hq".employees e
      where (p.value ->> 'emp_id') is not null
        and lower(e.emp_id) = lower(p.value ->> 'emp_id')
      limit 1) as by_id,
    (select e.email
       from "mission-hq".employees e
      where "mission-hq".norm_(e.full_name) = "mission-hq".norm_(p.value ->> 'name')
      limit 1) as by_name
  from jsonb_array_elements(p_people) p;

  with resolved as (
    select coalesce(by_id, by_name) as email from _leave
     where coalesce(by_id, by_name) is not null
  ),
  written as (
    insert into "mission-hq".attendance as a (email, day, status, source)
    select r.email, p_day, 'Leave', 'zoho-leave' from resolved r
    on conflict (email, day) do update
       set status = 'Leave', source = 'zoho-leave', updated_at = now()
     -- Only a day nobody has answered for. An existing answer wins.
     where a.status = 'Pending'
    returning 1
  )
  select count(*)::int into m from written;

  select coalesce(jsonb_agg(jsonb_build_object('emp_id', emp_id, 'name', name)), '[]'::jsonb)
    into u
    from _leave
   where by_id is null and by_name is null;

  return query select m, u;
end $$;

comment on function "mission-hq".mark_leave(date, jsonb) is
  'Applies approved Zoho leave for one day. Never overwrites a submitted '
  'answer. Returns how many rows it wrote and the people it could not match.';

grant execute on function "mission-hq".mark_leave(date, jsonb) to service_role;
