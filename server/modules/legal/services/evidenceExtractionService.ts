/**
 * Mimer Bibliotekarie (Bibbi) — Evidence Extraction & Case Intelligence Pipeline
 * 
 * Orkesstrerar hela extraktionsflödet för miljötillstånd:
 *   1. Läser in EnvironmentalCaseBundle via dess manifest.json / bundle_manifest.json
 *   2. Identifierar och upprättar Tier 1 (EnvironmentalCase) i PostgreSQL
 *   3. Registrerar Tier 2 (CaseEvidence) för varje enskilt dokument i akten med dess roll/vikt
 *   4. Detekterar sektioner och delar upp texten i Evidence Chunks med bevarad kontext
 *   5. Etablerar semantiska relationer (t.ex. villkor till kontrollprogram)
 *   6. Genererar vektorbäddningar (pgvector) och sparar i Tier 3 (EvidenceChunk)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../../../db/prisma';
import { logger } from '../../../logger';
import { embedText } from '../../../services/searchService';
import {
  detectSections,
  generateEvidenceChunks,
  type ExtractedChunk,
} from '@miljobeslut/mps-chunking';

export type { ExtractedChunk };
export { detectSections, generateEvidenceChunks };

/**
 * Hjälpfunktion för att spara en chunk-vektor via rå SQL (för pgvector Unsupported)
 */
export async function updateEvidenceChunkVector(chunkId: string, vector: number[]) {
  const vectorLiteral = `[${vector.join(',')}]`;
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "evidence_chunks" SET "content_vector" = $1::vector WHERE id = $2`,
      vectorLiteral,
      chunkId
    );
  } catch (err) {
    logger.warn('[EvidenceExtraction] Kunde inte spara pgvector (kan bero på inaktiv pgvector-extension i testmiljö)', { err });
  }
}

/**
 * Huvudflöde: Läser in ett skördat paket (Bundle) och bygger upp det 3-stegade indexet
 */
export async function importCaseBundleTo3TierIndex(bundleManifestPath: string): Promise<{
  caseId: string;
  evidenceCount: number;
  chunkCount: number;
}> {
  const manifestContent = await fs.readFile(bundleManifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);

  const bundleDir = path.dirname(bundleManifestPath);
  const bundleId = manifest.bundle_id;

  // --- STEG 1: TIER 1 - BUNDLE INDEX (EnvironmentalCase) ---
  logger.info(`[Extraction Pipeline] Etablerar Tier 1 (EnvironmentalCase) för ${bundleId}...`);
  
  // Enkel grov parsing av metadata från ärendetexten för att berika ärendet
  let operator: string | null = null;
  let activityCode: string | null = null;

  // Läs beslut.txt om den finns för att plocka ut metadata
  const decisionDoc = manifest.documents.find((d: any) => d.type === 'decision');
  if (decisionDoc) {
    try {
      const decisionText = await fs.readFile(path.join(bundleDir, decisionDoc.file), 'utf8');
      const operatorMatch = decisionText.match(/Verksamhetsutövare:\s*([^\n]+)/i);
      const activityMatch = decisionText.match(/Verksamhetskod\s*\(MPF\):\s*([^\n]+)/i);
      
      if (operatorMatch) operator = operatorMatch[1]!.trim();
      if (activityMatch) activityCode = activityMatch[1]!.trim();
    } catch (err) {
      logger.warn('[Extraction Pipeline] Kunde inte för-analysera beslutstexten för metadata', { err });
    }
  }

  const dbCase = await prisma.environmentalCase.upsert({
    where: { caseId: bundleId },
    update: {
      authority: manifest.source_authority,
      operator: operator ?? 'Okänd verksamhetsutövare',
      activityCode: activityCode ?? 'Okänd',
    },
    create: {
      caseId: bundleId,
      authority: manifest.source_authority,
      operator: operator ?? 'Okänd verksamhetsutövare',
      activityCode: activityCode ?? 'Okänd',
    }
  });

  let evidenceCount = 0;
  let chunkCount = 0;

  // --- STEG 2 & 3: TIER 2 & TIER 3 (CaseEvidence & EvidenceChunk) ---
  for (const doc of manifest.documents) {
    const docPath = path.join(bundleDir, doc.file);
    const docText = await fs.readFile(docPath, 'utf8');

    logger.info(`   📥 Tier 2: Registrerar bevisdokument '${doc.file}' (${doc.type}) med legal_weight = ${doc.legal_weight}`);

    const dbEvidence = await prisma.caseEvidence.upsert({
      where: {
        caseId_fileHash: {
          caseId: dbCase.id,
          fileHash: doc.hash,
        }
      },
      update: {
        documentType: doc.type,
        legalWeight: doc.legal_weight,
        sourceFile: doc.file,
      },
      create: {
        caseId: dbCase.id,
        documentType: doc.type,
        legalWeight: doc.legal_weight,
        fileHash: doc.hash,
        sourceFile: doc.file,
      }
    });
    evidenceCount++;

    // Generera Evidence Chunks
    const rawChunks = generateEvidenceChunks(docText, doc.type);
    
    for (const raw of rawChunks) {
      // Skapa chunk i db
      const dbChunk = await prisma.evidenceChunk.create({
        data: {
          evidenceId: dbEvidence.id,
          section: raw.section,
          content: raw.content,
          relations: raw.relations as any,
        }
      });
      chunkCount++;

      // Generera embedding (stöder mock och real Vertex AI)
      const embeddingResult = await embedText(raw.content);
      if (embeddingResult && embeddingResult.values) {
        await updateEvidenceChunkVector(dbChunk.id, embeddingResult.values);
      }
    }
  }

  logger.info(`[Extraction Pipeline] 🎉 Import klar för ${bundleId}. Skapade 1 Ärende, ${evidenceCount} Bevisdokument och ${chunkCount} Evidence Chunks.`);
  return { caseId: dbCase.caseId, evidenceCount, chunkCount };
}
