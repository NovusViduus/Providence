import { useEffect, useState, useRef, useCallback } from 'react';
import EyeOfProvidence from './EyeOfProvidence';

/* ── Attack types that fall from the top ─────────────────────── */
const ATTACK_TYPES = [
  { name: 'BRUTE FORCE', color: '#ff6d00', shape: 'ram' },
  { name: 'DDoS', color: '#ff1744', shape: 'swarm' },
  { name: 'EXFILTRATION', color: '#b388ff', shape: 'briefcase' },
  { name: 'PROBE', color: '#ffd600', shape: 'scanner' },
  { name: 'INJECTION', color: '#ff6d00', shape: 'hook' },
];

interface FallingEnemy {
  id: number;
  x: number;
  y: number;
  speed: number;
  type: typeof ATTACK_TYPES[number];
  alive: boolean;
  rotation: number;
  rotSpeed: number;
  size: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

/* ── Draw wireframe shapes ───────────────────────────────────── */
function drawWireframeShape(ctx: CanvasRenderingContext2D, e: FallingEnemy) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.rotation);
  ctx.strokeStyle = e.type.color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  const s = e.size;

  switch (e.type.shape) {
    case 'ram': // brute force, hammer
      // Handle
      ctx.beginPath();
      ctx.moveTo(0, s * 0.8); ctx.lineTo(0, -s * 0.15);
      ctx.stroke();
      // Head block
      ctx.beginPath();
      ctx.rect(-s * 0.45, -s * 0.55, s * 0.9, s * 0.4);
      ctx.stroke();
      // Head bevel lines
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, -s * 0.35); ctx.lineTo(-s * 0.3, -s * 0.35);
      ctx.moveTo(s * 0.45, -s * 0.35); ctx.lineTo(s * 0.3, -s * 0.35);
      ctx.stroke();
      break;
    case 'swarm': // DDoS, cluster of small circles
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const r = s * 0.4;
        ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, s * 0.2, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, s * 0.15, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'briefcase': // exfiltration, rectangle with handle
      ctx.strokeRect(-s * 0.5, -s * 0.3, s, s * 0.7);
      ctx.beginPath(); ctx.arc(0, -s * 0.3, s * 0.25, Math.PI, 0); ctx.stroke();
      break;
    case 'scanner': // probe, radar dish with sweep line
      // Inner ring
      ctx.beginPath();
      ctx.arc(0, s * 0.1, s * 0.25, 0, Math.PI * 2);
      ctx.stroke();
      // Center dot
      ctx.beginPath();
      ctx.arc(0, s * 0.1, s * 0.06, 0, Math.PI * 2);
      ctx.stroke();
      // Antenna stalk
      ctx.beginPath();
      ctx.moveTo(0, s * 0.35); ctx.lineTo(0, s * 0.75);
      ctx.stroke();
      // Base tripod
      ctx.beginPath();
      ctx.moveTo(0, s * 0.75); ctx.lineTo(-s * 0.35, s * 0.95);
      ctx.moveTo(0, s * 0.75); ctx.lineTo(s * 0.35, s * 0.95);
      ctx.moveTo(0, s * 0.75); ctx.lineTo(0, s * 0.95);
      ctx.stroke();
      // Sweep line (rotates with the enemy)
      ctx.beginPath();
      ctx.moveTo(0, s * 0.1);
      ctx.lineTo(s * 0.25 * Math.cos(-Math.PI * 0.3), s * 0.1 + s * 0.25 * Math.sin(-Math.PI * 0.3));
      ctx.stroke();
      // Signal waves
      for (let w = 1; w <= 3; w++) {
        ctx.beginPath();
        ctx.arc(0, -s * 0.15, s * 0.15 * w, -Math.PI * 0.7, -Math.PI * 0.3);
        ctx.stroke();
      }
      break;
    case 'hook': // injection, syringe
      // Barrel
      ctx.beginPath();
      ctx.rect(-s * 0.12, -s * 0.6, s * 0.24, s * 0.8);
      ctx.stroke();
      // Plunger handle
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.6); ctx.lineTo(s * 0.3, -s * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.6); ctx.lineTo(0, -s * 0.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, -s * 0.85); ctx.lineTo(s * 0.2, -s * 0.85);
      ctx.stroke();
      // Needle
      ctx.beginPath();
      ctx.moveTo(0, s * 0.2); ctx.lineTo(0, s * 0.7);
      ctx.stroke();
      // Tick marks on barrel
      for (let t = 0; t < 3; t++) {
        const ty = -s * 0.4 + t * s * 0.25;
        ctx.beginPath(); ctx.moveTo(-s * 0.12, ty); ctx.lineTo(-s * 0.25, ty); ctx.stroke();
      }
      break;
  }

  // Label
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = e.type.color;
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(e.type.name, 0, s + 14);

  ctx.restore();
}

