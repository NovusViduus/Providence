package com.providence.citadel.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.providence.citadel.model.SecurityEvent;
import com.providence.citadel.repository.EventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/v1/events")
public class GeoController {

    private static final Logger log = LoggerFactory.getLogger(GeoController.class);
    private static final String GEO_CACHE_PREFIX = "geo:ip:";

    private final EventRepository eventRepository;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public GeoController(EventRepository eventRepository, StringRedisTemplate redisTemplate) {
        this.eventRepository = eventRepository;
        this.redisTemplate = redisTemplate;
    }

    @GetMapping("/geo")
    public List<Map<String, Object>> getGeoEvents(@RequestParam(defaultValue = "24") int hours) {
        Instant since = Instant.now().minusSeconds(hours * 3600L);
        var events = eventRepository.findByTimestampBetween(since, Instant.now(),
            org.springframework.data.domain.PageRequest.of(0, 1000));

        // Group by source IP
        Map<String, List<SecurityEvent>> byIp = new HashMap<>();
        for (var e : events.getContent()) {
            byIp.computeIfAbsent(e.getSourceIp(), k -> new ArrayList<>()).add(e);
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (var entry : byIp.entrySet()) {
            String ip = entry.getKey();
            var ipEvents = entry.getValue();
            var srcGeo = lookupGeo(ip);
            if (srcGeo == null) continue;

            var latest = ipEvents.stream().max(Comparator.comparing(SecurityEvent::getTimestamp)).orElse(ipEvents.get(0));

            // Geo-locate destination IP too
            var dstGeo = lookupGeo(latest.getDestIp());
            Map<String, Object> entry2 = new HashMap<>(Map.of(
                "sourceIp", ip,
                "latitude", srcGeo.getOrDefault("lat", 0.0),
                "longitude", srcGeo.getOrDefault("lon", 0.0),
                "country", srcGeo.getOrDefault("countryCode", ""),
                "city", srcGeo.getOrDefault("city", ""),
                "category", latest.getCategory(),
                "eventCount", ipEvents.size(),
                "lastSeen", latest.getTimestamp().toString()
            ));
            entry2.put("destIp", latest.getDestIp());
            if (dstGeo != null) {
                entry2.put("destLatitude", dstGeo.getOrDefault("lat", 0.0));
                entry2.put("destLongitude", dstGeo.getOrDefault("lon", 0.0));
                entry2.put("destCountry", dstGeo.getOrDefault("countryCode", ""));
                entry2.put("destCity", dstGeo.getOrDefault("city", ""));
            }
            result.add(entry2);
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> lookupGeo(String ip) {
        // Check Redis cache first
        String cached = redisTemplate.opsForValue().get(GEO_CACHE_PREFIX + ip);
        if (cached != null) {
            try { return objectMapper.readValue(cached, Map.class); } catch (Exception ignored) {}
        }

        // Skip private/loopback IPs
        if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.") || ip.startsWith("127.")) {
            return null;
        }

        // Lookup via ip-api.com (free, no key needed, 45 req/min limit)
        try {
            var request = HttpRequest.newBuilder()
                .uri(URI.create("http://ip-api.com/json/" + ip + "?fields=status,lat,lon,countryCode,city"))
                .timeout(Duration.ofSeconds(3))
                .GET().build();
            var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            var data = objectMapper.readValue(response.body(), Map.class);

            if ("success".equals(data.get("status"))) {
                // Cache for 7 days
                String json = objectMapper.writeValueAsString(data);
                redisTemplate.opsForValue().set(GEO_CACHE_PREFIX + ip, json, Duration.ofDays(7));
                return data;
            }
        } catch (Exception e) {
            log.debug("Geo lookup failed for {}: {}", ip, e.getMessage());
        }
        return null;
    }
}
