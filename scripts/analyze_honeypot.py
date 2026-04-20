#!/usr/bin/env python3
"""
Providence Honeypot Data Deep Analysis

Comprehensive analysis of normalized honeypot session data.
Produces detailed statistics, timing analysis, attacker profiling,
credential analysis, command analysis, and geographic breakdown.

Usage:
    python3 scripts/analyze_honeypot.py --input ./data/honeypot/
    python3 scripts/analyze_honeypot.py --input ./data/honeypot/ --output ./analysis_report.txt
"""

import argparse
import json
import logging
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean, median, stdev

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)


def load_sessions(data_dir: Path) -> list[dict]:
    """Load all normalized session JSON files."""
    sessions = []
    files = sorted(data_dir.glob("*.json"))
    log.info("Loading %d session files from %s...", len(files), data_dir)
    for f in files:
        try:
            with open(f) as fh:
                sessions.append(json.load(fh))
        except (json.JSONDecodeError, OSError):
            continue
    log.info("Loaded %d sessions", len(sessions))
    return sessions


def safe_stats(values: list) -> dict:
    """Compute stats safely handling empty lists."""
    if not values:
        return {"count": 0, "mean": 0, "median": 0, "min": 0, "max": 0, "stdev": 0}
    v = [x for x in values if x is not None and x == x]  # filter NaN
    if not v:
        return {"count": 0, "mean": 0, "median": 0, "min": 0, "max": 0, "stdev": 0}
    return {
        "count": len(v),
        "mean": round(mean(v), 2),
        "median": round(median(v), 2),
        "min": round(min(v), 2),
        "max": round(max(v), 2),
        "stdev": round(stdev(v), 2) if len(v) > 1 else 0,
    }


def section(title: str) -> str:
    return f"\n{'='*80}\n  {title}\n{'='*80}\n"


