import { memo, useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Shield, Activity, AlertTriangle, Globe, BookOpen, BarChart3, LogOut, User, Monitor, Newspaper, Layers, Clock, Crosshair, Menu, X, Skull, Fingerprint, Terminal, Network, Bot, ChevronDown, BarChart2, FileText } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useIdleTimer } from '../hooks/useIdleTimer';
import { getRole, isAdmin, logout } from '../services/auth';
import { usePageTitle } from '../hooks/usePageTitle';
import { useDemoMode, DEMO_SCREENSAVER_EVENT } from '../hooks/useDemoMode';
import EyeOfProvidence from './EyeOfProvidence';
import Screensaver from './Screensaver';
import MusicPlayer from './MusicPlayer';
import NotificationBell from './NotificationBell';

const NAV_SECTIONS = [
  {
    label: null,
    items: [
      { to: '/', icon: BarChart3, label: 'Dashboard' },
      { to: '/briefing', icon: Bot, label: 'Briefing' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/events', icon: Activity, label: 'Events' },
      { to: '/attackers', icon: Skull, label: 'Attackers' },
      { to: '/clusters', icon: Fingerprint, label: 'Clusters' },
      { to: '/sessions', icon: Terminal, label: 'Sessions' },
      { to: '/incidents', icon: AlertTriangle, label: 'Incidents' },
      { to: '/responses', icon: Shield, label: 'Responses' },
    ],
  },
  {
    label: 'Visualization',
    items: [
      { to: '/threats', icon: Globe, label: 'Threat Map' },
      { to: '/timelapse', icon: Clock, label: 'Timelapse' },
      { to: '/topology', icon: Network, label: 'Topology' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { to: '/codex', icon: BookOpen, label: 'Codex' },
      { to: '/heatmap', icon: BarChart2, label: 'Cmd Heatmap' },
      { to: '/playbooks', icon: Crosshair, label: 'Playbooks' },
      { to: '/news', icon: Newspaper, label: 'News' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/reports', icon: FileText, label: 'Reports' },
      { to: '/stack', icon: Layers, label: 'Tech Stack' },
      { to: '/about', icon: User, label: 'About' },
    ],
  },
];

const PersistentEye = memo(function PersistentEye() {
  return <EyeOfProvidence size={52} trackMouse />;
});

function NavSection({ section, pathname, onNavigate }: {
  section: typeof NAV_SECTIONS[number];
  pathname: string;
  onNavigate: () => void;
}) {
  // Sections without a label (top-level) are always open
  const hasActiveChild = section.items.some(i => pathname === i.to || pathname.startsWith(i.to + '/'));
  const [open, setOpen] = useState(!section.label || hasActiveChild);

  // Auto-open when navigating into a collapsed section
  useEffect(() => {
    if (hasActiveChild && !open) setOpen(true);
  }, [hasActiveChild]);

  return (
    <div>
      {section.label ? (
        <button onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between px-4 pt-3 pb-1 group">
          <span className="text-[9px] text-steel-400 uppercase tracking-[0.15em] group-hover:text-steel-300 transition-colors">
            {section.label}
          </span>
          <ChevronDown size={10} className={`text-steel-400 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
      ) : null}
      {(open || !section.label) && section.items.map(({ to, icon: Icon, label }) => (
        <NavLink key={to} to={to} end={to === '/'} onClick={onNavigate}
          className={({ isActive }) =>
            `relative flex items-center gap-3 px-4 py-2 text-sm transition-all ${
              isActive
                ? 'text-providence-accent-bright bg-[#0A939618]'
                : 'text-steel-200 hover:text-steel-100 hover:bg-[#FFFFFF06]'
            }`
          }>
          {({ isActive }) => (
            <>
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-providence-accent" />
              )}
              <Icon size={14} strokeWidth={isActive ? 2 : 1.5} />
              <span className={isActive ? 'font-medium' : ''}>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}

export default function Layout() {
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`;
  const { connected, events: liveEvents } = useWebSocket(wsUrl);
  const role = getRole();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  usePageTitle();
  // Remount the sidebar eye when leaving pages with heavy WebGL usage
  // (About, Codex, Threats, Timelapse) so it recovers from context loss.
  const eyeKey = `eye-${pathname}`;

  // Screensaver after 3 minutes idle (skip during timelapse playback)
  const idle = useIdleTimer(180_000);
  const [dismissed, setDismissed] = useState(false);
  const [forceScreensaver, setForceScreensaver] = useState(false);
  const showScreensaver = (idle && !dismissed && pathname !== '/timelapse') || forceScreensaver;

  // Demo kiosk mode
  const demo = useDemoMode(navigate);

  // Listen for demo mode screensaver control
  useEffect(() => {
    const handler = (e: Event) => {
      const show = (e as CustomEvent).detail?.show;
      setForceScreensaver(show);
      if (!show) setDismissed(true);
    };
    window.addEventListener(DEMO_SCREENSAVER_EVENT, handler);
    return () => window.removeEventListener(DEMO_SCREENSAVER_EVENT, handler);
  }, []);

  // Mobile sidebar
  const [mobileNav, setMobileNav] = useState(false);

  // Reset dismissed flag when user goes idle again
  if (!idle && dismissed) setDismissed(false);

  return (
    <div className="flex h-screen bg-providence-bg">
      {/* CRT effects */}
      <div className="crt-scanline" />
      <div className="crt-vignette" />

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-12 bg-providence-surface border-b border-providence-border flex items-center justify-between px-4 z-40">
        <button onClick={() => setMobileNav(true)} className="text-gray-400">
          <Menu size={20} />
        </button>
        <span className="text-xs font-bold text-providence-accent-bright tracking-[0.15em]">PROVIDENCE</span>
        <div className="flex items-center gap-3">
          <NotificationBell events={liveEvents} />
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileNav && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setMobileNav(false)} />
      )}

      {/* Sidebar */}
      <nav className={`
        w-56 bg-providence-surface border-r border-providence-border flex flex-col relative overflow-hidden
        fixed md:static inset-y-0 left-0 z-50
        transition-transform duration-200
        ${mobileNav ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Mobile close button */}
        <button onClick={() => setMobileNav(false)} className="md:hidden absolute top-3 right-3 text-gray-500 z-10">
          <X size={18} />
        </button>

        {/* Subtle scan line effect */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-[0.03]">
          <div className="w-full h-px bg-providence-accent sidebar-scan" />
        </div>

        {/* Eye + Brand */}
        <div className="p-4 border-b border-providence-border flex flex-col items-center">
          <PersistentEye key={eyeKey} />
          <h1 className="text-sm font-bold text-providence-accent-bright tracking-[0.15em] mt-1">PROVIDENCE</h1>
          <p className="text-[9px] text-gray-600 tracking-[0.2em]">THE LENS</p>
          {liveEvents.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] font-mono text-gray-400">
                {liveEvents.length.toLocaleString()} <span className="text-gray-600">live events</span>
              </span>
            </div>
          )}
        </div>

        {/* Nav links */}
        <div className="flex-1 py-1 overflow-y-auto panel-scroll">
          {NAV_SECTIONS.map((section, si) => (
            <NavSection key={si} section={section} pathname={pathname} onNavigate={() => setMobileNav(false)} />
          ))}
        </div>

        {/* Music player */}
        <MusicPlayer />

        {/* Footer */}
        <div className="p-4 border-t border-providence-border space-y-2">
          {isAdmin() && (
            <>
              <button onClick={() => setForceScreensaver(true)}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-providence-accent transition-colors w-full">
                <Monitor size={14} /> Screensaver
              </button>
              <button onClick={() => demo.active ? demo.stop() : demo.start()}
                className={`flex items-center gap-2 text-sm w-full transition-colors ${
                  demo.active ? 'text-providence-accent' : 'text-gray-500 hover:text-providence-accent'
                }`}>
                <Globe size={14} /> {demo.active ? 'Stop Demo' : 'Demo Mode'}
              </button>
            </>
          )}
          <button onClick={logout} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors">
            <LogOut size={14} /> Sign out
          </button>
          <p className="text-[9px] text-gray-700 mt-1 tracking-wider">v1.0.0</p>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden pt-12 md:pt-0">
        {/* Header bar (hidden on mobile, replaced by fixed mobile header) */}
        <header className="hidden md:flex h-11 border-b border-providence-border items-center justify-between px-4 bg-providence-surface/30">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500 live-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">
              {connected ? 'Live Feed' : 'Disconnected'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell events={liveEvents} />
            <span className="text-[10px] text-gray-600 font-mono">
              {new Date().toISOString().slice(0, 10)}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-providence-accent/10 text-providence-accent/80 uppercase tracking-wider">
              {role}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-3 md:p-6 content-noise">
          <Outlet />
        </main>
      </div>

      {/* Screensaver overlay */}
      {showScreensaver && <Screensaver onDismiss={() => { setDismissed(true); setForceScreensaver(false); }} />}

      <style>{`
        @keyframes nav-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .nav-pulse {
          animation: nav-pulse 2s ease-in-out infinite;
        }
        @keyframes live-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
          50% { opacity: 0.7; box-shadow: 0 0 0 3px rgba(34,197,94,0); }
        }
        .live-pulse {
          animation: live-pulse 2s ease-in-out infinite;
        }
        @keyframes sidebar-scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(5000%); }
        }
        .sidebar-scan {
          animation: sidebar-scan 8s linear infinite;
        }
      `}</style>
    </div>
  );
}
