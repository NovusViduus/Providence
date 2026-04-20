package com.providence.citadel.api;

import com.providence.citadel.firewall.FirewallManager;
import com.providence.citadel.firewall.Result;
import com.providence.citadel.model.IncidentReport;
import com.providence.citadel.model.Playbook;
import com.providence.citadel.model.ResponseAction;
import com.providence.citadel.repository.IncidentRepository;
import com.providence.citadel.repository.PlaybookRepository;
import com.providence.citadel.repository.ResponseActionRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/incidents")
public class IncidentController {

    private final IncidentRepository incidentRepository;
    private final FirewallManager firewallManager;
    private final ResponseActionRepository actionRepository;
    private final PlaybookRepository playbookRepository;

    public IncidentController(IncidentRepository incidentRepository,
                              FirewallManager firewallManager,
                              ResponseActionRepository actionRepository,
                              PlaybookRepository playbookRepository) {
        this.incidentRepository = incidentRepository;
        this.firewallManager = firewallManager;
        this.actionRepository = actionRepository;
        this.playbookRepository = playbookRepository;
    }

    @GetMapping
    public Page<IncidentReport> listIncidents(
            @RequestParam(required = false) Boolean resolved,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        size = Math.min(size, 200);
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));

        if (resolved != null) return incidentRepository.findByResolved(resolved, pageable);
        if (category != null) return incidentRepository.findByCategory(category, pageable);
        if (from != null && to != null) return incidentRepository.findByCreatedAtBetween(from, to, pageable);

        return incidentRepository.findAll(pageable);
    }

    @GetMapping("/{id}")
    public ResponseEntity<IncidentReport> getIncident(@PathVariable UUID id) {
        return incidentRepository.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PatchMapping("/{id}")
    public ResponseEntity<IncidentReport> updateIncident(@PathVariable UUID id, @RequestBody Map<String, Object> updates) {
        return incidentRepository.findById(id).map(incident -> {
            if (updates.containsKey("resolved")) {
                incident.setResolved((Boolean) updates.get("resolved"));
                if (incident.isResolved()) {
                    incident.setResolvedAt(Instant.now());
                }
            }
            if (updates.containsKey("notes")) {
                incident.setNotes((String) updates.get("notes"));
            }
            return ResponseEntity.ok(incidentRepository.save(incident));
        }).orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/approve")
    public ResponseEntity<Map<String, Object>> approveIncident(@PathVariable UUID id) {
        return incidentRepository.findById(id).map(incident -> {
            if (!incident.isPendingApproval()) {
                return ResponseEntity.badRequest().body(Map.<String, Object>of(
                    "error", "Incident is not pending approval"));
            }

            // Look up playbook TTL from the incident's category
            int ttlSeconds = playbookRepository
                .findByCategoryAndEnabledTrueOrderByMinConfidenceDesc(incident.getCategory())
                .stream().findFirst()
                .map(Playbook::getTtlSeconds)
                .orElse(3600);

            // Execute the pending action
            Result result = firewallManager.blockIP(incident.getSourceIp(), Duration.ofSeconds(ttlSeconds));

            // Persist action
            ResponseAction action = new ResponseAction();
            action.setIncidentId(incident.getId());
            action.setActionType("BLOCK");
            action.setSourceIp(incident.getSourceIp());
            action.setSuccess(result.success());
            action.setDetail(result.detail());
            action.setPlatform(firewallManager.platformName());
            action.setTtlSeconds(ttlSeconds);
            action.setExpiresAt(result.expiresAt());
            actionRepository.save(action);

            incident.setPendingApproval(false);
            incidentRepository.save(incident);

            return ResponseEntity.ok(Map.<String, Object>of(
                "status", "approved",
                "actionSuccess", result.success(),
                "detail", result.detail()));
        }).orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/reject")
    public ResponseEntity<Map<String, Object>> rejectIncident(@PathVariable UUID id) {
        return incidentRepository.findById(id).map(incident -> {
            if (!incident.isPendingApproval()) {
                return ResponseEntity.badRequest().body(Map.<String, Object>of(
                    "error", "Incident is not pending approval"));
            }
            incident.setPendingApproval(false);
            incident.setNotes((incident.getNotes() != null ? incident.getNotes() + "\n" : "") + "Rejected by operator");
            incidentRepository.save(incident);
            return ResponseEntity.ok(Map.<String, Object>of("status", "rejected"));
        }).orElse(ResponseEntity.notFound().build());
    }
}
