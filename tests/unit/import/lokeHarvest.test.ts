import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

describe('🜂 Loke Harvest Agent — Ingestion & Contract (LSF-02)', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let executeLokeHarvestForSource: any;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loke-foundation-test-'));
    originalEnv = { ...process.env };

    // Sätt vår temp-katalog som arkiv-rot
    process.env.MASTER_ARCHIVE_ROOT = tempDir;
    process.env.SKIP_DISK_SPACE_CHECK = 'true';
    process.env.SKIP_DISK_CHECK = 'true';
    process.env.NODE_ENV = 'test';

    // Importera Loke dynamiskt
    const mod = await import('../../../scripts/import/loke/lokeRuntime');
    executeLokeHarvestForSource = mod.executeLokeHarvestForSource;
  });

  afterAll(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('runs successfully in dry-run mode without creating files', async () => {
    const result = await executeLokeHarvestForSource('mmd_nacka', { execute: false });

    expect(result.status).toBe('completed');
    expect(result.documents_found).toBe(4); // Nacka har 4 dokument
    expect(result.documents_new).toBe(0);
    expect(fs.readdirSync(tempDir).length).toBe(0); // Inga kataloger skapade på disk
  });

  it('downloads RawArtifacts, creates HarvestArtifacts, and writes HarvestRunArtifact', async () => {
    const result = await executeLokeHarvestForSource('mmd_nacka', { execute: true });

    expect(result.status).toBe('completed');
    expect(result.documents_found).toBe(4);
    expect(result.documents_new).toBe(4);
    expect(result.documents_changed).toBe(0);

    const archiveDir = path.join(tempDir, 'National_Archive');
    expect(fs.existsSync(archiveDir)).toBe(true);

    // Verifiera MMD Nacka (Nacka, 2026, Haninge, MMD-N-2026-0515)
    const mmdCaseDir = path.join(archiveDir, 'Nacka', '2026', 'Haninge', 'MMD-N-2026-0515');
    expect(fs.existsSync(mmdCaseDir)).toBe(true);
    
    // RawArtifacts (original)
    expect(fs.existsSync(path.join(mmdCaseDir, 'original', 'beslut.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mmdCaseDir, 'original', 'miljokonsekvensbeskrivning_mkb.txt'))).toBe(true);

    // HarvestArtifacts (hashes / harvest_*.json)
    const harvestBeslutPath = path.join(mmdCaseDir, 'hashes', 'harvest_beslut.txt.json');
    expect(fs.existsSync(harvestBeslutPath)).toBe(true);
    
    // Läs in HarvestArtifact och verifiera kontraktet
    const harvestMeta = JSON.parse(fs.readFileSync(harvestBeslutPath, 'utf8'));
    expect(harvestMeta.harvest_id).toBe(result.harvest_run_id); // Matchar körnings-ID!
    expect(harvestMeta.source_url).toContain('domstol.se');
    expect(harvestMeta.status).toBe('raw_received');
    expect(harvestMeta.content_hash).toBeDefined();

    // Verifiera HarvestRunArtifact skapades i runs/
    const runsDir = path.join(archiveDir, 'runs');
    expect(fs.existsSync(runsDir)).toBe(true);
    
    const runArtifactPath = path.join(runsDir, `harvest_run_${result.harvest_run_id}.json`);
    expect(fs.existsSync(runArtifactPath)).toBe(true);

    const runMeta = JSON.parse(fs.readFileSync(runArtifactPath, 'utf8'));
    expect(runMeta.harvest_run_id).toBe(result.harvest_run_id);
    expect(runMeta.source_id).toBe('mmd_nacka');
    expect(runMeta.status).toBe('completed');
  });

  it('correctly handles immutable file version history upon content changes', async () => {
    // Första körningen (skapar beslut.txt)
    await executeLokeHarvestForSource('mmd_nacka', { execute: true });

    // Verifiera först att beslut.txt finns
    const caseDir = path.join(tempDir, 'National_Archive', 'Nacka', '2026', 'Haninge', 'MMD-N-2026-0515');
    const origBeslutPath = path.join(caseDir, 'original', 'beslut.txt');
    expect(fs.existsSync(origBeslutPath)).toBe(true);

    // Modifiera filen på disk manuellt för att simulera en förändring hos källan vid en ny körning
    fs.writeFileSync(origBeslutPath, 'ÄNDRAT INNEHÅLL HOS MYNDIGHETEN', 'utf8');

    // Andra körningen (upptäcker förändringen och sparar historisk version utan överskrivning!)
    const result2 = await executeLokeHarvestForSource('mmd_nacka', { execute: true });
    
    expect(result2.status).toBe('completed');
    expect(result2.documents_changed).toBe(1); // 1 fil upptäcktes som ändrad!

    // Kontrollera att det gamla/ändrade innehållet sparades under en historisk tidsstämplad kopia
    const files = fs.readdirSync(path.join(caseDir, 'original'));
    expect(files.length).toBe(5); // 4 original + 1 ändrad kopia = 5 filer!
    expect(files.some(f => f.includes('beslut_changed_'))).toBe(true);
  });
});
