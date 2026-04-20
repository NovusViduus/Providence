package com.providence.citadel.service;

import com.providence.citadel.firewall.FirewallManager;
import com.providence.citadel.model.ResponseAction;
import com.providence.citadel.repository.IncidentRepository;
import com.providence.citadel.repository.ResponseActionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Set;

@Service
public class BlockExpiryService {

    private static final Logger log = LoggerFactory.getLogger(BlockExpiryService.class);
    private static final String BLOCK_KEY_PREFIX = "block:active:";

    private final FirewallManager firewallManager;
    private final ResponseActionRepository actionRepository;
    private final IncidentRepository incidentRepository;
    private final StringRedisTemplate redisTemplate;
    private final RedisEventPublisher redisPublisher;

    public BlockExpiryService(FirewallManager firewallManager,
                              ResponseActionRepository actionRepository,
                              IncidentRepository incidentRepository,
                              StringRedisTemplate redisTemplate,
                              RedisEventPublisher redisPublisher) {
        this.firewallManager = firewallManager;
        this.actionRepository = actionRepository;
        this.incidentRepository = incidentRepository;
        this.redisTemplate = redisTemplate;
        this.redisPublisher = redisPublisher;
    }

    @Scheduled(fixedDelayString = "${providence.expiry.sweep-interval-ms:30000}")
    public void sweepExpiredBlocks() {
        Instant now = Instant.now();

        // Check response_actions table for expired blocks
        var activeActions = actionRepository.findAllActive();
        for (ResponseAction action : activeActions) {
            if (action.getExpiresAt() != null && action.getExpiresAt().isBefore(now)) {
                expireAction(action);
            }
        }
    }

    private void expireAction(ResponseAction action) {
        String ip = action.getSourceIp();
        log.info("[EXPIRY] Unblocking {} — TTL expired (action={})", ip, action.getActionType());

        firewallManager.unblock(ip);

        // Update action record
        action.setReversedAt(Instant.now());
        action.setReversedReason("TTL_EXPIRED");
        actionRepository.save(action);

        // Remove Redis block key
        redisTemplate.delete(BLOCK_KEY_PREFIX + ip);

        // Update linked incident report
        if (action.getIncidentId() != null) {
            incidentRepository.findById(action.getIncidentId()).ifPresent(incident -> {
                incident.setResolved(true);
                incident.setResolvedAt(Instant.now());
                incidentRepository.save(incident);
            });
        }

        // Publish expiry event
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            String json = mapper.writeValueAsString(java.util.Map.of(
                "type", "BLOCK_EXPIRED",
                "ip", ip,
                "action", action.getActionType(),
                "expiredAt", Instant.now().toString()
            ));
            redisTemplate.convertAndSend("providence:events", json);
        } catch (Exception e) {
            log.error("Failed to publish expiry event", e);
        }
    }

    public void manualUnblock(String ip) {
        log.info("[MANUAL] Unblocking {}", ip);
        firewallManager.unblock(ip);

        // Update all active actions for this IP
        var activeActions = actionRepository.findAllActive();
        for (ResponseAction action : activeActions) {
            if (ip.equals(action.getSourceIp())) {
                action.setReversedAt(Instant.now());
                action.setReversedReason("MANUAL_UNBLOCK");
                actionRepository.save(action);

                if (action.getIncidentId() != null) {
                    incidentRepository.findById(action.getIncidentId()).ifPresent(incident -> {
                        incident.setResolved(true);
                        incident.setResolvedAt(Instant.now());
                        incidentRepository.save(incident);
                    });
                }
            }
        }

        redisTemplate.delete(BLOCK_KEY_PREFIX + ip);
    }

    public void cacheActiveBlock(String ip, String actionType, String category,
                                  float confidence, int ttlSeconds, java.util.UUID incidentId) {
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            String json = mapper.writeValueAsString(java.util.Map.of(
                "action", actionType,
                "category", category,
                "confidence", confidence,
                "blockedAt", Instant.now().toString(),
                "expiresAt", Instant.now().plusSeconds(ttlSeconds).toString(),
                "incidentId", incidentId != null ? incidentId.toString() : ""
            ));
            redisTemplate.opsForValue().set(
                BLOCK_KEY_PREFIX + ip, json, java.time.Duration.ofSeconds(ttlSeconds));
        } catch (Exception e) {
            log.error("Failed to cache active block", e);
        }
    }

    public java.util.Map<String, String> getActiveBlocks() {
        Set<String> keys = redisTemplate.keys(BLOCK_KEY_PREFIX + "*");
        if (keys == null || keys.isEmpty()) return java.util.Map.of();

        var result = new java.util.HashMap<String, String>();
        for (String key : keys) {
            String value = redisTemplate.opsForValue().get(key);
            if (value != null) {
                result.put(key.replace(BLOCK_KEY_PREFIX, ""), value);
            }
        }
        return result;
    }
}
