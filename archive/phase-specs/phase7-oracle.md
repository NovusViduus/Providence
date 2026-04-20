# Phase 7: The Oracle — Cloud Integration

> Providence Network Security Intelligence Platform
> Component: The Oracle — Python Cloud Agent + Cloud Response Infrastructure
> Timeline: Weeks 18–20
> Prerequisites: Phase 3 (ML Pipeline), Phase 4 (Response Engine), Phase 5 (The Lens)

---

## Goal

Build a Python cloud agent that ingests AWS VPC Flow Logs and CloudTrail events, extracts features, classifies threats using the existing ML models (plus three new cloud-specific categories), dispatches classified events to The Citadel via REST, and responds to cloud threats via a CloudFirewallManager (Security Groups + NACLs), Lambda remediation functions, and SNS alerts. Provision all cloud monitoring infrastructure via Terraform. Surface cloud events in The Lens alongside local events.

---

## Deliverable

Cloud-native security monitoring integrated into the Providence platform. VPC Flow Log and CloudTrail ingestion. Three new cloud attack categories (IAM_ESCALATION, RESOURCE_ABUSE, DATA_EXPOSURE). CloudFirewallManager implementation. Lambda remediation functions. SNS alerting. Terraform configs. Unified dashboard view.

---

## Context

### The Oracle's Position in the Architecture

The Oracle is the cloud equivalent of The Eye. Where The Eye captures packets on a local network, The Oracle reads cloud telemetry from S3. Where The Eye uses gRPC (high-throughput, thousands of events/sec), The Oracle uses REST (lower frequency, batch arrivals). Both feed into the same Citadel → Response → Dashboard pipeline.

### Data Sources

| Source | Format | Location | Update Frequency |
|---|---|---|---|
| VPC Flow Logs | Space-delimited text, one record per line | S3 bucket or CloudWatch Logs | ~10 minute aggregation windows |
| CloudTrail | JSON, one event per API call | S3 bucket | Near real-time (within minutes) |

### VPC Flow Log Record Format (v2)

```
version account-id interface-id srcaddr dstaddr srcport dstport protocol packets bytes start end action log-status
2 123456789012 eni-abc12345 10.0.1.5 203.0.113.42 56789 443 6 25 1500 1620005610 1620005670 ACCEPT OK
```

### CloudTrail Event Structure (key fields)

```json
{
  "eventTime": "2026-04-10T14:30:00Z",
  "eventSource": "iam.amazonaws.com",
  "eventName": "AttachUserPolicy",
  "sourceIPAddress": "203.0.113.42",
  "userIdentity": {
    "type": "IAMUser",
    "userName": "suspicious-user",
    "arn": "arn:aws:iam::123456789012:user/suspicious-user"
  },
  "requestParameters": {
    "policyArn": "arn:aws:iam::aws:policy/AdministratorAccess",
    "userName": "suspicious-user"
  },
  "responseElements": null,
  "errorCode": null
}
```

### Cloud-Specific Attack Categories

| Category | Indicators | Response |
|---|---|---|
| IAM_ESCALATION | Unusual AssumeRole, policy attachment to unauthorized users, cross-account access | Revoke credentials via Lambda |
| RESOURCE_ABUSE | Unexpected EC2 launches, GPU instances, high compute in off-hours | Terminate instances via Lambda |
| DATA_EXPOSURE | ListBucket across many buckets, mass GetObject, public access changes | Block source IP in Security Group, SNS alert |

---

## Tasks

### Task 1: Project Setup

**Requirements:**
- [ ] Initialize `oracle/` Python project with `pyproject.toml`:
  - Python ≥ 3.11
  - Dependencies: boto3, requests, pandas, schedule (or APScheduler), pytest
  - No heavy ML deps — The Oracle calls the existing ML service, doesn't run models itself
