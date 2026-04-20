package com.providence.citadel.api;

import com.providence.citadel.service.RedisEventPublisher;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/threats")
public class ThreatController {

    private final RedisEventPublisher redisPublisher;

    public ThreatController(RedisEventPublisher redisPublisher) {
        this.redisPublisher = redisPublisher;
    }

    @GetMapping("/active")
    public Map<String, String> getActiveThreats() {
        return redisPublisher.getActiveThreats();
    }
}
