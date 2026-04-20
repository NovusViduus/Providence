"""Lambda: Stop suspicious EC2 instance on RESOURCE_ABUSE detection.

Stops (not terminates) the instance — reversible action.
Tags instance as quarantined for investigation.
"""

import json
import logging
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    detail = event.get("detail", event)
    instance_id = detail.get("instanceId", "")

    if not instance_id:
        logger.error("No instanceId in event")
        return {"action": "skipped", "reason": "missing instanceId"}

    ec2 = boto3.client("ec2")

    ec2.stop_instances(InstanceIds=[instance_id])
    ec2.create_tags(Resources=[instance_id], Tags=[
        {"Key": "providence:quarantined", "Value": "true"},
        {"Key": "providence:quarantine_reason", "Value": detail.get("category", "RESOURCE_ABUSE")},
    ])

    logger.info("Stopped and quarantined instance %s", instance_id)
    return {"action": "instance_stopped", "instanceId": instance_id}
