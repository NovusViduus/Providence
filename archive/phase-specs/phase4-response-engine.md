# Phase 4: Response Engine

> Providence Network Security Intelligence Platform
> Component: Autonomous Threat Response + Firewall Management
> Timeline: Weeks 10–11
> Prerequisites: Phase 2 (The Citadel) complete, Phase 3 (ML Pipeline) complete

---

## Goal

Wire the ResponseOrchestrator (scaffolded in Phase 2 as log-only) to execute real firewall actions. Implement PfctlFirewallManager for macOS and IptablesFirewallManager for Linux. Add TTL-based auto-expiry so all blocks are reversible. Run an integration test proving the full loop: simulated attack → detection → classification → auto-response → firewall rule applied → rule auto-expires.

---

## Deliverable

Autonomous threat response with a tiered confidence model. Two platform-specific firewall implementations (macOS pfctl, Linux iptables). All automated actions are time-limited and reversible. Integration test validates the attack → response → expiry cycle.

---

## Context

### What Already Exists (from Phase 2)

The Citadel already has:

- **`ResponseOrchestrator.java`** — Determines tier (OBSERVE / RECOMMEND / ACT) based on confidence thresholds. Currently logs intended actions but does not execute them.
- **`PlaybookEngine.java`** — Matches events to playbooks by category. Returns `Optional<Playbook>`.
- **`IncidentReportGenerator.java`** — Creates and persists incident reports for ACT-tier events.
- **`FirewallManager.java`** — Interface defined in the design doc but the `firewall/` package was not created in Phase 2 (nothing to put in it). Now it gets implemented.
- **Default playbooks seeded** via Flyway:
  - DOS → RATE_LIMIT, TTL 1 hour
  - BRUTE_FORCE → BLOCK, TTL 30 minutes
  - EXFILTRATION → BLOCK + CRITICAL_ALERT, TTL 24 hours
  - PROBE → OBSERVE (no auto-action)
  - INJECTION → BLOCK, TTL 1 hour
  - AI_AGENT → BLOCK + CRITICAL_ALERT, TTL 24 hours

### Tiered Response Model

| Confidence | Tier | Phase 4 Behavior |
|---|---|---|
| < 0.60 | OBSERVE | Store event, publish to Redis. No alert, no action. Unchanged from Phase 2. |
| 0.60–0.85 | RECOMMEND | Store, publish, flag alert. Generate recommended action. **Still no auto-execution** — awaits human confirmation via The Lens (Phase 5). |
| > 0.85 | ACT | Store, publish, critical alert. **Now executes playbook actions via FirewallManager.** Generates incident report. All actions have TTL and auto-expire. |

### Absolute Constraints (hard-coded, not configurable)

These are enforced in code, not just documented:

- NEVER probe external systems
- NEVER transmit adversarial payloads
- NEVER modify non-local or non-owned network config
- NEVER take irreversible action without human confirmation
- NEVER access or store packet payload content beyond classification
- All automated actions are reversible (TTL-based expiry)
- All automated actions are logged with full forensic context

### FirewallManager Interface (from design doc)

```java
public interface FirewallManager {
    Result blockIP(String ip, Duration ttl);
    Result rateLimit(String ip, int maxConnections);
    Result unblock(String ip);
    List<Rule> listRules();
}
```

---

## Tasks

### Task 1: FirewallManager Interface & Result Types

**Requirements:**
- [ ] Create `firewall/` package under `com.providence.citadel.firewall`
- [ ] `FirewallManager.java` — interface:
  ```java
  public interface FirewallManager {
      Result blockIP(String ip, Duration ttl);
      Result rateLimit(String ip, int maxConnections);
      Result unblock(String ip);
      List<Rule> listRules();
      String platformName(); // "pfctl", "iptables", "noop"
  }
  ```
- [ ] `Result.java` — record or class:
  ```java
  public record Result(
      boolean success,
      String action,       // "BLOCK", "RATE_LIMIT", "UNBLOCK"
      String ip,
      String detail,       // human-readable description of what was done
      Instant timestamp,
      Instant expiresAt    // nullable — null for UNBLOCK
  ) {}
  ```
