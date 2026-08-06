/* ==========================================================================
   Railhead — network data layer
   --------------------------------------------------------------------------
   Loads the compiled schedule (built by tools/build_data.py from Amtrak's
   published GTFS feed), decodes it, and exposes the indices the journey search
   and the departure board run on.

   TIME MODEL — read this before touching anything that formats a clock time.

   Amtrak's GTFS writes every stop time in a SINGLE timezone: America/New_York.
   It does not write local time at each station. Verified against the live
   train feed, which carries explicit UTC offsets per stop: at Central stops the
   GTFS value runs 60 minutes ahead of local, at Mountain stops 120, at Pacific
   stops 180 — exactly the offset from Eastern. New Orleans 09:00 CDT appears as
   10:00; Los Angeles 05:35 PDT appears as 56:35 (08:35 Eastern, two days on).

   So:
     * elapsed time  = a plain subtraction of GTFS minutes. Already correct,
                       because both ends are in the same zone.
     * displayed time = MUST be converted to the station's own timezone, or
                       every West Coast time is three hours wrong.

   Conversion follows the GTFS service-day convention (noon minus twelve hours),
   which is what keeps the two days a year with a DST transition correct.
   tools/qa_time.py re-checks the whole chain against the live feed.
   ========================================================================== */

const FEED_TZ = 'America/New_York';
const DATA_BASE = new URL('../../data/', import.meta.url);

export const Net = {
  loaded: false,
  stations: [],
  routes: [],
  services: [],
  trips: [],
  meta: null,
  byCode: new Map(),
  /** station index -> [{ trip, pos }] every trip calling there */
  callsAt: [],
};

/* --------------------------------------------------------------------------
   Loading
   -------------------------------------------------------------------------- */
let loadPromise = null;

export function load() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [stations, network, meta] = await Promise.all([
      fetch(new URL('stations.json', DATA_BASE)).then(assertOk),
      fetch(new URL('network.json', DATA_BASE)).then(assertOk),
      fetch(new URL('meta.json', DATA_BASE)).then(assertOk),
    ]);

    Net.stations = stations;
    Net.routes = network.routes;
    Net.services = network.services;
    Net.meta = meta;

    stations.forEach((s, i) => {
      s.i = i;
      s.search = norm(`${s.n} ${s.y} ${s.s} ${s.c}`);
      Net.byCode.set(s.c, s);
    });

    Net.callsAt = stations.map(() => []);

    Net.trips = network.trips.map((t, ti) => {
      const seq = t[5];
      const n = seq.length / 4;
      const stops = new Array(n);
      let prevDep = 0;
      let miles = 0;
      for (let i = 0; i < n; i++) {
        const si = seq[i * 4];
        const arr = i === 0 ? seq[1] : prevDep + seq[i * 4 + 1];
        const dep = arr + seq[i * 4 + 2];
        miles += seq[i * 4 + 3];
        prevDep = dep;
        stops[i] = { s: si, arr, dep, mi: miles };
      }
      const trip = {
        i: ti,
        route: Net.routes[t[0]],
        routeIdx: t[0],
        svc: t[1],
        num: t[2],
        dir: t[3],
        headsign: t[4],
        stops,
      };
      for (let i = 0; i < n; i++) Net.callsAt[stops[i].s].push({ trip, pos: i });
      return trip;
    });

    // Departure order makes the board and the search both cheap.
    for (const list of Net.callsAt) list.sort((a, b) => a.trip.stops[a.pos].dep - b.trip.stops[b.pos].dep);

    Net.loaded = true;
    return Net;
  })();
  return loadPromise;
}

async function assertOk(res) {
  if (!res.ok) throw new Error(`Could not load network data (${res.status} ${res.url})`);
  return res.json();
}

/* --------------------------------------------------------------------------
   Service calendar
   -------------------------------------------------------------------------- */

/** services[] = [dowBits, startYYYYMMDD, endYYYYMMDD]; bit 0 = Monday. */
export function serviceRunsOn(svcIdx, ymd, dowMon0) {
  const s = Net.services[svcIdx];
  if (!s) return false;
  if (ymd < s[1] || ymd > s[2]) return false;
  return (s[0] & (1 << dowMon0)) !== 0;
}

