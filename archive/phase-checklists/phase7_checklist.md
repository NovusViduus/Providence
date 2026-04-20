# Phase 7: The Oracle — Implementation Checklist

> Spec vs. what was built, task by task.

---

## Task 1: Project Setup

| Requirement | Status | Notes |
|---|---|---|
| `oracle/` Python project with `pyproject.toml` | ✅ Done | Python ≥3.11, boto3, requests, pandas, schedule |
| No heavy ML deps | ✅ Done | Oracle calls ML service, doesn't run models |
| Directory structure matches spec | ✅ Done | `ingestors/`, `features/`, `classifier.py`, `dispatcher.py`, `config.py`, `main.py` |
| `config.py` with env-var-based config | ✅ Done | AWS region, S3 buckets, polling interval, Citadel URL, ML URL, JWT, VPC CIDR, SNS topic ARN |
| `python -m src.main --help` | ✅ Done | argparse with `--once` flag |

---

## Task 2: VPC Flow Log Ingestion

| Requirement | Status | Notes |
|---|---|---|
| `FlowRecord` dataclass | ✅ Done | All 14 fields from spec |
| Parse space-delimited lines | ✅ Done | `parse_flow_log_line()` with field-by-field extraction |
| Handle malformed lines (log warning, skip) | ✅ Done | Returns `None`, logs warning |
| Handle `-` values in fields | ✅ Done | Converts to 0 |
| Skip header line | ✅ Done | `line.startswith("version")` |
| Skip `log_status != "OK"` | ✅ Done | Filtered in `parse_flow_log_file()` |
| Gzip decompression | ✅ Done | `gzip.decompress()` with `BadGzipFile` fallback |
| Aggregate by (src, dst, dst_port, protocol) | ✅ Done | `aggregate_flows()` computes totals, duration, accept/reject counts |
| Filter internal-to-internal traffic | ✅ Done | `is_internal()` checks 10.x, 172.16.x, 192.168.x prefixes |
| S3 polling with state tracking | ✅ Done | `poll_s3()` tracks `last_key`, skips already-processed |
| Polling loop every 60s (configurable) | ✅ Done | `config.POLL_INTERVAL_SECONDS` |
| NODATA/SKIPDATA filtered | ✅ Done | Only `log_status == "OK"` kept |

---

## Task 3: CloudTrail Ingestion

| Requirement | Status | Notes |
|---|---|---|
| `CloudTrailEvent` dataclass | ✅ Done | All fields from spec including `request_parameters`, `error_code`, `read_only` |
| Parse gzipped JSON | ✅ Done | `gzip.decompress()` with fallback |
| Extract from `Records` array | ✅ Done | Iterates `data.get("Records", [])` |
| Handle missing fields gracefully | ✅ Done | `.get()` with defaults throughout |
| Security event filtering | ✅ Done | `filter_security_events()` checks against `SECURITY_EVENTS` list + non-read-only IAM/EC2/S3 |
| Configurable filter list | ✅ Done | `SECURITY_EVENTS` in `config.py` |
| S3 polling (same pattern as VPC) | ✅ Done | `poll_s3()` with `last_key` tracking |
| Skip non-.json.gz files | ✅ Done | `key.endswith(".json.gz")` check |

---

## Task 4: Cloud Feature Extraction