- [ ] Directory structure:
  ```
  oracle/
  ├── pyproject.toml
  ├── src/
  │   ├── __init__.py
  │   ├── main.py                  # Entry point, orchestrates polling loops
  │   ├── ingestors/
  │   │   ├── __init__.py
  │   │   ├── vpc_flow_logs.py     # S3 → parsed flow records
  │   │   └── cloudtrail.py        # S3 → parsed API events
  │   ├── features/
  │   │   ├── __init__.py
  │   │   └── cloud_features.py    # Cloud-specific feature extraction
  │   ├── classifier.py            # Calls ML service for classification
  │   ├── dispatcher.py            # REST client to Citadel
  │   └── config.py                # Environment-based configuration
  ├── tests/
  │   ├── __init__.py
  │   ├── test_vpc_flow_logs.py
  │   ├── test_cloudtrail.py
  │   └── test_cloud_features.py
  └── Dockerfile
  ```
- [ ] `config.py`:
  - AWS region, S3 bucket names, polling intervals from env vars
  - Citadel URL (default `http://localhost:8080`)
  - ML service URL for cloud classification (default `http://localhost:8081`)
  - JWT token for Citadel auth (from env var)

**Acceptance criteria:**
- `pip install -e .` succeeds
- `python -m src.main --help` prints usage

---

### Task 2: VPC Flow Log Ingestion

**Requirements:**
- [ ] `ingestors/vpc_flow_logs.py`:
  - **S3 polling mode:**
    1. List objects in configured S3 bucket/prefix (e.g., `s3://providence-flow-logs/AWSLogs/...`)
    2. Track last-processed object key in a local state file (or Redis key) to avoid reprocessing
    3. Download new log files (gzipped text)
    4. Parse each line into a structured record:
       ```python
       @dataclass
       class FlowRecord:
           version: int
           account_id: str
           interface_id: str
           src_addr: str
           dst_addr: str
           src_port: int
           dst_port: int
           protocol: int        # 6=TCP, 17=UDP, 1=ICMP
           packets: int
           bytes: int
           start: int           # Unix timestamp
           end: int
           action: str          # ACCEPT or REJECT
           log_status: str      # OK, NODATA, SKIPDATA
       ```
    5. Skip records with `log_status != "OK"` or `action == "NODATA"`
    6. Filter out internal-to-internal traffic (both src and dst in VPC CIDR range) — configurable
    7. Return list of `FlowRecord`

  - **Aggregation:**
    - Group flow records by `(src_addr, dst_addr, dst_port, protocol)` within a time window
    - Compute per-group: total packets, total bytes, flow count, duration, ACCEPT/REJECT ratio
    - This mirrors The Eye's per-flow aggregation at a coarser granularity

  - **Polling loop:**
    - Check for new S3 objects every 60 seconds (configurable)
    - Process all new objects, extract records, aggregate, classify, dispatch
    - Log: `[ORACLE] Processed {n} flow records from {m} log files`

**Acceptance criteria:**
- Given a sample VPC Flow Log file (create one in `tests/fixtures/`), parser produces correct `FlowRecord` list
- Aggregation groups records correctly
- S3 polling skips already-processed files
- Parser handles malformed lines gracefully (logs warning, skips line)

---

### Task 3: CloudTrail Ingestion

**Requirements:**
- [ ] `ingestors/cloudtrail.py`:
  - **S3 polling mode:**
    1. List objects in CloudTrail S3 bucket/prefix
    2. Track last-processed key (same pattern as VPC Flow Logs)
    3. Download and decompress (CloudTrail logs are gzipped JSON)
    4. Parse JSON: each file contains `{ "Records": [...] }`
    5. Extract relevant fields per event:
       ```python
       @dataclass
       class CloudTrailEvent:
           event_time: str
           event_source: str      # e.g., "iam.amazonaws.com", "ec2.amazonaws.com"
           event_name: str        # e.g., "AttachUserPolicy", "RunInstances"
           source_ip: str
           user_identity_type: str
           user_identity_arn: str
           user_name: str
           request_parameters: dict
           error_code: Optional[str]
           error_message: Optional[str]
           region: str
           read_only: bool
       ```

  - **Event filtering** — focus on security-relevant events:
    - IAM events: `AttachUserPolicy`, `CreateAccessKey`, `AssumeRole`, `PutUserPolicy`, `CreateUser`, `AddUserToGroup`
    - EC2 events: `RunInstances`, `StartInstances`, `AuthorizeSecurityGroupIngress`, `ModifyInstanceAttribute`
    - S3 events: `PutBucketPolicy`, `PutBucketAcl`, `DeleteBucketPolicy`, `GetObject` (high volume from single source)
    - Skip read-only events unless they're enumeration patterns (many ListBucket calls)
    - Configurable filter list in `config.py`

  - **Polling loop:** same pattern as VPC Flow Logs

