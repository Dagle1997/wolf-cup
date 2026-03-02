import { createRootRoute, Outlet, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      {/* Faint watermark — behind all content */}
      <div
        className="fixed inset-0 flex items-center justify-center pointer-events-none select-none z-0"
        aria-hidden="true"
      >
        <span className="text-[35vw] opacity-[0.025]">🍑</span>
      </div>

      {/* App header */}
      <header className="sticky top-0 z-50 bg-background border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-lg font-bold">🐺 Wolf Cup</Link>
          <div className="flex items-center gap-3">
            <div aria-live="assertive" aria-atomic="true">
              {!isOnline && (
                <span className="flex items-center gap-1 text-xs text-destructive font-medium">
                  <span className="h-2 w-2 rounded-full bg-destructive inline-block" />
                  Offline
                </span>
              )}
            </div>
            {/* AssTV logo */}
            <span className="text-xs font-black select-none leading-none">
              <span className="text-foreground/70">Ass</span><span className="text-red-600/80">TV</span>
              <span className="ml-0.5 text-[11px]">🍑</span>
            </span>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* AssTV watermark footer */}
      <div className="relative z-10 text-center py-0.5 text-[10px] text-muted-foreground/25 select-none tracking-wide">
        ® Registered Product of Appalachian Sports Station
      </div>

      {/* Mobile bottom nav */}
      <nav className="sticky bottom-0 border-t bg-background grid grid-cols-4 divide-x">
        <Link to="/" className="flex flex-col items-center py-3 text-xs [&.active]:font-bold">
          <span>🏆</span>Leaderboard
        </Link>
        <Link to="/standings" className="flex flex-col items-center py-3 text-xs [&.active]:font-bold">
          <span>📊</span>Standings
        </Link>
        <Link to="/score-entry" className="flex flex-col items-center py-3 text-xs [&.active]:font-bold">
          <span>⛳</span>Score
        </Link>
        <Link to="/stats" className="flex flex-col items-center py-3 text-xs [&.active]:font-bold">
          <span>📈</span>Stats
        </Link>
      </nav>
    </div>
  );
}
