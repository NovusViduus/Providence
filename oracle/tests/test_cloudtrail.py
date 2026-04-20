"""Tests for CloudTrail event parsing and filtering."""

import json
from pathlib import Path
from src.ingestors.cloudtrail import parse_cloudtrail_file, filter_security_events

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_cloudtrail_file():
    content = (FIXTURES / "sample_cloudtrail.json").read_bytes()
    events = parse_cloudtrail_file(content)
    assert len(events) == 3
    assert events[0].event_name == "AttachUserPolicy"
    assert events[0].source_ip == "203.0.113.42"
    assert events[0].user_name == "suspicious-user"


def test_filter_security_events():
    content = (FIXTURES / "sample_cloudtrail.json").read_bytes()
    events = parse_cloudtrail_file(content)
    filtered = filter_security_events(events)
    # AttachUserPolicy and RunInstances are security events
    # ListBuckets is read-only and not in SECURITY_EVENTS list
    names = [e.event_name for e in filtered]
    assert "AttachUserPolicy" in names
    assert "RunInstances" in names


def test_missing_fields_handled():
    content = json.dumps({"Records": [{"eventName": "TestEvent"}]}).encode()
    events = parse_cloudtrail_file(content)
    assert len(events) == 1
    assert events[0].event_name == "TestEvent"
    assert events[0].source_ip == ""
    assert events[0].user_name == ""


def test_empty_records():
    content = json.dumps({"Records": []}).encode()
    events = parse_cloudtrail_file(content)
    assert len(events) == 0
