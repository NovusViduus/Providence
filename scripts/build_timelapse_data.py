"""Build timelapse JSON from honeypot session data + Eye classification logs.

Geo-locates unique source IPs via ip-api.com (with rate limiting + caching),
outputs a compact JSON array sorted by timestamp for the globe timelapse.

Usage:
    python3 scripts/build_timelapse_data.py

Output:
    lens/public/timelapse.json
"""

import json
import os
import time
import sys
from pathlib import Path
from collections import Counter

# ── Config ────────────────────────────────────────────────────────────────────

HONEYPOT_DIR = Path("data/honeypot")
EYE_LOG_DIR = Path("data/eye-captures")
GEO_CACHE_FILE = Path("data/geo_cache.json")
OUTPUT_FILE = Path("lens/public/timelapse.json")

# Honeypot public IPs → geo coordinates (hardcoded to avoid API calls)
HONEYPOT_LOCATIONS = {
    "lure-ssh-us-east-1": {"lat": 39.0438, "lng": -77.4874, "label": "Virginia"},
    "lure-ssh-eu-west-1": {"lat": 53.3331, "lng": -6.2489, "label": "Ireland"},
    "lure-ssh-ap-southeast-1": {"lat": 1.2800, "lng": 103.8510, "label": "Singapore"},
    # Fallback for Eye logs
    "lure-us": {"lat": 39.0438, "lng": -77.4874, "label": "Virginia"},
    "lure-eu": {"lat": 53.3331, "lng": -6.2489, "label": "Ireland"},
    "lure-ap": {"lat": 1.2800, "lng": 103.8510, "label": "Singapore"},
}

# ── Geo cache ─────────────────────────────────────────────────────────────────

geo_cache = {}

def load_geo_cache():
    global geo_cache
    if GEO_CACHE_FILE.exists():
        with open(GEO_CACHE_FILE) as f:
            geo_cache = json.load(f)
        print(f"  Loaded {len(geo_cache)} cached geo lookups")

def save_geo_cache():
    GEO_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(GEO_CACHE_FILE, "w") as f:
        json.dump(geo_cache, f)
    print(f"  Saved {len(geo_cache)} geo lookups to cache")

def lookup_geo(ip: str) -> dict | None:
    """Lookup IP geo via ip-api.com with caching and rate limiting."""
    if ip in geo_cache:
        return geo_cache[ip]

    # Skip private IPs
    if ip.startswith(("10.", "172.", "192.168.", "127.", "169.254.")):
        geo_cache[ip] = None
        return None

    import urllib.request
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,lat,lon,countryCode,city"
        req = urllib.request.Request(url, headers={"User-Agent": "Providence/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
        if data.get("status") == "success":
            result = {"lat": data["lat"], "lng": data["lon"],
                      "country": data.get("countryCode", ""), "city": data.get("city", "")}
            geo_cache[ip] = result
            return result
        else:
            geo_cache[ip] = None
            return None
    except Exception:
        geo_cache[ip] = None
        return None


# ── Parse honeypot sessions ───────────────────────────────────────────────────

def parse_honeypot_sessions() -> list[dict]:
    """Parse normalized honeypot JSON sessions from data/honeypot/."""
    events = []
    if not HONEYPOT_DIR.exists():
        print("  No honeypot data directory found, skipping")
        return events

    files = sorted(HONEYPOT_DIR.glob("*.json"))
    print(f"  Found {len(files)} honeypot session files")

    # Group files by region so we can interleave timestamps
    by_region: dict[str, list] = {}
    for f in files:
        name = f.stem
        # Extract region: lure-ssh-{region}-{session_id}
        if "us-east" in name:
            region = "lure-ssh-us-east-1"
        elif "eu-west" in name:
            region = "lure-ssh-eu-west-1"
        elif "ap-southeast" in name:
            region = "lure-ssh-ap-southeast-1"
        else:
            region = "unknown"
        by_region.setdefault(region, []).append(f)

    # Assign timestamps within each region independently, then merge
    all_parsed = []
    base_epoch = 1771372800  # 2026-02-18T00:00:00Z
    total_seconds = 56 * 86400  # 56 days

    for region, region_files in by_region.items():
        print(f"    {region}: {len(region_files)} files")
        dest = None
        for key, loc in HONEYPOT_LOCATIONS.items():
            if key in region:
                dest = loc
                break
        if not dest:
            dest = HONEYPOT_LOCATIONS.get("lure-us")

        for i, f in enumerate(region_files):
            if i % 50000 == 0 and i > 0:
                print(f"      Parsed {i}/{len(region_files)}...")
            try:
                with open(f) as fh:
                    session = json.load(fh)
                src_ip = session.get("src_ip", "")
                category = session.get("category", "PROBE")

                if not src_ip:
                    continue

                # Distribute timestamps evenly within this region's files
                frac = i / max(len(region_files), 1)
                ts_epoch = base_epoch + int(frac * total_seconds)
                timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts_epoch))

                all_parsed.append({
                    "t": timestamp,
                    "src": src_ip,
                    "cat": category,
                    "dLat": dest["lat"],
                    "dLng": dest["lng"],
                })
            except (json.JSONDecodeError, KeyError):
                continue

    events = all_parsed

    print(f"  Parsed {len(events)} honeypot sessions")
    return events


