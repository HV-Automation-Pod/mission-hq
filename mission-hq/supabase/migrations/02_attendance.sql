-- ===========================================================================
-- The attendance record itself, and the two tables that support it.
--
-- One row per person per day. The spreadsheet this replaces was the other
-- orientation — a column per day — which is why a second column for the same
-- date was expressible at all, and why every job had to read the whole grid to
-- answer a question about one day. `primary key (email, day)` makes the first
-- impossible and the second an index lookup.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- locations — the answer options, was the "Locations" sheet tab
--
-- `value` is what Slack sends back in the payload; `status` is what gets
-- stored. They differ for exactly one option: Slack cannot carry "Office +
-- Client" in a value, so it sends "Office-Client". That translation lived in
-- two places in Apps Script and is now one column.
-- ---------------------------------------------------------------------------
create table if not exists "mission-hq".locations (
  value       text primary key,
  label       text not null,
  status      text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true
);

comment on column "mission-hq".locations.value is
  'What Slack sends in the interaction payload.';
comment on column "mission-hq".locations.status is
  'What is written to attendance.status. Differs from value only for '
  'Office-Client -> "Office + Client".';

insert into "mission-hq".locations (value, label, status, sort_order) values
  ('Office',                '🏢 Office – Full Day',                    'Office',                 1),
  ('Home',                  '🏠 Home – Full Day',                      'Home',                   2),
  ('Client Location',       '📍 Client Location – Full Day',           'Client Location',        3),
  ('Split Day',             '🔀 Split Day (Home + Office / Client)',    'Split Day',              4),
  ('Travel',                '🧳 Travel / On the Move',                 'Travel',                 5),
  ('Leave',                 '🌴 On Leave / Unavailable',               'Leave',                  6),
  ('Office-Client',         '🏢📍 Office + Client – Full Day',          'Office + Client',        7),
  ('Anywhere',              '🌐 Work from Anywhere',                   'Anywhere',               8),
  ('Compensatory WFH',      '🏡 Compensatory WFH – Full Day',          'Compensatory WFH',       9),
  ('Half Day Office Leave', '🏢🌴 Half Day Office + Half Day Leave',    'Half Day Office Leave', 10),
  ('Half Day WFH Leave',    '🏡🌴 Half Day WFH + Half Day Leave',       'Half Day WFH Leave',    11)
on conflict (value) do update set
  label = excluded.label, status = excluded.status, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- attendance
--
-- THREE STATES, AND THE DIFFERENCE BETWEEN THEM IS LOAD-BEARING. The
-- fortnightly summary's arithmetic depends on it, so it is encoded here rather
-- than left to each reader:
--
--   no row        no prompt reached them that day — a new joiner, an exempt
--                 row, a deactivated account. Leaves their denominator.
--   'Pending'     prompted and never answered. Stays IN the denominator and
--                 out of the numerator; this is the one that costs them.
--   anything else their answer.
--
-- The sheet encoded the same three as blank / "Pending" / a value, and getting
-- blank and Pending confused is what once dragged a whole group's numbers down.
-- ---------------------------------------------------------------------------
create table if not exists "mission-hq".attendance (
  email        text not null references "mission-hq".employees(email) on delete cascade,
  day          date not null,
  status       text not null,

  -- Where the value came from, so a disputed day can be explained without
  -- guesswork: 'prompt' (the Pending marker), 'slack' (they answered),
  -- 'recovered' (rebuilt from their Slack DM after a lost write),
  -- 'zoho-leave' (approved leave), 'manual' (a human on the dashboard).
  source       text not null default 'slack',

  -- When the person actually answered, which is NOT when the row was written:
  -- a recovered answer is written days after it was given.
  answered_at  timestamptz,
  note         text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  primary key (email, day)
);

comment on table "mission-hq".attendance is
  'One row per person per day. No row, ''Pending'', and a real status are three '
  'different things — see the migration header before treating them alike.';

-- "Who is still pending on day X" and "what did this person do over a period"
-- are the only two shapes anything asks for.
create index if not exists attendance_day_status_idx
  on "mission-hq".attendance (day, status);
create index if not exists attendance_email_day_idx
  on "mission-hq".attendance (email, day desc);

-- ---------------------------------------------------------------------------
-- prompts — the DM we sent, so we can edit it later
--
-- The confirmation is a chat.update of the prompt message, so answering needs
-- that message's timestamp. Apps Script kept it on a "Messages TS" tab.
-- ---------------------------------------------------------------------------
create table if not exists "mission-hq".prompts (
  email       text not null references "mission-hq".employees(email) on delete cascade,
  day         date not null,
  channel     text not null,
  message_ts  text not null,
  sent_at     timestamptz not null default now(),
  primary key (email, day)
);

-- ---------------------------------------------------------------------------
-- is_business_day — weekends and the company holiday list, in one place
--
-- Apps Script kept the holiday list in a hand-edited array inside
-- WorkCalendar.js. public.holidays is the same list, already maintained, with
-- an admin screen and a weekly sync. This is the only thing that should ever
-- decide whether a day counts.
-- ---------------------------------------------------------------------------
create or replace function "mission-hq".is_business_day(d date)
returns boolean
language sql
stable
security definer
set search_path = "mission-hq", public
as $$
  select extract(isodow from d) < 6
     and not exists (select 1 from public.holidays h where h.day = d);
$$;

comment on function "mission-hq".is_business_day(date) is
  'Mon-Fri and not in public.holidays. The single answer to "does this day '
  'count" — do not reimplement it in a caller.';

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Enabled with NO policies, which means: deny everyone. That is not an
-- oversight, it is the intended state.
--
-- The only client is the dashboard, and it connects with the SERVICE ROLE key
-- (`supabaseAdmin.ts`), which bypasses RLS entirely — so locking these tables
-- costs MissionHQ nothing. What it buys is that WeCare's own `anon` and
-- `authenticated` keys, which belong to a different product sharing this
-- database, cannot read 350 people's attendance. Today they lack table grants
-- anyway; RLS means a future `grant` cannot quietly open it.
--
-- Add a policy here the day a signed-in human reads these tables directly
-- rather than through the dashboard's server. Until then, deny-all is correct.
-- ---------------------------------------------------------------------------
alter table "mission-hq".locations enable row level security;
alter table "mission-hq".attendance enable row level security;
alter table "mission-hq".prompts enable row level security;

revoke all on all tables in schema "mission-hq" from anon, authenticated;

