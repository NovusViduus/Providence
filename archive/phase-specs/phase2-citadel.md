# Phase 2: The Citadel — Foundation

> Providence Network Security Intelligence Platform
> Component: The Citadel — Java Spring Boot Backend API
> Timeline: Weeks 5–6
> Prerequisite: Phase 1 (The Eye) complete

---

## Goal

Backend receives classified events from The Eye (gRPC), stores them in PostgreSQL, caches active threat state in Redis, broadcasts to WebSocket subscribers via Redis pub/sub, and exposes a REST API for querying. The response orchestration engine is scaffolded with tier logic but does not execute firewall actions (that's Phase 4). Everything runs in Docker Compose.

---

## Deliverable

A Dockerized Spring Boot API that receives, stores, serves, and broadcasts security events. Three containers (app, PostgreSQL, Redis) running via `docker-compose up`. Integration tests pass.

---

## Context

### Upstream Contract (from Phase 1)

The Eye sends `ClassifiedEvent` messages via gRPC, defined in `proto/event.proto`:

```protobuf
// proto/event.proto
syntax = "proto3";
package providence;

message Classification {
  string category = 1;      // BENIGN, DOS, PROBE, BRUTE_FORCE, INJECTION, EXFILTRATION, AI_AGENT
  string subcategory = 2;
  float confidence = 3;
  map<string, float> feature_importances = 4;
}

message ClassifiedEvent {
  string event_id = 1;
  int64 timestamp = 2;
  string source_ip = 3;
  int32 source_port = 4;
  string dest_ip = 5;
  int32 dest_port = 6;
  string protocol = 7;
  Classification classification = 8;
  string source_component = 9;   // "eye", "oracle", "ward"
  string ja3_hash = 10;
  float flow_duration = 11;
  int64 packet_count = 12;
  int64 byte_count = 13;
}

message EventAck {
  string event_id = 1;
  bool accepted = 2;
  string response_action = 3;   // OBSERVE, RECOMMEND, ACT
}

service EventService {
  rpc ReportEvent (ClassifiedEvent) returns (EventAck);
}
```

### Response Tier Thresholds

| Confidence | Tier | Behavior in Phase 2 |
|---|---|---|
| < 0.60 | OBSERVE | Store event, publish to Redis. No alert. |
| 0.60–0.85 | RECOMMEND | Store event, publish to Redis, flag as alert. No action executed. |
| > 0.85 | ACT | Store event, publish to Redis, flag as critical. Log intended action. No firewall execution (Phase 4). |

### Downstream Consumers (future phases)

- **The Lens (Phase 5):** Subscribes via WebSocket to Redis pub/sub channel for real-time feed. Queries REST API for historical data.
- **Response Engine (Phase 4):** `ResponseOrchestrator` and `PlaybookEngine` will call `FirewallManager` implementations. Phase 2 scaffolds the service classes with tier logic only.

---

## Tasks

### Task 1: Initialize Spring Boot Project

**Requirements:**
- [ ] Generate Spring Boot 3.x project with Java 21 (or 17 minimum)
- [ ] Dependencies in `pom.xml`: spring-boot-starter-web, spring-boot-starter-data-jpa, spring-boot-starter-websocket, spring-boot-starter-data-redis, grpc-spring-boot-starter (or net.devh:grpc-server-spring-boot-starter), postgresql driver, protobuf-java, spring-boot-starter-test, spring-boot-testcontainers
- [ ] Create package structure under `com.providence.citadel`: `api/`, `websocket/`, `service/`, `firewall/`, `model/`, `repository/`, `config/`
- [ ] Create `application.yml` with profiles: `default` (local dev), `docker` (compose), `test`
- [ ] Configure datasource, Redis, and gRPC server port in `application.yml`

**application.yml skeleton:**
```yaml
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/providence
    username: ${DB_USER:providence}
    password: ${DB_PASS:providence}
  jpa:
    hibernate:
      ddl-auto: validate
    show-sql: false
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}

grpc:
  server:
    port: 50051

server:
  port: 8080
```

**Acceptance criteria:**
- `mvn compile` succeeds with zero errors
- Application context loads in a test with `@SpringBootTest`

---

### Task 2: Database Schema & JPA Entities

**Requirements:**
- [ ] Create Flyway (preferred) or Liquibase migration for initial schema. Do NOT use `ddl-auto: create`.
- [ ] Design and create the following tables:

**`security_events` table:**
```sql
CREATE TABLE security_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        VARCHAR(64) NOT NULL UNIQUE,
    timestamp       TIMESTAMPTZ NOT NULL,
    source_ip       INET NOT NULL,
    source_port     INTEGER NOT NULL,
    dest_ip         INET NOT NULL,
    dest_port       INTEGER NOT NULL,
    protocol        VARCHAR(10) NOT NULL,
    category        VARCHAR(32) NOT NULL,
    subcategory     VARCHAR(64),
    confidence      REAL NOT NULL,
    feature_importances JSONB,
    source_component VARCHAR(16) NOT NULL,
    ja3_hash        VARCHAR(32),
    flow_duration   REAL,
    packet_count    BIGINT,
    byte_count      BIGINT,
    response_tier   VARCHAR(16) NOT NULL,  -- OBSERVE, RECOMMEND, ACT
    response_action VARCHAR(255),           -- what was/would be done
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_timestamp ON security_events (timestamp DESC);
CREATE INDEX idx_events_source_ip ON security_events (source_ip);
CREATE INDEX idx_events_category ON security_events (category);
CREATE INDEX idx_events_confidence ON security_events (confidence);
CREATE INDEX idx_events_response_tier ON security_events (response_tier);
```

**`playbooks` table:**
```sql
CREATE TABLE playbooks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(128) NOT NULL UNIQUE,
    category        VARCHAR(32) NOT NULL,
    description     TEXT,
    actions         JSONB NOT NULL,          -- ordered list of response actions
    min_confidence  REAL NOT NULL DEFAULT 0.85,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    ttl_seconds     INTEGER NOT NULL DEFAULT 3600,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`incident_reports` table:**
```sql
CREATE TABLE incident_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES security_events(id),
    playbook_id     UUID REFERENCES playbooks(id),
    response_tier   VARCHAR(16) NOT NULL,
    actions_taken   JSONB NOT NULL,
    source_ip       INET NOT NULL,
    category        VARCHAR(32) NOT NULL,
    confidence      REAL NOT NULL,
    resolved        BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);
