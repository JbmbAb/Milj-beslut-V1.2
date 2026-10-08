/**
 * Server-side performSpatialAudit for the /api/ai-assistant endpoint (method 'performSpatialAudit').
 *
 * Keeps the fallback order that used to live as a Node-only branch in the shared client/server
 * services/aiAssistantService.ts: the local spatial audit first, then local generation text, then an
 * unavailable error. The shared file no longer imports the server spatial audit, so the browser bundle
 * does not reach the server service graph.
 */
import { runSpatialAudit, type SpatialAuditSummary } from './spatialAuditService';
import { serverGenerateText, unavailable } from '../../services/aiAssistantService';

export type ServerSpatialAuditResult = Pick<SpatialAuditSummary, 'text' | 'sources'>;

export async function performServerSpatialAudit(lat: number, lng: number): Promise<ServerSpatialAuditResult> {
  try {
    const localAudit = await runSpatialAudit(lat, lng);
    return { text: localAudit.text, sources: localAudit.sources };
  } catch {
    // Fall through to the generation fallback.
  }

  const serverResult = await serverGenerateText(
    `Kort spatial riskbedomning for koordinat lat ${lat}, lng ${lng}, fokus pa vatten, skyddszoner och geoteknisk screening.`,
  );
  if (serverResult) return { text: serverResult, sources: [] };

  return unavailable<ServerSpatialAuditResult>('Spatial audit');
}
