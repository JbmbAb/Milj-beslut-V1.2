import { describe, expect, it } from 'vitest';
import {
  findFilesRecursive,
  hasCombiningMarks,
  hasNonAsciiPath,
  resolveGpkgSource,
  sanitizePgIdentifier,
} from '../../scripts/import/lastkajenImportEngine';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('lastkajenImportEngine', () => {
  it('sanitizePgIdentifier normaliserar svenska tecken', () => {
    expect(sanitizePgIdentifier('Beläggning-Historik')).toBe('belaggning_historik');
  });

  it('hasNonAsciiPath detekterar svenska tecken i sökvägar', () => {
    expect(hasNonAsciiPath('C:/data/plain.zip')).toBe(false);
    expect(hasNonAsciiPath('C:/data/Beläggning.zip')).toBe(true);
  });

  it('hasCombiningMarks detekterar NFD-filnamn', () => {
    const nfd = 'A\u0308lg';
    expect(hasCombiningMarks(nfd)).toBe(true);
    expect(hasCombiningMarks('Alg')).toBe(false);
  });

  it('findFilesRecursive hittar gpkg i underkataloger', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-engine-'));
    const nested = path.join(tempDir, 'nested');
    fs.mkdirSync(nested, { recursive: true });
    const gpkg = path.join(nested, 'sample.gpkg');
    fs.writeFileSync(gpkg, 'placeholder');
    try {
      expect(findFilesRecursive(tempDir, '.gpkg')).toEqual([gpkg]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolveGpkgSource öppnar GeoPackage-zip utan inner path', () => {
    const dir = path.resolve('storage/ingest/lastkajen/10091');
    if (!fs.existsSync(dir)) {
      return;
    }
    const zipName = fs.readdirSync(dir).find((f) => /GeoPackage/i.test(f) && f.endsWith('.zip'));
    if (!zipName) {
      return;
    }
    const resolved = resolveGpkgSource(path.join(dir, zipName));
    try {
      expect(resolved.sourcePath).toMatch(/gpkg|vsizip/i);
    } finally {
      resolved.cleanup();
    }
  });
});
