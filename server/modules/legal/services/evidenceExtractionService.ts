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

export interface ExtractedChunk {
  section: string;
  content: string;
  relations: Array<{ type: string; target: string }>;
}

/**
 * Steg 1: Sektionsdetektering baserat på rubriker och dokumenttyp
 */
export function detectSections(text: string, docType: string): Record<string, string> {
  const sections: Record<string, string> = {};
  
  if (docType === 'decision') {
    // Sök efter standardavsnitt i domar och MPD-beslut (måste starta raden)
    const markers = [
      { name: 'DOMSLUT_BESLUT', regex: /^(?:1\.\s+BESLUTETS\s+INNEB.RD|DOMSLUT|BESLUT)/i },
      { name: 'VILLKOR', regex: /^(?:2\.\s+VILLKOR|VILLKOR\s+OCH\s+F.RSIKTIGHETSM[ÅA]TT)/i },
      { name: 'UPPLYSNINGAR_ÖVERKLAGANDE', regex: /^(?:3\.\s+UPPLYSNINGAR|.VERKLAGANDE)/i }
    ];

    let lastIndex = 0;
    let currentSection = 'BAKGRUND';

    const textLines = text.split('\n');
    let currentContent: string[] = [];

    for (const line of textLines) {
      let foundMarker = false;
      for (const m of markers) {
        if (m.regex.test(line.trim())) {
          // Spara föregående avsnitt
          if (currentContent.length > 0) {
            sections[currentSection] = currentContent.join('\n').trim();
          }
          currentSection = m.name;
          currentContent = [];
          foundMarker = true;
          break;
        }
      }
      if (!foundMarker) {
        currentContent.push(line);
      }
    }
    if (currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }
  } else if (docType === 'mkb') {
    const markers = [
      { name: 'LOKALISERINGSUTREDNING', regex: /^(?:1\.\s+L.KALISERINGSUTREDNING|PLATSVAL\s*$)/i },
      { name: 'BULLER_VIBRATIONER', regex: /^(?:2\.\s+N.RBOENDE|BULLER\s*$)/i },
      { name: 'VATTENMILJÖ_UTSLÄPP', regex: /^(?:3\.\s+VATTEN|RECEPIENT\s*$|VATTEN\s*$)/i }
    ];

    let currentSection = 'SAMMANFATTNING';
    let currentContent: string[] = [];

    for (const line of text.split('\n')) {
      let foundMarker = false;
      for (const m of markers) {
        if (m.regex.test(line.trim())) {
          if (currentContent.length > 0) {
            sections[currentSection] = currentContent.join('\n').trim();
          }
          currentSection = m.name;
          currentContent = [];
          foundMarker = true;
          break;
        }
      }
      if (!foundMarker) {
        currentContent.push(line);
      }
    }
    if (currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }
  } else if (docType === 'technical_description') {
    const markers = [
      { name: 'PROCESSBESKRIVNING', regex: /^(?:1\.\s+PROCESSBESKRIVNING|DRIFT)/i },
      { name: 'RENINGSTEKNIK_FILTER', regex: /^(?:2\.\s+RENINGSTEKNIK|FILTER)/i }
    ];

    let currentSection = 'TEKNISK_ÖVERSIKT';
    let currentContent: string[] = [];

    for (const line of text.split('\n')) {
      let foundMarker = false;
      for (const m of markers) {
        if (m.regex.test(line.trim())) {
          if (currentContent.length > 0) {
            sections[currentSection] = currentContent.join('\n').trim();
          }
          currentSection = m.name;
          currentContent = [];
          foundMarker = true;
          break;
        }
      }
      if (!foundMarker) {
        currentContent.push(line);
      }
    }
    if (currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }
  } else if (docType === 'control_program') {
    const markers = [
      { name: 'BULLERMÄTNING', regex: /^(?:1\.\s+BULLERM.TNING|AKUSTISK)/i },
      { name: 'VATTENKONTROLL', regex: /^(?:2\.\s+VATTENKONTROLL|GRUNDVATTEN|GW)/i },
      { name: 'ÅRSRAPPORTERING', regex: /^(?:3\.\s+.RSRAPPORTERING|RAPPORTERING)/i }
    ];

    let currentSection = 'EGENKONTROLL_INTRO';
    let currentContent: string[] = [];

    for (const line of text.split('\n')) {
      let foundMarker = false;
      for (const m of markers) {
        if (m.regex.test(line.trim())) {
          if (currentContent.length > 0) {
            sections[currentSection] = currentContent.join('\n').trim();
          }
          currentSection = m.name;
          currentContent = [];
          foundMarker = true;
          break;
        }
      }
      if (!foundMarker) {
        currentContent.push(line);
      }
    }
    if (currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }
  } else {
    // Standard fallback
    sections['GENERAL'] = text.trim();
  }

  return sections;
}

/**
 * Steg 2 & 3: EvidenceChunk Generator med metadata och relationer
 */
export function generateEvidenceChunks(text: string, docType: string): ExtractedChunk[] {
  const sectionsMap = detectSections(text, docType);
  const chunks: ExtractedChunk[] = [];

  const MAX_CHARS = 1000;
  const OVERLAP = 150;

  for (const [section, content] of Object.entries(sectionsMap)) {
    // Dela upp långa sektioner i mindre delar med överlapp
    if (content.length <= MAX_CHARS) {
      chunks.push({
        section,
        content,
        relations: determineRelations(content, docType, section)
      });
    } else {
      let start = 0;
      let partIdx = 1;
      while (start < content.length) {
        const end = Math.min(content.length, start + MAX_CHARS);
        const chunkText = content.slice(start, end).trim();
        
        chunks.push({
          section: `${section}_DEL_${partIdx}`,
          content: chunkText,
          relations: determineRelations(chunkText, docType, section)
        });
        
        if (end >= content.length) break;
        start = end - OVERLAP;
        partIdx++;
      }
    }
  }

  return chunks;
}

/**
 * Etablerar kausalitet och relationer mellan dokumentens avsnitt
 */
function determineRelations(content: string, docType: string, section: string): Array<{ type: string; target: string }> {
  const relations: Array<{ type: string; target: string }> = [];

  // Om vi läser villkor i ett beslut, leta efter referens till kontrollprogram
  if (docType === 'decision' && section.includes('VILLKOR')) {
    if (/kontrollprogram/i.test(content) || /egenkontroll/i.test(content)) {
      relations.push({ type: 'controlled_by', target: 'control_program' });
    }
    if (/buller/i.test(content) || /dBA/i.test(content)) {
      relations.push({ type: 'evaluated_in', target: 'mkb_buller' });
    }
    if (/vatten|grundvatten/i.test(content)) {
      relations.push({ type: 'evaluated_in', target: 'mkb_water' });
    }
  }

  // Om vi är i ett kontrollprogram, se vad det övervakar
  if (docType === 'control_program') {
    if (/buller/i.test(content)) {
      relations.push({ type: 'monitors_condition', target: 'decision_villkor_buller' });
    }
    if (/vatten|grundvatten|GW/i.test(content)) {
      relations.push({ type: 'monitors_condition', target: 'decision_villkor_water' });
    }
  }

  // Om vi är i MKB-dokumentet, se vad det stödjer
  if (docType === 'mkb') {
    relations.push({ type: 'supports_permit', target: 'decision' });
  }

  // Om vi är i den tekniska beskrivningen
  if (docType === 'technical_description') {
    relations.push({ type: 'describes_facility_for', target: 'decision' });
  }

  return relations;
}

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
