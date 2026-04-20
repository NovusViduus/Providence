# Phase 4: Response Engine — Implementation Checklist

> Spec vs. what was built, task by task.

---

## Task 1: FirewallManager Interface & Result Types

| Requirement | Status | Notes |
|---|---|---|
| `firewall/` package created | ✅ Done | `com.providence.citadel.firewall` with 7 classes |
| `FirewallManager` interface with `blockIP`, `rateLimit`, `unblock`, `listRules`, `platformName` | ✅ Done | Exact match to spec |
| `Result` record with success, action, ip, detail, timestamp, expiresAt | ✅ Done | Plus `success()` and `failure()` static factory methods |
| `Rule` record with ip, action, createdAt, expiresAt, source | ✅ Done | Exact match |
| `NoopFirewallManager` — logs but does nothing | ✅ Done | Uses `ConcurrentHashMap` to track rules in-memory for test assertions |
| Noop: all methods log at INFO | ✅ Done | `[NOOP]` prefix on all log lines |
| Noop: returns `Result(success=true)` | ✅ Done | Via `Result.success()` factory |
| Noop: `listRules` reflects blocks | ✅ Done | Returns from in-memory map |
| Noop: `unblock` removes from `listRules` | ✅ Done | `activeRules.remove(ip)` |
| Safety guards integrated into all implementations | ✅ Done | `FirewallSafetyGuard.validate()` called first in every `blockIP`/`rateLimit` |

---

## Task 2: PfctlFirewallManager (macOS)

| Requirement | Status | Notes |
|---|---|---|
| `@ConditionalOnProperty(havingValue = "pfctl")` | ✅ Done | |
| `blockIP` → `pfctl -t providence_blocklist -T add` | ✅ Done | |
| `rateLimit` → `pfctl -t providence_ratelimit -T add` | ✅ Done | Pragmatic approach: adds to separate table with pf rule handling rate limiting |
| `unblock` → deletes from both tables | ✅ Done | |
| `listRules` → parses `pfctl -t ... -T show` output | ✅ Done | Validates each line as IP before adding to list |
| `platformName()` returns `"pfctl"` | ✅ Done | |
| ProcessBuilder with 5-second timeout | ✅ Done | `p.waitFor(5, TimeUnit.SECONDS)`, `destroyForcibly` on timeout |
| Captures stdout/stderr | ✅ Done | `redirectErrorStream(true)` |
| Checks exit code | ✅ Done | Non-zero → failure logged with stderr content |
| Handles permission denied gracefully | ✅ Done | Caught as non-zero exit code, logged |
| IP format validation (command injection prevention) | ✅ Done | `FirewallSafetyGuard.isValidIp()` regex before any command |
| Never blocks loopback/gateway/self | ✅ Done | `FirewallSafetyGuard.isProtectedIp()` |
| Logs every command at INFO | ✅ Done | `[PFCTL] Executing: ...` |
| pfctl setup documentation | ❌ Missing | Spec asks for README or setup script documenting `/etc/pf.conf` anchor and `/etc/pf.anchors/providence`. Not created. |

---

## Task 3: IptablesFirewallManager (Linux)

| Requirement | Status | Notes |
|---|---|---|
| `@ConditionalOnProperty(havingValue = "iptables")` | ✅ Done | |
| Creates PROVIDENCE chain if not exists | ✅ Done | `iptables -N PROVIDENCE 2>/dev/null` |
| Ensures chain is jumped to from INPUT | ✅ Done | `-C INPUT -j PROVIDENCE || -I INPUT -j PROVIDENCE` |
| `blockIP` → `iptables -A PROVIDENCE -s <ip> -j DROP` with comment | ✅ Done | Comment format: `providence:block:<timestamp>:<expiresAt>` |
| `rateLimit` → connlimit module | ✅ Done | `--connlimit-above <maxConn> -j DROP` with comment |
| `unblock` → deletes matching rules | ✅ Done | Deletes both DROP and connlimit rules |
| `listRules` → parses `iptables -L PROVIDENCE -n --line-numbers` | ✅ Done | Regex extracts comment metadata for action/timestamps |
| `platformName()` returns `"iptables"` | ✅ Done | |
| Same safety guards as pfctl | ✅ Done | Same `FirewallSafetyGuard.validate()` call |
| Docker test container with NET_ADMIN | ❌ Missing | Spec asks for `Dockerfile.iptables-test` and Docker-based integration test. Not created. |

---

## Task 4: TTL-Based Auto-Expiry

