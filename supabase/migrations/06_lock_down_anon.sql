-- ===========================================================================
-- The browser must not be able to reach this schema. Belt, braces, and a nail.
--
-- The dashboard ships NEXT_PUBLIC_SUPABASE_URL and the anon key to the browser,
-- which is what those are for. Everything that reads MissionHQ data goes through
-- the Next.js server with the service role (`supabaseAdmin.ts`, which opens with
-- `import "server-only"` so importing it from a client component fails the build
-- rather than leaking the key).
--
-- So anon and authenticated need nothing here, and after this they have nothing
-- at four independent levels:
--
--   1. no table privileges            (01/02 revoke, 05 grants only service_role)
--   2. RLS on, with no policies       (01/02)
--   3. no default privileges          (05 defaults name service_role only)
--   4. no USAGE on the schema         (this file)
--
-- Verified against the live anon key before writing this: all three tables
-- already returned 42501. Level 4 only changes the error, not the outcome — but
-- it means a future `grant select ... to anon`, typed by somebody solving a
-- different problem, still does not open the door on its own.
--
-- TO UNDO, the day a signed-in human reads these tables straight from the
-- browser: grant usage back, grant select on the specific tables, and write an
-- RLS policy. All three, deliberately — that is the point.
-- ===========================================================================

revoke usage on schema "mission-hq" from anon, authenticated;

comment on schema "mission-hq" is
  'MissionHQ attendance. Reads public.employees / identity_links / holidays; '
  'writes nothing outside this schema. Service role only — anon and '
  'authenticated have no usage, no grants and no RLS policies.';
