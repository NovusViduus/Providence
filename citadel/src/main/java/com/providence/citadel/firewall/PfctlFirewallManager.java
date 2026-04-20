package com.providence.citadel.firewall;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Component
@ConditionalOnProperty(name = "providence.firewall.platform", havingValue = "pfctl")
public class PfctlFirewallManager implements FirewallManager {

    private static final Logger log = LoggerFactory.getLogger(PfctlFirewallManager.class);
    private static final String BLOCKLIST_TABLE = "providence_blocklist";
    private static final String RATELIMIT_TABLE = "providence_ratelimit";

    @Override
    public Result blockIP(String ip, Duration ttl) {
        Result guard = FirewallSafetyGuard.validate(ip, "BLOCK");
        if (guard != null) return guard;

        String cmd = String.format("sudo pfctl -t %s -T add %s", BLOCKLIST_TABLE, ip);
        boolean ok = executeCommand(cmd);
        Instant expiresAt = Instant.now().plus(ttl);

        if (ok) {
            log.info("[PFCTL] Blocked {} ttl={}s", ip, ttl.getSeconds());
            return Result.success("BLOCK", ip, "pfctl: added to " + BLOCKLIST_TABLE, expiresAt);
        }
        return Result.failure("BLOCK", ip, "pfctl: command failed");
    }

    @Override
    public Result rateLimit(String ip, int maxConnections) {
        Result guard = FirewallSafetyGuard.validate(ip, "RATE_LIMIT");
        if (guard != null) return guard;

        String cmd = String.format("sudo pfctl -t %s -T add %s", RATELIMIT_TABLE, ip);
        boolean ok = executeCommand(cmd);
        Instant expiresAt = Instant.now().plusSeconds(3600);

        if (ok) {
            log.info("[PFCTL] Rate limited {} maxConn={}", ip, maxConnections);
            return Result.success("RATE_LIMIT", ip, "pfctl: added to " + RATELIMIT_TABLE, expiresAt);
        }
        return Result.failure("RATE_LIMIT", ip, "pfctl: command failed");
    }

    @Override
    public Result unblock(String ip) {
        executeCommand(String.format("sudo pfctl -t %s -T delete %s", BLOCKLIST_TABLE, ip));
        executeCommand(String.format("sudo pfctl -t %s -T delete %s", RATELIMIT_TABLE, ip));
        log.info("[PFCTL] Unblocked {}", ip);
        return Result.success("UNBLOCK", ip, "pfctl: removed from tables", null);
    }

    @Override
    public List<Rule> listRules() {
        List<Rule> rules = new ArrayList<>();
        String output = executeCommandOutput(String.format("sudo pfctl -t %s -T show", BLOCKLIST_TABLE));
        if (output != null) {
            for (String line : output.split("\n")) {
                String ip = line.trim();
                if (!ip.isEmpty() && FirewallSafetyGuard.isValidIp(ip)) {
                    rules.add(new Rule(ip, "BLOCK", Instant.now(), null, "pfctl:" + BLOCKLIST_TABLE));
                }
            }
        }
        return rules;
    }

    @Override
    public String platformName() {
        return "pfctl";
    }

    private boolean executeCommand(String cmd) {
        log.info("[PFCTL] Executing: {}", cmd);
        try {
            Process p = new ProcessBuilder("bash", "-c", cmd)
                .redirectErrorStream(true)
                .start();
            boolean finished = p.waitFor(5, TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
                log.error("[PFCTL] Command timed out: {}", cmd);
                return false;
            }
            int exit = p.exitValue();
            if (exit != 0) {
                String err = new String(p.getInputStream().readAllBytes());
                log.error("[PFCTL] Command failed (exit={}): {} — {}", exit, cmd, err);
                return false;
            }
            return true;
        } catch (Exception e) {
            log.error("[PFCTL] Command exception: {} — {}", cmd, e.getMessage());
            return false;
        }
    }

    private String executeCommandOutput(String cmd) {
        try {
            Process p = new ProcessBuilder("bash", "-c", cmd)
                .redirectErrorStream(true)
                .start();
            p.waitFor(5, TimeUnit.SECONDS);
            return new String(p.getInputStream().readAllBytes());
        } catch (Exception e) {
            log.error("[PFCTL] Command exception: {}", e.getMessage());
            return null;
        }
    }
}
