package com.providence.citadel.service;

import com.providence.citadel.model.SecurityEvent;
import com.providence.citadel.repository.EventRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class EventService {

    private final EventRepository eventRepository;

    public EventService(EventRepository eventRepository) {
        this.eventRepository = eventRepository;
    }

    @Transactional
    public SecurityEvent save(SecurityEvent event) {
        return eventRepository.save(event);
    }

    public Optional<SecurityEvent> findById(UUID id) {
        return eventRepository.findById(id);
    }

    public Optional<SecurityEvent> findByEventId(String eventId) {
        return eventRepository.findByEventId(eventId);
    }

    public Page<SecurityEvent> findAll(Pageable pageable) {
        return eventRepository.findAll(pageable);
    }

    public Page<SecurityEvent> findByCategory(String category, Pageable pageable) {
        return eventRepository.findByCategory(category, pageable);
    }

    public Page<SecurityEvent> findBySourceIp(String ip, Pageable pageable) {
        return eventRepository.findBySourceIp(ip, pageable);
    }

    public Page<SecurityEvent> findByResponseTier(String tier, Pageable pageable) {
        return eventRepository.findByResponseTier(tier, pageable);
    }

    public Page<SecurityEvent> findByTimestampBetween(Instant from, Instant to, Pageable pageable) {
        return eventRepository.findByTimestampBetween(from, to, pageable);
    }

    public Page<SecurityEvent> findByMinConfidence(float threshold, Pageable pageable) {
        return eventRepository.findByConfidenceGreaterThanEqual(threshold, pageable);
    }

    public Page<SecurityEvent> findFiltered(String category, String tier, Float minConfidence,
                                            String sourceIp, Instant from, Instant to, Pageable pageable) {
        return eventRepository.findFiltered(category, tier, minConfidence, sourceIp, from, to, pageable);
    }

    public Map<String, Object> getStats() {
        Instant oneHourAgo = Instant.now().minusSeconds(3600);
        Instant oneDayAgo = Instant.now().minusSeconds(86400);

        return Map.of(
            "total", eventRepository.count(),
            "lastHour", eventRepository.countByTimestampAfter(oneHourAgo),
            "lastDay", eventRepository.countByTimestampAfter(oneDayAgo),
            "byCategory", Map.of(
                "DOS", eventRepository.countByCategory("DOS"),
                "PROBE", eventRepository.countByCategory("PROBE"),
                "BRUTE_FORCE", eventRepository.countByCategory("BRUTE_FORCE"),
                "INJECTION", eventRepository.countByCategory("INJECTION"),
                "EXFILTRATION", eventRepository.countByCategory("EXFILTRATION"),
                "AI_AGENT", eventRepository.countByCategory("AI_AGENT"),
                "BENIGN", eventRepository.countByCategory("BENIGN")
            ),
            "byTier", Map.of(
                "OBSERVE", eventRepository.countByResponseTier("OBSERVE"),
                "RECOMMEND", eventRepository.countByResponseTier("RECOMMEND"),
                "ACT", eventRepository.countByResponseTier("ACT")
            )
        );
    }

    public static String determineTier(String category, float confidence) {
        if ("BENIGN".equalsIgnoreCase(category)) return "OBSERVE";
        if (confidence > 0.85f) return "ACT";
        if (confidence >= 0.60f) return "RECOMMEND";
        return "OBSERVE";
    }
}