- [ ] `Rule.java` — record:
  ```java
  public record Rule(
      String ip,
      String action,       // "BLOCK" or "RATE_LIMIT"
      Instant createdAt,
      Instant expiresAt,
      String source        // "playbook:DOS", "manual", etc.
  ) {}
  ```
- [ ] `NoopFirewallManager.java` — implementation that logs actions but does nothing:
  - All methods log at INFO level and return `Result(success=true, ...)`
  - Used in tests, CI, and environments where firewall control is not desired
  - This replaces the Phase 2 log-only behavior with a proper implementation behind the interface

**Acceptance criteria:**
- Interface compiles
- NoopFirewallManager passes a unit test: blockIP → returns success, listRules reflects the block, unblock → listRules is empty

---

### Task 2: PfctlFirewallManager (macOS)

**Requirements:**
- [ ] `PfctlFirewallManager.java` — implements `FirewallManager`:

  **blockIP:**
  1. Add IP to a pfctl table: `sudo pfctl -t providence_blocklist -T add <ip>`
  2. Verify the table exists; if not, create it (see setup below)
  3. Log the action with timestamp and TTL
  4. Return Result with `expiresAt = now + ttl`

  **rateLimit:**
  1. pfctl doesn't natively support per-IP rate limiting in a simple table operation
  2. Implementation approach: add IP to a separate table `providence_ratelimit` with a pf rule that limits connections (e.g., `max-src-conn 10, max-src-conn-rate 5/30`)
  3. Alternatively, document that rate limiting on macOS uses the same block mechanism with a shorter TTL as a pragmatic approximation
  4. Log the action

  **unblock:**
  1. `sudo pfctl -t providence_blocklist -T delete <ip>`
  2. Also check `providence_ratelimit` table
  3. Return Result

  **listRules:**
  1. `sudo pfctl -t providence_blocklist -T show`
  2. Parse output into `List<Rule>`

- [ ] **pfctl setup requirements** — document in README or setup script:
  - Providence needs a pf anchor and tables. Add to `/etc/pf.conf`:
    ```
    anchor "providence"
    load anchor "providence" from "/etc/pf.anchors/providence"
    ```
  - `/etc/pf.anchors/providence`:
    ```
    table <providence_blocklist> persist
    table <providence_ratelimit> persist
    block drop in quick on en0 from <providence_blocklist> to any
    pass in on en0 from <providence_ratelimit> to any \
        flags S/SA keep state \
        (max-src-conn 10, max-src-conn-rate 5/30, overload <providence_blocklist>)
    ```
  - `sudo pfctl -f /etc/pf.conf` to reload

- [ ] **Process execution:**
  - Use `ProcessBuilder` to run `pfctl` commands
  - Capture stdout and stderr
  - Check exit code — non-zero means failure
  - Handle "permission denied" gracefully (needs sudo / root)
  - Timeout: 5 seconds per command (pfctl should be instant)

- [ ] **Safety guards:**
  - Validate IP format before passing to pfctl (prevent command injection)
  - Never block private gateway IPs (10.0.0.1, 192.168.0.1, 192.168.1.1, etc.)
  - Never block loopback (127.0.0.1, ::1)
  - Never block the machine's own IP
  - Log every command executed (full command string) at INFO level

**Acceptance criteria:**
- On a macOS machine with pfctl configured, `blockIP("1.2.3.4", Duration.ofHours(1))` adds IP to the blocklist table
- `listRules()` shows the blocked IP
- `unblock("1.2.3.4")` removes it
- Attempting to block `127.0.0.1` returns `Result(success=false, detail="refused: loopback")`
- Attempting to block an invalid IP string returns `Result(success=false, detail="invalid IP format")`
- When pfctl is unavailable (Linux/CI), the manager fails gracefully with a clear error (not a crash)

---

### Task 3: IptablesFirewallManager (Linux)

