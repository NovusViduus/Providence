package com.providence.citadel;

import com.providence.citadel.firewall.FirewallManager;
import com.providence.citadel.firewall.NoopFirewallManager;
import com.providence.citadel.model.*;
import com.providence.citadel.repository.*;
import com.providence.citadel.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
@Import(TestContainersConfig.class)
class ResponseEngineIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private EventRepository eventRepository;
    @Autowired private IncidentRepository incidentRepository;
    @Autowired private ResponseActionRepository actionRepository;
    @Autowired private EventService eventService;
    @Autowired private ResponseOrchestrator orchestrator;
    @Autowired private IncidentReportGenerator incidentGenerator;
    @Autowired private BlockExpiryService blockExpiryService;
    @Autowired private FirewallManager firewallManager;
    @Autowired private StringRedisTemplate redisTemplate;

    @BeforeEach
    void cleanup() {
        actionRepository.deleteAll();
        incidentRepository.deleteAll();
        eventRepository.deleteAll();
        // Clear Redis block keys
        var keys = redisTemplate.keys("block:active:*");
        if (keys != null && !keys.isEmpty()) redisTemplate.delete(keys);
    }

    private SecurityEvent createAndSave(String category, float confidence, String ip) {
        SecurityEvent e = new SecurityEvent();
        e.setEventId(UUID.randomUUID().toString());
        e.setTimestamp(Instant.now());
        e.setSourceIp(ip);
        e.setSourcePort(12345);
        e.setDestIp("192.168.1.1");
        e.setDestPort(80);
        e.setProtocol("TCP");
        e.setCategory(category);
        e.setConfidence(confidence);
        e.setSourceComponent("eye");
        e.setResponseTier(EventService.determineTier(category, confidence));
        return eventService.save(e);
    }

    // Test 1: ACT tier → firewall action → expiry cycle
    @Test
    void actTierBlockAndExpiry() throws Exception {
        SecurityEvent event = createAndSave("DOS", 0.92f, "1.2.3.4");
        ResponseDecision decision = orchestrator.evaluate(event);

        assertThat(decision.tier()).isEqualTo("ACT");

        // Verify firewall was called (noop tracks rules)
        var rules = firewallManager.listRules();
        assertThat(rules).anyMatch(r -> r.ip().equals("1.2.3.4"));

        // Verify response_actions persisted
        var actions = actionRepository.findAllActive();
        assertThat(actions).anyMatch(a -> a.getSourceIp().equals("1.2.3.4") && a.isSuccess());

        // Verify Redis block key
        String blockKey = redisTemplate.opsForValue().get("block:active:1.2.3.4");
        assertThat(blockKey).isNotNull();

        // Verify active blocks REST endpoint
        mockMvc.perform(get("/api/v1/blocks"))
            .andExpect(status().isOk());

        // Verify actions REST endpoint
        mockMvc.perform(get("/api/v1/actions?active=true"))
            .andExpect(status().isOk());
    }

    // Test 2: RECOMMEND tier → pending approval → approve
    @Test
    void recommendTierApproveFlow() throws Exception {
        SecurityEvent event = createAndSave("BRUTE_FORCE", 0.72f, "5.6.7.8");
        ResponseDecision decision = orchestrator.evaluate(event);

        assertThat(decision.tier()).isEqualTo("RECOMMEND");

        // No firewall calls for RECOMMEND
        var rules = firewallManager.listRules();
        assertThat(rules).noneMatch(r -> r.ip().equals("5.6.7.8"));

        // Create incident with pending approval
        var report = incidentGenerator.generate(event, decision);
        report.setPendingApproval(true);
        incidentRepository.save(report);

        // Approve the incident
        mockMvc.perform(post("/api/v1/incidents/" + report.getId() + "/approve"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("approved"));

        // Verify firewall was called after approval
        rules = firewallManager.listRules();
        assertThat(rules).anyMatch(r -> r.ip().equals("5.6.7.8"));

        // Verify incident updated
        var updated = incidentRepository.findById(report.getId()).orElseThrow();
        assertThat(updated.isPendingApproval()).isFalse();
    }

    // Test 3: Safety guards — loopback protection
    @Test
    void safetyGuardBlocksLoopback() {
        SecurityEvent event = createAndSave("INJECTION", 0.95f, "127.0.0.1");
        ResponseDecision decision = orchestrator.evaluate(event);

        assertThat(decision.tier()).isEqualTo("ACT");
        // Firewall should refuse to block loopback
        var rules = firewallManager.listRules();
        assertThat(rules).noneMatch(r -> r.ip().equals("127.0.0.1"));
    }

    // Test 4: OBSERVE tier — no actions
    @Test
    void observeTierNoActions() {
        SecurityEvent event = createAndSave("PROBE", 0.45f, "9.8.7.6");
        ResponseDecision decision = orchestrator.evaluate(event);

        assertThat(decision.tier()).isEqualTo("OBSERVE");
        assertThat(decision.intendedActions()).isEmpty();
        var rules = firewallManager.listRules();
        assertThat(rules).noneMatch(r -> r.ip().equals("9.8.7.6"));
    }

    // Test 5: Manual unblock
    @Test
    void manualUnblock() throws Exception {
        SecurityEvent event = createAndSave("EXFILTRATION", 0.95f, "11.22.33.44");
        orchestrator.evaluate(event);

        // Verify blocked
        var rules = firewallManager.listRules();
        assertThat(rules).anyMatch(r -> r.ip().equals("11.22.33.44"));

        // Manual unblock via REST
        mockMvc.perform(delete("/api/v1/blocks/11.22.33.44"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("unblocked"));

        // Verify unblocked
        rules = firewallManager.listRules();
        assertThat(rules).noneMatch(r -> r.ip().equals("11.22.33.44"));
    }

    // Test 6: Reject pending incident
    @Test
    void rejectPendingIncident() throws Exception {
        SecurityEvent event = createAndSave("BRUTE_FORCE", 0.72f, "55.66.77.88");
        ResponseDecision decision = orchestrator.evaluate(event);
        var report = incidentGenerator.generate(event, decision);
        report.setPendingApproval(true);
        incidentRepository.save(report);

        mockMvc.perform(post("/api/v1/incidents/" + report.getId() + "/reject"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("rejected"));

        var updated = incidentRepository.findById(report.getId()).orElseThrow();
        assertThat(updated.isPendingApproval()).isFalse();
        assertThat(updated.getNotes()).contains("Rejected");
    }

    // Test 7: Noop platform name
    @Test
    void noopPlatformName() {
        assertThat(firewallManager.platformName()).isEqualTo("noop");
    }

    // Test 8: Full TTL expiry lifecycle — set expiry in the past, trigger sweep, verify unblock
    @Test
    void ttlExpiryLifecycle() {
        SecurityEvent event = createAndSave("BRUTE_FORCE", 0.92f, "99.88.77.66");
        orchestrator.evaluate(event);

        // Verify blocked
        var rules = firewallManager.listRules();
        assertThat(rules).anyMatch(r -> r.ip().equals("99.88.77.66"));

        // Verify action persisted
        var actions = actionRepository.findAllActive();
        var blockAction = actions.stream()
            .filter(a -> "99.88.77.66".equals(a.getSourceIp()))
            .findFirst().orElseThrow();
        assertThat(blockAction.isSuccess()).isTrue();
        assertThat(blockAction.getReversedAt()).isNull();

        // Backdate the expiry to the past (already expired)
        blockAction.setExpiresAt(Instant.now().minusSeconds(1));
        actionRepository.save(blockAction);

        // Trigger the sweep manually — no sleeping needed
        blockExpiryService.sweepExpiredBlocks();

        // Verify unblocked
        rules = firewallManager.listRules();
        assertThat(rules).noneMatch(r -> r.ip().equals("99.88.77.66"));

        // Verify action updated with reversal
        var updated = actionRepository.findById(blockAction.getId()).orElseThrow();
        assertThat(updated.getReversedAt()).isNotNull();
        assertThat(updated.getReversedReason()).isEqualTo("TTL_EXPIRED");

        // Verify incident resolved
        var incidents = incidentRepository.findAll();
        var relatedIncident = incidents.stream()
            .filter(i -> blockAction.getIncidentId() != null && blockAction.getIncidentId().equals(i.getId()))
            .findFirst();
        relatedIncident.ifPresent(i -> {
            assertThat(i.isResolved()).isTrue();
            assertThat(i.getResolvedAt()).isNotNull();
        });
    }
}
