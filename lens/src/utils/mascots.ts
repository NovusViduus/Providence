import * as THREE from 'three';

/**
 * Each mascot builder returns a THREE.Group with an `update(delta: number)` method
 * stored in userData for the animation loop.
 */

const CYAN = 0x2EC4B6;
const AMBER = 0xffab00;
const MAGENTA = 0xff1744;
const PURPLE = 0xb388ff;
const BLUE = 0x2979ff;

function wireEdges(geo: THREE.BufferGeometry, color: number, opacity = 0.7): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(geo);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.LineSegments(edges, mat);
}

function glowDot(pos: THREE.Vector3, color: number, size = 0.04): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([pos.x, pos.y, pos.z], 3));
  const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}

/* ── Battering Ram (Brute Force) ─────────────────────────────────── */

export function buildBatteringRam(): THREE.Group {
  const g = new THREE.Group();
  let elapsed = 0;

  // Ram body (cylinder)
  const ramGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8);
  const ram = wireEdges(ramGeo, AMBER);
  ram.rotation.z = Math.PI / 2;
  g.add(ram);

  // Ram head (cone)
  const headGeo = new THREE.ConeGeometry(0.1, 0.15, 6);
  const head = wireEdges(headGeo, AMBER);
  head.rotation.z = -Math.PI / 2;
  head.position.x = 0.35;
  g.add(head);

  // A-frame supports (angled braces, not vertical poles)
  for (const side of [-1, 1]) {
    const supportGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4);
    const support = wireEdges(supportGeo, CYAN, 0.4);
    support.position.set(-0.15, 0, side * 0.1);
    support.rotation.x = side * 0.4;
    support.rotation.z = 0.5;
    g.add(support);
  }

  // Wall
  const wallGeo = new THREE.BoxGeometry(0.05, 0.5, 0.4);
  const wall = wireEdges(wallGeo, CYAN, 0.3);
  wall.position.x = 0.55;
  g.add(wall);

  g.userData.update = (delta: number) => {
    elapsed += delta;
    const swing = Math.sin(elapsed * 3) * 0.15;
    ram.position.x = swing;
    head.position.x = 0.35 + swing;
    // Wall shake on impact
    const impact = Math.max(0, Math.sin(elapsed * 3) - 0.8) * 5;
    wall.position.x = 0.55 + impact * 0.02;
  };

  return g;
}

/* ── Swarm (DDoS) ────────────────────────────────────────────────── */

export function buildSwarm(): THREE.Group {
  const g = new THREE.Group();
  let elapsed = 0;

  // Target server (centered)
  const serverGeo = new THREE.BoxGeometry(0.15, 0.3, 0.1);
  const server = wireEdges(serverGeo, CYAN);
  g.add(server);

  // LED on server
  const led = glowDot(new THREE.Vector3(0, 0.1, 0.06), 0x00ff66, 0.05);
  g.add(led);

  // Swarm arrows converge on center
  const arrows: THREE.LineSegments[] = [];
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const r = 0.5 + Math.random() * 0.2;
    const arrowGeo = new THREE.BufferGeometry();
    const pts = [
      new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, 0),
      new THREE.Vector3(Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0),
    ];
    arrowGeo.setFromPoints(pts);
    const arrow = new THREE.LineSegments(arrowGeo, new THREE.LineBasicMaterial({
      color: MAGENTA, transparent: true, opacity: 0.5
    }));
    arrow.userData.angle = angle;
    arrow.userData.baseR = r;
    arrow.userData.speed = 0.5 + Math.random() * 1.5;
    arrows.push(arrow);
    g.add(arrow);
  }

  g.userData.update = (delta: number) => {
    elapsed += delta;
    // Arrows pulse inward
    for (const arrow of arrows) {
      const t = (elapsed * arrow.userData.speed) % 1;
      const r = arrow.userData.baseR * (1 - t * 0.7);
      const a = arrow.userData.angle;
      const positions = arrow.geometry.attributes.position;
      positions.setXYZ(0, Math.cos(a) * r, Math.sin(a) * r, 0);
      positions.setXYZ(1, Math.cos(a) * Math.max(0.1, r - 0.2), Math.sin(a) * Math.max(0.1, r - 0.2), 0);
      positions.needsUpdate = true;
    }
    // LED blinks faster as "load" increases
    (led.material as THREE.PointsMaterial).opacity = 0.3 + Math.abs(Math.sin(elapsed * 8)) * 0.7;
  };

  return g;
}

/* ── Briefcase (Exfiltration) ────────────────────────────────────── */

