-- 48 — a day that is not a business day must not enter the summary at all.
--
-- ---------------------------------------------------------------------------
-- THE BUG
-- ---------------------------------------------------------------------------
--
-- `period_days` (25) counts the days of a period like this:
--
--   with days as (select distinct a.day from attendance a
--                  where a.day between p_from and p_to)
--   select count(*), count(*) filter (where isodow = 3) from days;
--
-- "the days anybody was actually prompted on", which is the right idea and the
-- wrong implementation. It counts any day carrying an attendance ROW, and a row
-- can exist on a day nobody was prompted on: somebody answering a stale DM over
-- the weekend, a backfill, a hand-inserted correction. Nothing stops it,
-- because `(email, day)` is the only constraint on that table and it says
-- nothing about which days are working days.
--
-- The G&A snapshot for 1-15 October 2026 was published reading
-- "11 working days". The period holds eleven weekdays, one of which is Gandhi
-- Jayanti, so the answer is TEN. The eleventh day counted was
-- SATURDAY 2026-10-03, which carries exactly one row.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS NOT ONLY A HEADER
-- ---------------------------------------------------------------------------
--
-- Two places read this, and the quiet one matters more.
--
--   working_days   printed in the header and in the methodology footnote.
--                  Visibly wrong, harmless.
--   wednesdays     decides who the "would be meeting the standard if these WFH
--                  days had been Wednesdays" footnote is ALLOWED to name. The
--                  gate is `wfh_off_wed <= wednesdays - wfh_on_wed`, so an
--                  inflated Wednesday count widens that list. A single stray
--                  row dated a weekend Wednesday silently changes who gets
--                  named in front of a channel.
--
-- `member_metrics` (18) has the SAME hole and it reaches further, because
-- `prompted` is also "count of rows in the period":
--
--   prompted  = count(*) over the period's rows      <- a weekend row is a day
--   available = prompted - leave - wfa_within        <- ...in the denominator
--
-- The Saturday row above is `Travel`, which is office-weighted, so it entered
-- one person's score as BOTH a credited day and an available one: the report
-- published 9/11 = 82% where the business-day answer is 8/10 = 80%.
--
-- Leaving `member_metrics` alone was considered and rejected. Fixing only
-- `period_days` publishes a message whose header says ten working days above a
-- table showing somebody 9/11, and a reader who notices that has found a
-- contradiction we introduced deliberately.
--
-- ---------------------------------------------------------------------------
-- SCOPE, MEASURED RATHER THAN ASSUMED
-- ---------------------------------------------------------------------------
--
--   select count(*) from "mission-hq".attendance
--    where day >= '2026-01-01' and not "mission-hq".is_business_day(day);
--
-- ONE row in all of 2026, the Saturday above. So this changes one person's
-- published percentage by two points and one header by one day. That is the
-- blast radius today; the point of the migration is that the gate was missing,
-- not that it was being hit often. The error only ever goes one way: more days
-- than there really are, in both the numerator and the denominator.
--
-- `is_business_day` is the single answer to "does this day count" (45). Both
-- functions now ask it rather than inferring the answer from whether a row
-- happens to exist.
--
-- NON-DESTRUCTIVE: two function bodies. No table, no column, no data.

-- ---------------------------------------------------------------------------
-- period_days
-- ---------------------------------------------------------------------------

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
       -- The gate this function was missing. A row is evidence somebody
       -- answered, not evidence the day was a working one.
       and "mission-hq".is_business_day(a.day)
  )
  select
    count(*)::int,
    count(*) filter (where extract(isodow from day) = 3)::int
  from days;
$$;

comment on function "mission-hq".period_days(date, date) is
  'Working days and Wednesdays in a period: days that are business days AND '
  'carry at least one attendance row. Both halves are load-bearing -- the row '
  'requirement keeps days nobody was prompted on out, and is_business_day() '
  'keeps weekend and holiday answers out. Aggregated server-side because '
  'counting rows over PostgREST silently truncates at 1000.';

grant execute on function "mission-hq".period_days(date, date) to service_role;

-- ---------------------------------------------------------------------------
-- member_metrics
--
-- Identical to 18 except for the `is_business_day` filter on the two CTEs that
-- read `attendance`. The return type is unchanged, so this replaces rather than
-- drops. Carried in full: `create or replace` is last-writer-wins, so the whole
-- body has to be here, never an edit to 18.
--
-- `ytd` is filtered too. A WFA day logged on a Saturday must not consume the
-- annual entitlement, for the same reason it must not consume a denominator.
-- ---------------------------------------------------------------------------

