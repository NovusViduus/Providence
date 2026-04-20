package com.providence.citadel.model;

import jakarta.persistence.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "incident_reports")
public class IncidentReport {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "event_id", nullable = false, insertable = false, updatable = false)
    private SecurityEvent event;

    @Column(name = "event_id", nullable = false)
    private UUID eventFk;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "playbook_id", insertable = false, updatable = false)
    private Playbook playbook;

    @Column(name = "playbook_id")
    private UUID playbookFk;

    @JsonProperty("eventId")
    public UUID getEventId() {
        return eventFk;
    }

    @JsonProperty("playbookId")
    public UUID getPlaybookId() {
        return playbookFk;
    }

    @Column(name = "response_tier", nullable = false, length = 16)
    private String responseTier;

    @Column(name = "actions_taken", nullable = false, columnDefinition = "jsonb")
    private String actionsTaken;

    @Column(name = "source_ip", nullable = false, columnDefinition = "varchar(45)")
    private String sourceIp;

    @Column(nullable = false, length = 32)
    private String category;

    @Column(nullable = false)
    private float confidence;

    @Column(nullable = false)
    private boolean resolved = false;

    @Column(name = "pending_approval", nullable = false)
    private boolean pendingApproval = false;

    private String notes;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public SecurityEvent getEvent() { return event; }
    public void setEvent(SecurityEvent event) {
        this.event = event;
        this.eventFk = event != null ? event.getId() : null;
    }
    public Playbook getPlaybook() { return playbook; }
    public void setPlaybook(Playbook playbook) {
        this.playbook = playbook;
        this.playbookFk = playbook != null ? playbook.getId() : null;
    }
    public String getResponseTier() { return responseTier; }
    public void setResponseTier(String responseTier) { this.responseTier = responseTier; }
    public String getActionsTaken() { return actionsTaken; }
    public void setActionsTaken(String actionsTaken) { this.actionsTaken = actionsTaken; }
    public String getSourceIp() { return sourceIp; }
    public void setSourceIp(String sourceIp) { this.sourceIp = sourceIp; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public float getConfidence() { return confidence; }
    public void setConfidence(float confidence) { this.confidence = confidence; }
    public boolean isResolved() { return resolved; }
    public void setResolved(boolean resolved) { this.resolved = resolved; }
    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getResolvedAt() { return resolvedAt; }
    public void setResolvedAt(Instant resolvedAt) { this.resolvedAt = resolvedAt; }
    public boolean isPendingApproval() { return pendingApproval; }
    public void setPendingApproval(boolean pendingApproval) { this.pendingApproval = pendingApproval; }
}