export function buildBriefcase(): THREE.Group {
  const g = new THREE.Group();
  let elapsed = 0;

  // Server
  const serverGeo = new THREE.BoxGeometry(0.12, 0.25, 0.08);
  const server = wireEdges(serverGeo, CYAN, 0.5);
  server.position.x = -0.3;
  g.add(server);

  // Briefcase
  const caseGeo = new THREE.BoxGeometry(0.2, 0.14, 0.06);
  const briefcase = wireEdges(caseGeo, PURPLE);
  briefcase.position.x = 0.3;
  g.add(briefcase);

  // Handle
  const handleGeo = new THREE.TorusGeometry(0.04, 0.008, 4, 8, Math.PI);
  const handle = wireEdges(handleGeo, PURPLE);
  handle.position.set(0.3, 0.1, 0);
  g.add(handle);

  // Data cubes
  const cubes: THREE.LineSegments[] = [];
  for (let i = 0; i < 5; i++) {
    const cubeGeo = new THREE.BoxGeometry(0.03, 0.03, 0.03);
    const cube = wireEdges(cubeGeo, CYAN);
    cube.userData.phase = i * 0.4;
    cubes.push(cube);
    g.add(cube);
  }

  g.userData.update = (delta: number) => {
    elapsed += delta;
    for (const cube of cubes) {
      const t = ((elapsed + cube.userData.phase) * 0.5) % 2;
      if (t < 1) {
        cube.visible = true;
        cube.position.x = -0.3 + t * 0.6;
        cube.position.y = Math.sin(t * Math.PI) * 0.15;
        cube.rotation.x = t * 3;
        cube.rotation.y = t * 2;
      } else {
        cube.visible = false;
      }
    }
  };

  return g;
}

/* ── Hook (Phishing) ─────────────────────────────────────────────── */

export function buildHook(): THREE.Group {
  const g = new THREE.Group();
  let elapsed = 0;

  // Fishing rod (diagonal line from top-right)
  const rodPts = [
    new THREE.Vector3(0.3, 0.45, 0),
    new THREE.Vector3(0.05, 0.25, 0),
  ];
  const rodGeo = new THREE.BufferGeometry().setFromPoints(rodPts);
  g.add(new THREE.Line(rodGeo, new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.7 })));

  // Fishing line (vertical from rod tip down to hook)
  const linePts = [
    new THREE.Vector3(0.05, 0.25, 0),
    new THREE.Vector3(0.05, -0.05, 0),
  ];
  const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
  const fishingLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.3 }));
  g.add(fishingLine);

  // J-Hook at the bottom of the line
  const hookPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * Math.PI;
    hookPts.push(new THREE.Vector3(
      0.05 + Math.sin(t) * 0.04,
      -0.05 - (1 - Math.cos(t)) * 0.04,
      0
    ));
  }
  // Add the barb (upward tick)
  hookPts.push(new THREE.Vector3(0.05 + 0.02, -0.05 - 0.06, 0));
  const hookGeo = new THREE.BufferGeometry().setFromPoints(hookPts);
  const hookLine = new THREE.Line(hookGeo, new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.8 }));
  g.add(hookLine);

  // Envelope bait dangling from hook
  const envGeo = new THREE.BoxGeometry(0.07, 0.045, 0.005);
  const envelope = wireEdges(envGeo, MAGENTA);
  envelope.position.set(0.05, -0.12, 0);
  g.add(envelope);

  // Envelope flap (triangle on top)
  const flapPts = [
    new THREE.Vector3(-0.035, 0.022, 0.003),
    new THREE.Vector3(0, -0.01, 0.003),
    new THREE.Vector3(0.035, 0.022, 0.003),
  ];
  const flapGeo = new THREE.BufferGeometry().setFromPoints(flapPts);
  const flap = new THREE.Line(flapGeo, new THREE.LineBasicMaterial({ color: MAGENTA, transparent: true, opacity: 0.5 }));
  flap.position.set(0.05, -0.12, 0);
  g.add(flap);

  // Fish (wireframe, swims from left)
  const fishGroup = new THREE.Group();
  // Body (elongated diamond)
  const bodyPts = [
    new THREE.Vector3(-0.06, 0, 0),
    new THREE.Vector3(0, 0.025, 0),
    new THREE.Vector3(0.06, 0, 0),
    new THREE.Vector3(0, -0.025, 0),
    new THREE.Vector3(-0.06, 0, 0),
  ];
  fishGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(bodyPts),
    new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.6 })
  ));
  // Tail
  const tailPts = [
    new THREE.Vector3(-0.06, 0, 0),
    new THREE.Vector3(-0.09, 0.02, 0),
    new THREE.Vector3(-0.09, -0.02, 0),
    new THREE.Vector3(-0.06, 0, 0),
  ];
  fishGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(tailPts),
    new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.4 })
  ));
  // Eye dot
  fishGroup.add(glowDot(new THREE.Vector3(0.03, 0.008, 0), CYAN, 0.02));
  fishGroup.position.set(-0.35, -0.15, 0);
  g.add(fishGroup);

  g.userData.update = (delta: number) => {
    elapsed += delta;

    // Line and hook sway gently
    const sway = Math.sin(elapsed * 1.2) * 0.03;
    hookLine.position.x = sway;
    envelope.position.x = 0.05 + sway;
    flap.position.x = 0.05 + sway;

    // Update fishing line endpoint to follow hook
    const linePositions = fishingLine.geometry.attributes.position;
    linePositions.setXYZ(1, 0.05 + sway, -0.05, 0);
    linePositions.needsUpdate = true;

    // Fish swims toward bait in cycles
    const cycle = elapsed % 5;
    if (cycle < 3) {
      // Approach
      const t = cycle / 3;
      fishGroup.position.x = -0.35 + t * 0.3;
      fishGroup.position.y = -0.15 + Math.sin(t * Math.PI) * 0.03;
      // Tail wag
      fishGroup.rotation.z = Math.sin(elapsed * 8) * 0.1;
    } else if (cycle < 3.5) {
      // Bite! Quick jerk up
      const t = (cycle - 3) / 0.5;
      fishGroup.position.x = -0.05;
      fishGroup.position.y = -0.15 + t * 0.03;
    } else {
      // Retreat
      const t = (cycle - 3.5) / 1.5;
      fishGroup.position.x = -0.05 - t * 0.3;
      fishGroup.position.y = -0.15 - t * 0.05;
      fishGroup.rotation.z = Math.sin(elapsed * 6) * 0.15;
    }
  };

  return g;
}

