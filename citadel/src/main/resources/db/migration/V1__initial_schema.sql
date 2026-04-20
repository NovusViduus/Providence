CREATE TABLE security_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            VARCHAR(64) NOT NULL UNIQUE,
    timestamp           TIMESTAMPTZ NOT NULL,
    source_ip           INET NOT NULL,
    source_port         INTEGER NOT NULL,
    dest_ip             INET NOT NULL,
    dest_port           INTEGER NOT NULL,
    protocol            VARCHAR(10) NOT NULL,
    category            VARCHAR(32) NOT NULL,
    subcategory         VARCHAR(64),
    confidence          REAL NOT NULL,
    feature_importances JSONB,
    source_component    VARCHAR(16) NOT NULL,
    ja3_hash            VARCHAR(32),
    flow_duration       REAL,
    packet_count        BIGINT,
    byte_count          BIGINT,
    response_tier       VARCHAR(16) NOT NULL,
    response_action     VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_timestamp ON security_events (timestamp DESC);
CREATE INDEX idx_events_source_ip ON security_events (source_ip);
CREATE INDEX idx_events_category ON security_events (category);
CREATE INDEX idx_events_confidence ON security_events (confidence);
CREATE INDEX idx_events_response_tier ON security_events (response_tier);

CREATE TABLE playbooks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(128) NOT NULL UNIQUE,
    category        VARCHAR(32) NOT NULL,
    description     TEXT,
    actions         JSONB NOT NULL,
    min_confidence  REAL NOT NULL DEFAULT 0.85,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    ttl_seconds     INTEGER NOT NULL DEFAULT 3600,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE incident_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES security_events(id),
    playbook_id     UUID REFERENCES playbooks(id),
    response_tier   VARCHAR(16) NOT NULL,
    actions_taken   JSONB NOT NULL,
    source_ip       INET NOT NULL,
    category        VARCHAR(32) NOT NULL,
    confidence      REAL NOT NULL,
    resolved        BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);
