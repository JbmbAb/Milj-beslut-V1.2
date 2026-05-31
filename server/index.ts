import http from 'http';
import { loadEnvFile } from './loadEnv';
import { logger } from './logger';
import { createApp } from './createApp';
import { initializeWebSocketServer } from './websocket';
import { warnProductionDevFlags } from './warnProductionDevFlags';
import { shouldStartWorkersInProcess, startInProcessWorkers } from './workers/registry';

loadEnvFile();
const preserveRuntimeEnv =
  process.env.PRESERVE_RUNTIME_ENV === 'true' ||
  Boolean(process.env.PLAYWRIGHT_LOCAL_API_PORT) ||
  process.env.NODE_ENV === 'test';
loadEnvFile('.env.local', { overrideExisting: !preserveRuntimeEnv });
warnProductionDevFlags();

export const app = createApp();
const port = Number(process.env.PORT || 8787);

const server = http.createServer(app);

// Skapa servern men starta den bara om vi inte är i testmiljö.
// Vitest importerar denna fil för att få 'app'-instansen.
if (process.env.NODE_ENV !== 'test') {
  initializeWebSocketServer(server);

  // Bakgrundsjobb: kör separat via `npm run worker:all` i produktion (START_WORKERS_IN_PROCESS=false).
  if (shouldStartWorkersInProcess()) {
    startInProcessWorkers();
  } else {
    logger.info('In-process workers disabled (set START_WORKERS_IN_PROCESS=true to force-enable)');
  }

  if (port === 3000 && process.env.NODE_ENV !== 'production') {
    logger.warn(
      'PORT=3000 kolliderar med Vite (npm run dev). Sätt PORT=8787 i .env.local och kör backend med npm run dev:server.',
      { port },
    );
  }

  server.listen(port, () => {
    logger.info('Miljöbeslut backend started with WebSocket support', { port });
  });
}
