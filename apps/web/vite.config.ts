import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [path.resolve(dir, '../..'), dir],
    },
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@idl': path.resolve(dir, '../../idl/creator_treasury.json'),
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
});
