import { createRootRoute, Outlet, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';

export const Route = createRootRoute({
  component: RootComponent,
});

function getInitialDark(): boolean {
  const stored = localStorage.getItem('dark-mode');
  if (stored !== null) return stored === 'true';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function RootComponent() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isDark, setIsDark] = useState(getInitialDark);

  // Apply dark class whenever isDark changes
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    // Online / offline
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Follow OS preference only when no manual override
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onOsChange = (e: MediaQueryListEvent) => {
      if (localStorage.getItem('dark-mode') === null) {
        setIsDark(e.matches);
      }
    };
    mq.addEventListener('change', onOsChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      mq.removeEventListener('change', onOsChange);
    };
  }, []);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem('dark-mode', String(next));
  };

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-background text-foreground">
      {/* Faint watermark */}
      <div
        className="fixed inset-0 flex items-center justify-center pointer-events-none select-none z-0"
        aria-hidden="true"
      >
        <span className="text-[35vw] opacity-[0.02]">🍑</span>
      </div>

      {/* Green broadcast accent bar */}
      <div className="h-[3px] shrink-0 bg-gradient-to-r from-green-800 via-green-500 to-green-800" />

      {/* App header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-2">
        <div className="flex items-center justify-between">
          {/* Brand */}
          <Link to="/" className="flex items-center gap-2 group">
            <span className="text-xl leading-none group-hover:scale-110 transition-transform">🐺</span>
            <div className="leading-tight">
              <span className="text-base font-black tracking-tight">Wolf Cup</span>
            </div>
          </Link>

          {/* Right side: dark toggle + offline + AssTV */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleDark}
              className="text-sm leading-none hover:opacity-70 transition-opacity"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle dark mode"
            >
              {isDark ? '☀️' : '🌙'}
            </button>
            {!isOnline && (
              <span
                aria-live="assertive"
                aria-atomic="true"
                className="flex items-center gap-1 text-xs text-destructive font-semibold"
              >
                <span className="h-2 w-2 rounded-full bg-destructive inline-block animate-pulse" />
                Offline
              </span>
            )}
            {/* AssTV logo block */}
            <div className="flex flex-col items-end select-none leading-none">
              <span className="text-sm font-black tracking-tight">
                <span className="text-foreground/60">Ass</span>
                <span className="text-red-500">TV</span>
                <span className="ml-0.5 text-sm">🍑</span>
              </span>
              <span className="text-[8px] text-muted-foreground/40 font-semibold tracking-[0.15em] uppercase">
                Network
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* AssTV footer watermark */}
      <div className="relative z-10 text-center py-0.5 text-[9px] text-muted-foreground/20 select-none tracking-widest uppercase">
        ® Appalachian Sports Station
      </div>

      {/* Mobile bottom nav */}
      <nav className="shrink-0 border-t border-border/60 bg-background/95 backdrop-blur-sm grid grid-cols-5">
        {(
          [
            { to: '/' as const, icon: '🏆', label: 'Board' },
            { to: '/standings' as const, icon: '📊', label: 'Standings' },
            { to: '/attendance' as const, icon: '📋', label: 'Attend' },
            { to: '/score-entry' as const, icon: '⛳', label: 'Score' },
            { to: '/stats' as const, icon: '📈', label: 'Stats' },
          ] as const
        ).map(({ to, icon, label }) => (
          <Link
            key={to}
            to={to}
            className={[
              'relative flex flex-col items-center pt-2 pb-3 text-[11px] font-medium',
              'text-muted-foreground transition-colors',
              '[&.active]:text-green-600',
              // Top indicator bar
              'after:absolute after:top-0 after:left-4 after:right-4 after:h-[2px]',
              'after:rounded-b-full after:bg-green-500',
              'after:scale-x-0 [&.active]:after:scale-x-100',
              'after:transition-transform after:duration-200',
            ].join(' ')}
          >
            <span className="text-[18px] mb-0.5 leading-none">{icon}</span>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