**Acceptance criteria:**
- Given a sample CloudTrail JSON file (in `tests/fixtures/`), parser produces correct `CloudTrailEvent` list
- Security-relevant events are kept, noise events are filtered
- Handles missing fields gracefully

---

### Task 4: Cloud Feature Extraction

**Requirements:**
- [ ] `features/cloud_features.py`:

  **VPC Flow Log features** (per aggregated flow group):
  Map to `INTERSECTION_FEATURES` where possible so the existing ML models can classify:
  ```python
  CLOUD_FLOW_FEATURES = {
      "flow_duration":     end - start,
      "packet_count":      total_packets,
      "total_bytes":       total_bytes,
      "packets_per_sec":   packets / duration,
      "bytes_per_sec":     bytes / duration,
      "packet_count_fwd":  packets (src→dst direction),
      "packet_count_bwd":  0 (flow logs are unidirectional — document this limitation),
      "bytes_fwd":         bytes,
      "bytes_bwd":         0,
      # Flags, window size, entropy, JA3 NOT available from flow logs
      # Set to 0 — the model trained on INTERSECTION_FEATURES handles this
      "syn_count": 0, "ack_count": 0, "fin_count": 0, "rst_count": 0,
      "psh_count": 0, "urg_count": 0,
      "payload_size_mean": total_bytes / total_packets,
  }
  ```
  - **Limitation:** VPC Flow Logs have far fewer features than The Eye's packet capture. The model will work but with reduced discriminative power. Document this.

  **CloudTrail features** (per event or per source-IP aggregation):
  These don't map to network flow features — they need a separate classification approach:
  ```python
  CLOUDTRAIL_FEATURES = {
      "event_count":           total events from this source IP/user in window,
      "unique_event_names":    distinct API calls,
      "iam_event_count":       events targeting IAM service,
      "ec2_event_count":       events targeting EC2 service,
      "s3_event_count":        events targeting S3 service,
      "error_count":           events with non-null errorCode,
      "error_ratio":           error_count / event_count,
      "write_event_ratio":     non-readOnly events / total,
      "unique_resources":      distinct resource ARNs accessed,
      "off_hours":             1 if event outside 08:00-18:00 local time,
      "privilege_escalation_signals": count of AttachUserPolicy + CreateAccessKey + AssumeRole,
      "resource_creation_signals":   count of RunInstances + CreateBucket + CreateFunction,
  }
  ```

  **Rule-based cloud classification** (complement to ML):
  Some cloud threats are better detected by rules than ML because the patterns are well-defined:
  ```python
  def classify_cloudtrail_event(event: CloudTrailEvent) -> Optional[Classification]:
      # IAM_ESCALATION rules
      if event.event_name == "AttachUserPolicy" and "AdministratorAccess" in str(event.request_parameters):
          return Classification("IAM_ESCALATION", "admin_policy_attachment", 0.95)
      if event.event_name == "CreateAccessKey" and event.user_name != event.source_user:
          return Classification("IAM_ESCALATION", "cross_user_key_creation", 0.90)

      # RESOURCE_ABUSE rules
      if event.event_name == "RunInstances":
          instance_type = event.request_parameters.get("instanceType", "")
          if instance_type.startswith("p") or instance_type.startswith("g"):  # GPU instances
              return Classification("RESOURCE_ABUSE", "gpu_instance_launch", 0.85)

      # DATA_EXPOSURE rules
      if event.event_name == "PutBucketAcl" and "public" in str(event.request_parameters).lower():
          return Classification("DATA_EXPOSURE", "bucket_public_access", 0.95)

      return None  # No rule matched — pass to ML if enough features
  ```
  - Rules fire first. If no rule matches and enough features are available, fall back to ML.

