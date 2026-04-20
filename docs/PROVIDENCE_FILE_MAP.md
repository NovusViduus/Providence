# Providence — Complete File Map

> Every file in the project with its purpose, key symbols, and interactions.
> 190+ files across 7 components, 4 languages.

---

## Root

| File | Purpose |
|---|---|
| `README.md` | Project landing page — badges, architecture diagram, quick start, component table, tech rationale |
| `PROVIDENCE_CHECKLIST.md` | Comprehensive project status checklist across all 9 phases |
| `docker-compose.yml` | Main stack: Citadel, PostgreSQL, Redis, ML service, Lens, Oracle (6 services) |
| `docker-compose.lab.yml` | Isolated lab for AI agent data generation: Cowrie honeypot + Python attacker |
| `providence_design_doc.md` | Original architecture design document |
| `eye.cpp` | Original monolithic Eye source (pre-modularization, kept for reference) |
| `eye_code_review.md` | Phase 1 code review findings that drove initial improvements |
| `eye_status.md` | Comprehensive Eye status document after Phase 1 |
| `eye_phase1_kiro_tasks.md` | Phase 1 task spec |
| `feature_extraction_plan.md` | Feature extraction design plan |
| `honeypot_setup_guide.md` | Honeypot deployment guide |
| `aws_services_strategy.md` | AWS services strategy document |
| `phase2-citadel.md` through `phase9-hardening.md` | Phase spec documents |
| `phase2_checklist.md` through `phase8_checklist.md` | Per-phase implementation checklists |

---

## Proto (`proto/`)

| File | Purpose | Key Messages |
|---|---|---|
| `features.proto` | FeatureVector schema — 40 fields covering network, transport, timing, payload, TLS, DNS | `FeatureVector` (package `providence`) |
| `event.proto` | Event classification + gRPC service | `Classification`, `ClassifiedEvent`, `EventAck`, `EventService.ReportEvent` |
| `response.proto` | Response action schema | `ResponseAction` (action_type, target_ip, ttl, confidence, rationale) |

---

## The Eye (`eye/`) — C++17 Packet Capture

### Source (`eye/src/`)

| File | Purpose | Key Symbols | Interacts With |
|---|---|---|---|
| `main.cpp` | Entry point — arg parsing, thread orchestration, signal handling | `main()`, `sigint_handler()`, `print_usage()` | ring_buffer, packet_capture, processor, flow_tracker, ml_client, grpc_dispatcher |
| `processor.h/.cpp` | Worker thread — drains ring buffer, routes TCP/UDP, triggers flow completion | `processor_run()`, `classify_and_dispatch()` | ring_buffer, flow_tracker, ml_client, grpc_dispatcher, features.pb, event.pb |
| `capture/ring_buffer.h` | Header-only lock-free SPSC ring buffer | `RingBuffer<Capacity>` (template), `PacketSlot`, `try_push()`, `try_pop()`, `empty()` | packet_capture (producer), processor (consumer) |
| `capture/packet_capture.h/.cpp` | pcap lifecycle — open, BPF filter, link-layer detection, capture loop | `open_capture()`, `run_capture()`, `stop_capture()`, `CaptureContext` | ring_buffer (writes into), main (called from) |
| `features/flow_tracker.h/.cpp` | Flow state machine — parsing, aggregation, completion detection, export | `FlowStats` (struct), `process_packet()`, `process_dns_packet()`, `check_completed_flows()`, `flush_all_flows()`, `set_flow_complete_callback()`, `CompletedFlow`, `export_json()`, `print_summary()` | entropy, tls_parser, dns_parser |
| `features/entropy.h` | Header-only Shannon entropy calculator | `shannon_entropy(data, len)` → 0.0–8.0 bits | flow_tracker (called per payload) |
| `features/tls_parser.h/.cpp` | TLS ClientHello → JA3 fingerprint | `JA3Result`, `parse_ja3()` → `optional<JA3Result>` | flow_tracker (called on TCP payload), OpenSSL MD5 |
| `features/dns_parser.h/.cpp` | DNS query parsing | `DnsQuery`, `parse_dns_query()` → `optional<DnsQuery>` | flow_tracker (called on UDP payload) |
| `features/feature_extractor.h` | `FeatureVector` C++ struct (canonical feature definition) | `FeatureVector` with 31 fields | Referenced by design docs |
| `bridge/ml_client.h/.cpp` | Unix domain socket client for ML inference service | `MlClient` class: `connect()`, `disconnect()`, `classify()` → `optional<Classification>` | processor (called on flow completion), features.pb, event.pb |
| `dispatcher/grpc_dispatcher.h/.cpp` | gRPC client for Citadel | `GrpcDispatcher` class: `connect()`, `dispatch()` | processor (called after classification), event.pb, event.grpc.pb |

