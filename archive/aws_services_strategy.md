# Providence — AWS Services Strategy Guide

**Author:** Graeme Huntley
**Date:** February 2026
**Status:** Reference Document

---

## Overview

This document categorizes AWS services by their relevance to the Providence
platform, documenting which services to use, which to consider, and which
to skip — along with the rationale for each decision.

---

## Tier 1: Use These — They Solve Real Problems

### S3 (Simple Storage Service)
**Role in Providence:** Central data lake for honeypot logs, VPC Flow Logs,
model artifacts, and CloudTrail events.
**Why:** Every data pipeline in the project flows through S3. Honeypots ship
logs here, The Oracle reads cloud telemetry from here, trained models are
stored here. S3 fluency is assumed in every AWS job posting.

### EC2 (Elastic Compute Cloud)
**Role in Providence:** Honeypot fleet instances and potentially production
deployment of The Eye.
**Why:** Already in use for honeypots. Understanding instance types, AMIs,
security groups, and instance profiles is foundational.

### IAM (Identity and Access Management)
**Role in Providence:** Least-privilege access control across all components.
Honeypot roles (S3 write-only), Oracle roles (VPC Flow Log read, Security
Group modify), Lambda execution roles, CI/CD deployment roles.
**Why:** Designing least-privilege IAM policies is one of the most marketable
AWS skills. Interviewers ask about it constantly. Providence requires multiple
roles with different permission boundaries, which demonstrates real IAM design.

### VPC + Security Groups + NACLs
**Role in Providence:** Core infrastructure for The Oracle (Phase 7). VPC Flow
Logs are a primary data source. CloudFirewallManager modifies Security Groups
programmatically as automated responses. Production deployment requires VPC
design with public/private subnets, NAT gateways, and routing tables.
**Why:** Understanding VPC networking is foundational for any cloud SWE role.
Providence both monitors VPC telemetry and acts on VPC security controls.

### CloudWatch
**Role in Providence:** Two uses. (1) Monitoring honeypot fleet health — CPU,
disk, network metrics, alerting if an instance goes down. (2) VPC Flow Logs
can publish to CloudWatch Logs for real-time streaming via subscriptions,
providing a more responsive data pipeline for The Oracle than S3 polling.
**Why:** CloudWatch is AWS's monitoring backbone. Using it for both infrastructure
health and as a data pipeline input demonstrates operational maturity.

### Lambda
**Role in Providence:** Automated remediation functions in Phase 7. When The
Oracle detects a compromised IAM key → Lambda revokes it. Suspicious EC2
launch → Lambda terminates it. Small, focused functions — exactly what Lambda
is designed for.
**Resume line:** "Wrote Lambda functions for automated security remediation."

### SNS (Simple Notification Service)
**Role in Providence:** Alert delivery. High-confidence attack detection →
publish to SNS topic → fan out to email, SMS, Slack webhooks, or other
Lambda functions. Standard AWS event-driven alerting pattern.
**Implementation effort:** ~1 hour to set up. High value-to-effort ratio.

### ECR (Elastic Container Registry)
**Role in Providence:** Docker image storage. Dockerized Citadel, ML service,
and dashboard images live here before deployment to ECS.
**Why:** AWS-native Docker Hub equivalent. Integrates cleanly with ECS for
deployment pipelines.

### ECS/Fargate (Elastic Container Service)
**Role in Providence:** Production cloud deployment of the full stack. Docker
Compose works locally; ECS/Fargate orchestrates containers in the cloud.
Fargate is serverless — no EC2 instance management, just container definitions.
**Resume line:** "Deployed a multi-container application on ECS Fargate."

### RDS (Relational Database Service)
**Role in Providence:** Managed PostgreSQL for production deployment. Handles
backups, patching, failover, and scaling automatically.
**Usage pattern:** Docker PostgreSQL for local dev, RDS for cloud deployment.

### ElastiCache
**Role in Providence:** Managed Redis for production deployment. Same logic
as RDS — managed service for cloud, Docker for local dev.

---

## Tier 2: Consider These — Useful But Not Essential

### CloudTrail
**Role in Providence:** Primary data source for The Oracle's cloud monitoring.
Logs every API call in the AWS account. Detects IAM escalation, unauthorized
resource creation, suspicious configuration changes.
**Integration:** CloudTrail writes to S3 → The Oracle reads from S3. Straightforward.

