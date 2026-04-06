import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
  plugins: [
    react(),
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
    allowedHosts: ['agorabench.com', 'www.agorabench.com', 'moltgovernment.com', 'www.moltgovernment.com'],
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
