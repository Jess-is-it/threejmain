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
        path.resolve(__dirname, '../../customer-profiling'),
        path.resolve(__dirname, '../../billing'),
        path.resolve(__dirname, '../../point-of-sale'),
        path.resolve(__dirname, '../../inventory'),
        path.resolve(__dirname, '../../account-admin'),
        path.resolve(__dirname, '../../customer-service-management'),
        path.resolve(__dirname, '../../ticketing'),
        path.resolve(__dirname, '../../service'),
        path.resolve(__dirname, '../../network-settings'),
        path.resolve(__dirname, '../../system-settings'),
        path.resolve(__dirname, '../../logs')
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
