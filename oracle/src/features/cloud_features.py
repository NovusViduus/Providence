"""Cloud-specific feature extraction and rule-based classification.

VPC Flow Log features map to INTERSECTION_FEATURES where possible.
CloudTrail features use a separate schema + rule-based classification.

Limitation: VPC Flow Logs have far fewer features than The Eye's packet capture.
No flags, window sizes, entropy, or JA3 available. Model works but with reduced
discriminative power compared to local packet capture.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from src.ingestors.cloudtrail import CloudTrailEvent

logger = logging.getLogger(__name__)


@dataclass
class Classification:
    category: str
    subcategory: str
    confidence: float


def extract_flow_features(flow_group: dict) -> dict:
    """Extract INTERSECTION_FEATURES-compatible features from an aggregated VPC flow group.

    Note: VPC Flow Logs are unidirectional — packet_count_bwd and bytes_bwd are always 0.
    Flag counts, window sizes, entropy, and JA3 are not available from flow logs.
    """
    duration = max(flow_group["end"] - flow_group["start"], 1)
    packets = flow_group["total_packets"]
    total_bytes = flow_group["total_bytes"]

    return {
        "flow_duration": duration,
        "packet_count_fwd": packets,
        "packet_count_bwd": 0,  # flow logs are unidirectional
        "bytes_fwd": total_bytes,
        "bytes_bwd": 0,
        "packets_per_sec": packets / duration,
        "bytes_per_sec": total_bytes / duration,
        "syn_count": 0, "ack_count": 0, "fin_count": 0,
        "rst_count": 0, "psh_count": 0, "urg_count": 0,
        "payload_size_mean": total_bytes / max(packets, 1),
        "packet_count": packets,
        "total_bytes": total_bytes,
        # Metadata (not model features)
        "_src_addr": flow_group["src_addr"],
        "_dst_addr": flow_group["dst_addr"],
        "_dst_port": flow_group["dst_port"],
        "_protocol": flow_group["protocol"],
    }


def extract_cloudtrail_features(events: list[CloudTrailEvent], source_ip: str) -> dict:
    """Extract CloudTrail features aggregated per source IP."""
    ip_events = [e for e in events if e.source_ip == source_ip]
    if not ip_events:
        return {}

    event_names = [e.event_name for e in ip_events]
    error_count = sum(1 for e in ip_events if e.error_code)
    write_count = sum(1 for e in ip_events if not e.read_only)

    return {
        "event_count": len(ip_events),
        "unique_event_names": len(set(event_names)),
        "iam_event_count": sum(1 for e in ip_events if "iam" in e.event_source),
        "ec2_event_count": sum(1 for e in ip_events if "ec2" in e.event_source),
        "s3_event_count": sum(1 for e in ip_events if "s3" in e.event_source),
        "error_count": error_count,
        "error_ratio": error_count / len(ip_events) if ip_events else 0,
        "write_event_ratio": write_count / len(ip_events) if ip_events else 0,
        "unique_resources": len(set(str(e.request_parameters) for e in ip_events)),
        "off_hours": 1 if any(_is_off_hours(e.event_time) for e in ip_events) else 0,
        "privilege_escalation_signals": sum(
            1 for e in ip_events if e.event_name in ("AttachUserPolicy", "CreateAccessKey", "AssumeRole")
        ),
        "resource_creation_signals": sum(
            1 for e in ip_events if e.event_name in ("RunInstances", "CreateBucket", "CreateFunction")
        ),
    }


def _is_off_hours(event_time: str) -> bool:
    """Check if event is outside 08:00-18:00 UTC."""
    try:
        hour = int(event_time[11:13])
        return hour < 8 or hour >= 18
    except (ValueError, IndexError):
        return False


def classify_cloudtrail_event(event: CloudTrailEvent) -> Optional[Classification]:
    """Rule-based classification for CloudTrail events.

    Rules fire first. If no rule matches, returns None (caller falls back to ML).
    """
    params = str(event.request_parameters)

    # IAM_ESCALATION rules
    if event.event_name == "AttachUserPolicy" and "AdministratorAccess" in params:
        return Classification("IAM_ESCALATION", "admin_policy_attachment", 0.95)
    if event.event_name == "CreateAccessKey" and event.user_name:
        return Classification("IAM_ESCALATION", "access_key_creation", 0.85)
    if event.event_name == "AssumeRole" and "cross-account" in params.lower():
        return Classification("IAM_ESCALATION", "cross_account_assume_role", 0.90)
    if event.event_name == "PutUserPolicy":
        return Classification("IAM_ESCALATION", "inline_policy_attachment", 0.85)

    # RESOURCE_ABUSE rules
    if event.event_name == "RunInstances":
        instance_type = event.request_parameters.get("instanceType", "")
        if isinstance(instance_type, str) and (instance_type.startswith("p") or instance_type.startswith("g")):
            return Classification("RESOURCE_ABUSE", "gpu_instance_launch", 0.85)
        return Classification("RESOURCE_ABUSE", "instance_launch", 0.70)

    # DATA_EXPOSURE rules
    if event.event_name == "PutBucketAcl" and "public" in params.lower():
        return Classification("DATA_EXPOSURE", "bucket_public_access", 0.95)
    if event.event_name == "PutBucketPolicy" and ("*" in params or "public" in params.lower()):
        return Classification("DATA_EXPOSURE", "bucket_policy_wildcard", 0.90)
    if event.event_name == "DeleteBucketPolicy":
        return Classification("DATA_EXPOSURE", "bucket_policy_deletion", 0.80)

    return None
