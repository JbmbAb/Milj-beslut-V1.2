/**
 * WebSocket Server Setup
 * Handles real-time updates for admin modules
 */

import type { Server as HTTPServer } from 'http';
import type { Server as HTTPSServer } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import { handleCarbonConnection } from './carbonUpdates';
import { handleTransportConnection } from './transportUpdates';

type Server = HTTPServer | HTTPSServer;

/**
 * Initialize WebSocket server for admin real-time updates
 */
export const initializeWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({ server });

  console.log('[WebSocket] Server initialized');

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pathname = url.pathname;

    console.log(`[WebSocket] New connection: ${pathname}`);

    // Route WebSocket connections to appropriate handlers
    if (pathname.startsWith('/projects/') && pathname.includes('/carbon')) {
      // Extract projectId from URL: /projects/{projectId}/carbon
      const projectId = pathname.split('/')[2];
      if (projectId) {
        handleCarbonConnection(ws, projectId);
      } else {
        ws.close(1008, 'Invalid project ID');
      }
    } else if (pathname === '/transport/updates') {
      handleTransportConnection(ws);
    } else {
      ws.close(1008, 'Unknown endpoint');
    }
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
