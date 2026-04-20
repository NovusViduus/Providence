# The Oracle — Cloud Agent

AWS VPC Flow Log + CloudTrail ingestion with rule-based cloud threat detection.

## Prerequisites

- AWS credentials with S3 read access to flow log and CloudTrail buckets
- VPC Flow Logs enabled → S3
- CloudTrail enabled → S3

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| AWS_REGION | us-east-1 | AWS region |
| FLOW_LOG_BUCKET | providence-flow-logs | S3 bucket for VPC Flow Logs |
| CLOUDTRAIL_BUCKET | providence-cloudtrail | S3 bucket for CloudTrail |
| CITADEL_URL | http://localhost:8080 | Citadel REST endpoint |
| PROVIDENCE_JWT | — | JWT token for Citadel auth |

## Run

```bash
cd oracle && pip install -e . && python -m src.main
```

Runs in no-op mode when AWS credentials are missing (logs warning, doesn't crash).
