/**
 * 🜂 Portable Scheduler & State Reconstructor (Step 3)
 *
 * Schemaläggaren läser registret, utvärderar "Due-status" mot den lokala
 * tillståndsfilen (scheduler_state.json), skapar en HarvestPlan och
 * initierar en HarvestLedger-kontext. Den laddar ner inga filer själv.
 *
 * Särskild egenskap (Pelare 3):
 *   - Schedulern använder scheduler_state.json enbart som en prestanda-cache!
 *   - Om state-filen raderas kan schemaläggaren bygga upp den igen genom att
 *     skanna igenom och tolka alla historiska `harvest_ledger_*.json`-filer.
 *
 * Regler:
 *   - Scheduler SHALL NOT execute harvest work.
 *   - Scheduler SHALL create HarvestPlans.
 *   - Scheduler SHALL enqueue HarvestPlans.
 *   - Scheduler SHALL update SchedulerState.
 *   - Scheduler SHALL NOT download documents.
 *
 * ⚠️ NON-OPERATIONAL ENTRYPOINT (GOVERNED-HARVEST-CANONICAL-ENTRYPOINT, 2026-09-05).
 *
 * This module and `./harvestRuntime` (which `runScheduler` below delegates execution to) are
 * legacy: `executeHarvestForSource`'s adapter factory only resolves `mmd_v1` /
 * `mpd_lansstyrelsen_v1` / `mod_v1`, and none of the currently APPROVED sources in
 * `source-registry/national-registry.json` use those adapter names — every real source fails
 * adapter instantiation through this path. The canonical, operational governed-harvest entrypoint
 * is `packages/mps-data-governance/scripts/harvest-live-pilot.ts` (composed via
 * `HarvestRuntimeCompositionRoot.composeHarvestRuntime`), wired to `npm run harvest:governed`.
 *
 * This file previously self-executed `runScheduler()` on mere module import whenever
 * `process.env.NODE_ENV !== 'test'` — an unguarded, unintended-activation risk (formerly tracked
 * as LOKE_SCHEDULER_IMPORT_SIDE_EFFECT / SR2 in docs/architecture/architecture-authority-map.jsonc,
 * inherited from this file's `lokeScheduler.ts` predecessor). That self-executing block has been
 * removed: importing this module now has no side effect, regardless of `NODE_ENV`. `runScheduler`
 * remains exported for its scheduling/state-reconstruction logic and existing test coverage
 * (`tests/unit/import/harvestScheduler.test.ts`), but nothing in this module can start it anymore.
 * See docs/architecture/KNOWLEDGE-INGESTION-REACHABILITY-AUDIT-2026-09-05.md for the full trace.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../../../server/db/prisma';
import { logger } from '../../../server/logger';
import {
  getAllVerifiedSources,
  type VerifiedSourceDefinition as SourceDefinition,
} from '../../../packages/mps-data-governance/src/SourceRegistry';
import { createHarvestPlan } from './harvestPlan';
import { startHarvestRun, recordHarvestEvent, completeHarvestRun } from './harvestLedger';
import { executeHarvestForSource } from './harvestRuntime';
import { HarvestLedger } from './contract';

const MASTER_ARCHIVE_ROOT = process.env.MASTER_ARCHIVE_ROOT || 'C:\\miljöbeslut\\storage\\geo_master_archive';

export interface SchedulerSourceState {
  last_success: string | null;
  last_failure: string | null;
  consecutive_failures: number;
  next_retry: string | null;
  cooldown_until: string | null;
  disabled: boolean;
  last_plan_id: string | null;
  last_run_id: string | null;
}

export type SchedulerState = Record<string, SchedulerSourceState>;

/**
 * 🕵️‍♂️ Självläkande Replay-motor (Pelare 3)
 * Rekonstruerar schemaläggarens tillstånd helt från de historiska Harvest Ledger-filerna!
 */
