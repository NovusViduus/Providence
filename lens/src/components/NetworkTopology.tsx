import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { getCategoryColor } from '../utils/geoip';
import type { SecurityEvent } from '../types/events';

interface Node {
  id: string;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  color: string;
  icon: string;
  radius: number;
  pulse?: boolean;
}

interface Edge {
  from: string;
  to: string;
  label: string;
  dashed?: boolean;
}

interface Particle {
  fromId: string;
  toId: string;
  progress: number;
  speed: number;
  color: number;
  category: string;
}

const NODES: Node[] = [
  { id: 'attacker', label: 'Attackers', sublabel: 'Global', x: 0.08, y: 0.5, color: '#ff1744', icon: '💀', radius: 28, pulse: true },
  { id: 'lure-us', label: 'LURE-SSH-US', sublabel: 'Virginia (4x A100)', x: 0.28, y: 0.18, color: '#ff6d00', icon: '🍯', radius: 24 },
  { id: 'lure-eu', label: 'LURE-WEB-EU', sublabel: 'Dublin (Fintech)', x: 0.28, y: 0.5, color: '#ff6d00', icon: '🍯', radius: 24 },
  { id: 'lure-ap', label: 'LURE-DB-AP', sublabel: 'Singapore (H100)', x: 0.28, y: 0.82, color: '#ff6d00', icon: '🍯', radius: 24 },
  { id: 'eye', label: 'The Eye', sublabel: 'C++ Capture', x: 0.48, y: 0.5, color: '#0A9396', icon: '👁', radius: 26 },
  { id: 'ml', label: 'ML Service', sublabel: 'LightGBM 47µs', x: 0.48, y: 0.18, color: '#F7931E', icon: '🧠', radius: 22 },
  { id: 'citadel', label: 'The Citadel', sublabel: 'Spring Boot', x: 0.68, y: 0.5, color: '#5382a1', icon: '🏰', radius: 30 },
  { id: 'postgres', label: 'PostgreSQL', sublabel: 'Events + Incidents', x: 0.68, y: 0.18, color: '#336791', icon: '🐘', radius: 20 },
  { id: 'redis', label: 'Redis', sublabel: 'Pub/Sub + Cache', x: 0.68, y: 0.82, color: '#dc382d', icon: '⚡', radius: 20 },
  { id: 'lens', label: 'The Lens', sublabel: 'React + Three.js', x: 0.88, y: 0.5, color: '#61DAFB', icon: '🔭', radius: 26 },
  { id: 'firewall', label: 'Firewall', sublabel: 'iptables/pfctl', x: 0.88, y: 0.82, color: '#ff1744', icon: '🛡', radius: 20 },
  { id: 'oracle', label: 'The Oracle', sublabel: 'AWS Logs', x: 0.88, y: 0.18, color: '#3776AB', icon: '🔮', radius: 22 },
];

const EDGES: Edge[] = [
  { from: 'attacker', to: 'lure-us', label: 'SSH' },
  { from: 'attacker', to: 'lure-eu', label: 'SSH' },
  { from: 'attacker', to: 'lure-ap', label: 'SSH' },
  { from: 'lure-us', to: 'eye', label: 'packets' },
  { from: 'lure-eu', to: 'eye', label: 'packets' },
  { from: 'lure-ap', to: 'eye', label: 'packets' },
  { from: 'eye', to: 'ml', label: 'gRPC' },
  { from: 'ml', to: 'eye', label: 'classify', dashed: true },
  { from: 'eye', to: 'citadel', label: 'gRPC' },
  { from: 'citadel', to: 'postgres', label: 'JPA' },
  { from: 'citadel', to: 'redis', label: 'pub/sub' },
  { from: 'citadel', to: 'lens', label: 'WebSocket' },
  { from: 'citadel', to: 'firewall', label: 'ACT' },
  { from: 'oracle', to: 'citadel', label: 'REST' },
];

