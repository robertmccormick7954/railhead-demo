#!/usr/bin/env bash
# Fetch Amtrak's published GTFS feed and extract it for tools/build_data.py.
# The feed declares only a seven-day validity window, so re-run this weekly.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p research
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
echo "fetching https://content.amtrak.com/content/gtfs/GTFS.zip"
curl -fSL --max-time 180 -A "$UA" https://content.amtrak.com/content/gtfs/GTFS.zip -o research/GTFS.zip
rm -rf research/gtfs && mkdir -p research/gtfs
unzip -q -o research/GTFS.zip -d research/gtfs
echo "extracted:"; ls -1 research/gtfs
echo
echo "station metadata (city, state, ZIP, street address — absent from GTFS)"
curl -fsSL --max-time 60 -A "$UA" https://api-v3.amtraker.com/v3/stations -o research/stations_raw.json
echo "live train feed (used to validate the timezone chain)"
curl -fsSL --max-time 90 -A "$UA" https://api-v3.amtraker.com/v3/trains -o research/trains_raw.json
echo
echo "now run: python3 tools/build_data.py && python3 tools/build_pages.py"
