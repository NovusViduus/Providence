#!/usr/bin/env python3
"""
Eye → Citadel REST Bridge

Tails eye.log, parses classified events, and POSTs them to Citadel's
REST ingest endpoint. Runs on the honeypot alongside Eye when gRPC
is not available.

Usage:
  python3 eye_bridge.py --citadel http://52.41.141.131:8080 --log /home/ubuntu/eye.log
"""

import argparse
import json
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

# Matches: [dispatcher] (no gRPC) event_id=X src=IP:PORT category=CAT confidence=CONF
DISPATCH_RE = re.compile(
    r'\[dispatcher\] \(no gRPC\) '
    r'event_id=(?P<event_id>\S+) '
    r'src=(?P<src_ip>[^:]+):(?P<src_port>\d+) '
    r'category=(?P<category>\S+) '
    r'confidence=(?P<confidence>[\d.]+)'
)

# Matches: [CLASSIFY] SRC_IP:SRC_PORT <-> DST_IP:DST_PORT → CATEGORY (CONF)
CLASSIFY_RE = re.compile(
    r'\[CLASSIFY\] '
    r'(?P<src_ip>[^:]+):(?P<src_port>\d+) <-> '
    r'(?P<dst_ip>[^:]+):(?P<dst_port>\d+) '
    r'→ (?P<category>\S+) '
    r'\((?P<confidence>[\d.]+)\)'
)


def get_token(citadel_url: str, username: str, password: str) -> str:
    data = json.dumps({"username": username, "password": password}).encode()
    req = urllib.request.Request(
        f"{citadel_url}/auth/login",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())["token"]


def post_event(citadel_url: str, token: str, event: dict) -> bool:
    data = json.dumps(event).encode()
    req = urllib.request.Request(
        f"{citadel_url}/api/v1/events/ingest",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise  # Token expired, caller should refresh
        print(f"  POST failed: {e.code} {e.reason}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"  POST failed: {e}", file=sys.stderr)
        return False


def tail_file(path: str):
    """Yield new lines as they appear in a file."""
    with open(path, "r") as f:
        # Seek to end
        f.seek(0, 2)
        while True:
            line = f.readline()
            if line:
                yield line.rstrip("\n")
            else:
                time.sleep(0.5)


def parse_event(line: str, dest_ip: str) -> dict | None:
    """Try to parse a CLASSIFY or dispatcher line into an ingest event."""
    m = CLASSIFY_RE.search(line)
    if m:
        return {
            "eventId": f"eye-{m.group('src_ip')}-{int(time.time()*1000)}",
            "timestamp": int(time.time() * 1000),
            "sourceIp": m.group("src_ip"),
            "sourcePort": int(m.group("src_port")),
            "destIp": m.group("dst_ip"),
            "destPort": int(m.group("dst_port")),
            "protocol": "TCP",
            "category": m.group("category"),
            "subcategory": "",
            "confidence": float(m.group("confidence")),
            "sourceComponent": "eye",
        }
    return None


def main():
    parser = argparse.ArgumentParser(description="Eye → Citadel REST bridge")
    parser.add_argument("--citadel", required=True, help="Citadel URL (e.g. http://52.41.141.131:8080)")
    parser.add_argument("--log", default="/home/ubuntu/eye.log", help="Path to eye.log")
    parser.add_argument("--user", default="admin", help="Citadel username")
    parser.add_argument("--password", default="Khal", help="Citadel password")
    args = parser.parse_args()

    print(f"Eye Bridge starting")
    print(f"  Citadel: {args.citadel}")
    print(f"  Log:     {args.log}")

    # Get JWT
    print("Authenticating...", end=" ")
    token = get_token(args.citadel, args.user, args.password)
    token_time = time.time()
    print("OK")

    sent = 0
    skipped = 0

    print("Tailing eye.log for CLASSIFY events...")
    for line in tail_file(args.log):
        # Refresh token every 20 min
        if time.time() - token_time > 1200:
            try:
                token = get_token(args.citadel, args.user, args.password)
                token_time = time.time()
            except Exception as e:
                print(f"Token refresh failed: {e}", file=sys.stderr)

        event = parse_event(line, "")
        if not event:
            continue

        # Skip BENIGN with very high confidence (noise from admin SSH)
        if event["category"] == "BENIGN" and event["confidence"] > 0.95:
            skipped += 1
            if skipped % 50 == 0:
                print(f"  (skipped {skipped} high-confidence BENIGN)")
            continue

        try:
            ok = post_event(args.citadel, token, event)
        except urllib.error.HTTPError:
            # Token expired
            token = get_token(args.citadel, args.user, args.password)
            token_time = time.time()
            ok = post_event(args.citadel, token, event)

        sent += 1
        ts = datetime.now().strftime("%H:%M:%S")
        status = "✓" if ok else "✗"
        print(f"[{ts}] #{sent} {event['category']} {event['sourceIp']} → {event['destIp']} (conf={event['confidence']:.3f}) {status}")


if __name__ == "__main__":
    main()
