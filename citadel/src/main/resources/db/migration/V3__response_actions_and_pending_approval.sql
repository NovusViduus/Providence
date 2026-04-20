CREATE TABLE response_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     UUID REFERENCES incident_reports(id),
    event_id        UUID REFERENCES security_events(id),
    action_type     VARCHAR(32) NOT NULL,
    source_ip       INET NOT NULL,
    success         BOOLEAN NOT NULL,
    detail          TEXT,
    platform        VARCHAR(32) NOT NULL,
    ttl_seconds     INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    reversed_at     TIMESTAMPTZ,
    reversed_reason VARCHAR(32)
);

CREATE INDEX idx_response_actions_ip ON response_actions (source_ip);
CREATE INDEX idx_response_actions_active ON response_actions (expires_at) WHERE reversed_at IS NULL;

ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS pending_approval BOOLEAN NOT NULL DEFAULT false;
