#!/usr/bin/env node
// Regression check for vuln-0031: the anon key must not be able to join or
// publish on a Realtime channel.
//
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//     node scripts/check-realtime-anon.mjs
//
// Exit 0 = anon is refused (good). Exit 1 = anon was let in. Exit 2 = could not
// tell (network, bad env), which is NOT a pass. Needs Node 22+ (global WebSocket).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(2);
}

const topic = `realtime:mission-hq-anon-probe-${Date.now()}`;
const ws = new WebSocket(
  `${url.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`,
);

const done = (code, msg) => {
  console.log(msg);
  try { ws.close(); } catch {}
  process.exit(code);
};

const timer = setTimeout(() => done(2, "INCONCLUSIVE: no reply within 10s"), 10_000);

ws.onerror = () => done(2, "INCONCLUSIVE: socket error (network or blocked host)");
ws.onopen = () =>
  ws.send(JSON.stringify({
    topic,
    event: "phx_join",
    payload: { config: { broadcast: { self: true }, presence: { key: "" }, private: false } },
    ref: "1",
  }));
ws.onmessage = (m) => {
  const f = JSON.parse(String(m.data));
  if (f.event !== "phx_reply" || f.topic !== topic) return;
  clearTimeout(timer);
  if (f.payload?.status === "ok") done(1, "FAIL: anon joined a Realtime channel (vuln-0031 is open)");
  done(0, `PASS: anon refused (${JSON.stringify(f.payload?.response ?? f.payload)})`);
};
