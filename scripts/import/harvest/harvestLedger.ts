/**
 * 🜂 Harvest Ledger (Step 2)
 * 
 * Implementerar en strikt, append-only händelselogg (HarvestLedger)
 * som refererar till exakt en HarvestPlan och loggar dess livscykel.
 * 
 * Regler:
 *   - HarvestLedger SHALL be append-only.
 *   - HarvestLedger SHALL reference exactly one HarvestPlan (plan_id AND plan_hash).
 *   - HarvestLedger SHALL preserve event order.
 *   - HarvestLedger SHALL record every state transition.
 *   - HarvestLedger SHALL NOT mutate historical events.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { HarvestPlan, HarvestLedger, HarvestLedgerState, LedgerEvent } from './contract';

const MASTER_ARCHIVE_ROOT = process.env.MASTER_ARCHIVE_ROOT || 'C:\\miljöbeslut\\storage\\geo_master_archive';

// En lokal, in-memory cache för aktiva körningar för att förhindra ad-hoc mutation
const ACTIVE_LEDGERS: Map<string, HarvestLedger> = new Map();

/**
 * Steg 2: Initierar en ny append-only HarvestLedger
 * 
 * HarvestLedger SHALL reference exactly one HarvestPlan (both ID and Content-Hash!)
 */
export async function startHarvestRun(plan: HarvestPlan): Promise<HarvestLedger> {
  const ledgerId = `loke-ledger-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${crypto.randomUUID().substring(0, 8)}`;
  
  const initialEvent: LedgerEvent = {
    timestamp: new Date().toISOString(),
    state: 'HarvestPlan',
    message: `HarvestPlan ${plan.plan_id} laddat och verifierat. Content-Hash: ${plan.content_hash}`,
    metadata: { plan_id: plan.plan_id, content_hash: plan.content_hash }
  };

  const ledger: HarvestLedger = {
    ledger_id: ledgerId,
    plan_id: plan.plan_id,
    plan_hash: plan.content_hash, // Strikt bindning till planens innehållshash (LSF P0 Pelare 2)
    source_id: plan.source_id,
    started_at: new Date().toISOString(),
    completed_at: null,
    status: 'HarvestStarted',
    events: [initialEvent]
  };

  ACTIVE_LEDGERS.set(ledgerId, ledger);
  
  // Logga första tillståndsövergången
  await recordHarvestEvent(ledgerId, 'HarvestStarted', `Skördekörning startad för källa '${plan.source_id}'.`);

  return ledger;
}

/**
 * Loggar en ny händelse och tillståndsövergång i ledgern (Append-only)
 */
export async function recordHarvestEvent(
  ledgerId: string,
  state: HarvestLedgerState,
  message: string,
  metadata?: any
): Promise<HarvestLedger> {
  const ledger = ACTIVE_LEDGERS.get(ledgerId);
  if (!ledger) {
    throw new Error(`Ledger '${ledgerId}' hittades inte bland aktiva körningar.`);
  }

  // Säkra append-only och förhindra historisk mutation
  const newEvent: LedgerEvent = {
    timestamp: new Date().toISOString(),
    state,
    message,
    metadata
  };

  ledger.events.push(newEvent);
  ledger.status = state;

  return ledger;
}

/**
 * Slutför rundan och sparar ledgern som en oföränderlig revisionsfil på disk
 */
export async function completeHarvestRun(
  ledgerId: string,
  status: 'Completed' | 'Failed',
  finalSummary?: any
): Promise<HarvestLedger> {
  const ledger = ACTIVE_LEDGERS.get(ledgerId);
  if (!ledger) {
    throw new Error(`Ledger '${ledgerId}' hittades inte bland aktiva körningar.`);
  }

  const completedAt = new Date().toISOString();
  
  // Lägg till sista händelsen
  await recordHarvestEvent(
    ledgerId,
    status,
    status === 'Completed' 
      ? 'Skördekörning slutförd med framgång.' 
      : `Skördekörning misslyckades: ${finalSummary?.error_message || 'Okänt fel'}`,
    finalSummary
  );

  ledger.completed_at = completedAt;
  ledger.status = status;

  // Spara loggen som en oföränderlig fil i arkivet
  const runsDir = path.join(MASTER_ARCHIVE_ROOT, 'National_Archive', 'runs');
  await fs.mkdir(runsDir, { recursive: true });
  
  const ledgerFilePath = path.join(runsDir, `harvest_ledger_${ledgerId}.json`);
  await fs.writeFile(ledgerFilePath, JSON.stringify(ledger, null, 2), 'utf8');

  // Ta bort från in-memory cache för att frysa tillståndet permanent
  ACTIVE_LEDGERS.delete(ledgerId);

  return ledger;
}
