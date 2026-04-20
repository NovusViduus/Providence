package com.providence.citadel.repository;

import com.providence.citadel.model.IncidentReport;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.UUID;

@Repository
public interface IncidentRepository extends JpaRepository<IncidentReport, UUID> {

    Page<IncidentReport> findByResolved(boolean resolved, Pageable pageable);

    Page<IncidentReport> findByCategory(String category, Pageable pageable);

    Page<IncidentReport> findByCreatedAtBetween(Instant from, Instant to, Pageable pageable);
}