**Requirements:**
- [ ] `IptablesFirewallManager.java` — implements `FirewallManager`:

  **blockIP:**
  1. Create a dedicated chain if it doesn't exist: `sudo iptables -N PROVIDENCE 2>/dev/null`
  2. Ensure chain is jumped to from INPUT: `sudo iptables -C INPUT -j PROVIDENCE 2>/dev/null || sudo iptables -I INPUT -j PROVIDENCE`
  3. Add rule: `sudo iptables -A PROVIDENCE -s <ip> -j DROP`
  4. Add comment for tracking: `sudo iptables -A PROVIDENCE -s <ip> -j DROP -m comment --comment "providence:block:<timestamp>:<expiresAt>"`
  5. Return Result with expiry

  **rateLimit:**
  1. Use `hashlimit` or `connlimit` module:
     `sudo iptables -A PROVIDENCE -s <ip> -p tcp --syn -m connlimit --connlimit-above <maxConn> -j DROP -m comment --comment "providence:ratelimit:<timestamp>:<expiresAt>"`
  2. Return Result

  **unblock:**
  1. Find and delete matching rules: `sudo iptables -D PROVIDENCE -s <ip> -j DROP`
  2. Handle "rule doesn't exist" gracefully
  3. Return Result

  **listRules:**
  1. `sudo iptables -L PROVIDENCE -n --line-numbers` with comment parsing
  2. Parse comment field to extract providence metadata (action, timestamps)
  3. Return `List<Rule>`

- [ ] **Same safety guards as pfctl:**
  - IP format validation
  - Gateway/loopback/self protection
  - Full command logging

- [ ] **Docker testing:**
  - Create `citadel/src/test/docker/Dockerfile.iptables-test`:
    ```dockerfile
    FROM ubuntu:24.04
    RUN apt-get update && apt-get install -y iptables iproute2 openjdk-21-jre-headless
    ```
  - Integration test spins up this container, runs IptablesFirewallManager inside it with `--cap-add=NET_ADMIN`
  - Verifies block/unblock/list cycle

**Acceptance criteria:**
- In a Docker container with NET_ADMIN capability, `blockIP` adds a DROP rule in the PROVIDENCE chain
- `listRules()` parses iptables output and returns structured rules
- `unblock()` removes the rule
- Same safety guards pass as PfctlFirewallManager
- Integration test runs in Docker, validates the full cycle

---

### Task 4: TTL-Based Auto-Expiry

**Requirements:**
- [ ] `BlockExpiryService.java` — Spring `@Service` with `@Scheduled` method:
  - Runs every 30 seconds (configurable via `application.yml`)
  - Scans active blocks from two sources:
    1. Redis active threat cache (`threat:active:*` keys with TTL)
    2. The firewall manager's `listRules()` output (for rules with embedded expiry timestamps)
  - For each expired block:
    1. Call `firewallManager.unblock(ip)`
    2. Remove the Redis active threat key if still present
    3. Update the incident report in PostgreSQL: set `resolved = true`, `resolved_at = now()`
    4. Log: `[EXPIRY] Unblocked <ip> — TTL expired (was blocked for <category> at <confidence>)`
    5. Publish expiry event to Redis `providence:events` channel (so dashboard updates)

- [ ] **Block tracking in Redis:**
  - Key: `block:active:<ip>` (separate from `threat:active:<ip>`)
  - Value: JSON with `{ action, category, confidence, blockedAt, expiresAt, incidentId, playbook }`
  - TTL set to match the playbook TTL (Redis handles expiry natively)
  - The scheduled sweep is a safety net — Redis TTL is the primary expiry mechanism, the sweep catches any that fell through (e.g., Redis restarted)

- [ ] **Manual unblock support:**
  - `DELETE /api/v1/blocks/{ip}` REST endpoint on a new `BlockController.java`
  - Calls `firewallManager.unblock(ip)`, removes Redis key, updates incident report
  - This prepares for The Lens (Phase 5) manual override panel

- [ ] **REST endpoint for active blocks:**
  - `GET /api/v1/blocks` — returns all currently active blocks from Redis
  - Each entry includes: IP, action, category, blocked timestamp, expires timestamp, incident ID

**Acceptance criteria:**
- Block an IP with TTL 10 seconds → after 10 seconds, the scheduled sweep unblocks it
- Redis key `block:active:<ip>` expires automatically via Redis TTL
- Incident report is updated to `resolved = true` on expiry
- Expiry event published to Redis channel
- `DELETE /api/v1/blocks/{ip}` manually unblocks an IP immediately
- `GET /api/v1/blocks` returns accurate active block list

