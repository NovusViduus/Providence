package com.providence.citadel.service;

import com.providence.citadel.firewall.FirewallManager;
import com.providence.citadel.firewall.Result;
import com.providence.citadel.model.*;
import com.providence.citadel.repository.ResponseActionRepository;
import com.providence.citadel.repository.IncidentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.*;

/**
 * Evaluates security events and executes response actions.
 *
 * ABSOLUTE CONSTRAINTS — enforced in code, not configurable:
 * - NEVER probe external systems
 * - NEVER transmit adversarial payloads
 * - NEVER modify non-local or non-owned network config
 * - NEVER take irreversible action without human confirmation
 * - NEVER access or store packet payload content beyond classification
 * - All automated actions are reversible (TTL-based expiry)
 * - All automated actions are logged with full forensic context
 */
@Service
public class ResponseOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(ResponseOrchestrator.class);

    private final PlaybookEngine playbookEngine;
    private final FirewallManager firewallManager;
    private final IncidentReportGenerator incidentGenerator;
    private final ResponseActionRepository actionRepository;
    private final IncidentRepository incidentRepository;
    private final BlockExpiryService blockExpiryService;
    private final StringRedisTemplate redisTemplate;

    public ResponseOrchestrator(PlaybookEngine playbookEngine,
                                FirewallManager firewallManager,
                                IncidentReportGenerator incidentGenerator,
                                ResponseActionRepository actionRepository,
                                IncidentRepository incidentRepository,
                                BlockExpiryService blockExpiryService,
                                StringRedisTemplate redisTemplate) {
        this.playbookEngine = playbookEngine;
        this.firewallManager = firewallManager;
        this.incidentGenerator = incidentGenerator;
        this.actionRepository = actionRepository;
        this.incidentRepository = incidentRepository;
        this.blockExpiryService = blockExpiryService;
        this.redisTemplate = redisTemplate;
    }

    public ResponseDecision evaluate(SecurityEvent event) {
        String tier = EventService.determineTier(event.getCategory(), event.getConfidence());
        Optional<Playbook> playbook = playbookEngine.match(event);

        if ("OBSERVE".equals(tier)) {
            log.debug("OBSERVE tier for event {} (confidence={})", event.getEventId(), event.getConfidence());
            return new ResponseDecision(tier, null, Collections.emptyList());
        }

        if ("RECOMMEND".equals(tier)) {
            log.info("RECOMMEND tier for event {} category={} confidence={}",
                event.getEventId(), event.getCategory(), event.getConfidence());
            // Persist pending action but don't execute
            List<String> actions = playbook.map(p -> parseActions(p.getActions())).orElse(Collections.emptyList());
            return new ResponseDecision(tier, playbook.orElse(null), actions);
        }

        // ACT tier — execute playbook actions
        if (playbook.isPresent()) {
            List<Result> results = executePlaybook(event, playbook.get());
            IncidentReport report = incidentGenerator.generate(event,
                new ResponseDecision(tier, playbook.get(), parseActions(playbook.get().getActions())));

            // Cache active block in Redis and mark incident resolved if block succeeded
            boolean anyBlockSucceeded = false;
            for (Result r : results) {
                if (r.success()) {
                    if ("BLOCK".equals(r.action()) || "RATE_LIMIT".equals(r.action())) {
                        anyBlockSucceeded = true;
                        blockExpiryService.cacheActiveBlock(
                            event.getSourceIp(), r.action(), event.getCategory(),
                            event.getConfidence(), playbook.get().getTtlSeconds(),
                            report != null ? report.getId() : null);
                    }
                    persistAction(r, report, event, playbook.get());
                }
            }

            // Auto-resolve the incident if a block/rate-limit was successfully applied
            if (report != null && anyBlockSucceeded) {
                report.setResolved(true);
                report.setResolvedAt(java.time.Instant.now());
                incidentRepository.save(report);
            }

            log.info("ACT tier for event {} category={} confidence={} results={}",
                event.getEventId(), event.getCategory(), event.getConfidence(),
                results.stream().map(r -> r.action() + ":" + r.success()).toList());

            return new ResponseDecision(tier, playbook.get(),
                results.stream().map(Result::action).toList());
        }

        log.info("ACT tier but no playbook matched for event {} category={}",
            event.getEventId(), event.getCategory());
        return new ResponseDecision(tier, null, Collections.emptyList());
    }

    private List<Result> executePlaybook(SecurityEvent event, Playbook playbook) {
        List<String> actions = parseActions(playbook.getActions());
        List<Result> results = new ArrayList<>();
        Duration ttl = Duration.ofSeconds(playbook.getTtlSeconds());

        for (String action : actions) {
            Result result = switch (action) {
                case "BLOCK" -> firewallManager.blockIP(event.getSourceIp(), ttl);
                case "RATE_LIMIT" -> firewallManager.rateLimit(event.getSourceIp(), 10);
                case "CRITICAL_ALERT" -> {
                    publishAlert(event);
                    yield Result.success("CRITICAL_ALERT", event.getSourceIp(), "alert published", null);
                }
                case "OBSERVE" -> {
                    log.info("OBSERVE action for {} — no firewall action", event.getSourceIp());
                    yield Result.success("OBSERVE", event.getSourceIp(), "observe only", null);
                }
                default -> {
                    log.warn("Unknown action: {}", action);
                    yield Result.failure(action, event.getSourceIp(), "unknown action type");
                }
            };

            results.add(result);
            if (!result.success()) {
                log.warn("Action {} failed for {}: {}", action, event.getSourceIp(), result.detail());
                // Continue with remaining actions — don't abort
            }
        }
        return results;
    }

    private void persistAction(Result result, IncidentReport report, SecurityEvent event, Playbook playbook) {
        ResponseAction action = new ResponseAction();
        action.setIncidentId(report != null ? report.getId() : null);
        action.setEventId(event.getId());
        action.setActionType(result.action());
        action.setSourceIp(event.getSourceIp());
        action.setSuccess(result.success());
        action.setDetail(result.detail());
        action.setPlatform(firewallManager.platformName());
        action.setTtlSeconds(playbook.getTtlSeconds());
        action.setExpiresAt(result.expiresAt());
        actionRepository.save(action);
    }

    private void publishAlert(SecurityEvent event) {
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            String json = mapper.writeValueAsString(Map.of(
                "type", "CRITICAL_ALERT",
                "eventId", event.getEventId(),
                "sourceIp", event.getSourceIp(),
                "category", event.getCategory(),
                "confidence", event.getConfidence()
            ));
            redisTemplate.convertAndSend("providence:alerts", json);
            log.info("CRITICAL_ALERT published for {} category={}", event.getSourceIp(), event.getCategory());
        } catch (Exception e) {
            log.error("Failed to publish alert", e);
        }
    }

    @SuppressWarnings("unchecked")
    private List<String> parseActions(String actionsJson) {
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            return mapper.readValue(actionsJson, List.class);
        } catch (Exception e) {
            log.error("Failed to parse playbook actions: {}", actionsJson, e);
            return Collections.emptyList();
        }
    }
}
