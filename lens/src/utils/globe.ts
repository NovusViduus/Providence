import * as THREE from 'three';
import type { GeoThreat } from '../types/events';
import { getCategoryColor } from './geoip';

/* ═══════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════ */

export const HONEYPOT_LOCATIONS = [
  {
    id: 'lure-us',
    label: 'LURE-SSH-US',
    region: 'us-east-1',
    location: 'Ashburn, Virginia',
    hostname: 'prod-web-01',
    ip: '54.91.174.191',
    lat: 39.04,
    lng: -77.49,
    instanceType: 't3.micro',
    os: 'Ubuntu 24.04 LTS',
    stack: 'Cowrie 2.9.10',
    sshPort: 62222,
    profile: 'GPU Production Server',
    trapPorts: '22, 2222, 23',
    attracts: 'Brute force bots, credential stuffing, post-auth recon',
    disguise: '4x NVIDIA A100 GPU server with 256GB RAM, fake AWS/Stripe/Sendgrid keys, RDS connection strings',
    baitFiles: ['/var/www/app/.env', '/var/www/app/config/database.yml', '/home/richard/.aws/credentials', '/home/richard/.ssh/prod-key.pem', '/home/richard/.bash_history'],
    fakeCmds: ['nvidia-smi', 'lspci', 'nproc'],
    hardware: {
      cpu: 'Intel Xeon Platinum 8375C @ 2.90GHz (32 cores)',
      ram: '256 GB',
      gpus: '4x NVIDIA A100-PCIE-80GB',
      cuda: '12.2',
      driver: '535.129.03',
    },
    fakeSecrets: ['AWS keys', 'Stripe live key', 'Sendgrid API key', 'JWT secret', 'Slack webhook', 'RDS PostgreSQL creds', 'Redis password'],
  },
  {
    id: 'lure-eu',
    label: 'LURE-WEB-EU',
    region: 'eu-west-1',
    location: 'Dublin, Ireland',
    hostname: 'prod-api-eu',
    ip: '3.253.60.6',
    lat: 53.33,
    lng: -6.25,
    instanceType: 't3.micro',
    os: 'Ubuntu 24.04 LTS',
    stack: 'Dionaea + DVWA',
    sshPort: 62222,
    profile: 'European Fintech API Server',
    trapPorts: '2222, 23',
    attracts: 'Brute force bots, credential theft, lateral movement attempts',
    disguise: 'Fake EU fintech API with Stripe keys, PCI encryption, AWS creds, and RDS connection strings',
    baitFiles: ['/var/www/api/config/secrets.yml', '/opt/stripe-gateway/config/production.env', '/home/deploy/.aws/credentials', '/home/deploy/.ssh/eu-prod-key.pem', '/home/deploy/.bash_history'],
    fakeCmds: [],
    hardware: {
      cpu: 'Intel Xeon Gold 6342 @ 2.80GHz (24 cores)',
      ram: '512 GB',
    },
    fakeSecrets: ['Stripe live key', 'Stripe webhook secret', 'PCI encryption key', 'AWS keys (2 profiles)', 'RDS PostgreSQL creds', 'Redis password', 'JWT secret', 'SSH private key'],
  },
  {
    id: 'lure-ap',
    label: 'LURE-DB-AP',
    region: 'ap-southeast-1',
    location: 'Singapore',
    hostname: 'prod-db-sg',
    ip: '3.0.102.2',
    lat: 1.28,
    lng: 103.85,
    instanceType: 't3.micro',
    os: 'Ubuntu 24.04 LTS',
    stack: 'Dionaea (DB emulation)',
    sshPort: 62222,
    profile: 'ML Training Server',
    trapPorts: '2222, 3306, 5432, 27017, 1433',
    attracts: 'DB credential stuffing, enumeration, crypto miners targeting GPU resources',
    disguise: '2x NVIDIA H100 ML training rig with 1TB RAM, NVSwitch, 400GbE, fake AWS/Stripe keys',
    baitFiles: ['/var/www/app/.env', '/home/richard/.aws/credentials', '/home/richard/.ssh/prod-key.pem', '/home/richard/.bash_history'],
    fakeCmds: ['nvidia-smi', 'lspci', 'nproc'],
    hardware: {
      cpu: 'Intel Xeon w9-3495X @ 1.90GHz (56 cores)',
      ram: '1 TB',
      gpus: '2x NVIDIA H100 SXM5 80GB + NVSwitch',
      cuda: '12.3',
      driver: '545.23.08',
      network: 'Mellanox ConnectX-7 400GbE',
      storage: '4x Samsung PM9A3 NVMe',
    },
    fakeSecrets: ['AWS keys', 'Stripe live key', 'RDS PostgreSQL creds', 'SSH private key'],
  },
] as const;

