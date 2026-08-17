/**
 * 🜂 National Environmental Harvest Runtime & Engine (LSF-02)
 * 
 * Detta är plattformens generiska skörde-motor.
 * Den är helt frikopplad från källspecifik logik och exekverar via fristående Adaptrar.
 * 
 * Ansvarsområde (Uppfyller L1-11 Karantänsinvarianter):
 *   - Läsa in och köra Adaptrar enligt det strikta Harvest Contract.
 *   - Genomföra Discovery (skanna efter kandidater utan att ladda ner).
 *   - Genomföra Fetch (hämta rådokument).
 *   - Spara det nedladdade rådokumentet i det fysiskt isolerade Quarantine-lagret (får EJ skriva direkt till CAS/Master).
 *   - Skriva ut en samlad HarvestRunArtifact (körningsidentitet) vid avslutad runda.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MmdAdapter } from './adapters/mmdAdapter';
import { MpdAdapter } from './adapters/mpdAdapter';
import { ModAdapter } from './adapters/modAdapter';
import { HarvestCandidate, SourceAdapter, HarvestArtifact, HarvestRunArtifact } from './contract';
import {
  getVerifiedSourceDefinition,
  isUrlAllowedForVerifiedSource,
  type VerifiedSourceDefinition,
} from '../../../packages/mps-data-governance/src/SourceRegistry';
import { DiskQuarantineStorage } from '@miljobeslut/mimers-brunn-core';
import { MASTER_ARCHIVE_ROOT } from '../config/mimersBrunn';

// Skördemotorn får inte ha en egen arkivrot. Den tidigare lokala fallbacken
// (C:\miljöbeslut\storage\geo_master_archive) var en andra rot som ingen annan
// konsument läste: 524 filer och 17 myndighetskataloger hamnade utanför
// masterarkivet. Roten upplöses nu på ett enda ställe, i config/mimersBrunn.

function calculateHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Fabrik för att instansiera rätt adapter baserat på verifierad SourceRegistry-materialisering.
 */
export function createAdapterForSource(sourceDef: VerifiedSourceDefinition): SourceAdapter | null {
  if (sourceDef.adapter === 'mmd_v1') {
    return new MmdAdapter(sourceDef.sourceId);
  }
  if (sourceDef.adapter === 'mpd_lansstyrelsen_v1') {
    return new MpdAdapter(sourceDef.sourceId);
  }
  if (sourceDef.adapter === 'mod_v1') {
    return new ModAdapter(sourceDef.sourceId);
  }

  return null;
}

