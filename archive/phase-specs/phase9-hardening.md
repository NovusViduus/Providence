# Phase 9: Hardening & Portfolio Polish

> Providence Network Security Intelligence Platform
> Component: Cross-cutting polish, hardening, documentation, and demo readiness
> Timeline: Weeks 23–24
> Prerequisites: All 8 implementation phases complete

---

## Goal

Make Providence portfolio-ready. Fix every gap that would make a reviewer question the project's completeness. Harden for credibility. Write the README that sells the project in 30 seconds. Record the demo video. Ship.

---

## Deliverable

A portfolio-ready project with >80% test coverage on critical paths, all components runnable via a single `docker-compose up`, comprehensive README with architecture diagrams and setup instructions, a demo video, performance benchmarks documented, and every rough edge from Phases 1-8 smoothed.

---

## Tasks

### Task 1: Fix Blockers — CI, Compose, and Icons

These are items that signal incompleteness if left unfixed.

**Requirements:**
- [ ] 🤖 **Kiro: Eye CI pipeline** — create `.github/workflows/ci-eye.yml`:
  ```yaml
  name: CI — Eye
  on:
    push:
      paths: ['eye/**', 'proto/**']
    pull_request:
      paths: ['eye/**', 'proto/**']
  jobs:
    build-and-test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - name: Install dependencies
          run: |
            sudo apt-get update && sudo apt-get install -y \
              cmake build-essential pkg-config libpcap-dev libssl-dev \
              protobuf-compiler libprotobuf-dev
        - name: Build
          run: cd eye && cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j$(nproc)
        - name: Test
          run: cd eye/build && ctest --output-on-failure
  ```
