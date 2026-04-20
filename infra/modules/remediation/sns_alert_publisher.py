"""Lambda: Publish formatted alert to SNS topic."""

import json
import logging
import os
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ALERT_TOPIC_ARN = os.environ.get("ALERT_TOPIC_ARN", "")


def handler(event, context):
    category = event.get("category", "UNKNOWN")
    sns = boto3.client("sns")

    sns.publish(
        TopicArn=ALERT_TOPIC_ARN,
        Subject=f"Providence Alert: {category}",
        Message=json.dumps(event, indent=2, default=str),
    )

    logger.info("Alert published for %s", category)
    return {"action": "alert_published", "category": category}
