package com.providence.citadel.firewall;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * AWS Cloud firewall manager using Network ACLs.
 * Security Groups are allow-only, so NACLs are used for DENY rules.
 *
 * Limitation: NACLs don't support rate limiting. Rate limit requests
 * are approximated as short-TTL blocks.
 */
@Component
@ConditionalOnProperty(name = "providence.firewall.platform", havingValue = "cloud")
public class CloudFirewallManager implements FirewallManager {

    private static final Logger log = LoggerFactory.getLogger(CloudFirewallManager.class);

    @Value("${providence.cloud.nacl-id:}")
    private String naclId;

    @Value("${providence.cloud.region:us-east-1}")
    private String region;

    private final StringRedisTemplate redisTemplate;

    public CloudFirewallManager(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @Override
    public Result blockIP(String ip, Duration ttl) {
        Result guard = FirewallSafetyGuard.validate(ip, "BLOCK");
        if (guard != null) return guard;
        // Don't block VPC internal IPs
        if (ip.startsWith("10.") || ip.startsWith("172.16.") || ip.startsWith("192.168.")) {
            return Result.failure("BLOCK", ip, "refused: VPC internal IP");
        }

        int ruleNumber = getNextRuleNumber();
        Instant expiresAt = Instant.now().plus(ttl);

        try {
            var ec2 = software.amazon.awssdk.services.ec2.Ec2Client.builder()
                .region(software.amazon.awssdk.regions.Region.of(region)).build();

            ec2.createNetworkAclEntry(r -> r
                .networkAclId(naclId)
                .ruleNumber(ruleNumber)
                .protocol("-1")
                .ruleAction(software.amazon.awssdk.services.ec2.model.RuleAction.DENY)
                .cidrBlock(ip + "/32")
                .egress(false));

            // Track rule number in Redis
            redisTemplate.opsForValue().set("nacl:rule:" + ip, String.valueOf(ruleNumber), ttl);

            log.info("[CLOUD] Blocked {} via NACL rule #{}", ip, ruleNumber);
            return Result.success("BLOCK", ip, "NACL DENY rule #" + ruleNumber, expiresAt);
        } catch (Exception e) {
            log.error("[CLOUD] Failed to block {}: {}", ip, e.getMessage());
            return Result.failure("BLOCK", ip, "AWS error: " + e.getMessage());
        }
    }

    @Override
    public Result rateLimit(String ip, int maxConnections) {
        // NACLs don't support rate limiting. Approximate with short-TTL block.
        log.warn("[CLOUD] Rate limiting not supported on NACLs — using short-TTL block for {}", ip);
        return blockIP(ip, Duration.ofMinutes(10));
    }

    @Override
    public Result unblock(String ip) {
        String ruleStr = redisTemplate.opsForValue().get("nacl:rule:" + ip);
        if (ruleStr == null) {
            log.warn("[CLOUD] No NACL rule found for {} in Redis", ip);
            return Result.success("UNBLOCK", ip, "no rule found (may have expired)", null);
        }

        int ruleNumber = Integer.parseInt(ruleStr);
        try {
            var ec2 = software.amazon.awssdk.services.ec2.Ec2Client.builder()
                .region(software.amazon.awssdk.regions.Region.of(region)).build();

            ec2.deleteNetworkAclEntry(r -> r
                .networkAclId(naclId)
                .ruleNumber(ruleNumber)
                .egress(false));

            redisTemplate.delete("nacl:rule:" + ip);
            log.info("[CLOUD] Unblocked {} — removed NACL rule #{}", ip, ruleNumber);
            return Result.success("UNBLOCK", ip, "NACL rule #" + ruleNumber + " removed", null);
        } catch (Exception e) {
            log.error("[CLOUD] Failed to unblock {}: {}", ip, e.getMessage());
            return Result.failure("UNBLOCK", ip, "AWS error: " + e.getMessage());
        }
    }

    @Override
    public List<Rule> listRules() {
        List<Rule> rules = new ArrayList<>();
        var keys = redisTemplate.keys("nacl:rule:*");
        if (keys != null) {
            for (String key : keys) {
                String ip = key.replace("nacl:rule:", "");
                rules.add(new Rule(ip, "BLOCK", Instant.now(), null, "cloud:nacl"));
            }
        }
        return rules;
    }

    @Override
    public String platformName() {
        return "cloud";
    }

    private int getNextRuleNumber() {
        // Start at 100, increment. Track in Redis.
        String counter = redisTemplate.opsForValue().get("nacl:rule_counter");
        int next = counter != null ? Integer.parseInt(counter) + 1 : 100;
        redisTemplate.opsForValue().set("nacl:rule_counter", String.valueOf(next));
        return next;
    }
}
