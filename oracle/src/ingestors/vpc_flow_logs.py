"""VPC Flow Log ingestion from S3."""

import gzip
import io
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class FlowRecord:
    version: int = 2
    account_id: str = ""
    interface_id: str = ""
    src_addr: str = ""
    dst_addr: str = ""
    src_port: int = 0
    dst_port: int = 0
    protocol: int = 0
    packets: int = 0
    bytes: int = 0
    start: int = 0
    end: int = 0
    action: str = ""
    log_status: str = ""


def parse_flow_log_line(line: str) -> Optional[FlowRecord]:
    """Parse a single VPC Flow Log line into a FlowRecord."""
    parts = line.strip().split()
    if len(parts) < 14:
        logger.warning("Malformed flow log line (too few fields): %s", line[:80])
        return None
    try:
        record = FlowRecord(
            version=int(parts[0]),
            account_id=parts[1],
            interface_id=parts[2],
            src_addr=parts[3],
            dst_addr=parts[4],
            src_port=int(parts[5]) if parts[5] != "-" else 0,
            dst_port=int(parts[6]) if parts[6] != "-" else 0,
            protocol=int(parts[7]) if parts[7] != "-" else 0,
            packets=int(parts[8]) if parts[8] != "-" else 0,
            bytes=int(parts[9]) if parts[9] != "-" else 0,
            start=int(parts[10]) if parts[10] != "-" else 0,
            end=int(parts[11]) if parts[11] != "-" else 0,
            action=parts[12],
            log_status=parts[13],
        )
        return record
    except (ValueError, IndexError) as e:
        logger.warning("Failed to parse flow log line: %s — %s", line[:80], e)
        return None


def parse_flow_log_file(content: bytes) -> list[FlowRecord]:
    """Parse a flow log file (possibly gzipped) into FlowRecords."""
    try:
        text = gzip.decompress(content).decode("utf-8")
    except gzip.BadGzipFile:
        text = content.decode("utf-8")

    records = []
    for line in text.strip().split("\n"):
        if line.startswith("version") or not line.strip():
            continue  # skip header
        record = parse_flow_log_line(line)
        if record and record.log_status == "OK":
            records.append(record)
    return records


def is_internal(ip: str, cidr_prefix: str = "10.") -> bool:
    """Check if an IP is internal to the VPC."""
    return ip.startswith(cidr_prefix) or ip.startswith("172.16.") or ip.startswith("192.168.")


def aggregate_flows(records: list[FlowRecord], filter_internal: bool = True) -> list[dict]:
    """Aggregate flow records by (src, dst, dst_port, protocol) into flow groups."""
    groups: dict[tuple, dict] = {}

    for r in records:
        if filter_internal and is_internal(r.src_addr) and is_internal(r.dst_addr):
            continue

        key = (r.src_addr, r.dst_addr, r.dst_port, r.protocol)
        if key not in groups:
            groups[key] = {
                "src_addr": r.src_addr, "dst_addr": r.dst_addr,
                "dst_port": r.dst_port, "protocol": r.protocol,
                "total_packets": 0, "total_bytes": 0, "flow_count": 0,
                "start": r.start, "end": r.end,
                "accept_count": 0, "reject_count": 0,
            }
        g = groups[key]
        g["total_packets"] += r.packets
        g["total_bytes"] += r.bytes
        g["flow_count"] += 1
        g["start"] = min(g["start"], r.start)
        g["end"] = max(g["end"], r.end)
        if r.action == "ACCEPT":
            g["accept_count"] += 1
        else:
            g["reject_count"] += 1

    return list(groups.values())


def poll_s3(s3_client, bucket: str, prefix: str, last_key: str = "") -> tuple[list[FlowRecord], str]:
    """Poll S3 for new flow log files after last_key."""
    all_records = []
    new_last_key = last_key

    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key <= last_key:
                continue
            try:
                response = s3_client.get_object(Bucket=bucket, Key=key)
                content = response["Body"].read()
                records = parse_flow_log_file(content)
                all_records.extend(records)
                new_last_key = max(new_last_key, key)
            except Exception as e:
                logger.error("Failed to process %s: %s", key, e)

    logger.info("[ORACLE] Processed %d flow records from S3", len(all_records))
    return all_records, new_last_key