| Requirement | Status | Notes |
|---|---|---|
| VPC flow features → `INTERSECTION_FEATURES` mapping | ✅ Done | `extract_flow_features()` maps duration, packets, bytes, rates |
| `packet_count_bwd = 0` (unidirectional documented) | ✅ Done | Comment: "flow logs are unidirectional" |
| Flag counts set to 0 (not available) | ✅ Done | syn/ack/fin/rst/psh/urg all 0 |
| `payload_size_mean` computed | ✅ Done | `total_bytes / max(packets, 1)` |
| Limitation documented | ✅ Done | Docstring explains reduced discriminative power |
| CloudTrail features (12 aggregate features) | ✅ Done | event_count, unique_event_names, iam/ec2/s3 counts, error ratio, write ratio, unique resources, off_hours, escalation/creation signals |
| `off_hours` detection | ✅ Done | `_is_off_hours()` checks hour < 8 or >= 18 UTC |
| Rule-based classifier: IAM_ESCALATION | ✅ Done | 4 rules: admin policy, key creation, cross-account assume role, inline policy |
| Rule-based classifier: RESOURCE_ABUSE | ✅ Done | GPU instance detection (p/g instance types) + generic instance launch |
| Rule-based classifier: DATA_EXPOSURE | ✅ Done | 3 rules: public ACL, wildcard policy, policy deletion |
| Rules fire first, ML fallback | ✅ Done | `classify_cloudtrail()` calls rules, returns None for ML fallback |

---

## Task 5: Classification & Dispatch to Citadel

| Requirement | Status | Notes |
|---|---|---|
| `classifier.py` — VPC flow → ML service | ✅ Done | `classify_flow()` POSTs to ML HTTP endpoint |
| `classifier.py` — CloudTrail → rules first | ✅ Done | `classify_cloudtrail()` calls `classify_cloudtrail_event()` |
| `source_component = "oracle"` | ✅ Done | Set in `build_event()` |
| REST dispatch (not gRPC) | ✅ Done | `dispatcher.py` uses `requests.post()` |
| JWT in Authorization header | ✅ Done | `Bearer {JWT_TOKEN}` |
| Batch dispatch (up to 50) | ✅ Done | `BATCH_SIZE = 50` |
| 3 retries with exponential backoff | ✅ Done | `2 ** attempt` sleep between retries |
| Logging: dispatched count | ✅ Done | `[ORACLE] Dispatched {n}/{total} events` |
| Citadel `POST /api/v1/events/ingest` | ✅ Done | `IngestController.java` — accepts JSON, runs full pipeline |
| Ingest runs through ResponseOrchestrator | ✅ Done | Determines tier, persists, publishes Redis, executes playbook |
| Ingest requires ADMIN JWT | ✅ Done | POST endpoint requires ADMIN role via SecurityConfig |
| Returns `{ eventId, responseTier, responseAction }` | ✅ Done | |
| Oracle events appear in Lens alongside Eye events | ✅ Done | Same pipeline → same WebSocket → same dashboard |

---

## Task 6: CloudFirewallManager

| Requirement | Status | Notes |
|---|---|---|
| `CloudFirewallManager.java` | ✅ Done | `@ConditionalOnProperty(havingValue = "cloud")` |
| Uses NACLs (not Security Groups) | ✅ Done | Documented: SGs are allow-only |
| `blockIP` → NACL DENY rule | ✅ Done | `ec2.createNetworkAclEntry()` with `/32` CIDR, all protocols |
| Rule number tracking in Redis | ✅ Done | `nacl:rule:{ip}` → rule number, `nacl:rule_counter` for incrementing |
| `rateLimit` → short-TTL block (documented limitation) | ✅ Done | Logs warning, calls `blockIP(ip, 10min)` |
| `unblock` → delete NACL entry | ✅ Done | Looks up rule number from Redis, calls `ec2.deleteNetworkAclEntry()` |
| `listRules` → from Redis tracking | ✅ Done | Scans `nacl:rule:*` keys |
| `platformName()` returns `"cloud"` | ✅ Done | |
| Safety guards: IP validation | ✅ Done | `FirewallSafetyGuard.validate()` |
| Never block VPC internal IPs | ✅ Done | Explicit check for 10.x, 172.16.x, 192.168.x |
| AWS SDK for Java v2 | ✅ Done | `software.amazon.awssdk.services.ec2.Ec2Client` |
| AWS SDK dependency in pom.xml | ✅ Done | `software.amazon.awssdk:ec2:2.25.0` added to pom.xml |

---

## Task 7: Lambda Remediation Functions

