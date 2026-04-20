package com.providence.citadel.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "playbooks")
public class Playbook {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @Column(nullable = false, unique = true, length = 128)
    private String name;

    @Column(nullable = false, length = 32)
    private String category;

    private String description;

    @Column(nullable = false, columnDefinition = "jsonb")
    private String actions;

    @Column(name = "min_confidence", nullable = false)
    private float minConfidence;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "ttl_seconds", nullable = false)
    private int ttlSeconds = 3600;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getActions() { return actions; }
    public void setActions(String actions) { this.actions = actions; }
    public float getMinConfidence() { return minConfidence; }
    public void setMinConfidence(float minConfidence) { this.minConfidence = minConfidence; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public int getTtlSeconds() { return ttlSeconds; }
    public void setTtlSeconds(int ttlSeconds) { this.ttlSeconds = ttlSeconds; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
