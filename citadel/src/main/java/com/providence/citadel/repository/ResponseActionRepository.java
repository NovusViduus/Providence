package com.providence.citadel.repository;

import com.providence.citadel.model.ResponseAction;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ResponseActionRepository extends JpaRepository<ResponseAction, UUID> {

    Page<ResponseAction> findByActionType(String actionType, Pageable pageable);

    @Query("SELECT a FROM ResponseAction a WHERE CAST(a.sourceIp AS string) = :ip")
    Page<ResponseAction> findBySourceIp(String ip, Pageable pageable);

    Page<ResponseAction> findBySuccess(boolean success, Pageable pageable);

    @Query("SELECT a FROM ResponseAction a WHERE a.reversedAt IS NULL AND a.expiresAt IS NOT NULL")
    Page<ResponseAction> findActive(Pageable pageable);

    @Query("SELECT a FROM ResponseAction a WHERE a.reversedAt IS NULL AND a.expiresAt IS NOT NULL")
    List<ResponseAction> findAllActive();
}
