package com.providence.citadel.api;

import com.google.protobuf.util.JsonFormat;
import com.providence.citadel.model.ResponseDecision;
import com.providence.citadel.model.SecurityEvent;
import com.providence.citadel.service.*;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import net.devh.boot.grpc.server.service.GrpcService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import providence.Event.ClassifiedEvent;
import providence.Event.EventAck;
import providence.EventServiceGrpc;

import java.time.Instant;
import java.util.Map;
import java.util.Set;

@GrpcService
public class GrpcEventService extends EventServiceGrpc.EventServiceImplBase {

    private static final Logger log = LoggerFactory.getLogger(GrpcEventService.class);
    private static final Set<String> VALID_CATEGORIES = Set.of(
        "BENIGN", "DOS", "PROBE", "BRUTE_FORCE", "INJECTION", "EXFILTRATION", "AI_AGENT"
    );

    private final EventService eventService;
    private final ResponseOrchestrator orchestrator;
    private final IncidentReportGenerator incidentGenerator;
    private final RedisEventPublisher redisPublisher;
    private final PlaybookEngine playbookEngine;
    private final AiDetectionService aiDetectionService;

    public GrpcEventService(EventService eventService,
                            ResponseOrchestrator orchestrator,
                            IncidentReportGenerator incidentGenerator,
                            RedisEventPublisher redisPublisher,
                            PlaybookEngine playbookEngine,
                            AiDetectionService aiDetectionService) {
        this.eventService = eventService;
        this.orchestrator = orchestrator;
        this.incidentGenerator = incidentGenerator;
        this.redisPublisher = redisPublisher;
        this.playbookEngine = playbookEngine;
        this.aiDetectionService = aiDetectionService;
    }

    @Override
    public void reportEvent(ClassifiedEvent request, StreamObserver<EventAck> responseObserver) {
        try {
            // Validate
            if (request.getEventId().isEmpty()) {
                responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("event_id is required").asRuntimeException());
                return;
            }
            if (!request.hasClassification()) {
                responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("classification is required").asRuntimeException());
                return;
            }
            String category = request.getClassification().getCategory();
            if (!VALID_CATEGORIES.contains(category)) {
                responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("invalid category: " + category).asRuntimeException());
                return;
            }

            // Map to entity
            SecurityEvent event = mapToEntity(request);
            String tier = EventService.determineTier(event.getCategory(), event.getConfidence());
            event.setResponseTier(tier);

            // Persist
            SecurityEvent saved = eventService.save(event);

            // Publish to Redis
            redisPublisher.publishEvent(saved);

            // Feed to AI detection session aggregator
            aiDetectionService.onEvent(saved);

            // Evaluate response (orchestrator now handles ACT-tier execution internally)
            ResponseDecision decision = orchestrator.evaluate(saved);

            // Cache active threat for ACT tier
            if ("ACT".equals(tier)) {
                int ttl = playbookEngine.match(saved)
                    .map(p -> p.getTtlSeconds())
                    .orElse(3600);
                redisPublisher.cacheActiveThreat(saved, ttl);
            }

            // For RECOMMEND tier, create incident with pending_approval
            if ("RECOMMEND".equals(tier)) {
                var report = incidentGenerator.generate(saved, decision);
                if (report != null) {
                    report.setPendingApproval(true);
                    // save handled by generator
                }
            }

            log.debug("Processed event {} tier={}", request.getEventId(), tier);
            if (!"OBSERVE".equals(tier)) {
                log.info("Event {} category={} confidence={} tier={}",
                    request.getEventId(), category, request.getClassification().getConfidence(), tier);
            }

            // Respond
            EventAck ack = EventAck.newBuilder()
                .setEventId(request.getEventId())
                .setAccepted(true)
                .setResponseAction(tier)
                .build();
            responseObserver.onNext(ack);
            responseObserver.onCompleted();

        } catch (Exception e) {
            log.error("Error processing event {}", request.getEventId(), e);
            responseObserver.onError(Status.INTERNAL
                .withDescription("Internal error: " + e.getMessage()).asRuntimeException());
        }
    }

    private SecurityEvent mapToEntity(ClassifiedEvent req) {
        SecurityEvent e = new SecurityEvent();
        e.setEventId(req.getEventId());
        e.setTimestamp(Instant.ofEpochMilli(req.getTimestamp()));
        e.setSourceIp(req.getSourceIp());
        e.setSourcePort(req.getSourcePort());
        e.setDestIp(req.getDestIp());
        e.setDestPort(req.getDestPort());
        e.setProtocol(req.getProtocol());
        e.setCategory(req.getClassification().getCategory());
        e.setSubcategory(req.getClassification().getSubcategory());
        e.setConfidence(req.getClassification().getConfidence());
        e.setSourceComponent(req.getSourceComponent().isEmpty() ? "eye" : req.getSourceComponent());
        e.setJa3Hash(req.getJa3Hash().isEmpty() ? null : req.getJa3Hash());
        e.setFlowDuration(req.getFlowDuration());
        e.setPacketCount(req.getPacketCount());
        e.setByteCount(req.getByteCount());

        // Serialize feature importances to JSON
        try {
            Map<String, Float> importances = req.getClassification().getFeatureImportancesMap();
            if (!importances.isEmpty()) {
                var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                e.setFeatureImportances(mapper.writeValueAsString(importances));
            }
        } catch (Exception ex) {
            log.warn("Failed to serialize feature importances", ex);
        }

        return e;
    }
}