| Requirement | Status | Notes |
|---|---|---|
| `BlockExpiryService` as `@Service` with `@Scheduled` | ✅ Done | `sweepExpiredBlocks()` runs on configurable interval |
| Runs every 30 seconds (configurable) | ✅ Done | `${providence.expiry.sweep-interval-ms:30000}` |
| Scans `response_actions` for expired blocks | ✅ Done | `actionRepository.findAllActive()` filtered by `expiresAt.isBefore(now)` |
| Calls `firewallManager.unblock(ip)` on expiry | ✅ Done | |
| Removes Redis `block:active:<ip>` key | ✅ Done | `redisTemplate.delete(BLOCK_KEY_PREFIX + ip)` |
| Updates incident report: `resolved = true`, `resolved_at = now()` | ✅ Done | Looks up by `incidentId` |
| Logs expiry with `[EXPIRY]` prefix | ✅ Done | |
| Publishes expiry event to `providence:events` channel | ✅ Done | JSON with type, ip, action, expiredAt |
| Redis `block:active:<ip>` key with TTL | ✅ Done | `cacheActiveBlock()` sets key with `Duration.ofSeconds(ttlSeconds)` |
| Redis key value includes action, category, confidence, timestamps, incidentId | ✅ Done | |
| Redis TTL is primary expiry, sweep is safety net | ✅ Done | Redis handles native TTL; sweep catches stragglers |
| `DELETE /api/v1/blocks/{ip}` manual unblock | ✅ Done | `BlockController.unblock()` → `blockExpiryService.manualUnblock()` |
| Manual unblock updates `reversed_reason = MANUAL_UNBLOCK` | ✅ Done | |
| `GET /api/v1/blocks` returns active blocks from Redis | ✅ Done | `blockExpiryService.getActiveBlocks()` scans `block:active:*` keys |

---

## Task 5: Wire ResponseOrchestrator to FirewallManager

| Requirement | Status | Notes |
|---|---|---|
| ACT tier executes playbook actions via FirewallManager | ✅ Done | `executePlaybook()` iterates actions, calls `blockIP`/`rateLimit` |
| `BLOCK` → `firewallManager.blockIP(ip, ttl)` | ✅ Done | TTL from playbook |
| `RATE_LIMIT` → `firewallManager.rateLimit(ip, 10)` | ✅ Done | 10 connections default |
| `CRITICAL_ALERT` → publish to `providence:alerts` | ✅ Done | JSON with type, eventId, sourceIp, category, confidence |
| `OBSERVE` → log only | ✅ Done | |
| Failed actions logged but don't abort remaining | ✅ Done | `if (!result.success()) log.warn(...)` then continues loop |
| Returns `List<Result>` | ✅ Done | |
| Platform selection via `@ConditionalOnProperty` | ✅ Done | pfctl, iptables, noop (matchIfMissing=true for noop) |
| Default is `noop` | ✅ Done | `matchIfMissing = true` on NoopFirewallManager |
| Config in `application.yml` | ✅ Done | `providence.firewall.platform: noop` and `providence.expiry.sweep-interval-ms: 30000` |
| `@EnableScheduling` on application | ✅ Done | Added to `CitadelApplication.java` |
| RECOMMEND tier: persist pending action, don't execute | ✅ Done | Returns actions list but no firewall calls |
| `pending_approval` field on IncidentReport | ✅ Done | Added to entity + Flyway V3 migration |
| `POST /api/v1/incidents/{id}/approve` | ✅ Done | Executes `blockIP`, persists `ResponseAction`, clears `pendingApproval` |
| `POST /api/v1/incidents/{id}/reject` | ✅ Done | Clears `pendingApproval`, adds "Rejected by operator" note |
| Approve returns 400 if not pending | ✅ Done | Checks `isPendingApproval()` |
| Absolute constraints in Javadoc | ✅ Done | 7 constraints listed in class-level Javadoc |

---

## Task 6: Response Action Logging

| Requirement | Status | Notes |
|---|---|---|
| `response_actions` table via Flyway V3 | ✅ Done | All columns match spec: id, incident_id, event_id, action_type, source_ip, success, detail, platform, ttl_seconds, created_at, expires_at, reversed_at, reversed_reason |
| Index on source_ip | ✅ Done | `idx_response_actions_ip` |
| Partial index on active actions | ✅ Done | `idx_response_actions_active` WHERE `reversed_at IS NULL` |
| `ResponseAction.java` JPA entity | ✅ Done | All fields mapped, `@PrePersist` for `createdAt` |
| `ResponseActionRepository.java` | ✅ Done | `findByActionType`, `findBySourceIp`, `findBySuccess`, `findActive`, `findAllActive` |
| Every firewall action persisted | ✅ Done | `persistAction()` in ResponseOrchestrator, also in approve endpoint |
| TTL expiry updates `reversed_at` + `reversed_reason = TTL_EXPIRED` | ✅ Done | In `BlockExpiryService.expireAction()` |
| Manual unblock updates `reversed_at` + `reversed_reason = MANUAL_UNBLOCK` | ✅ Done | In `BlockExpiryService.manualUnblock()` |
| `GET /api/v1/actions` paginated with filters | ✅ Done | `ActionController` with actionType, sourceIp, success, active filters |
| `GET /api/v1/actions?active=true` returns non-reversed | ✅ Done | Uses `findActive` query |

---

## Task 7: Integration Tests

