import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from './lib/query-client';
import { createAppRouter } from './router';
import { initTheme } from './lib/theme';
import './index.css';

// Apply stored theme + keep "system" mode in sync with OS changes. The
// initial .dark class is already set by the inline script in index.html (no
// flash); this attaches the runtime listener.
initTheme();

const router = createAppRouter();

// Type registration — required for TanStack Router type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* Dev-only — the floating devtools button must never ship (it was
          appearing on every screen in production builds). */}
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  </StrictMode>,
);
