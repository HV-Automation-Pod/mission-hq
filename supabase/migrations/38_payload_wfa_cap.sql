-- ===========================================================================
-- Carry the WFA allowance into the payload, so the dashboard and the
-- fortnightly Slack report agree about EVERY person rather than most of them.
--
-- `member_metrics()` treats work-from-anywhere as neutral like leave only
-- while it is within the annual allowance; days beyond the cap stay in the
-- denominator. It can enforce that because it queries the whole year.
--
-- The dashboard scores client-side over a 90-day window, so it cannot see
-- allowance spent in January. Checked against the week of 2026-09-28: 345 of
-- 348 people matched the SQL exactly, and all three misses were this — people
-- well past 15 WFA days, whom the dashboard was quietly letting off.
--
-- Two additions fix it, both cheap:
--   wfaCap     the allowance, from settings, where it already lives because it
--              has moved once already (10 -> 15, PnC, 2026-08-21)
--   wfaBefore  per person, WFA days from Jan 1 up to the day BEFORE the window
--
-- The client already knows every WFA day inside the window, so those two are
-- all it needs to consume the allowance oldest-first the way the SQL does.
-- ===========================================================================

create or replace function "mission-hq".dashboard_payload(
  p_days  int  default 400,
  p_email text default null
)
returns jsonb
language sql
stable
security definer
set search_path = "mission-hq", public
as $$
  with bounds as materialized (
    select ("mission-hq".today_ist() - p_days) as from_day,
           date_trunc('year', "mission-hq".today_ist())::date as year_start,
           lower(nullif(p_email, '')) as only_email
  ),
  rows_in_window as materialized (
    select a.email, a.day, a.status
      from "mission-hq".attendance a, bounds b
     where a.day >= b.from_day
       and (b.only_email is null or a.email = b.only_email)
  ),
  window_days as materialized (
    select distinct day from rows_in_window
  ),
  people as materialized (
    select e.email, e.full_name, e.team
      from "mission-hq".employees e, bounds b
     where (b.only_email is null or e.email = b.only_email)
       and (
         e.exited_at is null
         or e.prompt_opt_in
         or exists (select 1 from rows_in_window r where r.email = e.email)
       )
  ),
  statuses as materialized (
    select r.email, jsonb_object_agg(to_char(r.day, 'YYYY-MM-DD'), r.status) as map
      from rows_in_window r
      join people p on p.email = r.email
     group by r.email
  ),
  -- Allowance already spent this year before the window opens. Only the days
  -- the window cannot see: everything inside it the client counts itself, and
  -- double-counting here would charge those days twice.
  wfa_before as materialized (
    -- `cross join bounds` AFTER the left join, not a comma before it: a comma
    -- binds looser than JOIN, so `from attendance a, bounds b left join ...`
    -- attaches the join to `bounds` and `a` is not in scope for its condition.
    select a.email, sum(coalesce(l.w_wfa, 0)) as days
      from "mission-hq".attendance a
      left join "mission-hq".locations l on l.status = a.status
      cross join bounds b
     where a.day >= b.year_start
       and a.day <  b.from_day
       and (b.only_email is null or a.email = b.only_email)
     group by a.email
  )
  select jsonb_build_object(
    'success', true,
    'dates', coalesce((select jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day) from window_days), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name',  coalesce(p.full_name, p.email),
          'email', p.email,
          'department', coalesce(p.team, ''),
          'statuses', coalesce(s.map, '{}'::jsonb),
          'wfaBefore', coalesce(w.days, 0)
        ) order by p.full_name
      )
      from people p
      left join statuses s on s.email = p.email
      left join wfa_before w on w.email = p.email
    ), '[]'::jsonb),
    'wfaCap', coalesce(
      (select value #>> '{}' from "mission-hq".settings where key = 'wfa_annual_cap'),
      '15')::numeric,
    'yearStart', to_char((select year_start from bounds), 'YYYY-MM-DD'),
    'totalEmployees', (select count(*) from people),
    'totalDates', (select count(*) from window_days),
    'fetchedAt', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS')
  );
$$;

grant execute on function "mission-hq".dashboard_payload(int, text) to service_role;