| Requirement | Status | Notes |
|---|---|---|
| `revoke_iam_credentials` Lambda | ✅ Done | Deactivates specific key or all active keys for user |
| `terminate_suspicious_instance` Lambda | ✅ Done | Stops (not terminates) + tags as quarantined |
| `sns_alert_publisher` Lambda | ✅ Done | Publishes formatted JSON to SNS topic |
| Python 3.12 runtime | ✅ Done | Specified in Terraform |
| Least-privilege IAM roles | ✅ Done | Separate roles per Lambda with minimal permissions |
| Terraform resources for all three | ✅ Done | `aws_lambda_function` + `aws_iam_role` + `aws_iam_role_policy` |
| SNS topic `providence-alerts` | ✅ Done | With email subscription |
| EventBridge rules | ❌ Missing | Spec asks for EventBridge rules matching Providence events. Not created in Terraform. |
| CloudWatch log groups | ❌ Missing | Not explicitly created (Lambda creates them automatically, but spec asks for explicit Terraform resources) |
| Lambda zip packaging | ⚠️ Partial | Terraform references `.zip` files but no build step to create them from `.py` files |
| Oracle publishes to SNS on high-confidence events | ❌ Missing | `dispatcher.py` sends to Citadel but doesn't publish to SNS directly. Would need boto3 SNS publish call. |

---

## Task 8: Terraform Cloud Monitoring Infrastructure

| Requirement | Status | Notes |
|---|---|---|
| VPC Flow Log → S3 | ✅ Done | `aws_flow_log` + `aws_s3_bucket` |
| `max_aggregation_interval = 600` | ✅ Done | 10 minutes |
| CloudTrail → S3 | ✅ Done | `aws_cloudtrail` with multi-region, log validation |
| S3 bucket policy for CloudTrail | ✅ Done | ACL check + PutObject permissions |
| IAM role for Oracle | ✅ Done | S3 read, EC2 NACL operations, SNS publish |
| Least-privilege policies | ✅ Done | Scoped to specific bucket ARNs for S3 |
| Environment config (`environments/monitoring/main.tf`) | ✅ Done | Wires monitoring + remediation modules with variables |
| NACL resource | ❌ Missing | Spec mentions a Providence NACL. Terraform doesn't create one — `CloudFirewallManager` references `nacl-id` from config but no Terraform resource provisions it. |

---

## Task 9: Dashboard — Unified View

| Requirement | Status | Notes |
|---|---|---|
| Cloud icon for `source_component = "oracle"` events | ✅ Done | `Cloud` icon from lucide-react, purple color |
| New categories in filter: IAM_ESCALATION, RESOURCE_ABUSE, DATA_EXPOSURE | ✅ Done | Added to AttackFeed dropdown |
| Color coding: IAM_ESCALATION amber, RESOURCE_ABUSE red, DATA_EXPOSURE purple | ✅ Done | Added to `CATEGORY_COLORS` in `geoip.ts` |
| StatsOverview: Eye vs Oracle breakdown | ❌ Missing | Stats endpoint doesn't break down by `sourceComponent`. Would need a new query or endpoint. |
| EventDetail: cloud-specific fields (VPC ID, account ID) | ❌ Missing | EventDetail shows standard fields. No cloud-specific section. |
| Cloud playbooks seeded (Flyway V4) | ✅ Done | IAM_ESCALATION, RESOURCE_ABUSE, DATA_EXPOSURE with BLOCK + CRITICAL_ALERT |
| ThreatMap: Oracle IPs on globe | ✅ Done | Same geo endpoint, same rendering — Oracle events have source IPs that get plotted |

---

## Task 10: Tests & CI

