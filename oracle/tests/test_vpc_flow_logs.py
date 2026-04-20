"""Tests for VPC Flow Log parsing and aggregation."""

from pathlib import Path
from src.ingestors.vpc_flow_logs import parse_flow_log_line, parse_flow_log_file, aggregate_flows

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_valid_line():
    line = "2 123456789012 eni-abc12345 203.0.113.42 10.0.1.5 56789 443 6 25 1500 1620005610 1620005670 ACCEPT OK"
    record = parse_flow_log_line(line)
    assert record is not None
    assert record.src_addr == "203.0.113.42"
    assert record.dst_addr == "10.0.1.5"
    assert record.dst_port == 443
    assert record.protocol == 6
    assert record.packets == 25
    assert record.bytes == 1500
    assert record.action == "ACCEPT"
    assert record.log_status == "OK"


def test_parse_malformed_line():
    record = parse_flow_log_line("this is not a flow log")
    assert record is None


def test_parse_nodata_line():
    record = parse_flow_log_line("2 123456789012 eni-abc12345 - - - - - - - - - - NODATA")
    # Should parse but with dashes → 0 values
    assert record is None  # too few valid fields


def test_parse_file():
    content = (FIXTURES / "sample_flow_log.txt").read_bytes()
    records = parse_flow_log_file(content)
    # Header skipped, NODATA skipped, 4 OK records
    assert len(records) == 4


def test_aggregation_filters_internal():
    content = (FIXTURES / "sample_flow_log.txt").read_bytes()
    records = parse_flow_log_file(content)
    groups = aggregate_flows(records, filter_internal=True)
    # Internal-to-internal (10.0.1.5 → 10.0.1.6) should be filtered
    internal = [g for g in groups if g["src_addr"].startswith("10.") and g["dst_addr"].startswith("10.")]
    assert len(internal) == 0


def test_aggregation_groups_correctly():
    content = (FIXTURES / "sample_flow_log.txt").read_bytes()
    records = parse_flow_log_file(content)
    groups = aggregate_flows(records, filter_internal=True)
    # Should have groups for external → internal flows
    assert len(groups) >= 2
    for g in groups:
        assert g["total_packets"] > 0
        assert g["total_bytes"] > 0
