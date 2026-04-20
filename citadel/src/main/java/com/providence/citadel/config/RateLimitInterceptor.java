package com.providence.citadel.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Simple in-memory rate limiter: max 100 requests/minute per IP.
 * Returns 429 Too Many Requests when exceeded.
 */
@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private static final int MAX_REQUESTS_PER_MINUTE = 100;
    private final ConcurrentHashMap<String, AtomicInteger> counters = new ConcurrentHashMap<>();
    private volatile long windowStart = System.currentTimeMillis();

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        // Reset counters every minute
        long now = System.currentTimeMillis();
        if (now - windowStart > 60_000) {
            counters.clear();
            windowStart = now;
        }

        String ip = request.getRemoteAddr();
        AtomicInteger count = counters.computeIfAbsent(ip, k -> new AtomicInteger(0));

        if (count.incrementAndGet() > MAX_REQUESTS_PER_MINUTE) {
            response.setStatus(429);
            response.getWriter().write("{\"error\":\"Too many requests\"}");
            return false;
        }
        return true;
    }
}
