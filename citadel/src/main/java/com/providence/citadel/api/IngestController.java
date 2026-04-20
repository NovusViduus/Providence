package com.providence.citadel.api;

import com.providence.citadel.model.ResponseDecision;
import com.providence.citadel.model.SecurityEvent;
import com.providence.citadel.service.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Map;

/**
 * REST ingest endpoint for The Oracle (cloud agent).
 * Accepts ClassifiedEvent JSON and runs through the same pipeline as gRPC.
 */
@RestController
@RequestMapping("/api/v1/events")
public class IngestController {

    private static final Logger log = LoggerFactory.getLogger(IngestController.class);

    private final EventService eventService;
    private final ResponseOrchestrator orchestrator;
    private final IncidentReportGenerator incidentGenerator;
    private final RedisEventPublisher redisPublisher;
    private final PlaybookEngine playbookEngine;
    private final AiDetectionService aiDetectionService;

    public IngestController(EventService eventService, ResponseOrchestrator orchestrator,
                            IncidentReportGenerator incidentGenerator, RedisEventPublisher redisPublisher,
                            PlaybookEngine playbookEngine, AiDetectionService aiDetectionService) {
        this.eventService = eventService;
        this.orchestrator = orchestrator;
        this.incidentGenerator = incidentGenerator;
        this.redisPublisher = redisPublisher;
        this.playbookEngine = playbookEngine;
        this.aiDetectionService = aiDetectionService;
    }

    @PostMapping("/ingest")
    public ResponseEntity<Map<String, Object>> ingestEvent(@RequestBody Map<String, Object> body) {
        try {
            SecurityEvent event = new SecurityEvent();
            event.setEventId((String) body.getOrDefault("eventId", "oracle-" + System.currentTimeMillis()));

            // Accept timestamp as epoch millis (Number) or ISO-8601 string
            Object tsRaw = body.getOrDefault("timestamp", System.currentTimeMillis());
            Instant ts;
            if (tsRaw instanceof Number) {
                ts = Instant.ofEpochMilli(((Number) tsRaw).longValue());
            } else if (tsRaw instanceof String) {
                String tsStr = (String) tsRaw;
                try {
                    ts = Instant.parse(tsStr);
                } catch (DateTimeParseException e) {
                    // Try as epoch millis string
                    ts = Instant.ofEpochMilli(Long.parseLong(tsStr));
                }
            } else {
                ts = Instant.now();
            }
            event.setTimestamp(ts);
            event.setSourceIp((String) body.getOrDefault("sourceIp", "0.0.0.0"));
            event.setSourcePort(toInt(body.getOrDefault("sourcePort", 0)));
            event.setDestIp((String) body.getOrDefault("destIp", "0.0.0.0"));
            event.setDestPort(toInt(body.getOrDefault("destPort", 0)));
            event.setProtocol((String) body.getOrDefault("protocol", "TCP"));
            event.setCategory((String) body.getOrDefault("category", "BENIGN"));
            event.setSubcategory((String) body.getOrDefault("subcategory", ""));
            event.setConfidence(toFloat(body.getOrDefault("confidence", 0.0)));
            event.setSourceComponent((String) body.getOrDefault("sourceComponent", "oracle"));

            String tier = EventService.determineTier(event.getCategory(), event.getConfidence());
            event.setResponseTier(tier);

            SecurityEvent saved = eventService.save(event);
            redisPublisher.publishEvent(saved);
            aiDetectionService.onEvent(saved);

            ResponseDecision decision = orchestrator.evaluate(saved);

            if ("ACT".equals(tier)) {
                int ttl = playbookEngine.match(saved).map(p -> p.getTtlSeconds()).orElse(3600);
                redisPublisher.cacheActiveThreat(saved, ttl);
            }
            if ("RECOMMEND".equals(tier)) {
                var report = incidentGenerator.generate(saved, decision);
                if (report != null) {
                    report.setPendingApproval(true);
                    eventService.saveIncident(report);
                }
            }

            log.info("[INGEST] Event {} from {} category={} tier={}", event.getEventId(), event.getSourceComponent(), event.getCategory(), tier);

            return ResponseEntity.ok(Map.of(
                "eventId", saved.getEventId(),
                "responseTier", tier,
                "responseAction", tier
            ));
        } catch (Exception e) {
            log.error("[INGEST] Error: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    private static int toInt(Object val) {
        if (val instanceof Number) return ((Number) val).intValue();
        if (val instanceof String) return Integer.parseInt((String) val);
        return 0;
    }

    private static float toFloat(Object val) {
        if (val instanceof Number) return ((Number) val).floatValue();
        if (val instanceof String) return Float.parseFloat((String) val);
        return 0f;
    }
}
