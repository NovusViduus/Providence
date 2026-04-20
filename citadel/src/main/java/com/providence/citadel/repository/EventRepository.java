package com.providence.citadel.repository;

import com.providence.citadel.model.SecurityEvent;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface EventRepository extends JpaRepository<SecurityEvent, UUID> {

    Optional<SecurityEvent> findByEventId(String eventId);

    Page<SecurityEvent> findByCategory(String category, Pageable pageable);

    @Query("SELECT e FROM SecurityEvent e WHERE CAST(e.sourceIp AS string) = :ip")
    Page<SecurityEvent> findBySourceIp(@Param("ip") String ip, Pageable pageable);

    Page<SecurityEvent> findByResponseTier(String tier, Pageable pageable);

    Page<SecurityEvent> findByTimestampBetween(Instant start, Instant end, Pageable pageable);

    Page<SecurityEvent> findByConfidenceGreaterThanEqual(float threshold, Pageable pageable);

    @Query(value = "SELECT * FROM security_events e WHERE "
         + "(:category IS NULL OR e.category = :category) AND "
         + "(:tier IS NULL OR e.response_tier = :tier) AND "
         + "(CAST(:minConfidence AS real) IS NULL OR e.confidence >= CAST(:minConfidence AS real)) AND "
         + "(CAST(:sourceIp AS text) IS NULL OR CAST(e.source_ip AS text) = :sourceIp) AND "
         + "(CAST(:fromTime AS timestamptz) IS NULL OR e.timestamp >= CAST(:fromTime AS timestamptz)) AND "
         + "(CAST(:toTime AS timestamptz) IS NULL OR e.timestamp <= CAST(:toTime AS timestamptz))",
         countQuery = "SELECT count(*) FROM security_events e WHERE "
         + "(:category IS NULL OR e.category = :category) AND "
         + "(:tier IS NULL OR e.response_tier = :tier) AND "
         + "(CAST(:minConfidence AS real) IS NULL OR e.confidence >= CAST(:minConfidence AS real)) AND "
         + "(CAST(:sourceIp AS text) IS NULL OR CAST(e.source_ip AS text) = :sourceIp) AND "
         + "(CAST(:fromTime AS timestamptz) IS NULL OR e.timestamp >= CAST(:fromTime AS timestamptz)) AND "
         + "(CAST(:toTime AS timestamptz) IS NULL OR e.timestamp <= CAST(:toTime AS timestamptz))",
         nativeQuery = true)
    Page<SecurityEvent> findFiltered(
        @Param("category") String category,
        @Param("tier") String tier,
        @Param("minConfidence") Float minConfidence,
        @Param("sourceIp") String sourceIp,
        @Param("fromTime") Instant fromTime,
        @Param("toTime") Instant toTime,
        Pageable pageable);

    long countByCategory(String category);

    long countByResponseTier(String tier);

    long countByTimestampAfter(Instant after);
}
