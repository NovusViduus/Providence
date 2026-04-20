# Providence — Comprehensive Project Checklist

> Full inventory of what was built across all 9 phases. Items marked 👤 require Graeme's action.

---

## Project Overview

| Component | Language | Phase | Status |
|---|---|---|---|
| The Eye | C++17 | 1 | ✅ Complete |
| The Citadel | Java 21 / Spring Boot | 2, 4 | ✅ Complete |
| ML Pipeline | Python / PyTorch | 3, 6 | ✅ Complete |
| The Lens | React / TypeScript / Three.js | 5 | ✅ Complete |
| The Oracle | Python / boto3 | 7 | ✅ Complete |
| The Ward | TypeScript / Chrome MV3 | 8 | ✅ Complete |
| Infrastructure | Terraform / Docker | 7, 9 | ✅ Complete |

---

## Phase 1: The Eye — ✅ All Kiro items complete

- ✅ Lock-free SPSC ring buffer, libpcap capture, BPF filter, IHL-aware parsing
- ✅ 31 features per flow, JA3 fingerprinting, DNS parsing, Shannon entropy
- ✅ Flow completion (FIN+ACK, RST, 30s timeout), eviction, MlClient, GrpcDispatcher
- ✅ CMake build, 5 test suites, throughput benchmark, Dockerfile
- ✅ `caplen` fix (Phase 9) — uses `hdr->caplen` not `hdr->len`
- ✅ CI pipeline (`ci-eye.yml`) — Phase 9

## Phase 2: The Citadel — ✅ All Kiro items complete

- ✅ Spring Boot 3.3, PostgreSQL 16, Redis, Flyway V1-V5
- ✅ gRPC ReportEvent, REST API (events, incidents, playbooks, blocks, actions, stats, geo, ingest)
- ✅ JWT auth (login, JwtAuthFilter, RBAC), WebSocket JWT validation via HandshakeInterceptor
- ✅ ResponseOrchestrator, PlaybookEngine, IncidentReportGenerator, AiDetectionService
- ✅ 13 playbooks seeded (6 network + 3 cloud + 4 web)
- ✅ Health check via Actuator (`GET /actuator/health`) — Phase 9
- ✅ Rate limiting (100 req/min per IP, returns 429) — Phase 9
- ✅ 24 integration tests, CI pipeline
- 👤 `docker-compose.test.yml` (low priority — Testcontainers covers this)
- 👤 Security-aware test profile (tests may need JWT in requests with security enabled)

## Phase 3: ML Pipeline — ✅ All Kiro items complete

- ✅ INTERSECTION_FEATURES (16) + EYE_FULL_FEATURES (31), CICIDS loader, honeypot loader
- ✅ RandomForest, XGBoost, LightGBM with early stopping (Phase 9)
- ✅ ModelRegistry with feature_set tracking, training CLI, evaluation with ROC curves
- ✅ Unix socket inference server, AI detection HTTP endpoint
- ✅ MODEL_EVALUATION.md, 16 tests, CI with CPU-only torch, Dockerfile

## Phase 4: Response Engine — ✅ All Kiro items complete

- ✅ FirewallManager: Noop, Pfctl, Iptables, Cloud (NACL)
- ✅ Safety guards, platform selection, playbook execution
- ✅ BlockExpiryService, response_actions audit trail
- ✅ CRITICAL_ALERT persisted to audit trail (Phase 9)
- ✅ Approve/reject with playbook TTL, 8 integration tests
- ✅ pfctl setup documented (`docs/PFCTL_SETUP.md`) — Phase 9

## Phase 5: The Lens — ✅ All Kiro items complete

- ✅ 11 components, Three.js globe with TopoJSON, Raycaster tooltips
- ✅ JWT auth, role-aware UI, WebSocket with reconnect backfill (Phase 9)
- ✅ AttackFeed: pagination + 4 filters (category, tier, confidence, IP) — Phase 9
- ✅ StatsOverview: timeline AreaChart + 60s auto-refresh — Phase 9
- ✅ ResponseLog: countdown timers — Phase 9
- ✅ ThreatMap: arc lines from threats to home location — Phase 9
- ✅ EventDetail: related incidents + response actions — Phase 9
- ✅ IncidentDetail: timeline visualization (Detected → Action → Resolved) — Phase 9
- ✅ Source icons: Bot (AI_AGENT), Cloud (Oracle), Shield (Ward)
- ✅ ESLint config — Phase 9
- ✅ Dockerfile, nginx proxy, CI pipeline
- Remaining low-priority polish (not blocking):
  - ManualOverride: manual block form (needs new Citadel endpoint)
  - ThreatMap flat SVG fallback
  - ModelMetrics confidence histogram

## Phase 6: AI Detection — ✅ All Kiro items complete

