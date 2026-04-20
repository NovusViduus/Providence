package com.providence.citadel.service;

import com.providence.citadel.model.Playbook;
import com.providence.citadel.model.SecurityEvent;
import com.providence.citadel.repository.PlaybookRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class PlaybookEngine {

    private final PlaybookRepository playbookRepository;

    public PlaybookEngine(PlaybookRepository playbookRepository) {
        this.playbookRepository = playbookRepository;
    }

    /**
     * Finds the highest-priority enabled playbook matching the event's category
     * whose min_confidence threshold is met by the event's confidence.
     */
    public Optional<Playbook> match(SecurityEvent event) {
        List<Playbook> candidates = playbookRepository
            .findByCategoryAndEnabledTrueOrderByMinConfidenceDesc(event.getCategory());

        return candidates.stream()
            .filter(p -> event.getConfidence() >= p.getMinConfidence())
            .findFirst();
    }
}
