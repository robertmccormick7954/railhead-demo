/* ==========================================================================
   Railhead — journey search
   --------------------------------------------------------------------------
   Finds direct and connecting journeys over the compiled schedule.

   Shape of the problem: feed times are Eastern minutes counted from a service
   day that may start up to four days before the train reaches a given station
   (the Sunset Limited runs 56 hours past its service-day origin). So a
   departure "on 12 August at Los Angeles" can belong to the service day of the
   9th. Every lookup therefore tests several candidate service days and keeps
   the ones whose STATION-LOCAL date matches what the passenger asked for.

   Connection policy is ours, not the carrier's. A reseller sets its own
   minimum connection times, and ours are deliberately conservative: a missed
   connection onto a long-distance train can cost a day.
   ========================================================================== */

import {
  Net, station, serviceRunsOn, feedInstant, localYmd, localMinutes,
  ymdOf, dateFromYmd, addDays, dowMon0,
} from './data.js';

/** Minimum connection times, in minutes. Published on the help page. */
export const CONNECT = {
  standard: 45,
  hub: 60,
  longDistance: 90,
  tightUnder: 50,
  maxWait: 8 * 60,
  maxWaitIfOnlyOption: 15 * 60,
};

const SERVICE_DAY_LOOKBACK = 5; // feed has trips running to 80h past their origin

let hubSet = null;
/** The busiest stations by number of calls — used to bound the two-change search. */
function hubs() {
  if (hubSet) return hubSet;
  const idx = Net.stations.map((s, i) => [i, s.w]).sort((a, b) => b[1] - a[1]).slice(0, 45);
  hubSet = new Set(idx.map((x) => x[0]));
  return hubSet;
}

function shiftYmd(ymd, days) {
  return ymdOf(addDays(dateFromYmd(ymd), days));
}

/* --------------------------------------------------------------------------
   Departures
   -------------------------------------------------------------------------- */

/**
 * Every departure from a station whose station-local calendar date is `ymd`.
 * @returns {Array<{trip, pos, instant, svcYmd}>} sorted by instant
 */
export function departuresOn(stnIdx, ymd) {
  const tz = Net.stations[stnIdx].tz;
  const out = [];
  const calls = Net.callsAt[stnIdx];
  const svcDays = [];
  for (let k = 0; k <= SERVICE_DAY_LOOKBACK; k++) {
    const d = shiftYmd(ymd, -k);
    svcDays.push({ ymd: d, dow: dowMon0(dateFromYmd(d)) });
  }
  for (const call of calls) {
    const stop = call.trip.stops[call.pos];
    if (call.pos === call.trip.stops.length - 1) continue; // terminus: no departure
    for (const day of svcDays) {
      if (!serviceRunsOn(call.trip.svc, day.ymd, day.dow)) continue;
      const instant = feedInstant(day.ymd, stop.dep);
      if (localYmd(instant, tz) !== ymd) continue;
      out.push({ trip: call.trip, pos: call.pos, instant, svcYmd: day.ymd });
    }
  }
  out.sort((a, b) => a.instant - b.instant);
  return out;
}

/**
 * Departures from a station falling inside an absolute instant window.
 * Used for connections and for the live departure board.
 */
export function departuresBetween(stnIdx, fromInstant, toInstant) {
  const tz = Net.stations[stnIdx].tz;
  const out = [];
  const startYmd = shiftYmd(localYmd(fromInstant, tz), -SERVICE_DAY_LOOKBACK);
  const days = [];
  const span = Math.ceil((toInstant - fromInstant) / 86400000) + SERVICE_DAY_LOOKBACK + 1;
  for (let k = 0; k < span; k++) {
    const d = shiftYmd(startYmd, k);
    days.push({ ymd: d, dow: dowMon0(dateFromYmd(d)) });
  }
  for (const call of Net.callsAt[stnIdx]) {
    if (call.pos === call.trip.stops.length - 1) continue;
    const stop = call.trip.stops[call.pos];
    for (const day of days) {
      if (!serviceRunsOn(call.trip.svc, day.ymd, day.dow)) continue;
      const instant = feedInstant(day.ymd, stop.dep);
      if (instant < fromInstant || instant > toInstant) continue;
      out.push({ trip: call.trip, pos: call.pos, instant, svcYmd: day.ymd });
    }
  }
  out.sort((a, b) => a.instant - b.instant);
  return out;
}

