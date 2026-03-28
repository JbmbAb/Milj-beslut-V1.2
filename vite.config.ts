import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiTarget = env.VITE_API_BASE_URL || 'http://localhost:8787';

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        child_process: path.resolve(__dirname, 'stubs/browser/child-process.ts'),
        'node:child_process': path.resolve(__dirname, 'stubs/browser/child-process.ts'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('@loaders.gl')) {
                return 'map-workers';
              }
              if (id.includes('lucide-react')) {
                return 'icon-vendor';
              }
              if (id.includes('framer-motion') || id.includes('/motion/') || id.includes('\\motion\\')) {
                return 'motion-vendor';
              }
              if (id.includes('recharts')) {
                return 'charts-vendor';
              }
              if (id.includes('react-markdown')) {
                return 'markdown-vendor';
              }
              if (id.includes('docx') || id.includes('yazl')) {
                return 'document-vendor';
              }
              if (
                id.includes('@google/genai') ||
                id.includes('@google/generative-ai') ||
                id.includes('openai')
              ) {
                return 'ai-vendor';
              }
              if (id.includes('leaflet')) {
                return 'map-vendor';
              }
              if (
                id.includes('react') ||
                id.includes('react-dom') ||
                id.includes('scheduler')
              ) {
                return 'react-vendor';
              }
            }

            return undefined;
          },
        },
      },
    },
  };
});
