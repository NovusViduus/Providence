"""Environment-based configuration for The Oracle."""

import os


AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
FLOW_LOG_BUCKET = os.environ.get("FLOW_LOG_BUCKET", "providence-flow-logs")
FLOW_LOG_PREFIX = os.environ.get("FLOW_LOG_PREFIX", "AWSLogs/")
CLOUDTRAIL_BUCKET = os.environ.get("CLOUDTRAIL_BUCKET", "providence-cloudtrail")
CLOUDTRAIL_PREFIX = os.environ.get("CLOUDTRAIL_PREFIX", "AWSLogs/")
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL", "60"))
CITADEL_URL = os.environ.get("CITADEL_URL", "http://localhost:8080")
ML_SERVICE_URL = os.environ.get("ML_SERVICE_URL", "http://localhost:8081")
JWT_TOKEN = os.environ.get("PROVIDENCE_JWT", "")
VPC_CIDR = os.environ.get("VPC_CIDR", "10.0.0.0/8")
STATE_FILE = os.environ.get("STATE_FILE", "/tmp/oracle_state.json")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")

SECURITY_EVENTS = [
    "AttachUserPolicy", "CreateAccessKey", "AssumeRole", "PutUserPolicy",
    "CreateUser", "AddUserToGroup", "RunInstances", "StartInstances",
    "AuthorizeSecurityGroupIngress", "ModifyInstanceAttribute",
    "PutBucketPolicy", "PutBucketAcl", "DeleteBucketPolicy",
]
