import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

describe('harvest-mpd-mmd-to-master', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalArgv: string[];
  let runHarvest: () => Promise<void>;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miljobeslut-mpd-mmd-test-'));
    originalEnv = { ...process.env };
    originalArgv = [...process.argv];

    // Sätt miljövariabler innan vi importerar koden dynamiskt
    process.env.MASTER_ARCHIVE_ROOT = tempDir;
    process.env.SKIP_DISK_SPACE_CHECK = 'true';
    process.env.SKIP_DISK_CHECK = 'true';
    process.env.NODE_ENV = 'test';

    // Dynamisk import förbi-går hoisting och garanterar att miljövariablerna läses korrekt
    const mod = await import('../../../scripts/import/harvest-mpd-mmd-to-master');
    runHarvest = mod.runHarvest;
  });

  afterAll(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('runs successfully in dry-run mode without creating files', async () => {
    process.argv = ['node', 'scripts/import/harvest-mpd-mmd-to-master.ts'];
    
    const consoleSpy = vi.spyOn(console, 'log');

    await runHarvest();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DRY-RUN'));
    
    // Inga MPD/MMD filer ska ha skapats i dry-run
    const dataDir = path.join(tempDir, 'Data');
    if (fs.existsSync(dataDir)) {
      expect(fs.existsSync(path.join(dataDir, 'MPD'))).toBe(false);
      expect(fs.existsSync(path.join(dataDir, 'MMD'))).toBe(false);
    }
  });

  it('creates the correct multi-file bundle structure and manifests when executed with --execute', async () => {
    process.argv = ['node', 'scripts/import/harvest-mpd-mmd-to-master.ts', '--execute', '--only=Dalarna,Nacka'];

    const consoleSpy = vi.spyOn(console, 'log');

    await runHarvest();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Ärende: MPD-W-2026-0812'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Ärende: MMD-N-2026-0515'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Säkrat dokument: beslut.txt'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Säkrat dokument: miljokonsekvensbeskrivning_mkb.txt'));

    // Verifiera att mapparna skapades i vår temp-mapp
    // Enligt den nya National_Archive-strukturen: <MASTER_ARCHIVE_ROOT>/National_Archive/<Authority>/<Year>/<Municipality>/<Case_ID>/
    const archiveDir = path.join(tempDir, 'National_Archive');
    expect(fs.existsSync(archiveDir)).toBe(true);

    // MPD Dalarna fall (Dalarna, 2026, Mora, MPD-W-2026-0812)
    const mpdCaseDir = path.join(archiveDir, 'Dalarna', '2026', 'Mora', 'MPD-W-2026-0812');
    expect(fs.existsSync(mpdCaseDir)).toBe(true);
    expect(fs.existsSync(path.join(mpdCaseDir, 'original', 'beslut.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mpdCaseDir, 'original', 'miljokonsekvensbeskrivning_mkb.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mpdCaseDir, 'extracted', 'beslut.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mpdCaseDir, 'hashes', 'checksums.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mpdCaseDir, 'bundle_manifest.json'))).toBe(true);

    // MMD Nacka fall (Nacka, 2026, Haninge, MMD-N-2026-0515)
    const mmdCaseDir = path.join(archiveDir, 'Nacka', '2026', 'Haninge', 'MMD-N-2026-0515');
    expect(fs.existsSync(mmdCaseDir)).toBe(true);
    expect(fs.existsSync(path.join(mmdCaseDir, 'original', 'beslut.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mmdCaseDir, 'original', 'miljokonsekvensbeskrivning_mkb.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mmdCaseDir, 'extracted', 'beslut.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mmdCaseDir, 'hashes', 'checksums.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mmdCaseDir, 'bundle_manifest.json'))).toBe(true);
  });
});
