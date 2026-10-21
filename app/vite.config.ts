import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  root: 'client',
  // outDir is outside `root`, so Vite will not empty it by default; force a clean
  // build so stale hashed bundles don't accumulate (and never reach `npm publish`).
  build: { outDir: '../dist/client', emptyOutDir: true },
  optimizeDeps: {
    include: ['react-use-websocket', 'react-markdown', 'remark-gfm']
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3456',
      '/ws': { target: 'ws://localhost:3456', ws: true }
    }
  }
});
