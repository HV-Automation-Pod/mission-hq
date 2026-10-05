// TEMP driver: walks the range one day at a time, pacing for Zoho's
// 10-requests-per-5-minute Bulk Import lock. Resumable - re-run with a later
// --from if it stops.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync("/Users/satish/Documents/repos/mission-hq/mission-hq/.env","utf8")
  .split("\n").filter(l=>l.includes("=")&&!l.startsWith("#"))
  .map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:K,Authorization:`Bearer ${K}`,"Accept-Profile":"mission-hq"};
const tok = (await (await fetch(`${U}/rest/v1/settings?select=value&key=eq.edge_invoke_key`,{headers:H})).json())[0].value;

const arg = (n,d) => { const i=process.argv.indexOf(`--${n}`); return i>=0?process.argv[i+1]:d; };
const FROM = arg("from","2026-09-01"), TO = arg("to","2026-10-05");
// 180s, and the number is arithmetic rather than caution. A day of ~230 people
// is 5 Bulk Import requests at 50 per batch, and Zoho allows 10 per 5-minute
// lock. At 180s at most two day-runs fall inside any 5-minute window, which is
// exactly 10. At 150s it would be three, which is 15 and over.
// Override with --wait <seconds> if a day is much larger than that.
const WAIT_MS = Number(arg("wait", 180)) * 1000;
const DRY = process.argv.includes("--dry");

let day = FROM, totals = {found:0, pushed:0, blocked:0, days:0};
console.log(`backfill ${FROM} .. ${TO}  (${DRY?"DRY RUN - one day only":"live"})\n`);

while (day <= TO) {
  const t0 = Date.now();
  // One day is ~15s. Node's undici waits 300s for response headers and then
  // throws an UNCAUGHT TypeError that killed the whole run on 2026-10-03 with
  // 28 days already done. A long run must not be destroyed by one slow call,
  // so: own timeout, bounded retries, and a failure that stays a failure the
  // loop can report rather than an exception that takes the process with it.
  let j = null, lastErr = "";
  for (let tryN = 1; tryN <= 3 && !j; tryN++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120_000);
    try {
      const r = await fetch(`${U}/functions/v1/mission-hq-zoho-backfill`,{method:"POST",
        headers:{authorization:`Bearer ${tok}`,"content-type":"application/json"},
        body: JSON.stringify({ day }), signal: ac.signal});
      j = await r.json();
    } catch (e) {
      lastErr = e?.name === "AbortError" ? "timed out after 120s" : String(e?.message || e);
      if (tryN < 3) await new Promise(r => setTimeout(r, 15_000));
    } finally { clearTimeout(timer); }
  }
  if (!j) j = { ok: false, error: `${lastErr} (3 attempts)` };
  const secs = ((Date.now()-t0)/1000).toFixed(1);
  console.log(`  ${day}  found=${String(j.found ?? "-").padStart(4)} pushed=${String(j.pushed ?? "-").padStart(4)}` +
              ` blocked=${String(j.blocked ?? "-").padStart(3)}  ${secs}s  ${j.ok?"ok":"FAILED "+(j.failures?.[0]||j.error||"")}`);
  totals.found += j.found||0; totals.pushed += j.pushed||0; totals.blocked += j.blocked||0; totals.days++;
  if (!j.ok) { console.log(`\nSTOPPED at ${day}. Fix, then re-run with --from ${day}`); break; }
  day = j.nextDay;
  if (DRY) { console.log("\n(dry run - stopping after one day)"); break; }
  // Only wait when something was actually sent. A weekend or holiday finds no
  // presence rows, makes no Bulk Import request, and so consumes none of the
  // 10-per-5-minute lock there is nothing to wait for.
  if (day <= TO && (j.pushed || 0) > 0) await new Promise(r=>setTimeout(r, WAIT_MS));
}
console.log(`\ndays=${totals.days} found=${totals.found} pushed=${totals.pushed} blocked=${totals.blocked}`);