create or replace function "mission-hq".member_metrics(p_from date, p_to date)
returns table (
  email        text,
  full_name    text,
  wfo          numeric,
  wfh          numeric,
  wfa          numeric,
  wfa_over_cap numeric,
  wfa_ytd      numeric,
  leave        numeric,
  pending      numeric,
  prompted     numeric,
  available    numeric,
  checked_in   numeric,
  adherent     numeric,
  wfh_off_wed  numeric,
  standard_pct int,
  wfo_pct      int,
  ci_pct       int,
  tier         text
)
language sql
stable
security definer
set search_path = "mission-hq", public
as $$
  with cap as (
    select coalesce((select value #>> '{}' from "mission-hq".settings where key = 'wfa_annual_cap'), '15')::numeric n
  ),
  period as (
    select a.email, a.day, a.status, l.w_wfo, l.w_wfh, l.w_wfa, l.w_leave
      from "mission-hq".attendance a
      left join "mission-hq".locations l on l.status = a.status
     where a.day between p_from and p_to
       and "mission-hq".is_business_day(a.day)
  ),
  agg as (
    select
      p.email,
      sum(coalesce(p.w_wfo,   0)) as wfo,
      sum(coalesce(p.w_wfh,   0)) as wfh,
      sum(coalesce(p.w_wfa,   0)) as wfa,
      sum(coalesce(p.w_leave, 0)) as leave,
      sum(case when p.w_wfo is null then 1 else 0 end) as pending,
      sum(case when coalesce(p.w_wfh,0) > 0 and extract(isodow from p.day) = 3
               then p.w_wfh else 0 end) as wfh_wed,
      sum(case when coalesce(p.w_wfh,0) > 0 and extract(isodow from p.day) <> 3
               then p.w_wfh else 0 end) as wfh_off_wed,
      count(*)::numeric as prompted
    from period p
    group by p.email
  ),
  ytd as (
    select a.email, sum(coalesce(l.w_wfa, 0)) as wfa_ytd
      from "mission-hq".attendance a
      left join "mission-hq".locations l on l.status = a.status
     where a.day >= date_trunc('year', p_to)::date and a.day <= p_to
       and "mission-hq".is_business_day(a.day)
     group by a.email
  ),
  calc as (
    select g.email, e.full_name, g.wfo, g.wfh, g.wfa, g.leave, g.pending,
           g.prompted, g.wfh_wed, g.wfh_off_wed,
           coalesce(y.wfa_ytd, 0) as wfa_ytd,
           greatest(0, coalesce(y.wfa_ytd, 0) - g.wfa) as prior_wfa,
           (select n from cap) as cap_n
      from agg g
      join "mission-hq".employees e on e.email = g.email
      left join ytd y on y.email = g.email
  ),
  split as (
    select c.*, least(c.wfa, greatest(0, c.cap_n - c.prior_wfa)) as wfa_within from calc c
  ),
  final as (
    select s.email, s.full_name, s.wfo, s.wfh, s.wfa,
           (s.wfa - s.wfa_within)                   as wfa_over_cap,
           s.wfa_ytd, s.leave, s.pending, s.prompted,
           (s.prompted - s.leave - s.wfa_within)    as available,
           (s.wfo + s.wfh + (s.wfa - s.wfa_within)) as checked_in,
           (s.wfo + s.wfh_wed)                      as adherent,
           s.wfh_off_wed
      from split s
  )
  select
    f.email, f.full_name, f.wfo, f.wfh, f.wfa, f.wfa_over_cap, f.wfa_ytd,
    f.leave, f.pending, f.prompted, f.available, f.checked_in, f.adherent, f.wfh_off_wed,
    case when f.available > 0 then round(f.adherent   / f.available * 100)::int else 0 end,
    case when f.available > 0 then round(f.wfo        / f.available * 100)::int else 0 end,
    case when f.available > 0 then round(f.checked_in / f.available * 100)::int else 0 end,
    case
      when f.available <= 0                            then 'X'
      when abs(f.wfo      - f.available) < 0.01        then 'S'
      when abs(f.adherent - f.available) < 0.01        then 'A'
      when f.available > 0
       and round(f.adherent / f.available * 100) >= 60 then 'B'
      when round(f.adherent / f.available * 100) >= 1  then 'C'
      else 'D'
    end
  from final f
  order by
    case when f.available > 0 then round(f.adherent / f.available * 100) else -1 end desc,
    case when f.available > 0 then round(f.checked_in / f.available * 100) else -1 end desc,
    f.available desc, f.full_name;
$$;

comment on function "mission-hq".member_metrics(date, date) is
  'Per-person attendance arithmetic for a period, over BUSINESS DAYS only -- a '
  'row dated a weekend or a counted holiday is not a day anybody can be scored '
  'on, in either half of the fraction. Tier X means available = 0 (on leave the '
  'whole period); those are listed separately, never ranked at 0% as if they '
  'had ignored the bot.';

grant execute on function "mission-hq".member_metrics(date, date) to service_role;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
--
-- The period that published the wrong header. Expect 10 working days and 2
-- Wednesdays, where it previously returned 11 and 2:
--
--   select * from "mission-hq".period_days('2026-10-01', '2026-10-15');
--
-- Everybody whose score this migration moved. Expect exactly the people with a
-- non-business-day row in the period, which today is one:
--
--   select email, prompted, available, adherent, standard_pct
--   from "mission-hq".member_metrics('2026-10-01','2026-10-15')
--   where email = 'satish.d@hyperverge.co';          -- expect 10 / 10 / 8 / 80
--
-- And the rows that are now excluded, so the count is known rather than
-- guessed:
--
--   select day, email, status from "mission-hq".attendance
--   where day >= '2026-01-01' and not "mission-hq".is_business_day(day)
--   order by day;