export async function executeHarvestForSource(
  sourceId: string,
  options: { execute?: boolean; onlyFilters?: string[] } = {}
): Promise<HarvestRunArtifact> {
  const startedAt = new Date().toISOString();
  const runId = `loke-run-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6)}`;
  
  let sourceDef: VerifiedSourceDefinition | null = null;
  try {
    sourceDef = await getVerifiedSourceDefinition(sourceId);
  } catch (err: any) {
    return {
      harvest_run_id: runId,
      source_id: sourceId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      adapter_version: 'unknown',
      documents_found: 0,
      documents_new: 0,
      documents_changed: 0,
      status: 'failed',
      error_message: `SourceRegistry-materialisering nekades: ${String(err.message || err)}`
    };
  }

  if (!sourceDef) {
    return {
      harvest_run_id: runId,
      source_id: sourceId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      adapter_version: 'unknown',
      documents_found: 0,
      documents_new: 0,
      documents_changed: 0,
      status: 'failed',
      error_message: `Käll-ID '${sourceId}' saknar verifierad SourceRegistryArtifact.`
    };
  }

  const execute = options.execute ?? false;
  const adapter = createAdapterForSource(sourceDef);

  if (!adapter) {
    return {
      harvest_run_id: runId,
      source_id: sourceId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      adapter_version: sourceDef.adapter,
      documents_found: 0,
      documents_new: 0,
      documents_changed: 0,
      status: 'failed',
      error_message: `Kunde inte instansiera käll-adaptern '${sourceDef.adapter}' för källa '${sourceId}'.`
    };
  }

  // Kontraktsvalidering
  const contractValidation = adapter.validateContract();
  if (!contractValidation.valid) {
    return {
      harvest_run_id: runId,
      source_id: sourceId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      adapter_version: sourceDef.adapter,
      documents_found: 0,
      documents_new: 0,
      documents_changed: 0,
      status: 'failed',
      error_message: `Kontraktsvalidering misslyckades: ${contractValidation.errors.join(', ')}`
    };
  }

  console.log(`\n🜂 [RUN: ${runId}] Inleder skörd för källa: ${sourceDef.authority.name} (${sourceId})`);

  // Etablera karantänlagring för denna exekvering (Isolerat från CAS)
  const quarantineRoot = process.env.QUARANTINE_ROOT || path.resolve(MASTER_ARCHIVE_ROOT, '..', '.quarantine');
  const quarantineStorage = new DiskQuarantineStorage(quarantineRoot);

  let documentsFound = 0;
  let documentsNew = 0;
  let documentsChanged = 0;
  const quarantinedIds: string[] = [];

  try {
    // Steg 1: DISCOVER (Hitta kandidater)
    const candidates: HarvestCandidate[] = await adapter.discover(options.onlyFilters);
    documentsFound = candidates.length;

    console.log(`   -> Upptäckte ${candidates.length} tillgängliga dokument-kandidater.`);

    for (const cand of candidates) {
      // Säkra källsluss (Crawler Leak Protection - LSF-01)
      if (!isUrlAllowedForVerifiedSource(sourceDef, cand.sourceUrl)) {
        console.warn(`   ⚠️ [Crawler Leak Blocked] Nekade att anropa URL '${cand.sourceUrl}' eftersom domänen inte är listad i källans kontrakt.`);
        continue;
      }

      if (!execute) {
        console.log(`      -> [DRY-RUN] Skulle hämta: ${cand.fileName} från ${cand.sourceUrl}`);
        continue;
      }

      // Steg 2: FETCH (Ladda ner rådokument)
      const doc = await adapter.fetch(cand);
      
      // Steg 3: QUARANTINE (Spara fysiskt isolerat i karantän enligt L1-11)
      const bytes = new TextEncoder().encode(doc.content);
      const qResult = await quarantineStorage.put(
        sourceId,
        cand.sourceUrl,
        doc.name,
        bytes,
        {
          authority: cand.authority,
          year: cand.year,
          municipality: cand.municipality,
          caseId: cand.caseId
        }
      );

      quarantinedIds.push(qResult.quarantine_id);

      if (qResult.is_duplicate) {
        console.log(`         ⏭️ [SKIP] ${cand.fileName} är redan skördad och oförändrad i karantänen (ID: ${qResult.quarantine_id}).`);
      } else {
        documentsNew++;
        console.log(`         💾 Quarantined RawObservation: ${cand.fileName} -> ID: ${qResult.quarantine_id} (${bytes.length} bytes)`);
      }
    }

    const completedAt = new Date().toISOString();
    const runArtifact: HarvestRunArtifact = {
      harvest_run_id: runId,
      source_id: sourceId,
      started_at: startedAt,
      completed_at: completedAt,
      adapter_version: sourceDef.adapter,
      documents_found: documentsFound,
      documents_new: documentsNew,
      documents_changed: documentsChanged,
      status: 'completed'
    };

    if (execute) {
      // Skriv HarvestRunArtifact till det isolerade karantänsarkivets runs/
      const runsDir = path.join(quarantineRoot, 'runs');
      fs.mkdirSync(runsDir, { recursive: true });
      fs.writeFileSync(path.join(runsDir, `harvest_run_${runId}.json`), JSON.stringify({ ...runArtifact, quarantined_ids: quarantinedIds }, null, 2), 'utf8');
      console.log(`   ✅ HarvestRunArtifact sparat under .quarantine/runs/. Status: completed`);
    }

    return runArtifact;

  } catch (err: any) {
    const runArtifact: HarvestRunArtifact = {
      harvest_run_id: runId,
      source_id: sourceId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      adapter_version: sourceDef.adapter,
      documents_found: documentsFound,
      documents_new: documentsNew,
      documents_changed: documentsChanged,
      status: 'failed',
      error_message: String(err.message || err)
    };

    if (execute) {
      const runsDir = path.join(quarantineRoot, 'runs');
      fs.mkdirSync(runsDir, { recursive: true });
      fs.writeFileSync(path.join(runsDir, `harvest_run_${runId}.json`), JSON.stringify(runArtifact, null, 2), 'utf8');
    }

    return runArtifact;
  }
}