```

- [ ] Create JPA entity classes: `SecurityEvent.java`, `Playbook.java`, `IncidentReport.java`
- [ ] Create JPA repositories: `EventRepository.java` (extend `JpaRepository` + custom queries), `PlaybookRepository.java`
- [ ] Custom query methods needed:
  - `findByCategory(String category, Pageable pageable)`
  - `findBySourceIp(String ip, Pageable pageable)`
  - `findByResponseTier(String tier, Pageable pageable)`
  - `findByTimestampBetween(Instant start, Instant end, Pageable pageable)`
  - `findByConfidenceGreaterThanEqual(float threshold, Pageable pageable)`

**Acceptance criteria:**
- Flyway migration runs successfully against a clean PostgreSQL instance
- All entity classes map correctly (verified via integration test that persists and retrieves a `SecurityEvent`)
- Indexes exist on timestamp, source_ip, category, confidence, response_tier

---

### Task 3: gRPC Server Endpoint

**Requirements:**
- [ ] Generate Java stubs from `proto/event.proto` (protobuf-maven-plugin or protoc)
- [ ] Implement `EventServiceGrpc.EventServiceImplBase` as a Spring-managed `@GrpcService` bean
- [ ] `ReportEvent` RPC handler must:
  1. Validate the incoming `ClassifiedEvent` (non-null fields, valid category enum)
  2. Determine response tier based on confidence thresholds (< 0.60 → OBSERVE, 0.60–0.85 → RECOMMEND, > 0.85 → ACT)
  3. Persist the event to PostgreSQL via `EventService`
  4. Publish the event to Redis pub/sub channel `providence:events`
  5. Return `EventAck` with the assigned response tier
- [ ] Handle errors gracefully: return gRPC status codes (INVALID_ARGUMENT, INTERNAL) — never crash the server
- [ ] Log every received event at DEBUG level, every RECOMMEND/ACT event at INFO level

**Acceptance criteria:**
- A gRPC client (can use `grpcurl` or a test client) sends a `ClassifiedEvent` and receives an `EventAck` with correct tier
- The event appears in PostgreSQL after the call
- The event is published to the Redis channel (verified by a subscriber in test)

---

### Task 4: Response Orchestrator & Playbook Engine (Scaffold)

**Requirements:**
- [ ] `ResponseOrchestrator.java` — Spring `@Service` with method:
  ```java
  public ResponseDecision evaluate(SecurityEvent event)
  ```
  - Applies confidence thresholds to determine tier
  - For ACT tier: looks up matching playbook via `PlaybookEngine`
  - Returns a `ResponseDecision` record containing: tier, matched playbook (nullable), intended actions list
  - Does NOT execute any firewall/network actions — logs intended actions only
  - Absolute constraints enforced in code (comments + logic):
    - Never probe external systems
    - Never take irreversible action without human confirmation
    - Never modify non-local network config

- [ ] `PlaybookEngine.java` — Spring `@Service` with method:
  ```java
  public Optional<Playbook> match(SecurityEvent event)
  ```
  - Queries `PlaybookRepository` for enabled playbooks matching the event's category
  - Returns the highest-priority matching playbook (or empty if none)
  - Playbook `min_confidence` must be ≤ event confidence to match

- [ ] `IncidentReportGenerator.java` — Spring `@Service` with method:
  ```java
  public IncidentReport generate(SecurityEvent event, ResponseDecision decision)
  ```
  - Creates and persists an `IncidentReport` for ACT-tier events
  - Records the matched playbook, intended actions, source details

- [ ] Seed default playbooks via Flyway migration or `CommandLineRunner`:
  - DOS: rate limit source IP, TTL 1 hour
  - BRUTE_FORCE: block source IP, TTL 30 minutes
  - EXFILTRATION: block source IP, TTL 24 hours, critical alert
  - PROBE: observe (no auto-action, log only)
  - INJECTION: block source IP, TTL 1 hour
  - AI_AGENT: block source IP, TTL 24 hours, critical alert

**Acceptance criteria:**
- Unit test: event with confidence 0.45 → OBSERVE tier, no playbook matched
- Unit test: event with confidence 0.72 → RECOMMEND tier, playbook matched but not executed
- Unit test: event with confidence 0.92 category DOS → ACT tier, playbook matched, incident report generated, intended actions logged
- No actual firewall calls in any code path

---

### Task 5: REST API

**Requirements:**
- [ ] `EventController.java` — endpoints:

  | Method | Path | Description |
  |---|---|---|
  | GET | `/api/v1/events` | Paginated event list. Query params: `category`, `sourceIp`, `tier`, `minConfidence`, `from`, `to`, `page`, `size` |
  | GET | `/api/v1/events/{id}` | Single event by UUID |
  | GET | `/api/v1/events/stats` | Aggregate stats: count by category, count by tier, events in last hour/day |

- [ ] `PlaybookController.java` — endpoints:

  | Method | Path | Description |
  |---|---|---|
  | GET | `/api/v1/playbooks` | List all playbooks |
  | GET | `/api/v1/playbooks/{id}` | Single playbook |
  | PUT | `/api/v1/playbooks/{id}` | Update playbook (actions, thresholds, enabled) |

- [ ] `IncidentController.java` — endpoints:

  | Method | Path | Description |
  |---|---|---|
  | GET | `/api/v1/incidents` | Paginated incident list. Query params: `resolved`, `category`, `from`, `to` |
  | GET | `/api/v1/incidents/{id}` | Single incident |
  | PATCH | `/api/v1/incidents/{id}` | Update incident (resolve, add notes) |

- [ ] All endpoints return JSON
- [ ] Use `@RestControllerAdvice` for global exception handling (return proper HTTP status codes, not stack traces)
- [ ] Pagination via Spring `Pageable` (default page size 50, max 200)

**Acceptance criteria:**
- Integration test: POST a few events via gRPC, then GET `/api/v1/events` returns them ordered by timestamp descending
- Integration test: GET `/api/v1/events?category=DOS` filters correctly
- Integration test: GET `/api/v1/events/stats` returns correct counts
- Integration test: PUT `/api/v1/playbooks/{id}` updates and persists changes
- 404 returned for nonexistent resource IDs
- 400 returned for invalid query parameters

---

### Task 6: Redis Pub/Sub & WebSocket Foundation

**Requirements:**
- [ ] `RedisConfig.java`:
  - Configure `RedisMessageListenerContainer` subscribing to channel `providence:events`
  - Configure `RedisTemplate<String, String>` for publishing (JSON-serialized events)

- [ ] When a `ClassifiedEvent` is received via gRPC:
  1. Persist to PostgreSQL
  2. Serialize the event to JSON
  3. Publish to Redis channel `providence:events`

- [ ] `WebSocketConfig.java`:
  - Register WebSocket endpoint at `/ws/events`
  - Configure STOMP message broker (or raw WebSocket handler)

- [ ] `EventWebSocketHandler.java`:
  - Listens to Redis pub/sub channel
  - Forwards every published event to all connected WebSocket clients
  - Handles client connect/disconnect gracefully (no exceptions on stale sessions)

- [ ] Redis also caches active threat state:
  - Key pattern: `threat:active:{source_ip}` → JSON with latest event details, current tier, expiry
  - TTL based on playbook TTL or default 1 hour
  - `GET /api/v1/threats/active` REST endpoint returns all active threats from Redis (not PostgreSQL)

**Acceptance criteria:**
- Integration test: send event via gRPC → WebSocket client connected at `/ws/events` receives the event JSON within 1 second
- Integration test: active threat appears in Redis with correct TTL after an ACT-tier event
- Integration test: `GET /api/v1/threats/active` returns cached threats
- WebSocket handler does not throw when no clients are connected

---

### Task 7: Docker Compose

**Requirements:**
- [ ] `citadel/Dockerfile`:
  - Multi-stage build: Maven build stage → JRE runtime stage (Eclipse Temurin)
  - Final image exposes ports 8080 (REST/WS) and 50051 (gRPC)
  - Runs as non-root user

- [ ] `docker-compose.yml` at project root (or `citadel/docker-compose.yml`):
  ```yaml
  services:
    citadel:
      build: ./citadel
      ports:
        - "8080:8080"
        - "50051:50051"
      environment:
        - SPRING_PROFILES_ACTIVE=docker
        - DB_HOST=postgres
        - DB_PORT=5432
        - DB_USER=providence
        - DB_PASS=providence
        - REDIS_HOST=redis
        - REDIS_PORT=6379
      depends_on:
        postgres:
          condition: service_healthy
        redis:
          condition: service_healthy

    postgres:
      image: postgres:16-alpine
      environment:
        POSTGRES_DB: providence
        POSTGRES_USER: providence
        POSTGRES_PASSWORD: providence
      ports:
        - "5432:5432"
      volumes:
        - pgdata:/var/lib/postgresql/data
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U providence"]
        interval: 5s
        timeout: 3s
        retries: 5

    redis:
      image: redis:7-alpine
      ports:
        - "6379:6379"
      healthcheck:
        test: ["CMD", "redis-cli", "ping"]
        interval: 5s
        timeout: 3s
        retries: 5

  volumes:
    pgdata:
  ```

- [ ] `docker-compose up --build` starts all three services
- [ ] Flyway migrations run automatically on app startup
- [ ] Add a `docker-compose.test.yml` override for integration tests (ephemeral containers, no volumes)

**Acceptance criteria:**
- `docker-compose up --build` completes with all three services healthy
- `curl http://localhost:8080/api/v1/events` returns `200` with empty page
- `grpcurl -plaintext localhost:50051 list` shows `providence.EventService`
- `docker-compose down -v` tears down cleanly

