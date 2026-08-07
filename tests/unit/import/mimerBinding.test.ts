import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../../../server/db/prisma';

describe('🜃 Mimer Binding Agent', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let runMimerEntityResolution: any;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimer-binding-test-'));
    originalEnv = { ...process.env };

    // Sätt vår temp-katalog som arkiv-rot
    process.env.MASTER_ARCHIVE_ROOT = tempDir;
    process.env.NODE_ENV = 'test';

    // Importera Mimer dynamiskt
    const mod = await import('../../../scripts/import/mimer/mimerBindingAgent');
    runMimerEntityResolution = mod.runMimerEntityResolution;
  });

  afterAll(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('performs Entity Resolution, binds cases, and generates bundle_manifest.json', async () => {
    // 1. Skapa en temporär skördad aktstruktur på disk (simulera Lokes output)
    // National_Archive/<Authority>/<Year>/<Municipality>/<Case_ID>/[original|hashes]
    const caseDir = path.join(tempDir, 'National_Archive', 'Dalarna', '2026', 'Mora', 'MPD-W-2026-0812');
    fs.mkdirSync(path.join(caseDir, 'original'), { recursive: true });
    fs.mkdirSync(path.join(caseDir, 'hashes'), { recursive: true });

    // Skriv källfilerna (RawArtifacts)
    const beslutText = `========================================================================
PRÖVNINGSMYNDIGHET: MPD Dalarna
DOKUMENTTYP: TILLSTÅNDSBESLUT (BESLUT)
========================================================================
Akt/Diarienummer: MPD-W-2026-0812
Fastighetsbeteckning: Mora Sanden 1:15
Verksamhetsutövare: Mora Bergtäkt AB
Verksamhetskod (MPF): 10.10
Datum för beslut: 2026-08-06

BESLUT OCH TILLSTÅND:
Täkttillstånd godkänns.`;

    const mkbText = `MKB för täkt Mora Sanden 1:15. Buller och damm begränsas.`;

    fs.writeFileSync(path.join(caseDir, 'original', 'beslut.txt'), beslutText, 'utf8');
    fs.writeFileSync(path.join(caseDir, 'original', 'miljokonsekvensbeskrivning_mkb.txt'), mkbText, 'utf8');

    // Skriv mottagningsbevis (HarvestArtifacts)
    const harvestBeslut = {
      harvest_id: 'harvest-20260806-001',
      source_url: 'https://lansstyrelsen.se/dalarna/beslut.pdf',
      retrieved_at: new Date().toISOString(),
      content_hash: 'hashbeslut123',
      status: 'raw_received'
    };

    const harvestMkb = {
      harvest_id: 'harvest-20260806-002',
      source_url: 'https://lansstyrelsen.se/dalarna/mkb.pdf',
      retrieved_at: new Date().toISOString(),
      content_hash: 'hashmkb456',
      status: 'raw_received'
    };

    fs.writeFileSync(path.join(caseDir, 'hashes', 'harvest_beslut.txt.json'), JSON.stringify(harvestBeslut, null, 2), 'utf8');
    fs.writeFileSync(path.join(caseDir, 'hashes', 'harvest_miljokonsekvensbeskrivning_mkb.txt.json'), JSON.stringify(harvestMkb, null, 2), 'utf8');

    // 2. Mocka Prisma-databasen för att förhindra faktiska DB-skrivningar under testkörning
    const upsertCaseMock = vi.spyOn(prisma.environmentalCase, 'upsert').mockResolvedValue({
      id: 'case-db-id',
      caseId: 'MPD-W-2026-0812'
    } as any);

    const upsertEvidenceMock = vi.spyOn(prisma.caseEvidence, 'upsert').mockResolvedValue({
      id: 'evidence-db-id'
    } as any);

    // 3. Exekvera Mimer Entity Resolution
    const result = await runMimerEntityResolution();

    // 4. Verifiera resultatkontraktet
    expect(result.unresolvedCount).toBe(2); // 2 dokument hittade
    expect(result.resolvedCasesCount).toBe(1); // Ihopkopplade till 1 gemensamt fall! (Entity Resolution)
    expect(result.dbCasesUpserted).toBe(1);
    expect(result.dbEvidenceUpserted).toBe(2);

    expect(upsertCaseMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { caseId: 'MPD-W-2026-0812' },
      create: expect.objectContaining({
        authority: 'Dalarna',
        operator: 'Mora Bergtäkt AB',
        activityCode: '10.10'
      })
    }));

    // Verifiera att bundle_manifest.json skapades med korrekta fält och provenance
    const manifestPath = path.join(caseDir, 'bundle_manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.bundle_id).toBe('MPD-W-2026-0812');
    expect(manifest.resolved_metadata.property).toBe('Mora Sanden 1:15');
    expect(manifest.resolved_metadata.operator).toBe('Mora Bergtäkt AB');
    expect(manifest.resolved_metadata.activity_code).toBe('10.10');
    expect(manifest.resolved_metadata.municipality).toBe('Mora');

    expect(manifest.documents.length).toBe(2);
    expect(manifest.documents[0].type).toBe('decision');
    expect(manifest.documents[0].legal_weight).toBe('primary');
    expect(manifest.documents[0].harvest_id).toBe('harvest-20260806-001');
  });
});
