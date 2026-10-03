-- ===========================================================================
-- The whole dashboard payload, pivoted in Postgres, in one call.
--
-- The dashboard already knows how to render this shape: an employee carries a
-- `statuses` map of date -> status, which is the spreadsheet's own layout. That
-- shape is kept DELIBERATELY. Changing the storage was the point of this
-- migration; changing the contract the four tabs, the charts, the streaks and
-- the heatmap all read would have meant rewriting them, and rewriting working
-- code is how features get lost.
--
-- So the wide shape survives at the API boundary and nowhere else. Postgres
-- stores one row per person per day and pivots on the way out, which is the
-- opposite of the sheet: it stored wide and every reader had to cope.
--
-- One round trip. The screen this replaces called an Apps Script web app that
-- read a 376 x 346 cell grid on every request, and the cold start alone was
-- three to four seconds before any data moved.
-- ===========================================================================

create or replace function "mission-hq".dashboard_payload(p_days int default 400)
returns jsonb
language sql
stable
security definer
set search_path = "mission-hq", public
as $$
  with window_days as (
    select distinct a.day
      from "mission-hq".attendance a
     where a.day >= ("mission-hq".today_ist() - p_days)
  ),
  dates as (
    select coalesce(jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day), '[]'::jsonb) as list
      from window_days
  ),
  -- Anybody with history in the window, plus anybody currently active, so a
  -- new joiner appears before their first answer rather than after it.
  people as (
    select e.email, e.full_name, e.team
      from "mission-hq".employees e
     where e.exited_at is null
        or e.prompt_opt_in
        or exists (
             select 1 from "mission-hq".attendance a
              where a.email = e.email
                and a.day >= ("mission-hq".today_ist() - p_days)
           )
  ),
  statuses as (
    select a.email,
           jsonb_object_agg(to_char(a.day, 'YYYY-MM-DD'), a.status) as map
      from "mission-hq".attendance a
      join people p on p.email = a.email
     where a.day >= ("mission-hq".today_ist() - p_days)
     group by a.email
  )
  select jsonb_build_object(
    'success', true,
    'dates', (select list from dates),
    'employees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name',  coalesce(p.full_name, p.email),
          'email', p.email,
          -- The dashboard splits this on commas itself, which is how somebody
          -- in "Finance, FLG" lands in both groups.
          'department', coalesce(p.team, ''),
          'statuses', coalesce(s.map, '{}'::jsonb)
        ) order by p.full_name
      )
      from people p
      left join statuses s on s.email = p.email
    ), '[]'::jsonb),
    'totalEmployees', (select count(*) from people),
    'totalDates', (select count(*) from window_days),
    'fetchedAt', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS')
  );
$$;

comment on function "mission-hq".dashboard_payload(int) is
  'Everything the dashboard reads, pivoted date-wise to match the shape its '
  'components already expect. Storage is one row per person per day; only this '
  'boundary is wide.';

grant execute on function "mission-hq".dashboard_payload(int) to service_role;

select jsonb_array_length(("mission-hq".dashboard_payload(400) -> 'employees')) as employees,
       jsonb_array_length(("mission-hq".dashboard_payload(400) -> 'dates'))     as dates;
