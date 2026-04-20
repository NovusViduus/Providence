package com.providence.citadel.service;

import com.providence.citadel.model.IncidentReport;
import com.providence.citadel.model.ResponseDecision;
import com.providence.citadel.model.SecurityEvent;
import com.providence.citadel.repository.IncidentRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IncidentReportGenerator {

    private static final Logger log = LoggerFactory.getLogger(IncidentReportGenerator.class);
    private final IncidentRepository incidentRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public IncidentReportGenerator(IncidentRepository incidentRepository) {
        this.incidentRepository = incidentRepository;
    }

    @Transactional
    public IncidentReport generate(SecurityEvent event, ResponseDecision decision) {
        IncidentReport report = new IncidentReport();
        report.setEvent(event);
        report.setPlaybook(decision.matchedPlaybook());
        report.setResponseTier(decision.tier());
        report.setSourceIp(event.getSourceIp());
        report.setCategory(event.getCategory());
        report.setConfidence(event.getConfidence());

        try {
            report.setActionsTaken(objectMapper.writeValueAsString(decision.intendedActions()));
        } catch (Exception e) {
            report.setActionsTaken("[]");
        }

        IncidentReport saved = incidentRepository.save(report);
        log.info("Incident report generated: id={} event={} tier={} actions={}",
            saved.getId(), event.getEventId(), decision.tier(), decision.intendedActions());
        return saved;
    }
}