export type HoneypotInfo = (typeof HONEYPOT_LOCATIONS)[number];

/* ═══════════════════════════════════════════════════════════════════
   Core coordinate conversion
   ═══════════════════════════════════════════════════════════════════ */

export function latLngToVector3(
  lat: number,
  lng: number,
  radius: number
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

/* ═══════════════════════════════════════════════════════════════════
   Country boundary lines
   ═══════════════════════════════════════════════════════════════════ */

export function buildBoundaryGeometry(
  geojson: {
    features: Array<{
      geometry: {
        type: string;
        coordinates: number[][][] | number[][][][];
      };
    }>;
  },
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

/* ═══════════════════════════════════════════════════════════════════
   Animated arc with parametric aT attribute
   ═══════════════════════════════════════════════════════════════════ */

export function buildAnimatedArcGeometry(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  radius: number,
  segments = 80,
  arcHeight = 0.3
): THREE.BufferGeometry {
  const start = latLngToVector3(lat1, lng1, radius);
  const end = latLngToVector3(lat2, lng2, radius);
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  mid.normalize().multiplyScalar(radius + arcHeight);
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
  const points = curve.getPoints(segments);

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const tValues = new Float32Array(segments + 1);
  for (let i = 0; i <= segments; i++) tValues[i] = i / segments;
  geo.setAttribute('aT', new THREE.BufferAttribute(tValues, 1));
  return geo;
}

/* ═══════════════════════════════════════════════════════════════════
   Graticule grid (lat/lng lines)
   ═══════════════════════════════════════════════════════════════════ */

export function buildGraticuleGeometry(
  radius: number,
  step = 30
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const n = 120;

  for (let lat = -60; lat <= 60; lat += step) {
    const dLng = 360 / n;
    for (let lng = -180; lng < 180; lng += dLng) {
      const p1 = latLngToVector3(lat, lng, radius);
      const p2 = latLngToVector3(lat, lng + dLng, radius);
      vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }
  for (let lng = -180; lng < 180; lng += step) {
    const dLat = 180 / n;
    for (let lat = -90; lat < 90; lat += dLat) {
      const p1 = latLngToVector3(lat, lng, radius);
      const p2 = latLngToVector3(lat + dLat, lng, radius);
      vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return g;
}

/* ═══════════════════════════════════════════════════════════════════
   City / data-center spike pins
   ═══════════════════════════════════════════════════════════════════ */

export function buildCitySpikeGeometry(
  threats: GeoThreat[],
  radius: number,
  maxHeight = 0.15
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();

  for (const t of threats) {
    const base = latLngToVector3(t.latitude, t.longitude, radius);
    const h = Math.min(maxHeight, 0.02 + Math.log2(t.eventCount + 1) * 0.02);
    const tip = latLngToVector3(t.latitude, t.longitude, radius + h);

    positions.push(base.x, base.y, base.z);
    color.setHex(getCategoryColor(t.category));
    colors.push(color.r, color.g, color.b);

    positions.push(tip.x, tip.y, tip.z);
    colors.push(color.r * 0.3, color.g * 0.3, color.b * 0.3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/* ═══════════════════════════════════════════════════════════════════
   Home-base ring geometry
   ═══════════════════════════════════════════════════════════════════ */

export function createHomeBaseRing(
  lat: number,
  lng: number,
  radius: number
): THREE.Mesh {
  const ringGeo = new THREE.RingGeometry(0.02, 0.028, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x0A9396,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(ringGeo, ringMat);
  const pos = latLngToVector3(lat, lng, radius * 1.002);
  mesh.position.copy(pos);
  mesh.lookAt(new THREE.Vector3(0, 0, 0));
  return mesh;
}

/* ═══════════════════════════════════════════════════════════════════
   3D Wireframe Server Tower
   
   Builds a procedural wireframe "server rack" at a lat/lng on the
   globe surface. The tower is oriented perpendicular to the sphere
   surface (pointing outward) and consists of:
   - 4 vertical edge columns
   - Horizontal shelf lines (1U rack dividers)
   - Blinking LED indicator dots (separate Points geometry)
   - A base platform ring
   
   Returns a THREE.Group so we can attach userData for click detection.
   ═══════════════════════════════════════════════════════════════════ */

export function buildServerTower(
  lat: number,
  lng: number,
  radius: number,
  honeypotId: string
): THREE.Group {
  const towerGroup = new THREE.Group();
  towerGroup.userData = { honeypotId, type: 'server-tower' };

  // Tower dimensions (in world units, globe radius is 1)
  const towerW = 0.025;   // width
  const towerD = 0.018;   // depth
  const towerH = 0.08;    // height above surface
  const shelfCount = 6;   // horizontal dividers

  // Surface position and orientation
  const surfacePos = latLngToVector3(lat, lng, radius * 1.001);
  const normal = surfacePos.clone().normalize();

  // Build a local coordinate frame on the surface
  const up = normal.clone();
  const tempRight = new THREE.Vector3(0, 1, 0);
  if (Math.abs(up.dot(tempRight)) > 0.99) {
    tempRight.set(1, 0, 0);
  }
  const forward = new THREE.Vector3().crossVectors(up, tempRight).normalize();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();

  // Helper: local coords → world coords
  function localToWorld(lx: number, ly: number, lz: number): THREE.Vector3 {
    return surfacePos
      .clone()
      .addScaledVector(right, lx)
      .addScaledVector(up, ly)
      .addScaledVector(forward, lz);
  }

  // ── Wireframe edges ──────────────────────────────────────────
  const edgeVerts: number[] = [];
  const hw = towerW / 2;
  const hd = towerD / 2;

  // 4 vertical columns
  const corners = [
    [-hw, 0, -hd],
    [hw, 0, -hd],
    [hw, 0, hd],
    [-hw, 0, hd],
  ];

  for (const [cx, , cz] of corners) {
    const bot = localToWorld(cx, 0, cz);
    const top = localToWorld(cx, towerH, cz);
    edgeVerts.push(bot.x, bot.y, bot.z, top.x, top.y, top.z);
  }

  // Horizontal shelf lines at each level
  for (let s = 0; s <= shelfCount; s++) {
    const y = (s / shelfCount) * towerH;
    for (let i = 0; i < 4; i++) {
      const [x1, , z1] = corners[i];
      const [x2, , z2] = corners[(i + 1) % 4];
      const p1 = localToWorld(x1, y, z1);
      const p2 = localToWorld(x2, y, z2);
      edgeVerts.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }

  // Cross-bracing on the front face (adds visual interest)
  const botLeft = localToWorld(-hw, 0, -hd);
  const topRight = localToWorld(hw, towerH, -hd);
  const botRight = localToWorld(hw, 0, -hd);
  const topLeft = localToWorld(-hw, towerH, -hd);
  edgeVerts.push(
    botLeft.x, botLeft.y, botLeft.z, topRight.x, topRight.y, topRight.z,
    botRight.x, botRight.y, botRight.z, topLeft.x, topLeft.y, topLeft.z
  );

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(edgeVerts, 3)
  );
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x0A9396,
    transparent: true,
    opacity: 0.6,
  });
  towerGroup.add(new THREE.LineSegments(edgeGeo, edgeMat));

  // ── LED indicator dots (one per shelf, on the front face) ────
  const ledPositions: number[] = [];
  const ledColors: number[] = [];
  const statusColors = [
    [0, 1, 0.4],   // green, healthy
    [0, 1, 0.4],
    [1, 0.6, 0],   // amber, activity
    [0, 1, 0.4],
    [0, 0.8, 1],   // cyan, processing
    [0, 1, 0.4],
  ];

  for (let s = 0; s < shelfCount; s++) {
    const y = ((s + 0.5) / shelfCount) * towerH;
    const ledPos = localToWorld(-hw * 0.6, y, -hd * 1.01);
    ledPositions.push(ledPos.x, ledPos.y, ledPos.z);
    const [r, g, b] = statusColors[s % statusColors.length];
    ledColors.push(r, g, b);
  }

  const ledGeo = new THREE.BufferGeometry();
  ledGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(ledPositions, 3)
  );
  ledGeo.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(ledColors, 3)
  );
  const ledMat = new THREE.PointsMaterial({
    size: 0.006,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: true,
  });
  towerGroup.add(new THREE.Points(ledGeo, ledMat));

  // ── Base platform ring ───────────────────────────────────────
  const baseRingGeo = new THREE.RingGeometry(0.018, 0.032, 4);
  const baseRingMat = new THREE.MeshBasicMaterial({
    color: 0x0A9396,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  const baseRing = new THREE.Mesh(baseRingGeo, baseRingMat);
  baseRing.position.copy(surfacePos);
  baseRing.lookAt(new THREE.Vector3(0, 0, 0));
  // Rotate 45° so the square ring sits diamond-style
  baseRing.rotateZ(Math.PI / 4);
  towerGroup.add(baseRing);

  // ── Invisible click target (slightly larger box) ─────────────
  // The wireframe is too thin to reliably raycaster-hit, so we add
  // a transparent box mesh that catches clicks.
  const clickBoxGeo = new THREE.BoxGeometry(towerW * 2, towerH * 1.2, towerD * 2);
  const clickBoxMat = new THREE.MeshBasicMaterial({
    visible: false,
  });
  const clickBox = new THREE.Mesh(clickBoxGeo, clickBoxMat);
  clickBox.userData = { honeypotId, type: 'server-tower-hitbox' };

  // Position at tower center
  const center = localToWorld(0, towerH / 2, 0);
  clickBox.position.copy(center);
  clickBox.lookAt(
    center.clone().addScaledVector(forward, 1)
  );
  // Align the box's "up" with the surface normal
  const quat = new THREE.Quaternion();
  const mat4 = new THREE.Matrix4().makeBasis(right, up, forward);
  quat.setFromRotationMatrix(mat4);
  clickBox.quaternion.copy(quat);

  towerGroup.add(clickBox);

  return towerGroup;
}

/* ═══════════════════════════════════════════════════════════════════
   TopoJSON → GeoJSON converter
   ═══════════════════════════════════════════════════════════════════ */

export function topoToGeo(topo: {
  type: string;
  arcs: number[][][];
  objects: {
    countries: {
      geometries: Array<{
        type: string;
        arcs: number[][] | number[][][];
      }>;
    };
  };
}): {
  features: Array<{
    geometry: { type: string; coordinates: number[][][] | number[][][][] };
  }>;
} {
  const { arcs } = topo;
  const decodedArcs = arcs.map((arc) => {
    let x = 0,
      y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x, y];
    });
  });

  const transform = (topo as Record<string, unknown>).transform as
    | { scale: [number, number]; translate: [number, number] }
    | undefined;

  function transformPoint(p: number[]): number[] {
    if (!transform) return p;
    return [
      p[0] * transform.scale[0] + transform.translate[0],
      p[1] * transform.scale[1] + transform.translate[1],
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
      return {
        geometry: {
          type: 'Polygon',
          coordinates: (geom.arcs as number[][]).map(decodeRing),
        },
      };
    }
    if (geom.type === 'MultiPolygon') {
      return {
        geometry: {
          type: 'MultiPolygon',
          coordinates: (geom.arcs as number[][][]).map((p) =>
            p.map(decodeRing)
          ),
        },
      };
    }
    return { geometry: { type: geom.type, coordinates: [] } };
  });

  return { features };
}
