"""Tests for inference server wire protocol (without actual server)."""

import struct
import numpy as np
import pytest

from src.features.schema import (
    INTERSECTION_FEATURES,
    EYE_FULL_FEATURES,
    protobuf_to_array,
)


def test_protobuf_to_array_intersection():
    """Verify feature ordering matches between schema and protobuf extraction."""
    # Create a mock protobuf-like object
    class MockFV:
        duration = 10.0
        packet_count_fwd = 5
        packet_count_bwd = 3
        bytes_fwd = 1000
        bytes_bwd = 500
        packets_per_sec = 0.8
        bytes_per_sec = 150.0
        syn_count = 1
        ack_count = 4
        fin_count = 1
        rst_count = 0
        psh_count = 2
        urg_count = 0
        payload_size_mean = 200.0
        packet_count = 8
        total_bytes = 1500
        window_size_min = 1024
        window_size_max = 65535
        window_size_mean = 32000.0
        payload_entropy_mean = 5.5
        payload_size_min = 50
        payload_size_max = 1400
        zero_payload_count = 2
        ttl = 64
        cipher_suite_count = 12
        extension_count = 8
        inter_arrival_mean = 1.2
        inter_arrival_std = 0.5
        inter_arrival_min = 0
        inter_arrival_max = 3

    fv = MockFV()
    arr = protobuf_to_array(fv, INTERSECTION_FEATURES)
    assert len(arr) == len(INTERSECTION_FEATURES)
    assert arr[0] == 10.0  # flow_duration

    arr_full = protobuf_to_array(fv, EYE_FULL_FEATURES)
    assert len(arr_full) == len(EYE_FULL_FEATURES)


def test_protobuf_to_array_syn_ack_ratio_zero_division():
    class MockFV:
        duration = 1.0
        packet_count_fwd = 1
        packet_count_bwd = 0
        bytes_fwd = 100
        bytes_bwd = 0
        packets_per_sec = 1.0
        bytes_per_sec = 100.0
        syn_count = 1
        ack_count = 0  # zero — should not divide by zero
        fin_count = 0
        rst_count = 0
        psh_count = 0
        urg_count = 0
        payload_size_mean = 100.0
        packet_count = 1
        total_bytes = 100
        window_size_min = 0
        window_size_max = 0
        window_size_mean = 0.0
        payload_entropy_mean = 0.0
        payload_size_min = 0
        payload_size_max = 0
        zero_payload_count = 0
        ttl = 64
        cipher_suite_count = 0
        extension_count = 0
        inter_arrival_mean = 0.0
        inter_arrival_std = 0.0
        inter_arrival_min = 0
        inter_arrival_max = 0

    arr = protobuf_to_array(MockFV(), EYE_FULL_FEATURES)
    # syn_ack_ratio should be 0.0, not error
    assert arr[-1] == 0.0


def test_wire_protocol_framing():
    """Verify length-prefix framing logic."""
    payload = b"test_payload_data"
    framed = struct.pack("!I", len(payload)) + payload

    # Parse it back
    length = struct.unpack("!I", framed[:4])[0]
    assert length == len(payload)
    assert framed[4:4 + length] == payload