**Acceptance criteria:**
- VPC Flow features map to `INTERSECTION_FEATURES` with correct field names
- CloudTrail features extract correctly from sample events
- Rule-based classifier catches obvious IAM escalation and resource abuse patterns
- Missing features documented as known limitations

---

### Task 5: Classification & Dispatch to Citadel

**Requirements:**
- [ ] `classifier.py`:
  - For VPC Flow Log features: call the existing ML inference service (same models as The Eye)
    - POST to ML service HTTP endpoint with flow features
    - Or: call the Unix socket if co-located (less likely in cloud deployment)
    - Returns `Classification(category, subcategory, confidence)`
  - For CloudTrail events: use rule-based classification first (Task 4), fall back to ML if rules don't match
  - Set `source_component = "oracle"` on all classified events

- [ ] `dispatcher.py`:
  - REST client to Citadel: `POST /api/v1/events` (or the existing gRPC endpoint if preferred)
  - **Decision: REST over gRPC.** The Oracle sends events in batches (not streaming), frequency is much lower than The Eye. REST is simpler and sufficient. The Citadel already has REST endpoints.
  - Note: The Citadel currently receives events via gRPC from The Eye. The Oracle needs either:
    - **Option A:** A new REST endpoint on Citadel: `POST /api/v1/events/ingest` that accepts a `ClassifiedEvent` JSON body and runs it through the same ResponseOrchestrator pipeline
    - **Option B:** A Python gRPC client calling the existing `EventService.ReportEvent`
    - **Recommended: Option A** — add a simple REST ingest endpoint to Citadel. Avoids Python gRPC dependency complexity.
  - Include JWT in Authorization header (Oracle authenticates as Admin)
  - Batch dispatch: send events in groups of up to 50
  - Retry on failure (3 attempts with exponential backoff)
  - Log: `[ORACLE] Dispatched {n} events to Citadel ({m} flow, {k} cloudtrail)`

- [ ] **Add to Citadel** — `POST /api/v1/events/ingest`:
  - Accepts `ClassifiedEvent` JSON body (same fields as the gRPC message)
  - Runs through the same pipeline: determine tier → persist → publish Redis → execute playbook if ACT
  - Requires ADMIN role JWT
  - Returns `{ eventId, responseTier, responseAction }`

**Acceptance criteria:**
- Oracle classifies a VPC flow record and dispatches to Citadel via REST
- Oracle classifies a CloudTrail event (rule-based) and dispatches to Citadel
- Events from Oracle appear in Citadel's PostgreSQL with `source_component = "oracle"`
- Events from Oracle appear in The Lens dashboard alongside Eye events
- Failed dispatch retries 3 times before logging error

---

### Task 6: CloudFirewallManager

**Requirements:**
- [ ] `CloudFirewallManager.java` in Citadel's `firewall/` package — implements `FirewallManager`:
  - `@ConditionalOnProperty(name = "providence.firewall.platform", havingValue = "cloud")`

  **blockIP:**
  1. Add inbound DENY rule to a dedicated Security Group (`providence-blocklist-sg`):
     `aws ec2 authorize-security-group-ingress` with source `<ip>/32`, all ports, all protocols → DENY
  2. Actually: Security Groups are allow-only. Use a NACL instead:
     - Add DENY rule to the Providence NACL: `aws ec2 create-network-acl-entry --network-acl-id <nacl-id> --rule-number <next> --protocol -1 --rule-action deny --cidr-block <ip>/32 --ingress`
     - Rule numbers: start at 100, increment by 1 for each block
     - Track used rule numbers in Redis to avoid collisions
  3. Return Result with expiry

  **rateLimit:**
  - NACLs don't support rate limiting. Document this limitation.
  - Approximate: add DENY rule (same as block) with shorter TTL
  - Or: skip rate limiting for cloud platform entirely and document

  **unblock:**
  1. Remove the NACL rule: `aws ec2 delete-network-acl-entry --network-acl-id <nacl-id> --rule-number <n> --ingress`
  2. Return Result

  **listRules:**
  1. `aws ec2 describe-network-acls --network-acl-ids <nacl-id>` → parse entries
  2. Filter for Providence-managed rules (by rule number range or tag)
  3. Return `List<Rule>`

  - Uses AWS SDK for Java v2 (`software.amazon.awssdk:ec2`)
  - Requires IAM permissions: `ec2:CreateNetworkAclEntry`, `ec2:DeleteNetworkAclEntry`, `ec2:DescribeNetworkAcls`
  - Same safety guards: IP validation, never block VPC CIDR range

