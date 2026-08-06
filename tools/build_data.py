#!/usr/bin/env python3
"""
Railhead — network data build.

Reads the OFFICIAL Amtrak GTFS feed (content.amtrak.com/content/gtfs/GTFS.zip) plus public
station metadata, and emits the compact JSON the browser booking engine runs on.

Everything produced here is real published schedule data. Nothing about the *schedule* is
invented. Fares are NOT in GTFS and are generated separately by the fare engine, which is
clearly labelled as simulated throughout the site.

Outputs (into docs/data/):
  stations.json  station directory + autocomplete index
  network.json   routes, service calendar, trips with stop sequences
  meta.json      provenance: feed version, validity window, counts, build date

Distance: GTFS has no shape_dist_traveled on stop_times, so segment mileage is computed as
great-circle between consecutive stops multiplied by a track-sinuosity factor calibrated
against 15 published Amtrak city-pair mileages (median ratio 1.1136 -> SINUOSITY below).
"""

import csv
import json
import math
import os
import sys
import zipfile
import collections
import datetime
import argparse
import zoneinfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GTFS_DIR = os.path.join(ROOT, "research", "gtfs")
AMTRAKER_STATIONS = os.path.join(ROOT, "research", "stations_raw.json")
OUT_DIR = os.path.join(ROOT, "docs", "data")

EARTH_MI = 3958.7613
SINUOSITY = 1.1136  # calibrated; see module docstring and tools/calibrate_distance.py

# ---------------------------------------------------------------------------
# Route product matrix.
#
# GTFS carries no product/class information, so which classes of service a route sells is
# encoded here from Amtrak's published product information. `cat` drives search grouping and
# the fare model; `classes` drives what the fare engine may offer on that route.
#
#   coach     Coach / Value / Flexible / Saver buckets
#   business  Business class
#   first     First class (Acela only)
#   roomette  Viewliner or Superliner Roomette
#   bedroom   Bedroom (and Bedroom Suite where two connect)
#   family    Family Room (Superliner only)
#   access    Accessible Bedroom
#   vehicle   Auto Train vehicle carriage
#
# `res: False` = unreserved corridor service (no seat inventory, walk-up pricing).
# `seatmap` = whether the operator exposes assignable seats for that route.
# ---------------------------------------------------------------------------
# Business Class is NOT a Superliner-wide product. Among the western long-distance
# trains only the Texas Eagle and City of New Orleans sell it, so it is added per
# route rather than folded into the base Superliner set.
SUPERLINER = ["coach", "roomette", "bedroom", "family", "access"]
VIEWLINER = ["coach", "roomette", "bedroom", "access"]

