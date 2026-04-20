"""The Oracle — Cloud Agent entry point.

Polls S3 for VPC Flow Logs and CloudTrail events, classifies threats,
and dispatches to The Citadel.
"""

import argparse
import json
import logging
import time
from pathlib import Path

import boto3

from src import config
from src.ingestors import vpc_flow_logs, cloudtrail
from src.features.cloud_features import extract_flow_features
from src.classifier import classify_flow, classify_cloudtrail
from src.dispatcher import dispatch_batch, build_event

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def load_state() -> dict:
    try:
        with open(config.STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"flow_last_key": "", "trail_last_key": ""}


def save_state(state: dict):
    with open(config.STATE_FILE, "w") as f:
        json.dump(state, f)


def poll_cycle(s3_client, state: dict) -> dict:
    events_to_dispatch = []

    # VPC Flow Logs
    records, state["flow_last_key"] = vpc_flow_logs.poll_s3(
        s3_client, config.FLOW_LOG_BUCKET, config.FLOW_LOG_PREFIX, state["flow_last_key"])
    if records:
        groups = vpc_flow_logs.aggregate_flows(records)
        for g in groups:
            cls = classify_flow(g)
            if cls and cls.category != "BENIGN":
                events_to_dispatch.append(build_event(
                    g["src_addr"], g["dst_addr"], g["dst_port"],
                    "TCP" if g["protocol"] == 6 else "UDP",
                    cls.category, cls.subcategory, cls.confidence,
                    packetCount=g["total_packets"], byteCount=g["total_bytes"],
                ))

    # CloudTrail
    ct_events, state["trail_last_key"] = cloudtrail.poll_s3(
        s3_client, config.CLOUDTRAIL_BUCKET, config.CLOUDTRAIL_PREFIX, state["trail_last_key"])
    if ct_events:
        filtered = cloudtrail.filter_security_events(ct_events)
        for e in filtered:
            cls = classify_cloudtrail(e)
            if cls:
                events_to_dispatch.append(build_event(
                    e.source_ip, "", 0, "",
                    cls.category, cls.subcategory, cls.confidence,
                    ja3Hash="", flowDuration=0,
                ))

    if events_to_dispatch:
        dispatch_batch(events_to_dispatch)

    return state


def main():
    parser = argparse.ArgumentParser(description="Providence Oracle — Cloud Agent")
    parser.add_argument("--once", action="store_true", help="Run one poll cycle and exit")
    args = parser.parse_args()

    logger.info("[ORACLE] Starting — region=%s flow_bucket=%s trail_bucket=%s",
                config.AWS_REGION, config.FLOW_LOG_BUCKET, config.CLOUDTRAIL_BUCKET)

    # Graceful no-op when AWS credentials are missing
    import os
    if not os.environ.get("AWS_ACCESS_KEY_ID"):
        logger.warning("[ORACLE] No AWS credentials configured — running in no-op mode. Set AWS_ACCESS_KEY_ID to enable polling.")
        if not args.once:
            while True:
                time.sleep(60)
        return

    s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    state = load_state()

    if args.once:
        state = poll_cycle(s3_client, state)
        save_state(state)
        return

    while True:
        try:
            state = poll_cycle(s3_client, state)
            save_state(state)
        except Exception as e:
            logger.error("[ORACLE] Poll cycle error: %s", e)
        time.sleep(config.POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
