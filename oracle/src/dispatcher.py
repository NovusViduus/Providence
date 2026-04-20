"""REST dispatcher to The Citadel + SNS for Lambda remediation."""

import json
import logging
import time
import uuid
from datetime import datetime, timezone

import boto3
import requests

from src.config import CITADEL_URL, JWT_TOKEN, SNS_TOPIC_ARN

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
BATCH_SIZE = 50

# Categories that trigger SNS → Lambda remediation
SNS_TRIGGER_CATEGORIES = {"IAM_ESCALATION", "RESOURCE_ABUSE"}
SNS_CONFIDENCE_THRESHOLD = 0.85


def dispatch_event(event: dict) -> bool:
    """Send a single classified event to Citadel via REST."""
    headers = {"Content-Type": "application/json"}
    if JWT_TOKEN:
        headers["Authorization"] = f"Bearer {JWT_TOKEN}"

    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(
                f"{CITADEL_URL}/api/v1/events/ingest",
                json=event, headers=headers, timeout=10,
            )
            if resp.status_code in (200, 201):
                return True
            logger.warning("Citadel returned %d: %s", resp.status_code, resp.text[:200])
        except requests.RequestException as e:
            logger.warning("Dispatch attempt %d failed: %s", attempt + 1, e)

        if attempt < MAX_RETRIES - 1:
            time.sleep(2 ** attempt)

    logger.error("Failed to dispatch event after %d attempts", MAX_RETRIES)
    return False


def dispatch_batch(events: list[dict]) -> int:
    """Dispatch a batch of events. Returns count of successfully dispatched."""
    success = 0
    for i in range(0, len(events), BATCH_SIZE):
        batch = events[i:i + BATCH_SIZE]
        for event in batch:
            if dispatch_event(event):
                success += 1
            # Publish to SNS for Lambda remediation on high-confidence cloud threats
            _maybe_publish_sns(event)
    logger.info("[ORACLE] Dispatched %d/%d events to Citadel", success, len(events))
    return success


def _maybe_publish_sns(event: dict) -> None:
    """Publish to SNS if event is a high-confidence cloud threat requiring Lambda remediation."""
    category = event.get("category", "")
    confidence = event.get("confidence", 0)

    if category not in SNS_TRIGGER_CATEGORIES or confidence < SNS_CONFIDENCE_THRESHOLD:
        return
    if not SNS_TOPIC_ARN:
        logger.debug("SNS_TOPIC_ARN not configured, skipping SNS publish")
        return

    try:
        sns = boto3.client("sns")
        sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=f"Providence Alert: {category}",
            Message=json.dumps(event, indent=2, default=str),
        )
        logger.info("[ORACLE] Published %s event to SNS (confidence=%.2f)", category, confidence)
    except Exception as e:
        logger.error("[ORACLE] SNS publish failed: %s", e)


def build_event(src_ip: str, dst_ip: str, dst_port: int, protocol: str,
                category: str, subcategory: str, confidence: float,
                source: str = "oracle", **extra) -> dict:
    """Build a ClassifiedEvent JSON for Citadel ingest."""
    return {
        "eventId": f"oracle-{uuid.uuid4()}",
        "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
        "sourceIp": src_ip,
        "sourcePort": 0,
        "destIp": dst_ip,
        "destPort": dst_port,
        "protocol": protocol,
        "category": category,
        "subcategory": subcategory,
        "confidence": confidence,
        "sourceComponent": source,
        **extra,
    }
