-- ===========================================================================
-- Count the days of a period in SQL, because counting them over the wire is
-- wrong in a way that looks right.
--
-- The summary was fetching every attendance row in the period and counting
-- distinct days client-side. PostgREST caps a response at 1000 rows whatever
-- the query asks for, so for a fortnight across ~350 people it returned the
-- first 1000 rows, which covered THREE days. Every report then said
-- "3 working days" over tables showing 11/11.
--
-- The silent half is worse than the visible half: the same count gives the
-- number of WEDNESDAYS in the period, which decides who the "would be meeting
-- the standard if these had been Wednesdays" footnote may name. Three instead
-- of three-of-eleven quietly changes who gets called out in a channel.
--
-- An aggregate cannot be truncated by a row limit, so this cannot recur.
-- ===========================================================================

create or replace function "mission-hq".period_days(p_from date, p_to date)
returns table (working_days int, wednesdays int)
language sql
stable
security definer
set search_path = "mission-hq", public
as $$
  with days as (
    select distinct a.day
      from "mission-hq".attendance a
     where a.day between p_from and p_to
  )
  select
    count(*)::int,
    count(*) filter (where extract(isodow from day) = 3)::int
  from days;
$$;

comment on function "mission-hq".period_days(date, date) is
  'Working days and Wednesdays in a period, from the days anybody was actually '
  'prompted on. Aggregated server-side: counting rows over PostgREST silently '
  'truncates at 1000 and under-reports both.';

grant execute on function "mission-hq".period_days(date, date) to service_role;

select * from "mission-hq".period_days('2026-09-16', '2026-09-30');