export async function reconstructSchedulerStateFromLedger(): Promise<SchedulerState> {
  const reconstructed: SchedulerState = {};
  const runsDir = path.join(MASTER_ARCHIVE_ROOT, 'National_Archive', 'runs');

  if (!(await fs.stat(runsDir).catch(() => null))) {
    return reconstructed;
  }

  const files = await fs.readdir(runsDir);
  const ledgerFiles = files.filter((f) => f.startsWith('harvest_ledger_') && f.endsWith('.json'));

  const ledgers: HarvestLedger[] = [];

  // Läs in alla ledgers
  for (const file of ledgerFiles) {
    try {
      const content = await fs.readFile(path.join(runsDir, file), 'utf8');
      ledgers.push(JSON.parse(content));
    } catch (err) {
      // Ignorera korrupta ledger-filer
    }
  }

  // Sortera ledgers efter starttid så att vi bygger upp tillståndet kronologiskt (Replay!)
  ledgers.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());

  for (const ledger of ledgers) {
    const sourceId = ledger.source_id;
    if (!reconstructed[sourceId]) {
      reconstructed[sourceId] = {
        last_success: null,
        last_failure: null,
        consecutive_failures: 0,
        next_retry: null,
        cooldown_until: null,
        disabled: false,
        last_plan_id: null,
        last_run_id: null,
      };
    }

    const state = reconstructed[sourceId]!;
    state.last_plan_id = ledger.plan_id;

    if (ledger.status === 'Completed') {
      state.last_success = ledger.completed_at;
      state.consecutive_failures = 0;
      state.next_retry = null;
      state.cooldown_until = null;
      state.disabled = false;

      // Hitta run_id i sluthändelsen
      const completedEvent = ledger.events.find((e) => e.state === 'Completed');
      if (completedEvent && completedEvent.metadata) {
        state.last_run_id = completedEvent.metadata.harvest_run_id || null;
      }
    } else if (ledger.status === 'Failed') {
      state.last_failure = ledger.completed_at;
      state.consecutive_failures++;

      // Beräkna exponential backoff
      const cooldownMinutes = Math.min(state.consecutive_failures * 30, 1440);
      const cooldownTime = new Date(
        new Date(ledger.completed_at!).getTime() + cooldownMinutes * 60 * 1000,
      ).toISOString();

      state.cooldown_until = cooldownTime;
      state.next_retry = cooldownTime;
      state.disabled = state.consecutive_failures >= 5;
    }
  }

  return reconstructed;
}

/**
 * Läser in tillståndet. Om filen saknas görs en självläkande rekonstruktion från ledgern!
 */
export async function loadSchedulerState(): Promise<SchedulerState> {
  const filePath = path.join(MASTER_ARCHIVE_ROOT, 'scheduler_state.json');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    console.log(
      '⚠️ scheduler_state.json saknas eller är korrupt. Rekonstruerar tillståndet helt från historiska ledgers (Replay)...',
    );
    const reconstructed = await reconstructSchedulerStateFromLedger();
    await saveSchedulerState(reconstructed);
    return reconstructed;
  }
}

/**
 * Sparar schemaläggartillståndet till disk
 */