/* ── Scanner (Probe) ─────────────────────────────────────────────── */

export function buildScanner(): THREE.Group {
  const g = new THREE.Group();
  let elapsed = 0;

  // Scanning beam
  const beamGeo = new THREE.PlaneGeometry(0.02, 0.8);
  const beamMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  g.add(beam);

  // Target ports (small boxes in a row)
  const ports: THREE.LineSegments[] = [];
  for (let i = 0; i < 8; i++) {
    const portGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
    const port = wireEdges(portGeo, CYAN, 0.3);
    port.position.set(0, -0.35 + i * 0.1, 0);
    ports.push(port);
    g.add(port);
  }

  g.userData.update = (delta: number) => {
    elapsed += delta;
    // Beam sweeps up and down
    const sweep = Math.sin(elapsed * 2) * 0.35;
    beam.position.y = sweep;

    // Highlight port being scanned
    const scanIdx = Math.floor(((Math.sin(elapsed * 2) + 1) / 2) * ports.length);
    ports.forEach((p, i) => {
      const mat = (p as THREE.LineSegments).material as THREE.LineBasicMaterial;
      mat.opacity = i === scanIdx ? 0.9 : 0.3;
      mat.color.setHex(i === scanIdx ? 0xffd600 : CYAN);
    });
  };

  return g;
}

/* ── Interceptor (Man-in-the-Middle) ─────────────────────────────── */

export function buildInterceptor(): THREE.Group {
  const g = new THREE.Group();
  let elapsed = 0;

  // Two endpoints
  const endGeo = new THREE.SphereGeometry(0.06, 8, 8);
  const left = wireEdges(endGeo, CYAN);
  left.position.x = -0.4;
  g.add(left);
  const right = wireEdges(endGeo.clone(), CYAN);
  right.position.x = 0.4;
  g.add(right);

  // Interceptor in the middle
  const midGeo = new THREE.OctahedronGeometry(0.07, 0);
  const mid = wireEdges(midGeo, MAGENTA);
  g.add(mid);

  // Data arcs (lines)
  const arcL = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.4, 0, 0), new THREE.Vector3(0, 0, 0)
  ]);
  const arcR = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.4, 0, 0)
  ]);
  const arcMatL = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.5 });
  const arcMatR = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.5 });
  g.add(new THREE.Line(arcL, arcMatL));
  g.add(new THREE.Line(arcR, arcMatR));

  // Copy indicator
  const copyGeo = new THREE.BoxGeometry(0.03, 0.03, 0.03);
  const copy = wireEdges(copyGeo, MAGENTA);
  copy.position.y = -0.15;
  g.add(copy);

  g.userData.update = (delta: number) => {
    elapsed += delta;
    mid.rotation.y = elapsed * 1.5;
    mid.rotation.x = Math.sin(elapsed) * 0.3;
    // Pulse arcs
    arcMatL.opacity = 0.3 + Math.abs(Math.sin(elapsed * 3)) * 0.4;
    arcMatR.opacity = 0.3 + Math.abs(Math.sin(elapsed * 3 + 1)) * 0.4;
    // Copy drops down periodically
    const copyT = (elapsed * 0.5) % 1;
    copy.position.y = -0.1 - copyT * 0.15;
    (copy.material as THREE.LineBasicMaterial).opacity = 1 - copyT;
  };

  return g;
}

