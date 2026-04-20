"""Classification for cloud events — rule-based + ML fallback."""

import logging
import requests
from typing import Optional

from src.config import ML_SERVICE_URL
from src.features.cloud_features import Classification, classify_cloudtrail_event, extract_flow_features
from src.ingestors.cloudtrail import CloudTrailEvent

logger = logging.getLogger(__name__)


def classify_flow(flow_group: dict) -> Optional[Classification]:
    """Classify a VPC flow group using the ML service."""
    features = extract_flow_features(flow_group)
    # Remove metadata fields before sending to ML
    ml_features = {k: v for k, v in features.items() if not k.startswith("_")}

    try:
        resp = requests.post(f"{ML_SERVICE_URL}/ml/classify", json={"features": ml_features}, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            return Classification(data["category"], data.get("subcategory", ""), data["confidence"])
    except Exception as e:
        logger.debug("ML service unavailable for flow classification: %s", e)

    return None


def classify_cloudtrail(event: CloudTrailEvent) -> Optional[Classification]:
    """Classify a CloudTrail event — rules first, ML fallback."""
    # Rule-based classification
    result = classify_cloudtrail_event(event)
    if result:
        return result

    # ML fallback would go here if we had enough CloudTrail training data
    # For now, unmatched events are not classified
    return None
