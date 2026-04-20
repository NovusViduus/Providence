package com.providence.citadel.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.providence.citadel.model.SecurityEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Map;

@Service
public class RedisEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(RedisEventPublisher.class);
    private static final String CHANNEL = "providence:events";
    private static final String THREAT_KEY_PREFIX = "threat:active:";

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public RedisEventPublisher(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
    }

    public void publishEvent(SecurityEvent event) {
        try {
            String json = objectMapper.writeValueAsString(Map.of(
                "eventId", event.getEventId(),
                "timestamp", event.getTimestamp().toString(),
                "sourceIp", event.getSourceIp(),
                "sourcePort", event.getSourcePort(),
                "destIp", event.getDestIp(),
                "destPort", event.getDestPort(),
                "protocol", event.getProtocol(),
                "category", event.getCategory(),
                "confidence", event.getConfidence(),
                "responseTier", event.getResponseTier()
            ));
            redisTemplate.convertAndSend(CHANNEL, json);
            log.debug("Published event {} to Redis channel", event.getEventId());
        } catch (Exception e) {
            log.error("Failed to publish event to Redis", e);
        }
    }

    public void cacheActiveThreat(SecurityEvent event, int ttlSeconds) {
        try {
            String key = THREAT_KEY_PREFIX + event.getSourceIp();
            String json = objectMapper.writeValueAsString(Map.of(
                "eventId", event.getEventId(),
                "sourceIp", event.getSourceIp(),
                "category", event.getCategory(),
                "confidence", event.getConfidence(),
                "tier", event.getResponseTier(),
                "timestamp", event.getTimestamp().toString()
            ));
            redisTemplate.opsForValue().set(key, json, Duration.ofSeconds(ttlSeconds));
            log.info("Cached active threat for {} with TTL {}s", event.getSourceIp(), ttlSeconds);
        } catch (Exception e) {
            log.error("Failed to cache active threat in Redis", e);
        }
    }

    public Map<String, String> getActiveThreats() {
        var keys = redisTemplate.keys(THREAT_KEY_PREFIX + "*");
        if (keys == null || keys.isEmpty()) return Map.of();

        var result = new java.util.HashMap<String, String>();
        for (String key : keys) {
            String value = redisTemplate.opsForValue().get(key);
            if (value != null) {
                result.put(key.replace(THREAT_KEY_PREFIX, ""), value);
            }
        }
        return result;
    }
}