### Config

| File | Purpose |
|---|---|
| `CMakeLists.txt` | Build system — finds pcap/OpenSSL/protobuf/gRPC, generates proto stubs, builds eye + tests + benchmarks |
| `Dockerfile` | Multi-stage Ubuntu 24.04 build |
| `README.md` | Build instructions, CLI usage, feature list |

### Tests (`eye/tests/`)

| File | Tests | Key Assertions |
|---|---|---|
| `test_ring_buffer.cpp` | Push/pop, full buffer, empty pop, FIFO order, timestamp, concurrent SPSC (10K packets) | Data integrity through lock-free path |
| `test_entropy.cpp` | All-identical (≈0.0), uniform (≈8.0), known string, empty buffer | Entropy calculation correctness |
| `test_tls_parser.cpp` | Valid ClientHello, non-TLS, truncated, empty, ServerHello, GREASE filtering | JA3 hash is 32-char hex, GREASE values excluded |
| `test_dns_parser.cpp` | Valid A query, response rejected, zero QDCOUNT, truncated, multi-label, TXT query | Domain reconstruction, query type extraction |
| `test_flow_tracker.cpp` | Same-flow merging, bidirectional keying, SYN flag, payload entropy, zero payload, window size | Flow aggregation correctness |
| `mock_ml_server.py` | Python mock ML server for testing Eye's Unix socket client | Always returns BENIGN with 0.95 confidence |

### Benchmarks (`eye/benchmarks/`)

| File | Measures |
|---|---|
| `throughput_bench.cpp` | `process_packet` (100K packets), `parse_ja3`, `parse_dns_query` — reports pkt/s and Mbps |

---

## The Citadel (`citadel/`) — Java Spring Boot Backend

### API Layer (`citadel/src/main/java/.../api/`)

| File | Purpose | Key Endpoints | Interacts With |
|---|---|---|---|
| `GrpcEventService.java` | gRPC server — receives ClassifiedEvent from The Eye | `ReportEvent` RPC | EventService, ResponseOrchestrator, IncidentReportGenerator, RedisEventPublisher, PlaybookEngine, AiDetectionService |
| `IngestController.java` | REST ingest for Oracle + Ward | `POST /api/v1/events/ingest` | Same pipeline as gRPC |
| `EventController.java` | Event queries | `GET /events`, `GET /events/{id}`, `GET /events/stats` | EventService |
| `GeoController.java` | Geographic IP data | `GET /events/geo?hours=N` | EventRepository, Redis (geo cache), ip-api.com |
| `IncidentController.java` | Incident CRUD + approve/reject | `GET/PATCH /incidents/{id}`, `POST /incidents/{id}/approve`, `POST /incidents/{id}/reject` | IncidentRepository, FirewallManager, PlaybookRepository, ResponseActionRepository |
| `PlaybookController.java` | Playbook CRUD | `GET/PUT /playbooks/{id}` | PlaybookRepository |
| `BlockController.java` | Active block management | `GET /blocks`, `DELETE /blocks/{ip}` | BlockExpiryService |
| `ActionController.java` | Response action audit trail | `GET /actions` (filterable: actionType, sourceIp, success, active) | ResponseActionRepository |
| `ThreatController.java` | Active threat cache | `GET /threats/active` | RedisEventPublisher |
| `AuthController.java` | JWT login | `POST /auth/login` → `{token, role, expiresIn}` | JwtAuthFilter.KEY (shared signing key) |
| `GlobalExceptionHandler.java` | `@RestControllerAdvice` — 400/500 error formatting | Catches MethodArgumentTypeMismatch, IllegalArgument, generic Exception | All controllers |

