-- ===========================================================================
-- Make the payload fast. It was 4-5 seconds, which is the thing this migration
-- set out to kill.
--
-- The tell was that 60 days took LONGER than 400: the cost was not the data, it
-- was the plan. Since Postgres 12 a plain CTE is inlined, and these were
-- referenced several times each — `people` three times, the day list twice — so
-- the whole scan ran again per reference.
--
-- `as materialized` computes each one once. The arithmetic is unchanged; only
-- the number of times it happens is.
--
-- `today_ist()` is also pulled out into a single scalar instead of being called
-- inside three separate predicates.
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

-- The window predicate is `day >= X`, so an index in day order is what serves
-- it. The existing indexes are (day, status) and (email, day desc); neither is
-- wrong, but a covering one means the scan never touches the heap.
create index if not exists attendance_day_email_status_idx
  on "mission-hq".attendance (day, email) include (status);

analyze "mission-hq".attendance;
analyze "mission-hq".employees;