export function ymdOf(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function dateFromYmd(ymd) {
  return new Date(Math.floor(ymd / 10000), (Math.floor(ymd / 100) % 100) - 1, ymd % 100);
}

/** Monday = 0, to match the calendar bit order. */
export function dowMon0(date) {
  return (date.getDay() + 6) % 7;
}

export function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

/* --------------------------------------------------------------------------
   Time: feed minutes -> real instant -> station-local clock
   -------------------------------------------------------------------------- */

const offsetCache = new Map();

/** Offset in ms that must be ADDED to a UTC instant to read local wall clock. */
function zoneOffsetMs(utcMs, tz) {
  const key = tz + '|' + Math.floor(utcMs / 3600000);
  const hit = offsetCache.get(key);
  if (hit !== undefined) return hit;
  const dtf = getFormatter(tz);
  const p = Object.create(null);
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  const off = asUtc - utcMs;
  offsetCache.set(key, off);
  return off;
}

const formatterCache = new Map();
function getFormatter(tz) {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

/** The UTC instant of a given wall-clock time in a given zone. */
function wallClockToUtc(y, m, d, hh, mm, tz) {
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  let utc = naive - zoneOffsetMs(naive, tz);
  // One correction pass settles every case except the skipped hour of a spring
  // DST transition, where the second pass converges on the post-jump instant.
  utc = naive - zoneOffsetMs(utc, tz);
  return utc;
}

/**
 * Absolute instant for a feed time.
 * @param {number} ymd    service date, as it appears in the feed calendar
 * @param {number} minutes feed minutes from the start of the service day (may exceed 1440)
 */
export function feedInstant(ymd, minutes) {
  const y = Math.floor(ymd / 10000);
  const m = Math.floor(ymd / 100) % 100;
  const d = ymd % 100;
  // GTFS service day = noon minus twelve hours, which is what keeps the DST
  // transition days honest. Midnight would drift by an hour twice a year.
  const noon = wallClockToUtc(y, m, d, 12, 0, FEED_TZ);
  return noon - 12 * 3600000 + minutes * 60000;
}

/**
 * Station-local wall clock for an instant, as plain numbers.
 * Deliberately arithmetic rather than Intl.format: the connection search calls
 * this tens of thousands of times per query, and only the zone OFFSET needs
 * Intl (and that is cached per zone per hour).
 */
export function localParts(instantMs, tz) {
  const local = instantMs + zoneOffsetMs(instantMs, tz);
  const d = new Date(local);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

/** Station-local calendar date for an instant, as YYYYMMDD. */
export function localYmd(instantMs, tz) {
  const p = localParts(instantMs, tz);
  return p.y * 10000 + p.mo * 100 + p.d;
}

/** Minutes past station-local midnight. */
export function localMinutes(instantMs, tz) {
  const p = localParts(instantMs, tz);
  return p.h * 60 + p.mi;
}

/**
 * Station-local clock time. `hour12` is a tenant setting, not a constant: the
 * US storefronts run 12-hour, the European one runs 24-hour.
 */
export function localClock(instantMs, tz, hour12 = true) {
  const p = localParts(instantMs, tz);
  return formatHM(p.h, p.mi, hour12);
}

export function formatHM(h, mi, hour12 = true) {
  const mm = String(mi).padStart(2, '0');
  if (!hour12) return `${String(h).padStart(2, '0')}:${mm}`;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

const zoneAbbrCache = new Map();
/** Short zone label for an instant, e.g. "EDT", "PST". */
export function zoneAbbr(instantMs, tz) {
  const key = tz + '|' + Math.floor(instantMs / 86400000);
  let v = zoneAbbrCache.get(key);
  if (v === undefined) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' });
    const part = f.formatToParts(new Date(instantMs)).find((p) => p.type === 'timeZoneName');
    v = part ? part.value : '';
    zoneAbbrCache.set(key, v);
  }
  return v;
}

/** Whole days between two station-local dates, for the "+1" day marker. */
export function dayOffset(fromYmd, toYmd) {
  const a = dateFromYmd(fromYmd);
  const b = dateFromYmd(toYmd);
  return Math.round((b - a) / 86400000);
}

/* --------------------------------------------------------------------------
   Station lookup
   -------------------------------------------------------------------------- */

export function norm(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function station(codeOrIdx) {
  if (typeof codeOrIdx === 'number') return Net.stations[codeOrIdx];
  return Net.byCode.get(String(codeOrIdx || '').toUpperCase()) || null;
}

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia',
};

export function stateName(abbr) {
  return US_STATES[abbr] || abbr || '';
}

/**
 * Rank stations for the origin/destination picker.
 * Exact code first, then name/city starts, then word starts, then anything
 * containing the query; ties broken by how many trains actually call there.
 */
export function searchStations(query, limit = 8) {
  const q = norm(query);
  if (!q) {
    return Net.stations.slice().sort((a, b) => b.w - a.w).slice(0, limit);
  }
  const out = [];
  for (const s of Net.stations) {
    let score = 0;
    if (s.c.toLowerCase() === q) score = 1000;
    else if (norm(s.n) === q || norm(s.y) === q) score = 900;
    else if (norm(s.n).startsWith(q) || norm(s.y).startsWith(q)) score = 700;
    else if (s.c.toLowerCase().startsWith(q)) score = 650;
    else if (wordStarts(s.search, q)) score = 500;
    else if (s.search.includes(q)) score = 250;
    else if (norm(stateName(s.s)).startsWith(q)) score = 120;
    if (score) out.push({ s, score: score + Math.min(s.w, 400) / 1000 });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((o) => o.s);
}

function wordStarts(haystack, q) {
  let i = haystack.indexOf(q);
  while (i !== -1) {
    if (i === 0 || haystack[i - 1] === ' ') return true;
    i = haystack.indexOf(q, i + 1);
  }
  return false;
}

/* --------------------------------------------------------------------------
   Convenience
   -------------------------------------------------------------------------- */

export function routeOf(trip) { return trip.route; }

export function isBus(trip) { return trip.route.mode === 'bus'; }

/** Human label for a service, e.g. "Acela 2167" or "Thruway Bus 4881". */
export function serviceLabel(trip) {
  const n = trip.route.n;
  const num = trip.num ? ` ${trip.num}` : '';
  if (trip.route.mode === 'bus') return `Thruway Connecting Service${num}`;
  return `${n}${num}`;
}

export function stopsBetween(trip, fromPos, toPos) {
  return trip.stops.slice(fromPos, toPos + 1);
}

export function milesBetween(trip, fromPos, toPos) {
  return trip.stops[toPos].mi - trip.stops[fromPos].mi;
}
