import './loadEnvFirst';
import http from 'http';
import { logger } from './logger';
import { createApp } from './createApp';
import { initializeWebSocketServer } from './websocket';
import { warnProductionDevFlags } from './warnProductionDevFlags';
import { shouldStartWorkersInProcess, startInProcessWorkers } from './workers/registry';
import { assertSecurityEnv } from './security/env';
import { ExporterAdapter, validateObservabilityStartup } from './observability';

warnProductionDevFlags();

if (process.env.NODE_ENV === 'production') {
  assertSecurityEnv();
}

if (process.env.NODE_ENV !== 'test') {
  validateObservabilityStartup();
  new ExporterAdapter().start();
}

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