**Acceptance criteria:**
- With valid AWS credentials and a test NACL, `blockIP` adds a DENY rule
- `listRules` returns Providence-managed rules
- `unblock` removes the rule
- Safety guards prevent blocking VPC internal IPs

---

### Task 7: Lambda Remediation Functions

**Requirements:**
- [ ] `infra/modules/remediation/` — Terraform module for Lambda functions:

  **`revoke_iam_credentials` Lambda (Python):**
  ```python
  # Triggered by EventBridge rule matching IAM_ESCALATION events
  # or called directly by The Oracle via SNS → Lambda
  def handler(event, context):
      user_name = event["detail"]["userName"]
      access_key_id = event["detail"]["accessKeyId"]
      iam = boto3.client("iam")
      iam.update_access_key(UserName=user_name, AccessKeyId=access_key_id, Status="Inactive")
      # Log action to CloudWatch
      return {"action": "key_deactivated", "user": user_name, "key": access_key_id}
  ```

  **`terminate_suspicious_instance` Lambda (Python):**
  ```python
  # Triggered when RESOURCE_ABUSE detected (unauthorized EC2 launch)
  def handler(event, context):
      instance_id = event["detail"]["instanceId"]
      ec2 = boto3.client("ec2")
      ec2.stop_instances(InstanceIds=[instance_id])  # Stop, not terminate — reversible
      # Tag instance as quarantined
      ec2.create_tags(Resources=[instance_id], Tags=[{"Key": "providence:quarantined", "Value": "true"}])
      return {"action": "instance_stopped", "instanceId": instance_id}
  ```

  **`sns_alert_publisher` Lambda (Python):**
  ```python
  # Generic alert publisher — formats and sends to SNS topic
  def handler(event, context):
      sns = boto3.client("sns")
      sns.publish(
          TopicArn=os.environ["ALERT_TOPIC_ARN"],
          Subject=f"Providence Alert: {event['category']}",
          Message=json.dumps(event, indent=2)
      )
      return {"action": "alert_published"}
  ```

- [ ] **Terraform resources:**
  - Lambda functions with Python 3.12 runtime
  - IAM execution roles with least-privilege policies:
    - `revoke_iam_credentials`: `iam:UpdateAccessKey`, `iam:ListAccessKeys`
    - `terminate_suspicious_instance`: `ec2:StopInstances`, `ec2:CreateTags`, `ec2:DescribeInstances`
    - `sns_alert_publisher`: `sns:Publish`
  - EventBridge rules matching Providence events (wired from SNS or direct invocation)
  - SNS topic: `providence-alerts` with email subscription (configurable)
  - CloudWatch log groups for each Lambda

- [ ] **Oracle integration:**
  - When Oracle classifies an IAM_ESCALATION event with confidence > 0.85:
    1. Dispatch to Citadel (normal flow)
    2. Publish to SNS topic `providence-alerts` (triggers Lambda for remediation)
  - The Citadel's response pipeline handles the rest (block IP, incident report)
  - Lambda functions are independent safety nets that operate even if The Citadel is down

**Acceptance criteria:**
- `terraform apply` creates Lambda functions, IAM roles, SNS topic, EventBridge rules
- `revoke_iam_credentials` Lambda can deactivate a test access key
- `terminate_suspicious_instance` Lambda can stop a test EC2 instance
- SNS topic sends email on publish
- Oracle publishes to SNS on high-confidence cloud events

---

