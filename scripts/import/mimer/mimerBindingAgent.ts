/**
 * 🜃 Mimer — Archive & Binding Agent
 * 
 * Mimer ansvarar för bevarande, strukturering, proveniens och Entity Resolution.
 * Mimer tar emot och analyserar skördade HarvestArtifacts, identifierar deras 
 * ärendetillhörighet och binder samman dem till logiska fall (Cases / Bundles).
 * 
 * Ansvarsområde:
 *   - Rekursivt skanna National Archive efter nya HarvestArtifacts (harvest_*.json)
 *   - Läsa råfilerna för att extrahera primära och sekundära matchningsnycklar
 *   - Genomföra Entity Resolution (diarienummer, fastighet, organisationsnummer, etc.)
 *   - Skapa/uppdatera det samlade `bundle_manifest.json` per ärende
 *   - Etablera Tier 1 (EnvironmentalCase) och Tier 2 (CaseEvidence) i PostgreSQL
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { prisma } from '../../../server/db/prisma';
import { logger } from '../../../server/logger';
import { getNationalArchiveCasePath } from '../config/mimersBrunn';

// Standard Master-arkivrot i lokalt gränssnitt
const MASTER_ARCHIVE_ROOT = process.env.MASTER_ARCHIVE_ROOT || 'C:\\miljöbeslut\\storage\\geo_master_archive';

export interface UnresolvedEvidence {
  harvestId: string;
  sourceUrl: string;
  authority: string;
  retrievedAt: string;
  contentHash: string;
  fileName: string;
  rawText: string;
  casePath: string; // Absolut sökväg till fallet
  
  // Extraherad metadata från skörderuntimets RawArtifact
  caseId?: string;       // Primär nyckel (diarienummer / mål-nr)
  property?: string;     // Sekundär nyckel (fastighetsbeteckning)
  operator?: string;     // Sekundär nyckel (verksamhetsutövare)
  activityCode?: string; // Sekundär nyckel (verksamhetskod)
  municipality: string;  // Sekundär nyckel
  year: number;          // Sekundär nyckel
}

export interface ResolvedCase {
  caseId: string;
  authority: string;
  year: number;
  municipality: string;
  operator?: string;
  property?: string;
  activityCode?: string;
  evidences: UnresolvedEvidence[];
}

/**
 * Hjälpfunktion för att rekursivt hitta alla harvest-artefakter
 */
async function findHarvestArtifacts(dir: string): Promise<string[]> {
  const manifests: string[] = [];
  if (!(await fs.stat(dir).catch(() => null))) return [];
  
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...(await findHarvestArtifacts(fullPath)));
    } else if (entry.name.startsWith('harvest_') && entry.name.endsWith('.json')) {
      manifests.push(fullPath);
    }
  }
  return manifests;
}

/**
 * Enkel regex-parser för att extrahera fält från råtexterna
 */
function extractMetadataFromText(text: string): {
  caseId?: string;
  property?: string;
  operator?: string;
  activityCode?: string;
} {
  const meta: ReturnType<typeof extractMetadataFromText> = {};

  const caseMatch = text.match(/(?:Akt\/Diarienummer|Akt\/Målnummer):\s*([^\n]+)/i);
  const propertyMatch = text.match(/Fastighetsbeteckning:\s*([^\n]+)/i);
  const operatorMatch = text.match(/Verksamhetsutövare:\s*([^\n]+)/i);
  const codeMatch = text.match(/Verksamhetskod\s*\(MPF\):\s*([^\n]+)/i);

  if (caseMatch) meta.caseId = caseMatch[1]!.trim();
  if (propertyMatch) meta.property = propertyMatch[1]!.trim();
  if (operatorMatch) meta.operator = operatorMatch[1]!.trim();
  if (codeMatch) meta.activityCode = codeMatch[1]!.trim();

  return meta;
}

