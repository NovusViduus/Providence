"""Lambda: Revoke IAM credentials on IAM_ESCALATION detection.

Triggered by EventBridge rule or SNS → Lambda.
Deactivates the access key — reversible action.
"""

import json
import logging
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    detail = event.get("detail", event)
    user_name = detail.get("userName", "")
    access_key_id = detail.get("accessKeyId", "")

    if not user_name:
        logger.error("No userName in event")
        return {"action": "skipped", "reason": "missing userName"}

    iam = boto3.client("iam")

    if access_key_id:
        iam.update_access_key(UserName=user_name, AccessKeyId=access_key_id, Status="Inactive")
        logger.info("Deactivated key %s for user %s", access_key_id, user_name)
        return {"action": "key_deactivated", "user": user_name, "key": access_key_id}

    # If no specific key, deactivate all keys for the user
    keys = iam.list_access_keys(UserName=user_name)["AccessKeyMetadata"]
    deactivated = []
    for key in keys:
        if key["Status"] == "Active":
            iam.update_access_key(UserName=user_name, AccessKeyId=key["AccessKeyId"], Status="Inactive")
            deactivated.append(key["AccessKeyId"])

    logger.info("Deactivated %d keys for user %s", len(deactivated), user_name)
    return {"action": "keys_deactivated", "user": user_name, "keys": deactivated}