/** Next `count` departures from a station after `fromInstant`. Feeds the board. */
export function nextDepartures(stnIdx, fromInstant, count = 8) {
  let window = 6 * 3600000;
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = departuresBetween(stnIdx, fromInstant, fromInstant + window);
    if (found.length >= count || attempt === 3) return dedupeByTrainNumber(found).slice(0, count);
    window *= 4;
  }
  return [];
}

/* The feed carries several calendar variants of the same numbered train (one
   per day-of-week pattern). A board that listed all of them would show the same
   train three times, a minute apart. */
function dedupeByTrainNumber(list) {
  const seen = new Set();
  const out = [];
  for (const d of list) {
    const key = `${d.trip.num}|${d.trip.routeIdx}|${Math.round(d.instant / 60000)}`;
    const loose = `${d.trip.num}|${d.trip.routeIdx}|${localYmd(d.instant, Net.stations[d.trip.stops[d.pos].s].tz)}`;
    if (seen.has(key) || seen.has(loose)) continue;
    seen.add(key);
    seen.add(loose);
    out.push(d);
  }
  return out;
}

/* --------------------------------------------------------------------------
   Journey search
   -------------------------------------------------------------------------- */

function mctFor(stnIdx, tripA, tripB) {
  let m = hubs().has(stnIdx) ? CONNECT.hub : CONNECT.standard;
  const long = (t) => t.route.cat === 'long' || t.route.cat === 'autotrain';
  if (long(tripA) || long(tripB)) m = Math.max(m, CONNECT.longDistance);
  return m;
}

function makeLeg(dep, toPos) {
  const trip = dep.trip;
  const arrStop = trip.stops[toPos];
  return {
    trip,
    fromPos: dep.pos,
    toPos,
    svcYmd: dep.svcYmd,
    depInstant: dep.instant,
    arrInstant: feedInstant(dep.svcYmd, arrStop.arr),
    fromStn: trip.stops[dep.pos].s,
    toStn: arrStop.s,
    miles: arrStop.mi - trip.stops[dep.pos].mi,
  };
}

function assemble(legs) {
  const changes = [];
  for (let i = 1; i < legs.length; i++) {
    const wait = Math.round((legs[i].depInstant - legs[i - 1].arrInstant) / 60000);
    changes.push({
      stn: legs[i - 1].toStn,
      arriveInstant: legs[i - 1].arrInstant,
      departInstant: legs[i].depInstant,
      waitMin: wait,
      tight: wait < CONNECT.tightUnder,
    });
  }
  const depInstant = legs[0].depInstant;
  const arrInstant = legs[legs.length - 1].arrInstant;
  return {
    key: legs.map((l) => `${l.trip.i}:${l.fromPos}>${l.toPos}@${l.depInstant}`).join('|'),
    legs,
    changes,
    depInstant,
    arrInstant,
    durationMin: Math.round((arrInstant - depInstant) / 60000),
    transfers: legs.length - 1,
    miles: legs.reduce((n, l) => n + l.miles, 0),
    modes: [...new Set(legs.map((l) => l.trip.route.mode))],
  };
}

/** Stations from which some trip continues to `destIdx`, with the trips. */
function inboundIndex(destIdx) {
  const map = new Map();
  for (const call of Net.callsAt[destIdx]) {
    if (call.pos === 0) continue; // origin of the trip: nothing arrives here on it
    const stops = call.trip.stops;
    for (let p = 0; p < call.pos; p++) {
      const from = stops[p].s;
      let arr = map.get(from);
      if (!arr) map.set(from, (arr = []));
      arr.push({ trip: call.trip, pos: p, destPos: call.pos });
    }
  }
  return map;
}

