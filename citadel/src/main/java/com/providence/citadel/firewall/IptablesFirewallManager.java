package com.providence.citadel.firewall;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
@ConditionalOnProperty(name = "providence.firewall.platform", havingValue = "iptables")
public class IptablesFirewallManager implements FirewallManager {

    private static final Logger log = LoggerFactory.getLogger(IptablesFirewallManager.class);
    private static final String CHAIN = "PROVIDENCE";

    @Override
    public Result blockIP(String ip, Duration ttl) {
        Result guard = FirewallSafetyGuard.validate(ip, "BLOCK");
        if (guard != null) return guard;

        ensureChain();
        Instant expiresAt = Instant.now().plus(ttl);
        String comment = String.format("providence:block:%d:%d", Instant.now().getEpochSecond(), expiresAt.getEpochSecond());
        String cmd = String.format("sudo iptables -A %s -s %s -j DROP -m comment --comment \"%s\"", CHAIN, ip, comment);

        if (executeCommand(cmd)) {
            log.info("[IPTABLES] Blocked {} ttl={}s", ip, ttl.getSeconds());
            return Result.success("BLOCK", ip, "iptables: DROP rule added to " + CHAIN, expiresAt);
        }
        return Result.failure("BLOCK", ip, "iptables: command failed");
    }

    @Override
    public Result rateLimit(String ip, int maxConnections) {
        Result guard = FirewallSafetyGuard.validate(ip, "RATE_LIMIT");
        if (guard != null) return guard;

        ensureChain();
        Instant expiresAt = Instant.now().plusSeconds(3600);
        String comment = String.format("providence:ratelimit:%d:%d", Instant.now().getEpochSecond(), expiresAt.getEpochSecond());
        String cmd = String.format(
            "sudo iptables -A %s -s %s -p tcp --syn -m connlimit --connlimit-above %d -j DROP -m comment --comment \"%s\"",
            CHAIN, ip, maxConnections, comment);

        if (executeCommand(cmd)) {
            log.info("[IPTABLES] Rate limited {} maxConn={}", ip, maxConnections);
            return Result.success("RATE_LIMIT", ip, "iptables: connlimit rule added", expiresAt);
        }
        return Result.failure("RATE_LIMIT", ip, "iptables: command failed");
    }

    @Override
    public Result unblock(String ip) {
        // Delete all rules matching this IP from the PROVIDENCE chain
        String cmd = String.format("sudo iptables -D %s -s %s -j DROP 2>/dev/null; " +
            "sudo iptables -D %s -s %s -p tcp --syn -m connlimit --connlimit-above 0 -j DROP 2>/dev/null",
            CHAIN, ip, CHAIN, ip);
        executeCommand("bash -c '" + cmd + "'");
        log.info("[IPTABLES] Unblocked {}", ip);
        return Result.success("UNBLOCK", ip, "iptables: rules removed from " + CHAIN, null);
    }

    @Override
    public List<Rule> listRules() {
        List<Rule> rules = new ArrayList<>();
        String output = executeCommandOutput(String.format("sudo iptables -L %s -n --line-numbers 2>/dev/null", CHAIN));
        if (output == null) return rules;

        Pattern commentPattern = Pattern.compile("providence:(\\w+):(\\d+):(\\d+)");
        for (String line : output.split("\n")) {
            if (!line.contains("DROP")) continue;
            // Extract source IP
            String[] parts = line.trim().split("\\s+");
            String ip = null;
            for (String p : parts) {
                if (FirewallSafetyGuard.isValidIp(p)) { ip = p; break; }
            }
            if (ip == null) continue;

            String action = "BLOCK";
            Instant created = Instant.now();
            Instant expires = null;

            Matcher m = commentPattern.matcher(line);
            if (m.find()) {
                action = m.group(1).toUpperCase();
                created = Instant.ofEpochSecond(Long.parseLong(m.group(2)));
                expires = Instant.ofEpochSecond(Long.parseLong(m.group(3)));
            }
            rules.add(new Rule(ip, action, created, expires, "iptables:" + CHAIN));
        }
        return rules;
    }

    @Override
    public String platformName() {
        return "iptables";
    }

    private void ensureChain() {
        executeCommand(String.format("sudo iptables -N %s 2>/dev/null", CHAIN));
        executeCommand(String.format("sudo iptables -C INPUT -j %s 2>/dev/null || sudo iptables -I INPUT -j %s", CHAIN, CHAIN));
    }

    private boolean executeCommand(String cmd) {
        log.info("[IPTABLES] Executing: {}", cmd);
        try {
            Process p = new ProcessBuilder("bash", "-c", cmd)
                .redirectErrorStream(true)
                .start();
            boolean finished = p.waitFor(5, TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
                log.error("[IPTABLES] Command timed out");
                return false;
            }
            return p.exitValue() == 0;
        } catch (Exception e) {
            log.error("[IPTABLES] Command exception: {}", e.getMessage());
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
            return null;
        }
    }
}
