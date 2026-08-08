import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DiskQuarantineStorage } from '@miljobeslut/mimers-brunn-core';

describe('L1-11 Quarantine Storage Semantics', () => {
  const testDir = path.resolve(__dirname, '.quarantine-test');

  beforeAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('can put raw source artifacts and preserve original bytes', async () => {
    const storage = new DiskQuarantineStorage(testDir);
    const content = new TextEncoder().encode('Miljöbeslut PFAS Analys 2026');
    const sourceId = 'mmd_v1';
    const sourceUrl = 'https://domstol.se/mmd/pfas_2026.pdf';
    const fileName = 'pfas_2026.pdf';

    const result = await storage.put(sourceId, sourceUrl, fileName, content, { municipality: 'Uppsala' });

    expect(result.quarantine_id).toBeDefined();
    expect(result.is_duplicate).toBe(false);
    expect(fs.existsSync(result.file_path)).toBe(true);
    expect(fs.existsSync(result.metadata_path)).toBe(true);

    // Verifiera binär-innehåll
    const savedBytes = await storage.get(result.quarantine_id);
    expect(savedBytes).toBeDefined();
    expect(new TextDecoder().decode(savedBytes!)).toBe('Miljöbeslut PFAS Analys 2026');

    // Verifiera metadata
    const meta = await storage.getMetadata(result.quarantine_id);
    expect(meta).toBeDefined();
    expect(meta!.source_id).toBe(sourceId);
    expect(meta!.source_url).toBe(sourceUrl);
    expect(meta!.file_name).toBe(fileName);
    expect(meta!.status).toBe('quarantined');
    expect(meta!.custom_metadata?.municipality).toBe('Uppsala');
  });

  it('detects and dedupes identical raw payloads within quarantine', async () => {
    const storage = new DiskQuarantineStorage(testDir);
    const content = new TextEncoder().encode('Samma innehåll');

    const res1 = await storage.put('mpd_v1', 'http://link1', 'file.pdf', content);
    const res2 = await storage.put('mpd_v1', 'http://link2', 'file.pdf', content);

    expect(res1.is_duplicate).toBe(false);
    expect(res2.is_duplicate).toBe(true);
    expect(res1.quarantine_id).toBe(res2.quarantine_id);
  });

  it('supports status updates and validation error logging (L1-11 rule)', async () => {
    const storage = new DiskQuarantineStorage(testDir);
    const content = new TextEncoder().encode('Felaktigt innehåll');
    const res = await storage.put('mpd_v1', 'http://link', 'bad.pdf', content);

    // Uppdatera status till rejected med felmeddelande
    await storage.updateStatus(res.quarantine_id, 'rejected', ['INTEGRITY_CHECK_FAILED: Mismatched size']);

    const meta = await storage.getMetadata(res.quarantine_id);
    expect(meta!.status).toBe('rejected');
    expect(meta!.validation_errors).toContain('INTEGRITY_CHECK_FAILED: Mismatched size');

    // Filen ska FORTFARANDE finnas kvar fysiskt på disk (Får EJ raderas eller ändras, L1-11)
    const savedBytes = await storage.get(res.quarantine_id);
    expect(savedBytes).toBeDefined();
    expect(new TextDecoder().decode(savedBytes!)).toBe('Felaktigt innehåll');
  });

  it('can list items by status filter', async () => {
    const customTestDir = path.resolve(__dirname, '.quarantine-list-test');
    const storage = new DiskQuarantineStorage(customTestDir);

    const c1 = new TextEncoder().encode('File 1');
    const c2 = new TextEncoder().encode('File 2');

    const r1 = await storage.put('source1', 'url1', 'f1.pdf', c1);
    const r2 = await storage.put('source2', 'url2', 'f2.pdf', c2);

    await storage.updateStatus(r1.quarantine_id, 'validated');

    const validated = await storage.list('validated');
    const quarantined = await storage.list('quarantined');

    expect(validated.length).toBe(1);
    expect(validated[0].quarantine_id).toBe(r1.quarantine_id);

    expect(quarantined.length).toBe(1);
    expect(quarantined[0].quarantine_id).toBe(r2.quarantine_id);

    fs.rmSync(customTestDir, { recursive: true, force: true });
  });
});