/**
 * @param {object} q
 * @param {string} q.from  station code
 * @param {string} q.to    station code
 * @param {number} q.ymd   departure date, station-local at the origin
 * @param {number} [q.maxTransfers]
 * @param {number} [q.limit]
 * @param {number} [q.afterMinutes] earliest local departure minute
 */
export function findJourneys(q) {
  const origin = station(q.from);
  const dest = station(q.to);
  if (!origin || !dest) return { journeys: [], error: 'unknown-station' };
  if (origin.i === dest.i) return { journeys: [], error: 'same-station' };

  const maxTransfers = q.maxTransfers ?? 2;
  const limit = q.limit ?? 60;
  const results = new Map();

  const firstLegs = departuresOn(origin.i, q.ymd).filter(
    (d) => q.afterMinutes == null || localMinutes(d.instant, origin.tz) >= q.afterMinutes
  );

  // ---- direct ------------------------------------------------------------
  for (const dep of firstLegs) {
    const stops = dep.trip.stops;
    for (let p = dep.pos + 1; p < stops.length; p++) {
      if (stops[p].s === dest.i) {
        const j = assemble([makeLeg(dep, p)]);
        if (!results.has(j.key)) results.set(j.key, j);
        break;
      }
    }
  }

  if (maxTransfers >= 1) {
    const inbound = inboundIndex(dest.i);

    // ---- one change -----------------------------------------------------
    // Only stations that can actually reach the destination are worth a query.
    const reached = new Map(); // stnIdx -> [{leg}] best few arrivals
    for (const dep of firstLegs) {
      const stops = dep.trip.stops;
      for (let p = dep.pos + 1; p < stops.length; p++) {
        const s = stops[p].s;
        if (s === dest.i) break; // direct already covered; no point changing here
        if (!inbound.has(s)) continue;
        let list = reached.get(s);
        if (!list) reached.set(s, (list = []));
        if (list.length < 6) list.push(makeLeg(dep, p));
      }
    }

    for (const [stnIdx, legsIn] of reached) {
      const candidates = inbound.get(stnIdx);
      for (const leg1 of legsIn) {
        const minGap = mctFor(stnIdx, leg1.trip, leg1.trip) * 60000;
        const from = leg1.arrInstant + minGap;
        const to = leg1.arrInstant + CONNECT.maxWaitIfOnlyOption * 60000;
        for (const cand of candidates) {
          if (cand.trip === leg1.trip) continue;
          const gap = mctFor(stnIdx, leg1.trip, cand.trip) * 60000;
          for (const dep2 of departuresOfTripAt(cand.trip, cand.pos, from, to)) {
            if (dep2.instant - leg1.arrInstant < gap) continue;
            const j = assemble([leg1, makeLeg(dep2, cand.destPos)]);
            if (!results.has(j.key)) results.set(j.key, j);
          }
        }
      }
    }

    // ---- two changes, middle change restricted to a hub -------------------
    if (maxTransfers >= 2 && results.size < 8) {
      for (const [midIdx, legsIn] of reached) {
        if (!hubs().has(midIdx)) continue;
        for (const leg1 of legsIn.slice(0, 2)) {
          const from = leg1.arrInstant + CONNECT.standard * 60000;
          const to = leg1.arrInstant + CONNECT.maxWait * 60000;
          for (const dep2 of departuresBetween(midIdx, from, to)) {
            if (dep2.trip === leg1.trip) continue;
            const gap = mctFor(midIdx, leg1.trip, dep2.trip) * 60000;
            if (dep2.instant - leg1.arrInstant < gap) continue;
            const stops2 = dep2.trip.stops;
            for (let p = dep2.pos + 1; p < stops2.length; p++) {
              const s2 = stops2[p].s;
              if (s2 === dest.i) break;
              const candidates = inbound.get(s2);
              if (!candidates) continue;
              const leg2 = makeLeg(dep2, p);
              for (const cand of candidates) {
                if (cand.trip === dep2.trip || cand.trip === leg1.trip) continue;
                const gap2 = mctFor(s2, leg2.trip, cand.trip) * 60000;
                for (const dep3 of departuresOfTripAt(
                  cand.trip, cand.pos, leg2.arrInstant + gap2, leg2.arrInstant + CONNECT.maxWait * 60000
                )) {
                  const j = assemble([leg1, leg2, makeLeg(dep3, cand.destPos)]);
                  if (!results.has(j.key)) results.set(j.key, j);
                  if (results.size > 120) break;
                }
                if (results.size > 120) break;
              }
              if (results.size > 120) break;
            }
            if (results.size > 120) break;
          }
        }
        if (results.size > 120) break;
      }
    }
  }

  let journeys = [...results.values()];
  journeys = dropDominated(journeys);
  journeys.sort((a, b) => a.depInstant - b.depInstant || a.durationMin - b.durationMin);
  journeys = journeys.slice(0, limit);

  if (journeys.length) {
    const fastest = journeys.reduce((m, j) => (j.durationMin < m.durationMin ? j : m));
    fastest.isFastest = true;
    const fewest = journeys.reduce((m, j) => (j.transfers < m.transfers ? j : m));
    fewest.isDirectest = true;
  }

  return { journeys, origin, dest, ymd: q.ymd };
}