export async function saveSchedulerState(state: SchedulerState): Promise<void> {
  const filePath = path.join(MASTER_ARCHIVE_ROOT, 'scheduler_state.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Beräknar om en källa är "Due" (bör skördas) baserat på dess frekvens och senast lyckade körning
 */
export function isSourceDue(source: SourceDefinition, state?: SchedulerSourceState): boolean {
  if (!state) return true; // Ingen tidigare körning -> Kör direkt!
  if (state.disabled) return false; // Inaktiverad pga upprepade fel

  // Cooldown-kontroll
  if (state.cooldown_until && new Date(state.cooldown_until) > new Date()) {
    return false;
  }

  const lastSuccess = state.last_success ? new Date(state.last_success) : null;
  if (!lastSuccess) return true;

  const now = new Date();
  const diffMs = now.getTime() - lastSuccess.getTime();

  switch (source.frequency) {
    case 'hourly':
      return diffMs >= 60 * 60 * 1000;
    case 'daily':
      return diffMs >= 24 * 60 * 60 * 1000;
    case 'weekly':
      return diffMs >= 7 * 24 * 60 * 60 * 1000;
    case 'monthly':
      return diffMs >= 30 * 24 * 60 * 60 * 1000;
    case 'yearly':
      return diffMs >= 365 * 24 * 60 * 60 * 1000;
    case 'on_demand':
      return false;
    default:
      return true;
  }
}

/**
 * Exekverar hela LSF P0-orkestreringsloopen
 */
export async function runScheduler(options: { execute?: boolean; onlyFilters?: string[] } = {}): Promise<{
  triggeredPlansCount: number;
  completedRunsCount: number;
  failedRunsCount: number;
}> {
  console.log('=== 🜂 Harvest Ingest: Scheduler & Orchestrator ===');
  const schedulerState = await loadSchedulerState();
  const allSources = await getAllVerifiedSources();

  let triggeredPlansCount = 0;
  let completedRunsCount = 0;
  let failedRunsCount = 0;

  for (const source of allSources) {
    // Filtreringskontroll
    if (options.onlyFilters && options.onlyFilters.length > 0) {
      if (
        !options.onlyFilters.includes(source.sourceId) &&
        !options.onlyFilters.includes(source.authority.name.toLowerCase())
      ) {
        continue;
      }
    }

    if (source.channelType === 'ARCHIVE_IMPORT') {
      console.log(`📦 Källa '${source.sourceId}' är ARCHIVE_IMPORT och får inte nätverksschemaläggas.`);
      continue;
    }

    const state = schedulerState[source.sourceId];

    if (!isSourceDue(source, state)) {
      console.log(
        `🕒 Källa '${source.sourceId}' är inte due ännu (Frekvens: ${source.frequency}). Hoppar över.`,
      );
      continue;
    }

    console.log(`\n📅 [DUE] Källa '${source.sourceId}' uppfyller kriterierna för skörd.`);

    // --- STEG 1: SKAPA IMMUTABLE HARVEST PLAN ---
    const plan = await createHarvestPlan(source.sourceId, {
      priority: source.frequency === 'daily' ? 'high' : 'medium',
    });
    triggeredPlansCount++;
    console.log(
      `   📝 HarvestPlan skapat: ${plan.plan_id} (Content-Hash: ${plan.content_hash.substring(0, 12)}…)`,
    );

    if (!options.execute) {
      console.log('   🔍 [DRY-RUN] Planen skapad men inte exekverad.');
      continue;
    }

    // --- STEG 2: INITIERA APPEND-ONLY HARVEST LEDGER ---
    const ledger = await startHarvestRun(plan);
    console.log(`   🧾 Harvest Ledger öppnat: ${ledger.ledger_id}`);

    // --- STEG 3 & 4: KÖA OCH EXEKVERA SKÖRD (skördemotorn) ---
    // Schedulern gör inget skördearbete själv; den delegerar exekveringen helt till skördemotorn.
    await recordHarvestEvent(
      ledger.ledger_id,
      'HarvestStarted',
      `Orkestrerar och startar skörd för källa: ${source.sourceId}`,
    );

    try {
      const runResult = await executeHarvestForSource(source.sourceId, { execute: true });

      if (runResult.status === 'completed') {
        // Uppdatera händelselistan
        await recordHarvestEvent(
          ledger.ledger_id,
          'DiscoveryFinished',
          `Discovery slutförd. Hittade ${runResult.documents_found} dokument.`,
        );
        await recordHarvestEvent(
          ledger.ledger_id,
          'DownloadsCompleted',
          `Nedladdning slutförd. Säkrade ${runResult.documents_new} nya och ${runResult.documents_changed} uppdaterade filer.`,
        );
        await recordHarvestEvent(
          ledger.ledger_id,
          'VerificationCompleted',
          'Integritets- och hashkontroller slutförda i National Archive.',
        );

        // Stäng ledgern som Completed
        await completeHarvestRun(ledger.ledger_id, 'Completed', runResult);
        completedRunsCount++;

        // Uppdatera schemaläggarens tillstånd med ledgerns exakta slutförandetid (LSF P0)
        schedulerState[source.sourceId] = {
          last_success: ledger.completed_at,
          last_failure: state?.last_failure ?? null,
          consecutive_failures: 0,
          next_retry: null,
          cooldown_until: null,
          disabled: false,
          last_plan_id: plan.plan_id,
          last_run_id: runResult.harvest_run_id,
        };
      } else {
        throw new Error(runResult.error_message || 'Okänt exekveringsfel i skördemotorn.');
      }
    } catch (err: any) {
      console.error(`❌ Skördekörning misslyckades för '${source.sourceId}':`, err.message || err);

      // Stäng ledgern som Failed
      const failedLedger = await completeHarvestRun(ledger.ledger_id, 'Failed', {
        error_message: err.message || err,
      });
      failedRunsCount++;

      // Beräkna exponential backoff cooldown
      const failures = (state?.consecutive_failures ?? 0) + 1;
      const cooldownMinutes = Math.min(failures * 30, 1440); // Max 24h cooldown
      const cooldownUntil = new Date(Date.now() + cooldownMinutes * 60 * 1000).toISOString();

      schedulerState[source.sourceId] = {
        last_success: state?.last_success ?? null,
        last_failure: failedLedger.completed_at,
        consecutive_failures: failures,
        next_retry: cooldownUntil,
        cooldown_until: cooldownUntil,
        disabled: failures >= 5, // Inaktivera helt efter 5 upprepade fel
        last_plan_id: plan.plan_id,
        last_run_id: state?.last_run_id ?? null,
      };
    }
  }

  // Spara det uppdaterade tillståndet
  if (options.execute) {
    await saveSchedulerState(schedulerState);
    console.log('\n✅ Schemaläggartillstånd synkroniserat till disk.');
  }

  return { triggeredPlansCount, completedRunsCount, failedRunsCount };
}

// Self-execution on import was removed 2026-09-05 (GOVERNED-HARVEST-CANONICAL-ENTRYPOINT).
// This module must never start harvesting merely by being imported. Call `runScheduler()`
// explicitly (as the test suite does) if this legacy scheduling logic is ever needed directly.
