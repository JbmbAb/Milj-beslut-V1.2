import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  detectSections,
  generateEvidenceChunks,
  importCaseBundleTo3TierIndex
} from '../../../server/modules/legal/services/evidenceExtractionService';
import { prisma } from '../../../server/db/prisma';

vi.mock('../../../server/services/searchService', () => ({
  embedText: vi.fn().mockResolvedValue({
    values: new Array(1536).fill(0.1),
    model: 'mock-embedding'
  })
}));

describe('evidenceExtractionService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-extraction-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('detectSections', () => {
    it('correctly partitions a decision into sections', () => {
      const text = `Verksamhetsutövare: Mora Bergtäkt AB
Verksamhetskod (MPF): 10.10

1. BESLUTETS INNEBÖRD OCH OMFATTNING
Myndigheten godkänner täkten.

2. VILLKOR OCH FÖRSIKTIGHETSMÅTT
VILLKOR 1: Buller får inte överstiga 50 dBA.
GW-1 ska mätas månadsvis.

3. UPPLYSNINGAR OCH ÖVERKLAGANDEHÄNVISNING
Detta beslut kan överklagas.`;

      const sections = detectSections(text, 'decision');
      
      expect(sections['BAKGRUND']).toContain('Mora Bergtäkt AB');
      expect(sections['DOMSLUT_BESLUT']).toContain('Myndigheten godkänner täkten.');
      expect(sections['VILLKOR']).toContain('VILLKOR 1: Buller får inte överstiga 50 dBA.');
      expect(sections['UPPLYSNINGAR_ÖVERKLAGANDE']).toContain('Detta beslut kan överklagas.');
    });

    it('correctly partitions an MKB document', () => {
      const text = `Sammanfattning av effekter.
1. LOKALISERINGSUTREDNING OCH PLATSVAL
Platsen är lämplig.
2. NÄRBOENDE OCH BULLER
Buller är dämpat.`;

      const sections = detectSections(text, 'mkb');
      expect(sections['SAMMANFATTNING']).toContain('Sammanfattning');
      expect(sections['LOKALISERINGSUTREDNING']).toContain('Platsen är lämplig.');
      expect(sections['BULLER_VIBRATIONER']).toContain('Buller är dämpat.');
    });
  });

  describe('generateEvidenceChunks', () => {
    it('creates chunks with relational metadata', () => {
      const text = `2. VILLKOR OCH FÖRSIKTIGHETSMÅTT
VILLKOR 1: Buller får vara max 50 dBA. Detta ska övervakas i enlighet med bolagets kontrollprogram.`;

      const chunks = generateEvidenceChunks(text, 'decision');
      expect(chunks.length).toBeGreaterThan(0);
      
      const chunk = chunks[0]!;
      expect(chunk.section).toBe('VILLKOR');
      expect(chunk.content).toContain('VILLKOR 1');
      
      // Verifiera att relationer upprättades automatiskt
      const relations = chunk.relations;
      expect(relations).toContainEqual({ type: 'controlled_by', target: 'control_program' });
      expect(relations).toContainEqual({ type: 'evaluated_in', target: 'mkb_buller' });
    });
  });

  describe('importCaseBundleTo3TierIndex', () => {
    it('correctly parses manifest and populates index layers', async () => {
      // 1. Skapa temporärt ärendepaket på disk
      const bundleId = 'MPD-W-2026-TEST';
      const manifestPath = path.join(tempDir, 'bundle_manifest.json');
      
      const decisionContent = `Verksamhetsutövare: TestPartner AB
Verksamhetskod (MPF): 90.10

1. BESLUTETS INNEBÖRD OCH OMFATTNING
B-verksamheten godkänns.

2. VILLKOR OCH FÖRSIKTIGHETSMÅTT
VILLKOR 1: Följ kontrollprogrammet.`;

      fs.writeFileSync(path.join(tempDir, 'beslut.txt'), decisionContent, 'utf8');

      const manifest = {
        bundle_id: bundleId,
        source_authority: 'MPD Dalarna',
        retrieved_at: new Date().toISOString(),
        documents: [
          {
            type: 'decision',
            legal_weight: 'primary',
            file: 'beslut.txt',
            hash: 'mockhash123'
          }
        ]
      };

      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      // 2. Mocka Prisma-databasen för att förhindra faktiska DB-skrivningar men verifiera anropen
      const upsertCaseMock = vi.spyOn(prisma.environmentalCase, 'upsert').mockResolvedValue({
        id: 'case-db-id',
        caseId: bundleId,
        authority: 'MPD Dalarna',
        operator: 'TestPartner AB',
        activityCode: '90.10',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const upsertEvidenceMock = vi.spyOn(prisma.caseEvidence, 'upsert').mockResolvedValue({
        id: 'evidence-db-id',
        caseId: 'case-db-id',
        documentType: 'decision',
        legalWeight: 'primary',
        fileHash: 'mockhash123',
        sourceFile: 'beslut.txt',
        createdAt: new Date(),
      } as any);

      const createChunkMock = vi.spyOn(prisma.evidenceChunk, 'create').mockResolvedValue({
        id: 'chunk-db-id',
        evidenceId: 'evidence-db-id',
        section: 'VILLKOR',
        content: 'VILLKOR 1: Följ kontrollprogrammet.',
        relations: [],
        createdAt: new Date(),
      } as any);

      const executeRawMock = vi.spyOn(prisma, '$executeRawUnsafe').mockResolvedValue(1);

      // 3. Kör extraktionsflödet
      const result = await importCaseBundleTo3TierIndex(manifestPath);

      // 4. Verifiera att alla steg i pipelinen anropades rätt
      expect(result.caseId).toBe(bundleId);
      expect(result.evidenceCount).toBe(1);
      
      expect(upsertCaseMock).toHaveBeenCalledWith(expect.objectContaining({
        where: { caseId: bundleId },
        create: expect.objectContaining({
          operator: 'TestPartner AB',
          activityCode: '90.10',
        })
      }));

      expect(upsertEvidenceMock).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          documentType: 'decision',
          legalWeight: 'primary',
          fileHash: 'mockhash123'
        })
      }));

      expect(createChunkMock).toHaveBeenCalled();
      expect(executeRawMock).toHaveBeenCalled();
    });
  });
});