### Task 8: Terraform Cloud Monitoring Infrastructure

**Requirements:**
- [ ] `infra/modules/monitoring/` — Terraform module:

  **VPC Flow Logs:**
  ```hcl
  resource "aws_flow_log" "providence" {
    vpc_id               = var.vpc_id
    traffic_type         = "ALL"
    log_destination      = aws_s3_bucket.flow_logs.arn
    log_destination_type = "s3"
    max_aggregation_interval = 600  # 10 minutes
  }

  resource "aws_s3_bucket" "flow_logs" {
    bucket = "providence-flow-logs-${var.account_id}"
  }
  ```

  **CloudTrail:**
  ```hcl
  resource "aws_cloudtrail" "providence" {
    name                       = "providence-trail"
    s3_bucket_name             = aws_s3_bucket.cloudtrail.id
    include_global_service_events = true
    is_multi_region_trail      = true
    enable_log_file_validation = true
  }

  resource "aws_s3_bucket" "cloudtrail" {
    bucket = "providence-cloudtrail-${var.account_id}"
  }
  ```

  **IAM roles for The Oracle:**
  ```hcl
  resource "aws_iam_role" "oracle" {
    name = "providence-oracle-role"
    # Permissions: s3:GetObject on flow log + cloudtrail buckets,
    # ec2:DescribeNetworkAcls, ec2:CreateNetworkAclEntry, ec2:DeleteNetworkAclEntry,
    # sns:Publish on alert topic
  }
  ```

- [ ] `infra/environments/monitoring/main.tf`:
  - Uses the monitoring module
  - Configurable via variables: VPC ID, account ID, alert email

**Acceptance criteria:**
- `terraform plan` shows expected resources (no apply required in CI)
- Resources include: VPC flow log, S3 buckets, CloudTrail trail, IAM role, NACL
- IAM policies are least-privilege

---

### Task 9: Dashboard — Unified View

**Requirements:**
- [ ] Update The Lens to handle `source_component = "oracle"` events:
  - AttackFeed: Oracle events show a cloud icon (lucide-react `Cloud`) alongside category badge
  - EventDetail: for Oracle events, show cloud-specific fields (VPC ID, account ID, event source)
  - StatsOverview: break down stats by source component (Eye vs Oracle)
  - ThreatMap: Oracle source IPs appear on the globe same as Eye source IPs

- [ ] New categories in the category filter: IAM_ESCALATION, RESOURCE_ABUSE, DATA_EXPOSURE
  - Color coding: IAM_ESCALATION = amber, RESOURCE_ABUSE = red, DATA_EXPOSURE = purple

- [ ] **Seed cloud playbooks** (Flyway migration in Citadel):
  - IAM_ESCALATION → BLOCK + CRITICAL_ALERT + LAMBDA_REMEDIATE, TTL 24h
  - RESOURCE_ABUSE → CRITICAL_ALERT + LAMBDA_REMEDIATE, TTL 24h
  - DATA_EXPOSURE → BLOCK + CRITICAL_ALERT, TTL 24h

**Acceptance criteria:**
- Oracle events appear in AttackFeed with cloud icon
- Cloud categories appear in category filter dropdown
- StatsOverview shows Eye vs Oracle breakdown
- Cloud playbooks seeded and matched by PlaybookEngine

---

### Task 10: Tests & CI

**Requirements:**
- [ ] `oracle/tests/test_vpc_flow_logs.py`:
  - Parse valid flow log line → correct FlowRecord
  - Parse malformed line → skipped with warning
  - Aggregation groups correctly
  - NODATA/SKIPDATA records filtered

- [ ] `oracle/tests/test_cloudtrail.py`:
  - Parse valid CloudTrail JSON → correct events
  - Security filter keeps IAM events, drops read-only noise
  - Missing fields handled gracefully

- [ ] `oracle/tests/test_cloud_features.py`:
  - VPC flow features map to INTERSECTION_FEATURES correctly
  - CloudTrail features extract correctly
  - Rule-based classifier detects IAM_ESCALATION from AttachUserPolicy event

