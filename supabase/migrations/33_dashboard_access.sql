-- ===========================================================================
-- Who may open the dashboard.
--
-- This thing shows every employee's attendance, their percentages and their
-- ranking. A Google sign-in restricted to the company domain is NOT enough on
-- its own: that is 350 people, and this is PnC's tool, not everybody's.
--
-- So two gates, and both must pass:
--   1. the email ends in a company domain (checked at sign-in)
--   2. the email has a row here
--
-- An allowlist rather than a role column on `employees`, because access to the
-- tool is not a property of being employed, and because somebody may need to
-- administer it before or after they appear in the HR feed.
--
-- `can_edit` separates reading from writing. Most people who need this need to
-- see it, not to change somebody's attendance record.
-- ===========================================================================

create table if not exists "mission-hq".dashboard_access (
  email      text primary key,
  can_edit   boolean not null default false,
  note       text,
  added_by   text,
  created_at timestamptz not null default now()
);

comment on table "mission-hq".dashboard_access is
  'Who may open the dashboard. Being an employee is not access; a row here is. '
  'can_edit gates writing attendance, not reading it.';

alter table "mission-hq".dashboard_access enable row level security;
grant select, insert, update, delete on "mission-hq".dashboard_access to service_role;

-- Seeded with one administrator so the tool is reachable at all. Everybody else
-- is added from inside it.
insert into "mission-hq".dashboard_access (email, can_edit, note, added_by)
values ('satish.d@hyperverge.co', true, 'Built the system', 'migration')
on conflict (email) do update set can_edit = true;

-- ---------------------------------------------------------------------------
-- Everything the dashboard's home screen needs, in ONE round trip.
--
-- The old dashboard called an Apps Script web app which read a 376 x 346 cell
-- grid and returned the lot, and a cold start alone was 3 to 4 seconds. This is
-- an aggregate over an indexed table and returns a single row.
-- ---------------------------------------------------------------------------
create or replace function "mission-hq".today_overview()
returns table (
  day            date,
  is_working_day boolean,
  expected       int,
  answered       int,
  pending        int,
  on_leave       int,
  not_prompted   int,
  in_office      int
)
language sql
stable
security definer
set search_path = "mission-hq", public
as $$
  with d as (select "mission-hq".today_ist() as day),
  roster as (
    select e.email
      from "mission-hq".employees e
     where (e.exited_at is null or e.prompt_opt_in)
       and e.wfo_exempt is null
  ),
  rows_today as (
    select a.email, a.status, l.w_wfo
      from "mission-hq".attendance a
      join roster r on r.email = a.email
      left join "mission-hq".locations l on l.status = a.status
     where a.day = (select day from d)
  )
  select
    (select day from d),
    "mission-hq".is_business_day((select day from d)),
    (select count(*)::int from roster),
    (select count(*)::int from rows_today where status <> 'Pending'),
    (select count(*)::int from rows_today where status = 'Pending'),
    (select count(*)::int from rows_today where status = 'Leave'),
    (select count(*)::int from roster) - (select count(*)::int from rows_today),
    (select coalesce(sum(w_wfo), 0)::int from rows_today);
$$;

grant execute on function "mission-hq".today_overview() to service_role;