/** Instants at which a given trip departs a given stop inside a window. */
function departuresOfTripAt(trip, pos, fromInstant, toInstant) {
  const out = [];
  const stop = trip.stops[pos];
  const tz = Net.stations[stop.s].tz;
  const startYmd = shiftYmd(localYmd(fromInstant, tz), -SERVICE_DAY_LOOKBACK);
  const span = Math.ceil((toInstant - fromInstant) / 86400000) + SERVICE_DAY_LOOKBACK + 1;
  for (let k = 0; k < span; k++) {
    const d = shiftYmd(startYmd, k);
    if (!serviceRunsOn(trip.svc, d, dowMon0(dateFromYmd(d)))) continue;
    const instant = feedInstant(d, stop.dep);
    if (instant < fromInstant || instant > toInstant) continue;
    out.push({ trip, pos, instant, svcYmd: d });
  }
  return out;
}

/**
 * Remove journeys that leave no later and arrive no earlier than another with
 * fewer or equal changes. Without this the results are full of "same train, but
 * change twice on the way" itineraries that nobody would pick.
 */
function dropDominated(list) {
  const sorted = list.slice().sort((a, b) => a.depInstant - b.depInstant);
  const keep = [];
  for (const j of sorted) {
    let dominated = false;
    for (const k of keep) {
      if (k === j) continue;
      if (k.depInstant >= j.depInstant && k.arrInstant <= j.arrInstant && k.transfers <= j.transfers
          && (k.depInstant > j.depInstant || k.arrInstant < j.arrInstant || k.transfers < j.transfers)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) keep.push(j);
  }
  // second pass: later-departing journeys can dominate earlier ones too
  return keep.filter((j) => !keep.some((k) => k !== j
    && k.depInstant >= j.depInstant && k.arrInstant <= j.arrInstant && k.transfers <= j.transfers
    && (k.depInstant > j.depInstant || k.arrInstant < j.arrInstant || k.transfers < j.transfers)));
}

/* --------------------------------------------------------------------------
   Cheapest-date scan — the fare calendar amtrak.com does not offer
   -------------------------------------------------------------------------- */

/**
 * Runs a light search across a date range and returns the best price per day.
 * Direct trains only, and at most a handful per day: this drives a calendar,
 * not a results page, so breadth matters more than depth.
 */
export function priceCalendar(fromCode, toCode, startYmd, days, priceFn) {
  const out = [];
  for (let k = 0; k < days; k++) {
    const ymd = shiftYmd(startYmd, k);
    const { journeys } = findJourneys({ from: fromCode, to: toCode, ymd, maxTransfers: 1, limit: 12 });
    let best = null;
    for (const j of journeys) {
      const p = priceFn(j, ymd);
      if (p != null && (best == null || p < best)) best = p;
    }
    out.push({ ymd, price: best, count: journeys.length });
  }
  return out;
}
