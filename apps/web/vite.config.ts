import { defineConfig } from 'vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    // TanStack Router MUST be first (generates routeTree.gen.ts before React transform)
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'Wolf Cup',
        short_name: 'Wolf Cup',
        description: 'Harvey Cup Golf League Scorer',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1a1a1a',
        background_color: '#ffffff',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          { name: 'Admin Panel', url: '/admin', description: 'Manage rounds, roster, and scores' },
          { name: 'Practice Round', url: '/practice', description: 'Start a practice round' },
        ],
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        // Static assets only — the API is intentionally NOT cached by the
        // service worker. The original scaffold included a NetworkFirst rule
        // for /api/* with networkTimeoutSeconds: 3. On a slow course
        // connection that timeout would force a fallback to the cached
        // (often stale) GET response, which then convinced score-entry that
        // no holes had been entered yet — initialising currentHole to 1 and
        // trapping the scorer with both Prev and Next disabled (verified
        // 2026-04-24 round). TanStack Query + the IndexedDB offline queue
        // already handle offline-first correctness with explicit invalidation;
        // SW caching of /api/* added nothing and masked writes.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,pdf}'],
        globIgnores: ['**/icon-*.png'],
        navigateFallbackDenylist: [/\.pdf$/i],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