- [ ] `.github/workflows/ci-oracle.yml`:
  ```yaml
  name: CI — Oracle
  on:
    push:
      paths: ['oracle/**']
    pull_request:
      paths: ['oracle/**']
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with:
            python-version: '3.12'
        - run: cd oracle && pip install -e '.[test]'
        - run: cd oracle && pytest tests/ -v
        - run: cd oracle && ruff check src/
  ```
  - Tests use fixture files, NOT real AWS credentials
  - No boto3 calls in tests (use mocked responses or sample files)

**Acceptance criteria:**
- `pytest oracle/tests/` passes all tests
- Tests use fixture data only, no AWS credentials needed
- CI passes on push to `oracle/`

---

## Scoped Out

| Item | Phase |
|---|---|
| Azure NSG Flow Logs | Stretch (placeholder in directory structure) |
| Kinesis real-time streaming (vs S3 polling) | Stretch enhancement |
| ECS/Fargate production deployment | Phase 9 |
| GuardDuty benchmark comparison | Phase 9 |
| Multi-account CloudTrail aggregation | Out of scope |

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────┐
│                    AWS ACCOUNT                           │
│                                                          │
│  VPC ───► Flow Logs ───► S3 ──┐                         │
│                                │                         │
│  CloudTrail ───────────► S3 ──┤                         │
│                                │                         │
│  ┌─────────────────────────────▼──────────────────────┐ │
│  │              THE ORACLE (Python)                    │ │
│  │                                                     │ │
│  │  main.py (polling loop)                            │ │
│  │  ├── vpc_flow_logs.py → parse → aggregate          │ │
│  │  ├── cloudtrail.py → parse → filter                │ │
│  │  ├── cloud_features.py → extract features          │ │
│  │  ├── classifier.py                                 │ │
│  │  │   ├── rule-based (IAM/EC2/S3 patterns)         │ │
│  │  │   └── ML fallback (existing models)             │ │
│  │  ├── dispatcher.py → REST to Citadel               │ │
│  │  └── SNS publish (high-confidence alerts)          │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │  RESPONSE INFRASTRUCTURE                            ││
│  │  ├── NACL rules ◄── CloudFirewallManager           ││
│  │  ├── Lambda: revoke_iam_credentials                ││
│  │  ├── Lambda: terminate_suspicious_instance          ││
│  │  ├── Lambda: sns_alert_publisher                   ││
│  │  ├── SNS topic: providence-alerts                  ││
│  │  └── EventBridge rules                             ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                         │ REST
                         ▼
              ┌──────────────────────┐
              │    THE CITADEL       │
              │  POST /events/ingest │
              │  → ResponseOrchestrator
              │  → PostgreSQL        │
              │  → Redis pub/sub     │
              │  → The Lens          │
              └──────────────────────┘
```

---

## Verification Checklist

When Phase 7 is complete, all of the following must be true:

- [ ] VPC Flow Logs parsed from S3, aggregated into flow records
- [ ] CloudTrail events parsed from S3, filtered for security-relevant API calls
- [ ] Cloud features extracted and mapped to classification schema
- [ ] Rule-based classifier detects IAM_ESCALATION, RESOURCE_ABUSE, DATA_EXPOSURE
- [ ] ML fallback classification works for VPC flow records
- [ ] Oracle dispatches classified events to Citadel via REST
- [ ] Events appear in The Lens with `source_component = "oracle"` and cloud icon
- [ ] CloudFirewallManager adds/removes NACL rules via AWS SDK
- [ ] Lambda functions deployed via Terraform: credential revocation, instance termination, SNS alert
- [ ] SNS topic delivers email alerts on high-confidence cloud events
- [ ] Terraform plan shows all monitoring infrastructure
- [ ] Cloud playbooks seeded (IAM_ESCALATION, RESOURCE_ABUSE, DATA_EXPOSURE)
- [ ] Dashboard shows cloud categories in filters and stats
- [ ] Tests pass with fixture data, no AWS credentials in CI
- [ ] Oracle polling loop runs continuously without crashing
- [ ] Existing local (Eye) pipeline unchanged
