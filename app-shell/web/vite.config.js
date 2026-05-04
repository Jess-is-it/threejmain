import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

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
    port: 8180,
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '../../customer-profiling'),
        path.resolve(__dirname, '../../billing'),
        path.resolve(__dirname, '../../customer-service-management')
      ]
    },
    proxy: {
      '/api': 'http://127.0.0.1:8100',
      '/health': 'http://127.0.0.1:8100'
    }
  }
});
