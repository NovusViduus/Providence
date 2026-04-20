"""Seed Redis with geo cache from data/geo_cache.json.
Run after docker compose up to pre-populate geo lookups.

Usage:
    python3 scripts/seed_redis_geo.py
"""

import json
import subprocess
import sys
from pathlib import Path

CACHE_FILE = Path("data/geo_cache.json")

if not CACHE_FILE.exists():
    print("No geo cache found at data/geo_cache.json")
    sys.exit(0)

cache = json.load(open(CACHE_FILE))
count = 0

for ip, geo in cache.items():
    if geo is None:
        continue
    # Remap keys to match ip-api.com format that GeoController expects
    fixed = {
        "lat": geo.get("lat", 0),
        "lon": geo.get("lng", geo.get("lon", 0)),
        "countryCode": geo.get("country", geo.get("countryCode", "")),
        "city": geo.get("city", ""),
        "status": "success",
    }
    val = json.dumps(fixed)
    subprocess.run(
        ["docker", "exec", "providence-main-redis-1", "redis-cli",
         "SETEX", f"geo:ip:{ip}", "604800", val],
        capture_output=True,
    )
    count += 1
    if count % 1000 == 0:
        print(f"  {count}...")

# Also seed honeypot public IPs
honeypots = [
    ("54.91.174.191", 39.0438, -77.4874, "US", "Ashburn"),
    ("3.253.60.6", 53.3331, -6.2489, "IE", "Dublin"),
    ("3.0.102.2", 1.2800, 103.8510, "SG", "Singapore"),
]
for ip, lat, lon, cc, city in honeypots:
    val = json.dumps({"lat": lat, "lon": lon, "countryCode": cc, "city": city, "status": "success"})
    subprocess.run(
        ["docker", "exec", "providence-main-redis-1", "redis-cli",
         "SETEX", f"geo:ip:{ip}", "604800", val],
        capture_output=True,
    )

print(f"Seeded {count} geo entries + 3 honeypot IPs into Redis")