---

### Task 8: Integration Tests

**Requirements:**
- [ ] Use Spring Boot Testcontainers for PostgreSQL and Redis (tests spin up real containers, not mocks)
- [ ] Test suite covers the full event lifecycle:

  1. **gRPC ingestion test:** Send a `ClassifiedEvent` via gRPC test client → verify it appears in PostgreSQL with correct tier assignment
  2. **REST query test:** Seed 20+ events with varied categories/confidences → verify filtering, pagination, sorting via REST endpoints
  3. **Stats endpoint test:** Seed known data → verify `/api/v1/events/stats` returns correct aggregates
  4. **Response orchestrator test:** Send events at each tier boundary (0.59, 0.60, 0.85, 0.86) → verify correct tier, playbook match, incident report creation
  5. **Playbook CRUD test:** Create/update/disable playbooks → verify orchestrator respects changes
  6. **Redis pub/sub test:** Send event via gRPC → verify message appears on Redis channel `providence:events`
  7. **Active threat cache test:** Send ACT-tier event → verify Redis key exists with TTL → verify REST endpoint returns it
  8. **WebSocket test:** Connect WebSocket client → send event via gRPC → verify client receives event

- [ ] All tests annotated with `@Testcontainers` and `@SpringBootTest`
- [ ] Tests are independent (each cleans up after itself or uses `@Transactional`)
- [ ] `mvn verify` runs all integration tests and exits cleanly

