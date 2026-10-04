-- ===========================================================================
-- `edge_invoke_key` is a shared secret now, not a public key on display.
--
-- It held the ANON key, and migration 09 argued that was fine because the
-- gateway's `verify_jwt` check "grants nothing". True, and that was the
-- problem: a check that grants nothing also protects nothing. It admits anyone
-- holding the anon key, which ships to every browser, so all eight scheduled
-- functions were reachable by the public. In practice they were reachable with
-- no bearer at all.
--
-- `denyUnlessScheduler()` now compares the caller's bearer against this row, so
-- the row is the control. A value that ships to every browser cannot be.
--
-- This migration is a GUARD, not the rotation. The live value was rotated out
-- of band, because a secret written into a migration is a secret in git. What
-- this does is make it impossible to leave it as a public key by accident.
-- ===========================================================================

do $$
declare v text;
begin
  select value #>> '{}' into v from "mission-hq".settings where key = 'edge_invoke_key';

  if v is null then
    raise exception
      'edge_invoke_key is not set. Eight scheduled functions gate on it; cron cannot run without it.';
  end if;

  -- A JWT. Both Supabase API keys are JWTs, and neither belongs here: the anon
  -- key is public, and the service-role key must never travel in a header.
  if left(v, 3) = 'eyJ' then
    raise exception
      'edge_invoke_key is a JWT, which means it is still a Supabase API key. '
      'Rotate it: update "mission-hq".settings set value = to_jsonb(encode(gen_random_bytes(32), ''hex'')) where key = ''edge_invoke_key'';';
  end if;

  if length(v) < 32 then
    raise exception 'edge_invoke_key is only % characters. It is the only gate on eight functions.', length(v);
  end if;

  raise notice 'edge_invoke_key: % characters, not a JWT. Good.', length(v);
end $$;

comment on table "mission-hq".settings is
  'Operational configuration. `edge_invoke_key` is the shared secret the eight '
  'scheduled edge functions authenticate against, so this table being '
  'service-role-only is load-bearing, not incidental. Rotating that row takes '
  'effect immediately: invoke_() and the gate both read it at call time.';
