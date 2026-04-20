package com.providence.citadel.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.providence.citadel.model.SecurityEvent;
import com.providence.citadel.repository.EventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Monitors incoming events per source IP and triggers AI_AGENT detection
 * when enough session data has accumulated.
 */
@Service
public class AiDetectionService {

    private static final Logger log = LoggerFactory.getLogger(AiDetectionService.class);

    @Value("${providence.ai-detection.ml-url:http://localhost:50052/ml/ai-detect}")
    private String mlUrl;

    @Value("${providence.ai-detection.min-events:10}")
    private int minEvents;

    @Value("${providence.ai-detection.confidence-threshold:0.8}")
    private float confidenceThreshold;

    private final EventService eventService;
    private final RedisEventPublisher redisPublisher;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5)).build();

    // Track events per source IP for session aggregation
    private final ConcurrentHashMap<String, List<SecurityEvent>> ipSessions = new ConcurrentHashMap<>();
    private final Set<String> alreadyClassified = ConcurrentHashMap.newKeySet();

    public AiDetectionService(EventService eventService, RedisEventPublisher redisPublisher) {
        this.eventService = eventService;
        this.redisPublisher = redisPublisher;
    }

    /**
     * Called when a new event is received. Accumulates per-IP.
     */
    public void onEvent(SecurityEvent event) {
        ipSessions.computeIfAbsent(event.getSourceIp(), k -> new ArrayList<>()).add(event);
    }

    /**
     * Periodic check: for IPs with enough accumulated events, extract behavioral
     * features and call the ML AI detection endpoint.
     */
    @Scheduled(fixedDelayString = "${providence.ai-detection.sweep-interval-ms:60000}")
    public void checkForAiAgents() {
        for (var entry : ipSessions.entrySet()) {
            String ip = entry.getKey();
            List<SecurityEvent> events = entry.getValue();

            if (events.size() < minEvents) continue;
            if (alreadyClassified.contains(ip)) continue;

            try {
                Map<String, Object> features = extractBehavioralFeatures(ip, events);
                var result = callAiDetector(features);

                if (result != null) {
                    boolean isAi = (boolean) result.getOrDefault("isAiAgent", false);
                    float confidence = ((Number) result.getOrDefault("confidence", 0.0)).floatValue();

                    if (isAi && confidence >= confidenceThreshold) {
                        log.info("[AI_DETECT] Source {} classified as AI_AGENT (confidence={})", ip, confidence);
                        createAiAgentEvent(ip, confidence, events.get(events.size() - 1));
                        alreadyClassified.add(ip);
                    } else if (confidence >= 0.5f) {
                        log.info("[AI_DETECT] Source {} suspicious (confidence={}) — observing", ip, confidence);
                    }
                }
            } catch (Exception e) {
                log.error("[AI_DETECT] Error checking {}: {}", ip, e.getMessage());
            }
        }
    }

    private Map<String, Object> extractBehavioralFeatures(String ip, List<SecurityEvent> events) {
        // Compute timing features from event timestamps
        List<Long> interTimes = new ArrayList<>();
        for (int i = 1; i < events.size(); i++) {
            long delta = Duration.between(events.get(i - 1).getTimestamp(), events.get(i).getTimestamp()).toMillis();
            interTimes.add(delta);
        }

        double mean = interTimes.stream().mapToLong(Long::longValue).average().orElse(0);
        double std = 0;
        if (interTimes.size() > 1) {
            double finalMean = mean;
            std = Math.sqrt(interTimes.stream().mapToDouble(t -> Math.pow(t - finalMean, 2)).average().orElse(0));
        }

        long min = interTimes.stream().mapToLong(Long::longValue).min().orElse(0);
        long max = interTimes.stream().mapToLong(Long::longValue).max().orElse(0);
        double cv = mean > 0 ? std / mean : 0;

        Duration sessionDuration = Duration.between(events.get(0).getTimestamp(),
            events.get(events.size() - 1).getTimestamp());

        Set<String> uniqueIps = new HashSet<>();
        Set<String> categories = new HashSet<>();
        for (var e : events) {
            uniqueIps.add(e.getDestIp());
            categories.add(e.getCategory());
        }

        return Map.ofEntries(
            Map.entry("inter_attempt_mean", mean),
            Map.entry("inter_attempt_std", std),
            Map.entry("inter_attempt_min", (double) min),
            Map.entry("inter_attempt_max", (double) max),
            Map.entry("inter_attempt_cv", cv),
            Map.entry("inter_attempt_median", mean),
            Map.entry("attempt_rate", events.size() / Math.max(sessionDuration.getSeconds(), 1.0)),
            Map.entry("session_duration", (double) sessionDuration.getSeconds()),
            Map.entry("unique_usernames", 0.0),
            Map.entry("unique_passwords", 0.0),
            Map.entry("credential_diversity", 0.0),
            Map.entry("username_entropy", 0.0),
            Map.entry("password_entropy", 0.0),
            Map.entry("success_ratio", 0.0),
            Map.entry("command_count", 0.0),
            Map.entry("unique_commands", 0.0),
            Map.entry("command_diversity", 0.0),
            Map.entry("recon_command_ratio", 0.0),
            Map.entry("download_attempt", 0.0),
            Map.entry("lateral_movement", 0.0),
            Map.entry("command_inter_time_mean", mean),
            Map.entry("command_inter_time_std", std),
            Map.entry("strategy_shift_count", (double) categories.size()),
            Map.entry("retry_after_block", events.size() > 5 ? 1.0 : 0.0)
        );
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> callAiDetector(Map<String, Object> features) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("features", features));
            var request = HttpRequest.newBuilder()
                .uri(URI.create(mlUrl))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .timeout(Duration.ofSeconds(5))
                .build();
            var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) {
                return objectMapper.readValue(response.body(), Map.class);
            }
        } catch (Exception e) {
            log.debug("[AI_DETECT] ML service unavailable: {}", e.getMessage());
        }
        return null;
    }

    private void createAiAgentEvent(String ip, float confidence, SecurityEvent latestEvent) {
        SecurityEvent aiEvent = new SecurityEvent();
        aiEvent.setEventId("ai-detect-" + UUID.randomUUID());
        aiEvent.setTimestamp(Instant.now());
        aiEvent.setSourceIp(ip);
        aiEvent.setSourcePort(0);
        aiEvent.setDestIp(latestEvent.getDestIp());
        aiEvent.setDestPort(latestEvent.getDestPort());
        aiEvent.setProtocol(latestEvent.getProtocol());
        aiEvent.setCategory("AI_AGENT");
        aiEvent.setConfidence(confidence);
        aiEvent.setSourceComponent("ai_detector");
        aiEvent.setResponseTier(EventService.determineTier(aiEvent.getCategory(), confidence));

        eventService.save(aiEvent);
        redisPublisher.publishEvent(aiEvent);
    }
}