/* ── Handshake (TCP) ─────────────────────────────────────────────── */

export function buildHandshake(): THREE.Group {
  const g = new THREE.Group();
  let elapsed = 0;

  // Two towers
  const towerGeo = new THREE.BoxGeometry(0.08, 0.2, 0.06);
  const towerL = wireEdges(towerGeo, CYAN);
  towerL.position.x = -0.3;
  g.add(towerL);
  const towerR = wireEdges(towerGeo.clone(), CYAN);
  towerR.position.x = 0.3;
  g.add(towerR);

  // Three packets
  const labels = ['SYN', 'SYN-ACK', 'ACK'];
  const packets: THREE.LineSegments[] = [];
  for (let i = 0; i < 3; i++) {
    const pktGeo = new THREE.BoxGeometry(0.06, 0.03, 0.03);
    const pkt = wireEdges(pktGeo, i === 1 ? AMBER : CYAN);
    pkt.visible = false;
    pkt.userData.step = i;
    packets.push(pkt);
    g.add(pkt);
  }

  g.userData.update = (delta: number) => {
    elapsed += delta;
    const cycle = elapsed % 4; // 4 second cycle

    packets.forEach((pkt) => {
      const step = pkt.userData.step;
      const startTime = step * 1.0;
      const t = (cycle - startTime) / 0.8;

      if (t >= 0 && t <= 1) {
        pkt.visible = true;
        const goRight = step % 2 === 0;
        pkt.position.x = goRight ? -0.3 + t * 0.6 : 0.3 - t * 0.6;
        pkt.position.y = Math.sin(t * Math.PI) * 0.12;
      } else {
        pkt.visible = false;
      }
    });
  };

  return g;
}

/* ── Resolver (DNS) ──────────────────────────────────────────────── */

export function buildResolver(): THREE.Group {
  const g = new THREE.Group();
  let elapsed = 0;

  // Chain of servers (progressively smaller)
  const servers: THREE.LineSegments[] = [];
  for (let i = 0; i < 4; i++) {
    const s = 0.12 - i * 0.02;
    const sGeo = new THREE.BoxGeometry(s, s * 1.5, s * 0.6);
    const srv = wireEdges(sGeo, CYAN, 0.4 + i * 0.15);
    srv.position.x = -0.35 + i * 0.25;
    servers.push(srv);
    g.add(srv);
  }

  // Query packet
  const qGeo = new THREE.SphereGeometry(0.02, 6, 6);
  const query = wireEdges(qGeo, AMBER);
  g.add(query);

  g.userData.update = (delta: number) => {
    elapsed += delta;
    const cycle = elapsed % 3;
    const segment = Math.floor(cycle);
    const t = cycle - segment;

    if (segment < 3) {
      query.visible = true;
      query.position.x = -0.35 + segment * 0.25 + t * 0.25;
      query.position.y = Math.sin(t * Math.PI) * 0.1;
    } else {
      query.visible = false;
    }
  };

  return g;
}

/* ── Factory ─────────────────────────────────────────────────────── */

export function buildMascot(type: string): THREE.Group {
  switch (type) {
    case 'battering_ram': return buildBatteringRam();
    case 'swarm': return buildSwarm();
    case 'briefcase': return buildBriefcase();
    case 'hook': return buildHook();
    case 'scanner': return buildScanner();
    case 'interceptor': return buildInterceptor();
    case 'handshake': return buildHandshake();
    case 'resolver': return buildResolver();
    default: {
      // Fallback: spinning wireframe octahedron
      const g = new THREE.Group();
      const geo = new THREE.OctahedronGeometry(0.15, 0);
      g.add(wireEdges(geo, CYAN));
      g.userData.update = (delta: number) => { g.rotation.y += delta; };
      return g;
    }
  }
}
