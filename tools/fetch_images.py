#!/usr/bin/env python3
"""
Railhead — photography sourcing.

Pulls real photographs from Wikimedia Commons, filters them to licences we may
actually ship, converts them to WebP at the sizes the site uses, strips EXIF, and
writes a manifest carrying the attribution each licence requires.

Why not amtrak.com: their photographs are copyrighted and their Terms of Use
forbid reproducing their materials. (The site also refuses this network outright.)
Commons has thousands of photographs of the same trains, stations and cities under
licences that permit commercial use with attribution, so there is no reason to
take anyone's copyrighted work.

Licences accepted: public domain, CC0, CC BY, CC BY-SA (any version). Everything
else — including non-commercial and no-derivatives — is rejected.

Run: python3 tools/fetch_images.py [--limit-per-query 3]
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "docs", "assets", "photos")
MANIFEST = os.path.join(ROOT, "docs", "data", "photos.json")

UA = "RailheadDemo/1.0 (rail booking demonstration; https://github.com/robertmccormick7954/railhead-demo)"
API = "https://commons.wikimedia.org/w/api.php"

OK_LICENCE = re.compile(
    r"^(cc0|cc[ -]by(?:[ -]sa)?[ -]?[0-9.]*|public domain|pd[ -].*|"
    r"attribution|no restrictions)$", re.I)
BAD_LICENCE = re.compile(r"(non[- ]?commercial|\bnc\b|no[- ]?deriv|\bnd\b|fair use|copyright)", re.I)

# What each slot is for, and what to search for it. Slots are keyed so the site
# can ask for "the photo for Chicago" without knowing anything about Commons.
# slot, search query, shape, and the terms the FILE TITLE must contain.
#
# The required terms are the important part. Commons free-text search returned a
# photograph of Hamburg for "San Diego skyline", Hillary Clinton for
# "Washington DC skyline", a shooting memorial for "Sacramento downtown" and a
# cartoon for "Boston skyline". Requiring the subject's name in the title is a
# blunt instrument that removes all four.
WANTED = [
    ("hero-1", "Amtrak passenger train river bridge", "wide", ["amtrak"]),
    ("hero-2", "Amtrak Superliner train mountains", "wide", ["amtrak", "zephyr", "starlight", "builder"]),
    ("hero-3", "Amtrak train coast landscape", "wide", ["amtrak"]),

    ("route-acela", "Amtrak Acela Express trainset", "card", ["acela"]),
    ("route-california-zephyr", "California Zephyr Amtrak Colorado", "card", ["zephyr"]),
    ("route-coast-starlight", "Coast Starlight Amtrak California", "card", ["starlight"]),
    ("route-empire-builder", "Empire Builder Amtrak train Montana", "card", ["empire builder"]),
    ("route-southwest-chief", "Southwest Chief Amtrak train", "card", ["southwest chief"]),
    ("route-northeast-regional", "Amtrak Northeast Regional train", "card", ["northeast regional", "amtrak"]),
    ("route-cascades", "Amtrak Cascades Talgo train", "card", ["cascades"]),
    ("route-pacific-surfliner", "Pacific Surfliner Amtrak train", "card", ["surfliner"]),

    ("station-NYP", "Moynihan Train Hall interior", "card", ["moynihan"]),
    ("station-WAS", "Washington Union Station interior hall", "card", ["union station"]),
    ("station-CHI", "Chicago Union Station Great Hall", "card", ["union station"]),
    ("station-PHL", "30th Street Station Philadelphia", "card", ["30th street"]),
    ("station-LAX", "Los Angeles Union Station interior", "card", ["union station"]),
    ("station-BOS", "South Station Boston concourse", "card", ["south station"]),
    ("station-SEA", "King Street Station Seattle", "card", ["king street station"]),
    ("station-NOL", "New Orleans Union Passenger Terminal", "card", ["new orleans"]),

    ("city-NYP", "Manhattan skyline New York City", "card", ["manhattan", "new york"]),
    ("city-WAS", "Washington D.C. skyline cityscape", "card", ["washington"]),
    ("city-CHI", "Chicago skyline cityscape", "card", ["chicago"]),
    ("city-LAX", "Los Angeles downtown skyline", "card", ["los angeles"]),
    ("city-SEA", "Seattle skyline Space Needle", "card", ["seattle"]),
    ("city-BOS", "Boston skyline cityscape photograph", "card", ["boston"]),
    ("city-NOL", "New Orleans French Quarter architecture", "card", ["new orleans", "french quarter"]),
    ("city-SAN", "San Diego skyline downtown", "card", ["san diego"]),
    ("city-PDX", "Portland Oregon skyline", "card", ["portland"]),
    ("city-PHL", "Philadelphia skyline cityscape", "card", ["philadelphia"]),
    ("city-DEN", "Denver skyline Colorado", "card", ["denver"]),
    ("city-MKE", "Milwaukee skyline Wisconsin", "card", ["milwaukee"]),
    ("city-ALB", "Albany New York downtown", "card", ["albany"]),
    ("city-SAC", "Sacramento California capitol downtown", "card", ["sacramento"]),
    ("city-STL", "Gateway Arch St Louis Missouri", "card", ["gateway arch", "st. louis", "st louis"]),
    ("city-EMY", "San Francisco skyline bay", "card", ["san francisco"]),

    ("onboard-coach", "Amtrak coach car interior seats", "card", ["amtrak"]),
    ("onboard-sleeper", "Amtrak Superliner roomette", "card", ["roomette", "superliner"]),
    ("onboard-dining", "Amtrak dining car interior", "card", ["amtrak"]),
    ("onboard-lounge", "Amtrak Sightseer Lounge interior", "card", ["lounge", "amtrak"]),
]

# A title containing any of these is rejected outright. Two groups: things that
# are not photographs, and things whose subject is a person or an event we have
# no business putting on a destination card.
BAD_TITLE = re.compile(
    r"(illustration|clipart|clip art|drawing|painting|sketch|cartoon|diagram|"
    r"\bmap\b|\bseal\b|\blogo\b|poster|advertisement|advert\b|postcard|"
    r"engraving|lithograph|infographic|360 |360-|equirectangular|fisheye|"
    r"panorama|panoramic|lobby|observation deck|museum|"
    r"shooting|memorial|funeral|protest|riot|crash|derail|wreck|fire\b|flood|"
    r"secretary|president|senator|governor|mayor|ceremony|awards|"
    r"portrait of|meets with|visits|delegation|press conference)", re.I)

SIZES = {
    # slot kind -> (width, height, quality)
    "wide": [(1800, 900, 78), (1100, 550, 76), (700, 350, 74)],
    "card": [(900, 600, 78), (560, 373, 76)],
}


def api(params):
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception as exc:
            if attempt == 2:
                print(f"    ! api failed: {exc}")
                return {}
            time.sleep(2 + attempt * 3)
    return {}


def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def licence_ok(meta):
    short = strip_html(meta.get("LicenseShortName", {}).get("value", ""))
    terms = strip_html(meta.get("UsageTerms", {}).get("value", ""))
    blob = f"{short} {terms}"
    if BAD_LICENCE.search(blob):
        return None
    if OK_LICENCE.match(short.strip()):
        return short.strip()
    if re.match(r"^(cc0|cc by|public domain)", short.strip(), re.I):
        return short.strip()
    return None


def search(query, limit, must=()):
    r = api({
        "action": "query", "generator": "search", "gsrsearch": query,
        "gsrnamespace": 6, "gsrlimit": max(30, limit * 10), "prop": "imageinfo",
        "iiprop": "url|extmetadata|size|mime", "iiurlwidth": 2000, "format": "json",
    })
    out = []
    for page in (r.get("query", {}).get("pages", {}) or {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        if not info or info.get("mime") not in ("image/jpeg", "image/png"):
            continue
        if info.get("width", 0) < 1100:
            continue
        title = page["title"]
        if BAD_TITLE.search(title):
            continue
        # A year in the title is usually the year the picture was taken. For a
        # destination card we want the city as it is now, not as it was.
        old_year = re.search(r"\b(1[6-9]\d\d|200[0-4])\b", title)
        if old_year and not title.lower().startswith("file:amtk"):
            continue
        if must and not any(m.lower() in title.lower() for m in must):
            continue
        # Destination and route cards are landscape crops; a tall portrait
        # source loses most of its subject to the crop.
        if info["width"] < info["height"]:
            continue
        meta = info.get("extmetadata", {})
        lic = licence_ok(meta)
        if not lic:
            continue
        out.append({
            "title": title,
            "url": info.get("thumburl") or info.get("url"),
            "descurl": info.get("descriptionurl", ""),
            "width": info["width"], "height": info["height"],
            "licence": lic,
            "author": strip_html(meta.get("Artist", {}).get("value", "")) or "Unknown",
            "caption": strip_html(meta.get("ImageDescription", {}).get("value", ""))[:180],
        })
    return out


def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=120).read()


def looks_archival(raw):
    """
    Greyscale / sepia detection.

    KEPT BUT NOT USED IN SELECTION. Two pixel-based attempts at this — mean
    saturation, and hue concentration — both failed to separate a sepia
    engraving of Chicago from a genuinely hazy photograph of Seattle, because
    most city photographs are dominated by a single sky hue anyway. The signal
    that does work is much simpler: a year in the file title. Left here so the
    next person does not repeat the experiment.
    """
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        return True
    img.thumbnail((160, 160))
    hsv = img.convert("HSV")
    pixels = list(hsv.getdata())
    if not pixels:
        return True
    sat = [p[1] for p in pixels]
    mean_sat = sum(sat) / len(sat)
    # spread of hue among the pixels that have any colour at all
    hues = [p[0] for p in pixels if p[1] > 40]
    hue_spread = (max(hues) - min(hues)) if len(hues) > 40 else 0
    return mean_sat < 42 or hue_spread < 40


def process(raw, slot, kind):
    """Crop to the aspect the slot needs, emit WebP at each size, strip metadata."""
    img = Image.open(io.BytesIO(raw))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")

    written = []
    for (w, h, q) in SIZES[kind]:
        target = w / h
        src = img.width / img.height
        if src > target:
            new_w = int(img.height * target)
            box = ((img.width - new_w) // 2, 0, (img.width - new_w) // 2 + new_w, img.height)
        else:
            new_h = int(img.width / target)
            # bias the crop upward: skylines and trains sit above centre
            top = int((img.height - new_h) * 0.35)
            box = (0, top, img.width, top + new_h)
        crop = img.crop(box).resize((w, h), Image.LANCZOS)
        clean = Image.new("RGB", crop.size)
        clean.putdata(list(crop.getdata()))  # drops every metadata block
        name = f"{slot}-{w}.webp"
        clean.save(os.path.join(OUT_DIR, name), "WEBP", quality=q, method=6)
        written.append({"file": name, "w": w, "h": h,
                        "bytes": os.path.getsize(os.path.join(OUT_DIR, name))})
    return written


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit-per-query", type=int, default=3)
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    seen_hashes = {}
    manifest = {}
    failures = []

    for slot, query, kind, must in WANTED:
        print(f"  {slot:26s} {query[:44]:46s}", end="", flush=True)
        candidates = search(query, args.limit_per_query, must)
        if not candidates:
            print("no licensed result")
            failures.append((slot, query, "no result"))
            continue

        placed = False
        for cand in candidates:
            try:
                raw = download(cand["url"])
            except Exception as exc:
                continue
            digest = hashlib.sha256(raw).hexdigest()
            if digest in seen_hashes:
                continue  # never the same photograph in two slots
            try:
                files = process(raw, slot, kind)
            except Exception as exc:
                continue
            seen_hashes[digest] = slot
            manifest[slot] = {
                "files": files,
                "kind": kind,
                "title": cand["title"].replace("File:", ""),
                "author": cand["author"][:120],
                "licence": cand["licence"],
                "source": cand["descurl"],
                "caption": cand["caption"],
            }
            print(f"ok  {cand['licence'][:12]:14s} {files[0]['bytes']//1024:4d} KB")
            placed = True
            break
        if not placed:
            print("no usable candidate")
            failures.append((slot, query, "download/dedupe"))
        time.sleep(0.4)

    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump({
            "_comment": "Photography shipped with this build. Every image is from Wikimedia Commons "
                        "under a licence permitting commercial use. Attribution is reproduced on "
                        "credits.html, which is linked from every page footer. No image is taken "
                        "from any carrier's website.",
            "photos": manifest,
        }, fh, indent=1, ensure_ascii=False)

    total = sum(f["bytes"] for p in manifest.values() for f in p["files"])
    print(f"\n  {len(manifest)}/{len(WANTED)} slots filled, "
          f"{sum(len(p['files']) for p in manifest.values())} files, {total/1024/1024:.1f} MB")
    if failures:
        print("  unfilled:", ", ".join(s for s, _, _ in failures))
    lic = {}
    for p in manifest.values():
        lic[p["licence"]] = lic.get(p["licence"], 0) + 1
    print("  licences:", lic)
    return 0


if __name__ == "__main__":
    print("Railhead photography build")
    sys.exit(main())
