package com.providence.citadel.firewall;

import java.time.Duration;
import java.util.List;

public interface FirewallManager {
    Result blockIP(String ip, Duration ttl);
    Result rateLimit(String ip, int maxConnections);
    Result unblock(String ip);
    List<Rule> listRules();
    String platformName();
}
