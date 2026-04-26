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
      injectRegister: 'auto',
      filename: 'sw.js',
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'Tournament',
        short_name: 'Tournament',
        description: 'Multi-course golf tournament scorer',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        // Static assets only — the API is intentionally NOT cached by the
        // service worker. The original T1-3 scaffold included a
        // NetworkFirst rule for /api/* with networkTimeoutSeconds: 3. Two
        // bugs verified in production 2026-04-26:
        //   1. OAuth callback (302 with Set-Cookie) does not round-trip
        //      cleanly through workbox's cache-aware fetch wrapper — the
        //      browser saw a stale "Not Found" instead of the redirect.
        //   2. T2-3 vision parse-pdf takes 10-15s; 3s networkTimeoutSeconds
        //      would force a fallback to (empty) cache mid-flight on every
        //      organizer upload.
        // Apps that want client-side API caching should do it at the
        // TanStack Query layer (already in deps), not in the SW.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}', '**/*.webmanifest'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
