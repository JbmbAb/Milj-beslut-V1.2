/**
 * 🜂 Loke — National Environmental Harvest Runtime & Engine (LSF-02)
 * 
 * Loke är plattformens generiska skörde-motor (Harvest Agent).
 * Den är helt frikopplad från källspecifik logik och exekverar via fristående Adaptrar.
 * 
 * Ansvarsområde:
 *   - Läsa in och köra Adaptrar enligt det strikta Harvest Contract.
 *   - Genomföra Discovery (skanna efter kandidater utan att ladda ner).
 *   - Genomföra Fetch (hämta rådokument, beräkna hash, spara RawArtifact och HarvestArtifact).
 *   - Skriva ut en samlad HarvestRunArtifact (körningsidentitet) vid avslutad runda.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getNationalArchiveCasePath, checkDiskSpaceSafety } from '../config/mimersBrunn';
import { MmdAdapter } from './adapters/mmdAdapter';
import { MpdAdapter } from './adapters/mpdAdapter';
import { ModAdapter } from './adapters/modAdapter';
import { HarvestCandidate, SourceAdapter, HarvestArtifact, HarvestRunArtifact } from './contract';
import { getSourceDefinition, isUrlAllowedForSource } from '../../../server/modules/harvest/source-registry/registry';

// Standard Master-arkivrot i lokalt gränssnitt
const MASTER_ARCHIVE_ROOT = process.env.MASTER_ARCHIVE_ROOT || 'C:\\miljöbeslut\\storage\\geo_master_archive';

function calculateHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Fabrik för att instansiera rätt adapter baserat på dess källtyp i Source Registry
 */
export function createAdapterForSource(sourceId: string): SourceAdapter | null {
  const sourceDef = getSourceDefinition(sourceId);
  if (!sourceDef) return null;

  if (sourceDef.adapter === 'mmd_v1') {
    return new MmdAdapter(sourceId);
  }
  if (sourceDef.adapter === 'mpd_lansstyrelsen_v1') {
    return new MpdAdapter(sourceId);
  }
  if (sourceDef.adapter === 'mod_v1') {
    return new ModAdapter(sourceId);
  }

  return null; // Övriga plattformar t.ex. Castor/Evolution/W3D3 byggs i Phase 2
}

export async function executeLokeHarvestForSource(
  sourceId: string,
  options: { execute?: boolean; onlyFilters?: string[] } = {}
): Promise<HarvestRunArtifact> {
  const startedAt = new Date().toISOString();
  const runId = `loke-run-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6)}`;
  
  const sourceDef = getSourceDefinition(sourceId);
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
      error_message: `Käll-ID '${sourceId}' hittades inte i Source Registry.`
    };
  }

  const execute = options.execute ?? false;
  const adapter = createAdapterForSource(sourceId);

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

  let documentsFound = 0;
  let documentsNew = 0;
  let documentsChanged = 0;

  try {
    // Steg 1: DISCOVER (Hitta kandidater)
    const candidates: HarvestCandidate[] = await adapter.discover(options.onlyFilters);
    documentsFound = candidates.length;

    console.log(`   -> Upptäckte ${candidates.length} tillgängliga dokument-kandidater.`);

    for (const cand of candidates) {
      // Säkra källsluss (Crawler Leak Protection - LSF-01)
      if (!isUrlAllowedForSource(sourceId, cand.sourceUrl)) {
        console.warn(`   ⚠️ [Crawler Leak Blocked] Nekade att anropa URL '${cand.sourceUrl}' eftersom domänen inte är listad i källans kontrakt.`);
        continue;
      }

      if (!execute) {
        console.log(`      -> [DRY-RUN] Skulle hämta: ${cand.fileName} från ${cand.sourceUrl}`);
        continue;
      }

      // Hämta immutabel katalogstruktur
      const caseBaseDir = getNationalArchiveCasePath(cand.authority, cand.year, cand.municipality, cand.caseId);
      const originalDir = path.join(caseBaseDir, 'original');
      const hashesDir = path.join(caseBaseDir, 'hashes');

      // Steg 2: FETCH (Ladda ner rådokument)
      const doc = await adapter.fetch(cand);
      const hash = calculateHash(doc.content);

      // Verifiera om filen redan existerar och om dess hash har förändrats (No-Overwrite Invariant)
      const origFilePath = path.join(originalDir, doc.name);
      let isNew = true;
      let isChanged = false;

      if (fs.existsSync(origFilePath)) {
        isNew = false;
        const existingContent = fs.readFileSync(origFilePath, 'utf8');
        const existingHash = calculateHash(existingContent);
        
        if (existingHash !== hash) {
          isChanged = true;
          documentsChanged++;
          console.log(`      ⚠️ [Förändring detekterad!] Checksumman har ändrats för ${cand.fileName}. Bevarar båda versionerna!`);
          
          // Spara med tidsstämpel för att förhindra överskrivning av historik!
          const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
          const historicalPath = path.join(originalDir, `${path.basename(doc.name, path.extname(doc.name))}_changed_${timestamp}${path.extname(doc.name)}`);
          fs.writeFileSync(historicalPath, doc.content, 'utf8');
        }
      } else {
        documentsNew++;
      }

      if (isNew || isChanged) {
        fs.mkdirSync(originalDir, { recursive: true });
        fs.mkdirSync(hashesDir, { recursive: true });

        // Spara den primära/nyaste källfilen
        fs.writeFileSync(origFilePath, doc.content, 'utf8');

        // Spara HarvestArtifact (provenance-bevis)
        const harvestArtifact: HarvestArtifact = {
          harvest_id: runId,
          source_url: doc.sourceUrl,
          authority: cand.authority,
          retrieved_at: doc.retrievedAt,
          content_hash: hash,
          status: 'raw_received'
        };

        const harvestArtifactPath = path.join(hashesDir, `harvest_${doc.name}.json`);
        fs.writeFileSync(harvestArtifactPath, JSON.stringify(harvestArtifact, null, 2), 'utf8');
        fs.writeFileSync(path.join(hashesDir, `${doc.name}.sha256`), hash, 'utf8');

        console.log(`         💾 Sparat RawArtifact (${doc.content.length} bytes) och skapat HarvestArtifact.`);
      } else {
        console.log(`         ⏭️ [SKIP] ${cand.fileName} är redan skördad och oförändrad.`);
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
      // Skriv HarvestRunArtifact till disk
      const runsDir = path.join(MASTER_ARCHIVE_ROOT, 'National_Archive', 'runs');
      fs.mkdirSync(runsDir, { recursive: true });
      fs.writeFileSync(path.join(runsDir, `harvest_run_${runId}.json`), JSON.stringify(runArtifact, null, 2), 'utf8');
      console.log(`   ✅ HarvestRunArtifact sparat under runs/. Status: completed`);
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
      const runsDir = path.join(MASTER_ARCHIVE_ROOT, 'National_Archive', 'runs');
      fs.mkdirSync(runsDir, { recursive: true });
      fs.writeFileSync(path.join(runsDir, `harvest_run_${runId}.json`), JSON.stringify(runArtifact, null, 2), 'utf8');
    }

    return runArtifact;
  }
}
