import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { DiskQuarantineStorage } from '@miljobeslut/mimers-brunn-core';
import { MmdAdapter } from '../../../scripts/import/loke/adapters/mmdAdapter';

describe('🜂 Loke Harvest Agent — Ingestion & Contract (LSF-02)', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let executeLokeHarvestForSource: any;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loke-foundation-test-'));
    originalEnv = { ...process.env };

    // Sätt vår temp-katalog som arkiv-rot och karantäns-rot
    process.env.MASTER_ARCHIVE_ROOT = path.join(tempDir, 'geo_master_archive');
    process.env.QUARANTINE_ROOT = path.join(tempDir, '.quarantine');
    process.env.SKIP_DISK_SPACE_CHECK = 'true';
    process.env.SKIP_DISK_CHECK = 'true';
    process.env.NODE_ENV = 'test';

    // Rensa modul-cachen för att garantera att lokeRuntime läser av det nya tillståndet
    vi.resetModules();

    // Mocka globalThis.fetch för att hålla enhetstester hermetiska
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      let text = `Mocked content for ${url} inside Loke unit test`;
      if (url.includes('dom-m-1234-26.pdf')) {
        text = 'Akt/Målnummer: MMD-N-2026-0515';
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(text),
      } as any);
    });

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
    
    // Inga filer skapade i karantäns- eller masterarkivet
    expect(fs.existsSync(process.env.QUARANTINE_ROOT!)).toBe(false);
  });

  it('downloads RawObservations, creates RawSourceArtifacts in Quarantine, and writes HarvestRunArtifact', async () => {
    const result = await executeLokeHarvestForSource('mmd_nacka', { execute: true });

    expect(result.status).toBe('completed');
    expect(result.documents_found).toBe(4);
    expect(result.documents_new).toBe(4);
    expect(result.documents_changed).toBe(0);

    const quarantineDir = process.env.QUARANTINE_ROOT!;
    expect(fs.existsSync(quarantineDir)).toBe(true);

    const quarantineStorage = new DiskQuarantineStorage(quarantineDir);
    const quarantinedItems = await quarantineStorage.list();
    
    // Verifiera att exakt 4 filer skapades i karantänen
    expect(quarantinedItems.length).toBe(4);

    const decisions = quarantinedItems.filter(item => item.file_name === 'beslut.txt');
    expect(decisions.length).toBe(1);
    
    const decisionMeta = decisions[0];
    expect(decisionMeta.status).toBe('quarantined');
    expect(decisionMeta.source_id).toBe('mmd_nacka');
    expect(decisionMeta.source_url).toContain('domstol.se');
    expect(decisionMeta.content_hash).toBeDefined();

    // Kontrollera att råa binärer sparades
    const binBytes = await quarantineStorage.get(decisionMeta.quarantine_id);
    expect(binBytes).toBeDefined();
    expect(new TextDecoder().decode(binBytes!)).toContain('Akt/Målnummer: MMD-N-2026-0515');

    // Verifiera HarvestRunArtifact skapades i runs/ under karantänen
    const runsDir = path.join(quarantineDir, 'runs');
    expect(fs.existsSync(runsDir)).toBe(true);
    
    const runArtifactPath = path.join(runsDir, `harvest_run_${result.harvest_run_id}.json`);
    expect(fs.existsSync(runArtifactPath)).toBe(true);

    const runMeta = JSON.parse(fs.readFileSync(runArtifactPath, 'utf8'));
    expect(runMeta.harvest_run_id).toBe(result.harvest_run_id);
    expect(runMeta.source_id).toBe('mmd_nacka');
    expect(runMeta.status).toBe('completed');
    expect(runMeta.quarantined_ids.length).toBe(4);
  });

  it('correctly isolates and handles changes in raw document content', async () => {
    // Rensa karantänen först för detta test
    fs.rmSync(process.env.QUARANTINE_ROOT!, { recursive: true, force: true });
    
    const storage = new DiskQuarantineStorage(process.env.QUARANTINE_ROOT!);

    // Importera MmdAdapter efter resetModules har kört för att få rätt prototyp-referens
    const { MmdAdapter } = await import('../../../scripts/import/loke/adapters/mmdAdapter');

    // Spionera på discover så att den bara ger oss 1 kandidat (beslut.txt)
    const discoverSpy = vi.spyOn(MmdAdapter.prototype, 'discover');
    discoverSpy.mockResolvedValue([
      {
        uniqueId: 'mmd-nacka-2026-0515-beslut',
        caseId: 'MMD-N-2026-0515',
        authority: 'Nacka',
        municipality: 'Haninge',
        year: 2026,
        sourceUrl: 'https://www.domstol.se/nacka-tingsratt/dom-m-1234-26.pdf',
        fileName: 'beslut.txt',
        docType: 'decision'
      }
    ]);

    // Spionera på MmdAdapter.prototype.fetch för att simulera en ändring
    const fetchSpy = vi.spyOn(MmdAdapter.prototype, 'fetch');

    // Första körningen: returnerar original
    fetchSpy.mockResolvedValueOnce({
      name: 'beslut.txt',
      content: 'ORIGINAL INNEHÅLL FRÅN DOMSTOL',
      sourceUrl: 'https://www.domstol.se/nacka-tingsratt/beslut-999.pdf'
    });

    const run1 = await executeLokeHarvestForSource('mmd_nacka', { execute: true, onlyFilters: ['nacka'] });
    expect(run1.documents_new).toBe(1);

    const itemsAfterRun1 = await storage.list();
    expect(itemsAfterRun1.length).toBe(1);
    expect(new TextDecoder().decode(await storage.get(itemsAfterRun1[0].quarantine_id) as Uint8Array)).toBe('ORIGINAL INNEHÅLL FRÅN DOMSTOL');

    // Mandera andra körningen: returnerar modifierat innehåll
    fetchSpy.mockResolvedValueOnce({
      name: 'beslut.txt',
      content: 'MODIFIERAT INNEHÅLL (NYA VILLKOR)',
      sourceUrl: 'https://www.domstol.se/nacka-tingsratt/beslut-999.pdf'
    });

    const run2 = await executeLokeHarvestForSource('mmd_nacka', { execute: true, onlyFilters: ['nacka'] });
    expect(run2.documents_new).toBe(1); // Den räknas som ny i karantänen pga unikt innehåll/hash (L1-11)

    // Kontrollera att karantänen nu innehåller båda versionerna som separata, säkra RawSourceArtifacts
    const itemsAfterRun2 = await storage.list();
    expect(itemsAfterRun2.length).toBe(2);

    const content1 = new TextDecoder().decode(await storage.get(itemsAfterRun2[0].quarantine_id) as Uint8Array);
    const content2 = new TextDecoder().decode(await storage.get(itemsAfterRun2[1].quarantine_id) as Uint8Array);

    expect([content1, content2]).toContain('ORIGINAL INNEHÅLL FRÅN DOMSTOL');
    expect([content1, content2]).toContain('MODIFIERAT INNEHÅLL (NYA VILLKOR)');
  });
});
