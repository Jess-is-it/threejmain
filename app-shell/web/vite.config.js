import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const devPort = Number(process.env.VITE_DEV_PORT || process.env.PORT || 8180);
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8100';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      '@tabler/icons-react': path.resolve(__dirname, 'node_modules/@tabler/icons-react')
    }
  },
  server: {
    port: devPort,
    strictPort: true,
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '../../features')
      ]
    },
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget
    }
  },
  preview: {
    port: devPort,
    strictPort: true
  }
});
