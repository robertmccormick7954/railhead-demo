/* Railhead — search + time correctness harness (node, no browser).
   Run: node tools/qa_search.mjs
   Uses the LIVE Amtrak train feed as a positive control for the timezone chain:
   if our Eastern-minutes -> instant -> station-local conversion is right, our
   printed clock times must equal the live feed's own local wall-clock values. */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, '..', 'docs');

// Minimal fetch shim so the browser modules load unmodified under node.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('file:')) {
    const p = fileURLToPath(u);
    return { ok: true, status: 200, url: u, json: async () => JSON.parse(readFileSync(p, 'utf8')) };
  }
  return realFetch(url);
};

const D = await import(pathToFileURL(path.join(SITE, 'assets/js/data.js')).href);
const S = await import(pathToFileURL(path.join(SITE, 'assets/js/search.js')).href);

let pass = 0, fail = 0;
const ok = (cond, msg, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${msg}`); }
  else { fail++; console.log(`  FAIL  ${msg}${detail ? '\n        ' + detail : ''}`); }
};
const head = (t) => console.log(`\n=== ${t} ===`);

await D.load();
console.log(`loaded: ${D.Net.stations.length} stations, ${D.Net.routes.length} routes, ${D.Net.trips.length} trips`);

/* -------------------------------------------------------------------------
   1. TIMEZONE CHAIN vs the live feed (positive control)
   ------------------------------------------------------------------------- */
head('Timezone chain vs live Amtrak feed');
let live = null;
try {
  live = JSON.parse(readFileSync(path.join(HERE, '..', 'research', 'trains_raw.json'), 'utf8'));
} catch { console.log('  (live feed snapshot not present — skipping)'); }

if (live) {
  let checked = 0, matched = 0, mismatches = [];
  for (const [, v] of Object.entries(live)) {
    for (const t of (Array.isArray(v) ? v : [v])) {
      if (t.provider !== 'Amtrak' || !t.stations?.length) continue;
      // find our trip with the same train number that visits the same first stop
      const num = String(t.trainNum);
      const cands = D.Net.trips.filter((x) => x.num === num);
      if (!cands.length) continue;
      for (const st of t.stations) {
        if (!st.schDep) continue;
        const stn = D.station(st.code);
        if (!stn) continue;
        const liveLocal = st.schDep.slice(11, 16); // "HH:MM" local at that stop
        // our value: find this stop on a candidate trip, on the service day that
        // puts it on the same local calendar date as the live feed says
        const liveYmd = Number(st.schDep.slice(0, 10).replace(/-/g, ''));
        let ours = null;
        for (const trip of cands) {
          const pos = trip.stops.findIndex((s) => s.s === stn.i);
          if (pos < 0) continue;
          for (let k = 0; k <= 5; k++) {
            const svc = D.ymdOf(D.addDays(D.dateFromYmd(liveYmd), -k));
            if (!D.serviceRunsOn(trip.svc, svc, D.dowMon0(D.dateFromYmd(svc)))) continue;
            const inst = D.feedInstant(svc, trip.stops[pos].dep);
            if (D.localYmd(inst, stn.tz) !== liveYmd) continue;
            ours = D.localClock(inst, stn.tz, false);
            break;
          }
          if (ours) break;
        }
        if (!ours) continue;
        checked++;
        if (ours === liveLocal) matched++;
        else if (mismatches.length < 8) mismatches.push(`${num} ${st.code}: ours ${ours} vs live ${liveLocal}`);
      }
    }
  }
  ok(checked > 100, `cross-checked enough stop times (${checked})`);
  ok(matched === checked,
     `${matched}/${checked} station-local departure times match the live feed exactly`,
     mismatches.join('\n        '));
}

/* -------------------------------------------------------------------------
   2. DIRECT SEARCHES on real city pairs
   ------------------------------------------------------------------------- */
head('Direct journeys');
const today = new Date();
const testYmd = D.ymdOf(D.addDays(today, 14));
console.log(`  search date: ${testYmd}`);

function run(from, to, opts = {}) {
  const t0 = Date.now();
  const r = S.findJourneys({ from, to, ymd: testYmd, ...opts });
  return { ...r, ms: Date.now() - t0 };
}

const cases = [
  { from: 'NYP', to: 'WAS', minCount: 15, durMin: 150, durMax: 260, label: 'New York - Washington' },
  { from: 'NYP', to: 'BOS', minCount: 8, durMin: 195, durMax: 320, label: 'New York - Boston' },
  { from: 'LAX', to: 'SAN', minCount: 5, durMin: 140, durMax: 210, label: 'Los Angeles - San Diego' },
  { from: 'SEA', to: 'PDX', minCount: 3, durMin: 180, durMax: 300, label: 'Seattle - Portland' },
  { from: 'CHI', to: 'STL', minCount: 3, durMin: 280, durMax: 400, label: 'Chicago - St Louis' },
  { from: 'WAS', to: 'NYP', minCount: 15, durMin: 150, durMax: 260, label: 'Washington - New York' },
];
for (const c of cases) {
  const r = run(c.from, c.to);
  const direct = r.journeys.filter((j) => j.transfers === 0);
  const durs = direct.map((j) => j.durationMin);
  const med = durs.sort((a, b) => a - b)[Math.floor(durs.length / 2)];
  ok(direct.length >= c.minCount,
     `${c.label}: ${direct.length} direct (>= ${c.minCount}), ${r.journeys.length} total, ${r.ms}ms`);
  ok(med >= c.durMin && med <= c.durMax,
     `${c.label}: median direct duration ${Math.floor(med / 60)}h${String(med % 60).padStart(2, '0')} within [${c.durMin},${c.durMax}]min`);
}

/* -------------------------------------------------------------------------
   3. LONG DISTANCE and CONNECTIONS
   ------------------------------------------------------------------------- */
head('Long distance and connecting');
const chiNyp = run('CHI', 'NYP');
const chiDirect = chiNyp.journeys.filter((j) => j.transfers === 0);
ok(chiDirect.length >= 1, `Chicago - New York has a direct train (${chiDirect.length})`);
if (chiDirect.length) {
  const d = chiDirect[0];
  ok(d.durationMin > 17 * 60 && d.durationMin < 30 * 60,
     `Chicago - New York direct takes ${Math.floor(d.durationMin / 60)}h${String(d.durationMin % 60).padStart(2, '0')} (17-30h)`);
  ok(d.miles > 850 && d.miles < 1250, `Chicago - New York direct is ${d.miles} miles (850-1250)`);
}

const nypLax = run('NYP', 'LAX', { maxTransfers: 2 });
ok(nypLax.journeys.length > 0, `New York - Los Angeles returns ${nypLax.journeys.length} itineraries (${nypLax.ms}ms)`);
if (nypLax.journeys.length) {
  const best = nypLax.journeys.reduce((m, j) => (j.durationMin < m.durationMin ? j : m));
  const days = best.durationMin / 60 / 24;
  ok(best.transfers >= 1, `New York - Los Angeles requires a change (${best.transfers})`);
  ok(days > 2.2 && days < 5, `New York - Los Angeles fastest is ${days.toFixed(1)} days (2.2-5)`);
  const via = best.changes.map((c) => D.Net.stations[c.stn].c).join(' + ');
  console.log(`        fastest: ${best.legs.map((l) => D.serviceLabel(l.trip)).join(' -> ')}  via ${via}`);
  ok(best.changes.every((c) => c.waitMin >= 45), `every connection respects the minimum (${best.changes.map((c) => c.waitMin + 'm').join(', ')})`);
}

/* -------------------------------------------------------------------------
   4. TRANSCONTINENTAL LOCAL-TIME SANITY
   ------------------------------------------------------------------------- */
head('Transcontinental local time');
// The Sunset Limited is tri-weekly, so scan forward for a day it actually runs
// rather than asserting against a fixed date.
let sl = null, slYmd = null;
for (let k = 10; k < 30 && !sl; k++) {
  const ymd = D.ymdOf(D.addDays(today, k));
  const r = S.findJourneys({ from: 'NOL', to: 'LAX', ymd });
  sl = r.journeys.find((j) => j.transfers === 0);
  if (sl) slYmd = ymd;
}
ok(slYmd != null, `found a Sunset Limited departure within 30 days (${slYmd})`);
if (sl) {
  const o = D.station('NOL'), dd = D.station('LAX');
  const depLocal = D.localClock(sl.depInstant, o.tz, false);
  const arrLocal = D.localClock(sl.arrInstant, dd.tz, false);
  const dayDiff = D.dayOffset(D.localYmd(sl.depInstant, o.tz), D.localYmd(sl.arrInstant, dd.tz));
  console.log(`        Sunset Limited: NOL ${depLocal} ${D.zoneAbbr(sl.depInstant, o.tz)}  ->  LAX ${arrLocal} ${D.zoneAbbr(sl.arrInstant, dd.tz)} (+${dayDiff}d)`);
  console.log(`        elapsed ${Math.floor(sl.durationMin / 60)}h${String(sl.durationMin % 60).padStart(2, '0')}, ${sl.miles} miles`);
  ok(dayDiff === 2, `arrives two calendar days later (+${dayDiff})`);
  ok(sl.durationMin > 44 * 60 && sl.durationMin < 50 * 60, `elapsed ${(sl.durationMin / 60).toFixed(1)}h is in 44-50h`);
  ok(sl.miles > 1850 && sl.miles < 2150, `${sl.miles} miles vs published 1,995`);
} else {
  ok(false, "Sunset Limited NOL->LAX direct not found on any scanned date");
}

/* -------------------------------------------------------------------------
   5. EDGE CASES
   ------------------------------------------------------------------------- */
head('Edge cases');
ok(S.findJourneys({ from: 'NYP', to: 'NYP', ymd: testYmd }).error === 'same-station', 'same origin and destination is rejected');
ok(S.findJourneys({ from: 'ZZZ', to: 'NYP', ymd: testYmd }).error === 'unknown-station', 'unknown station code is rejected');

const far = S.findJourneys({ from: 'NYP', to: 'WAS', ymd: 20270720 });
ok(far.journeys.length > 0, `a date 11 months out still returns results (${far.journeys.length})`);
const past = S.findJourneys({ from: 'NYP', to: 'WAS', ymd: 20250101 });
ok(past.journeys.length === 0, 'a date outside the published calendar returns nothing');

const board = S.nextDepartures(D.station('CHI').i, Date.now(), 8);
ok(board.length === 8, `departure board fills 8 rows from Chicago (${board.length})`);
const dupes = board.length - new Set(board.map((b) => b.trip.num)).size;
ok(dupes === 0, `board has no duplicate train numbers (${dupes} dupes)`);

head('Performance');
const t0 = Date.now();
for (let i = 0; i < 10; i++) S.findJourneys({ from: 'NYP', to: 'WAS', ymd: testYmd });
const per = (Date.now() - t0) / 10;
ok(per < 250, `NYP-WAS search averages ${per.toFixed(0)}ms (< 250ms)`);
const t1 = Date.now();
S.findJourneys({ from: 'NYP', to: 'LAX', ymd: testYmd, maxTransfers: 2 });
const cross = Date.now() - t1;
ok(cross < 4000, `NYP-LAX two-change search takes ${cross}ms (< 4000ms)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
