package com.providence.citadel.api;

import com.providence.citadel.model.SecurityEvent;
import com.providence.citadel.service.EventService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/events")
public class EventController {

    private final EventService eventService;

    public EventController(EventService eventService) {
        this.eventService = eventService;
    }

    @GetMapping
    public Page<SecurityEvent> listEvents(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String sourceIp,
            @RequestParam(required = false) String tier,
            @RequestParam(required = false) Float minConfidence,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        size = Math.min(size, 200);
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "timestamp"));

        return eventService.findFiltered(category, tier, minConfidence, sourceIp, from, to, pageable);
    }

    @GetMapping("/{id}")
    public ResponseEntity<SecurityEvent> getEvent(@PathVariable UUID id) {
        return eventService.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/stats")
    public Map<String, Object> getStats() {
        return eventService.getStats();
    }
}