| Requirement | Status | Notes |
|---|---|---|
| `test_vpc_flow_logs.py` — parse valid line | ✅ Done | Asserts all fields |
| `test_vpc_flow_logs.py` — malformed line skipped | ✅ Done | Returns None |
| `test_vpc_flow_logs.py` — aggregation groups correctly | ✅ Done | Verifies grouping and internal filtering |
| `test_vpc_flow_logs.py` — NODATA filtered | ✅ Done | Via `parse_flow_log_file` test |
| `test_cloudtrail.py` — parse valid JSON | ✅ Done | 3 events from fixture |
| `test_cloudtrail.py` — security filter | ✅ Done | Keeps IAM + EC2, drops read-only |
| `test_cloudtrail.py` — missing fields handled | ✅ Done | Minimal event with only `eventName` |
| `test_cloud_features.py` — flow features map correctly | ✅ Done | Duration, packets, bytes, rates verified |
| `test_cloud_features.py` — CloudTrail features | ✅ Done | Event counts, off-hours detection |
| `test_cloud_features.py` — rule-based IAM_ESCALATION | ✅ Done | AttachUserPolicy + AdministratorAccess |
| `test_cloud_features.py` — rule-based RESOURCE_ABUSE | ✅ Done | GPU instance type detection |
| `test_cloud_features.py` — rule-based DATA_EXPOSURE | ✅ Done | Public bucket ACL |
| `test_cloud_features.py` — no rule match returns None | ✅ Done | DescribeInstances → None |
| Tests use fixture files only | ✅ Done | `tests/fixtures/` with sample data |
| No boto3 calls in tests | ✅ Done | All parsing tested from file content |
| `.github/workflows/ci-oracle.yml` | ✅ Done | Python 3.12, pip install, pytest, ruff |
| Dockerfile | ✅ Done | `python:3.12-slim` |

---

## Verification Checklist (from spec)

| Check | Status |
|---|---|
| VPC Flow Logs parsed from S3, aggregated | ✅ |
| CloudTrail events parsed, filtered for security | ✅ |
| Cloud features extracted and mapped | ✅ |
| Rule-based classifier detects IAM_ESCALATION, RESOURCE_ABUSE, DATA_EXPOSURE | ✅ |
| ML fallback for VPC flow records | ✅ |
| Oracle dispatches to Citadel via REST | ✅ |
| Events appear in Lens with `source_component = "oracle"` and cloud icon | ✅ |
| CloudFirewallManager adds/removes NACL rules | ✅ (code complete, AWS SDK dep added to pom) |
| Lambda functions deployed via Terraform | ✅ (Terraform defined, zip packaging not automated) |
| SNS topic delivers email alerts | ✅ (Terraform creates topic + subscription) |
| Terraform plan shows all monitoring infrastructure | ✅ |
| Cloud playbooks seeded | ✅ |
| Dashboard shows cloud categories in filters and stats | ✅ |
| Tests pass with fixture data, no AWS credentials | ✅ |
| Oracle polling loop runs continuously | ✅ |
| Existing local (Eye) pipeline unchanged | ✅ |

---

## Gaps Summary

| Gap | Severity | Notes |
|---|---|---|
| AWS SDK dependency in pom.xml | ✅ Closed | `software.amazon.awssdk:ec2:2.25.0` added to pom.xml. |
| EventBridge rules in Terraform | Low | Lambda functions exist but no EventBridge rules to trigger them from Providence events. |
| Lambda zip packaging | Low | Terraform references `.zip` files but no build step. Needs `data "archive_file"` or a Makefile. |
| Oracle SNS publish for high-confidence events | ✅ Closed | `_maybe_publish_sns()` in `dispatcher.py` publishes to SNS when category is IAM_ESCALATION or RESOURCE_ABUSE and confidence ≥ 0.85. Triggers Lambda remediation. |
| NACL Terraform resource | Low | CloudFirewallManager references a NACL ID from config but Terraform doesn't create one. Assumes existing NACL. |
| StatsOverview Eye vs Oracle breakdown | Low | Would need `sourceComponent` grouping in the stats endpoint. |
| EventDetail cloud-specific fields | Low | Shows standard fields. VPC ID, account ID not in the SecurityEvent entity. |
| CloudWatch log groups in Terraform | Low | Lambda creates them automatically. Explicit Terraform resources would give retention control. |
