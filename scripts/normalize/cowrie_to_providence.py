#!/usr/bin/env python3
"""
Normalize Cowrie honeypot JSON logs into Providence ML training format.

Reads Cowrie session logs from a directory tree (synced from S3) and outputs
per-session JSON files compatible with the ML pipeline's honeypot loader.

Usage:
    python3 cowrie_to_providence.py --input ~/providence/logs/ --output ./data/honeypot/

Input: Cowrie JSON logs at {instance-name}/{year}/{month}/{day}/cowrie-{timestamp}.json
Output: Per-session JSON files matching Providence's normalized schema
"""

import argparse
import json
import logging
import os
from collections import defaultdict
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Cowrie event IDs that indicate attack activity
AUTH_EVENTS = {"cowrie.login.failed", "cowrie.login.success"}
COMMAND_EVENTS = {"cowrie.command.input", "cowrie.command.failed"}
DOWNLOAD_EVENTS = {"cowrie.session.file_download", "cowrie.session.file_upload"}
SESSION_EVENTS = {"cowrie.session.connect", "cowrie.session.closed"}

# Map Cowrie activity patterns to Providence categories
def classify_session(events: list[dict]) -> str:
    """Classify a Cowrie session into a Providence category."""
    has_auth = any(e.get("eventid", "").startswith("cowrie.login") for e in events)
    has_commands = any(e.get("eventid", "").startswith("cowrie.command") for e in events)
    has_downloads = any(e.get("eventid", "").startswith("cowrie.session.file") for e in events)
    auth_count = sum(1 for e in events if e.get("eventid") in AUTH_EVENTS)

    if has_downloads:
        return "EXFILTRATION"  # downloading/uploading files = data movement
    if has_commands and has_auth:
        return "BRUTE_FORCE"   # auth attempts + post-auth commands
    if auth_count > 5:
        return "BRUTE_FORCE"   # many auth attempts
    if auth_count > 0:
        return "PROBE"         # few auth attempts = reconnaissance
    return "PROBE"             # default for connection-only sessions


def parse_cowrie_file(filepath: Path) -> list[dict]:
    """Parse a Cowrie JSON log file. Each line is a JSON object."""
    events = []
    with open(filepath, "r", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def group_by_session(events: list[dict]) -> dict[str, list[dict]]:
    """Group Cowrie events by session ID."""
    sessions = defaultdict(list)
    for e in events:
        sid = e.get("session", e.get("sessionno", "unknown"))
        sessions[str(sid)].append(e)
    # Sort each session's events by timestamp
    for sid in sessions:
        sessions[sid].sort(key=lambda e: e.get("timestamp", ""))
    return dict(sessions)


def compute_inter_attempt_ms(events: list[dict]) -> list[int]:
    """Compute milliseconds between consecutive events."""
    timestamps = []
    for e in events:
        ts = e.get("timestamp", "")
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            timestamps.append(dt.timestamp() * 1000)
        except (ValueError, AttributeError):
            continue

    if len(timestamps) < 2:
        return []

    return [int(timestamps[i] - timestamps[i - 1]) for i in range(1, len(timestamps))]


def normalize_session(session_id: str, events: list[dict], instance_name: str) -> dict:
    """Convert a Cowrie session into Providence normalized format."""
    # Extract credentials tried
    creds = []
    successes = []
    for e in events:
        if e.get("eventid") in AUTH_EVENTS:
            username = e.get("username", "")
            password = e.get("password", "")
            creds.append([username, password])
            successes.append(e.get("eventid") == "cowrie.login.success")

    # Extract commands executed
    commands = []
    for e in events:
        if e.get("eventid") in COMMAND_EVENTS:
            cmd = e.get("input", e.get("message", ""))
            if cmd:
                commands.append(cmd)

    # Compute timing
    inter_ms = compute_inter_attempt_ms(events)

    # Session duration
    timestamps = []
    for e in events:
        try:
            dt = datetime.fromisoformat(e.get("timestamp", "").replace("Z", "+00:00"))
            timestamps.append(dt.timestamp())
        except (ValueError, AttributeError):
            continue

    duration = max(timestamps) - min(timestamps) if len(timestamps) >= 2 else 0

    # Source IP
    src_ip = ""
    for e in events:
        if e.get("src_ip"):
            src_ip = e["src_ip"]
            break

    return {
        "session_id": f"{instance_name}-{session_id}",
        "source": instance_name,
        "src_ip": src_ip,
        "dst_port": 22,
        "protocol": "tcp",
        "category": classify_session(events),
        "session_metadata": {
            "duration_seconds": round(duration, 2),
            "attempts_in_session": len(creds) + len(commands),
            "credentials_tried": creds,
            "successes": successes,
            "commands_executed": commands,
            "inter_attempt_ms": inter_ms,
            "cowrie_session_id": session_id,
            "instance": instance_name,
        },
    }


def process_directory(input_dir: Path, output_dir: Path):
    """Walk the Cowrie log directory tree and normalize all sessions."""
    output_dir.mkdir(parents=True, exist_ok=True)

    total_files = 0
    total_sessions = 0
    category_counts = defaultdict(int)

    # Walk: {instance-name}/{year}/{month}/{day}/cowrie-{timestamp}.json
    # Skip "honeypot-logs" directory (older aggregate that duplicates regional data)
    SKIP_DIRS = {"honeypot-logs"}

    for cowrie_file in sorted(input_dir.rglob("cowrie-*.json")):
        # Extract instance name from path
        rel = cowrie_file.relative_to(input_dir)
        instance_name = rel.parts[0] if len(rel.parts) > 1 else "unknown"

        # Skip known duplicate/aggregate directories
        if instance_name in SKIP_DIRS:
            continue

        # Skip combined JSON files at root level
        if len(rel.parts) < 3:
            continue

        events = parse_cowrie_file(cowrie_file)
        if not events:
            continue

        total_files += 1
        sessions = group_by_session(events)

        for sid, session_events in sessions.items():
            if len(session_events) < 2:
                continue  # skip trivial sessions

            normalized = normalize_session(sid, session_events, instance_name)
            category_counts[normalized["category"]] += 1

            out_path = output_dir / f"{normalized['session_id']}.json"
            with open(out_path, "w") as f:
                json.dump(normalized, f, indent=2)
            total_sessions += 1

    logger.info("Processed %d files → %d sessions", total_files, total_sessions)
    logger.info("Category distribution:")
    for cat, count in sorted(category_counts.items()):
        logger.info("  %s: %d", cat, count)


def main():
    parser = argparse.ArgumentParser(description="Normalize Cowrie logs for Providence ML pipeline")
    parser.add_argument("--input", required=True, help="Path to synced Cowrie logs (e.g., ~/providence/logs/)")
    parser.add_argument("--output", required=True, help="Output directory for normalized sessions")
    args = parser.parse_args()

    process_directory(Path(args.input), Path(args.output))


if __name__ == "__main__":
    main()