| Spec Test | Status | Notes |
|---|---|---|
| ACT tier → firewall action → audit trail | ✅ `actTierBlockAndExpiry` | DOS 0.92 → ACT, verifies noop rules, response_actions, Redis block key, REST endpoints |
| RECOMMEND → pending → approve → firewall call | ✅ `recommendTierApproveFlow` | BRUTE_FORCE 0.72 → RECOMMEND, no firewall, create pending incident, POST approve, verify firewall called + incident updated |
| Safety guard: loopback protection | ✅ `safetyGuardBlocksLoopback` | 127.0.0.1 at 0.95 → ACT but firewall refuses, no rules created |
| OBSERVE tier: no actions | ✅ `observeTierNoActions` | PROBE 0.45 → OBSERVE, empty actions, no rules |
| Manual unblock via REST | ✅ `manualUnblock` | Block EXFILTRATION, DELETE /api/v1/blocks/{ip}, verify unblocked |
| Reject pending incident | ✅ `rejectPendingIncident` | POST reject, verify pendingApproval=false, notes contain "Rejected" |
| Noop platform verification | ✅ `noopPlatformName` | `platformName() == "noop"` |
| TTL expiry with wait (spec: seed 5s TTL, wait 6s, verify unblock) | ✅ `ttlExpiryLifecycle` | Backdates `expiresAt` to past, calls `sweepExpiredBlocks()` directly. Asserts: unblock called, `reversed_reason=TTL_EXPIRED`, incident resolved. No sleeping, deterministic. |
| Docker iptables integration test | ❌ Missing | Spec asks for container with NET_ADMIN running real iptables commands |
| All tests use Testcontainers | ✅ Done | `@Import(TestContainersConfig.class)` with PostgreSQL + Redis |
| Tests independent with cleanup | ✅ Done | `@BeforeEach` deletes actions, incidents, events, Redis keys |

---

## Task 8: CI Pipeline Update

| Requirement | Status | Notes |
|---|---|---|
| `mvn verify` runs Phase 4 tests | ✅ Done | Tests use NoopFirewallManager, no real firewall needed |
| Flyway V3 migration validates cleanly | ✅ Done | `ddl-auto: validate` + Flyway runs on startup |
| Docker build still passes | ✅ Done | No changes to Dockerfile |
| No tests require actual firewall access | ✅ Done | All tests use noop platform |

---

## Verification Checklist (from spec)

| Check | Status |
|---|---|
| FirewallManager with three backends: pfctl, iptables, noop | ✅ |
| PfctlFirewallManager blocks/unblocks via pfctl tables | ✅ |
| IptablesFirewallManager blocks/unblocks via PROVIDENCE chain | ✅ |
| NoopFirewallManager logs without executing | ✅ |
| Platform selection via `providence.firewall.platform` | ✅ |
| ACT-tier events execute playbook actions | ✅ |
| RECOMMEND-tier events log pending, approve/reject via REST | ✅ |
| TTL-based expiry unblocks automatically | ✅ (structurally — sweep logic correct, not time-tested) |
| BlockExpiryService runs on schedule | ✅ |
| `response_actions` table provides audit trail | ✅ |
| Safety guards prevent blocking loopback/gateway/self | ✅ |
| IP format validation prevents command injection | ✅ |
| Integration test: event → block → expiry → unblock → audit | ✅ (`ttlExpiryLifecycle` — backdated expiry + manual sweep) |
| All tests pass in CI with noop | ✅ |
| `GET /api/v1/blocks` returns active blocks | ✅ |
| `DELETE /api/v1/blocks/{ip}` manually unblocks | ✅ |
| `GET /api/v1/actions` returns paginated history | ✅ |
| `POST /api/v1/incidents/{id}/approve` executes pending action | ✅ |

---

## Gaps Summary

| Gap | Severity | Notes |
|---|---|---|
| Time-based TTL expiry test | ✅ Closed | `ttlExpiryLifecycle` test: blocks IP, backdates `expiresAt` to the past, calls `sweepExpiredBlocks()` directly, asserts unblock + `reversed_reason=TTL_EXPIRED` + incident resolved. No sleeping, no flaky timing. |
| Docker iptables test | Medium | Spec asks for container with NET_ADMIN. Not blocking for Phase 5 — noop tests prove orchestration logic. |
| Approve endpoint hardcoded TTL | ✅ Closed | Now injects `PlaybookRepository`, looks up playbook by incident category, uses `playbook.getTtlSeconds()` with 3600 fallback. BRUTE_FORCE approve correctly uses 1800s. |
| CRITICAL_ALERT not persisted to response_actions | Low | `CRITICAL_ALERT` results are generated but only BLOCK/RATE_LIMIT results are persisted to the audit trail. The alert publish is logged but not in the database. |
| `ResponseDecision` record unchanged | Low | Spec shows `ResponseDecision` containing `List<Result>` but the record still holds `List<String>` (action names). The orchestrator converts `Result` → action name strings before returning. This works but loses the success/failure detail at the decision level. |
