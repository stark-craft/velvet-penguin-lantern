import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND = 'http://127.0.0.1:8000';

const proxyPaths = [
  '/archive', '/crawl', '/latest-briefing', '/briefing', '/train',
  '/not-interested', '/workflow', '/sites', '/history/',
  '/track', '/status', '/analytics', '/profile', '/viewer', '/region', '/voc', '/insight',
  '/access-control', '/scheduler',
  '/gatekeeper', '/trends',
  '/translation',
  '/venture-lens',
  '/internal-content',
  '/export-ppt', '/export-excel', '/export-word', '/assets',
];

// `/voc` is both a React screen and an API endpoint. Browser navigations must
// reach Vite's SPA fallback, while JSON requests still proxy to FastAPI.
const spaCollisionBypass = (req) => {
  const acceptsHtml = String(req.headers.accept || '').includes('text/html');
  if (req.method === 'GET' && acceptsHtml) return '/index.html';
  return undefined;
};

const proxy = Object.fromEntries(
  proxyPaths.map((p) => [
    p,
    {
      target: BACKEND,
      changeOrigin: true,
      ...(['/voc', '/scheduler'].includes(p) ? { bypass: spaCollisionBypass } : {}),
      // Preserve the browser's client address for IP-based profile routing.
      // FastAPI accepts this header only because the Vite proxy itself is in
      // TRUSTED_PROXY_IPS; direct clients cannot override their profile.
      xfwd: true,
      ws: false,
      configure: (proxy) => {
        proxy.on('proxyRes', (proxyRes) => {
          proxyRes.headers['cache-control'] = 'no-cache';
          proxyRes.headers['x-accel-buffering'] = 'no';
        });
      },
    },
  ])
);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
  },
});
