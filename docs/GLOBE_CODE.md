# Providence Globe — Source Code Reference

All source files that power the 3D threat visualization globe in The Lens dashboard.

---

## Frontend (React / TypeScript / Three.js)

### `lens/src/components/ThreatMap.tsx`
Main globe component — Three.js scene, InstancedMesh markers, arc lines, raycaster tooltips, auto-rotation.

```tsx
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useApi } from '../hooks/useApi';
import { getGeoEvents } from '../services/api';
import { latLngToVector3, buildBoundaryGeometry, topoToGeo, buildArcGeometry } from '../utils/globe';
import { getCategoryColor, getCategoryHex } from '../utils/geoip';
import type { GeoThreat } from '../types/events';

const GLOBE_RADIUS = 1;
const MAX_MARKERS = 500;

export default function ThreatMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: geoData } = useApi(() => getGeoEvents(24), []);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; threat: GeoThreat } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const canvas = document.createElement('canvas');
    if (!canvas.getContext('webgl')) {
      el.innerHTML = '<p class="text-gray-500 p-8">WebGL unavailable</p>';
      return;
    }

    const w = el.clientWidth;
    const h = el.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.z = 2.8;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    // Globe body
    const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x0a1a14, transparent: true, opacity: 0.95 });
    group.add(new THREE.Mesh(sphereGeo, sphereMat));

    // Atmosphere glow
    const atmosGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.02, 64, 64);
    const atmosMat = new THREE.MeshBasicMaterial({
      color: 0x00ffc8, transparent: true, opacity: 0.05, side: THREE.BackSide
    });
    group.add(new THREE.Mesh(atmosGeo, atmosMat));

    // Load country boundaries (TopoJSON)
    fetch('/world-110m.json')
      .then((r) => r.json())
      .then((data) => {
        const geojson = data.type === 'Topology' ? topoToGeo(data) : data;
        const boundaryGeo = buildBoundaryGeometry(geojson, GLOBE_RADIUS * 1.001);
        const boundaryMat = new THREE.LineBasicMaterial({
          color: 0x00ffc8, transparent: true, opacity: 0.25
        });
        group.add(new THREE.LineSegments(boundaryGeo, boundaryMat));
      })
      .catch(() => {});

    // Threat markers (InstancedMesh for performance)
    let markerMesh: THREE.InstancedMesh | null = null;
    const markerGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const markerMat = new THREE.MeshBasicMaterial();

    function updateMarkers(threats: GeoThreat[]) {
      if (markerMesh) group.remove(markerMesh);
      const count = Math.min(threats.length, MAX_MARKERS);
      if (count === 0) return;

      markerMesh = new THREE.InstancedMesh(markerGeo, markerMat, count);
      const dummy = new THREE.Object3D();
      const color = new THREE.Color();

      for (let i = 0; i < count; i++) {
        const t = threats[i];
        const pos = latLngToVector3(t.latitude, t.longitude, GLOBE_RADIUS * 1.005);
        const scale = Math.max(0.5, Math.min(2, t.eventCount / 10));
        dummy.position.copy(pos);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        markerMesh.setMatrixAt(i, dummy.matrix);
        color.setHex(getCategoryColor(t.category));
        markerMesh.setColorAt(i, color);
      }
      markerMesh.instanceMatrix.needsUpdate = true;
      if (markerMesh.instanceColor) markerMesh.instanceColor.needsUpdate = true;
      group.add(markerMesh);
    }

    if (geoData && geoData.length > 0) {
      updateMarkers(geoData);
      // Arc lines from high-activity threats to home location
      const HOME_LAT = 47.6, HOME_LNG = -122.3;
      const actThreats = geoData.filter(t => t.eventCount > 5).slice(0, 20);
      const arcMat = new THREE.LineBasicMaterial({
        color: 0x00ffc8, transparent: true, opacity: 0.15
      });
      for (const t of actThreats) {
        const arcGeo = buildArcGeometry(
          t.latitude, t.longitude, HOME_LAT, HOME_LNG, GLOBE_RADIUS
        );
        group.add(new THREE.Line(arcGeo, arcMat));
      }
    }

    // Interaction: drag to rotate, scroll to zoom, hover for tooltips
    let autoRotate = true;
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true; autoRotate = false;
      prevMouse = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        group.rotation.y += (e.clientX - prevMouse.x) * 0.005;
        group.rotation.x += (e.clientY - prevMouse.y) * 0.005;
        prevMouse = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!markerMesh || !geoData || geoData.length === 0) { setTooltip(null); return; }
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(markerMesh);
      if (hits.length > 0 && hits[0].instanceId !== undefined && hits[0].instanceId < geoData.length) {
        setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, threat: geoData[hits[0].instanceId] });
      } else {
        setTooltip(null);
        if (!isDragging) autoRotate = true;
      }
    };
    const onMouseUp = () => { isDragging = false; autoRotate = true; };
    const onWheel = (e: WheelEvent) => {
      camera.position.z = Math.max(1.5, Math.min(4.0, camera.position.z + e.deltaY * 0.002));
    };

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('wheel', onWheel);

    let animId: number;
    function animate() {
      animId = requestAnimationFrame(animate);
      if (autoRotate) group.rotation.y += 0.001;
      renderer.render(scene, camera);
    }
    animate();

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [geoData]);

  return (
    <div className="flex gap-4 h-[600px]">
      <div className="relative flex-[2] bg-providence-surface border border-providence-border rounded-lg overflow-hidden">
        <div ref={containerRef} className="w-full h-full" />
        {tooltip && (
          <div className="absolute pointer-events-none bg-providence-bg/90 border border-providence-border rounded px-3 py-2 text-xs z-10"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
            <p className="font-mono text-gray-200">{tooltip.threat.sourceIp}</p>
            <p className="text-gray-400">{tooltip.threat.city}, {tooltip.threat.country}</p>
            <p style={{ color: getCategoryHex(tooltip.threat.category) }}>
              {tooltip.threat.category} — {tooltip.threat.eventCount} events
            </p>
          </div>
        )}
      </div>
      <div className="flex-1 bg-providence-surface border border-providence-border rounded-lg p-4 overflow-auto">
        <h3 className="text-sm text-gray-400 mb-3">Top Source Countries</h3>
        {geoData && geoData.length > 0 ? (
          <>
            <p className="text-xs text-gray-500 mb-3">{geoData.length} unique source IPs</p>
            {Object.entries(
              geoData.reduce<Record<string, number>>((acc, t) => {
                acc[t.country] = (acc[t.country] || 0) + t.eventCount; return acc;
              }, {})
            ).sort(([, a], [, b]) => b - a).slice(0, 10).map(([country, count]) => (
              <div key={country} className="flex justify-between py-1 text-sm">
                <span className="text-gray-300">{country}</span>
                <span className="text-gray-500">{count}</span>
              </div>
            ))}
          </>
        ) : <p className="text-gray-500 text-sm">No geo data available</p>}
      </div>
    </div>
  );
}
```

