-- ---------------------------------------------------------------------------
-- 55: a stable, opaque id for every person.
--
-- `email` is the primary key and `emp_id` is Zoho's and can be empty, so
-- neither is fit to put in a URL. `id` is MissionHQ's own: random, never
-- derived from anything about the person, and never changed.
--
-- Adding a column with a volatile default fills every existing row with its
-- own value. The Zoho mirror upserts by email and does not list `id`, so a
-- sync leaves it alone, and a returning employee keeps the same id.
-- ---------------------------------------------------------------------------
alter table "mission-hq".employees
  add column if not exists id uuid not null default gen_random_uuid();

create unique index if not exists employees_id_key
  on "mission-hq".employees (id);

comment on column "mission-hq".employees.id is
  'Opaque, stable id for use in URLs. MissionHQ''s own; the Zoho mirror never writes it.';
