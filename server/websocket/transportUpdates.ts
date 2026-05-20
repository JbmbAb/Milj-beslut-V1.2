/**
 * WebSocket handler för transport-uppdateringar
 * Broadcasting transport status-ändringar till anslutna admin-klienter
 */

import { WebSocket } from 'ws';
import { prisma } from '../../db.server';
import { logger } from '../logger';

interface TransportMessage {
  type: 'transport-update';
  bookingId: string;
  updates: {
    status: string;
    location?: { lat: number; lng: number };
    speedKmh?: number;
    lastUpdate: string;
  };
  timestamp: string;
}

// Track active WebSocket connections for transport updates
const transportConnections = new Set<WebSocket>();

/**
 * Handle transport WebSocket connection
 */
export const handleTransportConnection = (ws: WebSocket) => {
  transportConnections.add(ws);
  logger.info('TransportWS client connected', { totalConnections: transportConnections.size });

  // Send initial data
  sendInitialTransportData(ws);

  // Handle message
  ws.on('message', (data: string) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'subscribe' && message.bookingId) {
        logger.debug('TransportWS client subscribed to booking', { bookingId: message.bookingId });
      }
    } catch (err) {
      logger.error('TransportWS invalid message received', { err: String(err) });
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    transportConnections.delete(ws);
    logger.info('TransportWS client disconnected', { totalConnections: transportConnections.size });
  });

  ws.on('error', (error) => {
    logger.error('TransportWS connection error', { err: String(error) });
  });
};

/**
 * Send initial transport data to new client
 */
export const sendInitialTransportData = async (ws: WebSocket) => {
  try {
    const bookings = await prisma.transportBooking.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        updatedAt: true,
      },
    });

    const payload = JSON.stringify({
      type: 'initial-data',
      bookings,
      timestamp: new Date().toISOString(),
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  } catch (error) {
    logger.error('TransportWS error fetching initial data', { err: String(error) });
  }
};

/**
 * Broadcast transport update to all clients
 */
export const broadcastTransportUpdate = (message: TransportMessage) => {
  const payload = JSON.stringify(message);

  transportConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });

  logger.debug('TransportWS broadcasted update', { clientCount: transportConnections.size });
};

/**
 * Update transport status and broadcast to clients
 */
export const updateTransportStatus = async (bookingId: string, newStatus: string) => {
  try {
    // Update database
    const booking = await prisma.transportBooking.update({
      where: { id: bookingId },
      data: { status: newStatus },
      select: {
        id: true,
        status: true,
        updatedAt: true,
      },
    });

    // Broadcast to all clients
    const message: TransportMessage = {
      type: 'transport-update',
      bookingId,
      updates: {
        status: booking.status,
        lastUpdate: booking.updatedAt.toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    broadcastTransportUpdate(message);
  } catch (error) {
    logger.error('TransportWS error updating booking status', { bookingId, err: String(error) });
  }
};