---

### Task 5: Wire ResponseOrchestrator to FirewallManager

**Requirements:**
- [ ] Update `ResponseOrchestrator.evaluate()`:
  - Phase 2 behavior: returns `ResponseDecision` with tier, playbook, intended actions — **log only**
  - Phase 4 behavior: for ACT tier, **execute** the playbook actions via FirewallManager:

  ```java
  public ResponseDecision evaluate(SecurityEvent event) {
      String tier = eventService.determineTier(event.getConfidence());
      Optional<Playbook> playbook = playbookEngine.match(event);

      if ("ACT".equals(tier) && playbook.isPresent()) {
          List<Result> results = executePlaybook(event, playbook.get());
          IncidentReport report = incidentReportGenerator.generate(event, tier, playbook.get(), results);
          cacheActiveBlock(event, playbook.get(), report);
          return new ResponseDecision(tier, playbook.get(), results);
      }
      // OBSERVE and RECOMMEND unchanged
      return new ResponseDecision(tier, playbook.orElse(null), List.of());
  }
  ```

- [ ] `executePlaybook()` private method:
  - Iterates over the playbook's `actions` JSON array
  - For each action:
    - `"BLOCK"` → `firewallManager.blockIP(event.getSourceIp(), Duration.ofSeconds(playbook.getTtlSeconds()))`
    - `"RATE_LIMIT"` → `firewallManager.rateLimit(event.getSourceIp(), 10)` (10 connections default, configurable per playbook)
    - `"CRITICAL_ALERT"` → publish alert to Redis `providence:alerts` channel (for future dashboard consumption)
    - `"OBSERVE"` → log only, no firewall action
  - Returns `List<Result>` of all executed actions
  - If any action fails, log the failure but continue with remaining actions (don't abort the whole playbook)

- [ ] **FirewallManager selection via Spring profile:**
  - `@ConditionalOnProperty(name = "providence.firewall.platform", havingValue = "pfctl")`
  - `@ConditionalOnProperty(name = "providence.firewall.platform", havingValue = "iptables")`
  - `@ConditionalOnProperty(name = "providence.firewall.platform", havingValue = "noop", matchIfMissing = true)`
  - Default is `noop` — safe for development, CI, and environments without firewall access
  - Configured in `application.yml`:
    ```yaml
    providence:
      firewall:
        platform: noop  # pfctl | iptables | noop
      expiry:
        sweep-interval-ms: 30000
    ```

- [ ] **RECOMMEND tier — prepare for Phase 5:**
  - For RECOMMEND events, persist the recommended action to the incident report but don't execute it
  - Add field to incident report: `pending_approval` (boolean, default true for RECOMMEND)
  - Phase 5 will add a Lens UI button: "Approve" → executes the action, "Reject" → dismisses
  - Add REST endpoint: `POST /api/v1/incidents/{id}/approve` — executes the pending action via FirewallManager and updates the report
  - Add REST endpoint: `POST /api/v1/incidents/{id}/reject` — marks as rejected, no action taken

**Acceptance criteria:**
- ACT-tier event with DOS category → `firewallManager.rateLimit()` called with correct IP and TTL
- ACT-tier event with BRUTE_FORCE → `firewallManager.blockIP()` called
- ACT-tier event with EXFILTRATION → `blockIP()` called AND alert published to `providence:alerts`
- OBSERVE-tier event → no firewall calls
- RECOMMEND-tier event → no firewall calls, incident report has `pending_approval = true`
- `POST /api/v1/incidents/{id}/approve` executes the pending action
- With `platform: noop`, everything works but no actual firewall commands run
- Switching to `platform: pfctl` activates real pfctl commands

---

### Task 6: Response Action Logging

**Requirements:**
- [ ] Create `response_actions` database table (Flyway migration):
  ```sql
  CREATE TABLE response_actions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_id     UUID REFERENCES incident_reports(id),
      event_id        UUID REFERENCES security_events(id),
      action_type     VARCHAR(32) NOT NULL,  -- BLOCK, RATE_LIMIT, UNBLOCK, CRITICAL_ALERT
      source_ip       INET NOT NULL,
      success         BOOLEAN NOT NULL,
      detail          TEXT,
      platform        VARCHAR(32) NOT NULL,  -- pfctl, iptables, noop
      ttl_seconds     INTEGER,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ,
      reversed_at     TIMESTAMPTZ,           -- set when expired or manually unblocked
      reversed_reason VARCHAR(32)            -- TTL_EXPIRED, MANUAL_UNBLOCK, APPROVED_REJECT
  );

  CREATE INDEX idx_response_actions_ip ON response_actions (source_ip);
  CREATE INDEX idx_response_actions_active ON response_actions (expires_at) WHERE reversed_at IS NULL;
  ```

- [ ] `ResponseAction.java` JPA entity + `ResponseActionRepository.java`

- [ ] Every firewall action (block, rate_limit, unblock) is persisted to this table — this becomes the audit trail for the response engine

- [ ] `GET /api/v1/actions` — paginated response action history:
  - Filters: `action_type`, `source_ip`, `success`, `active` (where `reversed_at IS NULL`)
  - Used by The Lens Response Log component in Phase 5

**Acceptance criteria:**
- Every `blockIP` / `rateLimit` / `unblock` call creates a `response_actions` row
- TTL expiry updates `reversed_at` and `reversed_reason = TTL_EXPIRED`
- Manual unblock updates `reversed_at` and `reversed_reason = MANUAL_UNBLOCK`
- `GET /api/v1/actions?active=true` returns only non-reversed actions
- Full audit trail is queryable

---

### Task 7: Integration Test — Attack → Response → Expiry

**Requirements:**
- [ ] Integration test using Testcontainers (PostgreSQL + Redis) + NoopFirewallManager:
  1. **Seed:** Create a DOS playbook (RATE_LIMIT, TTL 5 seconds for test speed)
  2. **Inject:** Submit a classified event via gRPC with category=DOS, confidence=0.92
  3. **Assert response:** ResponseOrchestrator assigns ACT tier, PlaybookEngine matches DOS playbook
  4. **Assert firewall:** NoopFirewallManager received a `rateLimit()` call with correct IP
  5. **Assert persistence:** `response_actions` table has a row with action_type=RATE_LIMIT, success=true
  6. **Assert incident:** `incident_reports` table has a row linked to the event
  7. **Assert Redis:** `block:active:<ip>` key exists with TTL ≤ 5 seconds
  8. **Wait 6 seconds** (let TTL expire)
  9. **Assert expiry:** `block:active:<ip>` key gone from Redis
  10. **Assert unblock:** NoopFirewallManager received an `unblock()` call
  11. **Assert audit:** `response_actions` has a second row with action_type=UNBLOCK, reversed_reason=TTL_EXPIRED
  12. **Assert incident update:** incident report is `resolved = true`

- [ ] Second integration test — RECOMMEND flow:
  1. Submit event with confidence=0.72, category=BRUTE_FORCE
  2. Assert: no firewall calls, incident report has `pending_approval = true`
  3. Call `POST /api/v1/incidents/{id}/approve`
  4. Assert: firewall `blockIP()` called, `response_actions` row created
  5. Assert: incident updated to `pending_approval = false`

- [ ] Third integration test — safety guards:
  1. Submit event with source_ip=127.0.0.1, confidence=0.95
  2. Assert: firewall `blockIP()` returns `success=false` (loopback protected)
  3. Assert: incident report notes the failed action

- [ ] Docker-based iptables integration test (optional but recommended):
  - Spin up a container with NET_ADMIN, run IptablesFirewallManager, verify actual iptables rules appear

**Acceptance criteria:**
- All three test scenarios pass
- Full lifecycle tested: event → classify → respond → block → expire → unblock → audit
- RECOMMEND → approve flow works end to end
- Safety guards prevent blocking protected IPs

---

### Task 8: CI Pipeline Update

**Requirements:**
- [ ] Update `.github/workflows/ci-citadel.yml`:
  - Ensure `mvn verify` runs Phase 4 integration tests (they use NoopFirewallManager + Testcontainers, no real firewall needed)
  - Add a step that validates Flyway migrations apply cleanly (new `response_actions` table)
  - Docker build still passes with new code

**Acceptance criteria:**
- CI passes with all new tests
- No tests require actual firewall access (NoopFirewallManager is the CI default)

---

## Scoped Out (Future Phases)

| Item | Phase |
|---|---|
| CloudFirewallManager (AWS Security Groups, NACLs) | Phase 7 |
| WfpFirewallManager (Windows Firewall Platform) | Stretch |
| Dashboard manual override UI (approve/reject buttons) | Phase 5 |
| Cloud-native responses (IAM revocation, Lambda remediation) | Phase 7 |
| Response effectiveness analytics | Phase 5 |

---

## Architecture Reference

```
┌──────────────────────────────────────────────────────────────┐
│                     THE CITADEL                               │
│                                                               │
│  GrpcEventService                                             │
│       │                                                       │
│       ▼                                                       │
│  ResponseOrchestrator                                         │
│   ├── confidence < 0.60 → OBSERVE (log only)                 │
│   ├── confidence 0.60-0.85 → RECOMMEND (log + pending)       │
│   └── confidence > 0.85 → ACT ──────────────────┐            │
│                                                   │            │
│                                                   ▼            │
│                                          PlaybookEngine        │
│                                           ├── match(event)     │
│                                           └── actions[]        │
│                                                   │            │
│                                    ┌──────────────┼─────┐     │
│                                    ▼              ▼     ▼     │
│                              BLOCK          RATE_LIMIT  ALERT │
│                                    │              │            │
│                                    ▼              ▼            │
│                          ┌────────────────────────────┐       │
│                          │    FirewallManager          │       │
│                          │    (platform-selected)      │       │
│                          ├────────────────────────────┤       │
│                          │ pfctl    │ iptables │ noop │       │
│                          └────────────────────────────┘       │
│                                    │                           │
│                                    ▼                           │
│                          BlockExpiryService                    │
│                          (@Scheduled every 30s)                │
│                          ├── check Redis TTLs                  │
│                          ├── unblock expired                   │
│                          ├── update incident reports           │
│                          └── publish expiry events             │
│                                                               │
│  ┌──────────┐  ┌─────────┐  ┌──────────────────┐            │
│  │PostgreSQL│  │  Redis   │  │ response_actions │            │
│  │          │  │block:*   │  │ (audit trail)    │            │
│  │          │  │threat:*  │  │                  │            │
│  └──────────┘  └─────────┘  └──────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

---

## Verification Checklist

When Phase 4 is complete, all of the following must be true:

- [ ] `FirewallManager` interface implemented with three backends: pfctl, iptables, noop
- [ ] PfctlFirewallManager blocks/unblocks IPs via pfctl table operations on macOS
- [ ] IptablesFirewallManager blocks/unblocks IPs via iptables PROVIDENCE chain in Linux/Docker
- [ ] NoopFirewallManager logs all actions without executing firewall commands
- [ ] Platform selection via Spring property: `providence.firewall.platform`
- [ ] ACT-tier events execute playbook actions through FirewallManager
- [ ] RECOMMEND-tier events log pending actions, approve/reject via REST
- [ ] TTL-based expiry unblocks IPs automatically after playbook TTL
- [ ] BlockExpiryService runs on schedule, handles Redis key expiry + firewall cleanup
- [ ] `response_actions` table provides full audit trail of every action
- [ ] Safety guards prevent blocking loopback, gateway, and self IPs
- [ ] IP format validation prevents command injection in pfctl/iptables
- [ ] Integration test validates: event → block → expiry → unblock → audit update
- [ ] All tests pass in CI using NoopFirewallManager (no real firewall needed)
- [ ] `GET /api/v1/blocks` returns active blocks
- [ ] `DELETE /api/v1/blocks/{ip}` manually unblocks
- [ ] `GET /api/v1/actions` returns paginated action history
- [ ] `POST /api/v1/incidents/{id}/approve` executes a RECOMMEND-tier pending action
