"""Behavioral feature extraction for AI_AGENT detection.

Extracts per-session features designed to capture timing, exploration,
command sequence, and adaptation patterns that distinguish LLM-guided
attacks from human/traditional bot attacks.
"""

import math
from collections import Counter

import numpy as np

AI_DETECTION_FEATURES = [
    # Timing
    "inter_attempt_mean",
    "inter_attempt_std",
    "inter_attempt_min",
    "inter_attempt_max",
    "inter_attempt_cv",
    "inter_attempt_median",
    "attempt_rate",
    "session_duration",
    # Exploration
    "unique_usernames",
    "unique_passwords",
    "credential_diversity",
    "username_entropy",
    "password_entropy",
    "success_ratio",
    # Command sequence
    "command_count",
    "unique_commands",
    "command_diversity",
    "recon_command_ratio",
    "download_attempt",
    "lateral_movement",
    "command_inter_time_mean",
    "command_inter_time_std",
    # Adaptation
    "strategy_shift_count",
    "retry_after_block",
]

RECON_COMMANDS = {"uname", "whoami", "id", "cat", "ls", "find", "ps", "netstat", "ifconfig", "ip", "env", "hostname"}
DOWNLOAD_COMMANDS = {"wget", "curl", "scp", "ftp"}
LATERAL_COMMANDS = {"ssh", "scp", "telnet", "nc", "ncat"}


def _shannon_entropy(items: list[str]) -> float:
    if not items:
        return 0.0
    counts = Counter(items)
    total = len(items)
    return -sum((c / total) * math.log2(c / total) for c in counts.values() if c > 0)


def _password_char_class(pw: str) -> str:
    has_upper = any(c.isupper() for c in pw)
    has_digit = any(c.isdigit() for c in pw)
    has_special = any(not c.isalnum() for c in pw)
    return f"{'U' if has_upper else ''}{'D' if has_digit else ''}{'S' if has_special else ''}"


def extract_features(session: dict) -> dict[str, float]:
    """Extract behavioral features from a single session JSON."""
    meta = session.get("session_metadata", {})
    inter_ms = meta.get("inter_attempt_ms", [])
    duration = meta.get("duration_seconds", 0)
    attempts = meta.get("attempts_in_session", 0)
    commands = meta.get("commands_executed", [])
    creds = meta.get("credentials_tried", [])
    successes = meta.get("successes", [])

    # Timing features
    ia = np.array(inter_ms, dtype=float) if inter_ms else np.array([0.0])
    ia_mean = float(np.mean(ia))
    ia_std = float(np.std(ia))

    features = {
        "inter_attempt_mean": ia_mean,
        "inter_attempt_std": ia_std,
        "inter_attempt_min": float(np.min(ia)),
        "inter_attempt_max": float(np.max(ia)),
        "inter_attempt_cv": ia_std / ia_mean if ia_mean > 0 else 0,
        "inter_attempt_median": float(np.median(ia)),
        "attempt_rate": attempts / duration if duration > 0 else 0,
        "session_duration": duration,
    }

    # Exploration features
    usernames = [c[0] for c in creds] if creds else []
    passwords = [c[1] for c in creds] if creds else []
    features["unique_usernames"] = len(set(usernames))
    features["unique_passwords"] = len(set(passwords))
    features["credential_diversity"] = len(set(passwords)) / len(passwords) if passwords else 0
    features["username_entropy"] = _shannon_entropy(usernames)
    features["password_entropy"] = _shannon_entropy(passwords)
    features["success_ratio"] = sum(1 for s in successes if s) / len(successes) if successes else 0

    # Command sequence features
    features["command_count"] = len(commands)
    features["unique_commands"] = len(set(commands))
    features["command_diversity"] = len(set(commands)) / len(commands) if commands else 0

    recon_count = sum(1 for c in commands if c.split()[0] in RECON_COMMANDS) if commands else 0
    features["recon_command_ratio"] = recon_count / len(commands) if commands else 0
    features["download_attempt"] = 1.0 if any(c.split()[0] in DOWNLOAD_COMMANDS for c in commands if c) else 0.0
    features["lateral_movement"] = 1.0 if any(c.split()[0] in LATERAL_COMMANDS for c in commands if c) else 0.0

    # Command timing (reuse inter_attempt_ms for post-auth sessions)
    features["command_inter_time_mean"] = ia_mean
    features["command_inter_time_std"] = ia_std

    # Adaptation features
    char_classes = [_password_char_class(p) for p in passwords]
    shifts = sum(1 for i in range(1, len(char_classes)) if char_classes[i] != char_classes[i - 1])
    features["strategy_shift_count"] = shifts
    features["retry_after_block"] = 1.0 if attempts > 5 else 0.0

    return features
