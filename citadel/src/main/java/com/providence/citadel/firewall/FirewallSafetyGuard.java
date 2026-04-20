package com.providence.citadel.firewall;

import java.net.InetAddress;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Safety guards for firewall operations.
 * ABSOLUTE CONSTRAINTS — enforced in code, not configurable.
 */
public final class FirewallSafetyGuard {

    private static final Pattern IPV4_PATTERN = Pattern.compile(
        "^((25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(25[0-5]|2[0-4]\\d|[01]?\\d\\d?)$");

    private static final Set<String> PROTECTED_IPS = Set.of(
        "127.0.0.1", "::1", "0.0.0.0",
        "10.0.0.1", "192.168.0.1", "192.168.1.1", "172.16.0.1"
    );

    private FirewallSafetyGuard() {}

    public static boolean isValidIp(String ip) {
        if (ip == null || ip.isBlank()) return false;
        return IPV4_PATTERN.matcher(ip).matches();
    }

    public static boolean isProtectedIp(String ip) {
        if (PROTECTED_IPS.contains(ip)) return true;
        if (ip.startsWith("127.")) return true;
        // Check if it's the machine's own IP
        try {
            InetAddress addr = InetAddress.getByName(ip);
            if (addr.isLoopbackAddress()) return true;
            if (addr.isAnyLocalAddress()) return true;
        } catch (Exception ignored) {}
        return false;
    }

    public static Result validate(String ip, String action) {
        if (!isValidIp(ip)) {
            return Result.failure(action, ip, "invalid IP format");
        }
        if (isProtectedIp(ip)) {
            return Result.failure(action, ip, "refused: protected IP (loopback/gateway)");
        }
        return null; // null means validation passed
    }
}