# ── Parse Eye classification logs ─────────────────────────────────────────────

def parse_eye_logs() -> list[dict]:
    """Parse [CLASSIFY] lines from Eye logs."""
    import re
    events = []
    if not EYE_LOG_DIR.exists():
        print("  No Eye log directory found, skipping")
        return events

    for log_file in sorted(EYE_LOG_DIR.glob("*_eye.log")):
        region = log_file.stem.replace("_eye", "")
        dest = HONEYPOT_LOCATIONS.get(region, HONEYPOT_LOCATIONS["lure-us"])
        count = 0

        with open(log_file) as f:
            for line in f:
                if "[CLASSIFY]" not in line or "169.254.169.254" in line:
                    continue
                m = re.search(r"\[CLASSIFY\] ([\d.]+):(\d+) <-> ([\d.]+):(\d+) → (\w+) \(([\d.]+)\)", line)
                if not m:
                    continue
                src_ip = m.group(1)
                cat = m.group(5)

                # Skip private source IPs and BENIGN
                if src_ip.startswith(("10.", "172.", "192.168.", "129.10.")):
                    continue

                events.append({
                    "t": "2026-04-15T06:00:00Z",  # Eye logs don't have timestamps per-line
                    "src": src_ip,
                    "cat": cat,
                    "dLat": dest["lat"],
                    "dLng": dest["lng"],
                })
                count += 1

        print(f"  {region}: {count} Eye classifications")

    print(f"  Parsed {len(events)} Eye events total")
    return events


# ── Geo-locate all unique IPs ─────────────────────────────────────────────────

def geo_locate_all(events: list[dict]) -> list[dict]:
    """Add source lat/lng to all events by geo-locating unique IPs."""
    unique_ips = set(e["src"] for e in events)
    print(f"  {len(unique_ips)} unique source IPs to geo-locate")

    # Filter out already cached
    uncached = [ip for ip in unique_ips if ip not in geo_cache]
    print(f"  {len(uncached)} need API lookup ({len(unique_ips) - len(uncached)} cached)")

    # Batch lookup with rate limiting (45 req/min for ip-api.com free tier)
    for i, ip in enumerate(uncached):
        if i > 0 and i % 40 == 0:
            print(f"    Rate limit pause at {i}/{len(uncached)}... saving cache")
            save_geo_cache()
            time.sleep(62)  # Wait for rate limit reset
        if i % 100 == 0 and i > 0:
            print(f"    Looked up {i}/{len(uncached)}...")
        lookup_geo(ip)

    save_geo_cache()

    # Attach geo to events
    result = []
    skipped = 0
    for e in events:
        geo = geo_cache.get(e["src"])
        if geo is None:
            skipped += 1
            continue
        result.append({
            "t": e["t"],
            "src": e["src"],
            "sLat": geo["lat"],
            "sLng": geo["lng"],
            "cat": e["cat"],
            "dLat": e["dLat"],
            "dLng": e["dLng"],
            "cc": geo.get("country", ""),
            "city": geo.get("city", ""),
        })

    print(f"  {len(result)} events with geo data ({skipped} skipped — private/failed)")
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Building timelapse data...")
    print()

    load_geo_cache()

    print("Step 1: Parse honeypot sessions")
    hp_events = parse_honeypot_sessions()

    print("\nStep 2: Parse Eye classification logs")
    eye_events = parse_eye_logs()

    all_events = hp_events + eye_events
    print(f"\nTotal raw events: {len(all_events)}")

    # Deduplicate by source IP (keep one per IP per category to reduce size)
    print("\nStep 3: Deduplicate (one entry per IP per category)")
    seen = set()
    deduped = []
    for e in all_events:
        key = f"{e['src']}:{e['cat']}"
        if key not in seen:
            seen.add(key)
            deduped.append(e)
    print(f"  {len(deduped)} unique IP+category combinations")

    print("\nStep 4: Geo-locate source IPs")
    geo_events = geo_locate_all(deduped)

    # Sort by timestamp
    geo_events.sort(key=lambda e: e["t"])

    # Category stats
    cats = Counter(e["cat"] for e in geo_events)
    print(f"\nCategory breakdown:")
    for cat, count in cats.most_common():
        print(f"  {cat}: {count}")

    # Write output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(geo_events, f, separators=(",", ":"))

    size_mb = OUTPUT_FILE.stat().st_size / 1024 / 1024
    print(f"\nOutput: {OUTPUT_FILE} ({size_mb:.1f} MB, {len(geo_events)} events)")
    print("Done!")


if __name__ == "__main__":
    main()
