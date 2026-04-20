package com.providence.citadel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.providence.citadel.model.IncidentReport;
import com.providence.citadel.model.Playbook;
import com.providence.citadel.model.SecurityEvent;
import com.providence.citadel.repository.EventRepository;
import com.providence.citadel.repository.IncidentRepository;
import com.providence.citadel.repository.PlaybookRepository;
import com.providence.citadel.service.EventService;
import com.providence.citadel.service.IncidentReportGenerator;
import com.providence.citadel.service.RedisEventPublisher;
import com.providence.citadel.service.ResponseOrchestrator;
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
class CitadelIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private EventRepository eventRepository;
    @Autowired private PlaybookRepository playbookRepository;
    @Autowired private IncidentRepository incidentRepository;
    @Autowired private EventService eventService;
    @Autowired private ResponseOrchestrator orchestrator;
    @Autowired private IncidentReportGenerator incidentGenerator;
    @Autowired private RedisEventPublisher redisPublisher;
    @Autowired private StringRedisTemplate redisTemplate;
    @Autowired private ObjectMapper objectMapper;

    @BeforeEach
    void cleanup() {
        incidentRepository.deleteAll();
        eventRepository.deleteAll();
    }

    private SecurityEvent createEvent(String category, float confidence) {
        SecurityEvent e = new SecurityEvent();
        e.setEventId(UUID.randomUUID().toString());
        e.setTimestamp(Instant.now());
        e.setSourceIp("10.0.0.1");
        e.setSourcePort(12345);
        e.setDestIp("192.168.1.1");
        e.setDestPort(80);
        e.setProtocol("TCP");
        e.setCategory(category);
        e.setConfidence(confidence);
        e.setSourceComponent("eye");
        e.setResponseTier(EventService.determineTier(category, confidence));
        return e;
    }

    // Test 1: Event persistence and retrieval
    @Test
    void eventPersistenceAndRetrieval() {
        SecurityEvent event = eventService.save(createEvent("DOS", 0.75f));
        assertThat(event.getId()).isNotNull();

        var found = eventRepository.findByEventId(event.getEventId());
        assertThat(found).isPresent();
        assertThat(found.get().getCategory()).isEqualTo("DOS");
        assertThat(found.get().getResponseTier()).isEqualTo("RECOMMEND");
    }

    // Test 2: REST query with filtering
    @Test
    void restQueryFiltering() throws Exception {
        eventService.save(createEvent("DOS", 0.5f));
        eventService.save(createEvent("DOS", 0.7f));
        eventService.save(createEvent("PROBE", 0.3f));

        mockMvc.perform(get("/api/v1/events?category=DOS"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalElements").value(2));

        mockMvc.perform(get("/api/v1/events?category=PROBE"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalElements").value(1));
    }

    // Test 3: Stats endpoint
    @Test
    void statsEndpoint() throws Exception {
        eventService.save(createEvent("DOS", 0.9f));
        eventService.save(createEvent("DOS", 0.5f));
        eventService.save(createEvent("PROBE", 0.3f));

        mockMvc.perform(get("/api/v1/events/stats"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.total").value(3));
    }

    // Test 4: Response orchestrator — OBSERVE tier
    @Test
    void orchestratorObserveTier() {
        SecurityEvent event = eventService.save(createEvent("PROBE", 0.45f));
        var decision = orchestrator.evaluate(event);
        assertThat(decision.tier()).isEqualTo("OBSERVE");
        assertThat(decision.matchedPlaybook()).isNull();
    }

    // Test 5: Response orchestrator — RECOMMEND tier
    @Test
    void orchestratorRecommendTier() {
        SecurityEvent event = eventService.save(createEvent("DOS", 0.72f));
        var decision = orchestrator.evaluate(event);
        assertThat(decision.tier()).isEqualTo("RECOMMEND");
        // Playbook exists but confidence below min_confidence (0.85), so no match
    }

    // Test 6: Response orchestrator — ACT tier with incident report
    @Test
    void orchestratorActTierWithIncident() {
        SecurityEvent event = eventService.save(createEvent("DOS", 0.92f));
        var decision = orchestrator.evaluate(event);
        assertThat(decision.tier()).isEqualTo("ACT");
        assertThat(decision.matchedPlaybook()).isNotNull();

        IncidentReport report = incidentGenerator.generate(event, decision);
        assertThat(report.getId()).isNotNull();
        assertThat(report.getResponseTier()).isEqualTo("ACT");
        assertThat(report.getCategory()).isEqualTo("DOS");
    }

    // Test 7: Redis pub/sub
    @Test
    void redisPubSub() {
        SecurityEvent event = eventService.save(createEvent("INJECTION", 0.88f));
        // Publishing should not throw
        redisPublisher.publishEvent(event);
    }

    // Test 8: Active threat cache
    @Test
    void activeThreatCache() throws Exception {
        SecurityEvent event = eventService.save(createEvent("EXFILTRATION", 0.95f));
        redisPublisher.cacheActiveThreat(event, 60);

        var threats = redisPublisher.getActiveThreats();
        assertThat(threats).containsKey("10.0.0.1");

        mockMvc.perform(get("/api/v1/threats/active"))
            .andExpect(status().isOk());
    }

    // Test 9: Playbook CRUD
    @Test
    void playbookCrud() throws Exception {
        var playbooks = playbookRepository.findAll();
        assertThat(playbooks).isNotEmpty();

        Playbook first = playbooks.get(0);
        mockMvc.perform(get("/api/v1/playbooks/" + first.getId()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value(first.getName()));
    }

    // Test 10: 404 for nonexistent resource
    @Test
    void notFoundForMissingResource() throws Exception {
        mockMvc.perform(get("/api/v1/events/" + UUID.randomUUID()))
            .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/v1/playbooks/" + UUID.randomUUID()))
            .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/v1/incidents/" + UUID.randomUUID()))
            .andExpect(status().isNotFound());
    }

    // Test 11: Tier boundary precision
    @Test
    void tierBoundaries() {
        assertThat(EventService.determineTier("DOS", 0.59f)).isEqualTo("OBSERVE");
        assertThat(EventService.determineTier("DOS", 0.60f)).isEqualTo("RECOMMEND");
        assertThat(EventService.determineTier("DOS", 0.85f)).isEqualTo("RECOMMEND");
        assertThat(EventService.determineTier("DOS", 0.86f)).isEqualTo("ACT");
        // BENIGN should always be OBSERVE regardless of confidence
        assertThat(EventService.determineTier("BENIGN", 0.99f)).isEqualTo("OBSERVE");
    }
}
