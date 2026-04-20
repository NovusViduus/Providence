#!/usr/bin/env python3
"""
Live Eye log poller for Providence.
Runs via cron every 60s on the Providence EC2 instance.
SSHes to each honeypot, grabs new [CLASSIFY] lines from eye.log,
and POSTs them to Citadel's /api/v1/events/ingest endpoint so the
full response pipeline runs (incidents, actions, blocks).

Safety: caps at MAX_PER_RUN events per execution to avoid overloading Citadel.
"""

import subprocess, re, os, sys, fcntl, json
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError

LOCK = "/tmp/poll_eyes.lock"
fp = open(LOCK, "w")
try:
    fcntl.flock(fp, fcntl.LOCK_EX | fcntl.LOCK_NB)
except IOError:
    sys.exit(0)

CITADEL = "http://localhost:8080"
HONEYPOTS = ["54.91.174.191", "3.253.60.6", "3.0.102.2"]
KEY = os.path.expanduser("~/.ssh/honeypot_key")
STATE_DIR = os.path.expanduser("~/.eye_state")
os.makedirs(STATE_DIR, exist_ok=True)

MAX_PER_RUN = 200
INTERNAL = ("169.254.", "10.", "127.")

def get_token():
    body = json.dumps({"username": "admin", "password": "Khal"}).encode()
    req = Request(f"{CITADEL}/auth/login", data=body,
                  headers={"Content-Type": "application/json"})
    try:
        resp = urlopen(req, timeout=10)
        return json.loads(resp.read())["token"]
    except Exception as e:
        print(f"AUTH FAILED: {e}", file=sys.stderr)
        sys.exit(1)

def post_event(token, payload):
    body = json.dumps(payload).encode()
    req = Request(f"{CITADEL}/api/v1/events/ingest", data=body,
                  headers={"Content-Type": "application/json",
                           "Authorization": f"Bearer {token}"})
    try:
        resp = urlopen(req, timeout=5)
        return resp.status == 200
    except Exception:
        return False

def is_internal(ip):
    if ip.startswith(INTERNAL):
        return True
    if ip.startswith("172."):
        parts = ip.split(".")
        if len(parts) >= 2 and 16 <= int(parts[1]) <= 31:
            return True
    if ip.startswith("192.168."):
        return True
    return False


token = get_token()
now = datetime.now(timezone.utc)
total_ok = 0
total_err = 0
budget = MAX_PER_RUN

for hp in HONEYPOTS:
    if budget <= 0:
        break

    offset_file = f"{STATE_DIR}/{hp}.offset"
    offset = 0
    if os.path.exists(offset_file):
        offset = int(open(offset_file).read().strip())

    try:
        r = subprocess.run(
            ["ssh", "-i", KEY, "-p", "62222",
             "-o", "ConnectTimeout=10",
             "-o", "StrictHostKeyChecking=no",
             "-o", "BatchMode=yes",
             f"ubuntu@{hp}",
             f"wc -c < ~/eye.log; tail -c +{offset+1} ~/eye.log 2>/dev/null | head -c 500000"],
            capture_output=True, text=True, timeout=30
        )
        if r.returncode != 0:
            print(f"SSH FAIL {hp}: {r.stderr[:100]}")
            continue

        lines = r.stdout.strip().split("\n")
        if not lines or len(lines) < 1:
            continue

        newsize = lines[0].strip()
        if not newsize.isdigit():
            continue

        # If file was truncated/rotated, reset offset
        if int(newsize) < offset:
            print(f"{hp}: eye.log truncated ({newsize} < {offset}), resetting offset")
            offset = 0
            # Re-fetch from beginning
            try:
                r = subprocess.run(
                    ["ssh", "-i", KEY, "-p", "62222",
                     "-o", "ConnectTimeout=10",
                     "-o", "StrictHostKeyChecking=no",
                     "-o", "BatchMode=yes",
                     f"ubuntu@{hp}",
                     f"wc -c < ~/eye.log; tail -c +1 ~/eye.log 2>/dev/null | head -c 500000"],
                    capture_output=True, text=True, timeout=30
                )
                lines = r.stdout.strip().split("\n")
                newsize = lines[0].strip()
            except Exception:
                continue

        classify = [l for l in lines[1:] if "[CLASSIFY]" in l]
    except Exception as e:
        print(f"SSH ERROR {hp}: {e}")
        continue

    ok = 0
    err = 0
    ts_millis = int(now.timestamp() * 1000)
    posted = 0

    for i, line in enumerate(classify):
        if posted >= budget:
            break

        m = re.search(
            r'\[CLASSIFY\]\s+(\S+):(\d+)\s+<->\s+(\S+):(\d+)\s+.*?(\w+)\s+\(([\d.]+)\)',
            line
        )
        if not m:
            continue

        src_ip, src_port, dst_ip, dst_port, category, confidence = m.groups()

        if is_internal(src_ip) and not is_internal(dst_ip):
            src_ip, dst_ip = dst_ip, src_ip
            src_port, dst_port = dst_port, src_port
        elif is_internal(src_ip) and is_internal(dst_ip):
            continue

        if is_internal(src_ip):
            continue

        payload = {
            "eventId": f"live-{hp}-{ts_millis}-{i}",
            "timestamp": ts_millis - (i * 1000),
            "sourceIp": src_ip,
            "sourcePort": int(src_port),
            "destIp": dst_ip,
            "destPort": int(dst_port),
            "protocol": "TCP",
            "category": category,
            "confidence": float(confidence),
            "sourceComponent": "eye"
        }

        if post_event(token, payload):
            ok += 1
        else:
            err += 1
        posted += 1

    total_ok += ok
    total_err += err
    budget -= posted

    # Save offset even if some failed (avoid re-processing same data)
    if classify:
        open(offset_file, "w").write(newsize)
        print(f"{now.isoformat()}: {hp} -> {ok} ok, {err} err ({len(classify)} lines, {posted} attempted)")

if total_ok > 0 or total_err > 0:
    print(f"TOTAL: {total_ok} ingested, {total_err} errors")

fcntl.flock(fp, fcntl.LOCK_UN)