ROUTE_PRODUCTS = {
    "Acela":                              dict(cat="highspeed", classes=["business", "first"], res=True,  seatmap=True,  sleeper=False),
    "Northeast Regional":                 dict(cat="nec",       classes=["coach", "business"], res=True,  seatmap=True,  sleeper=False),
    "Keystone Service":                   dict(cat="nec",       classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Amtrak Hartford Line":               dict(cat="nec",       classes=["coach"],             res=False, seatmap=False, sleeper=False),
    "Valley Flyer":                       dict(cat="nec",       classes=["coach"],             res=False, seatmap=False, sleeper=False),
    "Pennsylvanian":                      dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Empire Service":                     dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Adirondack":                         dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Maple Leaf":                         dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Ethan Allen Express":                dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Berkshire Flyer":                    dict(cat="corridor",  classes=["coach"],             res=True,  seatmap=False, sleeper=False),
    "Vermonter":                          dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Downeaster":                         dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Carolinian":                         dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Piedmont":                           dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Pacific Surfliner":                  dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Amtrak Cascades":                    dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Capitol Corridor":                   dict(cat="corridor",  classes=["coach", "business"], res=False, seatmap=False, sleeper=False),
    "San Joaquins":                       dict(cat="corridor",  classes=["coach", "business"], res=False, seatmap=False, sleeper=False),
    "Hiawatha Service":                   dict(cat="corridor",  classes=["coach", "business"], res=False, seatmap=False, sleeper=False),
    "Wolverine":                          dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Blue Water":                         dict(cat="corridor",  classes=["coach"],             res=True,  seatmap=False, sleeper=False),
    "Pere Marquette":                     dict(cat="corridor",  classes=["coach"],             res=True,  seatmap=False, sleeper=False),
    "Lincoln Service":                    dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Lincoln Service Missouri River Runner": dict(cat="corridor", classes=["coach", "business"], res=True, seatmap=False, sleeper=False),
    "Missouri River Runner":              dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Illini":                             dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Saluki":                             dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Illinois Zephyr":                    dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Carl Sandburg":                      dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Heartland Flyer":                    dict(cat="corridor",  classes=["coach"],             res=True,  seatmap=False, sleeper=False),
    "Borealis":                           dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    "Amtrak Mardi Gras Service":          dict(cat="corridor",  classes=["coach", "business"], res=True,  seatmap=False, sleeper=False),
    # Long distance
    "Empire Builder":                     dict(cat="long", classes=SUPERLINER, res=True, seatmap=False, sleeper=True),
    "California Zephyr":                  dict(cat="long", classes=SUPERLINER, res=True, seatmap=False, sleeper=True),
    "Southwest Chief":                    dict(cat="long", classes=SUPERLINER, res=True, seatmap=False, sleeper=True),
    "Coast Starlight":                    dict(cat="long", classes=SUPERLINER, res=True, seatmap=False, sleeper=True),
    "Sunset Limited":                     dict(cat="long", classes=SUPERLINER, res=True, seatmap=False, sleeper=True),
    "Texas Eagle":                        dict(cat="long", classes=SUPERLINER + ["business"], res=True, seatmap=False, sleeper=True),
    "City of New Orleans":                dict(cat="long", classes=SUPERLINER + ["business"], res=True, seatmap=False, sleeper=True),
    "Lake Shore Limited":                 dict(cat="long", classes=VIEWLINER + ["business"], res=True, seatmap=False, sleeper=True),
    "Crescent":                           dict(cat="long", classes=VIEWLINER, res=True, seatmap=False, sleeper=True),
    "Silver Meteor":                      dict(cat="long", classes=VIEWLINER, res=True, seatmap=False, sleeper=True),
    "Cardinal":                           dict(cat="long", classes=VIEWLINER, res=True, seatmap=False, sleeper=True),
    "Floridian":                          dict(cat="long", classes=VIEWLINER, res=True, seatmap=False, sleeper=True),
    "Palmetto":                           dict(cat="long", classes=["coach", "business"], res=True, seatmap=False, sleeper=False),
    "Auto Train":                         dict(cat="autotrain", classes=["coach", "roomette", "bedroom", "family", "access", "vehicle"], res=True, seatmap=False, sleeper=True),
}

DEFAULT_PRODUCT = dict(cat="corridor", classes=["coach"], res=True, seatmap=False, sleeper=False)
THRUWAY_PRODUCT = dict(cat="thruway", classes=["coach"], res=True, seatmap=False, sleeper=False)
PARTNER_PRODUCT = dict(cat="partner", classes=["coach"], res=False, seatmap=False, sleeper=False)


def read_csv(name):
    path = os.path.join(GTFS_DIR, name)
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def haversine_mi(lat1, lon1, lat2, lon2):
    la1, lo1, la2, lo2 = map(math.radians, (lat1, lon1, lat2, lon2))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * math.asin(math.sqrt(h)) * EARTH_MI


def hhmmss_to_min(t):
    """GTFS times may exceed 24h for trips spanning multiple service days (this feed goes to 80h)."""
    parts = t.strip().split(":")
    if len(parts) != 3:
        raise ValueError("bad time %r" % t)
    return int(parts[0]) * 60 + int(parts[1]) + (1 if int(parts[2]) >= 30 else 0)


def reconcile_timezones(codes, gtfs_stops, extra, live_path):
    """
    Decide each station's IANA timezone on evidence rather than on trust.

    Three sources disagree. Amtrak's own GTFS sets stop_timezone; the public
    station dataset sets tz; and the live train feed states a real UTC offset
    for every scheduled call. Where GTFS and the station dataset differ, the
    live feed settles it.

    This is not hypothetical. Amtrak's GTFS places all seven Arizona stations
    in America/Denver. Arizona does not observe daylight saving, so from March
    to November that is an hour wrong, and the live feed agrees with the
    station dataset (America/Phoenix) against the GTFS. Left uncorrected, every
    Sunset Limited and Southwest Chief time through Arizona is an hour out.

    Returns (tz_by_code, corrections, unresolved).
    """
    observed = collections.defaultdict(set)
    if os.path.exists(live_path):
        with open(live_path, encoding="utf-8") as fh:
            live = json.load(fh)
        for value in live.values():
            for train in (value if isinstance(value, list) else [value]):
                for call in train.get("stations", []):
                    for field in ("schDep", "schArr"):
                        iso = call.get(field)
                        if not iso or len(iso) < 25:
                            continue
                        try:
                            observed[call["code"]].add(datetime.datetime.fromisoformat(iso))
                        except ValueError:
                            pass

    def offset_matches(tz_name, moments):
        try:
            zone = zoneinfo.ZoneInfo(tz_name)
        except Exception:
            return False
        for moment in moments:
            utc = moment.astimezone(datetime.timezone.utc)
            if zone.utcoffset(utc.replace(tzinfo=None)) != moment.utcoffset():
                return False
        return True

    tz_by_code, corrections, unresolved = {}, [], []
    for code in codes:
        gtfs_tz = (gtfs_stops[code].get("stop_timezone") or "").strip()
        ds_tz = (extra.get(code, {}).get("tz") or "").strip()
        chosen = gtfs_tz or ds_tz or "America/New_York"
        moments = observed.get(code)

        if moments and gtfs_tz != ds_tz and ds_tz:
            gtfs_ok = offset_matches(gtfs_tz, moments) if gtfs_tz else False
            ds_ok = offset_matches(ds_tz, moments)
            if ds_ok and not gtfs_ok:
                chosen = ds_tz
                corrections.append((code, gtfs_tz, ds_tz, len(moments)))
            elif not ds_ok and not gtfs_ok:
                unresolved.append((code, gtfs_tz, ds_tz))
        elif not gtfs_tz and ds_tz:
            chosen = ds_tz
        tz_by_code[code] = chosen
    return tz_by_code, corrections, unresolved


def detect_clock_offsets(codes, by_trip, trips_raw, live_path, tz_by_code):
    """
    Find stations whose stop_times were authored in the wrong clock.

    The feed's documented and overwhelmingly dominant convention is that every
    stop time is Eastern. A handful of stops break it. Train 25 (Mardi Gras
    Service, Mobile -> New Orleans) carries its five Gulf Coast calls in LOCAL
    Central time and its New Orleans call in Eastern, inside the same trip.

    Detection avoids any circular dependency on the timezone we are trying to
    validate: for each live observation we convert the stated local wall clock
    to Eastern using the observation's OWN stated UTC offset, then compare with
    the GTFS value modulo the day. A station with a consistent whole-hour gap
    gets that gap added to its stop times, which normalises the whole feed onto
    one convention before anything else reads it.

    Returns (fix_minutes_by_code, evidence).
    """
    if not os.path.exists(live_path):
        return {}, []
    with open(live_path, encoding="utf-8") as fh:
        live = json.load(fh)

    eastern = zoneinfo.ZoneInfo("America/New_York")
    gtfs_by_num_stop = collections.defaultdict(list)
    for t in trips_raw:
        num = (t.get("trip_short_name") or "").strip()
        if not num:
            continue
        for st in by_trip.get(t["trip_id"], []):
            gtfs_by_num_stop[(num, st["stop_id"])].append(hhmmss_to_min(st["departure_time"]))

    deltas = collections.defaultdict(list)
    for value in live.values():
        for train in (value if isinstance(value, list) else [value]):
            if train.get("provider") != "Amtrak":
                continue
            num = str(train.get("trainNum"))
            for call in train.get("stations", []):
                iso = call.get("schDep") or call.get("schArr")
                if not iso or len(iso) < 25:
                    continue
                try:
                    moment = datetime.datetime.fromisoformat(iso)
                except ValueError:
                    continue
                candidates = gtfs_by_num_stop.get((num, call["code"]))
                if not candidates:
                    continue
                # what the Eastern clock reads at that same instant
                east_wall = moment.astimezone(eastern)
                expected = east_wall.hour * 60 + east_wall.minute
                # nearest GTFS variant, compared modulo the day
                best = min(candidates, key=lambda m: min(abs((m % 1440) - expected),
                                                         1440 - abs((m % 1440) - expected)))
                d = (best % 1440) - expected
                if d > 720:
                    d -= 1440
                elif d < -720:
                    d += 1440
                deltas[call["code"]].append(d)

    fixes, evidence = {}, []
    for code, ds in deltas.items():
        ds_sorted = sorted(ds)
        median = ds_sorted[len(ds_sorted) // 2]
        rounded = int(round(median / 60.0)) * 60
        if rounded == 0 or abs(median - rounded) > 12:
            continue  # no whole-hour deviation, or too noisy to call
        fixes[code] = -rounded
        evidence.append((code, -rounded, len(ds), tz_by_code.get(code, "")))
    return fixes, evidence


# GTFS stop_name is inconsistently title-cased, which turns initialisms into words:
# "Ny Moynihan Train Hall At Penn Station", "Bwi Thurgood Marshall Airport Station".
ACRONYMS = {
    "Ny": "New York", "Bwi": "BWI", "Jfk": "JFK", "Lax": "LAX", "Dc": "DC",
    "Us": "US", "Usa": "USA", "Nj": "NJ", "Ny.": "New York", "Sw": "SW", "Ne": "NE",
}


def fix_case(name):
    return " ".join(ACRONYMS.get(w, w) for w in name.split(" "))


def clean_station_name(raw):
    """'Aberdeen Amtrak Station' -> 'Aberdeen'. Keeps names that would be emptied."""
    n = raw.strip()
    for suffix in (
        " Amtrak Station", " Amtrak Bus Stop", " Amtrak Bus Station",
        " Bus Stop - Amtrak", " Rail Station", " Train Station",
    ):
        if n.endswith(suffix):
            n = n[: -len(suffix)]
            break
    n = n.strip().rstrip(",").strip()
    return fix_case(n or raw.strip())


def build():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT_DIR)
    args = ap.parse_args()

    if not os.path.isdir(GTFS_DIR):
        sys.exit("GTFS not found at %s — run tools/fetch_gtfs.sh first" % GTFS_DIR)

    agencies = {a["agency_id"]: a for a in read_csv("agency.txt")}
    routes_raw = read_csv("routes.txt")
    trips_raw = read_csv("trips.txt")
    stops_raw = read_csv("stops.txt")
    cal_raw = read_csv("calendar.txt")
    feed_info = read_csv("feed_info.txt")[0]
    stop_times = read_csv("stop_times.txt")

    # --- station metadata from the public station dataset (GTFS has no city/state/zip) ---
    extra = {}
    if os.path.exists(AMTRAKER_STATIONS):
        with open(AMTRAKER_STATIONS, encoding="utf-8") as fh:
            extra = json.load(fh)

    # --- group stop_times by trip ---
    by_trip = collections.defaultdict(list)
    for st in stop_times:
        by_trip[st["trip_id"]].append(st)
    for tid in by_trip:
        by_trip[tid].sort(key=lambda x: int(x["stop_sequence"]))

    # --- stations actually used by at least one trip ---
    used = set()
    for sts in by_trip.values():
        for st in sts:
            used.add(st["stop_id"])

    stops_by_id = {s["stop_id"]: s for s in stops_raw}
    station_codes = sorted(used & set(stops_by_id))
    dropped = used - set(stops_by_id)
    if dropped:
        print("  ! %d stop_ids referenced by stop_times are missing from stops.txt: %s"
              % (len(dropped), sorted(dropped)[:8]))

    stn_index = {code: i for i, code in enumerate(station_codes)}

    tz_by_code, tz_corrections, tz_unresolved = reconcile_timezones(
        station_codes, stops_by_id, extra,
        os.path.join(ROOT, "research", "trains_raw.json"),
    )
    if tz_corrections:
        print("  timezone corrections (live feed overrules GTFS stop_timezone):")
        for code, was, now, n in tz_corrections:
            print("    %-4s %-20s -> %-20s (%d observed calls)" % (code, was, now, n))
    if tz_unresolved:
        print("  ! %d stations where no candidate zone matched observation: %s"
              % (len(tz_unresolved), tz_unresolved[:5]))

    clock_fixes, clock_evidence = detect_clock_offsets(
        station_codes, by_trip, trips_raw,
        os.path.join(ROOT, "research", "trains_raw.json"), tz_by_code,
    )
    if clock_evidence:
        print("  stop_times authored in the wrong clock (normalised to Eastern):")
        for code, fix, n, tz in sorted(clock_evidence):
            print("    %-4s %+d min  (%d observed calls, %s)" % (code, fix, n, tz))

    # traffic weight = number of trips calling, used to rank autocomplete results
    calls = collections.Counter()
    for sts in by_trip.values():
        for st in sts:
            calls[st["stop_id"]] += 1

    stations = []
    for code in station_codes:
        s = stops_by_id[code]
        ex = extra.get(code, {})
        lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
        city = (ex.get("city") or "").strip()
        state = (ex.get("state") or "").strip()
        # The station dataset carries the name a traveller would recognise
        # ("New York Penn", "Philadelphia 30th Street"); GTFS carries the
        # operational one, badly cased. Prefer the former, keep the latter.
        official = clean_station_name(s["stop_name"])
        name = (ex.get("name") or "").strip() or official
        entry = {
            "c": code,
            "n": name,
            "y": city or name,
            "s": state,
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "tz": tz_by_code[code],
            "w": calls[code],
        }
        addr = (ex.get("address1") or "").strip()
        if addr:
            entry["a"] = addr
        zc = (ex.get("zip") or "").strip()
        if zc:
            entry["z"] = zc
        if official and official != name:
            entry["f"] = official  # full operational name, shown on the station page
        stations.append(entry)

    # --- routes ---
    route_index = {}
    routes = []
    for r in routes_raw:
        ag = agencies.get(r["agency_id"], {})
        ag_name = ag.get("agency_name", "Unknown")
        long_name = (r["route_long_name"] or r["route_short_name"] or "").strip()
        is_amtrak_rail = r["agency_id"] == "51" and r["route_type"] == "2"
        if long_name == "Amtrak Thruway Connecting Service" or r["route_type"] == "3":
            prod = dict(THRUWAY_PRODUCT)
        elif is_amtrak_rail:
            prod = dict(ROUTE_PRODUCTS.get(long_name, DEFAULT_PRODUCT))
        else:
            prod = dict(PARTNER_PRODUCT)
        route_index[r["route_id"]] = len(routes)
        routes.append({
            "n": long_name,
            "ag": ag_name,
            "mode": "bus" if r["route_type"] == "3" else "rail",
            "cat": prod["cat"],
            "cls": prod["classes"],
            "res": prod["res"],
            "seatmap": prod["seatmap"],
            "sleeper": prod["sleeper"],
        })
    unknown = sorted({
        (r["route_long_name"] or "").strip()
        for r in routes_raw
        if r["agency_id"] == "51" and r["route_type"] == "2"
        and (r["route_long_name"] or "").strip() not in ROUTE_PRODUCTS
    })
    if unknown:
        print("  ! Amtrak rail routes with no product entry (defaulted to coach-only): %s" % unknown)

    # --- service calendar ---
    svc_index = {}
    services = []
    DOW = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    for c in cal_raw:
        bits = 0
        for i, d in enumerate(DOW):
            if c[d] == "1":
                bits |= 1 << i
        svc_index[c["service_id"]] = len(services)
        services.append([bits, int(c["start_date"]), int(c["end_date"])])

    # --- trips ---
    trips = []
    skipped = 0
    for t in trips_raw:
        sts = by_trip.get(t["trip_id"])
        if not sts or len(sts) < 2:
            skipped += 1
            continue
        if t["service_id"] not in svc_index:
            skipped += 1
            continue
        seq = []
        prev_dep = None
        prev_ll = None
        ok = True
        for st in sts:
            code = st["stop_id"]
            if code not in stn_index:
                ok = False
                break
            shift = clock_fixes.get(code, 0)
            arr = hhmmss_to_min(st["arrival_time"]) + shift
            dep = hhmmss_to_min(st["departure_time"]) + shift
            s = stations[stn_index[code]]
            ll = (s["lat"], s["lon"])
            if prev_dep is None:
                d_arr = arr           # absolute minutes for the first stop
                seg = 0
            else:
                d_arr = arr - prev_dep  # delta from previous departure
                seg = int(round(haversine_mi(prev_ll[0], prev_ll[1], ll[0], ll[1]) * SINUOSITY))
            seq.extend([stn_index[code], d_arr, max(0, dep - arr), seg])
            prev_dep = dep
            prev_ll = ll
        if not ok:
            skipped += 1
            continue
        # A clock correction shifts one station's calls but not its neighbours'.
        # If that ever reorders a trip, the correction is wrong and must not ship.
        for i in range(1, len(seq) // 4):
            if seq[i * 4 + 1] < 0:
                raise SystemExit(
                    "clock correction made trip %s non-monotonic at stop %d — refusing to build"
                    % (t["trip_id"], i))
        trips.append([
            route_index[t["route_id"]],
            svc_index[t["service_id"]],
            (t.get("trip_short_name") or "").strip(),
            int(t.get("direction_id") or 0),
            (t.get("trip_headsign") or "").strip(),
            seq,
        ])
    if skipped:
        print("  ! skipped %d trips (no stop_times / unknown service / unknown stop)" % skipped)

    network = {
        "v": 1,
        "sinuosity": SINUOSITY,
        "routes": routes,
        "services": services,
        "trips": trips,
    }

    # --- station file also carries the route list serving each station ---
    serving = collections.defaultdict(set)
    for tr in trips:
        ridx = tr[0]
        seq = tr[5]
        for i in range(0, len(seq), 4):
            serving[seq[i]].add(ridx)
    for i, s in enumerate(stations):
        s["r"] = sorted(serving.get(i, ()))

    meta = {
        "generated": datetime.date.today().isoformat(),
        "source": {
            "schedule": "Amtrak GTFS — https://content.amtrak.com/content/gtfs/GTFS.zip",
            "publisher": feed_info.get("feed_publisher_name", ""),
            "feed_version": feed_info.get("feed_version", ""),
            "feed_contact": feed_info.get("feed_contact_email", ""),
            "station_metadata": "amtraker v3 public station dataset (city/state/ZIP/street address)",
        },
        "validity": {
            "calendar_start": min(s[1] for s in services),
            "calendar_end": max(s[2] for s in services),
        },
        "counts": {
            "stations": len(stations),
            "routes": len(routes),
            "rail_routes": sum(1 for r in routes if r["mode"] == "rail"),
            "thruway_routes": sum(1 for r in routes if r["mode"] == "bus"),
            "trips": len(trips),
            "stop_times": sum(len(t[5]) // 4 for t in trips),
        },
        "clock_normalisation": {
            "method": "live-feed UTC offsets converted to Eastern and compared with stop_times "
                      "modulo the day; stations with a consistent whole-hour gap are shifted",
            "shifted": [{"station": c, "minutes": m, "observations": n} for c, m, n, _ in clock_evidence],
        },
        "timezone_reconciliation": {
            "method": "GTFS stop_timezone cross-checked against real UTC offsets in the live train feed; "
                      "the station dataset wins where the feed agrees with it",
            "corrected": [{"station": c, "from": a, "to": b} for c, a, b, _ in tz_corrections],
            "unresolved": [c for c, _, _ in tz_unresolved],
        },
        "distance_model": {
            "method": "great-circle between consecutive stops x track-sinuosity factor",
            "factor": SINUOSITY,
            "calibrated_against": "15 published Amtrak city-pair mileages (median ratio 1.1136)",
        },
        "fares": "NOT from GTFS. Fares are generated by the simulated fare engine "
                 "(assets/js/fares.js) and are illustrative only.",
    }

    os.makedirs(args.out, exist_ok=True)
    for name, payload in (("stations.json", stations), ("network.json", network), ("meta.json", meta)):
        path = os.path.join(args.out, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)
        print("  %-14s %8.1f KB" % (name, os.path.getsize(path) / 1024))

    print()
    print("  stations %d   routes %d (%d rail, %d thruway)   trips %d   stop calls %d"
          % (meta["counts"]["stations"], meta["counts"]["routes"], meta["counts"]["rail_routes"],
             meta["counts"]["thruway_routes"], meta["counts"]["trips"], meta["counts"]["stop_times"]))
    print("  calendar %s -> %s" % (meta["validity"]["calendar_start"], meta["validity"]["calendar_end"]))
    return meta


if __name__ == "__main__":
    print("Railhead network build")
    build()
