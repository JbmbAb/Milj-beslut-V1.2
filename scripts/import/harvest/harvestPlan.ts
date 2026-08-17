/**
 * 🜂 HarvestPlan Generator (Step 1)
 * 
 * Skapar oföränderliga, innehålls-adresserade och signerade körningsplaner.
 * Använder plattformens officiella RFC8785-kompatibla canonicalizer
 * för att garantera deterministisk hashing oavsett operativsystem eller plattform.
 */

import * as crypto from 'crypto';
import { HarvestPlan } from './contract';
import { getVerifiedSourceDefinition } from '../../../packages/mps-data-governance/src/SourceRegistry';
import { canonicalizeStrict } from '../../../packages/mimers-brunn-core/src/serialization/canonicalize';

function calculateSHA256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Steg 1: Skapar ett oföränderligt, innehålls-adresserat och signerat HarvestPlan
 * 
 * HarvestPlan SHALL be immutable.
 * HarvestPlan SHALL be content-addressed.
 * HarvestPlan SHALL reference immutable Source Registry snapshots.
 * HarvestPlan SHALL be signed deterministically.
 */
export async function createHarvestPlan(
  sourceId: string,
  options: {
    priority?: 'high' | 'medium' | 'low';
    maxRequestsPerMinute?: number;
    maxMegabytesPerRun?: number;
    maxDocumentsPerRun?: number;
  } = {}
): Promise<HarvestPlan> {
  const sourceDef = await getVerifiedSourceDefinition(sourceId);
  if (!sourceDef) {
    throw new Error(`Käll-ID '${sourceId}' saknar verifierad SourceRegistryArtifact. Planen kan inte skapas.`);
  }

  const createdAt = new Date().toISOString();
  const planId = `loke-plan-${createdAt.split('T')[0].replace(/-/g, '')}-${crypto.randomUUID().substring(0, 8)}`;

  const priority = options.priority ?? 'medium';
  const budgets = {
    max_requests_per_minute: options.maxRequestsPerMinute ?? (priority === 'high' ? 60 : priority === 'medium' ? 30 : 10),
    max_megabytes_per_run: options.maxMegabytesPerRun ?? (priority === 'high' ? 500 : priority === 'medium' ? 200 : 50),
    max_documents_per_run: options.maxDocumentsPerRun ?? (priority === 'high' ? 100 : priority === 'medium' ? 50 : 10),
    priority
  };

  const capabilities: string[] = [];
  if (sourceDef.adapter.includes('mmd')) {
    capabilities.push('rss_feed', 'pdf_download');
  } else if (sourceDef.adapter.includes('mpd')) {
    capabilities.push('html_scrape', 'pdf_download');
  } else if (sourceDef.adapter.includes('castor')) {
    capabilities.push('rest_api', 'zip_extract');
  } else {
    capabilities.push('html_scrape');
  }

  // Säkra käll-snapshotets integritet via dess egen canonical hash
  const registry_hash = sourceDef.sourceContentHash;

  // Immutable parameter-uppsättning (Payload) som används för innehållsadressering
  const planPayload = {
    source_id: sourceId,
    adapter: sourceDef.adapter,
    budgets,
    capabilities,
    allowed_domains: [...sourceDef.allowedDomains],
    registry_hash,
    schema_ref: 'https://mimer.miljobeslut.se/schemas/harvest/plan/v1.json',
    runtime_version: '1.0.0'
  };

  // 1. Content-addressing baserad på strikt canonical-JSON (RFC8785)
  // Förhindrar platform- eller fältordningsavvikelser i checksumman!
  const content_hash = calculateSHA256(canonicalizeStrict(planPayload));

  // 2. Kryptografisk signering för att verifiera planens autencitet (Pelare 4)
  const signature = crypto
    .createHmac('sha256', 'mimer-secret-harvest-key')
    .update(content_hash)
    .digest('hex');

  const plan: HarvestPlan & { signature: string; schema_ref: string; runtime_version: string } = {
    plan_id: planId,
    created_at: createdAt,
    registry_version: '1.0',
    scheduler_version: '1.0',
    source_id: sourceId,
    source_snapshot: JSON.parse(JSON.stringify(sourceDef)), // Djupkopia (Immutability)
    budgets,
    capabilities,
    constraints: {
      allowed_domains: [...sourceDef.allowedDomains],
      cooldown_period_minutes: sourceDef.frequency === 'daily' ? 120 : 720
    },
    content_hash,
    schema_ref: planPayload.schema_ref,
    runtime_version: planPayload.runtime_version,
    signature
  };

  return plan;
}