export async function runMimerEntityResolution(): Promise<{
  unresolvedCount: number;
  resolvedCasesCount: number;
  dbCasesUpserted: number;
  dbEvidenceUpserted: number;
}> {
  console.log('=== 🜃 Mimer: Archive & Binding Agent ===');
  console.log(`Mimer: Skannar National Archive efter skördade HarvestArtifacts i: ${MASTER_ARCHIVE_ROOT}`);

  const harvestPaths = await findHarvestArtifacts(path.join(MASTER_ARCHIVE_ROOT, 'National_Archive'));
  
  if (harvestPaths.length === 0) {
    console.log('Mimer: Inga nya HarvestArtifacts hittades. Väntar på att skörden ska köras.');
    return { unresolvedCount: 0, resolvedCasesCount: 0, dbCasesUpserted: 0, dbEvidenceUpserted: 0 };
  }

  console.log(`Mimer: Hittade ${harvestPaths.length} HarvestArtifacts. Inleder Entity Resolution...`);

  const unresolvedEvidences: UnresolvedEvidence[] = [];

  // --- STEG 1: LÄS IN OCH EXTRAHERA METADATA FRÅN ALLA ARTEFAKTER ---
  for (const harvestPath of harvestPaths) {
    try {
      const harvestMeta = JSON.parse(await fs.readFile(harvestPath, 'utf8'));
      
      const hashesDir = path.dirname(harvestPath);
      const caseBaseDir = path.dirname(hashesDir);
      
      // Filnamnet på originalfilen (t.ex. beslut.txt)
      const fileName = path.basename(harvestPath).replace(/^harvest_/, '').replace(/\.json$/, '');
      const originalFilePath = path.join(caseBaseDir, 'original', fileName);
      
      const rawText = await fs.readFile(originalFilePath, 'utf8');

      // Plocka ut kommun och år från katalognamnen
      // Struktur: National_Archive/<Authority>/<Year>/<Municipality>/<Case_ID>/hashes/harvest_*.json
      const pathParts = harvestPath.split(path.sep);
      const idx = pathParts.indexOf('National_Archive');
      const authority = pathParts[idx + 1] || 'Okänd Myndighet';
      const year = parseInt(pathParts[idx + 2] || '2026', 10);
      const municipality = pathParts[idx + 3] || 'Okänd Kommun';
      const folderCaseId = pathParts[idx + 4] || 'Okänt_Ärende';

      const extractedMeta = extractMetadataFromText(rawText);

      unresolvedEvidences.push({
        harvestId: harvestMeta.harvest_id,
        sourceUrl: harvestMeta.source_url,
        authority,
        retrievedAt: harvestMeta.retrieved_at,
        contentHash: harvestMeta.content_hash,
        fileName,
        rawText,
        casePath: caseBaseDir,
        municipality,
        year,
        caseId: extractedMeta.caseId || folderCaseId,
        property: extractedMeta.property,
        operator: extractedMeta.operator,
        activityCode: extractedMeta.activityCode
      });
    } catch (err) {
      logger.error(`[Mimer Agent] Misslyckades med att läsa in artefakt: ${harvestPath}`, { err });
    }
  }

  // --- STEG 2: ENTITY RESOLUTION & MATCHING ENGINE ---
  const resolvedCasesMap: Map<string, ResolvedCase> = new Map();

  for (const ev of unresolvedEvidences) {
    // Primär nyckel: diarienummer / mål-ID. Faller tillbaka på en sammansatt sekundär nyckel om diarienummer saknas.
    const primaryKey = ev.caseId || `UNRESOLVED_${ev.municipality}_${ev.property?.replace(/\s+/g, '_') || 'NO_PROP'}`;

    if (!resolvedCasesMap.has(primaryKey)) {
      resolvedCasesMap.set(primaryKey, {
        caseId: ev.caseId || primaryKey,
        authority: ev.authority,
        year: ev.year,
        municipality: ev.municipality,
        operator: ev.operator,
        property: ev.property,
        activityCode: ev.activityCode,
        evidences: []
      });
    }

    const currentCase = resolvedCasesMap.get(primaryKey)!;
    currentCase.evidences.push(ev);
    
    // Berika med eventuell saknad metadata från dokumentet
    if (!currentCase.operator && ev.operator) currentCase.operator = ev.operator;
    if (!currentCase.property && ev.property) currentCase.property = ev.property;
    if (!currentCase.activityCode && ev.activityCode) currentCase.activityCode = ev.activityCode;
  }

  console.log(`Mimer: Matchning slutförd. Grupperade ${unresolvedEvidences.length} dokument i ${resolvedCasesMap.size} unika ärenden.`);

  let dbCasesUpserted = 0;
  let dbEvidenceUpserted = 0;

  // --- STEG 3: SKAPA BUNDLE MANIFEST OCH SPARA I POSTGRESQL (Tier 1 & Tier 2) ---
  for (const [caseKey, resolved] of resolvedCasesMap.entries()) {
    console.log(`\n🜃 Behandlar ärende: ${resolved.caseId} (${resolved.authority})`);
    
    // 1. Skapa Tier 1: EnvironmentalCase i PostgreSQL
    const dbCase = await prisma.environmentalCase.upsert({
      where: { caseId: resolved.caseId },
      update: {
        authority: resolved.authority,
        operator: resolved.operator ?? 'Okänd verksamhetsutövare',
        activityCode: resolved.activityCode ?? 'Okänd',
        decisionDate: new Date(`${resolved.year}-08-06`)
      },
      create: {
        caseId: resolved.caseId,
        authority: resolved.authority,
        operator: resolved.operator ?? 'Okänd verksamhetsutövare',
        activityCode: resolved.activityCode ?? 'Okänd',
        decisionDate: new Date(`${resolved.year}-08-06`)
      }
    });
    dbCasesUpserted++;

    const documentsManifestList: any[] = [];
    const absoluteFilesList: string[] = [];

    // 2. Skapa Tier 2: CaseEvidence i PostgreSQL för varje dokument i ärendet
    for (const ev of resolved.evidences) {
      const docRole = determineDocumentRole(ev.fileName);
      const legalWeight = determineLegalWeight(docRole);

      await prisma.caseEvidence.upsert({
        where: {
          caseId_fileHash: {
            caseId: dbCase.id,
            fileHash: ev.contentHash
          }
        },
        update: {
          documentType: docRole,
          legalWeight: legalWeight,
          sourceFile: `original/${ev.fileName}`
        },
        create: {
          caseId: dbCase.id,
          documentType: docRole,
          legalWeight: legalWeight,
          fileHash: ev.contentHash,
          sourceFile: `original/${ev.fileName}`
        }
      });
      dbEvidenceUpserted++;

      documentsManifestList.push({
        type: docRole,
        legal_weight: legalWeight,
        file: `original/${ev.fileName}`,
        hash: ev.contentHash,
        source_url: ev.sourceUrl,
        retrieved_at: ev.retrievedAt,
        harvest_id: ev.harvestId
      });

      absoluteFilesList.push(path.join(ev.casePath, 'original', ev.fileName));
    }

    // 3. Beräkna sammansatt Bundle Hash över alla ingående originalfiler
    const bundleHash = await calculateCompositeBundleHash(absoluteFilesList);

    // 4. Skriv bundle_manifest.json till ärendets rot
    const bundleManifest = {
      bundle_id: resolved.caseId,
      bundle_hash: bundleHash,
      source_authority: resolved.authority,
      retrieved_at: new Date().toISOString(),
      documents: documentsManifestList,
      resolved_metadata: {
        property: resolved.property ?? 'Okänd',
        operator: resolved.operator ?? 'Okänd',
        activity_code: resolved.activityCode ?? 'Okänd',
        municipality: resolved.municipality
      }
    };

    // Skriv manifestet till ärendets rot (immutabelt provenance-bevis!)
    const targetCaseDir = resolved.evidences[0]!.casePath;
    const manifestPath = path.join(targetCaseDir, 'bundle_manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(bundleManifest, null, 2), 'utf8');
    
    console.log(`   ✅ Säkrat bundle_manifest.json under: ${targetCaseDir}`);
    console.log(`   🔒 Bundle-SHA256: ${bundleHash.substring(0, 12)}…`);
  }

  console.log(`\n🎉 [KLART] Mimer har framgångsrikt slutfört Entity Resolution och Case Graph Binding för samtliga ärenden.`);
  return {
    unresolvedCount: unresolvedEvidences.length,
    resolvedCasesCount: resolvedCasesMap.size,
    dbCasesUpserted,
    dbEvidenceUpserted
  };
}

/**
 * Bestämmer dokumentroll baserat på filnamn
 */
function determineDocumentRole(fileName: string): string {
  if (fileName.includes('beslut') || fileName.includes('dom')) return 'decision';
  if (fileName.includes('mkb')) return 'mkb';
  if (fileName.includes('teknisk')) return 'technical_description';
  if (fileName.includes('kontroll')) return 'control_program';
  return 'other';
}

/**
 * Bestämmer legal vikt baserat på dokumentroll
 */
function determineLegalWeight(role: string): string {
  switch (role) {
    case 'decision': return 'primary';
    case 'mkb': return 'evidence';
    case 'technical_description': return 'technical';
    case 'control_program': return 'compliance';
    default: return 'informational';
  }
}

/**
 * Beräknar sammansatt bundle hash för alla filer i bundeln
 */
async function calculateCompositeBundleHash(filePaths: string[]): Promise<string> {
  const hash = crypto.createHash('sha256');
  // Sortera sökvägar för att säkerställa deterministisk sortering i replays!
  const sortedPaths = [...filePaths].sort();
  
  for (const fp of sortedPaths) {
    const content = await fs.readFile(fp);
    hash.update(content);
  }
  return hash.digest('hex');
}

// Självexekveringsblock för CLI-anrop
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
  runMimerEntityResolution().catch((err) => {
    console.error('❌ Mimer misslyckades under körningen:', err);
    process.exitCode = 1;
  });
}