---

### `lens/src/utils/globe.ts`
Geometry helpers — lat/lng to 3D coordinates, TopoJSON parsing, country boundary lines, arc curves.

```typescript
import * as THREE from 'three';

export function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

export function buildBoundaryGeometry(
  geojson: { features: Array<{ geometry: { type: string; coordinates: number[][][] | number[][][][] } }> },
  radius: number
): THREE.BufferGeometry {
  const vertices: number[] = [];
  for (const feature of geojson.features) {
    const geo = feature.geometry;
    const rings: number[][][] =
      geo.type === 'Polygon'
        ? [geo.coordinates[0] as number[][]]
        : geo.type === 'MultiPolygon'
        ? (geo.coordinates as number[][][][]).map((p) => p[0])
        : [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [lng1, lat1] = ring[i];
        const [lng2, lat2] = ring[i + 1];
        const p1 = latLngToVector3(lat1, lng1, radius);
        const p2 = latLngToVector3(lat2, lng2, radius);
        vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return g;
}

export function buildArcGeometry(
  lat1: number, lng1: number, lat2: number, lng2: number,
  radius: number, segments = 50, arcHeight = 0.3
): THREE.BufferGeometry {
  const start = latLngToVector3(lat1, lng1, radius);
  const end = latLngToVector3(lat2, lng2, radius);
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  mid.normalize().multiplyScalar(radius + arcHeight);
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
  return new THREE.BufferGeometry().setFromPoints(curve.getPoints(segments));
}

export function topoToGeo(topo: {
  type: string;
  arcs: number[][][];
  objects: { countries: { geometries: Array<{
    type: string; arcs: number[][] | number[][][];
  }> } };
}): { features: Array<{ geometry: { type: string; coordinates: number[][][] | number[][][][] } }> } {
  const { arcs } = topo;
  const decodedArcs = arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x, y]; });
  });

  const transform = (topo as Record<string, unknown>).transform as
    { scale: [number, number]; translate: [number, number] } | undefined;

  function transformPoint(p: number[]): number[] {
    if (!transform) return p;
    return [
      p[0] * transform.scale[0] + transform.translate[0],
      p[1] * transform.scale[1] + transform.translate[1]
    ];
  }

  function decodeArc(index: number): number[][] {
    const reversed = index < 0;
    const arc = decodedArcs[reversed ? ~index : index].map(transformPoint);
    return reversed ? arc.slice().reverse() : arc;
  }

  function decodeRing(indices: number[]): number[][] {
    const coords: number[][] = [];
    for (const idx of indices) {
      const arc = decodeArc(idx);
      coords.push(...(coords.length > 0 ? arc.slice(1) : arc));
    }
    return coords;
  }

  const features = topo.objects.countries.geometries.map((geom) => {
    if (geom.type === 'Polygon') {
      return { geometry: { type: 'Polygon', coordinates: (geom.arcs as number[][]).map(decodeRing) } };
    }
    if (geom.type === 'MultiPolygon') {
      return { geometry: { type: 'MultiPolygon', coordinates: (geom.arcs as number[][][]).map((p) => p.map(decodeRing)) } };
    }
    return { geometry: { type: geom.type, coordinates: [] } };
  });

  return { features };
}
```