- ✅ Lab environment (docker-compose.lab.yml), 2 LLM attack scripts
- ✅ 24 behavioral features, synthetic_loader, 3 model architectures (CNN, LSTM, XGBoost)
- ✅ All 3 models evaluated side-by-side with ROC + PR curves
- ✅ XGBoost feature importance in AI detector eval — Phase 9
- ✅ AI_DETECTION.md with 9 limitations, AiDetectionService, dashboard integration
- ✅ 13 tests, CI with CPU-only torch

## Phase 7: The Oracle — ✅ All Kiro items complete

- ✅ VPC Flow Log + CloudTrail parsers, cloud feature extraction
- ✅ Rule-based classifier (IAM_ESCALATION, RESOURCE_ABUSE, DATA_EXPOSURE)
- ✅ REST dispatcher with SNS publish for Lambda remediation
- ✅ Citadel IngestController, CloudFirewallManager (NACL)
- ✅ 3 Lambda functions, Terraform modules (monitoring + remediation)
- ✅ Lambda zip packaging via `data "archive_file"` — Phase 9
- ✅ NACL Terraform resource — Phase 9
- ✅ Oracle in docker-compose.yml with graceful no-op — Phase 9
- ✅ Cloud playbooks, dashboard integration, 13 tests, CI
- 👤 EventBridge rules (Lambda trigger wiring — needs AWS testing)
- 👤 Verify SNS publish end-to-end with real AWS credentials

## Phase 8: The Ward — ✅ All Kiro items complete

- ✅ Manifest V3, content script, phishing detector, threat scorer
- ✅ ~500 bundled blocklist + remote fetch + user custom entries
- ✅ Service worker, shadow DOM warning banner, React popup + settings
- ✅ Blocklist import/export (JSON) — Phase 9
- ✅ Threat IP enrichment wired into scoring — Phase 9
- ✅ Icon SVG + generation script — Phase 9
- ✅ Connected mode, web playbooks, dashboard integration, 15 tests, CI
- 👤 Generate actual PNG icons from SVG (`node scripts/generate-icons.js`)
- 👤 Chrome Web Store submission

## Phase 9: Hardening — ✅ All Kiro items complete

- ✅ Eye CI pipeline (`ci-eye.yml`)
- ✅ Oracle in docker-compose.yml with graceful no-op
- ✅ Extension icon SVG + generation script
- ✅ ESLint configs (Lens + Ward)
- ✅ AttackFeed pagination + 4 filters
- ✅ StatsOverview timeline chart + auto-refresh
- ✅ ResponseLog countdown timers
- ✅ ThreatMap arc lines
- ✅ EventDetail: incident links + response actions
- ✅ WebSocket reconnect backfill
- ✅ IncidentDetail timeline visualization
- ✅ Citadel health check (Actuator)
- ✅ Citadel rate limiting (429)
- ✅ ML health check (`GET /health`)
- ✅ Eye `caplen` fix
- ✅ XGBoost/LightGBM early stopping
- ✅ XGBoost feature importance in AI detector eval
- ✅ CRITICAL_ALERT persisted to audit trail
- ✅ Lambda zip packaging
- ✅ NACL Terraform resource
- ✅ Blocklist import/export
- ✅ Threat IP enrichment
- ✅ Unified CI (`ci-all.yml`)
- ✅ Root README with badges, diagram, quick start
- ✅ 6 component READMEs
- ✅ DEMO.md, PFCTL_SETUP.md, BENCHMARKS.md, RESUME.md

---

## 👤 Graeme's Remaining Items

| Item | Phase | Priority |
|---|---|---|
| Populate `.env` with AWS credentials for Oracle | 7 | High |
| Run benchmarks on hardware, fill BENCHMARKS.md numbers | 9 | High |
| Record demo video (3-5 min), upload, add link to README | 9 | High |
| Generate Ward icon PNGs: `cd ward && node scripts/generate-icons.js` | 8 | Medium |
| Take screenshots for Chrome Web Store | 8 | Medium |
| Walk through DEMO.md on clean environment | 9 | Medium |
| Verify README renders on GitHub | 9 | Medium |
| Final `docker-compose up --build` validation | 9 | High |
| Verify Oracle SNS publish with real AWS | 7 | Medium |
| Chrome Web Store submission ($5 fee) | 8 | Low |
| Commit history cleanup + `git tag v1.0.0` | 9 | Medium |
| Security-aware test profile for Citadel | 2 | Low |

---

## File Inventory

| Category | Count |
|---|---|
| CI workflows | 7 (eye, citadel, ml, lens, oracle, ward, all) |
| Dockerfiles | 5 (eye, citadel, ml, oracle, ward) |
| Docker Compose files | 2 (main, lab) |
| Flyway migrations | 5 (V1-V5) |
| Terraform files | 3 (monitoring, remediation, environment) |
| Lambda functions | 3 |
| Protobuf schemas | 3 |
| Documentation | 8 (README, DEMO, BENCHMARKS, RESUME, PFCTL_SETUP, MODEL_EVALUATION, AI_DETECTION, eye_status) |
| Component READMEs | 6 |
| Test files | ~25 |
| Source files | ~95 |
