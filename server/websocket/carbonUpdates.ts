/**
 * WebSocket handler för CO₂-uppdateringar
 * Broadcasting CO₂-metriker till anslutna admin-klienter
 */

import { WebSocket } from 'ws';
import { prisma } from '../../db.server';
import { buildProjectRiskMetrics } from '../services/projectRiskMetrics';

interface CarbonMessage {
  type: 'carbon-update';
  projectId: string;
  result: {
    totalKgCo2e: number;
    quality: 'ESTIMATED' | 'CALCULATED' | 'VERIFIED';
    method: string;
  };
  riskMetrics: Array<{
    name: string;
    score: number;
    threshold: number;
    status: 'low' | 'medium' | 'high';
  }>;
  timestamp: string;
}

// Track active WebSocket connections per project
const projectConnections = new Map<string, Set<WebSocket>>();

/**
 * Handle CO₂ WebSocket connection
 */
export const handleCarbonConnection = (ws: WebSocket, projectId: string) => {
  if (!projectConnections.has(projectId)) {
    projectConnections.set(projectId, new Set());
  }

  const connections = projectConnections.get(projectId)!;
  connections.add(ws);

  console.log(`[CarbonWS] Client connected to project ${projectId}. Total: ${connections.size}`);

  // Send initial data
  sendCarbonUpdate(projectId);

  // Handle message
  ws.on('message', (data: string) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'request-update') {
        sendCarbonUpdate(projectId);
      }
    } catch (err) {
      console.error('[CarbonWS] Invalid message:', err);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    connections.delete(ws);
    console.log(`[CarbonWS] Client disconnected from project ${projectId}. Total: ${connections.size}`);

    // Clean up empty sets
    if (connections.size === 0) {
      projectConnections.delete(projectId);
    }
  });

  ws.on('error', (error) => {
    console.error('[CarbonWS] Connection error:', error);
  });
};

/**
 * Broadcast CO₂ update to all clients for a project
 */
export const sendCarbonUpdate = async (projectId: string) => {
  const connections = projectConnections.get(projectId);
  if (!connections || connections.size === 0) {
    return;
  }

  try {
    // Fetch latest project data
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        complianceScore: true,
        environmentalScore: true,
        regulatoryRiskScore: true,
      },
    });

    if (!project) {
      console.warn(`[CarbonWS] Project ${projectId} not found`);
      return;
    }

    // Build risk metrics from project data
    const riskMetrics = buildProjectRiskMetrics(project);

    const message: CarbonMessage = {
      type: 'carbon-update',
      projectId,
      result: {
        totalKgCo2e: project.environmentalScore ? project.environmentalScore * 100 : 6200,
        quality: 'CALCULATED',
        method: 'DATABASE',
      },
      riskMetrics,
      timestamp: new Date().toISOString(),
    };

    const payload = JSON.stringify(message);

    // Broadcast to all connected clients
    connections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });

    console.log(`[CarbonWS] Broadcasted update to project ${projectId}. Clients: ${connections.size}`);
  } catch (error) {
    console.error('[CarbonWS] Error fetching data:', error);
  }
};

/**
 * Trigger update for all connected projects (called when CO₂ data changes)
 */
export const broadcastCarbonUpdateAll = async () => {
  const projects = Array.from(projectConnections.keys());
  for (const projectId of projects) {
    await sendCarbonUpdate(projectId);
  }
};
