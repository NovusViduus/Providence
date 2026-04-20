#!/usr/bin/env python3
"""
Backfill historical Eye log files through the Citadel REST ingest pipeline.
Throttled to avoid overloading the server.

Usage (run on EC2):
    nohup python3 backfill_eyes.py > /tmp/backfill.log 2>&1 &

Reads ~/lure-{us,eu,ap}_eye.log and POSTs each event to /api/v1/events/ingest
at ~10 events/sec so the full pipeline runs (incidents, actions, blocks).
"""

import re, json, time, sys, os, hashlib
from datetime import datetime, timezone, timedelta
from urllib.request import Request, urlopen

CITADEL = "http://localhost:8080"
RATE = 10  # events per second
INTERNAL = ("169.254.", "10.", "127.", "192.168.")

LOG_FILES = {
    os.path.expanduser("~/lure-us_eye.log"): "54.91.174.191",
    os.path.expanduser("~/lure-eu_eye.log"): "3.253.60.6",
    os.path.expanduser("~/lure-ap_eye.log"): "3.0.102.2",
}

def is_internal(ip):
    if any(ip.startswith(p) for p in INTERNAL):
        return True
    if ip.startswith("172."):
        parts = ip.split(".")
        if len(parts) >= 2 and 16 <= int(parts[1]) <= 31:
            return True
    return False

def get_token():
    body = json.dumps({"username": "admin", "password": "Khal"}).encode()
    req = Request(f"{CITADEL}/auth/login", data=body,
                  headers={"Content-Type": "application/json"})
    resp = urlopen(req, timeout=10)
    return json.loads(resp.read())["token"]

def post_event(token, payload):
    body = json.dumps(payload).encode()
    req = Request(f"{CITADEL}/api/v1/events/ingest", data=body,
                  headers={"Content-Type": "application/json",
                           "Authorization": f"Bearer {token}"})
    try:
        resp = urlopen(req, timeout=10)
        return resp.status == 200
    except Exception:
        return False


print("Authenticating...")
token = get_token()
print("Token acquired")

# Spread timestamps over the last 56 days (matches the 56-day collection period)
now = datetime.now(timezone.utc)
total_ok = 0
total_err = 0
total_skip = 0
global_count = 0

for logfile, honeypot_ip in LOG_FILES.items():
    if not os.path.exists(logfile):
        print(f"SKIP: {logfile} not found")
        continue

    print(f"\nProcessing {logfile}...")
    events = []

    with open(logfile) as f:
        for line in f:
            m = re.search(
                r'\[CLASSIFY\]\s+(\S+):(\d+)\s+<->\s+(\S+):(\d+)\s+.*?(\w+)\s+\(([\d.]+)\)',
                line
            )
            if not m:
                continue
            src_ip, src_port, dst_ip, dst_port, category, confidence = m.groups()

            # Swap if source is internal
            if is_internal(src_ip) and not is_internal(dst_ip):
                src_ip, dst_ip = dst_ip, src_ip
                src_port, dst_port = dst_port, src_port
            elif is_internal(src_ip) and is_internal(dst_ip):
                total_skip += 1
                continue

            if is_internal(src_ip):
                total_skip += 1
                continue

            events.append((src_ip, int(src_port), dst_ip, int(dst_port), category, float(confidence)))

    print(f"  {len(events)} events to inject ({total_skip} skipped)")

    for i, (src_ip, src_port, dst_ip, dst_port, category, confidence) in enumerate(events):
        global_count += 1

        # Spread timestamps across 56 days
        minutes_ago = int((i / max(len(events), 1)) * 56 * 24 * 60)
        ts = now - timedelta(minutes=minutes_ago)
        ts_millis = int(ts.timestamp() * 1000)

        # Unique event ID using hash
        uid = hashlib.md5(f"{src_ip}:{src_port}-{dst_ip}:{dst_port}-{global_count}".encode()).hexdigest()[:12]

        payload = {
            "eventId": f"backfill-{uid}-{global_count}",
            "timestamp": ts_millis,
            "sourceIp": src_ip,
            "sourcePort": src_port,
            "destIp": honeypot_ip,
            "destPort": dst_port,
            "protocol": "TCP",
            "category": category,
            "confidence": confidence,
            "sourceComponent": "eye"
        }

        if post_event(token, payload):
            total_ok += 1
        else:
            total_err += 1

        # Throttle
        if global_count % RATE == 0:
            time.sleep(1)

        # Progress
        if global_count % 500 == 0:
            print(f"  Progress: {global_count} sent ({total_ok} ok, {total_err} err)")

        # Re-auth every 5000 events (token might expire)
        if global_count % 5000 == 0:
            try:
                token = get_token()
            except Exception:
                pass

print(f"\nDONE: {global_count} total, {total_ok} ok, {total_err} errors, {total_skip} skipped")
