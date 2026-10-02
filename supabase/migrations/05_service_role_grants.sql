-- ===========================================================================
-- Give `service_role` table privileges in this schema.
--
-- Exposing a schema under Settings -> API makes PostgREST *look* at it. It does
-- not grant anything, and a custom schema does not inherit the default
-- privileges Supabase sets up on `public` — so every call lands on
--
--   42501  permission denied for table locations
--
-- which reads like an RLS problem and is not one. RLS and privileges are two
-- different gates: `service_role` bypasses RLS by design, but it still needs the
-- GRANT, and it had none here because the tables were created in a schema
-- nobody had granted anything on.
--
-- Deliberately NOT granted to anon or authenticated. They keep exactly what
-- 01/02 left them: nothing, with RLS on and no policies, so WeCare's own app
-- keys cannot reach MissionHQ's data. The service role is the dashboard's
-- server and the edge functions, both of which already hold a secret.
--
-- The ALTER DEFAULT PRIVILEGES lines are what stop this recurring: without
-- them, the next `create table` in this schema is unreachable again, and the
-- error will be just as misleading the second time.
-- ===========================================================================

grant usage on schema "mission-hq" to service_role;

grant select, insert, update, delete
  on all tables in schema "mission-hq" to service_role;

grant usage, select
  on all sequences in schema "mission-hq" to service_role;

grant execute
  on all functions in schema "mission-hq" to service_role;

alter default privileges in schema "mission-hq"
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema "mission-hq"
  grant usage, select on sequences to service_role;

alter default privileges in schema "mission-hq"
  grant execute on functions to service_role;