**Acceptance criteria:**
- `mvn verify` passes with ≥ 8 integration tests covering the scenarios above
- Tests run against real PostgreSQL 16 and Redis 7 via Testcontainers
- No test depends on external state or ordering
- Total test runtime < 2 minutes

---

### Task 9: CI Pipeline

**Requirements:**
- [ ] Create or update `.github/workflows/ci-citadel.yml`:
  ```yaml
  name: CI — Citadel
  on:
    push:
      paths:
        - 'citadel/**'
        - 'proto/event.proto'
        - 'proto/response.proto'
    pull_request:
      paths:
        - 'citadel/**'
        - 'proto/**'

  jobs:
    build-and-test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-java@v4
          with:
            distribution: temurin
            java-version: 21
        - name: Build and test
          run: cd citadel && mvn verify -B
        - name: Docker build smoke test
          run: docker compose build citadel
  ```
- [ ] CI must pass before any merge to main

**Acceptance criteria:**
- Push to `citadel/` triggers CI
- `mvn verify` and Docker build both succeed in CI
- Proto file changes also trigger the pipeline

---

## Scoped Out (Future Phases)

| Item | Phase |
|---|---|
| FirewallManager implementations (pfctl, iptables, cloud) | Phase 4 |
| JWT authentication & RBAC (Admin/Viewer roles) | Phase 5 |
| ML service integration (live classified events from Eye) | Phase 3 |
| Cloud event ingestion from The Oracle | Phase 7 |
| Full WebSocket dashboard integration | Phase 5 |
| Model deployment API (`/swap`, `/rollback`, `/shadow`) | Phase 3 |

