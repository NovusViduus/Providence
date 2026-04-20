package com.providence.citadel.firewall;

import java.time.Instant;

public record Rule(
    String ip,
    String action,
    Instant createdAt,
    Instant expiresAt,
    String source
) {}
