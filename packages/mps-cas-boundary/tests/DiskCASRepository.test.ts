import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DiskCASRepository, digestBytes } from '../src/CASWriteOnceRepository';
import { resolveObjectPath, joinCASRoot } from '../src/CASPathResolver';

describe('Commit H.2: DiskCASRepository Boundary (L1-10)', () => {
  const testRoot = path.resolve(__dirname, '.cas-test-root');

  beforeAll(() => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('stores and retrieves raw bytes deterministically (WORM)', async () => {
    const repository = new DiskCASRepository(testRoot);
    const content = new TextEncoder().encode('Sovereign Environmental Truth');
    const expectedHash = digestBytes(content);

    // Skriv till CAS
    const putResult = await repository.put(content);
    expect(putResult.hash).toBe(expectedHash);
    expect(putResult.size).toBe(content.length);
    expect(putResult.existed).toBe(false);

    // Kontrollera att filen faktiskt ligger på rätt fysisk path på disk (CAS-I05)
    const location = resolveObjectPath(expectedHash);
    const expectedPhysicalPath = joinCASRoot(testRoot, location);
    expect(fs.existsSync(expectedPhysicalPath)).toBe(true);

    // Kontrollera exists och get
    expect(await repository.exists(expectedHash)).toBe(true);
    const retrieved = await repository.get(expectedHash);
    expect(retrieved).toBeDefined();
    expect(new TextDecoder().decode(retrieved!)).toBe('Sovereign Environmental Truth');
  });

  it('deduplicates identical raw payloads silently', async () => {
    const repository = new DiskCASRepository(testRoot);
    const content = new TextEncoder().encode('Deduplicated Content');

    const res1 = await repository.put(content);
    const res2 = await repository.put(content);

    expect(res1.existed).toBe(false);
    expect(res2.existed).toBe(true);
    expect(res1.hash).toBe(res2.hash);
  });

  it('detects and blocks physical file mutations or corruptions (CAS-I02)', async () => {
    const repository = new DiskCASRepository(testRoot);
    const content = new TextEncoder().encode('Original Pure Content');
    const hash = digestBytes(content);

    // Spara i CAS
    await repository.put(content);

    // Simulera fysisk korruption/manipulation genom att skriva över filen på disk manuellt (Adversarial)
    const location = resolveObjectPath(hash);
    const physicalPath = joinCASRoot(testRoot, location);
    
    // Vi tvingar fram en korrupt stat på disken
    fs.chmodSync(physicalPath, 0o666); // Säkra skrivrättighet för testet
    fs.writeFileSync(physicalPath, new TextEncoder().encode('Corrupted Modified Content'));

    // Om vi nu försöker lägga in originalet igen, måste diskhash-kontrollen upptäcka avvikelsen och kasta CAS_IMMUTABILITY_VIOLATION!
    await expect(repository.put(content)).rejects.toThrowError('CAS_IMMUTABILITY_VIOLATION');
  });
});
