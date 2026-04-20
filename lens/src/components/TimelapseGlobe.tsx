import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import {
  latLngToVector3,
  buildBoundaryGeometry,
  topoToGeo,
  buildGraticuleGeometry,
  buildAnimatedArcGeometry,
  createHomeBaseRing,
  buildServerTower,
  HONEYPOT_LOCATIONS,
} from '../utils/globe';
import { getCategoryColor, getCategoryHex } from '../utils/geoip';
import type { HoneypotInfo } from '../utils/globe';

const GLOBE_RADIUS = 1;
const MAX_ACTIVE_ARCS = 40;

interface TimelapseEvent {
  t: string;
  src?: string;
  sLat: number;
  sLng: number;
  cat: string;
  dLat: number;
  dLng: number;
  cc: string;
  city?: string;
}

/* Resolve dest coordinates to a honeypot name */
function resolveDestination(dLat: number, dLng: number): string {
  for (const hp of HONEYPOT_LOCATIONS) {
    if (Math.abs(hp.lat - dLat) < 2 && Math.abs(hp.lng - dLng) < 2) {
      return hp.location;
    }
  }
  return '';
}

/* ── GLSL Shaders ─────────────────────────────────────────────── */

const ATMOS_VERT = `
  varying vec3 vNormal; varying vec3 vPositionW;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPositionW = (modelViewMatrix * vec4(position,1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }`;
const ATMOS_FRAG = `
  varying vec3 vNormal; varying vec3 vPositionW;
  void main() {
    vec3 v = normalize(-vPositionW);
    float rim = 1.0 - max(0.0, dot(v, vNormal));
    gl_FragColor = vec4(0.15, 0.55, 0.8, pow(rim,4.0)*0.4);
  }`;