export default function Screensaver({ onDismiss }: { onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const [time, setTime] = useState(new Date().toISOString().slice(11, 19));
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem('providence_screensaver_highscore');
    return saved ? parseInt(saved, 10) : 0;
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eyeRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    mouseX: 0,
    mouseY: 0,
    eyeCx: 0,
    eyeCy: 0,
    enemies: [] as FallingEnemy[],
    particles: [] as Particle[],
    nextId: 0,
    score: 0,
    spawnTimer: 0,
  });

  // Reset game state on mount
  useEffect(() => {
    stateRef.current.score = 0;
    stateRef.current.enemies = [];
    stateRef.current.particles = [];
    stateRef.current.spawnTimer = 0;
  }, []);

  // Fade in
  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Clock
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toISOString().slice(11, 19)), 1000);
    return () => clearInterval(id);
  }, []);

  // Mouse tracking
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    stateRef.current.mouseX = e.clientX;
    stateRef.current.mouseY = e.clientY;
  }, []);

  // Update eye center position, runs on animation frame to stay accurate
  useEffect(() => {
    let rafId: number;
    const update = () => {
      if (eyeRef.current) {
        const r = eyeRef.current.getBoundingClientRect();
        stateRef.current.eyeCx = r.left + r.width / 2;
        stateRef.current.eyeCy = r.top + r.height * 0.48;
      }
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Game loop on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let animId: number;
    let lastTime = performance.now();

    function loop(now: number) {
      animId = requestAnimationFrame(loop);
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const st = stateRef.current;
      const W = canvas!.width;
      const H = canvas!.height;
      ctx!.clearRect(0, 0, W, H);

      // ── Spawn enemies ──
      st.spawnTimer -= dt;
      if (st.spawnTimer <= 0) {
        st.spawnTimer = 1.5 + Math.random() * 2;
        const type = ATTACK_TYPES[Math.floor(Math.random() * ATTACK_TYPES.length)];
        st.enemies.push({
          id: st.nextId++,
          x: Math.max(40, Math.min(W - 40, 80 + Math.random() * (W - 160))),
          y: -40,
          speed: 30 + Math.random() * 40,
          type,
          alive: true,
          rotation: 0,
          rotSpeed: (Math.random() - 0.5) * 2,
          size: 18 + Math.random() * 10,
        });
      }

      // ── Vision cone geometry ──
      const { eyeCx, eyeCy, mouseX, mouseY } = st;
      const dx = mouseX - eyeCx;
      const dy = mouseY - eyeCy;
      const angle = Math.atan2(dy, dx);
      const coneDist = Math.hypot(dx, dy);
      const coneLen = Math.min(coneDist, 900);
      const coneHalfAngle = 0.22; // ~12.5 degrees each side

      // Draw cone
      if (coneLen > 40) {
        ctx!.save();
        ctx!.translate(eyeCx, eyeCy);

        // Filled cone
        ctx!.beginPath();
        ctx!.moveTo(0, 0);
        ctx!.lineTo(
          Math.cos(angle - coneHalfAngle) * coneLen,
          Math.sin(angle - coneHalfAngle) * coneLen
        );
        ctx!.lineTo(
          Math.cos(angle + coneHalfAngle) * coneLen,
          Math.sin(angle + coneHalfAngle) * coneLen
        );
        ctx!.closePath();
        const grad = ctx!.createRadialGradient(0, 0, 0, 0, 0, coneLen);
        grad.addColorStop(0, 'rgba(10,147,150,0.12)');
        grad.addColorStop(1, 'rgba(10,147,150,0)');
        ctx!.fillStyle = grad;
        ctx!.fill();

        // Edge lines
        ctx!.strokeStyle = 'rgba(10,147,150,0.1)';
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(0, 0);
        ctx!.lineTo(Math.cos(angle - coneHalfAngle) * coneLen, Math.sin(angle - coneHalfAngle) * coneLen);
        ctx!.moveTo(0, 0);
        ctx!.lineTo(Math.cos(angle + coneHalfAngle) * coneLen, Math.sin(angle + coneHalfAngle) * coneLen);
        ctx!.stroke();

        ctx!.restore();
      }

      // ── Update & draw enemies ──
      for (const e of st.enemies) {
        if (!e.alive) continue;
        e.y += e.speed * dt;
        e.rotation += e.rotSpeed * dt;

        // Check if inside vision cone
        if (coneLen > 40) {
          const ex = e.x - eyeCx;
          const ey = e.y - eyeCy;
          const eDist = Math.hypot(ex, ey);
          const eAngle = Math.atan2(ey, ex);
          let angleDiff = eAngle - angle;
          // Normalize to [-PI, PI]
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

          if (eDist < coneLen && Math.abs(angleDiff) < coneHalfAngle) {
            // HIT, spawn explosion particles
            e.alive = false;
            st.score++;
            setScore(st.score);
            if (st.score > parseInt(localStorage.getItem('providence_screensaver_highscore') || '0', 10)) {
              localStorage.setItem('providence_screensaver_highscore', String(st.score));
              setHighScore(st.score);
            }
            for (let p = 0; p < 20; p++) {
              const pa = Math.random() * Math.PI * 2;
              const pv = 60 + Math.random() * 120;
              st.particles.push({
                x: e.x, y: e.y,
                vx: Math.cos(pa) * pv,
                vy: Math.sin(pa) * pv,
                life: 0.6 + Math.random() * 0.4,
                color: e.type.color,
                size: 2 + Math.random() * 3,
              });
            }
          }
        }

        // Remove if off screen
        if (e.y > H + 60) { e.alive = false; continue; }

        drawWireframeShape(ctx!, e);
      }

      // Clean dead enemies
      st.enemies = st.enemies.filter(e => e.alive);

      // ── Update & draw particles ──
      for (const p of st.particles) {
        p.life -= dt;
        if (p.life <= 0) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 80 * dt; // gravity
        ctx!.globalAlpha = p.life;
        ctx!.fillStyle = p.color;
        ctx!.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx!.globalAlpha = 1;
      st.particles = st.particles.filter(p => p.life > 0);

      // ── Mouse crosshair ──
      if (coneLen > 40) {
        ctx!.strokeStyle = 'rgba(10,147,150,0.35)';
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.arc(mouseX, mouseY, 8, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.moveTo(mouseX - 12, mouseY); ctx!.lineTo(mouseX + 12, mouseY);
        ctx!.moveTo(mouseX, mouseY - 12); ctx!.lineTo(mouseX, mouseY + 12);
        ctx!.stroke();
      }
    }

    animId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 400);
  };

  return (
    <div
      onKeyDown={(e) => { if (e.key === 'Escape') handleDismiss(); }}
      onMouseMove={handleMouseMove}
      tabIndex={0}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-providence-bg transition-opacity duration-500 cursor-none select-none"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {/* Grid background */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(74,122,181,0.03) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Scan line */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-providence-accent/20 to-transparent ss-scan" />
      </div>

      {/* Game canvas, full screen, above background, below UI */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-10" />

      {/* Eye */}
      <div className="mb-6 z-20" ref={eyeRef}>
        <EyeOfProvidence size={200} trackMouse />
      </div>

      {/* Title */}
      <h1 className="text-4xl font-bold text-providence-accent-bright mb-1 tracking-wider z-20">
        PROVIDENCE
      </h1>
      <p className="text-xs text-gray-500 tracking-[0.3em] uppercase mb-2 z-20">
        Per Providentiam, Securitas
      </p>

      {/* HUD */}
      <div className="absolute top-5 left-6 z-20">
        <p className="text-[10px] text-gray-600 uppercase tracking-wider">High Score</p>
        <p className="text-lg font-mono font-bold text-providence-accent/70">{highScore}</p>
      </div>
      <div className="absolute top-5 left-1/2 -translate-x-1/2 z-20 text-center">
        <p className="text-sm font-mono text-gray-600">{time} UTC</p>
      </div>
      <div className="absolute top-5 right-6 z-20 text-right">
        <p className="text-[10px] text-gray-600 uppercase tracking-wider">Neutralized</p>
        <p className="text-lg font-mono font-bold text-providence-accent">{score}</p>
      </div>

      {/* Dismiss button */}
      <button onClick={handleDismiss}
        className="absolute bottom-6 text-[10px] text-gray-600 tracking-wider z-20 px-4 py-1.5 border border-providence-border/30 rounded hover:border-providence-accent/30 hover:text-gray-400 transition-colors"
        style={{ cursor: 'pointer' }}>
        Press ESC or click here to return
      </button>

      <style>{`
        @keyframes ss-scan {
          0% { transform: translateY(-100vh); }
          100% { transform: translateY(100vh); }
        }
        .ss-scan {
          animation: ss-scan 4s linear infinite;
        }
      `}</style>
    </div>
  );
}