def analyze(sessions: list[dict]) -> str:
    """Run full analysis and return formatted report."""
    out = []
    out.append(section("PROVIDENCE HONEYPOT DATA ANALYSIS"))
    out.append(f"  Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    out.append(f"  Total sessions analyzed: {len(sessions):,}")

    meta = [s.get("session_metadata", {}) for s in sessions]

    # =========================================================================
    # 1. OVERVIEW
    # =========================================================================
    out.append(section("1. SESSION OVERVIEW"))

    categories = Counter(s.get("category", "UNKNOWN") for s in sessions)
    out.append("  Category Distribution:")
    for cat, count in categories.most_common():
        pct = count / len(sessions) * 100
        bar = "█" * int(pct / 2)
        out.append(f"    {cat:<20} {count:>10,}  ({pct:5.1f}%)  {bar}")

    sources = Counter(s.get("source", "unknown") for s in sessions)
    out.append("\n  By Honeypot Instance:")
    for src, count in sources.most_common():
        pct = count / len(sessions) * 100
        out.append(f"    {src:<30} {count:>10,}  ({pct:5.1f}%)")

    protocols = Counter(s.get("protocol", "unknown") for s in sessions)
    out.append("\n  By Protocol:")
    for proto, count in protocols.most_common():
        out.append(f"    {proto:<10} {count:>10,}")

    ports = Counter(s.get("dst_port", 0) for s in sessions)
    out.append("\n  By Destination Port (top 10):")
    for port, count in ports.most_common(10):
        out.append(f"    {port:<10} {count:>10,}")

    # =========================================================================
    # 2. TIMING ANALYSIS
    # =========================================================================
    out.append(section("2. TIMING ANALYSIS"))

    durations = [m.get("duration_seconds", 0) for m in meta if m.get("duration_seconds")]
    dur_stats = safe_stats(durations)
    out.append(f"  Session Duration (seconds):")
    out.append(f"    Mean:   {dur_stats['mean']:>10.1f}s")
    out.append(f"    Median: {dur_stats['median']:>10.1f}s")
    out.append(f"    Min:    {dur_stats['min']:>10.1f}s")
    out.append(f"    Max:    {dur_stats['max']:>10.1f}s")
    out.append(f"    Stdev:  {dur_stats['stdev']:>10.1f}s")

    # Duration buckets
    dur_buckets = Counter()
    for d in durations:
        if d < 1: dur_buckets["< 1s"] += 1
        elif d < 5: dur_buckets["1-5s"] += 1
        elif d < 30: dur_buckets["5-30s"] += 1
        elif d < 60: dur_buckets["30-60s"] += 1
        elif d < 300: dur_buckets["1-5min"] += 1
        elif d < 3600: dur_buckets["5-60min"] += 1
        else: dur_buckets["> 1hr"] += 1
    out.append("\n  Duration Distribution:")
    for bucket in ["< 1s", "1-5s", "5-30s", "30-60s", "1-5min", "5-60min", "> 1hr"]:
        count = dur_buckets.get(bucket, 0)
        pct = count / max(len(durations), 1) * 100
        bar = "█" * int(pct / 2)
        out.append(f"    {bucket:<10} {count:>10,}  ({pct:5.1f}%)  {bar}")

    # Inter-attempt timing (THE key ML signal)
    all_inter = []
    for m in meta:
        ia = m.get("inter_attempt_ms", [])
        if ia:
            all_inter.extend(ia)

    if all_inter:
        ia_stats = safe_stats(all_inter)
        out.append(f"\n  Inter-Attempt Timing (milliseconds) — {len(all_inter):,} intervals:")
        out.append(f"    Mean:   {ia_stats['mean']:>10.1f}ms")
        out.append(f"    Median: {ia_stats['median']:>10.1f}ms")
        out.append(f"    Min:    {ia_stats['min']:>10.1f}ms")
        out.append(f"    Max:    {ia_stats['max']:>10.1f}ms")
        out.append(f"    Stdev:  {ia_stats['stdev']:>10.1f}ms")

        # Timing buckets — this is where you see bot vs human patterns
        timing_buckets = Counter()
        for t in all_inter:
            if t < 10: timing_buckets["< 10ms (instant)"] += 1
            elif t < 100: timing_buckets["10-100ms (fast bot)"] += 1
            elif t < 500: timing_buckets["100-500ms (bot)"] += 1
            elif t < 1000: timing_buckets["500ms-1s (slow bot)"] += 1
            elif t < 3000: timing_buckets["1-3s (human/LLM)"] += 1
            elif t < 10000: timing_buckets["3-10s (human)"] += 1
            else: timing_buckets["> 10s (idle)"] += 1
        out.append("\n  Timing Distribution (bot vs human signal):")
        for bucket in ["< 10ms (instant)", "10-100ms (fast bot)", "100-500ms (bot)",
                       "500ms-1s (slow bot)", "1-3s (human/LLM)", "3-10s (human)", "> 10s (idle)"]:
            count = timing_buckets.get(bucket, 0)
            pct = count / max(len(all_inter), 1) * 100
            bar = "█" * int(pct / 2)
            out.append(f"    {bucket:<25} {count:>12,}  ({pct:5.1f}%)  {bar}")

        # Per-session timing regularity (coefficient of variation)
        cvs = []
        for m in meta:
            ia = m.get("inter_attempt_ms", [])
            if len(ia) >= 3:
                m_val = mean(ia)
                if m_val > 0:
                    cvs.append(stdev(ia) / m_val)
        if cvs:
            cv_stats = safe_stats(cvs)
            out.append(f"\n  Per-Session Timing Regularity (CV = stdev/mean):")
            out.append(f"    Mean CV:   {cv_stats['mean']:.3f}  (lower = more mechanical/regular)")
            out.append(f"    Median CV: {cv_stats['median']:.3f}")
            low_cv = sum(1 for c in cvs if c < 0.3)
            high_cv = sum(1 for c in cvs if c > 1.0)
            out.append(f"    Sessions with CV < 0.3 (very regular): {low_cv:,} ({low_cv/len(cvs)*100:.1f}%)")
            out.append(f"    Sessions with CV > 1.0 (very irregular): {high_cv:,} ({high_cv/len(cvs)*100:.1f}%)")

    # =========================================================================
    # 3. ATTACKER PROFILING
    # =========================================================================
    out.append(section("3. ATTACKER PROFILING"))

    ips = Counter(s.get("src_ip", "") for s in sessions if s.get("src_ip"))
    out.append(f"  Unique Source IPs: {len(ips):,}")
    out.append(f"\n  Top 30 Most Active Attackers:")
    out.append(f"    {'IP':<20} {'Sessions':>10} {'% of Total':>10}")
    out.append(f"    {'-'*20} {'-'*10} {'-'*10}")
    for ip, count in ips.most_common(30):
        pct = count / len(sessions) * 100
        out.append(f"    {ip:<20} {count:>10,} {pct:>9.2f}%")

    # Sessions per IP distribution
    sessions_per_ip = list(ips.values())
    spi_stats = safe_stats(sessions_per_ip)
    out.append(f"\n  Sessions Per IP:")
    out.append(f"    Mean:   {spi_stats['mean']:.1f}")
    out.append(f"    Median: {spi_stats['median']:.1f}")
    out.append(f"    Max:    {spi_stats['max']:.0f}")
    one_shot = sum(1 for c in sessions_per_ip if c == 1)
    repeat = sum(1 for c in sessions_per_ip if c > 10)
    heavy = sum(1 for c in sessions_per_ip if c > 100)
    out.append(f"    One-shot IPs (1 session):  {one_shot:,} ({one_shot/len(ips)*100:.1f}%)")
    out.append(f"    Repeat IPs (>10 sessions): {repeat:,} ({repeat/len(ips)*100:.1f}%)")
    out.append(f"    Heavy hitters (>100):       {heavy:,} ({heavy/len(ips)*100:.1f}%)")

    # Per-IP category breakdown for top attackers
    ip_categories = defaultdict(lambda: Counter())
    for s in sessions:
        ip = s.get("src_ip", "")
        cat = s.get("category", "")
        if ip and cat:
            ip_categories[ip][cat] += 1

    out.append(f"\n  Top 10 Attackers — Category Breakdown:")
    for ip, _ in ips.most_common(10):
        cats = ip_categories[ip]
        cat_str = ", ".join(f"{c}:{n}" for c, n in cats.most_common())
        out.append(f"    {ip:<20} {cat_str}")

    # =========================================================================
    # 4. CREDENTIAL ANALYSIS
    # =========================================================================
    out.append(section("4. CREDENTIAL ANALYSIS"))

    all_usernames = Counter()
    all_passwords = Counter()
    all_combos = Counter()
    sessions_with_creds = 0
    total_attempts = 0
    success_count = 0

    for m in meta:
        creds = m.get("credentials_tried", [])
        successes = m.get("successes", [])
        if creds:
            sessions_with_creds += 1
            total_attempts += len(creds)
            for i, (u, p) in enumerate(creds):
                all_usernames[u] += 1
                all_passwords[p] += 1
                all_combos[f"{u}:{p}"] += 1
                if i < len(successes) and successes[i]:
                    success_count += 1

    out.append(f"  Sessions with credential attempts: {sessions_with_creds:,}")
    out.append(f"  Total auth attempts: {total_attempts:,}")
    out.append(f"  Successful logins: {success_count:,} ({success_count/max(total_attempts,1)*100:.2f}%)")
    out.append(f"  Unique usernames: {len(all_usernames):,}")
    out.append(f"  Unique passwords: {len(all_passwords):,}")
    out.append(f"  Unique combos: {len(all_combos):,}")

    out.append(f"\n  Top 30 Usernames:")
    out.append(f"    {'Username':<30} {'Count':>10} {'%':>8}")
    out.append(f"    {'-'*30} {'-'*10} {'-'*8}")
    for u, c in all_usernames.most_common(30):
        out.append(f"    {u:<30} {c:>10,} {c/total_attempts*100:>7.2f}%")

    out.append(f"\n  Top 30 Passwords:")
    out.append(f"    {'Password':<30} {'Count':>10} {'%':>8}")
    out.append(f"    {'-'*30} {'-'*10} {'-'*8}")
    for p, c in all_passwords.most_common(30):
        display = p[:28] + ".." if len(p) > 30 else p
        out.append(f"    {display:<30} {c:>10,} {c/total_attempts*100:>7.2f}%")

    out.append(f"\n  Top 20 Username:Password Combos:")
    for combo, c in all_combos.most_common(20):
        out.append(f"    {combo:<40} {c:>10,}")

    # Password complexity analysis
    pw_lengths = [len(p) for p in all_passwords.elements()]
    if pw_lengths:
        pw_stats = safe_stats(pw_lengths)
        out.append(f"\n  Password Length Distribution:")
        out.append(f"    Mean:   {pw_stats['mean']:.1f} chars")
        out.append(f"    Median: {pw_stats['median']:.1f} chars")
        out.append(f"    Min:    {pw_stats['min']:.0f} chars")
        out.append(f"    Max:    {pw_stats['max']:.0f} chars")

    has_upper = sum(1 for p in all_passwords if any(c.isupper() for c in p))
    has_digit = sum(1 for p in all_passwords if any(c.isdigit() for c in p))
    has_special = sum(1 for p in all_passwords if any(not c.isalnum() for c in p))
    total_pw = len(all_passwords)
    out.append(f"\n  Password Complexity (unique passwords):")
    out.append(f"    Contains uppercase: {has_upper:,} ({has_upper/max(total_pw,1)*100:.1f}%)")
    out.append(f"    Contains digits:    {has_digit:,} ({has_digit/max(total_pw,1)*100:.1f}%)")
    out.append(f"    Contains special:   {has_special:,} ({has_special/max(total_pw,1)*100:.1f}%)")

    # =========================================================================
    # 5. COMMAND ANALYSIS (Post-Auth Sessions)
    # =========================================================================
    out.append(section("5. COMMAND ANALYSIS (Post-Auth Sessions)"))

    all_commands = Counter()
    sessions_with_cmds = 0
    cmds_per_session = []

    for m in meta:
        cmds = m.get("commands_executed", [])
        if cmds:
            sessions_with_cmds += 1
            cmds_per_session.append(len(cmds))
            for cmd in cmds:
                # Normalize: take first word as the command
                base = cmd.strip().split()[0] if cmd.strip() else cmd
                all_commands[base] += 1

    out.append(f"  Sessions with post-auth commands: {sessions_with_cmds:,}")
    if cmds_per_session:
        cmd_stats = safe_stats(cmds_per_session)
        out.append(f"  Commands per session: mean={cmd_stats['mean']:.1f}, median={cmd_stats['median']:.1f}, max={cmd_stats['max']:.0f}")

    out.append(f"\n  Top 40 Commands (base command):")
    out.append(f"    {'Command':<30} {'Count':>10}")
    out.append(f"    {'-'*30} {'-'*10}")
    for cmd, c in all_commands.most_common(40):
        display = cmd[:28] + ".." if len(cmd) > 30 else cmd
        out.append(f"    {display:<30} {c:>10,}")

    # Command categories
    recon_cmds = {"uname", "whoami", "id", "cat", "ls", "find", "ps", "netstat", "ifconfig", "ip", "env", "hostname", "pwd", "w", "uptime"}
    download_cmds = {"wget", "curl", "scp", "ftp", "tftp"}
    persist_cmds = {"crontab", "chmod", "chown", "useradd", "adduser", "passwd"}
    lateral_cmds = {"ssh", "scp", "telnet", "nc", "ncat"}
    destruct_cmds = {"rm", "dd", "mkfs", "kill", "pkill", "shutdown", "reboot"}

    def categorize_commands(commands: Counter) -> dict:
        cats = {"recon": 0, "download": 0, "persistence": 0, "lateral": 0, "destructive": 0, "other": 0}
        for cmd, count in commands.items():
            if cmd in recon_cmds: cats["recon"] += count
            elif cmd in download_cmds: cats["download"] += count
            elif cmd in persist_cmds: cats["persistence"] += count
            elif cmd in lateral_cmds: cats["lateral"] += count
            elif cmd in destruct_cmds: cats["destructive"] += count
            else: cats["other"] += count
        return cats

    cmd_cats = categorize_commands(all_commands)
    total_cmds = sum(cmd_cats.values())
    out.append(f"\n  Command Categories:")
    for cat, count in sorted(cmd_cats.items(), key=lambda x: -x[1]):
        pct = count / max(total_cmds, 1) * 100
        out.append(f"    {cat:<15} {count:>10,}  ({pct:5.1f}%)")

    # =========================================================================
    # 6. PER-INSTANCE BREAKDOWN
    # =========================================================================
    out.append(section("6. PER-INSTANCE BREAKDOWN"))

    by_instance = defaultdict(list)
    for s in sessions:
        inst = s.get("source", "unknown")
        by_instance[inst].append(s)

    for inst, inst_sessions in sorted(by_instance.items()):
        out.append(f"\n  --- {inst} ({len(inst_sessions):,} sessions) ---")
        inst_cats = Counter(s.get("category", "") for s in inst_sessions)
        for cat, count in inst_cats.most_common():
            out.append(f"    {cat:<20} {count:>10,}")
        inst_ips = len(set(s.get("src_ip", "") for s in inst_sessions))
        out.append(f"    Unique IPs: {inst_ips:,}")
        inst_durations = [s.get("session_metadata", {}).get("duration_seconds", 0) for s in inst_sessions]
        inst_durations = [d for d in inst_durations if d]
        if inst_durations:
            out.append(f"    Avg duration: {mean(inst_durations):.1f}s")

    # =========================================================================
    # 7. ATTEMPTS PER SESSION ANALYSIS
    # =========================================================================
    out.append(section("7. SESSION SIZE ANALYSIS"))

    attempts = [m.get("attempts_in_session", 0) for m in meta]
    att_stats = safe_stats(attempts)
    out.append(f"  Attempts Per Session:")
    out.append(f"    Mean:   {att_stats['mean']:.1f}")
    out.append(f"    Median: {att_stats['median']:.1f}")
    out.append(f"    Min:    {att_stats['min']:.0f}")
    out.append(f"    Max:    {att_stats['max']:.0f}")

    att_buckets = Counter()
    for a in attempts:
        if a == 0: att_buckets["0 (connect only)"] += 1
        elif a <= 3: att_buckets["1-3"] += 1
        elif a <= 10: att_buckets["4-10"] += 1
        elif a <= 50: att_buckets["11-50"] += 1
        elif a <= 200: att_buckets["51-200"] += 1
        else: att_buckets["> 200"] += 1
    out.append("\n  Attempts Distribution:")
    for bucket in ["0 (connect only)", "1-3", "4-10", "11-50", "51-200", "> 200"]:
        count = att_buckets.get(bucket, 0)
        pct = count / max(len(attempts), 1) * 100
        bar = "█" * int(pct / 2)
        out.append(f"    {bucket:<20} {count:>10,}  ({pct:5.1f}%)  {bar}")

    # =========================================================================
    # 8. ML READINESS SUMMARY
    # =========================================================================
    out.append(section("8. ML TRAINING READINESS"))

    sessions_with_timing = sum(1 for m in meta if len(m.get("inter_attempt_ms", [])) >= 3)
    sessions_with_creds_ml = sum(1 for m in meta if len(m.get("credentials_tried", [])) >= 2)
    sessions_with_cmds_ml = sum(1 for m in meta if len(m.get("commands_executed", [])) >= 1)

    out.append(f"  Sessions with ≥3 timing intervals (usable for sequence models): {sessions_with_timing:,}")
    out.append(f"  Sessions with ≥2 credentials (usable for credential analysis):  {sessions_with_creds_ml:,}")
    out.append(f"  Sessions with ≥1 command (usable for command analysis):          {sessions_with_cmds_ml:,}")
    out.append(f"  Total usable for INTERSECTION_FEATURES training:                 {sessions_with_timing:,}")
    out.append(f"")
    out.append(f"  Category balance for training:")
    for cat, count in categories.most_common():
        out.append(f"    {cat:<20} {count:>10,}  {'⚠ DOMINANT' if count/len(sessions) > 0.5 else '✓ OK'}")
    out.append(f"")
    out.append(f"  Recommendation: Use class_weight='balanced' or undersample BRUTE_FORCE")
    out.append(f"  to prevent the model from predicting BRUTE_FORCE for everything.")

    return "\n".join(out)


def main():
    parser = argparse.ArgumentParser(description="Providence Honeypot Data Deep Analysis")
    parser.add_argument("--input", required=True, help="Path to normalized session JSONs")
    parser.add_argument("--output", default=None, help="Save report to file (default: stdout)")
    args = parser.parse_args()

    sessions = load_sessions(Path(args.input))
    if not sessions:
        print("No sessions found. Run cowrie_to_providence.py first.")
        sys.exit(1)

    report = analyze(sessions)

    if args.output:
        with open(args.output, "w") as f:
            f.write(report)
        log.info("Report saved to %s", args.output)
    else:
        print(report)


if __name__ == "__main__":
    main()