const ARC_VERT = `
  attribute float aT; uniform float uProgress; varying float vT;
  void main() { vT=aT; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const ARC_FRAG = `
  uniform float uProgress; uniform vec3 uColor; varying float vT;
  void main() {
    if(vT>uProgress) discard;
    float h=exp(-(uProgress-vT)*18.0);
    vec3 c=mix(uColor,vec3(1.0),h*0.8);
    gl_FragColor=vec4(c, mix(0.15,1.0,h));
  }`;


/* ── Honeypot Panel ───────────────────────────────────────────── */

function HoneypotPanel({ honeypot, processedEvents, onClose }: {
  honeypot: HoneypotInfo;
  processedEvents: TimelapseEvent[];
  onClose: () => void;
}) {
  const stats = useMemo(() => {
    const incoming = processedEvents.filter(e => {
      const dlat = Math.abs(e.dLat - honeypot.lat);
      const dlng = Math.abs(e.dLng - honeypot.lng);
      return dlat < 2 && dlng < 2;
    });
    const byCat: Record<string, number> = {};
    const byCountry: Record<string, number> = {};
    for (const e of incoming) {
      byCat[e.cat] = (byCat[e.cat] || 0) + 1;
      byCountry[e.cc] = (byCountry[e.cc] || 0) + 1;
    }
    return {
      total: incoming.length,
      uniqueIPs: new Set(incoming.map(e => e.src).filter(Boolean)).size,
      byCat: Object.entries(byCat).sort(([,a],[,b]) => b - a),
      byCountry: Object.entries(byCountry).sort(([,a],[,b]) => b - a).slice(0, 5),
    };
  }, [processedEvents, honeypot]);

  return (
    <div className="absolute top-3 right-3 w-72 max-h-[420px] overflow-y-auto panel-scroll bg-providence-bg/95 border border-providence-border rounded-lg p-3 z-20 backdrop-blur-md shadow-2xl">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="font-mono text-sm text-green-400">{honeypot.label}</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">×</button>
      </div>
      <div className="space-y-1 text-xs border-b border-providence-border pb-2 mb-2">
        <div className="flex justify-between"><span className="text-gray-500">Region</span><span className="text-gray-300 font-mono">{honeypot.region}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Location</span><span className="text-gray-300">{honeypot.location}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Hostname</span><span className="text-gray-300 font-mono">{honeypot.hostname}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">IP</span><span className="text-gray-300 font-mono">{honeypot.ip}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Instance</span><span className="text-gray-300 font-mono">{honeypot.instanceType}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Stack</span><span className="text-gray-300">{honeypot.os} · {honeypot.stack}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Profile</span><span className="text-gray-300">{honeypot.profile}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Trap ports</span><span className="text-gray-300 font-mono">{honeypot.trapPorts}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Attracts</span><span className="text-gray-300 text-right max-w-[150px]">{honeypot.attracts}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Disguise</span><span className="text-gray-300 text-right max-w-[150px]">{honeypot.disguise}</span></div>
      </div>

      {/* Bait files */}
      <div className="mb-2">
        <h4 className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Bait Files</h4>
        {honeypot.baitFiles.map(f => (
          <p key={f} className="text-[9px] font-mono text-gray-400 py-0.5">{f}</p>
        ))}
      </div>

      {honeypot.fakeCmds.length > 0 && (
        <div className="mb-2">
          <h4 className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Fake Commands</h4>
          <div className="flex flex-wrap gap-1">
            {honeypot.fakeCmds.map(c => (
              <span key={c} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-providence-accent/10 text-providence-accent">{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* Fake hardware specs */}
      {'hardware' in honeypot && honeypot.hardware && (
        <div className="mb-2">
          <h4 className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Fake Hardware</h4>
          <div className="space-y-0.5 text-[9px]">
            <div className="flex justify-between"><span className="text-gray-500">CPU</span><span className="text-gray-300 font-mono text-right max-w-[150px]">{(honeypot as any).hardware.cpu}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">RAM</span><span className="text-gray-300 font-mono">{(honeypot as any).hardware.ram}</span></div>
            {(honeypot as any).hardware.gpus && <div className="flex justify-between"><span className="text-gray-500">GPUs</span><span className="text-providence-accent font-mono text-right max-w-[150px]">{(honeypot as any).hardware.gpus}</span></div>}
            {(honeypot as any).hardware.cuda && <div className="flex justify-between"><span className="text-gray-500">CUDA</span><span className="text-gray-300 font-mono">{(honeypot as any).hardware.cuda}</span></div>}
            {(honeypot as any).hardware.network && <div className="flex justify-between"><span className="text-gray-500">Network</span><span className="text-gray-300 font-mono text-right max-w-[150px]">{(honeypot as any).hardware.network}</span></div>}
            {(honeypot as any).hardware.storage && <div className="flex justify-between"><span className="text-gray-500">Storage</span><span className="text-gray-300 font-mono text-right max-w-[150px]">{(honeypot as any).hardware.storage}</span></div>}
          </div>
        </div>
      )}

      {/* Planted secrets */}
      {'fakeSecrets' in honeypot && (honeypot as any).fakeSecrets?.length > 0 && (
        <div className="mb-2">
          <h4 className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Planted Secrets</h4>
          <div className="flex flex-wrap gap-1">
            {(honeypot as any).fakeSecrets.map((s: string) => (
              <span key={s} className="text-[8px] font-mono px-1 py-0.5 rounded bg-red-500/10 text-red-400">{s}</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="bg-providence-surface rounded px-2 py-1"><p className="text-lg font-mono text-gray-200">{stats.total.toLocaleString()}</p><p className="text-[10px] text-gray-500">Events</p></div>
        <div className="bg-providence-surface rounded px-2 py-1"><p className="text-lg font-mono text-gray-200">{stats.uniqueIPs.toLocaleString()}</p><p className="text-[10px] text-gray-500">Unique IPs</p></div>
      </div>
      {stats.byCat.length > 0 && <div className="mb-2">{stats.byCat.map(([cat, n]) => (
        <div key={cat} className="flex items-center justify-between py-0.5">
          <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getCategoryHex(cat) }} /><span className="text-xs text-gray-400">{cat}</span></div>
          <span className="text-xs text-gray-500 font-mono">{n}</span>
        </div>
      ))}</div>}
      {stats.byCountry.length > 0 && <div>{stats.byCountry.map(([cc, n]) => (
        <div key={cc} className="flex justify-between py-0.5"><span className="text-xs text-gray-400">{cc}</span><span className="text-xs text-gray-500 font-mono">{n}</span></div>
      ))}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Marker data stored per-source with cached world-space position.
   World position is updated every frame in the render loop so
   screen-space hit detection always reflects the current rotation.
   ═══════════════════════════════════════════════════════════════════ */

interface MarkerEntry {
  lat: number;
  lng: number;
  cat: string;
  worldPos: THREE.Vector3; // updated each frame
  event: TimelapseEvent;   // full event for tooltip
}

/* ═══════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════ */

export default function TimelapseGlobe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  const [events, setEvents] = useState<TimelapseEvent[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(24);
  const [cursor, setCursor] = useState(0);
  const [currentDate, setCurrentDate] = useState('');
  const [stats, setStats] = useState({ total: 0, active: 0, countries: 0 });
  const [selectedHoneypot, setSelectedHoneypot] = useState<HoneypotInfo | null>(null);
  const [processedEvents, setProcessedEvents] = useState<TimelapseEvent[]>([]);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    event: TimelapseEvent;
    pinned?: boolean;
  } | null>(null);

  const playingRef = useRef(false);
  const cursorRef = useRef(0);
  const speedRef = useRef(24);
  const tooltipPinnedRef = useRef(false);
  const sceneRef = useRef<{
    group: THREE.Group;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    arcs: { line: THREE.Line; mat: THREE.ShaderMaterial; birth: number }[];
    markers: THREE.InstancedMesh | null;
    markerData: MarkerEntry[];
    clock: THREE.Clock;
    towerHitboxes: THREE.Mesh[];
  } | null>(null);

  const [loadError, setLoadError] = useState(false);

  // Load timelapse data
  useEffect(() => {
    fetch('/timelapse.json')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: TimelapseEvent[]) => {
        setEvents(data);
        setStats(s => ({ ...s, total: data.length }));
        if (data.length > 0) setCurrentDate(data[0].t.slice(0, 10));
        // Auto-play when navigated with ?autoplay (demo mode)
        if (searchParams.has('autoplay') && data.length > 0) {
          setSpeed(480); // fast: 1 day/3s
          setPlaying(true);
        }
      })
      .catch(() => setLoadError(true));
  }, []);

  // Sync refs
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { tooltipPinnedRef.current = !!tooltip?.pinned; }, [tooltip]);

  // ── Three.js scene ──────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const w = el.clientWidth, h = el.clientHeight;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.z = 2.8;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    // Stars
    const starPos = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const r = 8 + Math.random() * 12;
      starPos[i*3] = r*Math.sin(ph)*Math.cos(th);
      starPos[i*3+1] = r*Math.sin(ph)*Math.sin(th);
      starPos[i*3+2] = r*Math.cos(ph);
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.06, transparent: true, opacity: 0.85, depthWrite: false
    })));

    // Lighting
    scene.add(new THREE.AmbientLight(0x223344, 0.4));
    const dl = new THREE.DirectionalLight(0x88bbdd, 0.6);
    dl.position.set(5, 3, 5);
    scene.add(dl);

    // Globe
    const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96);
    const sphereMat = new THREE.MeshPhongMaterial({ color: 0x060d10, transparent: true, opacity: 0.97, shininess: 10 });
    group.add(new THREE.Mesh(sphereGeo, sphereMat));

    new THREE.TextureLoader().load('/earth-dark.jpg', (tex) => {
      sphereMat.map = tex; sphereMat.needsUpdate = true;
    }, undefined, () => {});

    // Atmosphere
    const aGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.06, 96, 96);
    group.add(new THREE.Mesh(aGeo, new THREE.ShaderMaterial({
      vertexShader: ATMOS_VERT, fragmentShader: ATMOS_FRAG,
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    })));

    // Graticule
    const gGeo = buildGraticuleGeometry(GLOBE_RADIUS * 1.0015, 30);
    group.add(new THREE.LineSegments(gGeo, new THREE.LineBasicMaterial({ color: 0x0A9396, transparent: true, opacity: 0.06 })));

    // Boundaries
    fetch('/countries-50m.json').then(r => r.json()).then(data => {
      const geo = data.type === 'Topology' ? topoToGeo(data) : data;
      group.add(new THREE.LineSegments(
        buildBoundaryGeometry(geo, GLOBE_RADIUS * 1.001),
        new THREE.LineBasicMaterial({ color: 0x0A9396, transparent: true, opacity: 0.45 })
      ));
    }).catch(() => {});

    // Server towers + pulsing rings
    const homeRings: THREE.Mesh[] = [];
    const towerHitboxes: THREE.Mesh[] = [];

    for (const hp of HONEYPOT_LOCATIONS) {
      const tower = buildServerTower(hp.lat, hp.lng, GLOBE_RADIUS, hp.id);
      group.add(tower);

      tower.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.type === 'server-tower-hitbox') {
          towerHitboxes.push(child);
        }
      });

      for (let r = 0; r < 3; r++) {
        const ring = createHomeBaseRing(hp.lat, hp.lng, GLOBE_RADIUS);
        ring.userData = { ringIndex: homeRings.length };
        group.add(ring);
        homeRings.push(ring);
      }
    }

    // Marker mesh
    const mGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const mMat = new THREE.MeshBasicMaterial();

    const sceneData: NonNullable<typeof sceneRef.current> = {
      group,
      camera,
      renderer,
      arcs: [],
      markers: null,
      markerData: [],
      clock: new THREE.Clock(),
      towerHitboxes,
    };
    sceneRef.current = sceneData;

    // ── Interaction ─────────────────────────────────────────
    let autoRotate = true, isDragging = false, prevMouse = { x: 0, y: 0 };
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // Shared screen-space hit test against cached marker world positions
    function findClosestMarker(
      screenX: number,
      screenY: number,
      rect: DOMRect,
      threshold: number
    ): { event: TimelapseEvent; dist: number } | null {
      let best: { event: TimelapseEvent; dist: number } | null = null;

      for (const md of sceneData.markerData) {
        const projected = md.worldPos.clone().project(camera);

        // Skip markers behind the camera
        if (projected.z > 1) continue;

        const sx = (projected.x * 0.5 + 0.5) * rect.width;
        const sy = (-projected.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - screenX, sy - screenY);

        if (d < threshold && (!best || d < best.dist)) {
          best = { event: md.event, dist: d };
        }
      }

      return best;
    }

    const onDown = (e: MouseEvent) => {
      isDragging = true; autoRotate = false;
      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const onMove = (e: MouseEvent) => {
      if (isDragging) {
        group.rotation.y += (e.clientX - prevMouse.x) * 0.005;
        group.rotation.x += (e.clientY - prevMouse.y) * 0.005;
        prevMouse = { x: e.clientX, y: e.clientY };
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;

      mouse.x = (localX / rect.width) * 2 - 1;
      mouse.y = -(localY / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // Tower hover
      const towerHits = raycaster.intersectObjects(towerHitboxes);
      if (towerHits.length > 0) {
        renderer.domElement.style.cursor = 'pointer';
        if (!tooltipPinnedRef.current) setTooltip(null);
        return;
      }

      // Marker hover (screen-space)
      if (sceneData.markerData.length > 0) {
        const hit = findClosestMarker(localX, localY, rect, 15);
        if (hit) {
          renderer.domElement.style.cursor = 'pointer';
          if (!tooltipPinnedRef.current) {
            setTooltip({ x: localX, y: localY, event: hit.event });
          }
          return;
        }
      }

      renderer.domElement.style.cursor = 'default';
      if (!tooltipPinnedRef.current) setTooltip(null);
    };

    const onUp = () => { isDragging = false; autoRotate = true; };

    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      mouse.x = (clickX / rect.width) * 2 - 1;
      mouse.y = -(clickY / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // Tower click
      const towerHits = raycaster.intersectObjects(towerHitboxes);
      if (towerHits.length > 0) {
        const hitId = towerHits[0].object.userData.honeypotId;
        const hp = HONEYPOT_LOCATIONS.find(h => h.id === hitId);
        if (hp) { setSelectedHoneypot(hp); setTooltip(null); }
        return;
      }

      // Marker click, pin tooltip
      if (sceneData.markerData.length > 0) {
        const hit = findClosestMarker(clickX, clickY, rect, 20);
        if (hit) {
          setTooltip({ x: clickX, y: clickY, event: hit.event, pinned: true });
          setSelectedHoneypot(null);
          return;
        }
      }

      setTooltip(null);
      setSelectedHoneypot(null);
    };

    const onWheel = (e: WheelEvent) => {
      camera.position.z = Math.max(1.5, Math.min(4.0, camera.position.z + e.deltaY * 0.002));
    };

    renderer.domElement.addEventListener('mousedown', onDown);
    renderer.domElement.addEventListener('mousemove', onMove);
    renderer.domElement.addEventListener('mouseup', onUp);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('wheel', onWheel);

    // ── Render loop ─────────────────────────────────────────
    let animId: number;

    function animate() {
      animId = requestAnimationFrame(animate);
      const elapsed = sceneData.clock.getElapsedTime();
      if (autoRotate) group.rotation.y += 0.0003;

      // Animate active arcs
      const toRemove: number[] = [];
      sceneData.arcs.forEach((arc, i) => {
        const age = elapsed - arc.birth;
        arc.mat.uniforms.uProgress.value = Math.min(age / 3.0, 1.0);
        if (age > 4.0) toRemove.push(i);
      });
      for (let i = toRemove.length - 1; i >= 0; i--) {
        const arc = sceneData.arcs[toRemove[i]];
        group.remove(arc.line);
        arc.line.geometry.dispose();
        arc.mat.dispose();
        sceneData.arcs.splice(toRemove[i], 1);
      }

      // Pulse rings
      homeRings.forEach(ring => {
        const idx = (ring.userData as { ringIndex: number }).ringIndex;
        const pulse = ((elapsed * 0.8 + idx * 0.6) % 2.0) / 2.0;
        ring.scale.setScalar(1.0 + pulse * 2.5);
        (ring.material as THREE.MeshBasicMaterial).opacity = (1.0 - pulse) * 0.6;
      });

      // Blink server tower LEDs
      sceneData.group.traverse((child) => {
        if (child instanceof THREE.Points && child.parent?.userData?.type === 'server-tower') {
          (child.material as THREE.PointsMaterial).opacity =
            0.5 + Math.sin(elapsed * 3 + Math.random() * 0.1) * 0.4;
        }
      });

      // Rebuild InstancedMesh when new markers have been added
      if (sceneData.markerData.length > 0 &&
          (!sceneData.markers || sceneData.markers.count !== sceneData.markerData.length)) {
        if (sceneData.markers) group.remove(sceneData.markers);
        const count = Math.min(sceneData.markerData.length, 2000);
        sceneData.markers = new THREE.InstancedMesh(mGeo, mMat, count);
        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        for (let i = 0; i < count; i++) {
          const d = sceneData.markerData[i];
          dummy.position.copy(latLngToVector3(d.lat, d.lng, GLOBE_RADIUS * 1.005));
          dummy.scale.setScalar(0.8);
          dummy.updateMatrix();
          sceneData.markers.setMatrixAt(i, dummy.matrix);
          color.setHex(getCategoryColor(d.cat));
          sceneData.markers.setColorAt(i, color);
        }
        sceneData.markers.instanceMatrix.needsUpdate = true;
        if (sceneData.markers.instanceColor) sceneData.markers.instanceColor.needsUpdate = true;
        sceneData.markers.computeBoundingSphere();
        group.add(sceneData.markers);
      }

      // Update cached world-space positions for hit detection.
      // Only runs when markers changed or globe rotated (always, since auto-rotate).
      if (sceneData.markerData.length > 0) {
        for (const md of sceneData.markerData) {
          md.worldPos.copy(latLngToVector3(md.lat, md.lng, GLOBE_RADIUS * 1.005));
          group.localToWorld(md.worldPos);
        }
      }

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
      renderer.domElement.removeEventListener('mousedown', onDown);
      renderer.domElement.removeEventListener('mousemove', onMove);
      renderer.domElement.removeEventListener('mouseup', onUp);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);


  // ── Timelapse playback engine ─────────────────────────────
  useEffect(() => {
    if (!playing || events.length === 0 || !sceneRef.current) return;

    const eventTimes = events.map(e => new Date(e.t).getTime());
    const startTime = eventTimes[0];
    const endTime = eventTimes[eventTimes.length - 1];

    let virtualTime = cursorRef.current < events.length
      ? eventTimes[cursorRef.current]
      : startTime;

    let lastRealTime = performance.now();

    const interval = setInterval(() => {
      if (!playingRef.current || !sceneRef.current) return;

      const sd = sceneRef.current;
      const now = performance.now();
      const realDelta = (now - lastRealTime) / 1000;
      lastRealTime = now;

      virtualTime += realDelta * speedRef.current * 60000;

      let cur = cursorRef.current;
      let fired = 0;

      while (cur < events.length && eventTimes[cur] <= virtualTime) {
        const ev = events[cur];

        // Add marker (deduplicate by rounded lat/lng)
        const key = `${ev.sLat.toFixed(2)},${ev.sLng.toFixed(2)}`;
        if (!sd.markerData.some(m => `${m.lat.toFixed(2)},${m.lng.toFixed(2)}` === key)) {
          sd.markerData.push({
            lat: ev.sLat,
            lng: ev.sLng,
            cat: ev.cat,
            worldPos: new THREE.Vector3(), // will be populated in render loop
            event: ev,
          });
        }

        // Skip arcs where source ≈ destination (degenerate vertical spikes)
        const dist = Math.sqrt(
          Math.pow(ev.sLat - ev.dLat, 2) + Math.pow(ev.sLng - ev.dLng, 2)
        );

        if (dist >= 3 && sd.arcs.length < MAX_ACTIVE_ARCS) {
          // Farther attacks need taller arcs to clear globe curvature
          const distFactor = Math.min(dist / 180, 1.0);
          const arcHeight = 0.3 + distFactor * 0.9 + Math.random() * 0.1;

          const arcGeo = buildAnimatedArcGeometry(
            ev.sLat, ev.sLng, ev.dLat, ev.dLng,
            GLOBE_RADIUS * 1.01, 60, arcHeight
          );
          const catColor = new THREE.Color(getCategoryColor(ev.cat));
          const arcMat = new THREE.ShaderMaterial({
            vertexShader: ARC_VERT, fragmentShader: ARC_FRAG,
            uniforms: { uProgress: { value: 0 }, uColor: { value: catColor } },
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
          });
          const line = new THREE.Line(arcGeo, arcMat);
          sd.group.add(line);
          sd.arcs.push({ line, mat: arcMat, birth: sd.clock.getElapsedTime() });
        }

        cur++;
        fired++;
      }

      const dateStr = new Date(virtualTime).toISOString().slice(0, 10);
      const timeStr = new Date(virtualTime).toISOString().slice(11, 16);
      setCurrentDate(`${dateStr}  ${timeStr} UTC`);

      setCursor(cur);
      setProcessedEvents(prev => {
        const next = [...prev, ...events.slice(cursorRef.current, cur)];
        const countries = new Set(next.map(e => e.cc)).size;
        setStats(s => ({ ...s, active: cur, countries }));
        return next;
      });

      if (cur >= events.length || virtualTime > endTime) {
        setPlaying(false);
      }
    }, 1000 / 30);

    return () => clearInterval(interval);
  }, [playing, events]);

  const reset = useCallback(() => {
    setCursor(0);
    setPlaying(false);
    setSelectedHoneypot(null);
    setProcessedEvents([]);
    setTooltip(null);
    if (sceneRef.current) {
      for (const arc of sceneRef.current.arcs) {
        sceneRef.current.group.remove(arc.line);
        arc.line.geometry.dispose();
        arc.mat.dispose();
      }
      sceneRef.current.arcs = [];
      if (sceneRef.current.markers) {
        sceneRef.current.group.remove(sceneRef.current.markers);
        sceneRef.current.markers = null;
      }
      sceneRef.current.markerData = [];
    }
    if (events.length > 0) setCurrentDate(events[0].t.slice(0, 10));
  }, [events]);

  const pct = events.length > 0 ? (cursor / events.length) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row gap-4 h-auto md:h-[550px]">
        {/* Globe viewport */}
        <div className="relative flex-[2] min-h-[350px] bg-providence-surface border border-providence-border rounded-lg overflow-hidden">
          <div ref={containerRef} className="w-full h-full" />

          {/* Date overlay */}
          <div className="absolute top-4 left-4 text-2xl font-mono text-white/80 tracking-wider">
            {loadError
              ? <span className="text-red-400 text-sm">Failed to load timelapse.json</span>
              : events.length === 0
                ? <span className="text-gray-500 text-sm">Loading timelapse data...</span>
                : currentDate}
          </div>

          {/* Stats overlay */}
          <div className="absolute top-4 right-4 text-right text-xs text-gray-400 space-y-1">
            <p>{cursor.toLocaleString()} / {events.length.toLocaleString()} events</p>
            <p>{sceneRef.current?.markerData.length ?? 0} unique sources</p>
            <p>{stats.countries} countries</p>
            <p>{sceneRef.current?.arcs.length ?? 0} active arcs</p>
          </div>

          {/* Marker tooltip */}
          {tooltip && (
            <div
              className="absolute bg-providence-bg/95 border border-providence-border rounded-lg px-3 py-2.5 text-xs z-10 backdrop-blur-md shadow-lg max-w-xs"
              style={{
                left: tooltip.x + 14,
                top: tooltip.y - 12,
                pointerEvents: tooltip.pinned ? 'auto' : 'none',
              }}
            >
              {/* Category badge */}
              <div className="flex items-center justify-between gap-4 mb-1">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: getCategoryHex(tooltip.event.cat) }}
                  />
                  <span
                    className="font-semibold"
                    style={{ color: getCategoryHex(tooltip.event.cat) }}
                  >
                    {tooltip.event.cat}
                  </span>
                </div>
                {tooltip.pinned && (
                  <button
                    onClick={() => setTooltip(null)}
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Source IP */}
              {tooltip.event.src && (
                <p className="font-mono text-gray-200 text-[11px]">
                  {tooltip.event.src}
                </p>
              )}

              {/* Origin city / country */}
              <p className="text-gray-400">
                {tooltip.event.city ? `${tooltip.event.city}, ` : ''}
                {tooltip.event.cc}
              </p>

              {/* Detail row */}
              <div className="flex gap-3 mt-1.5 pt-1.5 border-t border-providence-border/50">
                <div>
                  <span className="text-gray-500 text-[10px]">Timestamp</span>
                  <p className="text-gray-300 font-mono text-[10px]">
                    {tooltip.event.t.slice(0, 16).replace('T', ' ')} UTC
                  </p>
                </div>
                {(() => {
                  const dest = resolveDestination(tooltip.event.dLat, tooltip.event.dLng);
                  return dest ? (
                    <div>
                      <span className="text-gray-500 text-[10px]">Target</span>
                      <p className="text-gray-300 text-[10px]">{dest}</p>
                    </div>
                  ) : null;
                })()}
                <div>
                  <span className="text-gray-500 text-[10px]">Coords</span>
                  <p className="text-gray-300 font-mono text-[10px]">
                    {tooltip.event.sLat.toFixed(2)}, {tooltip.event.sLng.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Honeypot panel */}
          {selectedHoneypot && (
            <HoneypotPanel
              honeypot={selectedHoneypot}
              processedEvents={processedEvents}
              onClose={() => setSelectedHoneypot(null)}
            />
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-64 bg-providence-surface border border-providence-border rounded-lg p-4 overflow-auto">
          <h3 className="text-sm text-gray-400 mb-3">Attack Breakdown</h3>

          {/* Category counts */}
          <div className="mb-4">
            <h4 className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider">By Category</h4>
            {Object.entries(
              processedEvents.reduce<Record<string, number>>((acc, e) => { acc[e.cat] = (acc[e.cat] || 0) + 1; return acc; }, {})
            ).sort(([,a],[,b]) => b - a).map(([cat, count]) => (
              <div key={cat} className="flex items-center justify-between py-0.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getCategoryHex(cat) }} />
                  <span className="text-xs text-gray-400">{cat}</span>
                </div>
                <span className="text-xs text-gray-500 font-mono">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>

          {/* Country rollup */}
          <div className="mb-4">
            <h4 className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Top Countries</h4>
            {Object.entries(
              processedEvents.reduce<Record<string, number>>((acc, e) => { acc[e.cc] = (acc[e.cc] || 0) + 1; return acc; }, {})
            ).sort(([,a],[,b]) => b - a).slice(0, 10).map(([cc, count]) => (
              <div key={cc} className="flex justify-between py-0.5">
                <span className="text-xs text-gray-300">{cc}</span>
                <span className="text-xs text-gray-500 font-mono">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>

          {/* Recent sources */}
          {processedEvents.length > 0 && (
            <div>
              <h4 className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Recent Sources</h4>
              {processedEvents.slice(-10).reverse().filter(e => e.src).map((e, i) => (
                <div key={i} className="border border-providence-border/30 rounded px-2 py-1.5 mb-1 hover:border-providence-border transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-gray-300">{e.src}</span>
                    <span
                      className="text-[9px] px-1 rounded"
                      style={{
                        color: getCategoryHex(e.cat),
                        backgroundColor: getCategoryHex(e.cat) + '18',
                      }}
                    >
                      {e.cat}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-500">
                      {e.city ? `${e.city}, ` : ''}{e.cc}
                    </span>
                    <span className="text-gray-600">
                      → {resolveDestination(e.dLat, e.dLng) || 'Unknown'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 bg-providence-surface border border-providence-border rounded-lg p-3">
        <button
          onClick={() => {
            if (cursor >= events.length) {
              reset();
              setTimeout(() => setPlaying(true), 50);
            } else {
              setPlaying(!playing);
            }
          }}
          disabled={events.length === 0}
          className="px-4 py-1.5 rounded text-sm font-medium bg-providence-accent/20 text-providence-accent hover:bg-providence-accent/30 disabled:opacity-30"
        >
          {playing ? '⏸ Pause' : cursor >= events.length ? '⏮ Replay' : '▶ Play'}
        </button>

        <button onClick={reset}
          className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-gray-200 bg-gray-700/30">
          ⏮ Reset
        </button>

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>Speed:</span>
          {[
            { label: '1 day/min', val: 24 },
            { label: '1 day/10s', val: 144 },
            { label: '1 day/3s', val: 480 },
            { label: '1 week/min', val: 168 },
          ].map(s => (
            <button key={s.val} onClick={() => setSpeed(s.val)}
              className={`px-2 py-1 rounded ${speed === s.val ? 'bg-providence-accent/30 text-providence-accent' : 'bg-gray-700/30 hover:bg-gray-700/50'}`}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Progress bar */}
        <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            setCursor(Math.floor(pct * events.length));
          }}>
          <div className="h-full bg-providence-accent/60 rounded-full transition-all"
            style={{ width: `${pct}%` }} />
        </div>

        <span className="text-xs text-gray-500 w-12 text-right">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}
