-- ===========================================================================
-- Two audiences, one payload, and the scoping happens HERE.
--
-- Anybody with a company Google account can now sign in. Most of them are not
-- PnC: they get their own attendance and nothing else. A row in
-- `dashboard_access` is what makes somebody an admin who sees everyone.
--
-- `p_email` is the whole mechanism. When it is set, the function returns one
-- person; when it is null, everyone. Scoping in SQL rather than in the page
-- means a member's request cannot return another person's row even if a
-- component forgets to filter, a query string is tampered with, or a future
-- screen reads the payload directly. The UI deciding what to SHOW is a
-- presentation choice; the database deciding what to SEND is the control.
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
  with window_days as (
    select distinct a.day
      from "mission-hq".attendance a
     where a.day >= ("mission-hq".today_ist() - p_days)
       and (p_email is null or a.email = lower(p_email))
  ),
  dates as (
    select coalesce(jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day), '[]'::jsonb) as list
      from window_days
  ),
  people as (
    select e.email, e.full_name, e.team
      from "mission-hq".employees e
     where (p_email is null or e.email = lower(p_email))
       and (
         e.exited_at is null
         or e.prompt_opt_in
         or exists (
              select 1 from "mission-hq".attendance a
               where a.email = e.email
                 and a.day >= ("mission-hq".today_ist() - p_days)
            )
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

grant execute on function "mission-hq".dashboard_payload(int, text) to service_role;

-- `member_metrics` is already period-scoped and is what the fortnightly Slack
-- report computes from. The dashboard reads the SAME function, so "am I
-- compliant" has one answer rather than one per screen.
grant execute on function "mission-hq".member_metrics(date, date) to service_role;
