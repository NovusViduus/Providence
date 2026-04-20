package com.providence.citadel.firewall;

import java.time.Instant;

public record Result(
    boolean success,
    String action,
    String ip,
    String detail,
    Instant timestamp,
    Instant expiresAt
) {
    public static Result success(String action, String ip, String detail, Instant expiresAt) {
        return new Result(true, action, ip, detail, Instant.now(), expiresAt);
    }

    public static Result failure(String action, String ip, String detail) {
        return new Result(false, action, ip, detail, Instant.now(), null);
    }
}
