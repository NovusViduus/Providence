"""Tests for cloud feature extraction and rule-based classification."""

from src.features.cloud_features import (
    extract_flow_features, extract_cloudtrail_features,
    classify_cloudtrail_event, Classification,
)
from src.ingestors.cloudtrail import CloudTrailEvent


def test_flow_features_map_to_intersection():
    group = {
        "src_addr": "203.0.113.42", "dst_addr": "10.0.1.5",
        "dst_port": 443, "protocol": 6,
        "total_packets": 100, "total_bytes": 50000,
        "start": 1620005600, "end": 1620005700,
        "accept_count": 95, "reject_count": 5, "flow_count": 10,
    }
    features = extract_flow_features(group)
    assert features["flow_duration"] == 100
    assert features["packet_count"] == 100
    assert features["total_bytes"] == 50000
    assert features["packets_per_sec"] == 1.0
    assert features["packet_count_bwd"] == 0  # unidirectional
    assert features["syn_count"] == 0  # not available from flow logs


def test_cloudtrail_features():
    events = [
        CloudTrailEvent(event_name="AttachUserPolicy", event_source="iam.amazonaws.com",
                        source_ip="1.2.3.4", read_only=False, event_time="2026-04-10T14:30:00Z"),
        CloudTrailEvent(event_name="RunInstances", event_source="ec2.amazonaws.com",
                        source_ip="1.2.3.4", read_only=False, event_time="2026-04-10T22:00:00Z"),
    ]
    features = extract_cloudtrail_features(events, "1.2.3.4")
    assert features["event_count"] == 2
    assert features["iam_event_count"] == 1
    assert features["ec2_event_count"] == 1
    assert features["off_hours"] == 1  # 22:00 is off-hours


def test_rule_iam_escalation():
    event = CloudTrailEvent(
        event_name="AttachUserPolicy",
        request_parameters={"policyArn": "arn:aws:iam::aws:policy/AdministratorAccess"},
    )
    result = classify_cloudtrail_event(event)
    assert result is not None
    assert result.category == "IAM_ESCALATION"
    assert result.confidence >= 0.9


def test_rule_resource_abuse_gpu():
    event = CloudTrailEvent(
        event_name="RunInstances",
        request_parameters={"instanceType": "p3.2xlarge"},
    )
    result = classify_cloudtrail_event(event)
    assert result is not None
    assert result.category == "RESOURCE_ABUSE"
    assert result.subcategory == "gpu_instance_launch"


def test_rule_data_exposure():
    event = CloudTrailEvent(
        event_name="PutBucketAcl",
        request_parameters={"acl": "public-read"},
    )
    result = classify_cloudtrail_event(event)
    assert result is not None
    assert result.category == "DATA_EXPOSURE"


def test_no_rule_match():
    event = CloudTrailEvent(event_name="DescribeInstances")
    result = classify_cloudtrail_event(event)
    assert result is None
