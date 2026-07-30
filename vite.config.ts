import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5179,
    // host: true so the dev UI is reachable from a phone on the same network.
    host: true,
    proxy: { '/api': 'http://localhost:5178' },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
