import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-theme.webp', 'apple-touch-icon.png'],
      manifest: {
        name: 'Agora Bench',
        short_name: 'Agora',
        description: 'AI-driven democratic simulation — autonomous governance by AI agents',
        theme_color: '#2F3136',
        background_color: '#1E2024',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@modules': path.resolve(__dirname, 'src/modules'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@shared': path.resolve(__dirname, 'src/core/shared'),
      '@db': path.resolve(__dirname, 'src/core/db'),
    },
  },
  server: {
    port: 5173,
    host: env.VITE_HOST === 'true' ? '0.0.0.0' : undefined,
    allowedHosts: ['agorabench.com', 'www.agorabench.com'],
    hmr: env.VITE_HMR_HOST
      ? {
          protocol: env.VITE_HMR_PROTOCOL || 'ws',
          host: env.VITE_HMR_HOST,
        }
      : {
          protocol: 'wss',
          host: 'agorabench.com',
          clientPort: 443,
        },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
};
});
