import { useEffect, useRef, useState, useCallback } from 'react';

const DEMO_ROUTES: { path: string; duration: number }[] = [
  { path: '/',                   duration: 15_000 },  // Dashboard
  { path: '/events',             duration: 12_000 },  // Events
  { path: '/attackers',          duration: 12_000 },  // Attackers
  { path: '/threats',            duration: 30_000 },  // Threat Map (interactive)
  { path: '/timelapse?autoplay', duration: 45_000 },  // Timelapse (long, interactive)
  { path: '/topology',           duration: 15_000 },  // Network Topology
  { path: '/clusters',           duration: 12_000 },  // Behavior Clusters
  { path: '/sessions',           duration: 20_000 },  // Session Replays
  { path: '/codex',              duration: 15_000 },  // Codex
  { path: '/heatmap',            duration: 12_000 },  // Command Heatmap
  { path: '/briefing',           duration: 20_000 },  // Threat Briefing (typewriter)
  { path: '/news',               duration: 10_000 },  // News
  { path: '/stack',              duration: 12_000 },  // Tech Stack
  { path: '/about',              duration: 12_000 },  // About
];

export function useDemoMode(navigate: (path: string) => void) {
  const [active, setActive] = useState(false);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const start = useCallback(() => {
    indexRef.current = 0;
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!active) return;

    function goToNext() {
      const route = DEMO_ROUTES[indexRef.current];
      navigateRef.current(route.path);

      timerRef.current = setTimeout(() => {
        indexRef.current = (indexRef.current + 1) % DEMO_ROUTES.length;
        goToNext();
      }, route.duration);
    }

    goToNext();
    return () => clearTimeout(timerRef.current);
  }, [active]);

  return { active, start, stop };
}