---

## Architecture Reference

```
                    ┌─────────────────────────────────┐
                    │         THE CITADEL              │
                    │       (Spring Boot)              │
                    │                                  │
  Eye ──gRPC:50051──▶  EventService (gRPC)            │
                    │       │                          │
                    │       ▼                          │
                    │  ResponseOrchestrator            │
                    │   ├── OBSERVE  ──▶ store only    │
                    │   ├── RECOMMEND ─▶ store + alert │
                    │   └── ACT ───────▶ store + alert │
                    │       │          + incident rpt  │
                    │       │          + log action     │
                    │       ▼                          │
                    │  ┌──────────┐  ┌─────────┐      │
                    │  │PostgreSQL│  │  Redis   │      │
                    │  │(persist) │  │(pub/sub, │      │
                    │  │          │  │ cache)   │      │
                    │  └──────────┘  └────┬────┘      │
                    │                     │            │
  Lens ◀──WS:/ws/events──────────────────┘            │
  Lens ──REST:8080──▶  EventController                │
                    │  PlaybookController              │
                    │  IncidentController              │
                    └─────────────────────────────────┘
```

---

## Verification Checklist

When Phase 2 is complete, all of the following must be true:

- [ ] `docker-compose up --build` starts Citadel + PostgreSQL + Redis, all healthy
- [ ] `grpcurl -plaintext localhost:50051 providence.EventService/ReportEvent` accepts a ClassifiedEvent and returns an EventAck
- [ ] Events are persisted in PostgreSQL and queryable via REST
- [ ] Redis pub/sub publishes events on `providence:events` channel
- [ ] WebSocket at `/ws/events` streams events to connected clients
- [ ] Active threats are cached in Redis with TTL
- [ ] Response orchestrator correctly assigns OBSERVE / RECOMMEND / ACT tiers
- [ ] Default playbooks are seeded and matched by the PlaybookEngine
- [ ] Incident reports are generated for ACT-tier events
- [ ] `mvn verify` passes all integration tests (Testcontainers)
- [ ] CI pipeline passes on push to `citadel/` or `proto/`
- [ ] No firewall actions are executed — all response logic is log-only
