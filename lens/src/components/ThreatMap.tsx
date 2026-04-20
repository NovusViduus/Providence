import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useApi } from '../hooks/useApi';
import { getGeoEvents } from '../services/api';
import IpLink from './IpLink';
import {
  latLngToVector3,
  buildBoundaryGeometry,
  topoToGeo,
  buildAnimatedArcGeometry,
  buildGraticuleGeometry,
  buildCitySpikeGeometry,
  createHomeBaseRing,
  buildServerTower,
  HONEYPOT_LOCATIONS,
} from '../utils/globe';
import { getCategoryColor, getCategoryHex } from '../utils/geoip';
import type { GeoThreat } from '../types/events';
import type { HoneypotInfo } from '../utils/globe';

const GLOBE_RADIUS = 1;
const MAX_MARKERS = 500;

/* ═══════════════════════════════════════════════════════════════════
   GLSL Shaders
   ═══════════════════════════════════════════════════════════════════ */

const ATMOS_VERT = `
  varying vec3 vNormal;
  varying vec3 vPositionW;
  void main() {
    vNormal    = normalize(normalMatrix * normal);
    vPositionW = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ATMOS_FRAG = `
  varying vec3 vNormal;
  varying vec3 vPositionW;
  void main() {
    vec3  viewDir   = normalize(-vPositionW);
    float rim       = 1.0 - max(0.0, dot(viewDir, vNormal));
    float intensity = pow(rim, 4.0) * 0.9;
    gl_FragColor = vec4(0.15, 0.55, 0.8, intensity * 0.4);
  }
`;

const ARC_VERT = `
  attribute float aT;
  uniform   float uProgress;
  varying   float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ARC_FRAG = `
  uniform float uProgress;
  uniform vec3  uColor;
  varying float vT;
  void main() {
    if (vT > uProgress) discard;
    float headGlow = exp(-(uProgress - vT) * 18.0);
    vec3 col = mix(uColor, vec3(1.0), headGlow * 0.8);
    float alpha = mix(0.15, 1.0, headGlow);
    gl_FragColor = vec4(col, alpha);
  }
`;

/* ═══════════════════════════════════════════════════════════════════
   Honeypot Detail Panel (shown when a server tower is clicked)
   ═══════════════════════════════════════════════════════════════════ */

