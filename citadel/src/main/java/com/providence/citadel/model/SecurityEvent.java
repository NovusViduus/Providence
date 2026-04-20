package com.providence.citadel.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "security_events")
public class SecurityEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @Column(name = "event_id", nullable = false, unique = true)
    private String eventId;

    @Column(nullable = false)
    private Instant timestamp;

    @Column(name = "source_ip", nullable = false, columnDefinition = "varchar(45)")
    private String sourceIp;

    @Column(name = "source_port", nullable = false)
    private int sourcePort;

    @Column(name = "dest_ip", nullable = false, columnDefinition = "varchar(45)")
    private String destIp;

    @Column(name = "dest_port", nullable = false)
    private int destPort;

    @Column(nullable = false, length = 10)
    private String protocol;

    @Column(nullable = false, length = 32)
    private String category;

    @Column(length = 64)
    private String subcategory;

    @Column(nullable = false)
    private float confidence;

    @Column(name = "feature_importances", columnDefinition = "jsonb")
    private String featureImportances;

    @Column(name = "source_component", nullable = false, length = 16)
    private String sourceComponent;

    @Column(name = "ja3_hash", length = 32)
    private String ja3Hash;

    @Column(name = "flow_duration")
    private Float flowDuration;

    @Column(name = "packet_count")
    private Long packetCount;

    @Column(name = "byte_count")
    private Long byteCount;

    @Column(name = "response_tier", nullable = false, length = 16)
    private String responseTier;

    @Column(name = "response_action")
    private String responseAction;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) createdAt = Instant.now();
    }

    // Getters and setters
    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public String getEventId() { return eventId; }
    public void setEventId(String eventId) { this.eventId = eventId; }
    public Instant getTimestamp() { return timestamp; }
    public void setTimestamp(Instant timestamp) { this.timestamp = timestamp; }
    public String getSourceIp() { return sourceIp; }
    public void setSourceIp(String sourceIp) { this.sourceIp = sourceIp; }
    public int getSourcePort() { return sourcePort; }
    public void setSourcePort(int sourcePort) { this.sourcePort = sourcePort; }
    public String getDestIp() { return destIp; }
    public void setDestIp(String destIp) { this.destIp = destIp; }
    public int getDestPort() { return destPort; }
    public void setDestPort(int destPort) { this.destPort = destPort; }
    public String getProtocol() { return protocol; }
    public void setProtocol(String protocol) { this.protocol = protocol; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public String getSubcategory() { return subcategory; }
    public void setSubcategory(String subcategory) { this.subcategory = subcategory; }
    public float getConfidence() { return confidence; }
    public void setConfidence(float confidence) { this.confidence = confidence; }
    public String getFeatureImportances() { return featureImportances; }
    public void setFeatureImportances(String featureImportances) { this.featureImportances = featureImportances; }
    public String getSourceComponent() { return sourceComponent; }
    public void setSourceComponent(String sourceComponent) { this.sourceComponent = sourceComponent; }
    public String getJa3Hash() { return ja3Hash; }
    public void setJa3Hash(String ja3Hash) { this.ja3Hash = ja3Hash; }
    public Float getFlowDuration() { return flowDuration; }
    public void setFlowDuration(Float flowDuration) { this.flowDuration = flowDuration; }
    public Long getPacketCount() { return packetCount; }
    public void setPacketCount(Long packetCount) { this.packetCount = packetCount; }
    public Long getByteCount() { return byteCount; }
    public void setByteCount(Long byteCount) { this.byteCount = byteCount; }
    public String getResponseTier() { return responseTier; }
    public void setResponseTier(String responseTier) { this.responseTier = responseTier; }
    public String getResponseAction() { return responseAction; }
    public void setResponseAction(String responseAction) { this.responseAction = responseAction; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
