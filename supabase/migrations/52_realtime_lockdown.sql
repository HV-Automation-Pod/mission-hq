-- 52 — keep the anonymous key out of Realtime.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
--
-- vuln-0031: with nothing but the publishable key from the browser bundle, a
-- client could open /realtime/v1/websocket, join a broadcast channel and
-- publish to it. MissionHQ does not use Realtime at all (no channel, broadcast
-- or websocket code anywhere), so there is no leak of ours in it, but an open
-- socket on the project is an open door, and the anon key is public by design.
--
-- ---------------------------------------------------------------------------
-- TWO CONTROLS, AND THIS IS ONLY ONE OF THEM
-- ---------------------------------------------------------------------------
--
--   1. PROJECT SETTING (the actual gate). Dashboard -> Realtime -> Settings ->
--      "Allow public access" OFF. Public channels are not subject to RLS, so
--      no SQL can close them. This is not expressible in a migration.
--   2. THIS MIGRATION (defence in depth). Private channels are authorised by
--      RLS on realtime.messages. Deny `anon` there explicitly, so the day
--      someone turns private channels on, or adds a permissive policy for
--      `authenticated`, anon is still refused.
--
-- scripts/check-realtime-anon.mjs proves control 1 from outside. Run it after
-- any change to Realtime settings.
--
-- NON-DESTRUCTIVE: revokes a grant nobody holds on purpose and adds one
-- restrictive policy. No data, no existing policy touched. Idempotent.
--
-- The project is shared with other apps. Nothing here grants anything, and a
-- restrictive policy only ever narrows `anon`, so it cannot break a signed-in
-- consumer.

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages not present; nothing to lock down';
    return;
  end if;

  revoke all on table realtime.messages from anon;

  alter table realtime.messages enable row level security;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'realtime'
      and tablename  = 'messages'
      and policyname = 'mission_hq_deny_anon'
  ) then
    create policy mission_hq_deny_anon on realtime.messages
      as restrictive
      for all
      to anon
      using (false)
      with check (false);
  end if;
end $$;
