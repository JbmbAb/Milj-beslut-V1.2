/**
 * 🜂 Loke Live Ingest — Normative Contracts & APIs (LSF P0)
 * 
 * Detta är det frysta arkitektoniska kontraktet för Loke Live Ingest Foundation.
 * Innehåller strikta TypeScript-gränssnitt och de frysta API-definitionerna.
 * 
 * Normativa regler (SHALL-statements):
 *   - HarvestPlan SHALL be immutable.
 *   - HarvestPlan SHALL be content-addressed (content_hash).
 *   - HarvestPlan SHALL be the sole executable description of a harvest run.
 *   - HarvestPlan SHALL reference immutable Source Registry snapshots.
 *   - HarvestLedger SHALL be append-only and reference exactly one HarvestPlan.
 *   - Scheduler SHALL NOT execute harvest work and SHALL NOT download documents.
 *   - Loke SHALL NOT interpret content and SHALL NOT classify documents.
 */

import { SourceDefinition } from '../../../server/modules/harvest/source-registry/registry';

export interface HarvestPlan {
  plan_id: string;               // Unikt ID (loke-plan-YYYYMMDD-HHmmss)
  created_at: string;
  registry_version: string;      // T.ex. '1.0'
  scheduler_version: string;     // T.ex. '1.0'
  source_id: string;             // Målkälla i registret
  source_snapshot: SourceDefinition; // Immutabel snapshot av källan vid planeringen (LSF-01)
  budgets: {
    max_requests_per_minute: number;
    max_megabytes_per_run: number;
    max_documents_per_run: number;
    priority: 'high' | 'medium' | 'low';
  };
  capabilities: string[];        // Förmågor som krävs (t.ex. ['rss_feed', 'pdf_download'])
  constraints: {
    allowed_domains: string[];
    cooldown_period_minutes: number;
  };
  content_hash: string;          // Content-addressed SHA-256 av planens parametrar
}

export type HarvestLedgerState = 
  | 'HarvestPlan' 
  | 'HarvestStarted' 
  | 'DiscoveryFinished' 
  | 'DownloadsCompleted' 
  | 'VerificationCompleted' 
  | 'Completed' 
  | 'Failed';

export interface LedgerEvent {
  timestamp: string;
  state: HarvestLedgerState;
  message: string;
  metadata?: any;
}

export interface HarvestLedger {
  ledger_id: string;
  plan_id: string;               // Refererar till exakt en HarvestPlan
  plan_hash: string;             // Refererar till planens oföränderliga innehållshash (LSF P0)
  source_id: string;
  started_at: string;
  completed_at: string | null;
  status: HarvestLedgerState;
  events: LedgerEvent[];         // Append-only händelselista med bevarad ordning
}

// -----------------------------------------------------------------------------
// FROZEN CORE APIs (Frysta API-kontrakt)
// -----------------------------------------------------------------------------

export interface LokeIngestAPI {
  /**
   * Steg 1: Skapa ett oföränderligt, innehålls-adresserat HarvestPlan
   */
  createHarvestPlan(sourceId: string, options?: any): Promise<HarvestPlan>;

  /**
   * Steg 2: Lägg planen i kön (simuleras här som en lokal körnings-trigg)
   */
  enqueueHarvestPlan(plan: HarvestPlan): Promise<void>;

  /**
   * Steg 3: Initiera och starta en skördekörning under en HarvestLedger-kontext
   */
  startHarvestRun(plan: HarvestPlan): Promise<HarvestLedger>;

  /**
   * Steg 4: Logga ett nytt tillstånd och händelse i ledgern (Append-only)
   */
  recordHarvestEvent(ledgerId: string, state: HarvestLedgerState, message: string, metadata?: any): Promise<HarvestLedger>;

  /**
   * Steg 5: Slutför körningen och spara ledgern till det immutabla runs-arkivet
   */
  completeHarvestRun(ledgerId: string, status: 'Completed' | 'Failed', finalSummary?: any): Promise<HarvestLedger>;
}