function HoneypotPanel({
  honeypot,
  threats,
  onClose,
}: {
  honeypot: HoneypotInfo;
  threats: GeoThreat[];
  onClose: () => void;
}) {
  // Compute stats for this honeypot's destination
  const stats = useMemo(() => {
    const incoming = threats.filter((t) => {
      const dlat = Math.abs((t.destLatitude ?? 0) - honeypot.lat);
      const dlng = Math.abs((t.destLongitude ?? 0) - honeypot.lng);
      return dlat < 2 && dlng < 2;
    });

    const totalEvents = incoming.reduce((s, t) => s + t.eventCount, 0);
    const uniqueIPs = incoming.length;

    const byCat: Record<string, number> = {};
    const byCountry: Record<string, number> = {};
    for (const t of incoming) {
      byCat[t.category] = (byCat[t.category] || 0) + t.eventCount;
      byCountry[t.country] = (byCountry[t.country] || 0) + t.eventCount;
    }

    return {
      totalEvents,
      uniqueIPs,
      byCat: Object.entries(byCat).sort(([, a], [, b]) => b - a),
      byCountry: Object.entries(byCountry)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5),
    };
  }, [threats, honeypot]);

  return (
    <div className="absolute top-3 right-3 w-80 max-h-[420px] overflow-y-auto panel-scroll bg-providence-bg/95 border border-providence-border rounded-lg p-4 z-20 backdrop-blur-md shadow-2xl animate-in slide-in-from-right-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="font-mono text-sm text-green-400">
            {honeypot.label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Server info */}
      <div className="space-y-1.5 text-xs mb-4 border-b border-providence-border pb-3">
        <div className="flex justify-between">
          <span className="text-gray-500">Region</span>
          <span className="text-gray-300 font-mono">{honeypot.region}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Location</span>
          <span className="text-gray-300">{honeypot.location}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Hostname</span>
          <span className="text-gray-300 font-mono">{honeypot.hostname}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Public IP</span>
          <span className="text-gray-300 font-mono">{honeypot.ip}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Instance</span>
          <span className="text-gray-300 font-mono">
            {honeypot.instanceType}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Stack</span>
          <span className="text-gray-300">
            {honeypot.os} · {honeypot.stack}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Profile</span>
          <span className="text-gray-300">{honeypot.profile}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Trap ports</span>
          <span className="text-gray-300 font-mono">{honeypot.trapPorts}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Attracts</span>
          <span className="text-gray-300 text-right max-w-[180px]">{honeypot.attracts}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Disguise</span>
          <span className="text-gray-300 text-right max-w-[180px]">{honeypot.disguise}</span>
        </div>
      </div>

      {/* Bait files */}
      <div className="mb-3">
        <h4 className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Bait Files</h4>
        {honeypot.baitFiles.map(f => (
          <p key={f} className="text-[10px] font-mono text-gray-400 py-0.5">{f}</p>
        ))}
      </div>

      {/* Fake commands */}
      {honeypot.fakeCmds.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Fake Commands</h4>
          <div className="flex flex-wrap gap-1.5">
            {honeypot.fakeCmds.map(c => (
              <span key={c} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-providence-accent/10 text-providence-accent">{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* Fake hardware specs */}
      {'hardware' in honeypot && honeypot.hardware && (
        <div className="mb-3">
          <h4 className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Fake Hardware</h4>
          <div className="space-y-0.5 text-[10px]">
            <div className="flex justify-between"><span className="text-gray-500">CPU</span><span className="text-gray-300 font-mono text-right max-w-[180px]">{(honeypot as any).hardware.cpu}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">RAM</span><span className="text-gray-300 font-mono">{(honeypot as any).hardware.ram}</span></div>
            {(honeypot as any).hardware.gpus && <div className="flex justify-between"><span className="text-gray-500">GPUs</span><span className="text-providence-accent font-mono">{(honeypot as any).hardware.gpus}</span></div>}
            {(honeypot as any).hardware.cuda && <div className="flex justify-between"><span className="text-gray-500">CUDA</span><span className="text-gray-300 font-mono">{(honeypot as any).hardware.cuda}</span></div>}
          </div>
        </div>
      )}

      {/* Planted secrets */}
      {'fakeSecrets' in honeypot && (honeypot as any).fakeSecrets?.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Planted Secrets</h4>
          <div className="flex flex-wrap gap-1">
            {(honeypot as any).fakeSecrets.map((s: string) => (
              <span key={s} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Traffic stats */}
      <div className="mb-3">
        <h4 className="text-xs text-gray-500 mb-2 uppercase tracking-wider">
          Inbound Traffic (24h)
        </h4>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-providence-surface rounded px-2 py-1.5">
            <p className="text-lg font-mono text-gray-200">
              {stats.totalEvents.toLocaleString()}
            </p>
            <p className="text-[10px] text-gray-500">Events</p>
          </div>
          <div className="bg-providence-surface rounded px-2 py-1.5">
            <p className="text-lg font-mono text-gray-200">
              {stats.uniqueIPs.toLocaleString()}
            </p>
            <p className="text-[10px] text-gray-500">Unique IPs</p>
          </div>
        </div>
      </div>

      {/* Category breakdown */}
      {stats.byCat.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider">
            By Category
          </h4>
          {stats.byCat.map(([cat, count]) => (
            <div key={cat} className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-1.5">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: getCategoryHex(cat) }}
                />
                <span className="text-xs text-gray-400">{cat}</span>
              </div>
              <span className="text-xs text-gray-500 font-mono">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Top source countries */}
      {stats.byCountry.length > 0 && (
        <div>
          <h4 className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider">
            Top Sources
          </h4>
          {stats.byCountry.map(([cc, count]) => (
            <div
              key={cc}
              className="flex items-center justify-between py-0.5"
            >
              <span className="text-xs text-gray-400">{cc}</span>
              <span className="text-xs text-gray-500 font-mono">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Live UTC Clock for HUD overlay
   ═══════════════════════════════════════════════════════════════════ */

function UtcClock() {
  const [time, setTime] = useState(new Date().toISOString().slice(11, 19));
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toISOString().slice(11, 19)), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-[9px] text-gray-600 font-mono tracking-wider">{time} UTC</span>;
}

/* ═══════════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════════ */

export default function ThreatMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: geoData, error: geoError, loading: geoLoading } = useApi(() => getGeoEvents(24), []);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    threat: GeoThreat;
  } | null>(null);
  const [selectedHoneypot, setSelectedHoneypot] =
    useState<HoneypotInfo | null>(null);

  // Store Three.js objects in refs so the click handler can access them
  const sceneRef = useRef<{
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    group: THREE.Group;
    towerHitboxes: THREE.Mesh[];
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const testCanvas = document.createElement('canvas');
    if (!testCanvas.getContext('webgl')) {
      el.innerHTML =
        '<p class="text-gray-500 p-8">WebGL unavailable</p>';
      return;
    }

    const w = el.clientWidth;
    const h = el.clientHeight;

    /* ── Scene, camera, renderer ─────────────────────────────── */

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.z = 2.8;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    /* ── Starfield background ────────────────────────────────── */
    const starCount = 2000;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 8 + Math.random() * 12;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.85, sizeAttenuation: true, depthWrite: false });
    scene.add(new THREE.Points(starGeo, starMat));

    /* ── Lighting ────────────────────────────────────────────── */

    scene.add(new THREE.AmbientLight(0x334433, 0.6));
    const dirLight = new THREE.DirectionalLight(0xaaffcc, 0.8);
    dirLight.position.set(5, 3, 5);
    scene.add(dirLight);

    /* ── Globe body ──────────────────────────────────────────── */

    const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96);
    const sphereMat = new THREE.MeshPhongMaterial({
      color: 0x060d10,
      transparent: true,
      opacity: 0.95,
      shininess: 15,
    });
    group.add(new THREE.Mesh(sphereGeo, sphereMat));

    new THREE.TextureLoader().load(
      '/earth-dark.jpg',
      (tex) => {
        sphereMat.map = tex;
        sphereMat.needsUpdate = true;
      },
      undefined,
      () => {}
    );

    /* ── Fresnel atmosphere ──────────────────────────────────── */

    const atmosGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.06, 96, 96);
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: ATMOS_VERT,
      fragmentShader: ATMOS_FRAG,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(atmosGeo, atmosMat));

    /* ── Graticule grid ──────────────────────────────────────── */

    const gratGeo = buildGraticuleGeometry(GLOBE_RADIUS * 1.0015, 30);
    const gratMat = new THREE.LineBasicMaterial({
      color: 0x0A9396,
      transparent: true,
      opacity: 0.06,
    });
    group.add(new THREE.LineSegments(gratGeo, gratMat));

    /* ── Country boundaries ──────────────────────────────────── */

    fetch('/countries-50m.json')
      .then((r) => r.json())
      .then((data) => {
        const geojson = data.type === 'Topology' ? topoToGeo(data) : data;
        const bGeo = buildBoundaryGeometry(geojson, GLOBE_RADIUS * 1.001);
        const bMat = new THREE.LineBasicMaterial({
          color: 0x0A9396,
          transparent: true,
          opacity: 0.45,
        });
        group.add(new THREE.LineSegments(bGeo, bMat));
      })
      .catch(() => {
        // Fallback to 110m if 50m isn't available
        fetch('/world-110m.json')
          .then((r) => r.json())
          .then((data) => {
            const geojson =
              data.type === 'Topology' ? topoToGeo(data) : data;
            const bGeo = buildBoundaryGeometry(
              geojson,
              GLOBE_RADIUS * 1.001
            );
            const bMat = new THREE.LineBasicMaterial({
              color: 0x0A9396,
              transparent: true,
              opacity: 0.3,
            });
            group.add(new THREE.LineSegments(bGeo, bMat));
          })
          .catch(() => {});
      });

    /* ── Server Towers at honeypot locations ──────────────────── */

    const towerHitboxes: THREE.Mesh[] = [];
    const homeRings: THREE.Mesh[] = [];

    for (const hp of HONEYPOT_LOCATIONS) {
      const tower = buildServerTower(
        hp.lat,
        hp.lng,
        GLOBE_RADIUS,
        hp.id
      );
      group.add(tower);

      // Collect invisible hitbox meshes for raycasting
      tower.traverse((child) => {
        if (
          child instanceof THREE.Mesh &&
          child.userData.type === 'server-tower-hitbox'
        ) {
          towerHitboxes.push(child);
        }
      });

      // Pulsing ring at tower base
      const ring = createHomeBaseRing(hp.lat, hp.lng, GLOBE_RADIUS);
      ring.userData = { ringIndex: HONEYPOT_LOCATIONS.indexOf(hp) };
      group.add(ring);
      homeRings.push(ring);
    }

    // Store refs for click handler
    sceneRef.current = { camera, renderer, group, towerHitboxes };

    /* ── Threat markers (InstancedMesh) ──────────────────────── */

    let markerMesh: THREE.InstancedMesh | null = null;
    const markerGeo = new THREE.SphereGeometry(0.012, 10, 10);
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
        const pos = latLngToVector3(
          t.latitude,
          t.longitude,
          GLOBE_RADIUS * 1.005
        );
        const scale = Math.max(0.6, Math.min(2.5, t.eventCount / 8));
        dummy.position.copy(pos);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        markerMesh.setMatrixAt(i, dummy.matrix);
        color.setHex(getCategoryColor(t.category));
        markerMesh.setColorAt(i, color);
      }
      markerMesh.instanceMatrix.needsUpdate = true;
      if (markerMesh.instanceColor)
        markerMesh.instanceColor.needsUpdate = true;
      group.add(markerMesh);
    }

    /* ── Data-dependent layers ───────────────────────────────── */

    const arcMaterials: THREE.ShaderMaterial[] = [];

    if (geoData && geoData.length > 0) {
      updateMarkers(geoData);

      // City spike pins
      const spikeGeo = buildCitySpikeGeometry(
        geoData,
        GLOBE_RADIUS * 1.005,
        0.15
      );
      const spikeMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
      });
      group.add(new THREE.LineSegments(spikeGeo, spikeMat));

      // Ballistic arcs, using actual src → dest coordinates
      const actThreats = geoData
        .filter((t) => t.eventCount > 3)
        .slice(0, 30);

      actThreats.forEach((t, i) => {
        // Use actual destination coords if available, else default to nearest honeypot
        const dLat = t.destLatitude ?? 39.04;
        const dLng = t.destLongitude ?? -77.49;

        // Skip arcs where source ≈ destination (degenerate vertical spikes)
        const dist = Math.sqrt(
          Math.pow(t.latitude - dLat, 2) +
            Math.pow(t.longitude - dLng, 2)
        );
        if (dist < 3) return;

        // Farther attacks need taller arcs to clear the globe curvature
        const distFactor = Math.min(dist / 180, 1.0);
        const arcHeight = 0.3 + distFactor * 0.9 + Math.random() * 0.1;

        const arcGeo = buildAnimatedArcGeometry(
          t.latitude,
          t.longitude,
          dLat,
          dLng,
          GLOBE_RADIUS,
          80,
          arcHeight
        );

        const catColor = new THREE.Color(getCategoryColor(t.category));
        const arcMat = new THREE.ShaderMaterial({
          vertexShader: ARC_VERT,
          fragmentShader: ARC_FRAG,
          uniforms: {
            uProgress: { value: 0 },
            uColor: { value: catColor },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });

        arcMat.userData = {
          phase: (i / actThreats.length) * Math.PI * 2,
        };

        group.add(new THREE.Line(arcGeo, arcMat));
        arcMaterials.push(arcMat);
      });
    }

    /* ── Interaction ─────────────────────────────────────────── */

    let autoRotate = true;
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      autoRotate = false;
      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        group.rotation.y += (e.clientX - prevMouse.x) * 0.005;
        group.rotation.x += (e.clientY - prevMouse.y) * 0.005;
        prevMouse = { x: e.clientX, y: e.clientY };
        return;
      }

      // Hover: check markers
      if (!markerMesh || !geoData || geoData.length === 0) {
        setTooltip(null);
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // Check tower hitboxes first
      const towerHits = raycaster.intersectObjects(towerHitboxes);
      if (towerHits.length > 0) {
        renderer.domElement.style.cursor = 'pointer';
        setTooltip(null);
        return;
      }
      renderer.domElement.style.cursor = 'default';

      // Check threat markers
      const hits = raycaster.intersectObject(markerMesh);
      if (
        hits.length > 0 &&
        hits[0].instanceId !== undefined &&
        hits[0].instanceId < geoData.length
      ) {
        autoRotate = false;
        setTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          threat: geoData[hits[0].instanceId],
        });
        return;
      }
      setTooltip(null);
      if (!isDragging) autoRotate = true;
    };

    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      const towerHits = raycaster.intersectObjects(towerHitboxes);
      if (towerHits.length > 0) {
        const hitId = towerHits[0].object.userData.honeypotId;
        const hp = HONEYPOT_LOCATIONS.find((h) => h.id === hitId);
        if (hp) {
          setSelectedHoneypot(hp);
          autoRotate = false;
        }
      }
    };

    const onMouseUp = () => {
      isDragging = false;
      autoRotate = true;
    };
    const onWheel = (e: WheelEvent) => {
      camera.position.z = Math.max(
        1.5,
        Math.min(4.0, camera.position.z + e.deltaY * 0.002)
      );
    };

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('wheel', onWheel);

    /* ── Render loop ─────────────────────────────────────────── */

    const clock = new THREE.Clock();
    let animId: number;

    function animate() {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      if (autoRotate) group.rotation.y += 0.0005;

      // Animate ballistic arcs
      for (const mat of arcMaterials) {
        const phase = (mat.userData as { phase: number }).phase ?? 0;
        const cycle = 5.0;
        const raw = ((elapsed + phase) % cycle) / cycle;
        const t = Math.min(raw / 0.7, 1.0);
        mat.uniforms.uProgress.value = t;
      }

      // Pulse home-base rings
      for (const ring of homeRings) {
        const idx = (ring.userData as { ringIndex: number }).ringIndex;
        const pulse = ((elapsed * 0.8 + idx * 0.6) % 2.0) / 2.0;
        ring.scale.setScalar(1.0 + pulse * 2.5);
        (ring.material as THREE.MeshBasicMaterial).opacity =
          (1.0 - pulse) * 0.6;
      }

      // Blink server tower LEDs
      group.traverse((child) => {
        if (
          child instanceof THREE.Points &&
          child.parent?.userData?.type === 'server-tower'
        ) {
          const mat = child.material as THREE.PointsMaterial;
          mat.opacity = 0.5 + Math.sin(elapsed * 3 + Math.random() * 0.1) * 0.4;
        }
      });

      renderer.render(scene, camera);
    }
    animate();

    /* ── Resize ───────────────────────────────────────────────── */

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    ro.observe(el);

    /* ── Cleanup ──────────────────────────────────────────────── */

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.dispose();
      starGeo.dispose(); starMat.dispose();
      sphereGeo.dispose();
      sphereMat.dispose();
      atmosGeo.dispose();
      atmosMat.dispose();
      gratGeo.dispose();
      gratMat.dispose();
      markerGeo.dispose();
      markerMat.dispose();
      sceneRef.current = null;
      el.removeChild(renderer.domElement);
    };
  }, [geoData]);

  /* ═══════════════════════════════════════════════════════════════
     JSX
     ═══════════════════════════════════════════════════════════════ */

  return (
    <div className="flex flex-col md:flex-row gap-4 h-auto md:h-[600px]">
      {/* Globe viewport */}
      <div className="relative flex-[2] min-h-[350px] bg-providence-surface border border-providence-border rounded-lg overflow-hidden">
        <div ref={containerRef} className="w-full h-full" />

        {/* HUD overlay, corner brackets */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Top-left bracket */}
          <div className="absolute top-3 left-3 w-6 h-6 border-l-2 border-t-2 border-providence-accent/30 rounded-tl" />
          {/* Top-right bracket */}
          <div className="absolute top-3 right-3 w-6 h-6 border-r-2 border-t-2 border-providence-accent/30 rounded-tr" />
          {/* Bottom-left bracket */}
          <div className="absolute bottom-3 left-3 w-6 h-6 border-l-2 border-b-2 border-providence-accent/30 rounded-bl" />
          {/* Bottom-right bracket */}
          <div className="absolute bottom-3 right-3 w-6 h-6 border-r-2 border-b-2 border-providence-accent/30 rounded-br" />

          {/* LIVE indicator */}
          <div className="absolute top-4 left-5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[9px] text-red-400/70 font-mono tracking-wider">LIVE</span>
          </div>

          {/* UTC time (live) */}
          <div className="absolute bottom-4 right-5">
            <UtcClock />
          </div>
        </div>

        {/* Hover tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none bg-providence-bg/95 border border-providence-border rounded-lg px-3 py-2.5 text-xs z-10 backdrop-blur-md shadow-lg max-w-xs"
            style={{ left: tooltip.x + 14, top: tooltip.y - 12 }}
          >
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: getCategoryHex(tooltip.threat.category),
                }}
              />
              <span
                className="font-semibold"
                style={{
                  color: getCategoryHex(tooltip.threat.category),
                }}
              >
                {tooltip.threat.category}
              </span>
            </div>
            <p className="font-mono text-gray-200 text-[11px]">
              <IpLink ip={tooltip.threat.sourceIp} className="text-gray-200 text-[11px]" />
            </p>
            <p className="text-gray-400">
              {tooltip.threat.city}
              {tooltip.threat.city && tooltip.threat.country ? ', ' : ''}
              {tooltip.threat.country}
            </p>
            <div className="flex gap-3 mt-1.5 pt-1.5 border-t border-providence-border/50">
              <div>
                <span className="text-gray-500 text-[10px]">Events</span>
                <p className="text-gray-300 font-mono">
                  {tooltip.threat.eventCount}
                </p>
              </div>
              <div>
                <span className="text-gray-500 text-[10px]">Last seen</span>
                <p className="text-gray-300 font-mono text-[10px]">
                  {new Date(tooltip.threat.lastSeen).toLocaleTimeString()}
                </p>
              </div>
              {tooltip.threat.destCity && (
                <div>
                  <span className="text-gray-500 text-[10px]">Target</span>
                  <p className="text-gray-300 text-[10px]">
                    {tooltip.threat.destCity}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Honeypot detail panel (on tower click) */}
        {selectedHoneypot && geoData && (
          <HoneypotPanel
            honeypot={selectedHoneypot}
            threats={geoData}
            onClose={() => setSelectedHoneypot(null)}
          />
        )}
      </div>

      {/* Right sidebar */}
      <div className="flex-1 bg-providence-surface border border-providence-border rounded-lg p-4 overflow-auto">
        <h3 className="text-sm text-gray-400 mb-3">Top Source Origins</h3>
        {geoData && geoData.length > 0 ? (
          <>
            <p className="text-xs text-gray-500 mb-3">
              {geoData.length} unique source IPs
            </p>

            {/* Per-IP list with city/region detail */}
            <div className="space-y-2">
              {geoData
                .slice()
                .sort((a, b) => b.eventCount - a.eventCount)
                .slice(0, 15)
                .map((t) => (
                  <div
                    key={t.sourceIp}
                    className="border border-providence-border/50 rounded px-2.5 py-2 hover:border-providence-border transition-colors"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <IpLink ip={t.sourceIp} className="text-[11px] text-gray-300" />
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                        style={{
                          color: getCategoryHex(t.category),
                          backgroundColor:
                            getCategoryHex(t.category) + '18',
                        }}
                      >
                        {t.category}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-gray-500">
                        {t.city
                          ? `${t.city}, ${t.country}`
                          : t.country || 'Unknown'}
                      </span>
                      <span className="text-gray-500 font-mono">
                        {t.eventCount} events
                      </span>
                    </div>
                    {t.destCity && (
                      <div className="text-[10px] text-gray-600 mt-0.5">
                        → {t.destCity}, {t.destCountry}
                      </div>
                    )}
                  </div>
                ))}
            </div>

            {/* Country rollup below */}
            <h4 className="text-xs text-gray-500 mt-4 mb-2 uppercase tracking-wider">
              By Country
            </h4>
            {Object.entries(
              geoData.reduce<Record<string, number>>((acc, t) => {
                acc[t.country] = (acc[t.country] || 0) + t.eventCount;
                return acc;
              }, {})
            )
              .sort(([, a], [, b]) => b - a)
              .slice(0, 10)
              .map(([country, count]) => (
                <div
                  key={country}
                  className="flex justify-between py-0.5 text-sm"
                >
                  <span className="text-gray-300">{country}</span>
                  <span className="text-gray-500 font-mono">{count}</span>
                </div>
              ))}
          </>
        ) : geoError ? (
          <p className="text-red-400 text-sm">Failed to load geo data: {geoError}</p>
        ) : geoLoading ? (
          <p className="text-gray-500 text-sm">Loading threat data...</p>
        ) : (
          <p className="text-gray-500 text-sm">No geo data available</p>
        )}
      </div>
    </div>
  );
}
