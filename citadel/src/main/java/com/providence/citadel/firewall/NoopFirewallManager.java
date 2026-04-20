package com.providence.citadel.firewall;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Component
@ConditionalOnProperty(name = "providence.firewall.platform", havingValue = "noop", matchIfMissing = true)
public class NoopFirewallManager implements FirewallManager {

    private static final Logger log = LoggerFactory.getLogger(NoopFirewallManager.class);
    private final ConcurrentHashMap<String, Rule> activeRules = new ConcurrentHashMap<>();

    @Override
    public Result blockIP(String ip, Duration ttl) {
        Result guard = FirewallSafetyGuard.validate(ip, "BLOCK");
        if (guard != null) return guard;

        Instant expiresAt = Instant.now().plus(ttl);
        activeRules.put(ip, new Rule(ip, "BLOCK", Instant.now(), expiresAt, "playbook"));
        log.info("[NOOP] blockIP {} ttl={}s expires={}", ip, ttl.getSeconds(), expiresAt);
        return Result.success("BLOCK", ip, "noop: block logged", expiresAt);
    }

    @Override
    public Result rateLimit(String ip, int maxConnections) {
        Result guard = FirewallSafetyGuard.validate(ip, "RATE_LIMIT");
        if (guard != null) return guard;

        Instant expiresAt = Instant.now().plusSeconds(3600);
        activeRules.put(ip, new Rule(ip, "RATE_LIMIT", Instant.now(), expiresAt, "playbook"));
        log.info("[NOOP] rateLimit {} maxConn={}", ip, maxConnections);
        return Result.success("RATE_LIMIT", ip, "noop: rate limit logged", expiresAt);
    }

    @Override
    public Result unblock(String ip) {
        activeRules.remove(ip);
        log.info("[NOOP] unblock {}", ip);
        return Result.success("UNBLOCK", ip, "noop: unblock logged", null);
    }

    @Override
    public List<Rule> listRules() {
        return new ArrayList<>(activeRules.values());
    }

    @Override
    public String platformName() {
        return "noop";
    }
}
