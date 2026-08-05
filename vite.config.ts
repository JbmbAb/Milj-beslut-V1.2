import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const pnorm = (s: string) => s.replace(/\\/g, '/');

/**
 * I webbundlen: ersätt moduler under `server/**` så Vite aldrig följer
 * @google-cloud/vertexai / node-fetch. Node/Express använder samma sökvägar
 * via tsx — denna plugin körs enbart från `vite` / `vite build`.
 */
function serverModulesBrowserStubsPlugin(): Plugin {
  const vertStub = path.resolve(__dirname, 'stubs/browser/vertexAiService.ts');
  const cbStub = path.resolve(__dirname, 'stubs/browser/circuit-breaker-stub.ts');
  const searchStub = path.resolve(__dirname, 'stubs/browser/searchService.ts');
  const orkesterStub = path.resolve(__dirname, 'stubs/browser/VertexOrkester.ts');

  const resolveServerStub = (id: string, importer?: string): string | null => {
    const n = pnorm(id);
    if (n.includes('server/services/searchService')) {
      return searchStub;
    }
    if (n.includes('server/modules/ai/orchestrator/VertexOrkester')) {
      return orkesterStub;
    }
    if (n.includes('server/services/vertexAiService')) {
      return vertStub;
    }
    if (n.includes('server/utils/circuitBreaker')) {
      return cbStub;
    }
    if (importer) {
      const joined = pnorm(path.join(path.dirname(importer), id));
      if (joined.includes('server/services/searchService')) {
        return searchStub;
      }
      if (joined.includes('server/modules/ai/orchestrator/VertexOrkester')) {
        return orkesterStub;
      }
      if (joined.includes('server/services/vertexAiService')) {
        return vertStub;
      }
      if (joined.includes('server/utils/circuitBreaker')) {
        return cbStub;
      }
    }
    return null;
  };

  return {
    name: 'server-modules-browser-stubs',
    enforce: 'pre',
    resolveId(id, importer) {
      return resolveServerStub(id, importer ?? undefined);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const defaultApiTarget = 'http://localhost:8787';
  let apiTarget = env.VITE_API_BASE_URL || defaultApiTarget;

  // Guard against accidental self-proxy loops when Vite points /api to port 3000.
  try {
    const parsed = new URL(apiTarget);
    const resolvedPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
    if (isLocalHost && resolvedPort === '3000') {
       
      console.warn(
        '[vite] VITE_API_BASE_URL pekar mot Vite-servern (3000). Byter till http://localhost:8787 för att undvika API/auth-loop.',
      );
      apiTarget = defaultApiTarget;
    }
  } catch {
    // Non-URL values are left as-is; proxy setup will report invalid targets if needed.
  }

  // UI is local-only: do not inject LANTMATERIET_* keys into the Vite client.
  // Harvest/import credentials stay server-side (.env / Secret Manager).

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      watch: {
        ignored: ['**/Database/**', '**/logs/**', '**/*.log'],
      },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [serverModulesBrowserStubsPlugin(), react()],
    optimizeDeps: {
      exclude: ['@math.gl/types'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        child_process: path.resolve(__dirname, 'stubs/browser/child-process.ts'),
        'node:child_process': path.resolve(__dirname, 'stubs/browser/child-process.ts'),
        '@miljobeslut/mps-lu': path.resolve(__dirname, 'packages/mps-lu/src/index.ts'),
        '@miljobeslut/mps-console': path.resolve(__dirname, 'packages/mps-console/src/index.ts'),
        '@miljobeslut/mps-compass': path.resolve(__dirname, 'packages/mps-compass/src/index.ts'),
        '@miljobeslut/mps-identity': path.resolve(__dirname, 'packages/mps-identity/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        external: ['@math.gl/types'],
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
              if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
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
