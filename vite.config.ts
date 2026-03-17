import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
    plugins: [tailwindcss(), react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // Browser stubs for server-only modules so Vite never bundles Prisma or Node.js APIs.
        '@prisma/client': path.resolve(__dirname, 'src/prisma-stub.ts'),
        '.prisma/client': path.resolve(__dirname, 'src/prisma-stub.ts'),
        // Redirect the server-side DB module to the same empty stub.
        [path.resolve(__dirname, 'server/db/prisma')]: path.resolve(__dirname, 'src/prisma-stub.ts'),
      },
    },
  };
});
