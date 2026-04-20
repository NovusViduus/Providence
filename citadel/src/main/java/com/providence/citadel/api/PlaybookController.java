package com.providence.citadel.api;

import com.providence.citadel.model.Playbook;
import com.providence.citadel.repository.PlaybookRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/playbooks")
public class PlaybookController {

    private final PlaybookRepository playbookRepository;

    public PlaybookController(PlaybookRepository playbookRepository) {
        this.playbookRepository = playbookRepository;
    }

    @GetMapping
    public List<Playbook> listPlaybooks() {
        return playbookRepository.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Playbook> getPlaybook(@PathVariable UUID id) {
        return playbookRepository.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}")
    public ResponseEntity<Playbook> updatePlaybook(@PathVariable UUID id, @RequestBody Playbook update) {
        return playbookRepository.findById(id).map(existing -> {
            if (update.getActions() != null) existing.setActions(update.getActions());
            if (update.getMinConfidence() > 0) existing.setMinConfidence(update.getMinConfidence());
            if (update.getDescription() != null) existing.setDescription(update.getDescription());
            existing.setEnabled(update.isEnabled());
            if (update.getTtlSeconds() > 0) existing.setTtlSeconds(update.getTtlSeconds());
            return ResponseEntity.ok(playbookRepository.save(existing));
        }).orElse(ResponseEntity.notFound().build());
    }
}
