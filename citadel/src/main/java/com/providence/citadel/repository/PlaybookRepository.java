package com.providence.citadel.repository;

import com.providence.citadel.model.Playbook;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface PlaybookRepository extends JpaRepository<Playbook, UUID> {

    List<Playbook> findByCategoryAndEnabledTrueOrderByMinConfidenceDesc(String category);
}