---

### `lens/src/utils/geoip.ts`
Category-to-color mapping for threat markers on the globe.

```typescript
import type { GeoThreat } from '../types/events';

export const CATEGORY_COLORS: Record<string, number> = {
  DOS: 0xff1744,
  BRUTE_FORCE: 0xff6d00,
  PROBE: 0xffd600,
  INJECTION: 0x2979ff,
  EXFILTRATION: 0xb388ff,
  AI_AGENT: 0x00e5ff,
  BENIGN: 0x4caf50,
  IAM_ESCALATION: 0xffab00,
  RESOURCE_ABUSE: 0xff1744,
  DATA_EXPOSURE: 0xaa00ff,
  WEB_PHISHING: 0xff6d00,
  WEB_CRYPTOMINER: 0xff1744,
  WEB_INJECTION: 0x2979ff,
  WEB_TRACKING: 0x888888,
};

export function getCategoryColor(category: string): number {
  return CATEGORY_COLORS[category] ?? 0x888888;
}

export function getCategoryHex(category: string): string {
  return '#' + (CATEGORY_COLORS[category] ?? 0x888888).toString(16).padStart(6, '0');
}
```

---

### `lens/src/types/events.ts` (GeoThreat interface)

```typescript
export interface GeoThreat {
  sourceIp: string;
  latitude: number;
  longitude: number;
  country: string;
  city: string;
  category: string;
  eventCount: number;
  lastSeen: string;
}
```

---

## Backend (Java / Spring Boot)

### `citadel/src/main/java/com/providence/citadel/api/GeoController.java`
REST endpoint that queries events, groups by source IP, geo-locates via ip-api.com, caches in Redis.

```java
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
    private final HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5)).build();

    public GeoController(EventRepository eventRepository, StringRedisTemplate redisTemplate) {
        this.eventRepository = eventRepository;
        this.redisTemplate = redisTemplate;
    }

    @GetMapping("/geo")
    public List<Map<String, Object>> getGeoEvents(
            @RequestParam(defaultValue = "24") int hours) {
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
            var geo = lookupGeo(ip);
            if (geo == null) continue;

            var latest = ipEvents.stream()
                .max(Comparator.comparing(SecurityEvent::getTimestamp))
                .orElse(ipEvents.get(0));
            result.add(Map.of(
                "sourceIp", ip,
                "latitude", geo.getOrDefault("lat", 0.0),
                "longitude", geo.getOrDefault("lon", 0.0),
                "country", geo.getOrDefault("countryCode", ""),
                "city", geo.getOrDefault("city", ""),
                "category", latest.getCategory(),
                "eventCount", ipEvents.size(),
                "lastSeen", latest.getTimestamp().toString()
            ));
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> lookupGeo(String ip) {
        // Check Redis cache
        String cached = redisTemplate.opsForValue().get(GEO_CACHE_PREFIX + ip);
        if (cached != null) {
            try { return objectMapper.readValue(cached, Map.class); }
            catch (Exception ignored) {}
        }

        // Skip private IPs
        if (ip.startsWith("10.") || ip.startsWith("192.168.") ||
            ip.startsWith("172.") || ip.startsWith("127.")) {
            return null;
        }

        // Lookup via ip-api.com (free, 45 req/min)
        try {
            var request = HttpRequest.newBuilder()
                .uri(URI.create("http://ip-api.com/json/" + ip +
                    "?fields=status,lat,lon,countryCode,city"))
                .timeout(Duration.ofSeconds(3))
                .GET().build();
            var response = httpClient.send(request,
                HttpResponse.BodyHandlers.ofString());
            var data = objectMapper.readValue(response.body(), Map.class);

            if ("success".equals(data.get("status"))) {
                String json = objectMapper.writeValueAsString(data);
                redisTemplate.opsForValue().set(
                    GEO_CACHE_PREFIX + ip, json, Duration.ofDays(7));
                return data;
            }
        } catch (Exception e) {
            log.debug("Geo lookup failed for {}: {}", ip, e.getMessage());
        }
        return null;
    }
}
```
