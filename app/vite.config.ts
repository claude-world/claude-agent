import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  root: 'client',
  build: { outDir: '../dist/client' },
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