### Kinesis Data Streams
**Role in Providence:** Real-time streaming alternative to S3 polling for cloud
monitoring. Architecture: VPC Flow Logs → CloudWatch Logs → Kinesis → The Oracle.
**Tradeoff:** More complex than S3 polling, costs money, but enables near-real-time
cloud threat detection. Add as Phase 7 enhancement if time allows.
**Resume line:** "Built a real-time threat detection pipeline using Kinesis."

### Secrets Manager
**Role in Providence:** Store database passwords, API keys, JWT secrets. Replaces
environment variables and config files for secret management.
**Implementation effort:** ~30 minutes. Small addition, but demonstrates
security-conscious infrastructure design.

### Systems Manager (SSM) Session Manager
**Role in Providence:** Replace port-62222 management SSH with zero-inbound-port
access. Authenticates through IAM instead of SSH keys. Eliminates the "my IP
changed and I'm locked out" problem.
**When to switch:** After honeypots are stable and you're comfortable with IAM.

### EventBridge
**Role in Providence:** Event routing service. Wires together CloudTrail events,
Lambda functions, and SNS alerts declaratively.
**Example pipeline:** CloudTrail logs unauthorized IAM action → EventBridge triggers
Lambda (revoke credentials) → Lambda publishes SNS alert. Three services, few
lines of Terraform, no custom glue code.

---

## Tier 3: Skip These — Traps for This Project

### SageMaker
**Why skip:** AWS's ML platform is massive, expensive, and opinionated. You'd
spend weeks learning SageMaker's way of doing things instead of building your
own ML pipeline. Your custom scikit-learn/PyTorch pipeline is MORE impressive
on a resume because you built it yourself and can explain every decision.

### GuardDuty
**Why skip as a component:** AWS's built-in threat detection. Does some of what
The Oracle does. Don't use it as a component.
**DO use it as a benchmark:** Enable GuardDuty and compare its findings against
The Oracle's classifications. "My system detected X threats that GuardDuty missed,
and GuardDuty caught Y that mine missed — here's my analysis of why" is a
phenomenal interview talking point.

### WAF (Web Application Firewall)
**Why skip:** Managed web security service that overlaps with The Ward. Same
story as GuardDuty — use as comparison benchmark, not as a component.

### Step Functions
**Why skip:** State machine orchestration. Overkill for the response pipeline.
The ResponseOrchestrator in Java handles this logic adequately.

### DynamoDB
**Why skip:** PostgreSQL already covers your data storage needs. Adding a second
database technology without architectural justification is complexity for
complexity's sake.

### EKS (Elastic Kubernetes Service)
**Why skip:** Running Kubernetes for a project this size is like driving a semi
truck to the grocery store. ECS/Fargate is the right abstraction level.

---

## The Strategic AWS Resume Story

When Providence is complete, the AWS services portfolio looks like:

**Compute:** EC2, Lambda, ECS/Fargate
**Storage:** S3, ECR
**Database:** RDS (PostgreSQL), ElastiCache (Redis)
**Networking:** VPC, Security Groups, NACLs
**Security:** IAM, Secrets Manager, CloudTrail
**Monitoring:** CloudWatch, SNS, EventBridge
**Infrastructure:** Terraform (all resources)

This is a comprehensive cloud engineering portfolio in one project. Every
service is present because the architecture requires it, not bolted on for
resume keywords. That's the difference between someone who knows AWS and
someone who listed AWS services on their resume.

---

## Implementation Timeline

| Phase | AWS Services Introduced |
|---|---|
| Phase 0 (Honeypots) | EC2, S3, IAM, Security Groups |
| Phase 2 (Citadel) | Docker locally (no new AWS) |
| Phase 7 (Oracle) | VPC Flow Logs, CloudTrail, CloudWatch, Lambda, SNS, EventBridge |
| Phase 9 (Production) | ECS/Fargate, ECR, RDS, ElastiCache, Secrets Manager |

Phases 1-6 use AWS minimally (EC2 for honeypots, S3 for data). The heavy
AWS integration comes in Phases 7 and 9 when you're deploying cloud monitoring
and production infrastructure. This is intentional — learn the core engineering
first, add cloud-native patterns after.

---

*Every service earns its place in the architecture. Nothing is decorative.*