### Config (`citadel/src/main/java/.../config/`)

| File | Purpose | Key Beans |
|---|---|---|
| `SecurityConfig.java` | Spring Security — stateless JWT, RBAC, CORS | `SecurityFilterChain`: /auth/** permitAll, GET authenticated, mutations ADMIN only |
| `JwtAuthFilter.java` | `OncePerRequestFilter` — extracts Bearer token, validates, sets SecurityContext | `KEY` (HMAC secret), parses `sub` + `role` claims |
| `WebSocketConfig.java` | WebSocket endpoint + JWT handshake interceptor | `/ws/events` with `JwtHandshakeInterceptor` |
| `RedisConfig.java` | Redis pub/sub listener → WebSocket bridge | `RedisMessageListenerContainer` on `providence:events` channel |
| `RateLimitInterceptor.java` | 100 req/min per IP rate limiter | Returns 429 when exceeded, resets every 60s |
| `WebMvcConfig.java` | Registers RateLimitInterceptor on `/api/**` | |

### Service Layer (`citadel/src/main/java/.../service/`)

| File | Purpose | Key Methods |
|---|---|---|
| `EventService.java` | Event persistence + queries + tier determination | `save()`, `findByCategory()`, `findBySourceIp()`, `getStats()`, `determineTier(confidence)` |
| `ResponseOrchestrator.java` | Tiered response engine — evaluates events, executes playbooks | `evaluate(event)` → `ResponseDecision`, `executePlaybook()`, `persistAction()`, `publishAlert()` |
| `PlaybookEngine.java` | Matches events to playbooks by category + confidence | `match(event)` → `Optional<Playbook>` |
| `IncidentReportGenerator.java` | Creates incident reports for ACT/RECOMMEND events | `generate(event, decision)` → `IncidentReport` |
| `RedisEventPublisher.java` | Redis pub/sub + active threat cache | `publishEvent()`, `cacheActiveThreat()`, `getActiveThreats()` |
| `BlockExpiryService.java` | `@Scheduled` TTL sweep — unblocks expired IPs | `sweepExpiredBlocks()`, `manualUnblock()`, `cacheActiveBlock()`, `getActiveBlocks()` |
| `AiDetectionService.java` | Per-IP session aggregation → ML AI detection endpoint | `onEvent()`, `checkForAiAgents()` (@Scheduled), `extractBehavioralFeatures()`, `callAiDetector()` |

### Firewall (`citadel/src/main/java/.../firewall/`)

| File | Purpose | Platform |
|---|---|---|
| `FirewallManager.java` | Interface: `blockIP()`, `rateLimit()`, `unblock()`, `listRules()`, `platformName()` | — |
| `Result.java` | Record: success, action, ip, detail, timestamp, expiresAt | — |
| `Rule.java` | Record: ip, action, createdAt, expiresAt, source | — |
| `FirewallSafetyGuard.java` | IP validation, loopback/gateway/VPC protection | `validate(ip, action)` → null (pass) or Result (fail) |
| `NoopFirewallManager.java` | Logs actions, tracks in-memory `ConcurrentHashMap` | `noop` (default, CI, dev) |
| `PfctlFirewallManager.java` | `pfctl -t providence_blocklist -T add/delete` via ProcessBuilder | `pfctl` (macOS) |
| `IptablesFirewallManager.java` | `iptables -A PROVIDENCE -s <ip> -j DROP` with comment metadata | `iptables` (Linux) |
| `CloudFirewallManager.java` | AWS NACL DENY rules via EC2 SDK, Redis rule number tracking | `cloud` (AWS) |

### Model (`citadel/src/main/java/.../model/`)

| File | JPA Entity | Key Fields |
|---|---|---|
| `SecurityEvent.java` | `security_events` table | eventId, sourceIp, destIp, category, confidence, responseTier, featureImportances (JSONB) |
| `Playbook.java` | `playbooks` table | name, category, actions (JSONB), minConfidence, ttlSeconds, enabled |
| `IncidentReport.java` | `incident_reports` table | event (FK), playbook (FK), responseTier, actionsTaken, pendingApproval, resolved |
| `ResponseAction.java` | `response_actions` table | actionType, sourceIp, success, platform, expiresAt, reversedAt, reversedReason |
| `ResponseDecision.java` | Record (not persisted) | tier, matchedPlaybook, intendedActions |

### Repository (`citadel/src/main/java/.../repository/`)

| File | Custom Queries |
|---|---|
| `EventRepository.java` | `findByCategory`, `findBySourceIp`, `findByResponseTier`, `findByTimestampBetween`, `findByConfidenceGreaterThanEqual`, `countByCategory`, `countByResponseTier` |
| `PlaybookRepository.java` | `findByCategoryAndEnabledTrueOrderByMinConfidenceDesc` |
| `IncidentRepository.java` | `findByResolved`, `findByCategory`, `findByCreatedAtBetween` |
| `ResponseActionRepository.java` | `findByActionType`, `findBySourceIp`, `findBySuccess`, `findActive` (WHERE reversedAt IS NULL), `findAllActive` |

### Database Migrations (`citadel/src/main/resources/db/migration/`)

| File | Creates |
|---|---|
| `V1__initial_schema.sql` | `security_events` (5 indexes), `playbooks`, `incident_reports` |
| `V2__seed_playbooks.sql` | 6 default playbooks (DOS, BRUTE_FORCE, EXFILTRATION, PROBE, INJECTION, AI_AGENT) |
| `V3__response_actions_and_pending_approval.sql` | `response_actions` table + `pending_approval` column on incidents |
| `V4__cloud_playbooks.sql` | 3 cloud playbooks (IAM_ESCALATION, RESOURCE_ABUSE, DATA_EXPOSURE) |
| `V5__web_playbooks.sql` | 4 web playbooks (WEB_PHISHING, WEB_CRYPTOMINER, WEB_INJECTION, WEB_TRACKING) |

### Tests (`citadel/src/test/`)

| File | Tests |
|---|---|
| `CitadelIntegrationTest.java` | 11 tests: persistence, REST filtering, stats, orchestrator tiers, Redis, playbook CRUD, 404s, tier boundaries |
| `GrpcTransportTest.java` | 3 tests: ReportEvent at ACT/OBSERVE/RECOMMEND tiers via real ManagedChannel |
| `WebSocketIntegrationTest.java` | 2 tests: WS client receives published event, no-clients graceful handling |
| `ResponseEngineIntegrationTest.java` | 8 tests: ACT block+expiry, RECOMMEND approve, loopback safety, OBSERVE no-action, manual unblock, reject, noop platform, TTL expiry lifecycle |
| `TestContainersConfig.java` | `@TestConfiguration` — PostgreSQL 16 + Redis 7 via Testcontainers |

---

## ML Pipeline (`ml/`) — Python Classification + AI Detection

### Features (`ml/src/features/`)

| File | Purpose | Key Symbols |
|---|---|---|
| `schema.py` | Feature set definitions + mapping functions | `INTERSECTION_FEATURES` (16), `EYE_FULL_FEATURES` (31), `CICIDS_COLUMN_MAP`, `CICIDS_LABEL_MAP`, `cicids_row_to_array()`, `protobuf_to_array()`, `validate_dataframe()` |
| `behavioral.py` | AI detection behavioral features (24 per session) | `AI_DETECTION_FEATURES`, `extract_features(session)`, `_shannon_entropy()`, `RECON_COMMANDS`, `DOWNLOAD_COMMANDS`, `LATERAL_COMMANDS` |

### Data (`ml/src/data/`)

| File | Purpose | Key Functions |
|---|---|---|
| `cicids_loader.py` | CICIDS2017 CSV loader — encoding fallback, label mapping, NaN/Inf cleaning | `load_cicids(data_dir)` → `(X, y)` aligned to INTERSECTION_FEATURES |
| `honeypot_loader.py` | Honeypot data — Mode A (raw logs) + Mode B (Eye-processed) | `load_honeypot_raw()`, `load_honeypot_eye_processed()` |
| `preprocessor.py` | StandardScaler + median imputation, save/load via joblib | `Preprocessor` class: `fit_transform()`, `transform()`, `transform_array()`, `save()`, `load()`. `combine_datasets()` |
| `synthetic_loader.py` | Combines HUMAN + AI_AGENT sessions for AI detection | `load_sessions(dir, label)`, `build_dataset(human_dir, ai_dir)` → `(X, y)` |
| `lab/ssh_credential_guesser.py` | LLM-driven SSH credential guessing (defensive research) | `get_llm_credentials()`, `run_session()`, captures real LLM inference timing |
| `lab/adaptive_explorer.py` | LLM-driven post-auth exploration | `get_next_command()`, `run_exploration_session()`, context-aware command selection |
| `lab/Dockerfile` | Lab attacker container — paramiko + anthropic | |

### Models (`ml/src/models/`)

| File | Purpose | Key Classes |
|---|---|---|
| `random_forest.py` | scikit-learn RandomForest wrapper | `RandomForestModel`: `train()`, `predict()` → `(category, confidence, importances)`, `save()`, `load()` |
| `gradient_boosted.py` | XGBoost + LightGBM wrappers | `XGBoostModel`, `LightGBMModel` — same interface. Both use early stopping with 10% validation split. |
| `sequence_model.py` | PyTorch CNN + LSTM for AI detection | `AttackSequenceCNN` (multi-kernel 1D conv), `AttackSequenceLSTM` (bidirectional 2-layer), `session_to_sequence()` |
| `model_registry.py` | Versioned model management | `ModelRegistry`: `load(name, version, feature_set)`, `list_models()`, `get_active()`, `set_active()`. Reads `active_model.json`. |

### Training (`ml/src/training/`)

| File | Purpose | CLI |
|---|---|---|
| `train_classifier.py` | Train flow classifiers (RF, XGBoost, LightGBM) | `--data-dir`, `--feature-set intersection\|full`, `--honeypot-dir` |
| `train_ai_detector.py` | Train AI detection models (CNN, LSTM, XGBoost) | `--human-dir`, `--ai-dir`, `--epochs` |
| `hyperparameter_search.py` | RandomizedSearchCV on Random Forest | `--data-dir` |

### Evaluation (`ml/src/evaluation/`)

| File | Purpose | Outputs |
|---|---|---|
| `evaluate.py` | Flow classifier evaluation — confusion matrices, ROC curves, feature importances | `evaluation/plots/*.png`, `evaluation/metrics.json` |
| `evaluate_ai_detector.py` | AI detector evaluation — all 3 models side-by-side, ROC + PR curves, XGBoost feature importance | `evaluation/plots/ai_detection/*.png`, `evaluation/ai_detection_metrics.json` |
| `benchmark.py` | Inference latency — single sample, batch, memory | Prints median/p99 µs, pass/fail vs 5ms target |

### Servers (`ml/src/`)

| File | Purpose | Protocol |
|---|---|---|
| `server.py` | Unix socket inference server for flow classification | 4-byte BE length prefix + protobuf FeatureVector → Classification |
| `ai_detect_server.py` | HTTP endpoint for AI agent detection | `POST /ml/ai-detect` (JSON features → `{isAiAgent, confidence, model}`), `GET /health` |

### Tests (`ml/tests/`)

| File | Tests |
|---|---|
| `test_data_loaders.py` | Feature set subset check, counts (16/31), label mapping, preprocessor NaN/Inf/deterministic/save-load |
| `test_models.py` | RF/XGBoost/LightGBM train+predict, save+load, confidence range, importance types |
| `test_inference.py` | protobuf_to_array ordering (both feature sets), syn_ack_ratio zero division, wire protocol framing |
| `test_behavioral_features.py` | All 24 features present, no NaN, low CV for regular timing, high CV for irregular, credential diversity, command features |
| `test_ai_detector.py` | CNN/LSTM forward pass (batch + single), output range [0,1], save/load, session_to_sequence shape/padding |

### Notebooks (`ml/notebooks/`)

| File | Content |
|---|---|
| `01_eda_cicids.ipynb` | Class distribution, feature correlation heatmap |
| `02_model_comparison.ipynb` | Side-by-side model evaluation scaffold |
| `03_ai_agent_analysis.ipynb` | HUMAN vs AI_AGENT timing histograms, t-SNE visualization |

---

## The Lens (`lens/`) — React Dashboard

### Core

| File | Purpose |
|---|---|
| `App.tsx` | Router — protected routes, Layout wrapper, 9 page routes |
| `main.tsx` | React entry point — BrowserRouter + StrictMode |
| `index.css` | Tailwind imports |

### Components (`lens/src/components/`)

| File | Purpose | Data Source | Key Features |
|---|---|---|---|
| `Layout.tsx` | Shell — sidebar nav (7 links), header (WS status, role badge, logout) | useWebSocket | NavLink active states, green/red connection dot |
| `Login.tsx` | JWT login form | `POST /auth/login` | Error display, redirect on success |
| `StatsOverview.tsx` | Stat cards + charts | `GET /events/stats`, `GET /blocks`, WebSocket | 5 stat cards, PieChart (category), BarChart (tier), AreaChart (timeline), 60s auto-refresh |
| `AttackFeed.tsx` | Live event table + historical pagination | WebSocket + `GET /events` | 4 filters (category, tier, confidence slider, IP search), pagination (Previous/Next), source icons (Bot/Cloud/Shield), confidence bar, tier badge |
| `EventDetail.tsx` | Single event deep-dive | `GET /events/{id}`, `GET /incidents`, `GET /actions` | 12-field grid, feature importances BarChart, related incidents, response actions |
| `ResponseLog.tsx` | Active blocks + action history | `GET /blocks`, `GET /actions` | Live countdown timers (MM:SS), unblock button (Admin), action history table |
| `ManualOverride.tsx` | Pending approvals + open incidents | `GET /incidents?resolved=false` | Approve/Reject buttons (Admin), pending vs open split |
| `ThreatMap.tsx` | 3D rotating globe with threat markers | `GET /events/geo` | Three.js scene: sphere body, TopoJSON boundaries, InstancedMesh markers, Raycaster tooltips, arc lines, mouse drag/zoom, ResizeObserver |
| `IncidentDetail.tsx` | Single incident deep-dive | `GET /incidents/{id}` | 9-field grid, timeline visualization (Detected→Action→Resolved), notes form, resolve button |
| `PlaybookEditor.tsx` | Playbook configuration | `GET/PUT /playbooks` | Inline edit (confidence, TTL, enabled), Admin-only edit button |
| `ModelMetrics.tsx` | Classification performance | `GET /events/stats`, `GET /incidents` | Total classifications, rejected recommendations, ACT-tier count, AI agent detections, category BarChart |

### Hooks (`lens/src/hooks/`)

| File | Purpose | Returns |
|---|---|---|
| `useWebSocket.ts` | WebSocket connection + reconnect + backfill | `{ events, connected, error }` — 200-event rolling buffer, exponential backoff (1s→30s), REST backfill on reconnect |
| `useApi.ts` | Generic REST fetcher with loading/error state | `{ data, loading, error, refresh }` |

### Services (`lens/src/services/`)

| File | Purpose | Key Functions |
|---|---|---|
| `api.ts` | Typed REST client — JWT injection, 401 redirect | 15 functions: `getEvents`, `getEvent`, `getEventStats`, `getGeoEvents`, `getIncidents`, `approveIncident`, `rejectIncident`, `getPlaybooks`, `updatePlaybook`, `getActiveBlocks`, `unblockIp`, `getActions`, `getActiveThreats`, `getIncident`, `updateIncident` |
| `auth.ts` | JWT token management | `login()`, `logout()`, `getToken()`, `getRole()`, `isAdmin()` — localStorage-based |

### Types (`lens/src/types/`)

| File | Interfaces |
|---|---|
| `events.ts` | `SecurityEvent`, `IncidentReport`, `ResponseAction`, `Playbook`, `ActiveBlock`, `GeoThreat`, `EventStats`, `Page<T>` |

### Utils (`lens/src/utils/`)

| File | Purpose | Key Functions |
|---|---|---|
| `globe.ts` | Three.js globe utilities | `latLngToVector3()`, `buildBoundaryGeometry()` (GeoJSON→LineSegments), `buildArcGeometry()` (QuadraticBezierCurve3), `topoToGeo()` (TopoJSON decoder) |
| `geoip.ts` | Category color mapping | `CATEGORY_COLORS` (14 categories), `getCategoryColor()`, `getCategoryHex()` |

---

## The Oracle (`oracle/`) — Python Cloud Agent

| File | Purpose | Key Symbols |
|---|---|---|
| `src/main.py` | Entry point — S3 polling loop, graceful no-op without AWS creds | `poll_cycle()`, `load_state()`, `save_state()` |
| `src/config.py` | Env-var config | `AWS_REGION`, `FLOW_LOG_BUCKET`, `CLOUDTRAIL_BUCKET`, `CITADEL_URL`, `JWT_TOKEN`, `SNS_TOPIC_ARN`, `SECURITY_EVENTS` list |
| `src/ingestors/vpc_flow_logs.py` | VPC Flow Log parser + S3 polling | `FlowRecord` dataclass, `parse_flow_log_line()`, `parse_flow_log_file()`, `aggregate_flows()`, `poll_s3()` |
| `src/ingestors/cloudtrail.py` | CloudTrail parser + S3 polling | `CloudTrailEvent` dataclass, `parse_cloudtrail_file()`, `filter_security_events()`, `poll_s3()` |
| `src/features/cloud_features.py` | Cloud feature extraction + rule-based classifier | `extract_flow_features()` (→INTERSECTION_FEATURES), `extract_cloudtrail_features()` (12 features), `classify_cloudtrail_event()` (9 rules for IAM_ESCALATION/RESOURCE_ABUSE/DATA_EXPOSURE) |
| `src/classifier.py` | Classification orchestrator | `classify_flow()` (ML fallback), `classify_cloudtrail()` (rules first) |
| `src/dispatcher.py` | REST dispatch to Citadel + SNS publish | `dispatch_event()`, `dispatch_batch()`, `build_event()`, `_maybe_publish_sns()` (IAM_ESCALATION/RESOURCE_ABUSE at ≥0.85) |
| `tests/test_vpc_flow_logs.py` | 6 tests: parse valid/malformed, file parsing, aggregation, internal filtering |
| `tests/test_cloudtrail.py` | 4 tests: parse valid JSON, security filter, missing fields, empty records |
| `tests/test_cloud_features.py` | 6 tests: flow feature mapping, CloudTrail features, 3 rule-based classifiers, no-match |
| `tests/fixtures/sample_flow_log.txt` | 5-line sample VPC Flow Log (header + 4 records) |
| `tests/fixtures/sample_cloudtrail.json` | 3-event sample CloudTrail (AttachUserPolicy, RunInstances, ListBuckets) |

---

## The Ward (`ward/`) — Chrome Extension

| File | Purpose | Key Symbols |
|---|---|---|
| `manifest.json` | Manifest V3 — permissions, content scripts, service worker, popup |
| `src/background/service-worker.ts` | Background processing — score computation, badge updates, warning triggers, Citadel dispatch, threat IP enrichment | `tabResults` Map, `threatIps` array, badge color/text logic, `initBlocklist()` call |
| `src/content/page-analyzer.ts` | Content script — URL/DOM/script/resource analysis on every page | `analyzePage()` → `PageAnalysis`, `injectWarningBanner()` (shadow DOM) |
| `src/content/phishing-detector.ts` | Phishing heuristics | `levenshtein()`, `detectPhishing()` → `PhishingSignals`, 17 high-value targets, 8 urgency patterns, 11 suspicious TLDs |
| `src/shared/threat-scorer.ts` | Weighted 0-100 scoring | `computeThreatScore(analysis)` → `ThreatResult { score, level, reasons }` |
| `src/shared/blocklist.ts` | ~500 bundled domains + remote fetch + user custom | `isBlocklisted()`, `isKnownCDN()`, `addToBlocklist()`, `getBlocklist()`, `initBlocklist()` (fetches remote list, caches in chrome.storage) |
| `src/shared/api-client.ts` | Connected mode — Citadel dispatch + threat IP enrichment | `dispatchThreatEvent()` (rate-limited 1/domain/10min), `fetchActiveThreatIps()`, `detectCategory()` |
| `src/shared/types.ts` | TypeScript interfaces | `PageAnalysis`, `PhishingSignals`, `ThreatResult` |
| `src/popup/Popup.tsx` | Popup UI — score gauge, reasons, history, connection status | React with `chrome.storage.session` reads |
| `src/popup/Settings.tsx` | Settings page (new tab) — Citadel config, blocklist management | Test connection, connect/disconnect, add domain, import/export JSON |
| `src/popup/popup.html` | Popup HTML shell | |
| `icons/icon.svg` | Providence eye SVG icon | |
| `scripts/generate-icons.js` | SVG → PNG conversion (16/48/128px) | Uses sharp or canvas, with manual fallback instructions |
| `tests/test-phishing-detector.ts` | 7 tests: Levenshtein, paypai.com flagged, google.com safe, urgency, TLD |
| `tests/test-page-analyzer.ts` | 5 tests: blocklist exact/subdomain, clean domain, CDN allowlist |
| `tests/test-threat-scorer.ts` | 5 tests: clean=0, blocklisted=100, phishing combine, cap at 100, reasons |
| `STORE_LISTING.md` | Chrome Web Store listing draft — name, descriptions, privacy policy |

---

## Infrastructure (`infra/`)

| File | Purpose | Key Resources |
|---|---|---|
| `modules/monitoring/main.tf` | VPC Flow Logs → S3, CloudTrail → S3, Oracle IAM role, Providence NACL | `aws_flow_log`, `aws_cloudtrail`, `aws_s3_bucket` ×2, `aws_iam_role`, `aws_network_acl` |
| `modules/remediation/main.tf` | Lambda functions + SNS + IAM roles | 3× `aws_lambda_function`, 3× `aws_iam_role`, `aws_sns_topic`, `data "archive_file"` ×3 |
| `modules/remediation/revoke_iam_credentials.py` | Lambda: deactivate IAM access keys | `handler(event, context)` — `iam.update_access_key(Status="Inactive")` |
| `modules/remediation/terminate_suspicious_instance.py` | Lambda: stop + quarantine EC2 instance | `handler(event, context)` — `ec2.stop_instances()`, `ec2.create_tags()` |
| `modules/remediation/sns_alert_publisher.py` | Lambda: publish formatted alert to SNS | `handler(event, context)` — `sns.publish()` |
| `environments/monitoring/main.tf` | Environment config — wires monitoring + remediation modules | Variables: `vpc_id`, `account_id`, `alert_email` |

---

## CI/CD (`.github/workflows/`)

| File | Triggers | Steps |
|---|---|---|
| `ci-eye.yml` | `eye/**`, `proto/**` | apt install deps → cmake build → ctest |
| `ci-citadel.yml` | `citadel/**`, `proto/**` | setup-java 21 → mvn verify → docker compose build |
| `ci-ml.yml` | `ml/**`, `proto/**` | setup-python 3.12 → torch CPU-only → pip install → protoc → pytest → ruff |
| `ci-lens.yml` | `lens/**` | setup-node 20 → npm ci → npm build → eslint |
| `ci-oracle.yml` | `oracle/**` | setup-python 3.12 → pip install → pytest → ruff |
| `ci-ward.yml` | `ward/**` | setup-node 20 → npm ci → npm test → npm build |
| `ci-all.yml` | push to `main` | Calls all 6 component workflows |

---

## Scripts (`scripts/`)

| File | Purpose |
|---|---|
| `e2e_test.sh` | End-to-end pipeline test: start stack → Eye → generate traffic → query Citadel → assert events |
| `bench_citadel.sh` | REST API latency benchmark: 100 curl requests, reports p50/p99/avg |

---

## Documentation (`docs/`)

| File | Purpose |
|---|---|
| `DEMO.md` | 10-step demo reproduction guide |
| `BENCHMARKS.md` | Performance benchmark template (Eye, ML, Citadel, Lens) with hardware section |
| `PFCTL_SETUP.md` | macOS pfctl anchor configuration for PfctlFirewallManager |
| `RESUME.md` | 8 resume bullet points summarizing the project |
