/**
 * WebSocket Server Setup
 * Handles real-time updates for admin modules
 */

import type { Server as HTTPServer } from 'http';
import type { Server as HTTPSServer } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import { handleCarbonConnection } from './carbonUpdates';
import { handleTransportConnection } from './transportUpdates';
import { authenticateProjectWebSocket, authenticateWebSocket } from './authenticate';

type Server = HTTPServer | HTTPSServer;

/**
 * Initialize WebSocket server for admin real-time updates
 */
export const initializeWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({ server });

  console.log('[WebSocket] Server initialized');

  wss.on('connection', (ws: WebSocket, req) => {
    void (async () => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const pathname = url.pathname;

      console.log(`[WebSocket] New connection: ${pathname}`);

      if (pathname.startsWith('/projects/') && pathname.includes('/carbon')) {
        const projectId = pathname.split('/')[2];
        if (!projectId) {
          ws.close(1008, 'Invalid project ID');
          return;
        }

        const auth = await authenticateProjectWebSocket(req, url, projectId);
        if ('error' in auth) {
          ws.close(1008, auth.error);
          return;
        }

        handleCarbonConnection(ws, projectId);
        return;
      }

      if (pathname === '/transport/updates') {
        const auth = await authenticateWebSocket(req, url);
        if ('error' in auth) {
          ws.close(1008, auth.error);
          return;
        }

        handleTransportConnection(ws);
        return;
      }

      ws.close(1008, 'Unknown endpoint');
    })();
  });

  wss.on('error', (error) => {
    console.error('[WebSocket] Server error:', error);
  });

  return wss;
};

// Export handlers for use in other parts of the application
export { handleCarbonConnection, broadcastCarbonUpdateAll } from './carbonUpdates';
export {
  handleTransportConnection,
  broadcastTransportUpdate,
  updateTransportStatus,
} from './transportUpdates';