- [ ] 🤖 **Kiro: Oracle in docker-compose.yml** — add service:
  ```yaml
  oracle:
    build: ./oracle
    environment:
      - AWS_REGION=${AWS_REGION:-us-east-1}
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - CITADEL_URL=http://citadel:8080
      - CITADEL_JWT=${CITADEL_JWT}
      - FLOW_LOG_BUCKET=${FLOW_LOG_BUCKET:-providence-flow-logs}
      - CLOUDTRAIL_BUCKET=${CLOUDTRAIL_BUCKET:-providence-cloudtrail}
    depends_on:
      - citadel
  ```
  - Add graceful no-op behavior when AWS credentials are missing (log warning, skip polling, don't crash)
- [ ] 👤 **Graeme: Populate `.env` with real AWS credentials** for Oracle to function in docker-compose
- [ ] 🤖 **Kiro: Extension icon SVG + PNG generation**:
  - Create `ward/icons/icon.svg` — Providence eye symbol, dark background, cyan accent (`#00ffc8`)
  - Add build script or npm task to convert SVG → 16, 48, 128px PNGs (use `sharp` or `svg2png`)
  - Replace placeholder README with actual icon files
- [ ] 🤖 **Kiro: AWS SDK dependency in Citadel pom.xml**:
  ```xml
  <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>ec2</artifactId>
      <version>2.25.0</version>
  </dependency>
  ```
- [ ] 🤖 **Kiro: ESLint configs** for Lens and Ward:
  - `lens/.eslintrc.cjs` with TypeScript + React rules
  - `ward/.eslintrc.cjs` with TypeScript rules
  - Fix any lint errors that surface
  - Ensure CI lint steps pass

**Acceptance criteria:**
- All 6 CI pipelines pass (Eye, Citadel, ML, Lens, Oracle, Ward)
- `docker-compose up --build` starts all 6 services (Citadel, PostgreSQL, Redis, ML, Lens, Oracle)
- Extension loads in Chrome with real icons
- `mvn compile` succeeds in Citadel with AWS SDK present

---

### Task 2: Lens Polish — The Demo-Critical Fixes

These are what the demo video will show. A half-built dashboard kills the entire portfolio impression.

**Requirements:**
- [ ] 🤖 **Kiro: AttackFeed pagination** — add page buttons or infinite scroll:
  - "Load More" button at bottom that fetches next page via `GET /api/v1/events?page=N`
  - Or: infinite scroll with intersection observer
  - Show total count: "Showing 50 of 1,247 events"

- [ ] 🤖 **Kiro: AttackFeed filters** — add the missing three:
  - Tier dropdown (OBSERVE / RECOMMEND / ACT)
  - Min confidence slider (0.0 – 1.0, step 0.05)
  - Source IP text search (debounced 300ms, filters client-side for live events, server-side for historical)

- [ ] 🤖 **Kiro: StatsOverview timeline chart**:
  - Option A: client-side bucketing — take last 200 events from WebSocket buffer, group by hour, render as Recharts AreaChart
  - Option B: new Citadel endpoint `GET /api/v1/events/timeline?hours=24&buckets=24` returning `[{ hour, count, byCategory }]`
  - Option A is simpler and sufficient for the demo

- [ ] 🤖 **Kiro: StatsOverview auto-refresh**:
  - On new WebSocket event: increment stat counters in local state (don't re-fetch)
  - Full refresh from REST every 60 seconds (catch up if WS missed anything)

- [ ] 🤖 **Kiro: ResponseLog countdown timer**:
  - For each active block, compute `expiresAt - now` and display as `MM:SS` countdown
  - Update every second via `setInterval`
  - When expired: remove from list (or show "Expired — awaiting sweep")

- [ ] 🤖 **Kiro: ThreatMap arc lines** — wire the existing `buildArcGeometry`:
  - For each ACT-tier threat marker, render an arc from source location to a fixed point (configured home location, default Seattle: 47.6, -122.3)
  - Limit to 20 most recent ACT-tier arcs
  - Cyan color, low opacity (0.15), animated dash pattern if possible

- [ ] 🤖 **Kiro: EventDetail enhancements**:
  - Link to related incident (if exists): query `GET /api/v1/incidents?eventId={id}` or add a field
  - Response actions section: `GET /api/v1/actions?eventId={id}`
  - For Ward events: show URL, threat score, reasons instead of flow metadata

- [ ] 🤖 **Kiro: WebSocket reconnect backfill**:
  - On reconnect: `GET /api/v1/events?size=50&sort=timestamp,desc`
  - Merge with existing buffer, deduplicate by event ID

**Acceptance criteria:**
- AttackFeed shows paginated events with all 4 filters working
- StatsOverview has a timeline area chart that updates on new events
- Response log shows live countdowns on active blocks
- Globe shows arc lines from threat sources
- EventDetail links to incidents and shows response actions
- WebSocket reconnect fills the gap

---

### Task 3: Test Coverage & Hardening

**Requirements:**
- [ ] 🤖 **Kiro: Citadel security-aware integration tests**:
  - Add JWT token generation in test setup
  - All REST calls in tests include `Authorization: Bearer {test-token}`
  - Or: create a `test` Spring profile that disables security (simpler but less realistic)
  - Ensure existing 11+ tests still pass with security enabled

- [ ] 🤖 **Kiro: Citadel health check endpoint**:
  - `GET /actuator/health` (Spring Boot Actuator)
  - Add `spring-boot-starter-actuator` dependency
  - Checks: database connection, Redis connection
  - Used by Docker Compose `healthcheck` for the Citadel service

- [ ] 🤖 **Kiro: Citadel API rate limiting**:
  - Simple filter: max 100 requests/minute per IP for REST endpoints
  - Use a `HandlerInterceptor` with an in-memory `ConcurrentHashMap<String, AtomicInteger>` + scheduled reset
  - Or: nginx rate limiting in the Lens proxy (simpler, production-appropriate)
  - Return 429 Too Many Requests when exceeded

- [ ] 🤖 **Kiro: ML service health check**:
  - Add a `GET /health` endpoint to the Unix socket server (or a separate HTTP endpoint)
  - Returns: `{ status: "ok", model: "xgboost_intersection_v1", uptime: 3600 }`

- [ ] 🤖 **Kiro: Lens basic component tests** (currently 0 test files):
  - At minimum: test that `computeThreatScore` equivalent logic (if shared) works
  - Test that API client functions build correct URLs
  - Test that type definitions compile (TypeScript compilation is the test)
  - Don't aim for full React component testing — focus on utility/logic tests

- [ ] 🤖 **Kiro: Eye `caplen` vs `len` fix**:
  - Use `hdr->caplen` for payload bounds checking, not `hdr->len`
  - `caplen` is the number of bytes actually captured; `len` is the wire length
  - Reading beyond `caplen` is undefined behavior if snap length < wire length

**Acceptance criteria:**
- Citadel integration tests pass with JWT authentication active
- `GET /actuator/health` returns 200 with database + Redis status
- Rate limiting returns 429 after 100 requests/minute
- ML service responds to health check
- Eye uses `caplen` for safe bounds checking

---

### Task 4: Performance Benchmarks Documentation

**Requirements:**
- [ ] 🤖 **Kiro: Create `docs/BENCHMARKS.md` template** with sections, tables, and methodology placeholders for each component:

  **The Eye (C++):**
  - Throughput: packets/sec through `process_packet()` (from existing benchmark)
  - JA3 parsing: parses/sec through `parse_ja3()`
  - DNS parsing: parses/sec through `parse_dns_query()`
  - Ring buffer: push/pop operations/sec
  - End-to-end: capture → extract → classify → dispatch latency

  **ML Service (Python):**
  - Single inference latency: median and p99 (from existing benchmark)
  - Batch inference: 100, 1000, 10000 samples
  - Model load time
  - Memory footprint per model

  **The Citadel (Java):**
  - gRPC ingestion throughput: events/sec
  - REST query latency: p50 and p99 for `GET /api/v1/events`
  - WebSocket fan-out latency: event received to WebSocket broadcast

  **The Lens (React):**
  - Build size: total bundle KB
  - Time to interactive
  - Globe rendering FPS at 100/500 markers

- [ ] 🤖 **Kiro: Write benchmark runner scripts** where they don't already exist:
  - `scripts/bench_citadel.sh` — curl loop for REST latency, grpcurl for gRPC throughput
  - `scripts/bench_lens.sh` — `npm run build` output size, lighthouse CLI if available
  - Eye and ML benchmarks already exist (throughput_bench.cpp, benchmark.py)

- [ ] 👤 **Graeme: Run all benchmarks on your machine** and fill in the actual numbers in BENCHMARKS.md. Document: hardware (MacBook model, CPU, RAM), OS version, network conditions. Honest about what was measured on.

**Acceptance criteria:**
- BENCHMARKS.md exists with real numbers from actual runs
- Each component has at least 2 metrics
- Methodology documented (how measured, on what hardware)

---

### Task 5: README & Documentation

**Requirements:**
- [ ] 🤖 **Kiro: Root `README.md` rewrite** — this is the first thing anyone sees:

  **Header:**
  - Project name, tagline (*Per Providentiam, Securitas*), one-sentence description
  - Status badges: CI status for each component (6 badges)

  **Architecture diagram:**
  - The high-level component diagram from the design doc (ASCII or embedded image)
  - Shows all 6 components + data flow arrows

  **Quick start:**
  ```bash
  # Prerequisites: Docker, Docker Compose
  git clone https://github.com/NovusViduus/providence.git
  cd providence
  docker-compose up --build
  # Dashboard: http://localhost:3000
  # Login: admin / providence (default)
  ```
  - 4 commands to a working dashboard

  **Component table:**
  - Same table from the design doc: component, codename, tech, status (all green now)

  **Demo video:**
  - Placeholder link — Graeme fills in after recording

  **Technology decision rationale:**
  - Brief "why C++ for capture, why Java for backend, why Python for ML" — 2-3 sentences each

  **Model performance summary:**
  - Link to MODEL_EVALUATION.md
  - Key numbers: best model, macro F1, inference latency (placeholder until benchmarks run)

  **Documentation links:**
  - DESIGN.md, MODEL_EVALUATION.md, AI_DETECTION.md, BENCHMARKS.md, ETHICS.md

  **License:** MIT

- [ ] 🤖 **Kiro: Update component READMEs** — each component directory gets a brief README:
  - `eye/README.md`: build instructions, CLI usage, architecture overview
  - `citadel/README.md`: build, run, API reference summary
  - `ml/README.md`: training, evaluation, inference server
  - `lens/README.md`: dev server, build, environment variables
  - `oracle/README.md`: configuration, AWS prerequisites
  - `ward/README.md`: build, load unpacked, Chrome Web Store

- [ ] 🤖 **Kiro: `docs/DEMO.md`** — step-by-step instructions for reproducing the demo:
  1. Start the stack: `docker-compose up --build`
  2. Open dashboard: `http://localhost:3000`, login as admin
  3. Start The Eye: `./eye lo0` (captures loopback traffic)
  4. Generate test traffic: `curl`, `nmap`, simulated brute force
  5. Watch events appear in real-time on AttackFeed
  6. See threat markers appear on the globe
  7. See automated response actions in ResponseLog
  8. Approve a RECOMMEND-tier event manually
  9. View model metrics and playbook configuration
  10. (Optional) Connect The Ward extension and visit a test phishing page

- [ ] 🤖 **Kiro: pfctl setup documentation** (missing since Phase 4):
  - Add `docs/PFCTL_SETUP.md` or a section in `eye/README.md`
  - Document: `/etc/pf.conf` anchor, `/etc/pf.anchors/providence`, reload command
  - Include the exact pf rules from the Phase 4 spec

- [ ] 👤 **Graeme: Verify README renders correctly on GitHub** after push — check badges, diagram, links
- [ ] 👤 **Graeme: Walk through DEMO.md** on a clean machine (or after `docker system prune`) to verify it's reproducible

**Acceptance criteria:**
- Root README renders correctly on GitHub with badges, diagram, quick start
- Each component has a README with build/run instructions
- DEMO.md is reproducible by someone with Docker and a terminal
- pfctl setup is documented

---

### Task 6: Demo Video

> This task is entirely 👤 Graeme — requires screen recording, narration decisions, and upload.

**Requirements:**
- [ ] 👤 **Graeme: Record a screen capture demo** (3-5 minutes) showing:

  **Setup (30 seconds):**
  - `docker-compose up` → services starting
  - Browser opens to login page → admin login → dashboard loads

  **Live detection (90 seconds):**
  - Terminal: start The Eye on loopback
  - Terminal: generate attack traffic (nmap scan, curl requests, simulated brute force)
  - Dashboard: events appearing in real-time on AttackFeed
  - Dashboard: globe rotating with threat markers appearing
  - Dashboard: StatsOverview updating

  **Response engine (60 seconds):**
  - Event classified as BRUTE_FORCE with confidence 0.92 → ACT tier
  - ResponseLog: block appears with countdown timer
  - IncidentDetail: incident report with playbook details
  - ManualOverride: approve a RECOMMEND-tier event

  **Cloud + browser (30 seconds):**
  - Show Oracle events with cloud icon (if AWS configured)
  - Show Ward extension: popup on a test page, warning banner on a phishing test page

  **Close (30 seconds):**
  - Overview of architecture (point to README diagram)
  - ModelMetrics showing classification stats

- [ ] 👤 **Graeme: Upload to YouTube** (unlisted) or Vimeo
- [ ] 👤 **Graeme: Add link to root README** and DEMO.md
- [ ] 👤 **Graeme: Take 2-3 screenshots** for the Chrome Web Store listing

**Acceptance criteria:**
- Video is 3-5 minutes, shows the full pipeline working
- No dead time, no errors visible
- Link in README works

---

### Task 7: Remaining Low-Priority Gaps

Work through these in priority order. Skip any that don't add portfolio value.

**Requirements:**
- [ ] 🤖 **Kiro: Citadel CRITICAL_ALERT persisted to response_actions** — currently logged but not in the audit trail DB table
- [ ] 👤 **Graeme: Oracle SNS publish** — verify it works end-to-end with real AWS credentials and your SNS topic
- [ ] 🤖 **Kiro: Oracle Lambda zip packaging** — add `data "archive_file"` blocks in Terraform or a `Makefile` target
- [ ] 🤖 **Kiro: Oracle EventBridge rules** — wire Lambda triggers from SNS or EventBridge events in Terraform
- [ ] 🤖 **Kiro: Oracle NACL Terraform resource** — add `aws_network_acl` + `aws_network_acl_rule` to monitoring module
- [ ] 🤖 **Kiro: Ward blocklist import/export** — JSON download/upload buttons in Settings page
- [ ] 🤖 **Kiro: Ward threat IP enrichment** — wire `fetchActiveThreatIps()` into scoring pipeline, boost score by 15 if page loads resources from a known threat IP
- [ ] 🤖 **Kiro: ML XGBoost/LightGBM early stopping** — add validation set split, `early_stopping_rounds=20`
- [ ] 🤖 **Kiro: ML XGBoost feature importance in AI detector eval** — `model.feature_importances_` → bar chart saved to plots
- [ ] 🤖 **Kiro: Lens IncidentDetail timeline visualization** — simple horizontal timeline with 3 dots (detected → action → resolved) and timestamps
- [ ] 🤖 **Kiro: Eye `caplen` fix** — use `hdr->caplen` for bounds, not `hdr->len`

**Acceptance criteria:**
- Each item checked off produces a passing build
- No regressions in existing tests

---

### Task 8: Unified CI & Final Validation

**Requirements:**
- [ ] 🤖 **Kiro: Unified CI workflow** — `.github/workflows/ci-all.yml`:
  ```yaml
  name: CI — All Components
  on:
    push:
      branches: [main]
  jobs:
    eye:
      uses: ./.github/workflows/ci-eye.yml
    citadel:
      uses: ./.github/workflows/ci-citadel.yml
    ml:
      uses: ./.github/workflows/ci-ml.yml
    lens:
      uses: ./.github/workflows/ci-lens.yml
    oracle:
      uses: ./.github/workflows/ci-oracle.yml
    ward:
      uses: ./.github/workflows/ci-ward.yml
  ```
  - All 6 component CIs run on push to main
  - Individual CIs still run on component-specific path changes

- [ ] 🤖 **Kiro: Resume bullet points** — write in `docs/RESUME.md`:
  - "Built a multi-component network security platform (C++, Java, Python, TypeScript) with real-time intrusion detection, ML classification (F1 > 0.95), and automated response"
  - "Implemented a C++ packet capture engine processing 100K+ packets/sec with lock-free ring buffer, TLS fingerprinting, and protobuf serialization"
  - "Trained attack classifiers (Random Forest, XGBoost, LightGBM) on CICIDS2017 + live honeypot data with documented two-model strategy avoiding train/serve skew"
  - "Designed a tiered autonomous response engine (Observe → Recommend → Act) with TTL-based auto-expiry, cross-platform firewall abstraction, and full audit trail"
  - "Built experimental AI-agent detection module using LSTM/CNN sequence models on LLM-generated synthetic attack data with 9 documented limitations"
  - "Deployed AWS cloud monitoring (VPC Flow Logs, CloudTrail) with Lambda remediation, Terraform IaC, and a 3D threat visualization globe"

- [ ] 👤 **Graeme: Final validation sweep**:
  - `docker-compose up --build` → all services healthy
  - Login to dashboard → events visible
  - Run `scripts/e2e_test.sh` → passes
  - Load Ward extension → popup works, icons display
  - All 6 CI pipelines green on GitHub
  - README renders correctly on GitHub
  - Demo video link works
  - Walk through DEMO.md start to finish

- [ ] 👤 **Graeme: Commit history cleanup**:
  - Squash fixup commits if needed
  - Ensure commit messages are meaningful throughout
  - Tag release: `git tag v1.0.0 && git push origin v1.0.0`

- [ ] 👤 **Graeme: Chrome Web Store submission** (if desired):
  - $5 developer registration fee
  - Upload production zip from `ward/dist/`
  - Submit screenshots from Task 6
  - Address any review feedback

**Acceptance criteria:**
- Unified CI runs all 6 components on main branch push
- `v1.0.0` tag exists
- Resume bullet points written in `docs/RESUME.md`
- Final validation sweep passes all checks
- Chrome Web Store submitted (or documented as ready to submit)

---

## Verification Checklist

When Phase 9 is complete, all of the following must be true:

**🤖 Kiro deliverables:**
- [ ] All 6 CI pipelines pass independently and via unified workflow
- [ ] `docker-compose up --build` starts all services (Citadel, PostgreSQL, Redis, ML, Lens, Oracle)
- [ ] Extension has real icon PNGs (SVG source + build script)
- [ ] Dashboard: AttackFeed paginated with 4 filters
- [ ] Dashboard: StatsOverview has timeline chart with auto-refresh
- [ ] Dashboard: ResponseLog shows countdowns
- [ ] Dashboard: Globe renders arc lines
- [ ] Dashboard: EventDetail links to incidents and actions
- [ ] Citadel: health check returns 200
- [ ] Citadel: rate limiting returns 429 on excess
- [ ] Citadel: tests pass with JWT auth active
- [ ] Root README has badges, diagram, quick start, demo video placeholder
- [ ] DEMO.md written with step-by-step instructions
- [ ] BENCHMARKS.md template with benchmark runner scripts
- [ ] Resume bullet points in `docs/RESUME.md`
- [ ] pfctl setup documented
- [ ] `caplen` fix applied in Eye
- [ ] ESLint configs for Lens and Ward, CI lint passes

**👤 Graeme deliverables:**
- [ ] AWS credentials populated in `.env` for Oracle
- [ ] Benchmarks run on actual hardware, numbers filled into BENCHMARKS.md
- [ ] Demo video recorded, uploaded, link added to README
- [ ] Screenshots taken for Chrome Web Store
- [ ] Final validation sweep passed (docker-compose, dashboard, e2e test, extension)
- [ ] README verified rendering on GitHub
- [ ] DEMO.md walked through on clean environment
- [ ] Commit history cleaned, `v1.0.0` tagged
- [ ] Chrome Web Store submitted (optional)
- [ ] Oracle SNS publish verified with real AWS