export default function NetworkTopology() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`;
  const { events } = useWebSocket(wsUrl);
  const particlesRef = useRef<Particle[]>([]);
  const lastEventCount = useRef(0);
  const [stats, setStats] = useState({ total: 0, act: 0, recommend: 0, observe: 0 });

  // Spawn particles when new events arrive
  useEffect(() => {
    if (events.length <= lastEventCount.current) return;
    const newEvents = events.slice(0, events.length - lastEventCount.current);
    lastEventCount.current = events.length;

    for (const evt of newEvents) {
      const color = getCategoryColor(evt.category);
      // Attacker -> honeypot -> eye -> citadel -> lens
      const honeypot = evt.destPort === 22 || evt.destPort === 2222 ? 'lure-us' :
        evt.destPort === 23 ? 'lure-eu' : 'lure-ap';

      particlesRef.current.push(
        { fromId: 'attacker', toId: honeypot, progress: 0, speed: 0.8 + Math.random() * 0.4, color, category: evt.category },
      );
      // Delayed chain
      setTimeout(() => {
        particlesRef.current.push(
          { fromId: honeypot, toId: 'eye', progress: 0, speed: 1.2, color, category: evt.category },
        );
      }, 600);
      setTimeout(() => {
        particlesRef.current.push(
          { fromId: 'eye', toId: 'ml', progress: 0, speed: 1.5, color, category: evt.category },
          { fromId: 'eye', toId: 'citadel', progress: 0, speed: 1.0, color, category: evt.category },
        );
      }, 1200);
      setTimeout(() => {
        particlesRef.current.push(
          { fromId: 'citadel', toId: 'lens', progress: 0, speed: 1.2, color, category: evt.category },
        );
        if (evt.responseTier === 'ACT') {
          particlesRef.current.push(
            { fromId: 'citadel', toId: 'firewall', progress: 0, speed: 0.8, color: 0xff1744, category: 'BLOCK' },
          );
        }
      }, 1800);

      setStats(s => ({
        total: s.total + 1,
        act: s.act + (evt.responseTier === 'ACT' ? 1 : 0),
        recommend: s.recommend + (evt.responseTier === 'RECOMMEND' ? 1 : 0),
        observe: s.observe + (evt.responseTier === 'OBSERVE' ? 1 : 0),
      }));
    }
  }, [events.length]);

  // Also spawn ambient particles so the graph isn't static
  useEffect(() => {
    const id = setInterval(() => {
      if (events.length > 0) return; // live data handles it
      const paths = [
        ['attacker', 'lure-us'], ['attacker', 'lure-eu'], ['attacker', 'lure-ap'],
        ['lure-us', 'eye'], ['eye', 'citadel'], ['citadel', 'lens'],
        ['oracle', 'citadel'],
      ];
      const [from, to] = paths[Math.floor(Math.random() * paths.length)];
      particlesRef.current.push({
        fromId: from, toId: to, progress: 0,
        speed: 0.6 + Math.random() * 0.6,
        color: 0x0A9396, category: 'ambient',
      });
    }, 1500);
    return () => clearInterval(id);
  }, [events.length]);

  // Canvas render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.parentElement!.clientWidth;
      canvas.height = canvas.parentElement!.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let animId: number;

    function getNodePos(id: string) {
      const node = NODES.find(n => n.id === id)!;
      return { x: node.x * canvas!.width, y: node.y * canvas!.height };
    }

    function draw() {
      animId = requestAnimationFrame(draw);
      const W = canvas!.width;
      const H = canvas!.height;
      ctx!.clearRect(0, 0, W, H);

      const t = performance.now() / 1000;

      // Draw edges
      for (const edge of EDGES) {
        const from = getNodePos(edge.from);
        const to = getNodePos(edge.to);
        ctx!.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx!.lineWidth = 1;
        if (edge.dashed) ctx!.setLineDash([4, 4]);
        else ctx!.setLineDash([]);
        ctx!.beginPath();
        ctx!.moveTo(from.x, from.y);
        ctx!.lineTo(to.x, to.y);
        ctx!.stroke();
        ctx!.setLineDash([]);

        // Edge label at midpoint
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        ctx!.fillStyle = 'rgba(255,255,255,0.08)';
        ctx!.font = '9px monospace';
        ctx!.textAlign = 'center';
        ctx!.fillText(edge.label, mx, my - 4);
      }

      // Draw particles
      const alive: Particle[] = [];
      for (const p of particlesRef.current) {
        p.progress += 0.016 * p.speed;
        if (p.progress > 1) continue;
        alive.push(p);

        const from = getNodePos(p.fromId);
        const to = getNodePos(p.toId);
        const px = from.x + (to.x - from.x) * p.progress;
        const py = from.y + (to.y - from.y) * p.progress;

        const r = (p.color >> 16) & 0xff;
        const g = (p.color >> 8) & 0xff;
        const b = p.color & 0xff;

        // Glow
        ctx!.beginPath();
        ctx!.arc(px, py, 6, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${r},${g},${b},0.15)`;
        ctx!.fill();

        // Core
        ctx!.beginPath();
        ctx!.arc(px, py, 3, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${r},${g},${b},0.9)`;
        ctx!.fill();
      }
      particlesRef.current = alive;

      // Draw nodes
      for (const node of NODES) {
        const x = node.x * W;
        const y = node.y * H;
        const r = node.radius;

        // Pulse ring for attacker node
        if (node.pulse) {
          const pulse = (Math.sin(t * 2) + 1) / 2;
          ctx!.beginPath();
          ctx!.arc(x, y, r + 8 + pulse * 6, 0, Math.PI * 2);
          ctx!.strokeStyle = `rgba(255,23,68,${0.1 + pulse * 0.1})`;
          ctx!.lineWidth = 1;
          ctx!.stroke();
        }

        // Node circle
        ctx!.beginPath();
        ctx!.arc(x, y, r, 0, Math.PI * 2);
        ctx!.fillStyle = '#0C1017';
        ctx!.fill();
        ctx!.strokeStyle = node.color + '60';
        ctx!.lineWidth = 1.5;
        ctx!.stroke();

        // Icon
        ctx!.font = `${r * 0.8}px serif`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';
        ctx!.fillText(node.icon, x, y);

        // Label
        ctx!.font = '11px -apple-system, sans-serif';
        ctx!.fillStyle = '#e5e7eb';
        ctx!.textBaseline = 'top';
        ctx!.fillText(node.label, x, y + r + 6);

        // Sublabel
        ctx!.font = '9px monospace';
        ctx!.fillStyle = '#6b7280';
        ctx!.fillText(node.sublabel, x, y + r + 20);
      }
    }

    animId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-200">Network Topology</h2>
          <p className="text-xs text-gray-500">Live data flow through the Providence infrastructure</p>
        </div>
        <div className="flex gap-4 text-xs">
          <div className="text-center"><p className="text-gray-200 font-mono">{stats.total}</p><p className="text-[9px] text-gray-600">Events</p></div>
          <div className="text-center"><p className="text-red-400 font-mono">{stats.act}</p><p className="text-[9px] text-gray-600">ACT</p></div>
          <div className="text-center"><p className="text-yellow-400 font-mono">{stats.recommend}</p><p className="text-[9px] text-gray-600">REC</p></div>
          <div className="text-center"><p className="text-gray-400 font-mono">{stats.observe}</p><p className="text-[9px] text-gray-600">OBS</p></div>
        </div>
      </div>
      <div className="bg-providence-surface border border-providence-border rounded-lg overflow-hidden" style={{ height: 550 }}>
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>
    </div>
  );
}
