"""CloudTrail event ingestion from S3."""

import gzip
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

from src.config import SECURITY_EVENTS

logger = logging.getLogger(__name__)


@dataclass
class CloudTrailEvent:
    event_time: str = ""
    event_source: str = ""
    event_name: str = ""
    source_ip: str = ""
    user_identity_type: str = ""
    user_identity_arn: str = ""
    user_name: str = ""
    request_parameters: dict = field(default_factory=dict)
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    region: str = ""
    read_only: bool = True


def parse_cloudtrail_file(content: bytes) -> list[CloudTrailEvent]:
    """Parse a CloudTrail log file (gzipped JSON) into events."""
    try:
        text = gzip.decompress(content).decode("utf-8")
    except gzip.BadGzipFile:
        text = content.decode("utf-8")

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        logger.warning("Failed to parse CloudTrail JSON: %s", e)
        return []

    records = data.get("Records", [])
    events = []
    for r in records:
        try:
            identity = r.get("userIdentity", {})
            events.append(CloudTrailEvent(
                event_time=r.get("eventTime", ""),
                event_source=r.get("eventSource", ""),
                event_name=r.get("eventName", ""),
                source_ip=r.get("sourceIPAddress", ""),
                user_identity_type=identity.get("type", ""),
                user_identity_arn=identity.get("arn", ""),
                user_name=identity.get("userName", ""),
                request_parameters=r.get("requestParameters") or {},
                error_code=r.get("errorCode"),
                error_message=r.get("errorMessage"),
                region=r.get("awsRegion", ""),
                read_only=r.get("readOnly", True),
            ))
        except Exception as e:
            logger.warning("Failed to parse CloudTrail record: %s", e)

    return events


def filter_security_events(events: list[CloudTrailEvent]) -> list[CloudTrailEvent]:
    """Keep only security-relevant events."""
    filtered = []
    for e in events:
        if e.event_name in SECURITY_EVENTS:
            filtered.append(e)
        elif not e.read_only and e.event_source in ("iam.amazonaws.com", "ec2.amazonaws.com", "s3.amazonaws.com"):
            filtered.append(e)
    logger.info("[ORACLE] Filtered %d/%d CloudTrail events as security-relevant", len(filtered), len(events))
    return filtered


def poll_s3(s3_client, bucket: str, prefix: str, last_key: str = "") -> tuple[list[CloudTrailEvent], str]:
    """Poll S3 for new CloudTrail log files."""
    all_events = []
    new_last_key = last_key

    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key <= last_key or not key.endswith(".json.gz"):
                continue
            try:
                response = s3_client.get_object(Bucket=bucket, Key=key)
                content = response["Body"].read()
                events = parse_cloudtrail_file(content)
                all_events.extend(events)
                new_last_key = max(new_last_key, key)
            except Exception as e:
                logger.error("Failed to process %s: %s", key, e)

    logger.info("[ORACLE] Processed %d CloudTrail events from S3", len(all_events))
    return all_events, new_last_key
